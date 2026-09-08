import type {
  Baby,
  BabyEvent,
  BabyEventListResponse,
  BabyEventResponse,
  BabyEventType,
  BabyListResponse,
  FamilyListResponse,
  FamilyWithRole,
  IsoDateTime,
} from '@baby-tracker/shared';
import { apiFetch } from '../../services/apiClient.js';

/** The Today screen's reads and its one write. Thin wrappers, like features/auth/api.ts. */

export async function fetchFamilies(): Promise<FamilyWithRole[]> {
  const { families } = await apiFetch<FamilyListResponse>('/families');
  return families;
}

export async function fetchBabies(familyId: string): Promise<Baby[]> {
  const { babies } = await apiFetch<BabyListResponse>(`/families/${familyId}/babies`);
  return babies;
}

export async function fetchBabyEvents(familyId: string, babyId: string): Promise<BabyEvent[]> {
  const { events } = await apiFetch<BabyEventListResponse>(
    `/families/${familyId}/babies/${babyId}/events`,
  );
  return events;
}

/**
 * What the API accepts in the body of a create.
 *
 * No `familyId` or `babyId`: the API takes both from the path and resolves them
 * through the membership chain, and ignores anything the client claims.
 */
export interface CreateBabyEventPayload {
  type: BabyEventType;
  startedAt: IsoDateTime;
  details?: string;
}

export async function createBabyEvent(
  familyId: string,
  babyId: string,
  payload: CreateBabyEventPayload,
): Promise<BabyEvent> {
  const { event } = await apiFetch<BabyEventResponse>(
    `/families/${familyId}/babies/${babyId}/events`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return event;
}
