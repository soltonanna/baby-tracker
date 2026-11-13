import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { API_PREFIX, createApp } from '../../app.js';
import { HealthRecord } from '../../models/HealthRecord.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';

const app = createApp();
const healthUrl = (familyId: string, babyId: string): string =>
  `${API_PREFIX}/families/${familyId}/babies/${babyId}/health`;

interface Parent {
  bearer: string;
  userId: string;
  familyId: string;
  babyId: string;
}

let accountCounter = 0;

/** A signed-up parent with a family and one baby born on 2026-06-01. */
async function withBaby(): Promise<Parent> {
  accountCounter += 1;
  const registered = await request(app)
    .post(`${API_PREFIX}/auth/register`)
    .send({
      email: `health-${accountCounter}@example.com`,
      password: 'a-perfectly-ordinary-passphrase',
      displayName: `Parent ${accountCounter}`,
    });
  expect(registered.status).toBe(201);
  const bearer = `Bearer ${registered.body.accessToken as string}`;

  const family = await request(app)
    .post(`${API_PREFIX}/families`)
    .set('Authorization', bearer)
    .send({ name: 'Our Family' });
  const familyId = family.body.family.id as string;

  const baby = await request(app)
    .post(`${API_PREFIX}/families/${familyId}/babies`)
    .set('Authorization', bearer)
    .send({ name: 'Baby A', birthDate: '2026-06-01' });
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
  return response.body.baby.id as string;
}

const add = (parent: Parent, body: unknown, babyId = parent.babyId) =>
  request(app)
    .post(healthUrl(parent.familyId, babyId))
    .set('Authorization', parent.bearer)
    .send(body as object);

const list = (parent: Parent, query = '', babyId = parent.babyId) =>
  request(app)
    .get(`${healthUrl(parent.familyId, babyId)}${query}`)
    .set('Authorization', parent.bearer);

const patch = (parent: Parent, id: string, body: unknown, babyId = parent.babyId) =>
  request(app)
    .patch(`${healthUrl(parent.familyId, babyId)}/${id}`)
    .set('Authorization', parent.bearer)
    .send(body as object);

const remove = (parent: Parent, id: string, babyId = parent.babyId) =>
  request(app)
    .delete(`${healthUrl(parent.familyId, babyId)}/${id}`)
    .set('Authorization', parent.bearer);

const vaccine = {
  category: 'vaccination',
  occurredAt: '2026-06-01T06:00:00.000Z',
  name: 'Hepatitis B, birth dose',
};

async function existing(parent: Parent, body: Record<string, unknown> = {}): Promise<string> {
  const response = await add(parent, { ...vaccine, ...body });
  expect(response.status).toBe(201);
  return response.body.record.id as string;
}

beforeEach(() => {
  accountCounter = 0;
  resetAuthRateLimits();
});

describe('POST .../health', () => {
  it('stores a full vaccination and reports back what was typed', async () => {
    const parent = await withBaby();

    const response = await add(parent, {
      ...vaccine,
      purpose: '  Protection against hepatitis B  ',
      doseValue: 0.5,
      doseUnit: 'ml',
      productName: 'Product X',
      manufacturer: 'Maker Y',
      provider: 'Maternity hospital 2',
      note: 'No reaction',
      nextDueOn: '2026-07-13',
      scheduleKey: 'hepb-birth',
      catalogVersion: '2026.1',
    });

    expect(response.status).toBe(201);
    expect(response.body.record).toMatchObject({
      familyId: parent.familyId,
      babyId: parent.babyId,
      category: 'vaccination',
      occurredAt: '2026-06-01T06:00:00.000Z',
      purpose: 'Protection against hepatitis B',
      doseValue: 0.5,
      doseUnit: 'ml',
      nextDueOn: '2026-07-13',
      scheduleKey: 'hepb-birth',
      catalogVersion: '2026.1',
    });
    const stored = await HealthRecord.findById(response.body.record.id as string);
    expect(stored?.createdBy.toString()).toBe(parent.userId);
    expect(stored?.nextDueOn?.toISOString()).toBe('2026-07-13T00:00:00.000Z');
  });

  it('accepts the minimum: category, instant and name', async () => {
    const parent = await withBaby();
    const response = await add(parent, {
      category: 'checkup',
      occurredAt: '2026-06-20T09:00:00.000Z',
      name: 'One-month checkup',
    });
    expect(response.status).toBe(201);
  });

  it('keeps an unknown schedule key as written — the catalog may change later', async () => {
    const parent = await withBaby();
    const response = await add(parent, {
      ...vaccine,
      scheduleKey: 'a-dose-from-another-edition',
      catalogVersion: '1999.9',
    });
    expect(response.status).toBe(201);
    expect(response.body.record.scheduleKey).toBe('a-dose-from-another-edition');
  });

  it('answers 400 for invalid input', async () => {
    const parent = await withBaby();
    for (const bad of [
      { ...vaccine, name: '' },
      { ...vaccine, category: 'surgery' },
      { ...vaccine, doseValue: 5 },
      { ...vaccine, category: 'checkup', scheduleKey: 'hexa-1' },
      { ...vaccine, nextDueOn: '2026-05-01' },
      { ...vaccine, occurredAt: 'not a date' },
    ]) {
      const response = await add(parent, bad);
      expect(response.status).toBe(422);
    }
  });

  it('refuses a future date and a date before the baby was born', async () => {
    const parent = await withBaby();
    const future = await add(parent, {
      ...vaccine,
      occurredAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    expect(future.status).toBe(422);
    const early = await add(parent, { ...vaccine, occurredAt: '2026-05-01T06:00:00.000Z' });
    expect(early.status).toBe(422);
  });

  it('ignores a familyId, babyId or createdBy in the body', async () => {
    const parent = await withBaby();
    const sibling = await addSibling(parent);
    const response = await add(parent, {
      ...vaccine,
      babyId: sibling,
      familyId: '000000000000000000000000',
      createdBy: '000000000000000000000000',
    });
    expect(response.status).toBe(201);
    expect(response.body.record.babyId).toBe(parent.babyId);
    expect(response.body.record.familyId).toBe(parent.familyId);
  });

  it('requires authentication', async () => {
    const parent = await withBaby();
    const response = await request(app)
      .post(healthUrl(parent.familyId, parent.babyId))
      .send(vaccine);
    expect(response.status).toBe(401);
  });
});

describe('GET .../health', () => {
  it('lists newest first', async () => {
    const parent = await withBaby();
    await existing(parent, { name: 'First', occurredAt: '2026-06-02T06:00:00.000Z' });
    await existing(parent, { name: 'Third', occurredAt: '2026-06-20T06:00:00.000Z' });
    await existing(parent, { name: 'Second', occurredAt: '2026-06-10T06:00:00.000Z' });

    const response = await list(parent);

    expect(response.status).toBe(200);
    expect(response.body.records.map((r: { name: string }) => r.name)).toEqual([
      'Third',
      'Second',
      'First',
    ]);
  });

  it('filters by category and by inclusive date range', async () => {
    const parent = await withBaby();
    await existing(parent, { name: 'Vaccine', occurredAt: '2026-06-02T06:00:00.000Z' });
    await existing(parent, {
      category: 'lab_test',
      name: 'Blood test',
      occurredAt: '2026-06-10T23:30:00.000Z',
    });
    await existing(parent, {
      category: 'checkup',
      name: 'Checkup',
      occurredAt: '2026-06-20T06:00:00.000Z',
    });

    const labs = await list(parent, '?category=lab_test');
    expect(labs.body.records.map((r: { name: string }) => r.name)).toEqual(['Blood test']);

    const range = await list(parent, '?from=2026-06-10&to=2026-06-10');
    expect(range.body.records.map((r: { name: string }) => r.name)).toEqual(['Blood test']);

    const both = await list(parent, '?category=checkup&from=2026-06-01&to=2026-06-30');
    expect(both.body.records).toHaveLength(1);
  });

  it('answers 400 for an unknown category or an inverted range', async () => {
    const parent = await withBaby();
    expect((await list(parent, '?category=nope')).status).toBe(422);
    expect((await list(parent, '?from=2026-07-01&to=2026-06-01')).status).toBe(422);
  });

  it('keeps each baby’s history separate', async () => {
    const parent = await withBaby();
    const sibling = await addSibling(parent);
    await existing(parent);

    expect((await list(parent)).body.records).toHaveLength(1);
    expect((await list(parent, '', sibling)).body.records).toHaveLength(0);
  });

  it('does not list deleted records', async () => {
    const parent = await withBaby();
    const id = await existing(parent);
    expect((await remove(parent, id)).status).toBe(204);
    expect((await list(parent)).body.records).toEqual([]);
    // Soft delete: the row stays.
    expect(await HealthRecord.countDocuments({ _id: id })).toBe(1);
  });
});

describe('PATCH .../health/:id', () => {
  it('changes fields, removes one with null and records who edited', async () => {
    const parent = await withBaby();
    const id = await existing(parent, { note: 'old', doseValue: 0.5, doseUnit: 'ml' });

    const response = await patch(parent, id, {
      name: 'Hepatitis B, dose 1',
      note: null,
      doseValue: null,
      doseUnit: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.record.name).toBe('Hepatitis B, dose 1');
    expect(response.body.record.note).toBeUndefined();
    expect(response.body.record.doseValue).toBeUndefined();
    const stored = await HealthRecord.findById(id);
    expect(stored?.updatedBy?.toString()).toBe(parent.userId);
  });

  it('judges the record as it would be after the patch', async () => {
    const parent = await withBaby();
    const id = await existing(parent, { scheduleKey: 'hepb-birth', catalogVersion: '2026.1' });

    // A lone dose value, and a category that cannot carry the schedule link.
    expect((await patch(parent, id, { doseValue: 2 })).status).toBe(422);
    expect((await patch(parent, id, { category: 'checkup' })).status).toBe(422);
    const ok = await patch(parent, id, {
      category: 'checkup',
      scheduleKey: null,
      catalogVersion: null,
    });
    expect(ok.status).toBe(200);
  });

  it('refuses an empty patch and an implausible date', async () => {
    const parent = await withBaby();
    const id = await existing(parent);
    expect((await patch(parent, id, {})).status).toBe(422);
    expect((await patch(parent, id, { occurredAt: '2026-01-01T00:00:00.000Z' })).status).toBe(422);
  });

  it('answers 404 for a malformed, unknown or deleted id', async () => {
    const parent = await withBaby();
    const id = await existing(parent);
    expect((await remove(parent, id)).status).toBe(204);
    for (const target of ['not-an-id', '000000000000000000000000', id]) {
      expect((await patch(parent, target, { note: 'x' })).status).toBe(404);
    }
  });
});

describe('DELETE .../health/:id', () => {
  it('soft-deletes, and a second delete is a 404', async () => {
    const parent = await withBaby();
    const id = await existing(parent);
    expect((await remove(parent, id)).status).toBe(204);
    expect((await remove(parent, id)).status).toBe(404);
    const stored = await HealthRecord.findById(id);
    expect(stored?.deletedAt).toBeInstanceOf(Date);
  });
});

describe('isolation', () => {
  it('hides another family’s baby and record behind 404, for every verb', async () => {
    const owner = await withBaby();
    const id = await existing(owner);
    const outsider = await withBaby();

    const url = healthUrl(owner.familyId, owner.babyId);
    const as = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
      request(app)[method](path).set('Authorization', outsider.bearer);

    expect((await as('get', url)).status).toBe(404);
    expect((await as('post', url).send(vaccine)).status).toBe(404);
    expect((await as('patch', `${url}/${id}`).send({ note: 'x' })).status).toBe(404);
    expect((await as('delete', `${url}/${id}`)).status).toBe(404);
    expect(await HealthRecord.countDocuments({ _id: id, deletedAt: null })).toBe(1);
  });

  it('does not reach a record through a sibling’s URL or through the outsider’s own family', async () => {
    const owner = await withBaby();
    const sibling = await addSibling(owner);
    const id = await existing(owner);
    const outsider = await withBaby();

    // Same family, wrong baby.
    expect((await patch(owner, id, { note: 'x' }, sibling)).status).toBe(404);
    expect((await remove(owner, id, sibling)).status).toBe(404);

    // The outsider's own family and baby, the owner's record id.
    const viaOwnFamily = await request(app)
      .patch(`${healthUrl(outsider.familyId, outsider.babyId)}/${id}`)
      .set('Authorization', outsider.bearer)
      .send({ note: 'x' });
    expect(viaOwnFamily.status).toBe(404);
  });
});
