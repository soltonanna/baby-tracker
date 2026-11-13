import type { HealthCategory, HealthDoseUnit } from '../constants.js';
import type { Id, IsoDateTime, LocalDate } from './common.js';

/**
 * One medical event, as it crosses the wire. Everything optional except the
 * category, the instant and the name is exactly what the parent typed.
 *
 * `scheduleKey` / `catalogVersion` are a pointer into the immunization catalog
 * and nothing more: the record is complete without the catalog, so revising
 * the catalog never changes what a record says.
 */
export interface HealthRecord {
  id: Id;
  familyId: Id;
  babyId: Id;
  category: HealthCategory;
  occurredAt: IsoDateTime;
  name: string;
  purpose?: string;
  description?: string;
  doseValue?: number;
  doseUnit?: HealthDoseUnit;
  productName?: string;
  manufacturer?: string;
  provider?: string;
  note?: string;
  /** Next recommended date or follow-up, a calendar date. */
  nextDueOn?: LocalDate;
  scheduleKey?: string;
  catalogVersion?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface HealthRecordResponse {
  record: HealthRecord;
}

/** Newest first — a history reads from the latest back. */
export interface HealthRecordListResponse {
  records: HealthRecord[];
}
