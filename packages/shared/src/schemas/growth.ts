import { z } from 'zod';
import { MEASUREMENT_SOURCES } from '../constants.js';

/**
 * Growth measurement input schemas.
 *
 * Values arrive in canonical units only (decision D3): grams and millimetres,
 * whole numbers. The form converts kg / cm / lb / in once, at the UI edge.
 *
 * The bounds are a typing guard, not a medical judgement. They are wide enough
 * for any real infant record and only catch a value typed in the wrong unit or
 * with a slipped finger — 35 kg meant as 3.5, 5 cm meant as 50.
 */
export const GROWTH_LIMITS = {
  weightGrams: { min: 300, max: 30_000 },
  lengthMm: { min: 200, max: 1_300 },
  headCircumferenceMm: { min: 150, max: 600 },
} as const;

/**
 * A calendar date, 'YYYY-MM-DD', carried as UTC midnight of that date.
 *
 * A measurement belongs to a day, not an instant — nobody records the minute a
 * baby was weighed — and this is the same convention `Baby.birthDate` already
 * uses, so age in days is exact division with no time-zone arithmetic.
 */
export const calendarDateSchema = z.iso
  .date({ message: 'Expected a date as YYYY-MM-DD' })
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const measurement = (key: keyof typeof GROWTH_LIMITS) =>
  z
    .number()
    .int()
    .min(GROWTH_LIMITS[key].min, `Out of range for ${key}`)
    .max(GROWTH_LIMITS[key].max, `Out of range for ${key}`);

export const growthNoteSchema = z.string().trim().max(1000);

export const MEASUREMENT_FIELDS = ['weightGrams', 'lengthMm', 'headCircumferenceMm'] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

const hasAMeasurement = (
  input: Partial<Record<MeasurementField, number | null | undefined>>,
): boolean => MEASUREMENT_FIELDS.some((field) => typeof input[field] === 'number');

/**
 * One visit's measurements. Any subset of the three — a home weigh-in has only
 * weight — but never none of them. `familyId` and `babyId` come from the route
 * scopes, never the body, as for events.
 */
export const createGrowthMeasurementSchema = z
  .object({
    measuredOn: calendarDateSchema,
    weightGrams: measurement('weightGrams').optional(),
    lengthMm: measurement('lengthMm').optional(),
    headCircumferenceMm: measurement('headCircumferenceMm').optional(),
    source: z.enum(MEASUREMENT_SOURCES).optional(),
    note: growthNoteSchema.optional(),
  })
  .refine(hasAMeasurement, {
    message: 'Enter at least one of weight, length or head circumference',
    path: ['weightGrams'],
  });

/**
 * What an edit may change. Unlike events, a value may be *removed* with `null`
 * — a length typed into the head-circumference field has to be clearable. The
 * service checks that the record still holds at least one measurement after
 * the patch, because that depends on what is stored.
 */
export const updateGrowthMeasurementSchema = z
  .object({
    measuredOn: calendarDateSchema,
    weightGrams: measurement('weightGrams').nullable(),
    lengthMm: measurement('lengthMm').nullable(),
    headCircumferenceMm: measurement('headCircumferenceMm').nullable(),
    source: z.enum(MEASUREMENT_SOURCES).nullable(),
    note: growthNoteSchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'An update must change at least one field',
  });

export type CreateGrowthMeasurementInput = z.infer<typeof createGrowthMeasurementSchema>;
export type UpdateGrowthMeasurementInput = z.infer<typeof updateGrowthMeasurementSchema>;
/** The JSON a client sends — `measuredOn` is still the 'YYYY-MM-DD' string. */
export type CreateGrowthMeasurementBody = z.input<typeof createGrowthMeasurementSchema>;
export type UpdateGrowthMeasurementBody = z.input<typeof updateGrowthMeasurementSchema>;
