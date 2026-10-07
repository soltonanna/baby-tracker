import type { MeasurementSource } from '../constants.js';
import type { Id, IsoDateTime } from './common.js';

/**
 * One measurement visit, as it crosses the wire. Values are canonical (grams,
 * millimetres); at least one of the three is present.
 *
 * No z-score or percentile here, on purpose: those are derived from the baby's
 * birth date, sex and gestational age, all of which can be corrected later, so
 * they are computed where they are shown (`compareWithWho`) and never stored.
 */
export interface GrowthMeasurement {
  id: Id;
  familyId: Id;
  babyId: Id;
  /** Calendar date as UTC midnight, like `Baby.birthDate`. */
  measuredOn: IsoDateTime;
  weightGrams?: number;
  lengthMm?: number;
  headCircumferenceMm?: number;
  source?: MeasurementSource;
  note?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface GrowthMeasurementResponse {
  measurement: GrowthMeasurement;
}

/** Oldest first — the order a growth curve is drawn in. */
export interface GrowthMeasurementListResponse {
  measurements: GrowthMeasurement[];
}
