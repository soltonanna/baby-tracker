import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { API_PREFIX, createApp } from '../../app.js';
import { BabyEvent } from '../../models/BabyEvent.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';

const app = createApp();
const authUrl = (path: string): string => `${API_PREFIX}/auth${path}`;
const eventsUrl = (familyId: string, babyId: string): string =>
  `${API_PREFIX}/families/${familyId}/babies/${babyId}/events`;

interface Parent {
  bearer: string;
  familyId: string;
  babyId: string;
}

let accountCounter = 0;

/** A signed-up parent with a family and one baby of their own. */
async function withBaby(babyName = 'Baby A'): Promise<Parent> {
  accountCounter += 1;
  const registered = await request(app)
    .post(authUrl('/register'))
    .send({
      email: `parent-${accountCounter}@example.com`,
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
    .send({ name: babyName });
  expect(baby.status).toBe(201);

  return { bearer, familyId, babyId: baby.body.baby.id as string };
}

/** A second baby in the same family — the twins case. */
async function addSibling(parent: Parent, name: string): Promise<string> {
  const response = await request(app)
    .post(`${API_PREFIX}/families/${parent.familyId}/babies`)
    .set('Authorization', parent.bearer)
    .send({ name });
  expect(response.status).toBe(201);
  return response.body.baby.id as string;
}

const addEvent = (parent: Parent, body: unknown, babyId = parent.babyId) =>
  request(app)
    .post(eventsUrl(parent.familyId, babyId))
    .set('Authorization', parent.bearer)
    .send(body);

beforeEach(() => {
  accountCounter = 0;
  resetAuthRateLimits();
});

describe('POST .../events', () => {
  it('creates a FEEDING with every field it was given', async () => {
    const parent = await withBaby();

    const response = await addEvent(parent, {
      type: 'FEEDING',
      startedAt: '2026-09-04T08:00:00.000Z',
      endedAt: '2026-09-04T08:20:00.000Z',
      amount: 120,
      unit: 'ml',
      details: 'Took most of the bottle',
    });

    expect(response.status).toBe(201);
    expect(response.body.event).toMatchObject({
      familyId: parent.familyId,
      babyId: parent.babyId,
      type: 'FEEDING',
      startedAt: '2026-09-04T08:00:00.000Z',
      endedAt: '2026-09-04T08:20:00.000Z',
      amount: 120,
      unit: 'ml',
      details: 'Took most of the bottle',
    });
    expect(response.body.event.id).toMatch(/^[0-9a-f]{24}$/);
    expect(Date.parse(response.body.event.createdAt)).not.toBeNaN();

    const stored = await BabyEvent.findById(response.body.event.id as string);
    expect(stored?.babyId.toString()).toBe(parent.babyId);
  });

  it('creates SLEEP, DIAPER and NOTE, each with only what it needs', async () => {
    const parent = await withBaby();

    const sleep = await addEvent(parent, {
      type: 'SLEEP',
      startedAt: '2026-09-04T13:00:00.000Z',
      endedAt: '2026-09-04T14:10:00.000Z',
    });
    expect(sleep.status).toBe(201);
    expect(sleep.body.event).toMatchObject({ type: 'SLEEP' });
    expect(sleep.body.event.amount).toBeUndefined();

    const diaper = await addEvent(parent, {
      type: 'DIAPER',
      startedAt: '2026-09-04T09:30:00.000Z',
      details: 'wet',
    });
    expect(diaper.status).toBe(201);
    expect(diaper.body.event).toMatchObject({ type: 'DIAPER', details: 'wet' });
    expect(diaper.body.event.endedAt).toBeUndefined();

    const note = await addEvent(parent, {
      type: 'NOTE',
      startedAt: '2026-09-04T18:00:00.000Z',
      details: 'Smiled at the mobile',
    });
    expect(note.status).toBe(201);
    expect(note.body.event).toMatchObject({ type: 'NOTE' });
  });

  it('accepts an event with nothing optional at all', async () => {
    const parent = await withBaby();

    const response = await addEvent(parent, {
      type: 'NOTE',
      startedAt: '2026-09-04T18:00:00.000Z',
    });

    expect(response.status).toBe(201);
    for (const field of ['endedAt', 'amount', 'unit', 'details', 'groupId']) {
      expect(response.body.event[field], field).toBeUndefined();
    }
  });

  it('stores and returns a groupId', async () => {
    const parent = await withBaby();

    const created = await addEvent(parent, {
      type: 'FEEDING',
      startedAt: '2026-09-04T08:00:00.000Z',
      groupId: 'action-123',
    });
    expect(created.body.event.groupId).toBe('action-123');

    const fetched = await request(app)
      .get(`${eventsUrl(parent.familyId, parent.babyId)}/${created.body.event.id as string}`)
      .set('Authorization', parent.bearer);
    expect(fetched.body.event.groupId).toBe('action-123');
  });

  it('links one action across twins: same groupId, different babies', async () => {
    // The data-model half of the future "both babies" action. Two ordinary
    // documents, one shared groupId — no second model, and no endpoint yet.
    const parent = await withBaby('Twin A');
    const twinB = await addSibling(parent, 'Twin B');
    const groupId = new Types.ObjectId().toString();
    const startedAt = '2026-09-04T10:00:00.000Z';

    const first = await addEvent(parent, { type: 'FEEDING', startedAt, groupId });
    const second = await addEvent(parent, { type: 'FEEDING', startedAt, groupId }, twinB);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.event.groupId).toBe(groupId);
    expect(second.body.event.groupId).toBe(groupId);

    // Grouped, but still two separate babies' records.
    expect(first.body.event.babyId).toBe(parent.babyId);
    expect(second.body.event.babyId).toBe(twinB);
    expect(first.body.event.id).not.toBe(second.body.event.id);

    expect(await BabyEvent.countDocuments({ groupId })).toBe(2);
  });

  it('ignores familyId and babyId in the body', async () => {
    const parent = await withBaby();
    const elsewhere = await withBaby();

    const response = await addEvent(parent, {
      type: 'NOTE',
      startedAt: '2026-09-04T18:00:00.000Z',
      familyId: elsewhere.familyId,
      babyId: elsewhere.babyId,
    });

    expect(response.status).toBe(201);
    expect(response.body.event.familyId).toBe(parent.familyId);
    expect(response.body.event.babyId).toBe(parent.babyId);
    expect(await BabyEvent.countDocuments({ babyId: elsewhere.babyId })).toBe(0);
  });

  it('rejects invalid input', async () => {
    const parent = await withBaby();
    const startedAt = '2026-09-04T08:00:00.000Z';

    for (const body of [
      {},
      { type: 'FEEDING' },
      { type: 'SOMETHING_ELSE', startedAt },
      { type: 'FEEDING', startedAt: 'not-a-date' },
      { type: 'SLEEP', startedAt, endedAt: 'not-a-date' },
      { type: 'FEEDING', startedAt, amount: -1 },
      { type: 'FEEDING', startedAt, amount: 'lots' },
      { type: 'NOTE', startedAt, details: 'x'.repeat(1001) },
      { type: 'FEEDING', startedAt, unit: 'x'.repeat(17) },
    ]) {
      const response = await addEvent(parent, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }

    expect(await BabyEvent.countDocuments()).toBe(0);
  });

  it('rejects an unauthenticated request', async () => {
    const parent = await withBaby();

    const response = await request(app)
      .post(eventsUrl(parent.familyId, parent.babyId))
      .send({ type: 'NOTE', startedAt: '2026-09-04T18:00:00.000Z' });

    expect(response.status).toBe(401);
    expect(await BabyEvent.countDocuments()).toBe(0);
  });
});

describe('GET .../events', () => {
  it('lists the baby’s events, newest first', async () => {
    const parent = await withBaby();
    await addEvent(parent, { type: 'NOTE', startedAt: '2026-09-04T08:00:00.000Z' });
    await addEvent(parent, { type: 'NOTE', startedAt: '2026-09-04T20:00:00.000Z' });
    await addEvent(parent, { type: 'NOTE', startedAt: '2026-09-04T14:00:00.000Z' });

    const response = await request(app)
      .get(eventsUrl(parent.familyId, parent.babyId))
      .set('Authorization', parent.bearer);

    expect(response.status).toBe(200);
    expect((response.body.events as { startedAt: string }[]).map((e) => e.startedAt)).toEqual([
      '2026-09-04T20:00:00.000Z',
      '2026-09-04T14:00:00.000Z',
      '2026-09-04T08:00:00.000Z',
    ]);
  });

  it('returns only the requested baby’s events, not a sibling’s', async () => {
    const parent = await withBaby('Twin A');
    const twinB = await addSibling(parent, 'Twin B');

    await addEvent(parent, { type: 'NOTE', startedAt: '2026-09-04T08:00:00.000Z', details: 'A' });
    await addEvent(
      parent,
      { type: 'NOTE', startedAt: '2026-09-04T09:00:00.000Z', details: 'B' },
      twinB,
    );

    const forA = await request(app)
      .get(eventsUrl(parent.familyId, parent.babyId))
      .set('Authorization', parent.bearer);

    expect(forA.body.events).toHaveLength(1);
    expect(forA.body.events[0].details).toBe('A');
  });

  it('honours a limit, and defaults to the most recent', async () => {
    const parent = await withBaby();
    for (const hour of ['08', '09', '10']) {
      await addEvent(parent, { type: 'NOTE', startedAt: `2026-09-04T${hour}:00:00.000Z` });
    }

    const limited = await request(app)
      .get(`${eventsUrl(parent.familyId, parent.babyId)}?limit=2`)
      .set('Authorization', parent.bearer);
    expect(limited.body.events).toHaveLength(2);
    expect(limited.body.events[0].startedAt).toBe('2026-09-04T10:00:00.000Z');

    const all = await request(app)
      .get(eventsUrl(parent.familyId, parent.babyId))
      .set('Authorization', parent.bearer);
    expect(all.body.events).toHaveLength(3);

    const invalid = await request(app)
      .get(`${eventsUrl(parent.familyId, parent.babyId)}?limit=0`)
      .set('Authorization', parent.bearer);
    expect(invalid.status).toBe(422);
  });
});

describe('GET .../events/:eventId', () => {
  it('returns one event to a member of its family', async () => {
    const parent = await withBaby();
    const created = await addEvent(parent, {
      type: 'FEEDING',
      startedAt: '2026-09-04T08:00:00.000Z',
      amount: 90,
      unit: 'ml',
    });
    const eventId = created.body.event.id as string;

    const response = await request(app)
      .get(`${eventsUrl(parent.familyId, parent.babyId)}/${eventId}`)
      .set('Authorization', parent.bearer);

    expect(response.status).toBe(200);
    expect(response.body.event).toMatchObject({ id: eventId, amount: 90, unit: 'ml' });
  });

  it('answers 404 for a missing id and a malformed one, identically', async () => {
    const parent = await withBaby();

    const missing = await request(app)
      .get(`${eventsUrl(parent.familyId, parent.babyId)}/${new Types.ObjectId().toString()}`)
      .set('Authorization', parent.bearer);
    const malformed = await request(app)
      .get(`${eventsUrl(parent.familyId, parent.babyId)}/not-an-object-id`)
      .set('Authorization', parent.bearer);

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(JSON.stringify(missing.body)).toBe(JSON.stringify(malformed.body));
  });

  it('cannot be reached through a sibling’s URL', async () => {
    const parent = await withBaby('Twin A');
    const twinB = await addSibling(parent, 'Twin B');
    const forA = (await addEvent(parent, { type: 'NOTE', startedAt: '2026-09-04T08:00:00.000Z' }))
      .body.event.id as string;

    // Same family, same caller — but the event does not belong to this baby.
    const response = await request(app)
      .get(`${eventsUrl(parent.familyId, twinB)}/${forA}`)
      .set('Authorization', parent.bearer);

    expect(response.status).toBe(404);
  });
});

describe('cross-family access', () => {
  it('is refused every way the ids can be swapped', async () => {
    const alice = await withBaby();
    const bob = await withBaby();
    const bobsEvent = (
      await addEvent(bob, { type: 'NOTE', startedAt: '2026-09-04T08:00:00.000Z', details: 'Bob' })
    ).body.event.id as string;

    // Bob's family and baby, asked for by Alice: membership misses.
    const wholeChain = await request(app)
      .get(eventsUrl(bob.familyId, bob.babyId))
      .set('Authorization', alice.bearer);

    // Alice's own family, but Bob's baby id: the baby is not in her family.
    const foreignBaby = await request(app)
      .get(eventsUrl(alice.familyId, bob.babyId))
      .set('Authorization', alice.bearer);

    // Alice's own family and baby, but Bob's event id: the event is not this baby's.
    const foreignEvent = await request(app)
      .get(`${eventsUrl(alice.familyId, alice.babyId)}/${bobsEvent}`)
      .set('Authorization', alice.bearer);

    for (const response of [wholeChain, foreignBaby, foreignEvent]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Bob');
    }
  });

  it('refuses to write into another family’s baby', async () => {
    const alice = await withBaby();
    const bob = await withBaby();

    const response = await request(app)
      .post(eventsUrl(bob.familyId, bob.babyId))
      .set('Authorization', alice.bearer)
      .send({ type: 'NOTE', startedAt: '2026-09-04T08:00:00.000Z' });

    expect(response.status).toBe(404);
    expect(await BabyEvent.countDocuments()).toBe(0);
  });
});
