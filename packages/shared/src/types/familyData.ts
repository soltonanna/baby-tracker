import type { BabyEventType, BabyGender, MeasurementSource } from '../constants.js';
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
  birthDate?: IsoDateTime;
  gender?: BabyGender;
  gestationalAge?: GestationalAge;
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

export interface FamilyDataExport {
  format: typeof FAMILY_DATA_FORMAT;
  version: typeof FAMILY_DATA_VERSION;
  exportedAt: IsoDateTime;
  babies: FamilyDataBaby[];
  events: FamilyDataEvent[];
  measurements: FamilyDataMeasurement[];
}

/** How many records an import wrote, or a clear removed. */
export interface FamilyDataCounts {
  babies: number;
  events: number;
  measurements: number;
}

/** Returned by POST /families/:familyId/data/import. */
export interface FamilyDataImportResponse {
  imported: FamilyDataCounts;
}

/** Returned by DELETE /families/:familyId/data. */
export interface FamilyDataClearResponse {
  deleted: FamilyDataCounts;
}
