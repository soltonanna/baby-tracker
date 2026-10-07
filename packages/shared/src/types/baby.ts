import type { BabyGender } from '../constants.js';
import type { Id, IsoDateTime } from './common.js';

/**
 * Completed weeks and days of pregnancy at birth, e.g. 35+4. Optional; when it
 * is under 37 weeks the WHO comparison uses corrected age (see `growth/who.ts`).
 */
export interface GestationalAge {
  weeks: number;
  days: number;
}

/** A baby, as it crosses the wire. */
export interface Baby {
  id: Id;
  /** The family the baby belongs to — and the boundary that guards it. */
  familyId: Id;
  name: string;
  birthDate?: IsoDateTime;
  gender?: BabyGender;
  gestationalAge?: GestationalAge;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Returned by POST and GET of a single baby. */
export interface BabyResponse {
  baby: Baby;
}

/** Returned by GET /families/:familyId/babies. */
export interface BabyListResponse {
  babies: Baby[];
}
