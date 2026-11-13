import { Types, type QueryFilter } from 'mongoose';
import {
  healthRecordRuleIssues,
  type CreateHealthRecordInput,
  type HealthCategory,
  type HealthRecord as HealthRecordDto,
  type ListHealthRecordsQuery,
  type UpdateHealthRecordInput,
} from '@baby-tracker/shared';
import { Baby } from '../../models/Baby.js';
import { HealthRecord, type HealthRecordAttributes } from '../../models/HealthRecord.js';
import { notFound, unprocessable } from '../../lib/httpError.js';
import type { FamilyScope } from '../../middleware/familyAccess.js';
import type { BabyScope } from '../../middleware/babyAccess.js';
import { toHealthRecord } from './mappers.js';

/**
 * Same shape as the growth service: every function takes the resolved family
 * and baby scopes, never ids from a body; `familyId` is in every filter as a
 * second guard; deleted rows are invisible to everything here.
 */

const MS_PER_DAY = 86_400_000;

/** One 404 for a malformed, missing, deleted, sibling's or other family's id. */
function scopedFilter(
  family: FamilyScope,
  baby: BabyScope,
  recordId: string,
): QueryFilter<HealthRecordAttributes> {
  if (!Types.ObjectId.isValid(recordId)) {
    throw notFound('Health record not found');
  }
  return { _id: recordId, familyId: family.familyId, babyId: baby.babyId, deletedAt: null };
}

/**
 * Not more than a day ahead (UTC: the parent's calendar day can be ahead of
 * UTC's, and Yerevan is four hours ahead) and not before the baby's birth date
 * — a day of slack there too, because a birth in the small hours local time is
 * still the previous day in UTC. A planned appointment is a `nextDueOn`, not a
 * record.
 */
async function assertPlausibleDate(baby: BabyScope, occurredAt: Date): Promise<void> {
  if (occurredAt.getTime() > Date.now() + MS_PER_DAY) {
    throw unprocessable('A health record cannot be dated in the future', { field: 'occurredAt' });
  }
  const stored = await Baby.findById(baby.babyId, { birthDate: 1 }).lean();
  if (stored?.birthDate && occurredAt.getTime() < stored.birthDate.getTime() - MS_PER_DAY) {
    throw unprocessable('A health record cannot be dated before the baby was born', {
      field: 'occurredAt',
    });
  }
}

const OPTIONAL_FIELDS = [
  'purpose',
  'description',
  'doseValue',
  'doseUnit',
  'productName',
  'manufacturer',
  'provider',
  'note',
  'nextDueOn',
  'scheduleKey',
  'catalogVersion',
] as const;

export async function createRecord(
  family: FamilyScope,
  baby: BabyScope,
  input: CreateHealthRecordInput,
): Promise<HealthRecordDto> {
  await assertPlausibleDate(baby, input.occurredAt);

  const optional: Record<string, unknown> = {};
  for (const field of OPTIONAL_FIELDS) {
    const value = input[field];
    if (value !== undefined && value !== '') optional[field] = value;
  }

  const doc = await HealthRecord.create({
    familyId: family.familyId,
    babyId: baby.babyId,
    category: input.category,
    occurredAt: input.occurredAt,
    name: input.name,
    ...optional,
    createdBy: family.userId,
  });
  return toHealthRecord(doc);
}

/**
 * The baby's live history, newest first. Unpaginated: a child has a few dozen
 * records in the first years. Date filters are inclusive calendar dates read as
 * UTC days — the web app filters by the family's own time zone on what it has
 * loaded, so this is for other clients and is exact to the day, not the hour.
 */
export async function listRecords(
  family: FamilyScope,
  baby: BabyScope,
  query: ListHealthRecordsQuery,
): Promise<HealthRecordDto[]> {
  const filter: QueryFilter<HealthRecordAttributes> = {
    familyId: family.familyId,
    babyId: baby.babyId,
    deletedAt: null,
  };
  if (query.category) filter.category = query.category;
  if (query.from || query.to) {
    filter.occurredAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lt: new Date(query.to.getTime() + MS_PER_DAY) } : {}),
    };
  }
  const docs = await HealthRecord.find(filter).sort({ occurredAt: -1, createdAt: -1 });
  return docs.map(toHealthRecord);
}

/**
 * A patch: absent means unchanged, `null` means remove. The cross-field rules
 * are checked on the record as it *would be* after the patch.
 */
export async function updateRecord(
  family: FamilyScope,
  baby: BabyScope,
  recordId: string,
  patch: UpdateHealthRecordInput,
): Promise<HealthRecordDto> {
  const doc = await HealthRecord.findOne(scopedFilter(family, baby, recordId));
  if (!doc) {
    throw notFound('Health record not found');
  }

  if (patch.occurredAt) {
    await assertPlausibleDate(baby, patch.occurredAt);
    doc.occurredAt = patch.occurredAt;
  }
  if (patch.category) doc.category = patch.category;
  if (patch.name) doc.name = patch.name;

  for (const field of OPTIONAL_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    // `set(field, undefined)` makes Mongoose `$unset` the path on save.
    doc.set(field, value === null || value === '' ? undefined : value);
  }

  const issues = healthRecordRuleIssues({
    category: doc.category as HealthCategory,
    occurredAt: doc.occurredAt,
    doseValue: doc.doseValue,
    doseUnit: doc.doseUnit,
    nextDueOn: doc.nextDueOn,
    scheduleKey: doc.scheduleKey,
    catalogVersion: doc.catalogVersion,
  });
  if (issues[0]) {
    throw unprocessable(issues[0].message, { field: issues[0].path });
  }

  doc.updatedBy = new Types.ObjectId(family.userId);
  await doc.save();
  return toHealthRecord(doc);
}

/** Soft delete. A second delete of the same id is a 404, like any deleted row. */
export async function deleteRecord(
  family: FamilyScope,
  baby: BabyScope,
  recordId: string,
): Promise<void> {
  const result = await HealthRecord.updateOne(scopedFilter(family, baby, recordId), {
    $set: { deletedAt: new Date(), updatedBy: new Types.ObjectId(family.userId) },
  });
  if (result.matchedCount === 0) {
    throw notFound('Health record not found');
  }
}
