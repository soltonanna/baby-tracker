/**
 * Turning what a `<input type="time">` shows into the instant an event happened.
 *
 * Extracted from `NoteForm` when the feeding form needed the same conversions.
 * Not a form abstraction — small functions about time, which is why they can be
 * tested without rendering anything.
 */

import { addLocalDays, localDayStart, toLocalDate } from '@baby-tracker/shared';

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** `HH:MM` in the browser's own zone, which is what `<input type="time">` reads. */
export function timeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * The instant a time picked on the `day` in question refers to, as an ISO
 * string. Local by construction: a parent types 07:30 meaning their own 07:30.
 * `null` when the field is empty or not a time — a real browser's time input
 * will not produce that, but nothing here relies on the browser to be sure.
 */
export function startedAtFrom(time: string, day: Date): string | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  const startedAt = new Date(day);
  startedAt.setHours(hours, minutes, 0, 0);
  return startedAt.toISOString();
}

/** The browser's own zone — the one `<input type="time">` and `Date` both speak. */
function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The instant an end time refers to, given the start it has to follow.
 *
 * 23:00 → 01:00 is a normal night, not a mistake: decision D5 keeps a sleep that
 * crosses midnight as one session, listed on the day it started, and leaves
 * daily totals to `overlapSeconds`. So an end time earlier than the start is
 * read on the *next* local day rather than rejected — which is also how a parent
 * reads the two numbers they just typed.
 *
 * An end at or after the start stays on the same day, so every ordinary sleep
 * resolves exactly as it did before.
 *
 * The next day comes from the shared calendar helpers rather than from arithmetic
 * on a `Date`: `addLocalDays` and `localDayStart` already handle a day that is 23
 * or 25 hours long, and a second implementation of that here would be one more
 * thing to keep right.
 */
export function endedAtFrom(time: string, startedAt: string, day: Date): string | null {
  const sameDay = startedAtFrom(time, day);
  if (sameDay === null) {
    return null;
  }
  if (Date.parse(sameDay) >= Date.parse(startedAt)) {
    return sameDay;
  }

  const timeZone = browserTimeZone();
  const nextDay = localDayStart(addLocalDays(toLocalDate(day, timeZone), 1), timeZone);
  return startedAtFrom(time, nextDay);
}
