import { z } from 'zod';
import { BABY_GENDERS } from '../constants.js';
import { GROWTH_LIMITS } from './growth.js';

/**
 * Baby input schemas, shared so the browser form and the API validate against
 * one definition — the same arrangement as the family and auth schemas.
 */

/** Trimmed first, so a name of only spaces fails the minimum rather than passing it. */
export const babyNameSchema = z.string().trim().min(1, 'Name is required').max(80);

/**
 * The optional profile facts. Weight and length are canonical grams and
 * millimetres (D3) and share the growth bounds, so a birth weight typed in the
 * wrong unit is caught the same way a measurement is. `birthTime` is the local
 * wall-clock time as 'HH:mm' — a time of day, not an instant, because the baby
 * has no time zone to attach it to.
 */
export const BABY_NOTES_MAX = 2000;

export const babyLastNameSchema = z.string().trim().min(1, 'Last name cannot be empty').max(80);
export const babyBirthTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:mm');
export const babyBirthWeightSchema = z
  .number()
  .int()
  .min(GROWTH_LIMITS.weightGrams.min, 'Out of range for birth weight')
  .max(GROWTH_LIMITS.weightGrams.max, 'Out of range for birth weight');
export const babyBirthLengthSchema = z
  .number()
  .int()
  .min(GROWTH_LIMITS.lengthMm.min, 'Out of range for birth length')
  .max(GROWTH_LIMITS.lengthMm.max, 'Out of range for birth length');
export const babyNotesSchema = z.string().trim().max(BABY_NOTES_MAX);

export const createBabySchema = z.object({
  name: babyNameSchema,
  lastName: babyLastNameSchema.optional(),
  birthTime: babyBirthTimeSchema.optional(),
  birthWeightGrams: babyBirthWeightSchema.optional(),
  birthLengthMm: babyBirthLengthSchema.optional(),
  notes: babyNotesSchema.optional(),
  // `coerce` so a JSON body can send an ISO string; an unparseable value is
  // rejected rather than stored as an Invalid Date.
  birthDate: z.coerce.date().optional(),
  gender: z.enum(BABY_GENDERS).optional(),
});

/**
 * Weeks + days of pregnancy at birth. 22–44 weeks covers every live birth a
 * family would record; anything else is a typing slip.
 */
export const gestationalAgeSchema = z.object({
  weeks: z.number().int().min(22).max(44),
  days: z.number().int().min(0).max(6),
});

/**
 * What an edit may change. The name can be changed but not removed; the
 * optional facts can be cleared with `null`, because "I entered the wrong
 * birth date" and "we'd rather not record this" are both real.
 *
 * `familyId` is not here and never can be: a baby does not move between
 * families.
 */
export const updateBabySchema = z
  .object({
    name: babyNameSchema,
    lastName: babyLastNameSchema.nullable(),
    birthTime: babyBirthTimeSchema.nullable(),
    birthWeightGrams: babyBirthWeightSchema.nullable(),
    birthLengthMm: babyBirthLengthSchema.nullable(),
    notes: babyNotesSchema.nullable(),
    birthDate: z.coerce.date().nullable(),
    gender: z.enum(BABY_GENDERS).nullable(),
    gestationalAge: gestationalAgeSchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'An update must change at least one field',
  });

export type CreateBabyInput = z.infer<typeof createBabySchema>;
export type UpdateBabyInput = z.infer<typeof updateBabySchema>;
