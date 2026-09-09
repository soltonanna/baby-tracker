import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import {
  addLocalDays,
  durationSeconds,
  localDayRange,
  localDayStart,
  overlapSeconds,
  toLocalDate,
  volumeToMl,
} from '@baby-tracker/shared';
import { API_PREFIX, createApp } from '../../app.js';
import { BabyEvent } from '../../models/BabyEvent.js';
import { FamilyMember } from '../../models/FamilyMember.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';

const app = createApp();
const authUrl = (path: string): string => `${API_PREFIX}/auth${path}`;
const eventsUrl = (familyId: string, babyId: string): string =>
  `${API_PREFIX}/families/${familyId}/babies/${babyId}/events`;

interface Account {
  bearer: string;
  userId: string;
}

interface Parent extends Account {
  familyId: string;
  babyId: string;
}

let accountCounter = 0;

/** A fresh account, and the Authorization header that authenticates as them. */
async function signUp(): Promise<Account> {
  accountCounter += 1;
  const registered = await request(app)
    .post(authUrl('/register'))
    .send({
      email: `parent-${accountCounter}@example.com`,
      password: 'a-perfectly-ordinary-passphrase',
      displayName: `Parent ${accountCounter}`,
    });
  expect(registered.status).toBe(201);

  return {
    bearer: `Bearer ${registered.body.accessToken as string}`,
    userId: registered.body.user.id as string,
  };
}

/** A signed-up parent with a family and one baby of their own. */
async function withBaby(babyName = 'Baby A'): Promise<Parent> {
  const account = await signUp();

  const family = await request(app)
    .post(`${API_PREFIX}/families`)
    .set('Authorization', account.bearer)
    .send({ name: 'Our Family' });
  expect(family.status).toBe(201);
  const familyId = family.body.family.id as string;

  const baby = await request(app)
    .post(`${API_PREFIX}/families/${familyId}/babies`)
    .set('Authorization', account.bearer)
    .send({ name: babyName });
  expect(baby.status).toBe(201);

  return { ...account, familyId, babyId: baby.body.baby.id as string };
}

/**
 * A second person in the same family, as a MEMBER rather than its OWNER.
 *
 * Written straight to the model because invitations are a Phase 6 feature and
 * there is no endpoint that adds one yet — the same shortcut the families suite
 * takes for its own membership tests.
 */
async function addMember(parent: Parent): Promise<Account> {
  const account = await signUp();
  await FamilyMember.create({
    familyId: parent.familyId,
    userId: account.userId,
    role: 'MEMBER',
  });
  return account;
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

const patchEvent = (parent: Parent, eventId: string, body: unknown, babyId = parent.babyId) =>
  request(app)
    .patch(`${eventsUrl(parent.familyId, babyId)}/${eventId}`)
    .set('Authorization', parent.bearer)
    .send(body);

const removeEvent = (parent: Parent, eventId: string, babyId = parent.babyId) =>
  request(app)
    .delete(`${eventsUrl(parent.familyId, babyId)}/${eventId}`)
    .set('Authorization', parent.bearer);

/** Creates an event and returns its id, for the many tests that need one to edit. */
async function existingEvent(parent: Parent, body: unknown, babyId = parent.babyId) {
  const created = await addEvent(parent, body, babyId);
  expect(created.status).toBe(201);
  return created.body.event as { id: string; createdAt: string; updatedAt: string };
}

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

describe('PATCH .../events/:eventId', () => {
  const startedAt = '2026-09-04T08:00:00.000Z';

  it('edits a FEEDING, and leaves everything it was not asked to change', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, {
      type: 'FEEDING',
      startedAt,
      amount: 120,
      unit: 'ml',
      details: 'Took most of the bottle',
    });

    const response = await patchEvent(parent, event.id, {
      startedAt: '2026-09-04T08:15:00.000Z',
      amount: 150,
    });

    expect(response.status).toBe(200);
    expect(response.body.event).toMatchObject({
      id: event.id,
      familyId: parent.familyId,
      babyId: parent.babyId,
      type: 'FEEDING',
      startedAt: '2026-09-04T08:15:00.000Z',
      amount: 150,
      // Untouched by this patch, and still there.
      unit: 'ml',
      details: 'Took most of the bottle',
    });

    // An edit is not a re-creation: the record keeps its history.
    expect(response.body.event.createdAt).toBe(event.createdAt);
    expect(Date.parse(response.body.event.updatedAt as string)).toBeGreaterThanOrEqual(
      Date.parse(event.updatedAt),
    );

    const stored = await BabyEvent.findById(event.id);
    expect(stored?.amount).toBe(150);
    expect(stored?.startedAt.toISOString()).toBe('2026-09-04T08:15:00.000Z');
  });

  it('stores a feeding amount exactly as sent, in canonical millilitres', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, {
      type: 'FEEDING',
      startedAt,
      amount: 120,
      unit: 'ml',
    });

    // Decision D3: the form converts at the boundary, so five fluid ounces reach
    // the API already as millilitres. Nothing on this side may convert again.
    const amount = volumeToMl(5, 'oz');
    expect(amount).toBe(148);

    const response = await patchEvent(parent, event.id, { amount, unit: 'ml' });

    expect(response.status).toBe(200);
    expect(response.body.event.amount).toBe(amount);
    expect(response.body.event.unit).toBe('ml');

    const stored = await BabyEvent.findById(event.id);
    expect(stored?.amount).toBe(amount);
    expect(stored?.unit).toBe('ml');
  });

  it('edits a SLEEP’s start and end', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, {
      type: 'SLEEP',
      startedAt: '2026-09-04T13:00:00.000Z',
      endedAt: '2026-09-04T14:10:00.000Z',
    });

    const response = await patchEvent(parent, event.id, {
      startedAt: '2026-09-04T13:05:00.000Z',
      endedAt: '2026-09-04T14:40:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(response.body.event).toMatchObject({
      type: 'SLEEP',
      startedAt: '2026-09-04T13:05:00.000Z',
      endedAt: '2026-09-04T14:40:00.000Z',
    });
  });

  it('keeps a sleep that crosses midnight as the one session it is', async () => {
    // Decision D5. The end time a parent typed is resolved onto the following
    // local day at the UI boundary, where the calendar is known, so what reaches
    // the API is two absolute instants. The API's job is to store them
    // unchanged — no day arithmetic of its own, naive or otherwise.
    const zone = 'Asia/Yerevan';
    const day = '2026-09-04';
    const nextDay = addLocalDays(day, 1);
    const localTime = (localDate: string, hours: number): Date =>
      new Date(localDayStart(localDate, zone).getTime() + hours * 3_600_000);

    const parent = await withBaby();
    const event = await existingEvent(parent, {
      type: 'SLEEP',
      startedAt: localTime(day, 13).toISOString(),
      endedAt: localTime(day, 14).toISOString(),
    });

    // The nap was really the night sleep: 23:00 to 01:30.
    const start = localTime(day, 23);
    const end = localTime(nextDay, 1.5);

    const response = await patchEvent(parent, event.id, {
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
    });

    expect(response.status).toBe(200);
    expect(response.body.event.startedAt).toBe(start.toISOString());
    expect(response.body.event.endedAt).toBe(end.toISOString());

    const stored = await BabyEvent.findById(event.id);
    expect(stored?.startedAt.toISOString()).toBe(start.toISOString());
    expect(stored?.endedAt?.toISOString()).toBe(end.toISOString());

    // It genuinely spans two local days, and is two and a half hours long —
    // which is only true if nothing shifted either instant by a day.
    expect(toLocalDate(start, zone)).toBe(day);
    expect(toLocalDate(end, zone)).toBe(nextDay);
    expect(durationSeconds(start, end)).toBe(2.5 * 3600);

    // And a daily total still splits it honestly across both days.
    const first = localDayRange(day, zone);
    const second = localDayRange(nextDay, zone);
    expect(overlapSeconds(start, end, first.start, first.end)).toBe(3600);
    expect(overlapSeconds(start, end, second.start, second.end)).toBe(1.5 * 3600);
  });

  it('edits a DIAPER, and only to a canonical kind', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, { type: 'DIAPER', startedAt, details: 'wet' });

    const changed = await patchEvent(parent, event.id, {
      startedAt: '2026-09-04T09:45:00.000Z',
      details: 'wet_and_dirty',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.event).toMatchObject({
      type: 'DIAPER',
      startedAt: '2026-09-04T09:45:00.000Z',
      details: 'wet_and_dirty',
    });

    const invalid = await patchEvent(parent, event.id, { details: 'blowout' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(invalid.body.error.details)).toContain('details');

    const stored = await BabyEvent.findById(event.id);
    expect(stored?.details).toBe('wet_and_dirty');
  });

  it('edits a NOTE, where details is free text up to the limit', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'Smiled' });

    const changed = await patchEvent(parent, event.id, {
      startedAt: '2026-09-04T18:30:00.000Z',
      details: 'Smiled at the mobile, twice',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.event).toMatchObject({
      type: 'NOTE',
      startedAt: '2026-09-04T18:30:00.000Z',
      details: 'Smiled at the mobile, twice',
    });

    // The nappy vocabulary is a DIAPER rule, not a rule about `details` itself.
    const anything = await patchEvent(parent, event.id, { details: 'blowout' });
    expect(anything.status).toBe(200);

    const tooLong = await patchEvent(parent, event.id, { details: 'x'.repeat(1001) });
    expect(tooLong.status).toBe(422);
  });

  it('refuses to change what an event is', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, { type: 'FEEDING', startedAt, amount: 90 });

    // An edit form sends the whole event back; the unchanged type is fine.
    const echoed = await patchEvent(parent, event.id, { type: 'FEEDING', amount: 100 });
    expect(echoed.status).toBe(200);
    expect(echoed.body.event.amount).toBe(100);

    const retyped = await patchEvent(parent, event.id, { type: 'NOTE', details: 'now a note' });
    expect(retyped.status).toBe(422);

    const stored = await BabyEvent.findById(event.id);
    expect(stored?.type).toBe('FEEDING');
    expect(stored?.details).toBeUndefined();
  });

  it('does not move an event between groups', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, { type: 'FEEDING', startedAt, groupId: 'action-1' });

    const response = await patchEvent(parent, event.id, { amount: 90, groupId: 'action-2' });

    expect(response.status).toBe(200);
    expect(response.body.event.groupId).toBe('action-1');
  });

  it('ignores familyId and babyId in the body', async () => {
    const parent = await withBaby();
    const elsewhere = await withBaby();
    const event = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'mine' });

    const response = await patchEvent(parent, event.id, {
      details: 'edited',
      familyId: elsewhere.familyId,
      babyId: elsewhere.babyId,
    });

    expect(response.status).toBe(200);
    expect(response.body.event.familyId).toBe(parent.familyId);
    expect(response.body.event.babyId).toBe(parent.babyId);
    expect(await BabyEvent.countDocuments({ babyId: elsewhere.babyId })).toBe(0);
  });

  it('rejects a patch that would change nothing', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'mine' });

    for (const body of [
      {},
      { type: 'NOTE' },
      // Stripped down to nothing, because neither field is editable — so this
      // reads as the mistake it is rather than as a silent no-op.
      { familyId: new Types.ObjectId().toString(), babyId: new Types.ObjectId().toString() },
    ]) {
      const response = await patchEvent(parent, event.id, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects invalid input, leaving the event as it was', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, {
      type: 'FEEDING',
      startedAt,
      amount: 120,
      unit: 'ml',
    });

    for (const body of [
      { startedAt: 'not-a-date' },
      { endedAt: 'not-a-date' },
      { amount: -1 },
      { amount: 'lots' },
      { unit: 'x'.repeat(17) },
      { details: 'x'.repeat(1001) },
      { type: 'SOMETHING_ELSE', amount: 90 },
    ]) {
      const response = await patchEvent(parent, event.id, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }

    const stored = await BabyEvent.findById(event.id);
    expect(stored?.amount).toBe(120);
    expect(stored?.startedAt.toISOString()).toBe(startedAt);
  });

  it('is open to any member of the family, not only its owner', async () => {
    const parent = await withBaby();
    const member = await addMember(parent);
    const event = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'mine' });

    const response = await request(app)
      .patch(`${eventsUrl(parent.familyId, parent.babyId)}/${event.id}`)
      .set('Authorization', member.bearer)
      .send({ details: 'edited by the other parent' });

    expect(response.status).toBe(200);
    expect(response.body.event.details).toBe('edited by the other parent');
  });

  it('answers 404 for a missing id and a malformed one, identically', async () => {
    const parent = await withBaby();

    const missing = await patchEvent(parent, new Types.ObjectId().toString(), { details: 'x' });
    const malformed = await patchEvent(parent, 'not-an-object-id', { details: 'x' });

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(JSON.stringify(missing.body)).toBe(JSON.stringify(malformed.body));
  });

  it('cannot reach a sibling’s event', async () => {
    const parent = await withBaby('Twin A');
    const twinB = await addSibling(parent, 'Twin B');
    const forA = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'A' });

    const response = await patchEvent(parent, forA.id, { details: 'edited' }, twinB);

    expect(response.status).toBe(404);
    expect((await BabyEvent.findById(forA.id))?.details).toBe('A');
  });

  it('cannot reach another family’s event, by any route', async () => {
    const alice = await withBaby();
    const bob = await withBaby();
    const bobsEvent = await existingEvent(bob, { type: 'NOTE', startedAt, details: 'Bob' });

    // Bob's family and baby, with Alice's token: membership misses.
    const wholeChain = await request(app)
      .patch(`${eventsUrl(bob.familyId, bob.babyId)}/${bobsEvent.id}`)
      .set('Authorization', alice.bearer)
      .send({ details: 'edited' });

    // Alice's own family and baby, but Bob's event id.
    const foreignEvent = await patchEvent(alice, bobsEvent.id, { details: 'edited' });

    for (const response of [wholeChain, foreignEvent]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Bob');
    }
    expect((await BabyEvent.findById(bobsEvent.id))?.details).toBe('Bob');
  });

  it('rejects an unauthenticated request', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'mine' });

    const response = await request(app)
      .patch(`${eventsUrl(parent.familyId, parent.babyId)}/${event.id}`)
      .send({ details: 'edited' });

    expect(response.status).toBe(401);
    expect((await BabyEvent.findById(event.id))?.details).toBe('mine');
  });
});

describe('DELETE .../events/:eventId', () => {
  const startedAt = '2026-09-04T08:00:00.000Z';

  it('removes exactly the event it was given', async () => {
    const parent = await withBaby('Twin A');
    const twinB = await addSibling(parent, 'Twin B');
    const target = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'target' });
    const keptForA = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'kept' });
    const keptForB = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'B' }, twinB);

    const response = await removeEvent(parent, target.id);

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
    expect(await BabyEvent.findById(target.id)).toBeNull();
    expect(await BabyEvent.findById(keptForA.id)).not.toBeNull();
    expect(await BabyEvent.findById(keptForB.id)).not.toBeNull();

    // And it is gone from the list the tracker reads.
    const list = await request(app)
      .get(eventsUrl(parent.familyId, parent.babyId))
      .set('Authorization', parent.bearer);
    expect((list.body.events as { id: string }[]).map((e) => e.id)).toEqual([keptForA.id]);
  });

  it('answers 404 for a missing id, a malformed one and an already deleted one', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, { type: 'NOTE', startedAt });

    expect((await removeEvent(parent, event.id)).status).toBe(204);

    const again = await removeEvent(parent, event.id);
    const missing = await removeEvent(parent, new Types.ObjectId().toString());
    const malformed = await removeEvent(parent, 'not-an-object-id');

    for (const response of [again, missing, malformed]) {
      expect(response.status).toBe(404);
    }
    expect(JSON.stringify(missing.body)).toBe(JSON.stringify(malformed.body));
  });

  it('is open to any member of the family, not only its owner', async () => {
    const parent = await withBaby();
    const member = await addMember(parent);
    const event = await existingEvent(parent, { type: 'NOTE', startedAt });

    const response = await request(app)
      .delete(`${eventsUrl(parent.familyId, parent.babyId)}/${event.id}`)
      .set('Authorization', member.bearer);

    expect(response.status).toBe(204);
    expect(await BabyEvent.findById(event.id)).toBeNull();
  });

  it('cannot reach a sibling’s event', async () => {
    const parent = await withBaby('Twin A');
    const twinB = await addSibling(parent, 'Twin B');
    const forA = await existingEvent(parent, { type: 'NOTE', startedAt, details: 'A' });

    const response = await removeEvent(parent, forA.id, twinB);

    expect(response.status).toBe(404);
    expect(await BabyEvent.findById(forA.id)).not.toBeNull();
  });

  it('cannot reach another family’s event, by any route', async () => {
    const alice = await withBaby();
    const bob = await withBaby();
    const bobsEvent = await existingEvent(bob, { type: 'NOTE', startedAt, details: 'Bob' });

    const wholeChain = await request(app)
      .delete(`${eventsUrl(bob.familyId, bob.babyId)}/${bobsEvent.id}`)
      .set('Authorization', alice.bearer);
    const foreignEvent = await removeEvent(alice, bobsEvent.id);

    for (const response of [wholeChain, foreignEvent]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Bob');
    }
    expect(await BabyEvent.findById(bobsEvent.id)).not.toBeNull();
  });

  it('rejects an unauthenticated request', async () => {
    const parent = await withBaby();
    const event = await existingEvent(parent, { type: 'NOTE', startedAt });

    const response = await request(app).delete(
      `${eventsUrl(parent.familyId, parent.babyId)}/${event.id}`,
    );

    expect(response.status).toBe(401);
    expect(await BabyEvent.findById(event.id)).not.toBeNull();
  });
});
