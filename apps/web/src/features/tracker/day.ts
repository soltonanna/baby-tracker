/**
 * Which calendar day the tracker is showing, and how to ask the API for it.
 *
 * Today means the current local calendar day — not the last 24 hours, and not
 * the UTC day. The boundaries come from the shared calendar helpers
 * (`localDayRange`), which already handle a day that is 23 or 25 hours long and
 * a midnight that does not exist, so nothing here does arithmetic on a `Date`
 * and nothing anywhere slices an ISO string to get a date.
 *
 * The API is given two absolute instants rather than a date and a zone: that is
 * the same boundary decision D5 already draws for a sleep's end time — the
 * calendar is resolved where it is known, and the server stores and queries
 * instants. It also means Today needs no family time zone on the server yet.
 */

import { localDayRange, toLocalDate, type LocalDate } from '@baby-tracker/shared';
import { browserTimeZone } from './eventTime.js';

/** A half-open [from, to) range of instants, as the list endpoint takes them. */
export interface DayRange {
  from: string;
  to: string;
}

/**
 * The zone the tracker's calendar is read in.
 *
 * The signed-in user already carries one (`PublicUser.timezone`, an IANA name
 * the browser itself supplied at registration), so that is what is used; there
 * is no new field and no family-level time zone here. The browser's own zone is
 * the fallback — for the moment before the session is restored, and for a stored
 * name this browser's `Intl` does not know, which would otherwise throw on every
 * render.
 */
export function trackerTimeZone(userTimeZone?: string): string {
  if (userTimeZone !== undefined && userTimeZone.length > 0) {
    try {
      // Cheapest honest check that `Intl` accepts it: an unknown zone throws.
      toLocalDate(new Date(), userTimeZone);
      return userTimeZone;
    } catch {
      // Fall through to the browser's own zone.
    }
  }
  return browserTimeZone();
}

/** The calendar date `now` falls on, in `timeZone`. */
export function currentLocalDate(timeZone: string, now: Date = new Date()): LocalDate {
  return toLocalDate(now, timeZone);
}

/**
 * A local calendar day as the two instants the API is asked for: its first
 * instant, up to but not including the first instant of the next day.
 */
export function localDayRangeParams(localDate: LocalDate, timeZone: string): DayRange {
  const { start, end } = localDayRange(localDate, timeZone);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** The current local calendar day, as that same pair of instants. */
export function currentDayRange(timeZone: string, now: Date = new Date()): DayRange {
  return localDayRangeParams(currentLocalDate(timeZone, now), timeZone);
}
