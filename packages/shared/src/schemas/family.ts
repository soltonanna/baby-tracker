import { z } from 'zod';

/**
 * Family input schemas, shared so the browser form and the API validate against
 * one definition — the same arrangement as the auth schemas.
 */

/** Long enough for "Sultanov family", short enough to render in a header. */
export const familyNameSchema = z.string().trim().min(1, 'Family name is required').max(80);

export const createFamilySchema = z.object({
  name: familyNameSchema,
});

export type CreateFamilyInput = z.infer<typeof createFamilySchema>;
