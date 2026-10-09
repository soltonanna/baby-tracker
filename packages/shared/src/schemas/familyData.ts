import { z } from 'zod';
import { MEASUREMENT_FIELDS, createGrowthMeasurementSchema } from './growth.js';
import { babyEventDataSchema, eventGroupIdSchema, eventRuleIssues } from './babyEvent.js';
import { createBabySchema, gestationalAgeSchema } from './baby.js';

/**
 * The family data file: everything recorded about the children, in one JSON
 * document that can be exported, kept somewhere safe and imported again.
 *
 * **What is in it.** Babies, tracker events and live growth measurements. Not
 * the user, the family, memberships or sessions — those are the account, and a
 * data file must never be able to change who can sign in or who belongs to a
 * family.
 *
 * **References are file-local.** A baby carries an `id` that only has to be
 * unique inside the file, and every event and measurement points at it with
 * `babyId`. On import the server creates new babies and maps those ids to the
 * new ObjectIds, so a file exported from one family imports into another, and a
 * hand-written test file can simply use `"boy"` and `"girl"`.
 *
 * **Versioned.** `format` + `version` are checked first, so a future v2 can be
 * told apart from a v1 and migrated rather than half-read.
 */
export const FAMILY_DATA_FORMAT = 'baby-tracker/family-data' as const;
export const FAMILY_DATA_VERSION = 1 as const;

/** Generous, but bounded: a body this size is parsed in memory. */
export const FAMILY_DATA_LIMITS = {
  babies: 10,
  events: 200_000,
  measurements: 5_000,
} as const;

const fileRefSchema = z.string().trim().min(1).max(64);
const optionalInstant = z.coerce.date().optional();

export const familyDataBabySchema = createBabySchema.extend({
  id: fileRefSchema,
  gestationalAge: gestationalAgeSchema.optional(),
  createdAt: optionalInstant,
  updatedAt: optionalInstant,
});

/**
 * Same value rules as a create, including the cross-field feeding rules, so an
 * imported file can never hold a feeding the app itself would refuse. A file
 * from before feeding kinds existed has no `feeding` on any event and stays
 * valid — the field is optional, so the format version does not change.
 */
export const familyDataEventSchema = babyEventDataSchema
  .extend({
    babyId: fileRefSchema,
    groupId: eventGroupIdSchema.optional(),
    createdAt: optionalInstant,
    updatedAt: optionalInstant,
  })
  .superRefine((event, ctx) => {
    for (const message of eventRuleIssues(event)) {
      ctx.addIssue({ code: 'custom', message, path: ['feeding'] });
    }
  });

/**
 * Same value rules as a create — canonical grams and millimetres within
 * `GROWTH_LIMITS`, `measuredOn` as 'YYYY-MM-DD' — plus the baby reference.
 */
export const familyDataMeasurementSchema = z
  .object({
    ...createGrowthMeasurementSchema.shape,
    babyId: fileRefSchema,
    createdAt: optionalInstant,
    updatedAt: optionalInstant,
  })
  .refine((m) => MEASUREMENT_FIELDS.some((field) => typeof m[field] === 'number'), {
    message: 'A measurement needs at least one of weight, length or head circumference',
    path: ['weightGrams'],
  });

export const familyDataSchema = z
  .object({
    format: z.literal(FAMILY_DATA_FORMAT),
    version: z.literal(FAMILY_DATA_VERSION),
    exportedAt: optionalInstant,
    babies: z.array(familyDataBabySchema).max(FAMILY_DATA_LIMITS.babies),
    events: z.array(familyDataEventSchema).max(FAMILY_DATA_LIMITS.events).default([]),
    measurements: z
      .array(familyDataMeasurementSchema)
      .max(FAMILY_DATA_LIMITS.measurements)
      .default([]),
  })
  .superRefine((data, ctx) => {
    const ids = new Set<string>();
    data.babies.forEach((baby, index) => {
      if (ids.has(baby.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate baby id "${baby.id}"`,
          path: ['babies', index, 'id'],
        });
      }
      ids.add(baby.id);
    });

    // Reported once per collection rather than once per row: a file with a
    // wrong id usually has it on thousands of rows, and one line says enough.
    for (const collection of ['events', 'measurements'] as const) {
      const index = data[collection].findIndex((row) => !ids.has(row.babyId));
      if (index !== -1) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown baby id "${data[collection][index]?.babyId}"`,
          path: [collection, index, 'babyId'],
        });
      }
    }
  });

/** What an import accepts, after parsing. */
export type FamilyDataInput = z.infer<typeof familyDataSchema>;
