import { Types } from 'mongoose';
import {
  BABY_PHOTO_MAX_BYTES,
  type Baby as BabyDto,
  type BabyPhotoContentType,
  type CreateBabyInput,
  type UpdateBabyInput,
} from '@baby-tracker/shared';
import { Baby } from '../../models/Baby.js';
import { BabyEvent } from '../../models/BabyEvent.js';
import { GrowthMeasurement } from '../../models/GrowthMeasurement.js';
import { HttpError, notFound, unprocessable } from '../../lib/httpError.js';
import { detectImageType } from '../../lib/imageType.js';
import { inTransaction } from '../familyData/service.js';
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
    ...(input.lastName ? { lastName: input.lastName } : {}),
    ...(input.birthDate ? { birthDate: input.birthDate } : {}),
    ...(input.birthTime ? { birthTime: input.birthTime } : {}),
    ...(input.gender ? { gender: input.gender } : {}),
    ...(input.birthWeightGrams === undefined ? {} : { birthWeightGrams: input.birthWeightGrams }),
    ...(input.birthLengthMm === undefined ? {} : { birthLengthMm: input.birthLengthMm }),
    ...(input.notes ? { notes: input.notes } : {}),
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
  for (const field of [
    'lastName',
    'birthDate',
    'birthTime',
    'gender',
    'gestationalAge',
    'birthWeightGrams',
    'birthLengthMm',
    'notes',
  ] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    // An empty string is "cleared" too: notes may be saved as '' by a form.
    baby.set(field, value === null || value === '' ? undefined : value);
  }

  await baby.save();
  return toBaby(baby);
}

/**
 * Deletes one baby and everything recorded about them — events and growth
 * measurements, soft-deleted ones included — in one transaction, so a failure
 * part-way leaves the baby whole rather than half-erased.
 *
 * Children first, babies last, the order the family reset uses. The baby is
 * matched by `{ _id, familyId }` before anything is removed, so another
 * family's baby is the same 404 as a missing one and nothing of theirs is
 * touched. This is a hard delete on purpose, like the reset: the caller has
 * confirmed it, and a soft-deleted baby would keep a child's data around that
 * the parent asked to remove.
 */
export async function deleteBaby(scope: FamilyScope, babyId: string): Promise<void> {
  if (!Types.ObjectId.isValid(babyId)) {
    throw notFound('Baby not found');
  }

  await inTransaction(async (session) => {
    const exists = await Baby.exists({ _id: babyId, familyId: scope.familyId }).session(session);
    if (!exists) {
      throw notFound('Baby not found');
    }
    await BabyEvent.deleteMany({ babyId, familyId: scope.familyId }, { session });
    await GrowthMeasurement.deleteMany({ babyId, familyId: scope.familyId }, { session });
    await Baby.deleteOne({ _id: babyId, familyId: scope.familyId }, { session });
  });
}

export interface StoredPhoto {
  data: Buffer;
  contentType: BabyPhotoContentType;
  updatedAt: Date;
}

/**
 * Stores or replaces the baby's one profile photo. The bytes are checked
 * against their own signature rather than the request's header, and the type
 * that is stored is the one detected.
 */
export async function setBabyPhoto(
  scope: FamilyScope,
  babyId: string,
  bytes: Buffer,
): Promise<BabyDto> {
  if (!Types.ObjectId.isValid(babyId)) {
    throw notFound('Baby not found');
  }
  if (bytes.length === 0) {
    throw unprocessable('The image is empty');
  }
  if (bytes.length > BABY_PHOTO_MAX_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The image is too large');
  }
  const contentType = detectImageType(bytes);
  if (contentType === null) {
    throw unprocessable('The file is not a JPEG, PNG or WebP image');
  }

  const baby = await Baby.findOneAndUpdate(
    { _id: babyId, familyId: scope.familyId },
    { $set: { photo: { data: bytes, contentType }, photoUpdatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!baby) {
    throw notFound('Baby not found');
  }
  return toBaby(baby);
}

export async function removeBabyPhoto(scope: FamilyScope, babyId: string): Promise<BabyDto> {
  if (!Types.ObjectId.isValid(babyId)) {
    throw notFound('Baby not found');
  }
  const baby = await Baby.findOneAndUpdate(
    { _id: babyId, familyId: scope.familyId },
    { $unset: { photo: '', photoUpdatedAt: '' } },
    { returnDocument: 'after' },
  );
  if (!baby) {
    throw notFound('Baby not found');
  }
  return toBaby(baby);
}

/** The photo's bytes, or 404 for no photo / no such baby / another family's baby. */
export async function getBabyPhoto(scope: FamilyScope, babyId: string): Promise<StoredPhoto> {
  if (!Types.ObjectId.isValid(babyId)) {
    throw notFound('Baby not found');
  }
  const baby = await Baby.findOne({ _id: babyId, familyId: scope.familyId }).select(
    '+photo photoUpdatedAt',
  );
  if (!baby?.photo || !baby.photoUpdatedAt) {
    throw notFound('Photo not found');
  }
  return {
    data: Buffer.from(baby.photo.data),
    contentType: baby.photo.contentType,
    updatedAt: baby.photoUpdatedAt,
  };
}
