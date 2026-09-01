import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * Reasons a refresh token stops being usable. `rotated` is the ordinary case;
 * `reuse_detected` marks the tokens killed when a already-rotated token is
 * presented again. `password_changed` is not written yet — the password-change
 * flow that will use it arrives with password reset.
 */
export const REVOKED_REASONS = [
  'rotated',
  'logout',
  'logout_all',
  'reuse_detected',
  'password_changed',
] as const;
export type RevokedReason = (typeof REVOKED_REASONS)[number];

export interface RefreshTokenAttributes {
  userId: Types.ObjectId;
  /** One login. Stable across every rotation, which is what makes a lineage revocable. */
  sessionId: string;
  /** SHA-256 of the opaque token. The token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
  revokedReason?: RevokedReason;
  replacedByHash?: string;
  /** For a future "active sessions" screen. No IP address is stored, by choice. */
  userAgent?: string;
  createdAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshTokenAttributes>;

const refreshTokenSchema = new Schema<RefreshTokenAttributes>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    rotatedAt: { type: Date },
    revokedAt: { type: Date },
    revokedReason: { type: String, enum: [...REVOKED_REASONS] },
    replacedByHash: { type: String },
    userAgent: { type: String, maxlength: 512 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Listing a user's live sessions, and revoking a whole lineage at once.
refreshTokenSchema.index({ userId: 1, sessionId: 1 });
// Mongo reaps expired rows itself. Revoked-but-unexpired rows deliberately
// survive until expiry — they are what makes reuse detection possible.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenAttributes>('RefreshToken', refreshTokenSchema);
