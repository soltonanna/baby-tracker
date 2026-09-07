import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { BABY_GENDERS, type BabyGender } from '@baby-tracker/shared';

export interface BabyAttributes {
  /** The family the baby belongs to. Every read is filtered by it. */
  familyId: Types.ObjectId;
  name: string;
  birthDate?: Date;
  gender?: BabyGender;
  createdAt: Date;
  updatedAt: Date;
}

export type BabyDocument = HydratedDocument<BabyAttributes> & { _id: Types.ObjectId };

const babySchema = new Schema<BabyAttributes>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    birthDate: { type: Date },
    gender: { type: String, enum: [...BABY_GENDERS] },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
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
