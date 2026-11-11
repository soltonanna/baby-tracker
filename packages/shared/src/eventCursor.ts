/**
 * Where a page of the family timeline ends, and where the next one begins.
 *
 * The timeline is ordered newest first by `startedAt`, then by id. `startedAt`
 * alone is not a total order — two events recorded for the same minute are an
 * everyday occurrence with twins — so the id breaks the tie, and a cursor names
 * both: "everything strictly older than this event".
 *
 * Two forms travel in `before`:
 *
 *   - `<ISO instant>_<event id>` — the `nextCursor` a page returned. Strictly
 *     older than that event in (startedAt, id) order.
 *   - `<ISO instant>` — a bare instant, for jumping to a date: every event that
 *     started strictly before it.
 *
 * Readable rather than opaque on purpose: the jump form is built by the client
 * from a calendar day, and a cursor that is just "an instant, optionally with a
 * tie-breaker" lets one parameter serve both without a second code path.
 */

import { z } from 'zod';

export interface EventCursor {
  startedAt: Date;
  /** Absent for a bare instant, which is a strict bound on `startedAt` alone. */
  id?: string;
}

const OBJECT_ID = /^[0-9a-f]{24}$/;
const isoDateTime = z.iso.datetime({ offset: true });

/** The `nextCursor` for a page whose last event is this one. */
export function encodeEventCursor(event: { startedAt: string | Date; id: string }): string {
  const startedAt =
    typeof event.startedAt === 'string' ? new Date(event.startedAt) : event.startedAt;
  return `${startedAt.toISOString()}_${event.id}`;
}

/** `null` for anything that is not one of the two forms above. */
export function parseEventCursor(value: string): EventCursor | null {
  const separator = value.lastIndexOf('_');
  const instant = separator === -1 ? value : value.slice(0, separator);
  const id = separator === -1 ? undefined : value.slice(separator + 1);

  if (id !== undefined && !OBJECT_ID.test(id)) {
    return null;
  }
  if (!isoDateTime.safeParse(instant).success) {
    return null;
  }
  const startedAt = new Date(instant);
  if (Number.isNaN(startedAt.getTime())) {
    return null;
  }

  return id === undefined ? { startedAt } : { startedAt, id };
}
