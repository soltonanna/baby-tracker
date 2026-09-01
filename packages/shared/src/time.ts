/**
 * Time-zone and duration primitives (decisions D4 and D5).
 *
 * Implemented on top of `Intl.DateTimeFormat` rather than a date library: this
 * is the whole of the calendar maths the product needs, it is well under a
 * hundred lines, and it is covered by tests against four real time zones
 * including three different kinds of daylight-saving transition. If we ever
 * need genuine calendar arithmetic (recurring appointments, for instance) we
 * can revisit and add a library then.
 *
 * Note on years: `Date.UTC` maps years 0-99 to 1900-1999. Every date this
 * product handles is a four-digit modern year, so that quirk is out of scope.
 */

import type { LocalDate } from './types/common.js';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const HOUR_MS = 3_600_000;

/**
 * The widest real UTC offsets are -12:00 and +14:00, so the first instant of a
 * local day always lies inside [midnight-as-UTC - 15h, midnight-as-UTC + 13h].
 */
const SEARCH_LOWER_BOUND_MS = 15 * HOUR_MS;
const SEARCH_UPPER_BOUND_MS = 13 * HOUR_MS;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** Constructing an Intl formatter is comparatively expensive; reuse them. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function partsInZone(date: Date, timeZone: string): ZonedParts {
  const parts = zonedFormatter(timeZone).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) {
      throw new Error(`Could not read "${type}" for time zone "${timeZone}"`);
    }
    return Number(part.value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (east is positive). */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = partsInZone(date, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asIfUtc - (date.getTime() - date.getMilliseconds());
}

/** The calendar date an instant falls on, in the family's time zone. */
export function toLocalDate(date: Date, timeZone: string): LocalDate {
  const { year, month, day } = partsInZone(date, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function parseLocalDate(localDate: LocalDate): { year: number; month: number; day: number } {
  const match = LOCAL_DATE_PATTERN.exec(localDate);
  if (!match) {
    throw new Error(`Invalid local date "${localDate}", expected YYYY-MM-DD`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * The first instant belonging to a local calendar day.
 *
 * This is a binary search rather than "midnight minus the offset", because
 * local midnight does not always exist: in `America/Santiago` the spring
 * daylight-saving jump happens *at* midnight, so the day begins at 01:00 local
 * time. Searching for the earliest instant whose local date is the target date
 * is correct for every case — ordinary days, a skipped midnight, and a repeated
 * midnight (where it returns the first of the two).
 *
 * Local dates are 'YYYY-MM-DD', so string comparison is chronological. The
 * search converges in about 27 steps over a cached formatter.
 */
export function localDayStart(localDate: LocalDate, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(localDate);
  const midnightAsUtc = Date.UTC(year, month - 1, day);

  // Invariant: `before` is earlier than the target day, `candidate` is not.
  let before = midnightAsUtc - SEARCH_LOWER_BOUND_MS;
  let candidate = midnightAsUtc + SEARCH_UPPER_BOUND_MS;

  while (candidate - before > 1) {
    const middle = before + Math.floor((candidate - before) / 2);
    if (toLocalDate(new Date(middle), timeZone) < localDate) {
      before = middle;
    } else {
      candidate = middle;
    }
  }

  return new Date(candidate);
}

/** Add whole days to a local calendar date, without leaving the string domain. */
export function addLocalDays(localDate: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(localDate);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`;
}

/**
 * Half-open interval [start, end) covering a local calendar day.
 * On a daylight-saving transition day this is 23 or 25 hours long, which is
 * exactly what a daily total should be measured against.
 */
export function localDayRange(localDate: LocalDate, timeZone: string): { start: Date; end: Date } {
  return {
    start: localDayStart(localDate, timeZone),
    end: localDayStart(addLocalDays(localDate, 1), timeZone),
  };
}

/* ------------------------------------------------------------ durations --- */

export function durationSeconds(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

/**
 * Seconds two intervals have in common.
 *
 * Decision D5: a sleep session stays one session, listed on the day it started,
 * but a daily sleep total is the sum of each session's overlap with that local
 * day — so a night that crosses midnight is counted honestly on both days.
 */
export function overlapSeconds(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, Math.round((end - start) / 1000));
}
