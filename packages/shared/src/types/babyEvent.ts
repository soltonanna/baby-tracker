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
