import { Types, type QueryFilter } from 'mongoose';
import {
  MEASUREMENT_FIELDS,
  type CreateGrowthMeasurementInput,
  type GrowthMeasurement as GrowthMeasurementDto,
  type UpdateGrowthMeasurementInput,
} from '@baby-tracker/shared';
import { Baby } from '../../models/Baby.js';
import {
  GrowthMeasurement,
  type GrowthMeasurementAttributes,
} from '../../models/GrowthMeasurement.js';
import { notFound, unprocessable } from '../../lib/httpError.js';
import type { FamilyScope } from '../../middleware/familyAccess.js';
import type { BabyScope } from '../../middleware/babyAccess.js';
import { toGrowthMeasurement } from './mappers.js';

/**
 * Same shape as the events service: every function takes the resolved family
 * and baby scopes, never ids from a body, and `familyId` is in every filter as
 * a second guard. Deleted rows are invisible to everything here.
 */

const MS_PER_DAY = 86_400_000;

/**
 * One 404 for a malformed, missing, deleted, sibling's or other family's id,
 * so nothing can be learned by probing (ARCHITECTURE_PROPOSAL.md §4.3).
 */
function scopedFilter(
  family: FamilyScope,
  baby: BabyScope,
  measurementId: string,
): QueryFilter<GrowthMeasurementAttributes> {
  if (!Types.ObjectId.isValid(measurementId)) {
    throw notFound('Measurement not found');
  }
  return { _id: measurementId, familyId: family.familyId, babyId: baby.babyId, deletedAt: null };
}

/**
 * The date rules that need stored state, so cannot live in the schema.
 *
 * Not after tomorrow (UTC): "tomorrow" rather than "today" because the parent's
 * calendar day can be ahead of UTC's — Yerevan is four hours ahead — and a
 * measurement taken this morning must not be refused. Not before the baby's
 * birth date, when one is recorded: a date before birth is always a slip.
 */
async function assertPlausibleDate(baby: BabyScope, measuredOn: Date): Promise<void> {
  const latestAllowed = Date.now() + MS_PER_DAY;
  if (measuredOn.getTime() > latestAllowed) {
    throw unprocessable('A measurement cannot be dated in the future', {
      field: 'measuredOn',
    });
  }
  const stored = await Baby.findById(baby.babyId, { birthDate: 1 }).lean();
  if (stored?.birthDate && measuredOn.getTime() < stored.birthDate.getTime()) {
    throw unprocessable('A measurement cannot be dated before the baby was born', {
      field: 'measuredOn',
    });
  }
}

export async function createMeasurement(
  family: FamilyScope,
  baby: BabyScope,
  input: CreateGrowthMeasurementInput,
): Promise<GrowthMeasurementDto> {
  await assertPlausibleDate(baby, input.measuredOn);

  const doc = await GrowthMeasurement.create({
    familyId: family.familyId,
    babyId: baby.babyId,
    measuredOn: input.measuredOn,
    ...(input.weightGrams === undefined ? {} : { weightGrams: input.weightGrams }),
    ...(input.lengthMm === undefined ? {} : { lengthMm: input.lengthMm }),
    ...(input.headCircumferenceMm === undefined
      ? {}
      : { headCircumferenceMm: input.headCircumferenceMm }),
    ...(input.source ? { source: input.source } : {}),
    ...(input.note ? { note: input.note } : {}),
    createdBy: family.userId,
  });

  return toGrowthMeasurement(doc);
}

/**
 * The baby's whole live series, oldest first — the order a curve is drawn in
 * and "change since the previous measurement" is read in. Unpaginated: a baby
 * is measured perhaps twenty times in two years.
 */
export async function listMeasurements(
  family: FamilyScope,
  baby: BabyScope,
): Promise<GrowthMeasurementDto[]> {
  const docs = await GrowthMeasurement.find({
    familyId: family.familyId,
    babyId: baby.babyId,
    deletedAt: null,
  }).sort({ measuredOn: 1, createdAt: 1 });

  return docs.map(toGrowthMeasurement);
}

/**
 * A patch: absent means unchanged, `null` means remove. The record must still
 * hold at least one of the three values afterwards — a measurement of nothing
 * is not a measurement, and the way to get rid of one is delete.
 */
export async function updateMeasurement(
  family: FamilyScope,
  baby: BabyScope,
  measurementId: string,
  patch: UpdateGrowthMeasurementInput,
): Promise<GrowthMeasurementDto> {
  const doc = await GrowthMeasurement.findOne(scopedFilter(family, baby, measurementId));
  if (!doc) {
    throw notFound('Measurement not found');
  }

  if (patch.measuredOn) {
    await assertPlausibleDate(baby, patch.measuredOn);
    doc.measuredOn = patch.measuredOn;
  }

  for (const field of [...MEASUREMENT_FIELDS, 'source', 'note'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    // `set(field, undefined)` makes Mongoose `$unset` the path on save.
    doc.set(field, value === null ? undefined : value);
  }

  if (!MEASUREMENT_FIELDS.some((field) => typeof doc[field] === 'number')) {
    throw unprocessable(
      'A measurement must keep at least one of weight, length or head circumference',
    );
  }

  doc.updatedBy = new Types.ObjectId(family.userId);
  await doc.save();

  return toGrowthMeasurement(doc);
}

/** Soft delete. A second delete of the same id is a 404, like any deleted row. */
export async function deleteMeasurement(
  family: FamilyScope,
  baby: BabyScope,
  measurementId: string,
): Promise<void> {
  const result = await GrowthMeasurement.updateOne(scopedFilter(family, baby, measurementId), {
    $set: { deletedAt: new Date(), updatedBy: new Types.ObjectId(family.userId) },
  });
  if (result.matchedCount === 0) {
    throw notFound('Measurement not found');
  }
}
