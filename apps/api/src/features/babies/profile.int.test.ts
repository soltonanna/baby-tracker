import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { API_PREFIX, createApp } from '../../app.js';
import { Baby } from '../../models/Baby.js';
import { BabyEvent } from '../../models/BabyEvent.js';
import { FamilyMember } from '../../models/FamilyMember.js';
import { GrowthMeasurement } from '../../models/GrowthMeasurement.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';

/**
 * Child profiles: the optional profile fields, deleting a child, and the one
 * profile photo. Kept apart from babies.int.test.ts, which covers the
 * original create / read / edit behaviour and is unchanged.
 */

const app = createApp();
const babiesUrl = (familyId: string): string => `${API_PREFIX}/families/${familyId}/babies`;

interface Parent {
  bearer: string;
  userId: string;
  familyId: string;
}

let counter = 0;

async function withFamily(): Promise<Parent> {
  counter += 1;
  const registered = await request(app)
    .post(`${API_PREFIX}/auth/register`)
    .send({
      email: `profile-${counter}@example.com`,
      password: 'a-perfectly-ordinary-passphrase',
      displayName: `Parent ${counter}`,
    });
  expect(registered.status).toBe(201);
  const bearer = `Bearer ${registered.body.accessToken as string}`;
  const family = await request(app)
    .post(`${API_PREFIX}/families`)
    .set('Authorization', bearer)
    .send({ name: 'Our Family' });
  expect(family.status).toBe(201);
  return {
    bearer,
    userId: registered.body.user.id as string,
    familyId: family.body.family.id as string,
  };
}

async function addBaby(parent: Parent, body: object = { name: 'Mia' }): Promise<string> {
  const response = await request(app)
    .post(babiesUrl(parent.familyId))
    .set('Authorization', parent.bearer)
    .send(body);
  expect(response.status).toBe(201);
  return response.body.baby.id as string;
}

/** A parent who belongs to the owner's family without owning it. */
async function addMember(owner: Parent): Promise<Parent> {
  const member = await withFamily();
  await FamilyMember.create({
    familyId: owner.familyId,
    userId: member.userId,
    role: 'MEMBER',
  });
  return { ...member, familyId: owner.familyId };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const putPhoto = (parent: Parent, babyId: string, body: Buffer, type = 'image/jpeg') =>
  request(app)
    .put(`${babiesUrl(parent.familyId)}/${babyId}/photo`)
    .set('Authorization', parent.bearer)
    .set('Content-Type', type)
    .send(body);

const getPhoto = (parent: Parent, babyId: string) =>
  request(app)
    .get(`${babiesUrl(parent.familyId)}/${babyId}/photo`)
    .set('Authorization', parent.bearer)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        done(null, Buffer.concat(chunks));
      });
    });

beforeEach(() => {
  counter = 0;
  resetAuthRateLimits();
});

describe('profile fields', () => {
  it('creates and edits a full profile, and clears optional fields with null', async () => {
    const parent = await withFamily();
    const created = await request(app)
      .post(babiesUrl(parent.familyId))
      .set('Authorization', parent.bearer)
      .send({
        name: 'Mia',
        lastName: 'Sultanova',
        birthDate: '2026-09-01',
        birthTime: '07:45',
        birthWeightGrams: 3400,
        birthLengthMm: 510,
        notes: 'Born at home',
      });

    expect(created.status).toBe(201);
    expect(created.body.baby).toMatchObject({
      lastName: 'Sultanova',
      birthTime: '07:45',
      birthWeightGrams: 3400,
      birthLengthMm: 510,
      notes: 'Born at home',
    });
    expect(created.body.baby.hasPhoto).toBeUndefined();

    const url = `${babiesUrl(parent.familyId)}/${created.body.baby.id as string}`;
    const edited = await request(app)
      .patch(url)
      .set('Authorization', parent.bearer)
      .send({ lastName: null, birthWeightGrams: 3500, notes: null });
    expect(edited.status).toBe(200);
    expect(edited.body.baby.lastName).toBeUndefined();
    expect(edited.body.baby.notes).toBeUndefined();
    expect(edited.body.baby.birthWeightGrams).toBe(3500);
    expect(edited.body.baby.birthTime).toBe('07:45');
  });

  it('keeps a baby created with only a name valid, as before', async () => {
    const parent = await withFamily();
    const id = await addBaby(parent);
    const stored = await Baby.findById(id);
    expect(stored?.lastName).toBeUndefined();
    expect(stored?.birthWeightGrams).toBeUndefined();
  });

  it('rejects invalid profile values', async () => {
    const parent = await withFamily();
    const id = await addBaby(parent);
    for (const body of [
      { birthTime: '25:00' },
      { birthWeightGrams: 12 },
      { birthWeightGrams: 3400.5 },
      { birthLengthMm: 99999 },
      { notes: 'x'.repeat(2001) },
      { lastName: '' },
    ]) {
      const response = await request(app)
        .patch(`${babiesUrl(parent.familyId)}/${id}`)
        .set('Authorization', parent.bearer)
        .send(body);
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe('DELETE /families/:familyId/babies/:babyId', () => {
  it('removes the baby with its events and growth records, and only those', async () => {
    const parent = await withFamily();
    const doomed = await addBaby(parent, { name: 'Doomed' });
    const kept = await addBaby(parent, { name: 'Kept' });
    for (const babyId of [doomed, kept]) {
      await BabyEvent.create({
        familyId: parent.familyId,
        babyId,
        type: 'NOTE',
        startedAt: new Date(),
        details: 'hello',
        createdBy: parent.userId,
      });
      await GrowthMeasurement.create({
        familyId: parent.familyId,
        babyId,
        measuredOn: new Date('2026-10-01T00:00:00.000Z'),
        weightGrams: 4000,
        createdBy: parent.userId,
        // Soft-deleted rows must go too.
        deletedAt: babyId === doomed ? new Date() : null,
      });
    }

    const response = await request(app)
      .delete(`${babiesUrl(parent.familyId)}/${doomed}`)
      .set('Authorization', parent.bearer);

    expect(response.status).toBe(204);
    expect(await Baby.countDocuments({ _id: doomed })).toBe(0);
    expect(await BabyEvent.countDocuments({ babyId: doomed })).toBe(0);
    expect(await GrowthMeasurement.countDocuments({ babyId: doomed })).toBe(0);
    expect(await Baby.countDocuments({ _id: kept })).toBe(1);
    expect(await BabyEvent.countDocuments({ babyId: kept })).toBe(1);
    expect(await GrowthMeasurement.countDocuments({ babyId: kept })).toBe(1);
  });

  it('answers 404 for another family’s baby and a malformed id, deleting nothing', async () => {
    const owner = await withFamily();
    const babyId = await addBaby(owner);
    const stranger = await withFamily();

    for (const [who, family, id] of [
      [stranger, stranger.familyId, babyId],
      [stranger, owner.familyId, babyId],
      [owner, owner.familyId, 'nope'],
      [owner, owner.familyId, new Types.ObjectId().toString()],
    ] as const) {
      const response = await request(app)
        .delete(`${babiesUrl(family)}/${id}`)
        .set('Authorization', who.bearer);
      expect(response.status, `${family}/${id}`).toBe(404);
    }
    expect(await Baby.countDocuments({ _id: babyId })).toBe(1);
  });

  it('is for the owner: a member gets 403 and the baby stays', async () => {
    const owner = await withFamily();
    const babyId = await addBaby(owner);
    const member = await addMember(owner);

    const response = await request(app)
      .delete(`${babiesUrl(owner.familyId)}/${babyId}`)
      .set('Authorization', member.bearer);

    expect(response.status).toBe(403);
    expect(await Baby.countDocuments({ _id: babyId })).toBe(1);
  });

  it('needs a signed-in caller', async () => {
    const owner = await withFamily();
    const babyId = await addBaby(owner);
    const response = await request(app).delete(`${babiesUrl(owner.familyId)}/${babyId}`);
    expect(response.status).toBe(401);
  });
});

describe('profile photo', () => {
  it('stores, serves, replaces and removes the one photo', async () => {
    const parent = await withFamily();
    const babyId = await addBaby(parent);

    const stored = await putPhoto(parent, babyId, JPEG);
    expect(stored.status).toBe(200);
    expect(stored.body.baby.hasPhoto).toBe(true);
    expect(stored.body.baby.photoUpdatedAt).toBeTypeOf('string');
    expect(JSON.stringify(stored.body)).not.toContain('"photo"');

    const served = await getPhoto(parent, babyId);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toContain('private');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(served.body as Buffer, JPEG)).toBe(0);

    const replaced = await putPhoto(parent, babyId, PNG, 'image/png');
    expect(replaced.status).toBe(200);
    expect((await getPhoto(parent, babyId)).headers['content-type']).toBe('image/png');
    expect(await Baby.countDocuments({ familyId: parent.familyId })).toBe(1);

    const removed = await request(app)
      .delete(`${babiesUrl(parent.familyId)}/${babyId}/photo`)
      .set('Authorization', parent.bearer);
    expect(removed.status).toBe(200);
    expect(removed.body.baby.hasPhoto).toBeUndefined();
    expect((await getPhoto(parent, babyId)).status).toBe(404);
  });

  it('never includes the image in list or single-baby responses', async () => {
    const parent = await withFamily();
    const babyId = await addBaby(parent);
    await putPhoto(parent, babyId, JPEG);

    const list = await request(app)
      .get(babiesUrl(parent.familyId))
      .set('Authorization', parent.bearer);
    expect(list.body.babies[0].hasPhoto).toBe(true);
    expect(list.body.babies[0].photo).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain('/9j/');
  });

  it('rejects a body that is not really an image, whatever the header says', async () => {
    const parent = await withFamily();
    const babyId = await addBaby(parent);

    const fake = await putPhoto(parent, babyId, Buffer.from('<svg onload="x()"/>'), 'image/jpeg');
    expect(fake.status).toBe(422);
    const wrongType = await putPhoto(parent, babyId, JPEG, 'image/svg+xml');
    expect(wrongType.status).toBe(415);
    const json = await putPhoto(parent, babyId, Buffer.from('{}'), 'application/json');
    expect(json.status).toBe(415);
    expect((await Baby.findById(babyId))?.photoUpdatedAt).toBeUndefined();
  });

  it('rejects an image over the size cap', async () => {
    const parent = await withFamily();
    const babyId = await addBaby(parent);
    const big = Buffer.concat([JPEG, Buffer.alloc(512 * 1024)]);

    const response = await putPhoto(parent, babyId, big);
    expect(response.status).toBe(413);
  });

  it('answers 404 across families and for a baby with no photo', async () => {
    const owner = await withFamily();
    const babyId = await addBaby(owner);
    await putPhoto(owner, babyId, JPEG);
    const stranger = await withFamily();

    expect((await getPhoto(stranger, babyId)).status).toBe(404);
    expect((await putPhoto(stranger, babyId, PNG, 'image/png')).status).toBe(404);
    const viaTheirFamily = await request(app)
      .get(`${babiesUrl(owner.familyId)}/${babyId}/photo`)
      .set('Authorization', stranger.bearer);
    expect(viaTheirFamily.status).toBe(404);

    const other = await addBaby(owner, { name: 'No photo' });
    expect((await getPhoto(owner, other)).status).toBe(404);
    // The owner's photo is untouched by the stranger's attempts.
    expect(((await getPhoto(owner, babyId)).body as Buffer).length).toBe(JPEG.length);
  });

  it('lets any member set a photo, like any other profile edit, and needs sign-in', async () => {
    const owner = await withFamily();
    const babyId = await addBaby(owner);
    const member = await addMember(owner);

    expect((await putPhoto(member, babyId, JPEG)).status).toBe(200);
    const anonymous = await request(app).get(`${babiesUrl(owner.familyId)}/${babyId}/photo`);
    expect(anonymous.status).toBe(401);
  });
});
