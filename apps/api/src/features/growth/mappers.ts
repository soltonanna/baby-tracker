import type { GrowthMeasurement as GrowthMeasurementDto } from '@baby-tracker/shared';
import type { GrowthMeasurementDocument } from '../../models/GrowthMeasurement.js';

export function toGrowthMeasurement(doc: GrowthMeasurementDocument): GrowthMeasurementDto {
  return {
    id: doc._id.toString(),
    familyId: doc.familyId.toString(),
    babyId: doc.babyId.toString(),
    measuredOn: doc.measuredOn.toISOString(),
    ...(typeof doc.weightGrams === 'number' ? { weightGrams: doc.weightGrams } : {}),
    ...(typeof doc.lengthMm === 'number' ? { lengthMm: doc.lengthMm } : {}),
    ...(typeof doc.headCircumferenceMm === 'number'
      ? { headCircumferenceMm: doc.headCircumferenceMm }
      : {}),
    ...(doc.source ? { source: doc.source } : {}),
    ...(doc.note ? { note: doc.note } : {}),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
