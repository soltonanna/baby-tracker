import type {
  Baby,
  BabyEvent,
  BabyEventListResponse,
  BabyListResponse,
  FamilyListResponse,
  FamilyWithRole,
} from '@baby-tracker/shared';
import { apiFetch } from '../../services/apiClient.js';

/** The three reads the Today screen needs. Thin wrappers, like features/auth/api.ts. */

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
