import { z } from 'zod';
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE, LOCALES } from '../constants.js';

/**
 * Authentication input schemas.
 *
 * These live in the shared package so the browser form and the API validate
 * against one definition. Nothing secret and nothing Node-only may appear here.
 */

const SUPPORTED_TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

/** Trimmed and lowercased before validation, so '  A@B.com ' and 'a@b.com' are one account. */
export const emailSchema = z.string().trim().max(254).toLowerCase().pipe(z.email());

/**
 * Length over composition. The 128-character ceiling is not cosmetic: an
 * unbounded password is a denial-of-service vector against a deliberately
 * expensive key-derivation function.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const displayNameSchema = z.string().trim().min(1).max(80);

export const localeSchema = z.enum(LOCALES);

export const timeZoneSchema = z
  .string()
  .refine((value) => SUPPORTED_TIME_ZONES.has(value), 'Unknown IANA time zone');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  locale: localeSchema.default(DEFAULT_LOCALE),
  timezone: timeZoneSchema.default(DEFAULT_TIME_ZONE),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
