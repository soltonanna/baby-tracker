import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  DEFAULT_UNITS,
  LENGTH_UNITS,
  LOCALES,
  VOLUME_UNITS,
  WEIGHT_UNITS,
  type Locale,
  type UnitPreferences,
} from '@baby-tracker/shared';

export interface UserAttributes {
  email: string;
  passwordHash: string;
  displayName: string;
  locale: Locale;
  timezone: string;
  units: UnitPreferences;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<UserAttributes> & { _id: Types.ObjectId };

const userSchema = new Schema<UserAttributes>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    // Never selected unless a query asks for it by name. Login is the only caller.
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    locale: { type: String, enum: [...LOCALES], default: DEFAULT_LOCALE },
    timezone: { type: String, default: DEFAULT_TIME_ZONE },
    units: {
      weight: { type: String, enum: [...WEIGHT_UNITS], default: DEFAULT_UNITS.weight },
      length: { type: String, enum: [...LENGTH_UNITS], default: DEFAULT_UNITS.length },
      volume: { type: String, enum: [...VOLUME_UNITS], default: DEFAULT_UNITS.volume },
    },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      // Belt and braces alongside `toPublicUser`: even an accidental
      // `res.json(user)` cannot leak the hash.
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

export const User = model<UserAttributes>('User', userSchema);
