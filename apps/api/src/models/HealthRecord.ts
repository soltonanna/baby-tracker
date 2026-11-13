import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  HEALTH_CATEGORIES,
  HEALTH_DOSE_UNITS,
  HEALTH_LIMITS,
  type HealthCategory,
  type HealthDoseUnit,
} from '@baby-tracker/shared';

/**
 * One medical event for one baby: a vaccination, checkup, laboratory test,
 * procedure or medication. A collection of its own, as growth is — it is read
 * as a baby's whole history, never by day, and has a shape no tracker event
 * has.
 *
 * **Self-contained by design.** The record stores its own name, date, dose and
 * product. `scheduleKey` and `catalogVersion` only point at the immunization
 * catalog (`@baby-tracker/shared`), and are deliberately not validated against
 * it: revising the catalog must never change, invalidate or orphan a record
 * someone made earlier.
 *
 * No dose is ever computed or suggested; `doseValue`/`doseUnit` are what the
 * parent typed from the label or the paediatrician's instruction.
 *
 * Soft-deleted (§4.5), like growth: a deleted record keeps its row with
 * `deletedAt` set, and every query excludes it.
 */
export interface HealthRecordAttributes {
  familyId: Types.ObjectId;
  babyId: Types.ObjectId;
  category: HealthCategory;
  occurredAt: Date;
  name: string;
  purpose?: string;
  description?: string;
  doseValue?: number;
  doseUnit?: HealthDoseUnit;
  productName?: string;
  manufacturer?: string;
  provider?: string;
  note?: string;
  /** Calendar date as UTC midnight — the convention `Baby.birthDate` uses. */
  nextDueOn?: Date;
  scheduleKey?: string;
  catalogVersion?: string;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type HealthRecordDocument = HydratedDocument<HealthRecordAttributes> & {
  _id: Types.ObjectId;
};

const text = (maxlength: number) => ({ type: String, trim: true, maxlength });

const healthRecordSchema = new Schema<HealthRecordAttributes>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    babyId: { type: Schema.Types.ObjectId, ref: 'Baby', required: true },
    category: { type: String, enum: [...HEALTH_CATEGORIES], required: true },
    occurredAt: { type: Date, required: true },
    name: { ...text(HEALTH_LIMITS.name), required: true },
    purpose: text(HEALTH_LIMITS.text),
    description: text(HEALTH_LIMITS.text),
    doseValue: { type: Number, min: 0 },
    doseUnit: { type: String, enum: [...HEALTH_DOSE_UNITS] },
    productName: text(HEALTH_LIMITS.name),
    manufacturer: text(HEALTH_LIMITS.name),
    provider: text(HEALTH_LIMITS.name),
    note: text(HEALTH_LIMITS.note),
    nextDueOn: { type: Date },
    scheduleKey: text(64),
    catalogVersion: text(32),
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** A baby's live history, newest first — the only read there is. */
healthRecordSchema.index({ babyId: 1, deletedAt: 1, occurredAt: -1 });

export const HealthRecord = model<HealthRecordAttributes>('HealthRecord', healthRecordSchema);
