import type { HealthRecord as HealthRecordDto } from '@baby-tracker/shared';
import type { HealthRecordDocument } from '../../models/HealthRecord.js';

export function toHealthRecord(doc: HealthRecordDocument): HealthRecordDto {
  return {
    id: doc._id.toString(),
    familyId: doc.familyId.toString(),
    babyId: doc.babyId.toString(),
    category: doc.category,
    occurredAt: doc.occurredAt.toISOString(),
    name: doc.name,
    ...(doc.purpose ? { purpose: doc.purpose } : {}),
    ...(doc.description ? { description: doc.description } : {}),
    ...(typeof doc.doseValue === 'number' ? { doseValue: doc.doseValue } : {}),
    ...(doc.doseUnit ? { doseUnit: doc.doseUnit } : {}),
    ...(doc.productName ? { productName: doc.productName } : {}),
    ...(doc.manufacturer ? { manufacturer: doc.manufacturer } : {}),
    ...(doc.provider ? { provider: doc.provider } : {}),
    ...(doc.note ? { note: doc.note } : {}),
    ...(doc.nextDueOn ? { nextDueOn: doc.nextDueOn.toISOString().slice(0, 10) } : {}),
    ...(doc.scheduleKey ? { scheduleKey: doc.scheduleKey } : {}),
    ...(doc.catalogVersion ? { catalogVersion: doc.catalogVersion } : {}),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
