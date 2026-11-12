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
  /** The first name — required, and the only required field of the profile. */
  name: string;
  lastName?: string;
  birthDate?: IsoDateTime;
  /** Local time of birth, 'HH:mm'. */
  birthTime?: string;
  gender?: BabyGender;
  gestationalAge?: GestationalAge;
  /** Canonical grams (D3); shown in the parent's unit. */
  birthWeightGrams?: number;
  /** Canonical millimetres (D3). */
  birthLengthMm?: number;
  notes?: string;
  /**
   * Whether a profile photo is stored. The image itself is never part of this
   * object; it is fetched from the photo endpoint. `photoUpdatedAt` changes on
   * every replace, so it doubles as the cache-busting version of the image.
   */
  hasPhoto?: boolean;
  photoUpdatedAt?: IsoDateTime;
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
