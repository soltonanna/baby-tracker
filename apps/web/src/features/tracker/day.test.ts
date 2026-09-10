import { describe, expect, it } from 'vitest';
import { addLocalDays, localDayRange, toLocalDate } from '@baby-tracker/shared';
import { browserTimeZone } from './eventTime.js';
import { currentDayRange, currentLocalDate, localDayRangeParams, trackerTimeZone } from './day.js';

/**
 * The calendar arithmetic itself belongs to the shared package and is tested
 * there against four real zones. What is tested here is the tracker's use of
 * it: which zone Today is read in, and that a day is handed to the API as the
 * half-open pair of instants the list endpoint expects.
 */

const YEREVAN = 'Asia/Yerevan';
const BERLIN = 'Europe/Berlin';
const SANTIAGO = 'America/Santiago';
const HOUR_MS = 3_600_000;

describe('trackerTimeZone', () => {
  it('uses the signed-in user’s stored zone', () => {
    expect(trackerTimeZone(YEREVAN)).toBe(YEREVAN);
    expect(trackerTimeZone(SANTIAGO)).toBe(SANTIAGO);
  });

  it('falls back to the browser’s zone when there is no user yet', () => {
    expect(trackerTimeZone(undefined)).toBe(browserTimeZone());
    expect(trackerTimeZone('')).toBe(browserTimeZone());
  });

  it('falls back rather than throwing on a zone this browser does not know', () => {
    // A stored name `Intl` rejects would otherwise throw on every render.
    expect(trackerTimeZone('Middle/Earth')).toBe(browserTimeZone());
  });
});

describe('currentLocalDate', () => {
  it('is the calendar date of the instant in that zone, not the UTC date', () => {
    // 22:30 UTC is already the next day in Yerevan (+04) and still the same day
    // in Santiago — which is exactly what slicing an ISO string would get wrong.
    const instant = new Date('2026-09-09T22:30:00.000Z');

    expect(currentLocalDate(YEREVAN, instant)).toBe('2026-09-10');
    expect(currentLocalDate(SANTIAGO, instant)).toBe('2026-09-09');
  });
});

describe('localDayRangeParams', () => {
  it('is the day’s first instant up to the next day’s', () => {
    const range = localDayRangeParams('2026-09-09', YEREVAN);
    const { start, end } = localDayRange('2026-09-09', YEREVAN);

    expect(range).toEqual({ from: start.toISOString(), to: end.toISOString() });
    // Yerevan is +04 all year, so the day begins at 20:00 UTC the evening before.
    expect(range.from).toBe('2026-09-08T20:00:00.000Z');
    expect(range.to).toBe('2026-09-09T20:00:00.000Z');
  });

  it('is half-open: the last instant of the day is inside it, the next day’s first is not', () => {
    const { from, to } = localDayRangeParams('2026-09-09', YEREVAN);

    expect(toLocalDate(new Date(from), YEREVAN)).toBe('2026-09-09');
    expect(toLocalDate(new Date(Date.parse(to) - 1), YEREVAN)).toBe('2026-09-09');
    expect(toLocalDate(new Date(to), YEREVAN)).toBe('2026-09-10');
  });

  it('covers a daylight-saving day of 23 or 25 hours, not a fixed 24', () => {
    const short = localDayRangeParams('2026-03-29', BERLIN);
    const long = localDayRangeParams('2026-10-25', BERLIN);

    expect((Date.parse(short.to) - Date.parse(short.from)) / HOUR_MS).toBe(23);
    expect((Date.parse(long.to) - Date.parse(long.from)) / HOUR_MS).toBe(25);
  });

  it('handles a day whose local midnight never happens', () => {
    // Santiago's spring transition is at midnight, so 2026-09-06 begins at 01:00
    // local time. The range still starts at the day's genuine first instant.
    const { from } = localDayRangeParams('2026-09-06', SANTIAGO);

    expect(toLocalDate(new Date(from), SANTIAGO)).toBe('2026-09-06');
    expect(toLocalDate(new Date(Date.parse(from) - 1), SANTIAGO)).toBe('2026-09-05');
  });
});

describe('currentDayRange', () => {
  it('is the local calendar day the given instant falls on', () => {
    const instant = new Date('2026-09-09T22:30:00.000Z');

    // Already 10 September in Yerevan.
    expect(currentDayRange(YEREVAN, instant)).toEqual(localDayRangeParams('2026-09-10', YEREVAN));
    // Still 9 September in Santiago.
    expect(currentDayRange(SANTIAGO, instant)).toEqual(localDayRangeParams('2026-09-09', SANTIAGO));
  });

  it('contains the instant it was asked about, and only that day', () => {
    const now = new Date();
    for (const zone of [YEREVAN, BERLIN, SANTIAGO]) {
      const { from, to } = currentDayRange(zone, now);
      expect(now.getTime()).toBeGreaterThanOrEqual(Date.parse(from));
      expect(now.getTime()).toBeLessThan(Date.parse(to));

      const date = toLocalDate(now, zone);
      expect(toLocalDate(new Date(from), zone)).toBe(date);
      expect(toLocalDate(new Date(to), zone)).toBe(addLocalDays(date, 1));
    }
  });

  it('is stable while the day is, so the query key does not churn', () => {
    const zone = YEREVAN;
    const morning = new Date('2026-09-09T04:00:00.000Z');
    const evening = new Date('2026-09-09T14:00:00.000Z');

    expect(currentDayRange(zone, morning)).toEqual(currentDayRange(zone, evening));
  });
});
