import mongoose, { Types, type ClientSession } from 'mongoose';
import {
  FAMILY_DATA_FORMAT,
  FAMILY_DATA_VERSION,
  type FamilyDataCounts,
  type FamilyDataExport,
  type FamilyDataInput,
} from '@baby-tracker/shared';
import { Baby } from '../../models/Baby.js';
import { BabyEvent } from '../../models/BabyEvent.js';
import { GrowthMeasurement } from '../../models/GrowthMeasurement.js';
import type { FamilyScope } from '../../middleware/familyAccess.js';
import { toFeedingData } from '../events/mappers.js';

/**
 * Export, import and clear of a family's *children's* data: babies, tracker
 * events and growth measurements.
 *
 * Deliberately outside every per-baby router. These operations act on the
 * family as a whole, and the account side of it — the user, the family,
 * memberships, refresh tokens — is never read or written here, so a reset or a
 * bad file cannot sign anyone out or change who belongs to the family.
 *
 * Every query is filtered by the resolved `familyId` and nothing else; no id
 * from a file or a body ever reaches a filter.
 */

const toCalendarDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * The family's data as a portable file. Babies are referred to by their
 * current id, which in the file is just a label; an import maps it to whatever
 * new id the baby gets.
 *
 * Soft-deleted measurements are left out: they are already gone from the
 * parent's point of view, and a restore should not bring them back.
 */
export async function exportFamilyData(family: FamilyScope): Promise<FamilyDataExport> {
  const familyId = family.familyId;
  const [babies, events, measurements] = await Promise.all([
    Baby.find({ familyId }).sort({ createdAt: 1 }).lean(),
    BabyEvent.find({ familyId }).sort({ startedAt: 1, createdAt: 1 }).lean(),
    GrowthMeasurement.find({ familyId, deletedAt: null })
      .sort({ measuredOn: 1, createdAt: 1 })
      .lean(),
  ]);

  return {
    format: FAMILY_DATA_FORMAT,
    version: FAMILY_DATA_VERSION,
    exportedAt: new Date().toISOString(),
    babies: babies.map((baby) => ({
      id: baby._id.toString(),
      name: baby.name,
      ...(baby.birthDate ? { birthDate: baby.birthDate.toISOString() } : {}),
      ...(baby.gender ? { gender: baby.gender } : {}),
      ...(baby.gestationalAge?.weeks === undefined
        ? {}
        : {
            gestationalAge: { weeks: baby.gestationalAge.weeks, days: baby.gestationalAge.days },
          }),
      createdAt: baby.createdAt.toISOString(),
      updatedAt: baby.updatedAt.toISOString(),
    })),
    events: events.map((event) => {
      const feeding = toFeedingData(event.feeding);
      return {
        babyId: event.babyId.toString(),
        type: event.type,
        startedAt: event.startedAt.toISOString(),
        ...(event.endedAt ? { endedAt: event.endedAt.toISOString() } : {}),
        ...(event.amount === undefined ? {} : { amount: event.amount }),
        ...(event.unit ? { unit: event.unit } : {}),
        ...(event.details ? { details: event.details } : {}),
        ...(feeding ? { feeding } : {}),
        ...(event.groupId ? { groupId: event.groupId } : {}),
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
      };
    }),
    measurements: measurements.map((m) => ({
      babyId: m.babyId.toString(),
      measuredOn: toCalendarDate(m.measuredOn),
      ...(m.weightGrams === undefined ? {} : { weightGrams: m.weightGrams }),
      ...(m.lengthMm === undefined ? {} : { lengthMm: m.lengthMm }),
      ...(m.headCircumferenceMm === undefined
        ? {}
        : { headCircumferenceMm: m.headCircumferenceMm }),
      ...(m.source ? { source: m.source } : {}),
      ...(m.note ? { note: m.note } : {}),
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  };
}

/** Removes the family's children's data inside an already-open transaction. */
async function deleteChildrenData(
  familyId: string,
  session: ClientSession,
): Promise<FamilyDataCounts> {
  // Children first, babies last: were this ever run without a transaction, an
  // interruption would leave babies with no events rather than events with no baby.
  const events = await BabyEvent.deleteMany({ familyId }, { session });
  const measurements = await GrowthMeasurement.deleteMany({ familyId }, { session });
  const babies = await Baby.deleteMany({ familyId }, { session });
  return {
    babies: babies.deletedCount,
    events: events.deletedCount,
    measurements: measurements.deletedCount,
  };
}

async function inTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      // Assigned inside: `withTransaction` may re-run the callback after a
      // transient error, and only the run that commits counts.
      result = await work(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

/**
 * Hard-deletes every baby, event and growth measurement of the family —
 * including soft-deleted measurements, because the point is a clean slate.
 *
 * A hard delete on purpose, unlike growth's per-row soft delete: this is the
 * explicit "reset" a parent confirms in the UI, typically after exporting.
 * One transaction, so a failure part-way leaves everything as it was.
 */
export async function clearFamilyData(family: FamilyScope): Promise<FamilyDataCounts> {
  return inTransaction((session) => deleteChildrenData(family.familyId, session));
}

/**
 * Replaces the family's children's data with the file's.
 *
 * **Replace, not merge.** Importing the same file twice must not double every
 * feeding, and a merge would turn twins into four babies, which the both-babies
 * action refuses. So the existing data is removed and the file's is written,
 * in one transaction: a file that fails half-way changes nothing.
 *
 * **New identities.** Every baby gets a new ObjectId and the file's ids are
 * mapped to them; the family and the importing user come from the scope. A file
 * therefore cannot address another family's records, whatever ids it contains.
 *
 * **Timestamps.** `createdAt`/`updatedAt` from the file are kept, so a restored
 * backup reads like the original — including the babies' order, which the
 * tracker takes from `createdAt`. Rows without them get "now", with babies a
 * millisecond apart so the file's order is still the tracker's order.
 */
export async function importFamilyData(
  family: FamilyScope,
  data: FamilyDataInput,
): Promise<FamilyDataCounts> {
  const familyId = new Types.ObjectId(family.familyId);
  const userId = new Types.ObjectId(family.userId);
  const now = Date.now();

  const babyIdByRef = new Map<string, Types.ObjectId>();
  const babyDocs = data.babies.map((baby, index) => {
    const _id = new Types.ObjectId();
    babyIdByRef.set(baby.id, _id);
    const createdAt = baby.createdAt ?? new Date(now + index);
    return {
      _id,
      familyId,
      name: baby.name,
      ...(baby.birthDate ? { birthDate: baby.birthDate } : {}),
      ...(baby.gender ? { gender: baby.gender } : {}),
      ...(baby.gestationalAge ? { gestationalAge: baby.gestationalAge } : {}),
      createdAt,
      updatedAt: baby.updatedAt ?? createdAt,
    };
  });

  // The schema has already checked every reference resolves; this keeps the
  // types honest without a non-null assertion.
  const babyIdOf = (ref: string): Types.ObjectId => {
    const id = babyIdByRef.get(ref);
    if (!id) throw new Error(`Unresolved baby reference "${ref}"`);
    return id;
  };

  const eventDocs = data.events.map((event) => {
    const createdAt = event.createdAt ?? new Date(now);
    return {
      familyId,
      babyId: babyIdOf(event.babyId),
      type: event.type,
      startedAt: event.startedAt,
      ...(event.endedAt ? { endedAt: event.endedAt } : {}),
      ...(event.amount === undefined ? {} : { amount: event.amount }),
      ...(event.unit ? { unit: event.unit } : {}),
      ...(event.details ? { details: event.details } : {}),
      ...(event.feeding ? { feeding: event.feeding } : {}),
      ...(event.groupId ? { groupId: event.groupId } : {}),
      createdAt,
      updatedAt: event.updatedAt ?? createdAt,
    };
  });

  const measurementDocs = data.measurements.map((m) => {
    const createdAt = m.createdAt ?? new Date(now);
    return {
      familyId,
      babyId: babyIdOf(m.babyId),
      measuredOn: m.measuredOn,
      ...(m.weightGrams === undefined ? {} : { weightGrams: m.weightGrams }),
      ...(m.lengthMm === undefined ? {} : { lengthMm: m.lengthMm }),
      ...(m.headCircumferenceMm === undefined
        ? {}
        : { headCircumferenceMm: m.headCircumferenceMm }),
      ...(m.source ? { source: m.source } : {}),
      ...(m.note ? { note: m.note } : {}),
      createdBy: userId,
      deletedAt: null,
      createdAt,
      updatedAt: m.updatedAt ?? createdAt,
    };
  });

  return inTransaction(async (session) => {
    await deleteChildrenData(family.familyId, session);
    // `timestamps: false` so the file's dates are stored rather than replaced
    // with now. Mongoose still validates every document against its schema.
    const options = { session, timestamps: false, ordered: true } as const;
    if (babyDocs.length > 0) await Baby.insertMany(babyDocs, options);
    if (eventDocs.length > 0) await BabyEvent.insertMany(eventDocs, options);
    if (measurementDocs.length > 0) await GrowthMeasurement.insertMany(measurementDocs, options);
    return {
      babies: babyDocs.length,
      events: eventDocs.length,
      measurements: measurementDocs.length,
    };
  });
}
