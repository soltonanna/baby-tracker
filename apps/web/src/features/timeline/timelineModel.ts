/**
 * The timeline, as data: pages merged, days grouped, twin pairs combined, and
 * the daily summaries that are safe to show.
 *
 * No React here, and no clock: every function takes what it needs, so each of
 * the rules below is a unit test rather than a rendering.
 */

import {
  countDiapers,
  localDayRange,
  parseEventCursor,
  sleepSecondsInRange,
  summariseFeedingDay,
  toLocalDate,
  type BabyEvent,
  type FamilyEventListResponse,
  type LocalDate,
} from '@baby-tracker/shared';

/** Newest first by start, then by id — the API's own order. */
function newestFirst(a: BabyEvent, b: BabyEvent): number {
  const byStart = Date.parse(b.startedAt) - Date.parse(a.startedAt);
  if (byStart !== 0) return byStart;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Every loaded page as one list, each event exactly once.
 *
 * A page carries the twin siblings of its grouped events even when they sort
 * past its boundary, and the page that reaches them sends them again
 * (`FamilyEventListResponse`). Merging by id is what turns that into "every
 * event once"; the first copy wins, and the copies are the same event anyway.
 */
export function mergePages(pages: readonly FamilyEventListResponse[]): BabyEvent[] {
  const byId = new Map<string, BabyEvent>();
  for (const page of pages) {
    for (const event of page.events) {
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
  }
  return [...byId.values()].sort(newestFirst);
}

/** One line of the timeline: an event, or the halves of one twin action. */
export type TimelineRow =
  | { kind: 'single'; key: string; event: BabyEvent }
  | { kind: 'group'; key: string; events: BabyEvent[] };

export interface TimelineDay {
  date: LocalDate;
  /** The local day as instants, [start, end): 23, 24 or 25 hours. */
  start: Date;
  end: Date;
  /** Every event that started on this day, newest first. */
  events: BabyEvent[];
  rows: TimelineRow[];
}

export interface BuildDaysOptions {
  timeZone: string;
  /**
   * Combine events sharing a `groupId` into one row. Only when the list shows
   * every baby — narrowed to one, a pair has a single half on screen.
   */
  combineGroups: boolean;
  /** Babies in display order, so a combined row always lists them the same way. */
  babyOrder: readonly string[];
}

/**
 * The events, grouped by the local calendar day they *started* on (D5: a sleep
 * across midnight is listed once, on its evening).
 *
 * Within a day, the halves of one twin action become a single row placed where
 * its newest half is. Halves on different days — possible only after one was
 * edited — stay separate rows on their own days: a row belongs to one day.
 */
export function buildTimelineDays(
  events: readonly BabyEvent[],
  { timeZone, combineGroups, babyOrder }: BuildDaysOptions,
): TimelineDay[] {
  const days: TimelineDay[] = [];
  const byDate = new Map<LocalDate, TimelineDay>();

  for (const event of [...events].sort(newestFirst)) {
    const date = toLocalDate(new Date(event.startedAt), timeZone);
    let day = byDate.get(date);
    if (day === undefined) {
      const { start, end } = localDayRange(date, timeZone);
      day = { date, start, end, events: [], rows: [] };
      byDate.set(date, day);
      days.push(day);
    }
    day.events.push(event);
  }

  const babyRank = (babyId: string): number => {
    const index = babyOrder.indexOf(babyId);
    return index === -1 ? babyOrder.length : index;
  };

  for (const day of days) {
    const groups = new Map<string, BabyEvent[]>();
    if (combineGroups) {
      for (const event of day.events) {
        if (event.groupId === undefined) continue;
        groups.set(event.groupId, [...(groups.get(event.groupId) ?? []), event]);
      }
    }

    const placed = new Set<string>();
    for (const event of day.events) {
      const members = event.groupId === undefined ? undefined : groups.get(event.groupId);
      if (members === undefined || members.length < 2) {
        day.rows.push({ kind: 'single', key: event.id, event });
        continue;
      }
      if (placed.has(event.groupId as string)) continue;
      placed.add(event.groupId as string);
      day.rows.push({
        kind: 'group',
        key: `group:${event.groupId as string}`,
        events: [...members].sort((a, b) => babyRank(a.babyId) - babyRank(b.babyId)),
      });
    }
  }

  return days;
}

/**
 * Whether every event that started on this day has been loaded.
 *
 * The cursor names the last event the loaded pages reached, and everything after
 * it in (startedAt, id) order is still unloaded. So the day is whole when there
 * are no more pages, or when the cursor is *strictly* before the day's first
 * instant — at exactly that instant, an event with a smaller id could still be
 * waiting on the next page.
 */
export function isDayComplete(dayStart: Date, nextCursor: string | null | undefined): boolean {
  if (nextCursor === null || nextCursor === undefined) return true;
  const cursor = parseEventCursor(nextCursor);
  if (cursor === null) return false;
  return cursor.startedAt.getTime() < dayStart.getTime();
}

/**
 * The instant to ask the API for "sleeps still running" (`activeAt`): the first
 * instant of the oldest complete day on screen. `null` when no day is complete.
 *
 * One read at that instant serves every complete day: a sleep that reaches into
 * a complete day either started inside the loaded window — so it is loaded — or
 * started before this instant and was still running at it.
 */
export function sleepCarryOverAnchor(
  days: readonly TimelineDay[],
  nextCursor: string | null | undefined,
): Date | null {
  let anchor: Date | null = null;
  for (const day of days) {
    if (isDayComplete(day.start, nextCursor)) anchor = day.start;
  }
  return anchor;
}

/** The sleeps running at `anchor`, as the API returned them. */
export interface SleepCarryOver {
  anchor: Date;
  events: readonly BabyEvent[];
}

export interface BabyDaySummary {
  babyId: string;
  /** `null` when the list was filtered to exclude feedings. */
  feedings: number | null;
  /** `null` when sleeps are filtered out. */
  sleepSeconds: number | null;
  diapers: number | null;
}

export interface SummaryContext {
  /** Every loaded event, any day — sleeps from older days overlap newer ones. */
  allEvents: readonly BabyEvent[];
  nextCursor: string | null | undefined;
  /** The types the list was loaded with; every type when absent. */
  types: ReadonlySet<BabyEvent['type']> | undefined;
  /** Required whenever sleeps are shown; without it no summary is complete. */
  carryOver: SleepCarryOver | undefined;
  babyIds: readonly string[];
  timeZone: string;
  now: Date;
}

/**
 * The day's summary for each baby, or `null` if any part of it might be short.
 *
 * Counts follow the list (an event counts on the day it started); sleep follows
 * D5 (each session's overlap with the day, running ones up to `now`). A day is
 * only summarised when its events are all loaded and, if sleep is shown, when
 * the carry-over read covers it — a total that might be missing a session is
 * worse than no total.
 */
export function summariseTimelineDay(
  day: TimelineDay,
  context: SummaryContext,
): BabyDaySummary[] | null {
  const { allEvents, nextCursor, types, carryOver, babyIds, timeZone, now } = context;
  if (!isDayComplete(day.start, nextCursor)) return null;

  const shows = (type: BabyEvent['type']): boolean => types === undefined || types.has(type);
  const showsSleep = shows('SLEEP');
  if (showsSleep && (carryOver === undefined || carryOver.anchor.getTime() > day.start.getTime())) {
    return null;
  }

  return babyIds.map((babyId) => {
    const own = day.events.filter((event) => event.babyId === babyId);

    let sleepSeconds: number | null = null;
    if (showsSleep && carryOver !== undefined) {
      const byId = new Map<string, BabyEvent>();
      for (const event of [...allEvents, ...carryOver.events]) {
        if (event.type === 'SLEEP' && event.babyId === babyId) byId.set(event.id, event);
      }
      sleepSeconds = sleepSecondsInRange([...byId.values()], day.start, day.end, now);
    }

    return {
      babyId,
      feedings: shows('FEEDING')
        ? summariseFeedingDay({ events: own, dayStart: day.start, dayEnd: day.end, timeZone, now })
            .count
        : null,
      sleepSeconds,
      diapers: shows('DIAPER') ? countDiapers(own).total : null,
    };
  });
}
