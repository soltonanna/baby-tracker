import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { API_PREFIX, createApp } from '../../app.js';
import { Baby } from '../../models/Baby.js';
import { BabyEvent } from '../../models/BabyEvent.js';
import { Family } from '../../models/Family.js';
import { FamilyMember } from '../../models/FamilyMember.js';
import { GrowthMeasurement } from '../../models/GrowthMeasurement.js';
import { User } from '../../models/User.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';

const app = createApp();
const dataUrl = (familyId: string): string => `${API_PREFIX}/families/${familyId}/data`;

interface Parent {
  bearer: string;
  userId: string;
  familyId: string;
}

let accountCounter = 0;

async function register(): Promise<{ bearer: string; userId: string }> {
  accountCounter += 1;
  const registered = await request(app)
    .post(`${API_PREFIX}/auth/register`)
    .send({
      email: `data-${accountCounter}@example.com`,
      password: 'a-perfectly-ordinary-passphrase',
      displayName: `Parent ${accountCounter}`,
    });
  expect(registered.status).toBe(201);
  return {
    bearer: `Bearer ${registered.body.accessToken as string}`,
    userId: registered.body.user.id as string,
  };
}

async function withFamily(): Promise<Parent> {
  const { bearer, userId } = await register();
  const family = await request(app)
    .post(`${API_PREFIX}/families`)
    .set('Authorization', bearer)
    .send({ name: 'Our Family' });
  expect(family.status).toBe(201);
  return { bearer, userId, familyId: family.body.family.id as string };
}

/** Twins with one event each, one grouped pair, and a growth row each. */
async function withTwinsAndData(parent: Parent): Promise<{ boyId: string; girlId: string }> {
  const babies = `${API_PREFIX}/families/${parent.familyId}/babies`;
  const boy = await request(app)
    .post(babies)
    .set('Authorization', parent.bearer)
    .send({ name: 'Boy', birthDate: '2026-04-01', gender: 'MALE' });
  const girl = await request(app)
    .post(babies)
    .set('Authorization', parent.bearer)
    .send({ name: 'Girl', birthDate: '2026-04-01', gender: 'FEMALE' });
  const boyId = boy.body.baby.id as string;
  const girlId = girl.body.baby.id as string;

  await request(app)
    .post(`${babies}/${boyId}/events`)
    .set('Authorization', parent.bearer)
    .send({ type: 'FEEDING', startedAt: '2026-05-01T08:00:00.000Z', amount: 90, unit: 'ml' })
    .expect(201);
  await request(app)
    .post(`${API_PREFIX}/families/${parent.familyId}/event-groups`)
    .set('Authorization', parent.bearer)
    .send({ type: 'NOTE', startedAt: '2026-05-01T10:00:00.000Z', details: 'Bath' })
    .expect(201);
  await request(app)
    .post(`${babies}/${girlId}/growth`)
    .set('Authorization', parent.bearer)
    .send({ measuredOn: '2026-05-01', weightGrams: 3400 })
    .expect(201);

  return { boyId, girlId };
}

const exportData = (parent: Parent) =>
  request(app)
    .get(`${dataUrl(parent.familyId)}/export`)
    .set('Authorization', parent.bearer);

const importData = (parent: Parent, body: unknown) =>
  request(app)
    .post(`${dataUrl(parent.familyId)}/import`)
    .set('Authorization', parent.bearer)
    .send(body as object);

const clearData = (parent: Parent) =>
  request(app).delete(dataUrl(parent.familyId)).set('Authorization', parent.bearer);

const testFile = (overrides: Record<string, unknown> = {}) => ({
  format: 'baby-tracker/family-data',
  version: 1,
  babies: [
    { id: 'boy', name: 'Test Boy', birthDate: '2026-04-01', gender: 'MALE' },
    { id: 'girl', name: 'Test Girl', birthDate: '2026-04-01', gender: 'FEMALE' },
  ],
  events: [
    {
      babyId: 'boy',
      type: 'SLEEP',
      startedAt: '2026-04-02T20:00:00.000Z',
      endedAt: '2026-04-02T23:00:00.000Z',
      createdAt: '2026-04-02T23:01:00.000Z',
    },
    { babyId: 'girl', type: 'DIAPER', startedAt: '2026-04-02T21:00:00.000Z', details: 'wet' },
  ],
  measurements: [{ babyId: 'girl', measuredOn: '2026-04-15', weightGrams: 2900, lengthMm: 470 }],
  ...overrides,
});

beforeEach(() => {
  accountCounter = 0;
  resetAuthRateLimits();
});

describe('GET .../data/export', () => {
  it('returns every baby, event and live measurement of the family as a download', async () => {
    const parent = await withFamily();
    const { boyId, girlId } = await withTwinsAndData(parent);

    const response = await exportData(parent);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/attachment; filename="baby-tracker-/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ format: 'baby-tracker/family-data', version: 1 });
    expect(response.body.babies.map((b: { id: string }) => b.id)).toEqual([boyId, girlId]);
    expect(response.body.events).toHaveLength(3);
    expect(response.body.measurements).toEqual([
      expect.objectContaining({ babyId: girlId, measuredOn: '2026-05-01', weightGrams: 3400 }),
    ]);
    // Nothing from the account side leaks into the file.
    expect(JSON.stringify(response.body)).not.toContain(parent.userId);
  });

  it('leaves soft-deleted measurements out', async () => {
    const parent = await withFamily();
    await withTwinsAndData(parent);
    await GrowthMeasurement.updateMany({}, { $set: { deletedAt: new Date() } });

    const response = await exportData(parent);

    expect(response.body.measurements).toEqual([]);
  });

  it('answers 404 for a family the caller does not belong to', async () => {
    const owner = await withFamily();
    const stranger = await withFamily();

    const response = await exportData({ ...stranger, familyId: owner.familyId });

    expect(response.status).toBe(404);
  });

  it('requires authentication', async () => {
    const parent = await withFamily();
    const response = await request(app).get(`${dataUrl(parent.familyId)}/export`);
    expect(response.status).toBe(401);
  });
});

describe('POST .../data/import', () => {
  it('replaces the children’s data and keeps the account', async () => {
    const parent = await withFamily();
    await withTwinsAndData(parent);

    const response = await importData(parent, testFile());

    expect(response.status).toBe(200);
    expect(response.body.imported).toEqual({ babies: 2, events: 2, measurements: 1 });

    const babies = await Baby.find({ familyId: parent.familyId }).sort({ createdAt: 1 });
    expect(babies.map((b) => b.name)).toEqual(['Test Boy', 'Test Girl']);
    expect(await BabyEvent.countDocuments({ familyId: parent.familyId })).toBe(2);
    const measurement = await GrowthMeasurement.findOne({ familyId: parent.familyId });
    expect(measurement?.babyId.toString()).toBe(babies[1]?._id.toString());
    expect(measurement?.createdBy.toString()).toBe(parent.userId);

    expect(await User.countDocuments({ _id: parent.userId })).toBe(1);
    expect(await Family.countDocuments({ _id: parent.familyId })).toBe(1);
    expect(await FamilyMember.countDocuments({ familyId: parent.familyId })).toBe(1);
  });

  it('keeps timestamps from the file', async () => {
    const parent = await withFamily();

    await importData(parent, testFile()).expect(200);

    const sleep = await BabyEvent.findOne({ familyId: parent.familyId, type: 'SLEEP' });
    expect(sleep?.createdAt.toISOString()).toBe('2026-04-02T23:01:00.000Z');
  });

  it('round-trips an export', async () => {
    const parent = await withFamily();
    await withTwinsAndData(parent);
    const exported = (await exportData(parent)).body;

    await importData(parent, exported).expect(200);
    const again = (await exportData(parent)).body;

    const strip = (file: typeof exported) => ({
      events: file.events.map(({ babyId: _b, ...rest }: { babyId: string }) => rest),
      measurements: file.measurements.map(({ babyId: _b, ...rest }: { babyId: string }) => rest),
      babies: file.babies.map(({ id: _i, ...rest }: { id: string }) => rest),
    });
    expect(strip(again)).toEqual(strip(exported));
  });

  it('importing the same file twice does not duplicate anything', async () => {
    const parent = await withFamily();

    await importData(parent, testFile()).expect(200);
    await importData(parent, testFile()).expect(200);

    expect(await Baby.countDocuments({ familyId: parent.familyId })).toBe(2);
    expect(await BabyEvent.countDocuments({ familyId: parent.familyId })).toBe(2);
  });

  it('never touches another family', async () => {
    const parent = await withFamily();
    const neighbour = await withFamily();
    await withTwinsAndData(neighbour);

    await importData(parent, testFile()).expect(200);

    expect(await Baby.countDocuments({ familyId: neighbour.familyId })).toBe(2);
    expect(await BabyEvent.countDocuments({ familyId: neighbour.familyId })).toBe(3);
  });

  it('rejects a file with an unknown baby reference and changes nothing', async () => {
    const parent = await withFamily();
    await withTwinsAndData(parent);

    const response = await importData(
      parent,
      testFile({ events: [{ babyId: 'nobody', type: 'NOTE', startedAt: '2026-04-02T21:00:00Z' }] }),
    );

    expect(response.status).toBe(422);
    expect(await Baby.countDocuments({ familyId: parent.familyId })).toBe(2);
    expect(await BabyEvent.countDocuments({ familyId: parent.familyId })).toBe(3);
  });

  it.each([
    ['a wrong format', { format: 'something-else' }],
    ['an unknown version', { version: 2 }],
    [
      'an out-of-range weight',
      { measurements: [{ babyId: 'boy', measuredOn: '2026-04-15', weightGrams: 35_000 }] },
    ],
    [
      'duplicate baby ids',
      {
        babies: [
          { id: 'x', name: 'A' },
          { id: 'x', name: 'B' },
        ],
        events: [],
        measurements: [],
      },
    ],
  ])('rejects %s with 422', async (_label, overrides) => {
    const parent = await withFamily();
    const response = await importData(parent, testFile(overrides));
    expect(response.status).toBe(422);
  });

  it('accepts a body larger than the app-wide 1 MB limit', async () => {
    const parent = await withFamily();
    const events = Array.from({ length: 12_000 }, (_unused, index) => ({
      babyId: index % 2 === 0 ? 'boy' : 'girl',
      type: 'NOTE',
      startedAt: new Date(Date.UTC(2026, 3, 2) + index * 60_000).toISOString(),
      details: 'A note long enough to make the body large',
    }));

    const response = await importData(parent, testFile({ events }));

    expect(response.status).toBe(200);
    expect(response.body.imported.events).toBe(12_000);
  });

  it('is refused to a member who is not the owner', async () => {
    const owner = await withFamily();
    const member = await register();
    await FamilyMember.create({ familyId: owner.familyId, userId: member.userId, role: 'MEMBER' });

    const response = await importData({ ...member, familyId: owner.familyId }, testFile());

    expect(response.status).toBe(403);
  });
});

describe('DELETE .../data', () => {
  it('removes babies, events and growth but keeps the user, family and membership', async () => {
    const parent = await withFamily();
    await withTwinsAndData(parent);

    const response = await clearData(parent);

    expect(response.status).toBe(200);
    expect(response.body.deleted).toEqual({ babies: 2, events: 3, measurements: 1 });
    expect(await Baby.countDocuments({ familyId: parent.familyId })).toBe(0);
    expect(await BabyEvent.countDocuments({ familyId: parent.familyId })).toBe(0);
    expect(await GrowthMeasurement.countDocuments({ familyId: parent.familyId })).toBe(0);
    expect(await Family.countDocuments({ _id: parent.familyId })).toBe(1);
    expect(await FamilyMember.countDocuments({ familyId: parent.familyId })).toBe(1);

    // Still signed in: the same token keeps working.
    const families = await request(app)
      .get(`${API_PREFIX}/families`)
      .set('Authorization', parent.bearer);
    expect(families.status).toBe(200);
  });

  it('never touches another family', async () => {
    const parent = await withFamily();
    const neighbour = await withFamily();
    await withTwinsAndData(neighbour);

    await clearData(parent).expect(200);

    expect(await Baby.countDocuments({ familyId: neighbour.familyId })).toBe(2);
  });

  it('is refused to a member who is not the owner', async () => {
    const owner = await withFamily();
    await withTwinsAndData(owner);
    const member = await register();
    await FamilyMember.create({ familyId: owner.familyId, userId: member.userId, role: 'MEMBER' });

    const response = await clearData({ ...member, familyId: owner.familyId });

    expect(response.status).toBe(403);
    expect(await Baby.countDocuments({ familyId: owner.familyId })).toBe(2);
  });

  it('answers 404 for a family the caller does not belong to', async () => {
    const owner = await withFamily();
    const stranger = await withFamily();

    const response = await clearData({ ...stranger, familyId: owner.familyId });

    expect(response.status).toBe(404);
  });
});
