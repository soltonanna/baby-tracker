import type { BabyEventType, BreastSide } from '../constants.js';
import type { Id, IsoDateTime } from './common.js';

/**
 * What kind of feeding a FEEDING event was. Mirrors `feedingDataSchema`; a
 * breastfeed may say which side, a bottle never does.
 */
export type FeedingData =
  { kind: 'breast'; side?: BreastSide } | { kind: 'expressed_milk' } | { kind: 'formula' };

/** A daily tracker event, as it crosses the wire. */
export interface BabyEvent {
  id: Id;
  familyId: Id;
  babyId: Id;
  type: BabyEventType;
  startedAt: IsoDateTime;
  endedAt?: IsoDateTime;
  amount?: number;
  unit?: string;
  details?: string;
  /** FEEDING only, and absent on feedings recorded before kinds existed. */
  feeding?: FeedingData;
  /** Shared by events created together — the two documents of a twin action. */
  groupId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface BabyEventResponse {
  event: BabyEvent;
}

export interface BabyEventListResponse {
  events: BabyEvent[];
}

/**
 * A page of the family timeline.
 *
 * `events` is the page — at most `limit` events, newest first by `startedAt`
 * then id — **plus** the twin siblings of any grouped event in it, wherever they
 * sort. So a pair is never split by a page boundary, and `events.length` may
 * exceed `limit`.
 *
 * `nextCursor` is taken from the page's own last event, never from an added
 * sibling, so nothing older is skipped. The price is that a sibling which sorts
 * after the boundary is sent again by the page that reaches it: a client merges
 * pages by event id. `null` when there is nothing older.
 */
export interface FamilyEventListResponse {
  events: BabyEvent[];
  nextCursor: string | null;
}

/**
 * The events one action wrote for more than one baby, and the id that links
 * them.
 *
 * Not a stored record: there is no group collection and no group model. A group
 * is exactly “the events carrying this `groupId`” (decision D2), and this is how
 * the API answers the request that created them — the two ordinary events, plus
 * the id a future “apply to both” operation would address them by.
 */
export interface BabyEventGroup {
  groupId: string;
  events: BabyEvent[];
}

export interface BabyEventGroupResponse {
  group: BabyEventGroup;
}
