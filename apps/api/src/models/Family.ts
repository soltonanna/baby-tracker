import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface FamilyAttributes {
  name: string;
  /**
   * Who created it. Recorded for provenance only — access is decided by
   * FamilyMember, never by this field, so that ownership can move later
   * without rewriting the authorization rules.
   */
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type FamilyDocument = HydratedDocument<FamilyAttributes> & { _id: Types.ObjectId };

const familySchema = new Schema<FamilyAttributes>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
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
 * No index beyond `_id`.
 *
 * Families are never searched: every read starts from the caller's memberships
 * and fetches families by `_id`. An index on `createdBy` would look sensible
 * and serve nothing.
 */
export const Family = model<FamilyAttributes>('Family', familySchema);
