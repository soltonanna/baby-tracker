import type { BabyEventType } from '../constants.js';
import type { Id, IsoDateTime } from './common.js';

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
