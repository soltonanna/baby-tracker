import type { BabyEventType, FamilyEventListResponse } from '@baby-tracker/shared';
import { apiFetch } from '../../services/apiClient.js';

/** What the timeline asks the family events endpoint for. */
export interface FamilyEventsParams {
  /** One baby only; absent for every baby in the family. */
  babyId?: string;
  /** Absent for every type. */
  types?: readonly BabyEventType[];
  /** A previous page's `nextCursor`, or a bare ISO instant to jump to a date. */
  before?: string;
  /** With `types: ['SLEEP']` only: the sleeps still running at this instant. */
  activeAt?: string;
  limit?: number;
}

/**
 * One page of the family timeline — see `FamilyEventListResponse` for why a
 * page can hold more than `limit` events and why pages are merged by id.
 */
export function fetchFamilyEvents(
  familyId: string,
  params: FamilyEventsParams = {},
): Promise<FamilyEventListResponse> {
  const search = new URLSearchParams();
  if (params.babyId !== undefined) search.set('babyId', params.babyId);
  if (params.types !== undefined && params.types.length > 0) {
    search.set('types', params.types.join(','));
  }
  if (params.before !== undefined) search.set('before', params.before);
  if (params.activeAt !== undefined) search.set('activeAt', params.activeAt);
  if (params.limit !== undefined) search.set('limit', String(params.limit));

  const query = search.toString();
  return apiFetch<FamilyEventListResponse>(
    `/families/${familyId}/events${query.length === 0 ? '' : `?${query}`}`,
  );
}
