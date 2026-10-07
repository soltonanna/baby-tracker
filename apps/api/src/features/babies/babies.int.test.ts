import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { API_PREFIX, createApp } from '../../app.js';
import { Baby } from '../../models/Baby.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';

const app = createApp();
const authUrl = (path: string): string => `${API_PREFIX}/auth${path}`;
const babiesUrl = (familyId: string): string => `${API_PREFIX}/families/${familyId}/babies`;

interface Signed {
  bearer: string;
  userId: string;
}

let accountCounter = 0;

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

/** A signed-up parent with a family of their own. */
async function withFamily(): Promise<Signed & { familyId: string }> {
  const who = await signUp();
  const response = await request(app)
    .post(`${API_PREFIX}/families`)
    .set('Authorization', who.bearer)
    .send({ name: 'Our Family' });

  expect(response.status).toBe(201);
  return { ...who, familyId: response.body.family.id as string };
}

const addBaby = (who: Signed, familyId: string, body: unknown) =>
  request(app).post(babiesUrl(familyId)).set('Authorization', who.bearer).send(body);

beforeEach(() => {
  accountCounter = 0;
  resetAuthRateLimits();
});

describe('POST /families/:familyId/babies', () => {
  it('creates a baby with the expected fields', async () => {
    const parent = await withFamily();

    const response = await addBaby(parent, parent.familyId, {
      name: '  Baby A  ',
      birthDate: '2026-09-01',
      gender: 'FEMALE',
    });

    expect(response.status).toBe(201);
    expect(response.body.baby).toMatchObject({
      familyId: parent.familyId,
      name: 'Baby A',
      gender: 'FEMALE',
    });
    expect(response.body.baby.id).toMatch(/^[0-9a-f]{24}$/);
    expect(response.body.baby.birthDate).toBe('2026-09-01T00:00:00.000Z');
    expect(Date.parse(response.body.baby.createdAt)).not.toBeNaN();

    const stored = await Baby.findById(response.body.baby.id as string);
    expect(stored?.familyId.toString()).toBe(parent.familyId);
  });

  it('accepts either gender, and a baby with neither gender nor birth date', async () => {
    const parent = await withFamily();

    for (const gender of ['MALE', 'FEMALE']) {
      const response = await addBaby(parent, parent.familyId, { name: `Baby ${gender}`, gender });
      expect(response.status, gender).toBe(201);
      expect(response.body.baby.gender).toBe(gender);
    }

    const minimal = await addBaby(parent, parent.familyId, { name: 'Baby C' });
    expect(minimal.status).toBe(201);
    expect(minimal.body.baby.birthDate).toBeUndefined();
    expect(minimal.body.baby.gender).toBeUndefined();
  });

  it('ignores a familyId in the body and uses the one in the URL', async () => {
    const parent = await withFamily();
    const elsewhere = await withFamily();

    const response = await addBaby(parent, parent.familyId, {
      name: 'Baby A',
      familyId: elsewhere.familyId,
    });

    expect(response.status).toBe(201);
    expect(response.body.baby.familyId).toBe(parent.familyId);
    expect(await Baby.countDocuments({ familyId: elsewhere.familyId })).toBe(0);
  });

  it('rejects invalid data', async () => {
    const parent = await withFamily();

    for (const body of [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(81) },
      { name: 'Baby A', gender: 'OTHER' },
      { name: 'Baby A', birthDate: 'not-a-date' },
    ]) {
      const response = await addBaby(parent, parent.familyId, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }

    expect(await Baby.countDocuments()).toBe(0);
  });

  it('rejects an unauthenticated request', async () => {
    const parent = await withFamily();

    const response = await request(app).post(babiesUrl(parent.familyId)).send({ name: 'Baby A' });

    expect(response.status).toBe(401);
    expect(await Baby.countDocuments()).toBe(0);
  });

  it('rejects a family the caller does not belong to, and one that does not exist', async () => {
    const parent = await withFamily();
    const stranger = await signUp();

    const foreign = await addBaby(stranger, parent.familyId, { name: 'Baby A' });
    const missing = await addBaby(stranger, new Types.ObjectId().toString(), { name: 'Baby A' });
    const malformed = await addBaby(stranger, 'not-an-object-id', { name: 'Baby A' });

    for (const response of [foreign, missing, malformed]) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
    expect(await Baby.countDocuments()).toBe(0);
  });
});

describe('GET /families/:familyId/babies', () => {
  it('lists the family’s babies, and nobody else’s', async () => {
    const parent = await withFamily();
    const other = await withFamily();

    await addBaby(parent, parent.familyId, { name: 'Baby A' });
    await addBaby(parent, parent.familyId, { name: 'Baby B' });
    await addBaby(other, other.familyId, { name: 'Not ours' });

    const response = await request(app)
      .get(babiesUrl(parent.familyId))
      .set('Authorization', parent.bearer);

    expect(response.status).toBe(200);
    expect((response.body.babies as { name: string }[]).map((baby) => baby.name)).toEqual([
      'Baby A',
      'Baby B',
    ]);
  });

  it('rejects an unauthenticated caller and a non-member', async () => {
    const parent = await withFamily();
    const stranger = await signUp();
    await addBaby(parent, parent.familyId, { name: 'Baby A' });

    expect((await request(app).get(babiesUrl(parent.familyId))).status).toBe(401);

    const asStranger = await request(app)
      .get(babiesUrl(parent.familyId))
      .set('Authorization', stranger.bearer);
    expect(asStranger.status).toBe(404);
    expect(JSON.stringify(asStranger.body)).not.toContain('Baby A');
  });
});

describe('GET /families/:familyId/babies/:babyId', () => {
  it('returns one baby to a member of its family', async () => {
    const parent = await withFamily();
    const created = await addBaby(parent, parent.familyId, { name: 'Baby A', gender: 'MALE' });
    const babyId = created.body.baby.id as string;

    const response = await request(app)
      .get(`${babiesUrl(parent.familyId)}/${babyId}`)
      .set('Authorization', parent.bearer);

    expect(response.status).toBe(200);
    expect(response.body.baby).toMatchObject({ id: babyId, name: 'Baby A', gender: 'MALE' });
  });

  it('cannot be reached by swapping either id in the URL', async () => {
    const alice = await withFamily();
    const bob = await withFamily();
    const bobsBaby = (await addBaby(bob, bob.familyId, { name: 'Bob baby' })).body.baby
      .id as string;

    // Bob's baby, asked for through Alice's family: the familyId filter misses.
    const throughOwnFamily = await request(app)
      .get(`${babiesUrl(alice.familyId)}/${bobsBaby}`)
      .set('Authorization', alice.bearer);

    // Bob's baby, asked for through Bob's family, by Alice: membership misses.
    const throughTheirFamily = await request(app)
      .get(`${babiesUrl(bob.familyId)}/${bobsBaby}`)
      .set('Authorization', alice.bearer);

    for (const response of [throughOwnFamily, throughTheirFamily]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Bob baby');
    }
  });

  it('answers 404 for a baby that does not exist and for a malformed id', async () => {
    const parent = await withFamily();

    const missing = await request(app)
      .get(`${babiesUrl(parent.familyId)}/${new Types.ObjectId().toString()}`)
      .set('Authorization', parent.bearer);
    const malformed = await request(app)
      .get(`${babiesUrl(parent.familyId)}/not-an-object-id`)
      .set('Authorization', parent.bearer);

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(404);
    // Indistinguishable, so probing reveals nothing.
    expect(JSON.stringify(missing.body)).toBe(JSON.stringify(malformed.body));
  });
});

describe('PATCH /families/:familyId/babies/:babyId', () => {
  const patchBaby = (who: Signed, familyId: string, babyId: string, body: unknown) =>
    request(app)
      .patch(`${babiesUrl(familyId)}/${babyId}`)
      .set('Authorization', who.bearer)
      .send(body);

  async function withOneBaby() {
    const parent = await withFamily();
    const created = await addBaby(parent, parent.familyId, { name: 'Baby A' });
    expect(created.status).toBe(201);
    return { parent, babyId: created.body.baby.id as string };
  }

  it('fills in birth date, sex and gestational age', async () => {
    const { parent, babyId } = await withOneBaby();

    const response = await patchBaby(parent, parent.familyId, babyId, {
      birthDate: '2026-06-01',
      gender: 'MALE',
      gestationalAge: { weeks: 35, days: 4 },
    });

    expect(response.status).toBe(200);
    expect(response.body.baby).toMatchObject({
      name: 'Baby A',
      birthDate: '2026-06-01T00:00:00.000Z',
      gender: 'MALE',
      gestationalAge: { weeks: 35, days: 4 },
    });
  });

  it('clears optional facts with null and renames', async () => {
    const { parent, babyId } = await withOneBaby();
    await patchBaby(parent, parent.familyId, babyId, {
      gender: 'FEMALE',
      gestationalAge: { weeks: 36, days: 0 },
    });

    const response = await patchBaby(parent, parent.familyId, babyId, {
      name: 'Nare',
      gender: null,
      gestationalAge: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.baby.name).toBe('Nare');
    expect(response.body.baby.gender).toBeUndefined();
    expect(response.body.baby.gestationalAge).toBeUndefined();
  });

  it('rejects invalid patches', async () => {
    const { parent, babyId } = await withOneBaby();
    for (const body of [
      {},
      { name: '' },
      { name: null },
      { gestationalAge: { weeks: 45, days: 0 } },
      { gestationalAge: { weeks: 35 } },
    ]) {
      expect(
        (await patchBaby(parent, parent.familyId, babyId, body)).status,
        JSON.stringify(body),
      ).toBe(422);
    }
  });

  it('answers 404 for another family’s baby and does not change it', async () => {
    const { parent: owner, babyId } = await withOneBaby();
    const stranger = await withFamily();

    const viaOwnFamily = await patchBaby(stranger, stranger.familyId, babyId, { name: 'Stolen' });
    const viaTheirFamily = await patchBaby(stranger, owner.familyId, babyId, { name: 'Stolen' });

    expect(viaOwnFamily.status).toBe(404);
    expect(viaTheirFamily.status).toBe(404);
    expect((await Baby.findById(babyId))?.name).toBe('Baby A');
  });
});
