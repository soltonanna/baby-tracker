import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { BABY_EVENT_TYPES, type BabyEventType } from '@baby-tracker/shared';

/**
 * One collection for every kind of tracker event.
 *
 * A feeding, a sleep, a nappy change and a note differ in which optional fields
 * they use, not in what they are: something that happened to a baby at a time.
 * Separate collections would mean a separate model, route and query for each,
 * and a timeline would have to merge them back together.
 */
export interface BabyEventAttributes {
  familyId: Types.ObjectId;
  babyId: Types.ObjectId;
  type: BabyEventType;
  /** When it happened, or began. The axis everything is ordered by. */
  startedAt: Date;
  endedAt?: Date;
  amount?: number;
  unit?: string;
  details?: string;
  /** Shared by events created by one action — the two documents of a twin entry. */
  groupId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type BabyEventDocument = HydratedDocument<BabyEventAttributes> & { _id: Types.ObjectId };

const babyEventSchema = new Schema<BabyEventAttributes>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    babyId: { type: Schema.Types.ObjectId, ref: 'Baby', required: true },
    type: { type: String, enum: [...BABY_EVENT_TYPES], required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
    amount: { type: Number, min: 0 },
    unit: { type: String, trim: true, maxlength: 16 },
    details: { type: String, trim: true, maxlength: 1000 },
    groupId: { type: String, trim: true, maxlength: 64 },
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
 * The tracker's own query: a baby's events, newest first. `familyId` is also in
 * every filter as a second guard, but it would add nothing to the index —
 * `babyId` already narrows to a single baby. The same index serves the day
 * range Today asks for, which is a bound on `startedAt` within one baby.
 */
babyEventSchema.index({ babyId: 1, startedAt: -1 });

/**
 * The twin pair, as `ARCHITECTURE_PROPOSAL.md` §5.5 plans it.
 *
 * **Sparse**, which is the whole reason it is affordable: only the documents
 * written by a both-babies action carry a `groupId`, so the index covers those
 * and ignores every ordinary event. Added now that the action that writes the
 * field exists — finding the sibling of a grouped event is the one lookup a
 * grouped edit or delete will make, and reconstructing a group without it would
 * mean a collection scan.
 */
babyEventSchema.index({ groupId: 1 }, { sparse: true });

export const BabyEvent = model<BabyEventAttributes>('BabyEvent', babyEventSchema);
