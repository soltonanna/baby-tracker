import { Types } from 'mongoose';
import type { Baby as BabyDto, CreateBabyInput, UpdateBabyInput } from '@baby-tracker/shared';
import { Baby } from '../../models/Baby.js';
import { notFound } from '../../lib/httpError.js';
import type { FamilyScope } from '../../middleware/familyAccess.js';
import { toBaby } from './mappers.js';

/**
 * Every function takes the resolved family scope rather than a familyId, so the
 * family a baby is written to or read from is always the one the caller's
 * membership was checked against — never a value from the request body.
 */

export async function createBaby(scope: FamilyScope, input: CreateBabyInput): Promise<BabyDto> {
  const baby = await Baby.create({
    familyId: scope.familyId,
    name: input.name,
    ...(input.birthDate ? { birthDate: input.birthDate } : {}),
    ...(input.gender ? { gender: input.gender } : {}),
  });

  return toBaby(baby);
}

export async function listBabies(scope: FamilyScope): Promise<BabyDto[]> {
  const babies = await Baby.find({ familyId: scope.familyId }).sort({ createdAt: 1 });
  return babies.map(toBaby);
}

/**
 * One baby, filtered by the caller's family as well as its id.
 *
 * That filter is the whole cross-family protection: a baby id from another
 * family simply does not match, and answers 404 like an id that never existed.
 * A malformed id gets the same answer rather than a distinct parse error, so
 * nothing can be learned by probing.
 */
export async function getBaby(scope: FamilyScope, babyId: string): Promise<BabyDto> {
  if (!Types.ObjectId.isValid(babyId)) {
    throw notFound('Baby not found');
  }

  const baby = await Baby.findOne({ _id: babyId, familyId: scope.familyId });
  if (!baby) {
    throw notFound('Baby not found');
  }

  return toBaby(baby);
}

/**
 * Edit a baby. Absent means unchanged; `null` clears an optional fact.
 *
 * Found by `{ _id, familyId }`, so another family's baby is the same 404 as a
 * missing one. Nothing derived is stored anywhere that would need updating
 * after a correction: growth percentiles are computed from these fields when
 * shown, so fixing a birth date fixes every comparison at once.
 */
export async function updateBaby(
  scope: FamilyScope,
  babyId: string,
  patch: UpdateBabyInput,
): Promise<BabyDto> {
  if (!Types.ObjectId.isValid(babyId)) {
    throw notFound('Baby not found');
  }

  const baby = await Baby.findOne({ _id: babyId, familyId: scope.familyId });
  if (!baby) {
    throw notFound('Baby not found');
  }

  if (patch.name !== undefined) baby.name = patch.name;
  for (const field of ['birthDate', 'gender', 'gestationalAge'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    baby.set(field, value === null ? undefined : value);
  }

  await baby.save();
  return toBaby(baby);
}
