import { z } from 'zod';
import { HEALTH_CATEGORIES, HEALTH_DOSE_UNITS, type HealthCategory } from '../constants.js';
import { calendarDateSchema } from './growth.js';

/**
 * Health record input schemas: one medical event for one baby — a vaccination,
 * a checkup, a blood test, a procedure, a medication.
 *
 * Nothing here is a medical judgement. The dose is whatever the product label
 * or the paediatrician said, stored as typed; the app never suggests, converts
 * or checks a dose. The bounds only catch a slipped finger.
 *
 * **Immunization link.** A vaccination may name the schedule item it fulfils
 * with `scheduleKey`. That is only a *pointer*: the record keeps its own name,
 * date and product, and `catalogVersion` says which edition of the catalog the
 * key was chosen from. The key is deliberately not checked against the current
 * catalog — the catalog will be revised, and a record made today must stay
 * valid, unchanged and importable whatever the catalog says later.
 */
export const HEALTH_LIMITS = {
  name: 200,
  text: 1000,
  note: 2000,
  dose: { min: 0, max: 10_000 },
} as const;

const optionalText = (max: number) => z.string().trim().max(max);

export const scheduleKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Expected a schedule key like "hexa-1"');

export const catalogVersionSchema = z.string().trim().min(1).max(32);

const doseValue = z
  .number()
  .gt(HEALTH_LIMITS.dose.min, 'A dose must be greater than zero')
  .max(HEALTH_LIMITS.dose.max);

/** The record itself, and nothing about whose it is (identity comes from the route). */
export const healthRecordDataSchema = z.object({
  category: z.enum(HEALTH_CATEGORIES),
  occurredAt: z.coerce.date(),
  name: z.string().trim().min(1, 'Enter a name').max(HEALTH_LIMITS.name),
  purpose: optionalText(HEALTH_LIMITS.text).optional(),
  description: optionalText(HEALTH_LIMITS.text).optional(),
  doseValue: doseValue.optional(),
  doseUnit: z.enum(HEALTH_DOSE_UNITS).optional(),
  productName: optionalText(HEALTH_LIMITS.name).optional(),
  manufacturer: optionalText(HEALTH_LIMITS.name).optional(),
  provider: optionalText(HEALTH_LIMITS.name).optional(),
  note: optionalText(HEALTH_LIMITS.note).optional(),
  nextDueOn: calendarDateSchema.optional(),
  scheduleKey: scheduleKeySchema.optional(),
  catalogVersion: catalogVersionSchema.optional(),
});

/** The fields the cross-field rules read, whichever operation produced them. */
interface HealthRuleSubject {
  category?: HealthCategory | undefined;
  occurredAt?: Date | undefined;
  doseValue?: number | null | undefined;
  doseUnit?: string | null | undefined;
  nextDueOn?: Date | null | undefined;
  scheduleKey?: string | null | undefined;
  catalogVersion?: string | null | undefined;
}

const MS_PER_DAY = 86_400_000;

/**
 * Rules that span more than one field, as `{ path, message }`.
 *
 * One function for every place that must agree: a create and an imported file
 * check the body, an edit checks the record as it *would be* after the patch.
 *
 * - A dose is a value and a unit together; one without the other is not a dose.
 * - `scheduleKey` belongs to a vaccination, and `catalogVersion` to a key.
 * - A follow-up cannot precede the event by more than a day (a day of slack,
 *   because the parent's calendar day can be ahead of UTC's).
 */
export function healthRecordRuleIssues(
  record: HealthRuleSubject,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const hasValue = record.doseValue !== undefined && record.doseValue !== null;
  const hasUnit = record.doseUnit !== undefined && record.doseUnit !== null;
  if (hasValue !== hasUnit) {
    issues.push({
      path: hasValue ? 'doseUnit' : 'doseValue',
      message: 'A dose needs both a value and a unit',
    });
  }
  if (record.scheduleKey && record.category !== undefined && record.category !== 'vaccination') {
    issues.push({
      path: 'scheduleKey',
      message: 'Only a vaccination can be linked to the vaccination schedule',
    });
  }
  if (record.catalogVersion && !record.scheduleKey) {
    issues.push({ path: 'catalogVersion', message: 'A catalog version needs a schedule key' });
  }
  if (
    record.nextDueOn &&
    record.occurredAt &&
    record.nextDueOn.getTime() < record.occurredAt.getTime() - MS_PER_DAY
  ) {
    issues.push({
      path: 'nextDueOn',
      message: 'The next date cannot be before the date of the record',
    });
  }
  return issues;
}

export const createHealthRecordSchema = healthRecordDataSchema.superRefine((record, ctx) => {
  for (const { path, message } of healthRecordRuleIssues(record)) {
    ctx.addIssue({ code: 'custom', message, path: [path] });
  }
});

/**
 * What an edit may change. As for growth, a value is removed with `null`. The
 * service applies the same rules to the record as it would be after the patch,
 * because most of them depend on what is stored.
 */
export const updateHealthRecordSchema = z
  .object({
    category: healthRecordDataSchema.shape.category,
    occurredAt: healthRecordDataSchema.shape.occurredAt,
    name: healthRecordDataSchema.shape.name,
    purpose: healthRecordDataSchema.shape.purpose.unwrap().nullable(),
    description: healthRecordDataSchema.shape.description.unwrap().nullable(),
    doseValue: doseValue.nullable(),
    doseUnit: z.enum(HEALTH_DOSE_UNITS).nullable(),
    productName: healthRecordDataSchema.shape.productName.unwrap().nullable(),
    manufacturer: healthRecordDataSchema.shape.manufacturer.unwrap().nullable(),
    provider: healthRecordDataSchema.shape.provider.unwrap().nullable(),
    note: healthRecordDataSchema.shape.note.unwrap().nullable(),
    nextDueOn: calendarDateSchema.nullable(),
    scheduleKey: scheduleKeySchema.nullable(),
    catalogVersion: catalogVersionSchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'An update must change at least one field',
  });

/** Filters for the history list. All optional; dates are inclusive calendar dates. */
export const listHealthRecordsQuerySchema = z
  .object({
    category: z.enum(HEALTH_CATEGORIES).optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from.getTime() <= q.to.getTime(), {
    message: '"from" cannot be after "to"',
    path: ['from'],
  });

export type CreateHealthRecordInput = z.infer<typeof createHealthRecordSchema>;
export type UpdateHealthRecordInput = z.infer<typeof updateHealthRecordSchema>;
export type ListHealthRecordsQuery = z.infer<typeof listHealthRecordsQuerySchema>;
/** The JSON a client sends — dates are still strings. */
export type CreateHealthRecordBody = z.input<typeof createHealthRecordSchema>;
export type UpdateHealthRecordBody = z.input<typeof updateHealthRecordSchema>;
