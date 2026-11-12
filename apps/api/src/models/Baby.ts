import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  BABY_GENDERS,
  BABY_PHOTO_CONTENT_TYPES,
  BABY_NOTES_MAX,
  GROWTH_LIMITS,
  type BabyGender,
  type BabyPhotoContentType,
  type GestationalAge,
} from '@baby-tracker/shared';

export interface BabyAttributes {
  /** The family the baby belongs to. Every read is filtered by it. */
  familyId: Types.ObjectId;
  /** First name. The only required profile field. */
  name: string;
  lastName?: string;
  birthDate?: Date;
  /** Local time of birth, 'HH:mm'. */
  birthTime?: string;
  gender?: BabyGender;
  /** Weeks + days at birth; under 37 weeks the growth comparison uses corrected age. */
  gestationalAge?: GestationalAge;
  /** Canonical grams / millimetres (D3). */
  birthWeightGrams?: number;
  birthLengthMm?: number;
  notes?: string;
  /**
   * The profile photo, one per baby, stored with it. `select: false` keeps the
   * bytes out of every ordinary read — lists, edits, the tracker — so they are
   * loaded only by the photo endpoint and the export, which ask for them.
   */
  photo?: { data: Buffer; contentType: BabyPhotoContentType };
  /** Set whenever the photo is stored; its presence means "has a photo". */
  photoUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type BabyDocument = HydratedDocument<BabyAttributes> & { _id: Types.ObjectId };

const babySchema = new Schema<BabyAttributes>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80 },
    birthDate: { type: Date },
    birthTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    birthWeightGrams: {
      type: Number,
      min: GROWTH_LIMITS.weightGrams.min,
      max: GROWTH_LIMITS.weightGrams.max,
    },
    birthLengthMm: {
      type: Number,
      min: GROWTH_LIMITS.lengthMm.min,
      max: GROWTH_LIMITS.lengthMm.max,
    },
    notes: { type: String, trim: true, maxlength: BABY_NOTES_MAX },
    photo: {
      type: new Schema(
        {
          data: { type: Buffer, required: true },
          contentType: { type: String, enum: [...BABY_PHOTO_CONTENT_TYPES], required: true },
        },
        { _id: false },
      ),
      select: false,
    },
    photoUpdatedAt: { type: Date },
    gender: { type: String, enum: [...BABY_GENDERS] },
    gestationalAge: {
      type: new Schema<GestationalAge>(
        {
          weeks: { type: Number, required: true, min: 22, max: 44 },
          days: { type: Number, required: true, min: 0, max: 6 },
        },
        { _id: false },
      ),
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.photo;
        return ret;
      },
    },
  },
);

/**
 * One index, for the only access pattern there is: the babies of a family.
 * A single baby is fetched by `{ _id, familyId }`, which this also serves.
 *
 * No uniqueness on name: twins are sometimes given similar names, and the
 * product should not have an opinion about that.
 */
babySchema.index({ familyId: 1 });

export const Baby = model<BabyAttributes>('Baby', babySchema);
