import type {
  Baby,
  BabyEvent,
  BabyEventListResponse,
  BabyEventResponse,
  BabyEventType,
  BabyListResponse,
  CreateFamilyInput,
  FamilyListResponse,
  FamilyResponse,
  FamilyWithRole,
  IsoDateTime,
} from '@baby-tracker/shared';
import { apiFetch } from '../../services/apiClient.js';

/** The Today screen's reads and writes. Thin wrappers, like features/auth/api.ts. */

export async function fetchFamilies(): Promise<FamilyWithRole[]> {
  const { families } = await apiFetch<FamilyListResponse>('/families');
  return families;
}

/**
 * Creates the caller's family. The API makes them its OWNER; no role is sent.
 */
export async function createFamily(input: CreateFamilyInput): Promise<FamilyWithRole> {
  const { family } = await apiFetch<FamilyResponse>('/families', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return family;
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
  /** Only for events that have a length, such as a sleep. */
  endedAt?: IsoDateTime;
  amount?: number;
  unit?: string;
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
