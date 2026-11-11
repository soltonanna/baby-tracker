import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { BabyEvent, BabyEventType, LocalDate } from '@baby-tracker/shared';
import { queryKeys } from '../../services/queryKeys.js';
import { localDayRangeParams } from '../tracker/day.js';
import { fetchFamilyEvents } from './api.js';
import {
  buildTimelineDays,
  mergePages,
  sleepCarryOverAnchor,
  type SleepCarryOver,
  type TimelineDay,
} from './timelineModel.js';

/** What the timeline is narrowed to. Empty `types` means every type. */
export interface TimelineFilters {
  babyId: string | null;
  types: readonly BabyEventType[];
  /** Show the history from the end of this local day backwards. */
  jumpTo: LocalDate | null;
}

/**
 * Events per page. A typical twin day is around thirty events, so the first
 * page shows the last day or two in full.
 */
export const TIMELINE_PAGE_SIZE = 50;

/** The `activeAt` read's own limit: the endpoint's maximum. */
const CARRY_OVER_LIMIT = 200;

/** A carry-over result, labelled with the list it was read for. */
interface CarryOverResult extends SleepCarryOver {
  window: string;
}

export interface TimelineData {
  days: TimelineDay[];
  /** Every loaded event, merged and de-duplicated. */
  events: BabyEvent[];
  /** `undefined` while the first page is still loading. */
  nextCursor: string | null | undefined;
  /** Covers the oldest complete day once read; `undefined` until then. */
  carryOver: SleepCarryOver | undefined;
}

/**
 * The family timeline: paged events and the sleeps that reach into them.
 *
 * Two reads. The list itself, newest first, a page per "Show earlier". And,
 * whenever sleep is shown, the sleeps still running at the first instant of the
 * oldest complete day (`sleepCarryOverAnchor`) — which together with the loaded
 * events is every session that overlaps any complete day.
 *
 * As more pages load, the anchor moves to an older day. Until the new read
 * arrives the previous result is kept, because it is still right for every day
 * at or after its own anchor (`summariseTimelineDay` checks that) — but only for
 * the same list. One read for another baby, or another jump date, says nothing
 * about this one, so it is never carried across.
 */
export function useTimeline(
  familyId: string,
  filters: TimelineFilters,
  timeZone: string,
  /** The family's babies in display order, so a twin row always lists them alike. */
  babyOrder: readonly string[],
) {
  const { babyId, types, jumpTo } = filters;
  const before = jumpTo === null ? undefined : localDayRangeParams(jumpTo, timeZone).to;
  const listParams = {
    ...(babyId === null ? {} : { babyId }),
    ...(types.length === 0 ? {} : { types: [...types].sort() }),
    ...(before === undefined ? {} : { before }),
  };

  const list = useInfiniteQuery({
    queryKey: queryKeys.familyEvents(familyId, listParams),
    queryFn: ({ pageParam }) =>
      fetchFamilyEvents(familyId, {
        ...listParams,
        ...(pageParam === undefined ? {} : { before: pageParam }),
        limit: TIMELINE_PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const pages = list.data?.pages;
  const events = pages === undefined ? [] : mergePages(pages);
  const nextCursor = pages === undefined ? undefined : (pages.at(-1)?.nextCursor ?? null);
  const days = buildTimelineDays(events, {
    timeZone,
    combineGroups: babyId === null,
    babyOrder,
  });

  const showsSleep = types.length === 0 || types.includes('SLEEP');
  const anchor = pages === undefined ? null : sleepCarryOverAnchor(days, nextCursor);
  const window = JSON.stringify({ babyId, before });

  const carryOverQuery = useQuery({
    queryKey: queryKeys.familyEvents(familyId, {
      ...(babyId === null ? {} : { babyId }),
      ...(before === undefined ? {} : { before }),
      activeAt: anchor?.toISOString(),
    }),
    queryFn: async (): Promise<CarryOverResult | null> => {
      const activeAt = anchor as Date;
      const result = await fetchFamilyEvents(familyId, {
        ...(babyId === null ? {} : { babyId }),
        types: ['SLEEP'],
        activeAt: activeAt.toISOString(),
        limit: CARRY_OVER_LIMIT,
      });
      // More running sleeps than one read holds is not a real family's data;
      // if it ever happens, the honest answer is "unknown", not a short total.
      return result.nextCursor === null
        ? { anchor: activeAt, events: result.events, window }
        : null;
    },
    enabled: showsSleep && anchor !== null,
    placeholderData: (previous) => (previous?.window === window ? previous : undefined),
  });

  const carryOver = carryOverQuery.data?.window === window ? carryOverQuery.data : undefined;

  return {
    list,
    data: { days, events, nextCursor, carryOver } satisfies TimelineData,
  };
}
