import type {
  FamilyDataClearResponse,
  FamilyDataCounts,
  FamilyDataExport,
  FamilyDataImportResponse,
} from '@baby-tracker/shared';
import { apiFetch } from '../../services/apiClient.js';

/** Export, import and reset of the children's data. The family travels in the path. */

const dataPath = (familyId: string): string => `/families/${familyId}/data`;

export function fetchFamilyDataExport(familyId: string): Promise<FamilyDataExport> {
  return apiFetch<FamilyDataExport>(`${dataPath(familyId)}/export`);
}

/**
 * Sends the file as it was read, not as the client's schema re-shaped it: the
 * server validates the same schema itself, and dates then reach it exactly as
 * they were written in the file.
 */
export async function importFamilyData(
  familyId: string,
  fileContents: string,
): Promise<FamilyDataCounts> {
  const { imported } = await apiFetch<FamilyDataImportResponse>(`${dataPath(familyId)}/import`, {
    method: 'POST',
    body: fileContents,
  });
  return imported;
}

export async function clearFamilyData(familyId: string): Promise<FamilyDataCounts> {
  const { deleted } = await apiFetch<FamilyDataClearResponse>(dataPath(familyId), {
    method: 'DELETE',
  });
  return deleted;
}

/** Hands a JSON document to the browser as a file to save. */
export function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: some browsers start the download asynchronously.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
