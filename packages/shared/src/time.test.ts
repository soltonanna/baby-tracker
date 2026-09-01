import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  durationSeconds,
  localDayRange,
  localDayStart,
  overlapSeconds,
  timeZoneOffsetMs,
  toLocalDate,
} from './time.js';

/**
 * Four zones, deliberately chosen:
 *   Yerevan  — the product's default: UTC+4, no daylight saving at all.
 *   Berlin   — ordinary DST: the jump happens at 02:00/03:00, midnight exists.
 *   Beirut   — the spring jump happens AT midnight: 23:00 -> 01:00 next day.
 *   Santiago — the spring jump also happens at midnight, and it is the case
 *              that a naive "midnight minus the offset" implementation gets
 *              wrong by an hour. This is a regression test.
 */
const YEREVAN = 'Asia/Yerevan';
const BERLIN = 'Europe/Berlin';
const BEIRUT = 'Asia/Beirut';
const SANTIAGO = 'America/Santiago';

const HOUR = 3_600_000;
const hoursBetween = (start: Date, end: Date): number => (end.getTime() - start.getTime()) / HOUR;
const dayHours = (localDate: string, timeZone: string): number => {
  const { start, end } = localDayRange(localDate, timeZone);
  return hoursBetween(start, end);
};

describe('toLocalDate', () => {
  it('uses the family time zone, not UTC, to decide the day', () => {
    const lateEvening = new Date('2026-09-01T20:30:00.000Z');
    expect(toLocalDate(lateEvening, 'UTC')).toBe('2026-09-01');
    expect(toLocalDate(lateEvening, YEREVAN)).toBe('2026-09-02');
  });

  it('places the exact instant of local midnight on the new day', () => {
    const midnightYerevan = new Date('2026-09-01T20:00:00.000Z');
    expect(toLocalDate(midnightYerevan, YEREVAN)).toBe('2026-09-02');
    expect(toLocalDate(new Date(midnightYerevan.getTime() - 1), YEREVAN)).toBe('2026-09-01');
  });
});

describe('timeZoneOffsetMs', () => {
  it('reports a fixed offset for Yerevan all year', () => {
    expect(timeZoneOffsetMs(new Date('2026-01-15T12:00:00.000Z'), YEREVAN)).toBe(4 * HOUR);
    expect(timeZoneOffsetMs(new Date('2026-07-15T12:00:00.000Z'), YEREVAN)).toBe(4 * HOUR);
  });

  it('follows daylight saving in Berlin', () => {
    expect(timeZoneOffsetMs(new Date('2026-01-15T12:00:00.000Z'), BERLIN)).toBe(HOUR);
    expect(timeZoneOffsetMs(new Date('2026-07-15T12:00:00.000Z'), BERLIN)).toBe(2 * HOUR);
  });
});

describe('addLocalDays', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addLocalDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addLocalDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addLocalDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('localDayRange — Asia/Yerevan (no daylight saving)', () => {
  it('brackets a day at 20:00 UTC on the previous date', () => {
    const { start, end } = localDayRange('2026-09-01', YEREVAN);
    expect(start.toISOString()).toBe('2026-08-31T20:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-01T20:00:00.000Z');
  });

  it('is exactly 24 hours on every day of the year', () => {
    let date = '2026-01-01';
    while (date <= '2026-12-31') {
      expect(dayHours(date, YEREVAN)).toBe(24);
      date = addLocalDays(date, 1);
    }
  });

  it('spans exactly 86400 seconds', () => {
    const { start, end } = localDayRange('2026-09-01', YEREVAN);
    expect(durationSeconds(start, end)).toBe(86_400);
  });
});

describe('localDayRange — daylight saving, spring forward', () => {
  it('gives Berlin a 23-hour day when the clock jumps at 02:00 local', () => {
    const { start, end } = localDayRange('2026-03-29', BERLIN);
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(hoursBetween(start, end)).toBe(23);
  });

  it('starts the Beirut day at 01:00 local, because midnight never happens', () => {
    // 2026-03-28 23:00 local jumps straight to 2026-03-29 01:00 local.
    const start = localDayStart('2026-03-29', BEIRUT);
    expect(start.toISOString()).toBe('2026-03-28T22:00:00.000Z');
    expect(toLocalDate(start, BEIRUT)).toBe('2026-03-29');
    expect(toLocalDate(new Date(start.getTime() - 1), BEIRUT)).toBe('2026-03-28');
    expect(dayHours('2026-03-29', BEIRUT)).toBe(23);
  });

  it('starts the Santiago day at 01:00 local (regression: was off by one hour)', () => {
    // 2026-09-05 23:00 local jumps straight to 2026-09-06 01:00 local.
    // "midnight minus the offset" lands on 2026-09-05 23:00 — the wrong day.
    const start = localDayStart('2026-09-06', SANTIAGO);
    expect(start.toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(toLocalDate(start, SANTIAGO)).toBe('2026-09-06');
    expect(toLocalDate(new Date(start.getTime() - 1), SANTIAGO)).toBe('2026-09-05');
    expect(dayHours('2026-09-06', SANTIAGO)).toBe(23);
  });
});

describe('localDayRange — daylight saving, fall back', () => {
  it('gives Berlin a 25-hour day', () => {
    const { start, end } = localDayRange('2026-10-25', BERLIN);
    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(hoursBetween(start, end)).toBe(25);
  });

  it('gives Beirut a 25-hour day when the clock falls back at midnight', () => {
    expect(dayHours('2026-10-24', BEIRUT)).toBe(25);
  });

  it('gives Santiago a 25-hour day', () => {
    expect(dayHours('2026-04-04', SANTIAGO)).toBe(25);
  });
});

describe('localDayStart invariants across every zone and transition', () => {
  const cases: { timeZone: string; from: string; to: string }[] = [
    { timeZone: YEREVAN, from: '2026-02-25', to: '2026-03-05' },
    { timeZone: BERLIN, from: '2026-03-25', to: '2026-04-02' },
    { timeZone: BERLIN, from: '2026-10-21', to: '2026-10-29' },
    { timeZone: BEIRUT, from: '2026-03-25', to: '2026-04-02' },
    { timeZone: BEIRUT, from: '2026-10-20', to: '2026-10-28' },
    { timeZone: SANTIAGO, from: '2026-09-02', to: '2026-09-10' },
    { timeZone: SANTIAGO, from: '2026-04-01', to: '2026-04-09' },
  ];

  it.each(cases)('holds for $timeZone between $from and $to', ({ timeZone, from, to }) => {
    let date = from;
    while (date <= to) {
      const start = localDayStart(date, timeZone);

      // The day starts on the day it claims to.
      expect(toLocalDate(start, timeZone)).toBe(date);
      // And one millisecond earlier belongs to the previous day, so no instant
      // is ever counted twice or dropped between two consecutive days.
      expect(toLocalDate(new Date(start.getTime() - 1), timeZone)).toBe(addLocalDays(date, -1));

      const length = dayHours(date, timeZone);
      expect([23, 24, 25]).toContain(length);

      date = addLocalDays(date, 1);
    }
  });
});

describe('durations', () => {
  it('measures a sleep session', () => {
    expect(
      durationSeconds(new Date('2026-09-01T09:00:00Z'), new Date('2026-09-01T10:10:00Z')),
    ).toBe(4200);
  });

  it('returns zero for a zero-length interval', () => {
    const instant = new Date('2026-09-01T09:00:00Z');
    expect(durationSeconds(instant, instant)).toBe(0);
  });

  it('never returns a negative duration', () => {
    expect(
      durationSeconds(new Date('2026-09-01T10:00:00Z'), new Date('2026-09-01T09:00:00Z')),
    ).toBe(0);
  });
});

describe('overlapSeconds — decision D5', () => {
  const dayOne = localDayRange('2026-09-01', YEREVAN);
  const dayTwo = localDayRange('2026-09-02', YEREVAN);
  const within = (start: string, end: string, day: { start: Date; end: Date }): number =>
    overlapSeconds(new Date(start), new Date(end), day.start, day.end);

  it('splits a night sleep across the two local days it touches', () => {
    // 22:00 -> 06:00 Yerevan time.
    const start = '2026-09-01T18:00:00.000Z';
    const end = '2026-09-02T02:00:00.000Z';

    expect(within(start, end, dayOne)).toBe(2 * 3600);
    expect(within(start, end, dayTwo)).toBe(6 * 3600);
    expect(within(start, end, dayOne) + within(start, end, dayTwo)).toBe(
      durationSeconds(new Date(start), new Date(end)),
    );
  });

  it('attributes a sleep starting exactly at midnight wholly to the new day', () => {
    // 00:00 -> 06:00 Yerevan time on 2 September.
    const start = '2026-09-01T20:00:00.000Z';
    const end = '2026-09-02T02:00:00.000Z';

    expect(within(start, end, dayOne)).toBe(0);
    expect(within(start, end, dayTwo)).toBe(6 * 3600);
  });

  it('splits a five-minute feeding that crosses midnight', () => {
    // 23:58 -> 00:03 Yerevan time.
    const start = '2026-09-01T19:58:00.000Z';
    const end = '2026-09-01T20:03:00.000Z';

    expect(within(start, end, dayOne)).toBe(120);
    expect(within(start, end, dayTwo)).toBe(180);
    expect(within(start, end, dayOne) + within(start, end, dayTwo)).toBe(300);
  });

  it('caps a session that covers a whole day at that day’s length', () => {
    const start = '2026-08-30T00:00:00.000Z';
    const end = '2026-09-05T00:00:00.000Z';
    expect(within(start, end, dayOne)).toBe(86_400);
  });

  it('returns zero for a zero-length event', () => {
    const instant = '2026-09-01T10:00:00.000Z';
    expect(within(instant, instant, dayOne)).toBe(0);
  });

  it('returns zero for intervals that only touch at a point', () => {
    expect(overlapSeconds(dayOne.start, dayOne.end, dayTwo.start, dayTwo.end)).toBe(0);
  });

  it('returns zero for intervals that do not meet at all', () => {
    const otherDay = localDayRange('2026-09-10', YEREVAN);
    expect(
      overlapSeconds(
        new Date('2026-09-01T18:00:00.000Z'),
        new Date('2026-09-02T02:00:00.000Z'),
        otherDay.start,
        otherDay.end,
      ),
    ).toBe(0);
  });

  it('handles a 23-hour DST day without losing or inventing seconds', () => {
    const shortDay = localDayRange('2026-03-29', BERLIN);
    const wholeDay = overlapSeconds(shortDay.start, shortDay.end, shortDay.start, shortDay.end);
    expect(wholeDay).toBe(23 * 3600);
  });
});
