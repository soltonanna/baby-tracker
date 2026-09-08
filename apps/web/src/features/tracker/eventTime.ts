/**
 * Turning what a `<input type="time">` shows into the instant an event happened.
 *
 * Extracted from `NoteForm` when the feeding form needed the same two
 * conversions. Not a form abstraction — two functions about time, which is why
 * they can be tested without rendering anything.
 */

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
