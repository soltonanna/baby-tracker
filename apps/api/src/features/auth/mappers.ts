import type { PublicUser } from '@baby-tracker/shared';
import type { UserDocument } from '../../models/User.js';

/**
 * The only place a user document becomes a wire DTO.
 *
 * One function to audit is better than five call sites that each have to
 * remember not to include the password hash.
 */
export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    timezone: user.timezone,
    units: {
      weight: user.units.weight,
      length: user.units.length,
      volume: user.units.volume,
    },
    createdAt: user.createdAt.toISOString(),
    ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt.toISOString() } : {}),
  };
}
