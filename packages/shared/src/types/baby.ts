import type { BabyGender } from '../constants.js';
import type { Id, IsoDateTime } from './common.js';

/** A baby, as it crosses the wire. */
export interface Baby {
  id: Id;
  /** The family the baby belongs to — and the boundary that guards it. */
  familyId: Id;
  name: string;
  birthDate?: IsoDateTime;
  gender?: BabyGender;
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
