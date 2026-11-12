import type { Baby as BabyDto } from '@baby-tracker/shared';
import type { BabyDocument } from '../../models/Baby.js';

export function toBaby(baby: BabyDocument): BabyDto {
  return {
    id: baby._id.toString(),
    familyId: baby.familyId.toString(),
    name: baby.name,
    ...(baby.lastName ? { lastName: baby.lastName } : {}),
    ...(baby.birthDate ? { birthDate: baby.birthDate.toISOString() } : {}),
    ...(baby.birthTime ? { birthTime: baby.birthTime } : {}),
    ...(baby.gender ? { gender: baby.gender } : {}),
    ...(baby.birthWeightGrams === undefined ? {} : { birthWeightGrams: baby.birthWeightGrams }),
    ...(baby.birthLengthMm === undefined ? {} : { birthLengthMm: baby.birthLengthMm }),
    ...(baby.notes ? { notes: baby.notes } : {}),
    ...(baby.photoUpdatedAt
      ? { hasPhoto: true, photoUpdatedAt: baby.photoUpdatedAt.toISOString() }
      : {}),
    ...(baby.gestationalAge?.weeks === undefined
      ? {}
      : { gestationalAge: { weeks: baby.gestationalAge.weeks, days: baby.gestationalAge.days } }),
    createdAt: baby.createdAt.toISOString(),
    updatedAt: baby.updatedAt.toISOString(),
  };
}
