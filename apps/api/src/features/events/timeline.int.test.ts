import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { BabyEvent as BabyEventDto, FamilyEventListResponse } from '@baby-tracker/shared';
import { API_PREFIX, createApp } from '../../app.js';
import { FamilyMember } from '../../models/FamilyMember.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';

/**
 * GET /families/:familyId/events — the family timeline.
 *
 * The contract under test (`FamilyEventListResponse`): a page is at most
 * `limit` events newest first by (startedAt, id), plus the twin siblings of any
 * grouped event in it; `nextCursor` comes from the page's own last event. So
 * walking every page and merging by id yields every event exactly once, and a
 * twin pair is never seen by halves.
 */

const app = createApp();
const timelineUrl = (familyId: string): string => `${API_PREFIX}/families/${familyId}/events`;

interface Parent {
  bearer: string;
  userId: string;
  familyId: string;
  babyId: string;
  twinBId: string;
}

let accountCounter = 0;

async function signUp(): Promise<{ bearer: string; userId: string }> {
  accountCounter += 1;
  const registered = await request(app)
    .post(`${API_PREFIX}/auth/register`)
    .send({
      email: `timeline-${accountCounter}@example.com`,
      password: 'a-perfectly-ordinary-passphrase',
      displayName: `Parent ${accountCounter}`,
    });
  expect(registered.status).toBe(201);
  return {
    bearer: `Bearer ${registered.body.accessToken as string}`,
    userId: registered.body.user.id as string,
  };
}

/** A parent with a family of twins. */
async function withTwins(): Promise<Parent> {
  const account = await signUp();
  const family = await request(app)
    .post(`${API_PREFIX}/families`)
    .set('Authorization', account.bearer)
    .send({ name: 'Our Family' });
  expect(family.status).toBe(201);
  const familyId = family.body.family.id as string;

  const addBaby = async (name: string): Promise<string> => {
    const baby = await request(app)
      .post(`${API_PREFIX}/families/${familyId}/babies`)
      .set('Authorization', account.bearer)
      .send({ name });
    expect(baby.status).toBe(201);
    return baby.body.baby.id as string;
  };

  return {
    ...account,
    familyId,
    babyId: await addBaby('Twin A'),
    twinBId: await addBaby('Twin B'),
  };
}

async function addEvent(parent: Parent, babyId: string, body: object): Promise<BabyEventDto> {
  const response = await request(app)
    .post(`${API_PREFIX}/families/${parent.familyId}/babies/${babyId}/events`)
    .set('Authorization', parent.bearer)
    .send(body);
  expect(response.status).toBe(201);
  return response.body.event as BabyEventDto;
}

async function addBoth(parent: Parent, body: object): Promise<BabyEventDto[]> {
  const response = await request(app)
    .post(`${API_PREFIX}/families/${parent.familyId}/event-groups`)
    .set('Authorization', parent.bearer)
    .send(body);
  expect(response.status).toBe(201);
  return response.body.group.events as BabyEventDto[];
}

async function moveEvent(parent: Parent, event: BabyEventDto, startedAt: string): Promise<void> {
  const response = await request(app)
    .patch(`${API_PREFIX}/families/${parent.familyId}/babies/${event.babyId}/events/${event.id}`)
    .set('Authorization', parent.bearer)
    .send({ startedAt });
  expect(response.status).toBe(200);
}

const getTimeline = (parent: { bearer: string }, familyId: string, query: object = {}) =>
  request(app).get(timelineUrl(familyId)).query(query).set('Authorization', parent.bearer);

async function page(parent: Parent, query: object = {}): Promise<FamilyEventListResponse> {
  const response = await getTimeline(parent, parent.familyId, query);
  expect(response.status).toBe(200);
  return response.body as FamilyEventListResponse;
}

/** Every page, in order, following `nextCursor` until it runs out. */
async function allPages(parent: Parent, query: object): Promise<FamilyEventListResponse[]> {
  const pages: FamilyEventListResponse[] = [];
  let before: string | undefined;
  do {
    const next = await page(parent, { ...query, ...(before === undefined ? {} : { before }) });
    pages.push(next);
    before = next.nextCursor ?? undefined;
  } while (before !== undefined && pages.length < 50);
  return pages;
}

const at = (hhmm: string, day = '2026-11-10'): string => `${day}T${hhmm}:00.000Z`;
const ids = (events: readonly { id: string }[]): string[] => events.map((event) => event.id);

beforeEach(() => {
  accountCounter = 0;
  resetAuthRateLimits();
});

describe('GET /families/:familyId/events — access', () => {
  it('rejects an unauthenticated request', async () => {
    const parent = await withTwins();
    const response = await request(app).get(timelineUrl(parent.familyId));
    expect(response.status).toBe(401);
  });

  it('answers a non-member exactly as it answers a family that does not exist', async () => {
    const parent = await withTwins();
    await addEvent(parent, parent.babyId, { type: 'NOTE', startedAt: at('08:00'), details: 'x' });
    const stranger = await signUp();

    const theirs = await getTimeline(stranger, parent.familyId);
    const missing = await getTimeline(stranger, '65f0c0ffee0000000000abcd');

    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(missing.body);
  });

  it('refuses a baby of another family as not found, and reads none of it', async () => {
    const parent = await withTwins();
    const other = await withTwins();
    await addEvent(other, other.babyId, { type: 'NOTE', startedAt: at('08:00'), details: 'x' });

    const response = await getTimeline(parent, parent.familyId, { babyId: other.babyId });

    expect(response.status).toBe(404);
    expect(response.body.events).toBeUndefined();
  });

  it('is open to any member of the family, not only its owner', async () => {
    const parent = await withTwins();
    await addEvent(parent, parent.babyId, { type: 'NOTE', startedAt: at('08:00'), details: 'x' });
    const member = await signUp();
    await FamilyMember.create({ familyId: parent.familyId, userId: member.userId, role: 'MEMBER' });

    const response = await getTimeline(member, parent.familyId);

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
  });

  it.each([
    { limit: 0 },
    { limit: 201 },
    { types: 'BATH' },
    { before: 'yesterday' },
    { babyId: 'twin-a' },
    { activeAt: at('08:00') },
  ])('rejects %j', async (query) => {
    const parent = await withTwins();
    const response = await getTimeline(parent, parent.familyId, query);
    expect(response.status).toBe(422);
  });
});

describe('GET /families/:familyId/events — order and pages', () => {
  it('lists every baby’s events together, newest first', async () => {
    const parent = await withTwins();
    const a = await addEvent(parent, parent.babyId, { type: 'DIAPER', startedAt: at('08:00') });
    const b = await addEvent(parent, parent.twinBId, { type: 'DIAPER', startedAt: at('09:00') });

    const result = await page(parent);

    expect(ids(result.events)).toEqual([b.id, a.id]);
    expect(result.nextCursor).toBeNull();
  });

  it('breaks a tie on startedAt by id, and pages through it without loss or repeat', async () => {
    const parent = await withTwins();
    const created: BabyEventDto[] = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(
        await addEvent(parent, index % 2 === 0 ? parent.babyId : parent.twinBId, {
          type: 'NOTE',
          startedAt: at('08:00'),
          details: `note ${index}`,
        }),
      );
    }
    const expected = ids(created).sort().reverse();

    const pages = await allPages(parent, { limit: 2 });

    expect(pages.map((p) => p.events.length)).toEqual([2, 2, 1]);
    expect(pages.flatMap((p) => ids(p.events))).toEqual(expected);
    expect(pages.at(-1)?.nextCursor).toBeNull();
  });

  it('jumps to a date: a bare instant returns only what started before it', async () => {
    const parent = await withTwins();
    await addEvent(parent, parent.babyId, { type: 'DIAPER', startedAt: at('08:00', '2026-11-11') });
    const older = await addEvent(parent, parent.babyId, { type: 'DIAPER', startedAt: at('23:59') });
    const edge = await addEvent(parent, parent.babyId, {
      type: 'DIAPER',
      startedAt: '2026-11-11T00:00:00.000Z',
    });

    const result = await page(parent, { before: '2026-11-11T00:00:00.000Z' });

    expect(ids(result.events)).toEqual([older.id]);
    expect(ids(result.events)).not.toContain(edge.id);
  });

  it('filters by type and by baby', async () => {
    const parent = await withTwins();
    const feed = await addEvent(parent, parent.babyId, {
      type: 'FEEDING',
      startedAt: at('08:00'),
      feeding: { kind: 'formula' },
      amount: 90,
    });
    const sleep = await addEvent(parent, parent.twinBId, { type: 'SLEEP', startedAt: at('09:00') });
    await addEvent(parent, parent.babyId, { type: 'NOTE', startedAt: at('10:00'), details: 'x' });

    expect(ids((await page(parent, { types: 'FEEDING,SLEEP' })).events)).toEqual([
      sleep.id,
      feed.id,
    ]);
    expect(ids((await page(parent, { babyId: parent.twinBId })).events)).toEqual([sleep.id]);
  });
});

describe('GET /families/:familyId/events — twin pairs', () => {
  it('never splits a pair across a page boundary; a re-sent sibling merges away by id', async () => {
    const parent = await withTwins();
    // A both-babies feeding at 10:00, then twin B's half moved to 07:00 — two
    // ordinary events now sit between the halves.
    const [halfA, halfB] = await addBoth(parent, { type: 'DIAPER', startedAt: at('10:00') });
    if (halfA === undefined || halfB === undefined) throw new Error('expected a pair');
    const pairB = halfB.babyId === parent.twinBId ? halfB : halfA;
    const pairA = pairB === halfB ? halfA : halfB;
    await moveEvent(parent, pairB, at('07:00'));
    const middle1 = await addEvent(parent, parent.babyId, {
      type: 'NOTE',
      startedAt: at('09:00'),
      details: 'a',
    });
    const middle2 = await addEvent(parent, parent.babyId, {
      type: 'NOTE',
      startedAt: at('08:00'),
      details: 'b',
    });

    const pages = await allPages(parent, { limit: 2 });

    // Page one: the 10:00 half and the 09:00 note, plus the 07:00 sibling,
    // sorted into place — more than `limit`, by design.
    expect(ids(pages[0]?.events ?? [])).toEqual([pairA.id, middle1.id, pairB.id]);
    // The page that reaches 07:00 sends that sibling again.
    expect(pages.flatMap((p) => ids(p.events)).filter((id) => id === pairB.id)).toHaveLength(2);

    const merged = new Set(pages.flatMap((p) => ids(p.events)));
    expect([...merged].sort()).toEqual([pairA.id, pairB.id, middle1.id, middle2.id].sort());
  });

  it('keeps the pair when both halves land on the last page', async () => {
    const parent = await withTwins();
    const pair = await addBoth(parent, { type: 'NOTE', startedAt: at('06:00'), details: 'both' });
    await addEvent(parent, parent.babyId, { type: 'DIAPER', startedAt: at('09:00') });

    const pages = await allPages(parent, { limit: 1 });
    const merged = new Set(pages.flatMap((p) => ids(p.events)));

    expect(merged.size).toBe(3);
    expect(ids(pair).every((id) => merged.has(id))).toBe(true);
  });

  it('adds no sibling when the list is narrowed to one baby', async () => {
    const parent = await withTwins();
    const pair = await addBoth(parent, { type: 'DIAPER', startedAt: at('10:00') });

    const result = await page(parent, { babyId: parent.babyId });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.babyId).toBe(parent.babyId);
    expect(ids(pair)).toContain(result.events[0]?.id);
  });

  it('looks siblings up only inside the caller’s family, whatever the groupId', async () => {
    const parent = await withTwins();
    const other = await withTwins();
    // A single-baby create accepts a caller-supplied groupId, so two families
    // can share one. Neither may ever see the other's event through it.
    const mine = await addEvent(parent, parent.babyId, {
      type: 'NOTE',
      startedAt: at('08:00'),
      details: 'mine',
      groupId: 'shared-group',
    });
    await addEvent(other, other.babyId, {
      type: 'NOTE',
      startedAt: at('08:00'),
      details: 'theirs',
      groupId: 'shared-group',
    });

    const result = await page(parent);

    expect(ids(result.events)).toEqual([mine.id]);
    expect(result.events.every((event) => event.familyId === parent.familyId)).toBe(true);
  });
});

describe('GET /families/:familyId/events?types=SLEEP&activeAt=', () => {
  it('returns the sleeps still running at that instant, and only those', async () => {
    const parent = await withTwins();
    const midnight = '2026-11-11T00:00:00.000Z';
    const crossing = await addEvent(parent, parent.babyId, {
      type: 'SLEEP',
      startedAt: at('22:00'),
      endedAt: '2026-11-11T05:00:00.000Z',
    });
    const running = await addEvent(parent, parent.twinBId, {
      type: 'SLEEP',
      startedAt: at('08:00', '2026-11-01'),
    });
    // Over before midnight, starting at it, and not a sleep at all.
    await addEvent(parent, parent.babyId, {
      type: 'SLEEP',
      startedAt: at('19:00'),
      endedAt: at('20:00'),
    });
    await addEvent(parent, parent.babyId, {
      type: 'SLEEP',
      startedAt: midnight,
      endedAt: '2026-11-11T01:00:00.000Z',
    });
    await addEvent(parent, parent.babyId, { type: 'DIAPER', startedAt: at('23:00') });

    const result = await page(parent, { types: 'SLEEP', activeAt: midnight, limit: 200 });

    expect(ids(result.events)).toEqual([crossing.id, running.id]);
    expect(result.nextCursor).toBeNull();
  });
});
