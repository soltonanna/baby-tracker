import type {
  BabyEventType,
  BabyGender,
  HealthCategory,
  HealthDoseUnit,
  MeasurementSource,
} from '../constants.js';
import type {
  ImmunizationScheduleItem,
  ImmunizationSource,
  ImmunizationVaccine,
} from '../immunization/catalog.js';
import type { IsoDateTime, LocalDate } from './common.js';
import type { GestationalAge } from './baby.js';
import type { FAMILY_DATA_FORMAT, FAMILY_DATA_VERSION } from '../schemas/familyData.js';

/**
 * The family data file as the export writes it. Every reference is the
 * file-local baby `id`; nothing in it is a database id the importer must trust.
 */
export interface FamilyDataBaby {
  id: string;
  name: string;
  lastName?: string;
  birthDate?: IsoDateTime;
  birthTime?: string;
  gender?: BabyGender;
  gestationalAge?: GestationalAge;
  birthWeightGrams?: number;
  birthLengthMm?: number;
  notes?: string;
  photo?: { contentType: string; data: string };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface FamilyDataEvent {
  babyId: string;
  type: BabyEventType;
  startedAt: IsoDateTime;
  endedAt?: IsoDateTime;
  amount?: number;
  unit?: string;
  details?: string;
  groupId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface FamilyDataMeasurement {
  babyId: string;
  measuredOn: LocalDate;
  weightGrams?: number;
  lengthMm?: number;
  headCircumferenceMm?: number;
  source?: MeasurementSource;
  note?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface FamilyDataHealthRecord {
  babyId: string;
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
  nextDueOn?: LocalDate;
  scheduleKey?: string;
  catalogVersion?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * The immunization reference the records were made against, written into every
 * export so a backup can still be read after the catalog is revised. Read-only
 * documentation: an import ignores it, and a record never depends on it.
 */
export interface FamilyDataImmunizationReference {
  catalogVersion: string;
  reviewedOn: LocalDate;
  sources: readonly ImmunizationSource[];
  vaccines: readonly ImmunizationVaccine[];
  schedule: readonly ImmunizationScheduleItem[];
}

export interface FamilyDataExport {
  format: typeof FAMILY_DATA_FORMAT;
  version: typeof FAMILY_DATA_VERSION;
  exportedAt: IsoDateTime;
  babies: FamilyDataBaby[];
  events: FamilyDataEvent[];
  measurements: FamilyDataMeasurement[];
  healthRecords: FamilyDataHealthRecord[];
  immunizationReference: FamilyDataImmunizationReference;
}

/** How many records an import wrote, or a clear removed. */
export interface FamilyDataCounts {
  babies: number;
  events: number;
  measurements: number;
  healthRecords: number;
}

/** Returned by POST /families/:familyId/data/import. */
export interface FamilyDataImportResponse {
  imported: FamilyDataCounts;
}

/** Returned by DELETE /families/:familyId/data. */
export interface FamilyDataClearResponse {
  deleted: FamilyDataCounts;
}
