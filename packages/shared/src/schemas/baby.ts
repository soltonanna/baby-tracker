import { z } from 'zod';
import { BABY_GENDERS } from '../constants.js';

/**
 * Baby input schemas, shared so the browser form and the API validate against
 * one definition — the same arrangement as the family and auth schemas.
 */

/** Trimmed first, so a name of only spaces fails the minimum rather than passing it. */
export const babyNameSchema = z.string().trim().min(1, 'Name is required').max(80);

export const createBabySchema = z.object({
  name: babyNameSchema,
  // `coerce` so a JSON body can send an ISO string; an unparseable value is
  // rejected rather than stored as an Invalid Date.
  birthDate: z.coerce.date().optional(),
  gender: z.enum(BABY_GENDERS).optional(),
});

export type CreateBabyInput = z.infer<typeof createBabySchema>;
