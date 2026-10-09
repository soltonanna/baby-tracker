/**
 * A day of feedings, summarised — and the nappies beside them.
 *
 * Pure functions over the events a client already holds, so the Today screen
 * needs no new endpoint and the same arithmetic can serve an analytics page or
 * the API later without being written twice.
 *
 * **What this deliberately does not do.** It never decides whether a baby has
 * had enough. A breastfeed has no measured volume, so the only volume this adds
 * up is what was given from a bottle, and it is reported as exactly that — the
 * measured bottle volume — never as a baby's intake. Counts, intervals and the
 * spread across the day are neutral facts; reading them together with nappies,
 * weight and how the baby seems is the parent's and the paediatrician's job,
 * not this function's (project rules §7).
 */

import { DIAPER_KINDS, FEEDING_KINDS, type DiaperKind, type FeedingKind } from './constants.js';
import { durationSeconds, timeZoneOffsetMs } from './time.js';
import type { BabyEvent } from './types/babyEvent.js';

/** The fields the summary reads; a full `BabyEvent` satisfies it. */
export type SummaryEvent = Pick<
  BabyEvent,
  'type' | 'startedAt' | 'endedAt' | 'amount' | 'details' | 'feeding'
>;

/** Four fixed parts of a local day, by the clock hour a feeding started in. */
export const DAY_PERIODS = ['night', 'morning', 'afternoon', 'evening'] as const;
export type DayPeriod = (typeof DAY_PERIODS)[number];

/** night 00–06, morning 06–12, afternoon 12–18, evening 18–24. */
export function dayPeriodOfHour(hour: number): DayPeriod {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** A feeding's kind, or `unspecified` for one recorded before kinds existed. */
export type FeedingKindOrUnspecified = FeedingKind | 'unspecified';

export interface FeedingMark {
  startedAt: string;
  kind: FeedingKindOrUnspecified;
  /** Where in the day it started, 0 (first instant) to just under 1. */
  position: number;
  period: DayPeriod;
}

export interface IntervalStats {
  /** Every gap between consecutive feeding starts, in whole minutes. */
  minutes: number[];
  averageMinutes: number;
  shortestMinutes: number;
  longestMinutes: number;
}

export interface FeedingDaySummary {
  count: number;
  byKind: Record<FeedingKindOrUnspecified, number>;
  /**
   * Measured bottle volume in millilitres. `unspecified` is the volume of
   * feedings recorded before kinds existed — they were bottles with an amount.
   * `total` is their sum, and is `0` with `measuredFeedings: 0` when nothing
   * was measured, which the UI says in words rather than as "0 ml".
   */
  volumeMl: { expressed_milk: number; formula: number; unspecified: number; total: number };
  /** How many feedings the volume above comes from. */
  measuredFeedings: number;
  /** Total minutes of the breastfeeds whose end was recorded. */
  breastMinutes: number;
  /** How many breastfeeds that total covers — not every one has an end. */
  breastFeedsWithDuration: number;
  /** `null` when there are fewer than two feedings to measure between. */
  intervals: IntervalStats | null;
  /** Minutes from the last feeding to `now`; `null` with no feeding to count from. */
  minutesSinceLast: number | null;
  /** Each feeding, in time order, placed on the day. */
  marks: FeedingMark[];
  byPeriod: Record<DayPeriod, number>;
}

export interface FeedingSummaryInput {
  /** The day's events, any order, any types; only FEEDING is read. */
  events: readonly SummaryEvent[];
  /** The local day, as the half-open interval [start, end). */
  dayStart: Date;
  dayEnd: Date;
  timeZone: string;
  /**
   * When the last feeding *before* this day started, if there was one. It makes
   * the day's first interval a real gap rather than nothing: a 01:30 feeding
   * after one at 22:45 is 2 h 45 min apart, whatever the calendar says.
   */
  previousFeedingAt?: string | undefined;
  /** The clock, for "time since last"; injected so tests do not depend on it. */
  now: Date;
}

const MS_PER_MINUTE = 60_000;

const kindOf = (event: SummaryEvent): FeedingKindOrUnspecified =>
  event.feeding?.kind ?? 'unspecified';

function localHour(instant: Date, timeZone: string): number {
  return new Date(instant.getTime() + timeZoneOffsetMs(instant, timeZone)).getUTCHours();
}

const emptyByKind = (): Record<FeedingKindOrUnspecified, number> => ({
  ...(Object.fromEntries(FEEDING_KINDS.map((kind) => [kind, 0])) as Record<FeedingKind, number>),
  unspecified: 0,
});

const emptyByPeriod = (): Record<DayPeriod, number> =>
  Object.fromEntries(DAY_PERIODS.map((period) => [period, 0])) as Record<DayPeriod, number>;

/**
 * The gaps between consecutive starts, in minutes, oldest first.
 *
 * Start to start, which is how feeding intervals are usually counted and the
 * only measure available for every kind — a bottle has no end time here.
 */
export function feedingIntervals(startsMs: readonly number[]): IntervalStats | null {
  if (startsMs.length < 2) {
    return null;
  }
  const minutes: number[] = [];
  for (let index = 1; index < startsMs.length; index += 1) {
    const current = startsMs[index] as number;
    const previous = startsMs[index - 1] as number;
    minutes.push(Math.round((current - previous) / MS_PER_MINUTE));
  }
  const total = minutes.reduce((sum, value) => sum + value, 0);
  return {
    minutes,
    averageMinutes: Math.round(total / minutes.length),
    shortestMinutes: Math.min(...minutes),
    longestMinutes: Math.max(...minutes),
  };
}

export function summariseFeedingDay(input: FeedingSummaryInput): FeedingDaySummary {
  const { dayStart, dayEnd, timeZone, now } = input;
  const dayLength = dayEnd.getTime() - dayStart.getTime();

  const feedings = input.events
    .filter((event) => event.type === 'FEEDING')
    .slice()
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

  const byKind = emptyByKind();
  const byPeriod = emptyByPeriod();
  const volumeMl = { expressed_milk: 0, formula: 0, unspecified: 0, total: 0 };
  let measuredFeedings = 0;
  let breastSeconds = 0;
  let breastFeedsWithDuration = 0;
  const marks: FeedingMark[] = [];

  for (const event of feedings) {
    const kind = kindOf(event);
    const started = new Date(event.startedAt);
    byKind[kind] += 1;

    // Breastfeeds are refused an amount by the schema; checked here as well so
    // that no stored oddity could ever turn into an invented volume.
    if (kind !== 'breast' && event.amount !== undefined) {
      volumeMl[kind] += event.amount;
      volumeMl.total += event.amount;
      measuredFeedings += 1;
    }

    if (kind === 'breast' && event.endedAt !== undefined) {
      breastSeconds += durationSeconds(started, new Date(event.endedAt));
      breastFeedsWithDuration += 1;
    }

    const period = dayPeriodOfHour(localHour(started, timeZone));
    byPeriod[period] += 1;
    const offset = started.getTime() - dayStart.getTime();
    marks.push({
      startedAt: event.startedAt,
      kind,
      position: dayLength > 0 ? Math.min(Math.max(offset / dayLength, 0), 0.9999) : 0,
      period,
    });
  }

  const starts = feedings.map((event) => Date.parse(event.startedAt));
  const previous =
    input.previousFeedingAt === undefined ? undefined : Date.parse(input.previousFeedingAt);
  const first = starts[0];
  const withCarryOver =
    previous !== undefined && Number.isFinite(previous) && first !== undefined && previous < first
      ? [previous, ...starts]
      : starts;

  const last = starts.length > 0 ? starts[starts.length - 1] : previous;
  const minutesSinceLast =
    last === undefined || !Number.isFinite(last) || now.getTime() < last
      ? null
      : Math.floor((now.getTime() - last) / MS_PER_MINUTE);

  return {
    count: feedings.length,
    byKind,
    volumeMl,
    measuredFeedings,
    breastMinutes: Math.round(breastSeconds / 60),
    breastFeedsWithDuration,
    intervals: feedingIntervals(withCarryOver),
    minutesSinceLast,
    marks,
    byPeriod,
  };
}

export interface DiaperDayCounts {
  /** Every nappy change recorded. */
  total: number;
  /** Changes with urine: `wet` and `wet_and_dirty`. */
  wet: number;
  /** Changes with stool: `dirty` and `wet_and_dirty`. */
  dirty: number;
}

/**
 * Wet and dirty nappies, counted the way a paediatrician asks about them: a
 * nappy that was both counts once towards each.
 */
export function countDiapers(events: readonly SummaryEvent[]): DiaperDayCounts {
  const counts: DiaperDayCounts = { total: 0, wet: 0, dirty: 0 };
  for (const event of events) {
    if (event.type !== 'DIAPER') continue;
    counts.total += 1;
    const kind = (DIAPER_KINDS as readonly string[]).includes(event.details ?? '')
      ? (event.details as DiaperKind)
      : undefined;
    if (kind === 'wet' || kind === 'wet_and_dirty') counts.wet += 1;
    if (kind === 'dirty' || kind === 'wet_and_dirty') counts.dirty += 1;
  }
  return counts;
}
