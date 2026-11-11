import { describe, expect, it } from 'vitest';
import { encodeEventCursor, localDayRange, type BabyEvent } from '@baby-tracker/shared';
import {
  buildTimelineDays,
  isDayComplete,
  mergePages,
  sleepCarryOverAnchor,
  summariseTimelineDay,
  type SummaryContext,
} from './timelineModel.js';

const ZONE = 'Asia/Yerevan'; // UTC+4, no daylight saving
const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

let counter = 0;
/** An event at a Yerevan wall-clock time: `local('2026-11-10', '08:30')`. */
function event(date: string, hhmm: string, overrides: Partial<BabyEvent> = {}): BabyEvent {
  counter += 1;
  const { start } = localDayRange(date, ZONE);
  const [hours, minutes] = hhmm.split(':').map(Number);
  return {
    id: counter.toString(16).padStart(24, '0'),
    familyId: 'f'.repeat(24),
    babyId: A,
    type: 'NOTE',
    startedAt: new Date(
      start.getTime() + ((hours ?? 0) * 60 + (minutes ?? 0)) * 60_000,
    ).toISOString(),
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const at = (date: string, hhmm: string): string => event(date, hhmm).startedAt;
const options = { timeZone: ZONE, combineGroups: true, babyOrder: [A, B] };

describe('mergePages', () => {
  it('keeps every event exactly once, newest first, however often a page repeats it', () => {
    const older = event('2026-11-10', '07:00', { babyId: B, groupId: 'g' });
    const newer = event('2026-11-10', '10:00', { groupId: 'g' });
    const middle = event('2026-11-10', '09:00');

    const merged = mergePages([
      { events: [newer, middle, older], nextCursor: encodeEventCursor(middle) },
      { events: [older], nextCursor: null },
    ]);

    expect(merged.map((e) => e.id)).toEqual([newer.id, middle.id, older.id]);
  });

  it('orders a tie on startedAt by id, descending, as the API does', () => {
    const first = event('2026-11-10', '08:00');
    const second = event('2026-11-10', '08:00');
    expect(mergePages([{ events: [first, second], nextCursor: null }]).map((e) => e.id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});

describe('buildTimelineDays', () => {
  it('groups by the local day an event started on, not the UTC day', () => {
    // 01:30 in Yerevan is 21:30 UTC the evening before.
    const early = event('2026-11-10', '01:30');
    const late = event('2026-11-09', '23:30');

    const days = buildTimelineDays([late, early], options);

    expect(days.map((d) => [d.date, d.events.map((e) => e.id)])).toEqual([
      ['2026-11-10', [early.id]],
      ['2026-11-09', [late.id]],
    ]);
  });

  it('lists a sleep across midnight once, on the day it started', () => {
    const sleep = event('2026-11-09', '22:00', {
      type: 'SLEEP',
      endedAt: at('2026-11-10', '06:00'),
    });
    expect(buildTimelineDays([sleep], options).map((d) => d.date)).toEqual(['2026-11-09']);
  });

  it('knows a daylight-saving day is 23 or 25 hours long', () => {
    const berlin = { ...options, timeZone: 'Europe/Berlin' };
    const short = { ...event('2026-03-29', '12:00'), startedAt: '2026-03-29T10:00:00.000Z' };
    const long = { ...event('2026-10-25', '12:00'), startedAt: '2026-10-25T11:00:00.000Z' };

    const [longDay, shortDay] = buildTimelineDays([short, long], berlin);

    expect(shortDay?.date).toBe('2026-03-29');
    expect(longDay?.date).toBe('2026-10-25');
    expect(((shortDay?.end.getTime() ?? 0) - (shortDay?.start.getTime() ?? 0)) / 3_600_000).toBe(
      23,
    );
    expect(((longDay?.end.getTime() ?? 0) - (longDay?.start.getTime() ?? 0)) / 3_600_000).toBe(25);
  });

  it('combines the halves of a twin action into one row, where its newest half is, A first', () => {
    const halfB = event('2026-11-10', '10:05', { babyId: B, groupId: 'g' });
    const between = event('2026-11-10', '10:02');
    const halfA = event('2026-11-10', '10:00', { groupId: 'g' });

    const [day] = buildTimelineDays([halfA, between, halfB], options);

    expect(
      day?.rows.map((r) => (r.kind === 'group' ? r.events.map((e) => e.id) : r.event.id)),
    ).toEqual([[halfA.id, halfB.id], between.id]);
  });

  it('leaves halves on different days, or a lone half, as ordinary rows', () => {
    const halfA = event('2026-11-10', '00:30', { groupId: 'g' });
    const halfB = event('2026-11-09', '23:50', { babyId: B, groupId: 'g' });
    const lone = event('2026-11-09', '12:00', { groupId: 'h' });

    const days = buildTimelineDays([halfA, halfB, lone], options);

    expect(days.flatMap((d) => d.rows.map((r) => r.kind))).toEqual(['single', 'single', 'single']);
  });

  it('does not combine when the list is narrowed to one baby', () => {
    const halfA = event('2026-11-10', '10:00', { groupId: 'g' });
    const halfB = event('2026-11-10', '10:00', { babyId: B, groupId: 'g' });
    const [day] = buildTimelineDays([halfA, halfB], { ...options, combineGroups: false });
    expect(day?.rows).toHaveLength(2);
  });
});

describe('isDayComplete', () => {
  const { start } = localDayRange('2026-11-10', ZONE);
  const cursorAt = (iso: string) => `${iso}_${'c'.repeat(24)}`;

  it('is complete with no more pages', () => {
    expect(isDayComplete(start, null)).toBe(true);
  });

  it('is complete only once the cursor is strictly before the day’s first instant', () => {
    expect(isDayComplete(start, cursorAt(new Date(start.getTime() - 1).toISOString()))).toBe(true);
    expect(isDayComplete(start, cursorAt(start.toISOString()))).toBe(false);
    expect(isDayComplete(start, cursorAt(new Date(start.getTime() + 60_000).toISOString()))).toBe(
      false,
    );
  });
});

describe('summariseTimelineDay', () => {
  const now = new Date('2026-11-30T00:00:00.000Z');
  const context = (overrides: Partial<SummaryContext>): SummaryContext => ({
    allEvents: [],
    nextCursor: null,
    types: undefined,
    carryOver: undefined,
    babyIds: [A, B],
    timeZone: ZONE,
    now,
    ...overrides,
  });

  it('counts feedings and nappies per baby, and sleep as its overlap with the day', () => {
    const events = [
      event('2026-11-10', '08:00', { type: 'FEEDING', feeding: { kind: 'formula' }, amount: 90 }),
      event('2026-11-10', '09:00', { type: 'DIAPER', details: 'wet', babyId: B }),
      // 22:00 → 02:00: two hours on the 10th.
      event('2026-11-10', '22:00', { type: 'SLEEP', endedAt: at('2026-11-11', '02:00') }),
      // 23:00 the 9th → 01:00: one hour on the 10th.
      event('2026-11-09', '23:00', { type: 'SLEEP', endedAt: at('2026-11-10', '01:00') }),
    ];
    const days = buildTimelineDays(events, options);
    const tenth = days.find((d) => d.date === '2026-11-10');
    if (tenth === undefined) throw new Error('no day');
    const ninth = days.find((d) => d.date === '2026-11-09');

    const summary = summariseTimelineDay(
      tenth,
      context({ allEvents: events, carryOver: { anchor: ninth?.start ?? now, events: [] } }),
    );

    expect(summary).toEqual([
      { babyId: A, feedings: 1, sleepSeconds: 3 * 3600, diapers: 0 },
      { babyId: B, feedings: 0, sleepSeconds: 0, diapers: 1 },
    ]);
  });

  it('adds a sleep that started before anything loaded, from the carry-over read', () => {
    const today = event('2026-11-10', '12:00', { type: 'DIAPER' });
    const [day] = buildTimelineDays([today], options);
    if (day === undefined) throw new Error('no day');
    // Started a week ago and still running: every hour of the day counts.
    const running = event('2026-11-03', '20:00', { type: 'SLEEP', babyId: B });

    const summary = summariseTimelineDay(
      day,
      context({ allEvents: [today], carryOver: { anchor: day.start, events: [running] } }),
    );

    expect(summary?.find((s) => s.babyId === B)?.sleepSeconds).toBe(24 * 3600);
  });

  it('counts a running sleep only up to now', () => {
    const sleep = event('2026-11-10', '10:00', { type: 'SLEEP' });
    const [day] = buildTimelineDays([sleep], options);
    if (day === undefined) throw new Error('no day');

    const summary = summariseTimelineDay(
      day,
      context({
        allEvents: [sleep],
        carryOver: { anchor: day.start, events: [] },
        now: new Date(at('2026-11-10', '11:30')),
      }),
    );

    expect(summary?.[0]?.sleepSeconds).toBe(1.5 * 3600);
  });

  it('shows nothing for a day that is not wholly loaded', () => {
    const lastLoaded = event('2026-11-10', '08:00');
    const [day] = buildTimelineDays([lastLoaded], options);
    if (day === undefined) throw new Error('no day');

    const summary = summariseTimelineDay(
      day,
      context({
        nextCursor: encodeEventCursor(lastLoaded),
        carryOver: { anchor: day.start, events: [] },
      }),
    );

    expect(summary).toBeNull();
  });

  it('shows nothing when sleep is shown but the carry-over read does not cover the day', () => {
    const [day] = buildTimelineDays([event('2026-11-10', '08:00')], options);
    if (day === undefined) throw new Error('no day');

    expect(summariseTimelineDay(day, context({ carryOver: undefined }))).toBeNull();
    const later = { anchor: new Date(day.start.getTime() + 1), events: [] };
    expect(summariseTimelineDay(day, context({ carryOver: later }))).toBeNull();
  });

  it('needs no carry-over, and reports only the filtered types, when sleep is filtered out', () => {
    const [day] = buildTimelineDays([event('2026-11-10', '08:00', { type: 'DIAPER' })], options);
    if (day === undefined) throw new Error('no day');

    const summary = summariseTimelineDay(
      day,
      context({ types: new Set(['DIAPER']), babyIds: [A] }),
    );

    expect(summary).toEqual([{ babyId: A, feedings: null, sleepSeconds: null, diapers: 1 }]);
  });
});

describe('sleepCarryOverAnchor', () => {
  it('is the first instant of the oldest complete day, or null when none is complete', () => {
    const newest = event('2026-11-10', '08:00');
    const oldest = event('2026-11-08', '08:00');
    const days = buildTimelineDays([newest, event('2026-11-09', '08:00'), oldest], options);

    expect(sleepCarryOverAnchor(days, null)).toEqual(days[2]?.start);
    expect(sleepCarryOverAnchor(days, encodeEventCursor(oldest))).toEqual(days[1]?.start);
    expect(sleepCarryOverAnchor(days.slice(0, 1), encodeEventCursor(newest))).toBeNull();
  });
});
