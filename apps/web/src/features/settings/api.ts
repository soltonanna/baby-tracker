import type { Baby, BabyResponse } from '@baby-tracker/shared';
import { apiFetch, apiFetchBlob } from '../../services/apiClient.js';

/** Settings' reads and writes: thin wrappers, like features/tracker/api.ts. */

export async function deleteBaby(familyId: string, babyId: string): Promise<void> {
  await apiFetch<null>(`/families/${familyId}/babies/${babyId}`, { method: 'DELETE' });
}

/**
 * Stores or replaces the baby's one photo. The bytes go as the request body
 * with their own type; the API checks them against their signature.
 */
export async function uploadBabyPhoto(
  familyId: string,
  babyId: string,
  image: Blob,
): Promise<Baby> {
  const { baby } = await apiFetch<BabyResponse>(`/families/${familyId}/babies/${babyId}/photo`, {
    method: 'PUT',
    headers: { 'Content-Type': image.type },
    body: image,
  });
  return baby;
}

export async function deleteBabyPhoto(familyId: string, babyId: string): Promise<Baby> {
  const { baby } = await apiFetch<BabyResponse>(`/families/${familyId}/babies/${babyId}/photo`, {
    method: 'DELETE',
  });
  return baby;
}

export function fetchBabyPhoto(familyId: string, babyId: string): Promise<Blob> {
  return apiFetchBlob(`/families/${familyId}/babies/${babyId}/photo`);
}
