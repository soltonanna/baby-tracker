import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { API_PREFIX, createApp } from '../../app.js';
import { Family } from '../../models/Family.js';
import { FamilyMember } from '../../models/FamilyMember.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';
import { authenticate } from '../../middleware/authenticate.js';
import {
  getFamilyScope,
  requireFamilyMembership,
  requireFamilyRole,
} from '../../middleware/familyAccess.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const app = createApp();
const families = `${API_PREFIX}/families`;
const authUrl = (path: string): string => `${API_PREFIX}/auth${path}`;

interface Signed {
  bearer: string;
  userId: string;
}

let accountCounter = 0;

/** A fresh account, and the Authorization header that authenticates as them. */
async function signUp(): Promise<Signed> {
  accountCounter += 1;
  const response = await request(app)
    .post(authUrl('/register'))
    .send({
      email: `parent-${accountCounter}@example.com`,
      password: 'a-perfectly-ordinary-passphrase',
      displayName: `Parent ${accountCounter}`,
    });

  expect(response.status).toBe(201);
  return {
    bearer: `Bearer ${response.body.accessToken as string}`,
    userId: response.body.user.id as string,
  };
}

const createFamily = (who: Signed, name = 'Our Family') =>
  request(app).post(families).set('Authorization', who.bearer).send({ name });

beforeEach(() => {
  accountCounter = 0;
  resetAuthRateLimits();
});

describe('POST /families', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(app).post(families).send({ name: 'Our Family' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(await Family.countDocuments()).toBe(0);
  });

  it('creates the family and makes the creator its OWNER', async () => {
    const owner = await signUp();

    const response = await createFamily(owner, 'Sultanov family');

    expect(response.status).toBe(201);
    expect(response.body.family).toMatchObject({
      name: 'Sultanov family',
      createdBy: owner.userId,
      role: 'OWNER',
    });
    expect(response.body.family.id).toMatch(/^[0-9a-f]{24}$/);
    expect(Date.parse(response.body.family.createdAt)).not.toBeNaN();
  });

  it('writes the family and the membership together', async () => {
    const owner = await signUp();

    const { body } = await createFamily(owner);

    const family = await Family.findById(body.family.id);
    expect(family?.name).toBe('Our Family');
    expect(family?.createdBy.toString()).toBe(owner.userId);

    const memberships = await FamilyMember.find({ familyId: body.family.id });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.userId.toString()).toBe(owner.userId);
    expect(memberships[0]?.role).toBe('OWNER');
  });

  it('trims the name and rejects an invalid one', async () => {
    const owner = await signUp();

    const trimmed = await createFamily(owner, '   Padded family   ');
    expect(trimmed.body.family.name).toBe('Padded family');

    for (const name of ['', '   ', 'x'.repeat(81)]) {
      const response = await request(app)
        .post(families)
        .set('Authorization', owner.bearer)
        .send({ name });

      expect(response.status, `name: ${JSON.stringify(name)}`).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }

    const missing = await request(app).post(families).set('Authorization', owner.bearer).send({});
    expect(missing.status).toBe(422);

    // Only the one valid family was created.
    expect(await Family.countDocuments()).toBe(1);
  });

  it('leaves no orphan family when the membership write fails', async () => {
    const owner = await signUp();

    const failure = new Error('membership write failed');
    const spy = vi.spyOn(FamilyMember, 'create').mockRejectedValueOnce(failure as never);

    const response = await createFamily(owner);

    expect(response.status).toBe(500);
    // The compensating delete must have removed the family again.
    expect(await Family.countDocuments()).toBe(0);
    expect(await FamilyMember.countDocuments()).toBe(0);

    spy.mockRestore();
  });
});

describe('GET /families', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(app).get(families);
    expect(response.status).toBe(401);
  });

  it('returns the caller’s families with their role, and nobody else’s', async () => {
    const owner = await signUp();
    const stranger = await signUp();

    await createFamily(owner, 'Ours');
    await createFamily(stranger, 'Theirs');

    const mine = await request(app).get(families).set('Authorization', owner.bearer);

    expect(mine.status).toBe(200);
    expect(mine.body.families).toHaveLength(1);
    expect(mine.body.families[0]).toMatchObject({ name: 'Ours', role: 'OWNER' });

    const names = (mine.body.families as { name: string }[]).map((f) => f.name);
    expect(names).not.toContain('Theirs');
  });

  it('returns an empty list for a user who belongs to nothing', async () => {
    const loner = await signUp();
    const other = await signUp();
    await createFamily(other, 'Not yours');

    const response = await request(app).get(families).set('Authorization', loner.bearer);

    expect(response.status).toBe(200);
    expect(response.body.families).toEqual([]);
  });

  it('reports MEMBER for a family the caller did not create', async () => {
    const owner = await signUp();
    const member = await signUp();
    const { body } = await createFamily(owner, 'Shared');

    await FamilyMember.create({
      familyId: body.family.id,
      userId: member.userId,
      role: 'MEMBER',
    });

    const response = await request(app).get(families).set('Authorization', member.bearer);

    expect(response.body.families).toHaveLength(1);
    expect(response.body.families[0]).toMatchObject({ name: 'Shared', role: 'MEMBER' });
  });
});

describe('GET /families/:familyId', () => {
  it('rejects an unauthenticated request', async () => {
    const owner = await signUp();
    const { body } = await createFamily(owner);

    const response = await request(app).get(`${families}/${body.family.id as string}`);
    expect(response.status).toBe(401);
  });

  it('returns the family and the caller’s role to a member', async () => {
    const owner = await signUp();
    const { body } = await createFamily(owner, 'Ours');

    const response = await request(app)
      .get(`${families}/${body.family.id as string}`)
      .set('Authorization', owner.bearer);

    expect(response.status).toBe(200);
    expect(response.body.family).toMatchObject({
      id: body.family.id,
      name: 'Ours',
      role: 'OWNER',
    });
  });

  it('refuses a non-member without confirming the family exists', async () => {
    const owner = await signUp();
    const stranger = await signUp();
    const { body } = await createFamily(owner, 'Ours');

    const otherFamily = await request(app)
      .get(`${families}/${body.family.id as string}`)
      .set('Authorization', stranger.bearer);

    const missingFamily = await request(app)
      .get(`${families}/${new Types.ObjectId().toString()}`)
      .set('Authorization', stranger.bearer);

    const malformedId = await request(app)
      .get(`${families}/not-an-object-id`)
      .set('Authorization', stranger.bearer);

    // Byte-identical, so nothing distinguishes "someone else's" from
    // "does not exist" from "not even an id".
    for (const response of [otherFamily, missingFamily, malformedId]) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
    expect(JSON.stringify(otherFamily.body)).toBe(JSON.stringify(missingFamily.body));
    expect(JSON.stringify(otherFamily.body)).toBe(JSON.stringify(malformedId.body));
  });

  it('does not let one family read another by swapping the id', async () => {
    const alice = await signUp();
    const bob = await signUp();
    const alices = (await createFamily(alice, 'Alice family')).body.family.id as string;
    const bobs = (await createFamily(bob, 'Bob family')).body.family.id as string;

    const aliceReadsHers = await request(app)
      .get(`${families}/${alices}`)
      .set('Authorization', alice.bearer);
    expect(aliceReadsHers.status).toBe(200);

    const aliceReadsBobs = await request(app)
      .get(`${families}/${bobs}`)
      .set('Authorization', alice.bearer);
    expect(aliceReadsBobs.status).toBe(404);
    expect(JSON.stringify(aliceReadsBobs.body)).not.toContain('Bob family');
  });
});

describe('duplicate membership', () => {
  it('is refused by a unique compound index', async () => {
    const owner = await signUp();
    const { body } = await createFamily(owner);

    await expect(
      FamilyMember.create({ familyId: body.family.id, userId: owner.userId, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 11000 });

    expect(await FamilyMember.countDocuments({ familyId: body.family.id })).toBe(1);
  });

  it('has the unique index actually present on the collection', async () => {
    await FamilyMember.init();
    const indexes = await FamilyMember.collection.indexes();

    const compound = indexes.find(
      (index) => index.key.familyId === 1 && index.key.userId === 1 && index.unique === true,
    );
    expect(compound, JSON.stringify(indexes)).toBeDefined();

    // The list-my-families index, and nothing speculative beyond it.
    expect(
      indexes.find((index) => index.key.userId === 1 && index.key.familyId === undefined),
    ).toBeDefined();
    expect(indexes).toHaveLength(3); // _id, compound, userId
  });
});

describe('the family authorization middleware', () => {
  /**
   * A probe router built from the real middleware, so the mechanism future
   * Baby and Event routes will compose is tested directly rather than only
   * through the endpoints that happen to exist today.
   */
  const probe = express();
  probe.get('/probe/:familyId/any-member', authenticate, requireFamilyMembership, (req, res) => {
    res.json(getFamilyScope(req));
  });
  probe.get(
    '/probe/:familyId/owner-only',
    authenticate,
    requireFamilyMembership,
    requireFamilyRole('OWNER'),
    (req, res) => {
      res.json(getFamilyScope(req));
    },
  );
  probe.use(errorHandler);

  it('exposes the resolved membership to downstream handlers', async () => {
    const owner = await signUp();
    const { body } = await createFamily(owner);

    const response = await request(probe)
      .get(`/probe/${body.family.id as string}/any-member`)
      .set('Authorization', owner.bearer);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      familyId: body.family.id,
      userId: owner.userId,
      role: 'OWNER',
    });
    expect(response.body.membershipId).toMatch(/^[0-9a-f]{24}$/);
  });

  it('resolves MEMBER as well as OWNER', async () => {
    const owner = await signUp();
    const member = await signUp();
    const { body } = await createFamily(owner);
    await FamilyMember.create({
      familyId: body.family.id,
      userId: member.userId,
      role: 'MEMBER',
    });

    const response = await request(probe)
      .get(`/probe/${body.family.id as string}/any-member`)
      .set('Authorization', member.bearer);

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('MEMBER');
  });

  it('rejects a non-member with 404 and an unauthenticated caller with 401', async () => {
    const owner = await signUp();
    const stranger = await signUp();
    const { body } = await createFamily(owner);
    const path = `/probe/${body.family.id as string}/any-member`;

    expect((await request(probe).get(path).set('Authorization', stranger.bearer)).status).toBe(404);
    expect((await request(probe).get(path)).status).toBe(401);
  });

  it('refuses a MEMBER on an owner-only route with 403, not 404', async () => {
    const owner = await signUp();
    const member = await signUp();
    const { body } = await createFamily(owner);
    await FamilyMember.create({
      familyId: body.family.id,
      userId: member.userId,
      role: 'MEMBER',
    });
    const path = `/probe/${body.family.id as string}/owner-only`;

    const asOwner = await request(probe).get(path).set('Authorization', owner.bearer);
    expect(asOwner.status).toBe(200);

    // 403 rather than 404: a member already knows this family exists, so only
    // the action is refused, not the resource hidden.
    const asMember = await request(probe).get(path).set('Authorization', member.bearer);
    expect(asMember.status).toBe(403);
    expect(asMember.body.error.code).toBe('FORBIDDEN');
  });
});
