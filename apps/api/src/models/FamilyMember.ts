import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { FAMILY_ROLES, type FamilyRole } from '@baby-tracker/shared';

export interface FamilyMemberAttributes {
  familyId: Types.ObjectId;
  userId: Types.ObjectId;
  role: FamilyRole;
  createdAt: Date;
  updatedAt: Date;
}

export type FamilyMemberDocument = HydratedDocument<FamilyMemberAttributes> & {
  _id: Types.ObjectId;
};

const familyMemberSchema = new Schema<FamilyMemberAttributes>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: [...FAMILY_ROLES], required: true },
  },
  // Full timestamps rather than the RefreshToken's createdAt-only: a membership
  // is mutable — its role changes when roles become editable — so knowing when
  // it last changed will matter.
  { timestamps: true },
);

/**
 * Two indexes, each earning its place.
 *
 * The compound one is both the correctness constraint — a user cannot hold two
 * memberships in the same family — and the hottest query in the system, the
 * "may this user touch this family?" lookup that every family-scoped request
 * performs.
 */
familyMemberSchema.index({ familyId: 1, userId: 1 }, { unique: true });

/**
 * "Which families do I belong to?" filters on userId alone, which the compound
 * index above cannot serve: its leading field is familyId.
 */
familyMemberSchema.index({ userId: 1 });

export const FamilyMember = model<FamilyMemberAttributes>('FamilyMember', familyMemberSchema);
