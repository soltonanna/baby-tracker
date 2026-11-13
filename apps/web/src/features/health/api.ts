import type {
  CreateHealthRecordBody,
  HealthRecord,
  HealthRecordListResponse,
  HealthRecordResponse,
  UpdateHealthRecordBody,
} from '@baby-tracker/shared';
import { apiFetch } from '../../services/apiClient.js';

/** The health screens' reads and writes. Family and baby always travel in the path. */

const healthPath = (familyId: string, babyId: string): string =>
  `/families/${familyId}/babies/${babyId}/health`;

/** Newest first. The whole history: it is small, and filtering happens in the browser. */
export async function fetchHealthRecords(
  familyId: string,
  babyId: string,
): Promise<HealthRecord[]> {
  const { records } = await apiFetch<HealthRecordListResponse>(healthPath(familyId, babyId));
  return records;
}

/** Create when there is no id, PATCH when there is — as `saveGrowth` is. */
export async function saveHealthRecord(
  familyId: string,
  babyId: string,
  recordId: string | undefined,
  body: CreateHealthRecordBody | UpdateHealthRecordBody,
): Promise<HealthRecord> {
  const path =
    recordId === undefined
      ? healthPath(familyId, babyId)
      : `${healthPath(familyId, babyId)}/${recordId}`;
  const { record } = await apiFetch<HealthRecordResponse>(path, {
    method: recordId === undefined ? 'POST' : 'PATCH',
    body: JSON.stringify(body),
  });
  return record;
}

export async function deleteHealthRecord(
  familyId: string,
  babyId: string,
  recordId: string,
): Promise<void> {
  await apiFetch<null>(`${healthPath(familyId, babyId)}/${recordId}`, { method: 'DELETE' });
}
