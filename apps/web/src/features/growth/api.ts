import type {
  CreateGrowthMeasurementBody,
  GrowthMeasurement,
  GrowthMeasurementListResponse,
  GrowthMeasurementResponse,
  UpdateGrowthMeasurementBody,
} from '@baby-tracker/shared';
import { apiFetch } from '../../services/apiClient.js';

/** The growth screen's reads and writes. Family and baby always travel in the path. */

const growthPath = (familyId: string, babyId: string): string =>
  `/families/${familyId}/babies/${babyId}/growth`;

/** Oldest first, the order a curve is drawn in. */
export async function fetchGrowth(familyId: string, babyId: string): Promise<GrowthMeasurement[]> {
  const { measurements } = await apiFetch<GrowthMeasurementListResponse>(
    growthPath(familyId, babyId),
  );
  return measurements;
}

/** Create when there is no id, PATCH when there is — a verb, as `saveBabyEvent` is. */
export async function saveGrowth(
  familyId: string,
  babyId: string,
  measurementId: string | undefined,
  body: CreateGrowthMeasurementBody | UpdateGrowthMeasurementBody,
): Promise<GrowthMeasurement> {
  const path =
    measurementId === undefined
      ? growthPath(familyId, babyId)
      : `${growthPath(familyId, babyId)}/${measurementId}`;
  const { measurement } = await apiFetch<GrowthMeasurementResponse>(path, {
    method: measurementId === undefined ? 'POST' : 'PATCH',
    body: JSON.stringify(body),
  });
  return measurement;
}

export async function deleteGrowth(
  familyId: string,
  babyId: string,
  measurementId: string,
): Promise<void> {
  await apiFetch<null>(`${growthPath(familyId, babyId)}/${measurementId}`, { method: 'DELETE' });
}
