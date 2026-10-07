import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { API_PREFIX, createApp } from '../../app.js';
import { GrowthMeasurement } from '../../models/GrowthMeasurement.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';

const app = createApp();
const growthUrl = (familyId: string, babyId: string): string =>
  `${API_PREFIX}/families/${familyId}/babies/${babyId}/growth`;

interface Parent {
  bearer: string;
  userId: string;
  familyId: string;
  babyId: string;
}

let accountCounter = 0;

/** A signed-up parent with a family and one baby born on 2026-06-01. */
async function withBaby(birthDate: string | undefined = '2026-06-01'): Promise<Parent> {
  accountCounter += 1;
  const registered = await request(app)
    .post(`${API_PREFIX}/auth/register`)
    .send({
      email: `growth-${accountCounter}@example.com`,
      password: 'a-perfectly-ordinary-passphrase',
      displayName: `Parent ${accountCounter}`,
    });
  expect(registered.status).toBe(201);
  const bearer = `Bearer ${registered.body.accessToken as string}`;

  const family = await request(app)
    .post(`${API_PREFIX}/families`)
    .set('Authorization', bearer)
    .send({ name: 'Our Family' });
  expect(family.status).toBe(201);
  const familyId = family.body.family.id as string;

  const baby = await request(app)
    .post(`${API_PREFIX}/families/${familyId}/babies`)
    .set('Authorization', bearer)
    .send({ name: 'Baby A', ...(birthDate ? { birthDate } : {}) });
  expect(baby.status).toBe(201);

  return {
    bearer,
    userId: registered.body.user.id as string,
    familyId,
    babyId: baby.body.baby.id as string,
  };
}

async function addSibling(parent: Parent): Promise<string> {
  const response = await request(app)
    .post(`${API_PREFIX}/families/${parent.familyId}/babies`)
    .set('Authorization', parent.bearer)
    .send({ name: 'Baby B', birthDate: '2026-06-01' });
  expect(response.status).toBe(201);
  return response.body.baby.id as string;
}

const add = (parent: Parent, body: unknown, babyId = parent.babyId) =>
  request(app)
    .post(growthUrl(parent.familyId, babyId))
    .set('Authorization', parent.bearer)
    .send(body);

const list = (parent: Parent, babyId = parent.babyId) =>
  request(app).get(growthUrl(parent.familyId, babyId)).set('Authorization', parent.bearer);

const patch = (parent: Parent, id: string, body: unknown, babyId = parent.babyId) =>
  request(app)
    .patch(`${growthUrl(parent.familyId, babyId)}/${id}`)
    .set('Authorization', parent.bearer)
    .send(body);

const remove = (parent: Parent, id: string, babyId = parent.babyId) =>
  request(app)
    .delete(`${growthUrl(parent.familyId, babyId)}/${id}`)
    .set('Authorization', parent.bearer);

async function existing(parent: Parent, body: Record<string, unknown> = {}): Promise<string> {
  const response = await add(parent, { measuredOn: '2026-07-01', weightGrams: 4200, ...body });
  expect(response.status).toBe(201);
  return response.body.measurement.id as string;
}

beforeEach(() => {
  accountCounter = 0;
  resetAuthRateLimits();
});

describe('POST .../growth', () => {
  it('stores canonical values and the date as UTC midnight', async () => {
    const parent = await withBaby();

    const response = await add(parent, {
      measuredOn: '2026-07-01',
      weightGrams: 4210,
      lengthMm: 545,
      headCircumferenceMm: 372,
      source: 'DOCTOR',
      note: '  one-month check  ',
    });

    expect(response.status).toBe(201);
    expect(response.body.measurement).toMatchObject({
      familyId: parent.familyId,
      babyId: parent.babyId,
      measuredOn: '2026-07-01T00:00:00.000Z',
      weightGrams: 4210,
      lengthMm: 545,
      headCircumferenceMm: 372,
      source: 'DOCTOR',
      note: 'one-month check',
    });
    const stored = await GrowthMeasurement.findById(response.body.measurement.id as string);
    expect(stored?.createdBy.toString()).toBe(parent.userId);
    expect(stored?.deletedAt).toBeNull();
  });

  it('accepts a single measurement', async () => {
    const parent = await withBaby();
    const response = await add(parent, { measuredOn: '2026-07-01', headCircumferenceMm: 380 });
    expect(response.status).toBe(201);
    expect(response.body.measurement.weightGrams).toBeUndefined();
  });

  it('rejects invalid input', async () => {
    const parent = await withBaby();
    for (const body of [
      {},
      { measuredOn: '2026-07-01' },
      { measuredOn: '2026-07-01T10:00:00Z', weightGrams: 4000 },
      { measuredOn: '2026-07-01', weightGrams: 4.2 },
      { measuredOn: '2026-07-01', weightGrams: 42_000 },
      { measuredOn: '2026-07-01', lengthMm: 54 },
      { measuredOn: '2026-07-01', headCircumferenceMm: '380' },
      { measuredOn: '2026-07-01', weightGrams: 4000, source: 'NURSE' },
    ]) {
      const response = await add(parent, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    expect(await GrowthMeasurement.countDocuments()).toBe(0);
  });

  it('refuses a date before birth or in the future', async () => {
    const parent = await withBaby('2026-06-01');
    const beforeBirth = await add(parent, { measuredOn: '2026-05-31', weightGrams: 3000 });
    const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    const future = await add(parent, { measuredOn: nextYear, weightGrams: 3000 });

    expect(beforeBirth.status).toBe(422);
    expect(future.status).toBe(422);
    expect(await GrowthMeasurement.countDocuments()).toBe(0);
  });

  it('accepts any past date when the birth date is unknown', async () => {
    const parent = await withBaby(undefined);
    expect((await add(parent, { measuredOn: '2020-01-01', weightGrams: 3000 })).status).toBe(201);
  });

  it('ignores familyId and babyId in the body', async () => {
    const parent = await withBaby();
    const other = await withBaby();
    const response = await add(parent, {
      measuredOn: '2026-07-01',
      weightGrams: 4000,
      familyId: other.familyId,
      babyId: other.babyId,
    });
    expect(response.status).toBe(201);
    expect(response.body.measurement.babyId).toBe(parent.babyId);
    expect(await GrowthMeasurement.countDocuments({ babyId: other.babyId })).toBe(0);
  });

  it('rejects an unauthenticated request', async () => {
    const parent = await withBaby();
    const response = await request(app)
      .post(growthUrl(parent.familyId, parent.babyId))
      .send({ measuredOn: '2026-07-01', weightGrams: 4000 });
    expect(response.status).toBe(401);
  });
});

describe('GET .../growth', () => {
  it('lists oldest first, only this baby, never a twin’s', async () => {
    const parent = await withBaby();
    const twin = await addSibling(parent);
    await existing(parent, { measuredOn: '2026-08-01', weightGrams: 5000 });
    await existing(parent, { measuredOn: '2026-06-01', weightGrams: 3300 });
    await add(parent, { measuredOn: '2026-07-01', weightGrams: 3900 }, twin);

    const response = await list(parent);

    expect(response.status).toBe(200);
    expect(
      (response.body.measurements as { weightGrams: number }[]).map((m) => m.weightGrams),
    ).toEqual([3300, 5000]);
  });

  it('answers an empty list for a baby with no measurements', async () => {
    const parent = await withBaby();
    const response = await list(parent);
    expect(response.status).toBe(200);
    expect(response.body.measurements).toEqual([]);
  });
});

describe('PATCH .../growth/:id', () => {
  it('changes a value and clears another with null', async () => {
    const parent = await withBaby();
    const id = await existing(parent, { headCircumferenceMm: 545 });

    const response = await patch(parent, id, { lengthMm: 545, headCircumferenceMm: null });

    expect(response.status).toBe(200);
    expect(response.body.measurement.lengthMm).toBe(545);
    expect(response.body.measurement.headCircumferenceMm).toBeUndefined();
    const stored = await GrowthMeasurement.findById(id).lean();
    expect(stored).not.toHaveProperty('headCircumferenceMm');
    expect(stored?.updatedBy?.toString()).toBe(parent.userId);
  });

  it('refuses to leave a record with no measurement', async () => {
    const parent = await withBaby();
    const id = await existing(parent);
    const response = await patch(parent, id, { weightGrams: null });
    expect(response.status).toBe(422);
    expect((await GrowthMeasurement.findById(id))?.weightGrams).toBe(4200);
  });

  it('applies the date rules to an edit', async () => {
    const parent = await withBaby('2026-06-01');
    const id = await existing(parent);
    expect((await patch(parent, id, { measuredOn: '2026-05-01' })).status).toBe(422);
  });

  it('rejects an empty patch', async () => {
    const parent = await withBaby();
    const id = await existing(parent);
    expect((await patch(parent, id, {})).status).toBe(422);
  });
});

describe('DELETE .../growth/:id', () => {
  it('soft-deletes: hidden from the list and from edits, but kept', async () => {
    const parent = await withBaby();
    const id = await existing(parent);

    const response = await remove(parent, id);

    expect(response.status).toBe(204);
    expect((await list(parent)).body.measurements).toEqual([]);
    expect((await patch(parent, id, { weightGrams: 4300 })).status).toBe(404);
    expect((await remove(parent, id)).status).toBe(404);
    const stored = await GrowthMeasurement.findById(id);
    expect(stored?.deletedAt).toBeInstanceOf(Date);
  });
});

describe('access', () => {
  it('answers 404 for a missing, malformed, twin’s or foreign id alike', async () => {
    const alice = await withBaby();
    const twin = await addSibling(alice);
    const bob = await withBaby();
    const twinsMeasurement = (
      await add(alice, { measuredOn: '2026-07-01', weightGrams: 4000 }, twin)
    ).body.measurement.id as string;
    const bobsMeasurement = await existing(bob);

    for (const id of [
      new Types.ObjectId().toString(),
      'not-an-id',
      twinsMeasurement,
      bobsMeasurement,
    ]) {
      expect((await patch(alice, id, { weightGrams: 4100 })).status, id).toBe(404);
      expect((await remove(alice, id)).status, id).toBe(404);
    }
  });

  it('refuses another family’s baby for every verb', async () => {
    const alice = await withBaby();
    const bob = await withBaby();
    const bobsMeasurement = await existing(bob);

    const asAlice = { ...bob, bearer: alice.bearer };
    expect((await list(asAlice)).status).toBe(404);
    expect((await add(asAlice, { measuredOn: '2026-07-01', weightGrams: 4000 })).status).toBe(404);
    expect((await patch(asAlice, bobsMeasurement, { weightGrams: 1 })).status).toBe(404);
    expect((await remove(asAlice, bobsMeasurement)).status).toBe(404);
    expect(await GrowthMeasurement.countDocuments({ babyId: bob.babyId, deletedAt: null })).toBe(1);
  });
});
