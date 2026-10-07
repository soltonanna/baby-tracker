import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { GROWTH_LIMITS, MEASUREMENT_SOURCES, type MeasurementSource } from '@baby-tracker/shared';

/**
 * One measurement visit for one baby: any of weight, length and head
 * circumference taken on the same day.
 *
 * A collection of its own rather than a tracker event type
 * (ARCHITECTURE_PROPOSAL.md §5.6): growth is read as a baby's whole series,
 * oldest first, never by day, and one record carries up to three values — as
 * an event it would have forced the `data` union the tracker has deliberately
 * put off.
 *
 * Canonical units only (D3). No z-score or percentile is stored: those depend
 * on the baby's birth date, sex and gestational age, which can be corrected
 * later, so they are derived where they are shown.
 *
 * Soft-deleted (§4.5): a deleted measurement keeps its row with `deletedAt`
 * set, and every query excludes it. Baby data is not removed by one tap.
 */
export interface GrowthMeasurementAttributes {
  familyId: Types.ObjectId;
  babyId: Types.ObjectId;
  /** Calendar date as UTC midnight — the convention `Baby.birthDate` uses. */
  measuredOn: Date;
  weightGrams?: number;
  lengthMm?: number;
  headCircumferenceMm?: number;
  source?: MeasurementSource;
  note?: string;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type GrowthMeasurementDocument = HydratedDocument<GrowthMeasurementAttributes> & {
  _id: Types.ObjectId;
};

const bounded = (limits: { min: number; max: number }) => ({ type: Number, ...limits });

const growthMeasurementSchema = new Schema<GrowthMeasurementAttributes>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    babyId: { type: Schema.Types.ObjectId, ref: 'Baby', required: true },
    measuredOn: { type: Date, required: true },
    weightGrams: bounded(GROWTH_LIMITS.weightGrams),
    lengthMm: bounded(GROWTH_LIMITS.lengthMm),
    headCircumferenceMm: bounded(GROWTH_LIMITS.headCircumferenceMm),
    source: { type: String, enum: [...MEASUREMENT_SOURCES] },
    note: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** A baby's live series in date order — the only read there is. */
growthMeasurementSchema.index({ babyId: 1, deletedAt: 1, measuredOn: 1 });

export const GrowthMeasurement = model<GrowthMeasurementAttributes>(
  'GrowthMeasurement',
  growthMeasurementSchema,
);
