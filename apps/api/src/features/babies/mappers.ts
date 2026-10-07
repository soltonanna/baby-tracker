import type { Baby as BabyDto } from '@baby-tracker/shared';
import type { BabyDocument } from '../../models/Baby.js';

export function toBaby(baby: BabyDocument): BabyDto {
  return {
    id: baby._id.toString(),
    familyId: baby.familyId.toString(),
    name: baby.name,
    ...(baby.birthDate ? { birthDate: baby.birthDate.toISOString() } : {}),
    ...(baby.gender ? { gender: baby.gender } : {}),
    ...(baby.gestationalAge?.weeks === undefined
      ? {}
      : { gestationalAge: { weeks: baby.gestationalAge.weeks, days: baby.gestationalAge.days } }),
    createdAt: baby.createdAt.toISOString(),
    updatedAt: baby.updatedAt.toISOString(),
  };
}
