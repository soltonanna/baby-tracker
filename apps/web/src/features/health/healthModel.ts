import {
  HEALTH_DOSE_UNITS,
  HEALTH_LIMITS,
  IMMUNIZATION_CATALOG_VERSION,
  LOCALES,
  addLocalDays,
  localDayStart,
  toLocalDate,
  type CreateHealthRecordBody,
  type HealthCategory,
  type HealthDoseUnit,
  type HealthRecord,
  type Locale,
  type Localized,
  type ScheduleRecordRef,
  type UpdateHealthRecordBody,
} from '@baby-tracker/shared';

/**
 * The health screens' logic, kept apart from the components so it can be tested
 * without rendering: filtering the history, turning the form into a request, and
 * the few conversions between an instant and what a date and time input show.
 *
 * Calendar days are read in the signed-in user's time zone (`timeZone`), the
 * same zone Today and Growth use — never the server's.
 */

/** The interface language as one of the three the catalog has text for. */
export function resolveLocale(language: string): Locale {
  return LOCALES.find((locale) => language.toLowerCase().startsWith(locale)) ?? 'en';
}

export const localized = (text: Localized, language: string): string =>
  text[resolveLocale(language)];

/** The local calendar date of an instant, 'YYYY-MM-DD'. */
export const localDateOf = (iso: string, timeZone: string): string =>
  toLocalDate(new Date(iso), timeZone);

/** 'HH:MM' on the clock of `timeZone`, what a time input shows. */
export function localTimeOf(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
  return parts;
}

/**
 * The instant a date and a time on the clock of `timeZone` refer to, or `null`
 * when either is not a real value. Built from the start of that local day plus
 * the time, so it does not depend on the browser's own zone.
 */
export function instantFrom(date: string, time: string, timeZone: string): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  if (hours > 23 || minutes > 59) return null;
  const probe = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== date) return null;
  return new Date(
    localDayStart(date, timeZone).getTime() + (hours * 60 + minutes) * 60_000,
  ).toISOString();
}

/* ------------------------------------------------------------- history --- */

export interface HistoryFilter {
  category: HealthCategory | 'all';
  /** Inclusive local calendar dates; '' means unbounded. */
  from: string;
  to: string;
}

export const NO_FILTER: HistoryFilter = { category: 'all', from: '', to: '' };

export function filterRecords(
  records: readonly HealthRecord[],
  filter: HistoryFilter,
  timeZone: string,
): HealthRecord[] {
  return records.filter((record) => {
    if (filter.category !== 'all' && record.category !== filter.category) return false;
    const day = localDateOf(record.occurredAt, timeZone);
    if (filter.from !== '' && day < filter.from) return false;
    if (filter.to !== '' && day > filter.to) return false;
    return true;
  });
}

/** Vaccinations reduced to what the schedule comparison reads. */
export function toScheduleRefs(
  records: readonly HealthRecord[],
  timeZone: string,
): ScheduleRecordRef[] {
  return records
    .filter((record) => record.category === 'vaccination')
    .map((record) => ({
      id: record.id,
      occurredOn: localDateOf(record.occurredAt, timeZone),
      scheduleKey: record.scheduleKey,
    }));
}

/* ---------------------------------------------------------------- form --- */

export interface HealthFormValues {
  category: HealthCategory;
  date: string;
  time: string;
  name: string;
  purpose: string;
  description: string;
  doseValue: string;
  doseUnit: HealthDoseUnit | '';
  productName: string;
  manufacturer: string;
  provider: string;
  note: string;
  nextDueOn: string;
  scheduleKey: string;
}

export function initialFormValues(
  record: HealthRecord | undefined,
  defaults: { today: string; now: string; timeZone: string },
  prefill?: Partial<HealthFormValues>,
): HealthFormValues {
  if (record) {
    return {
      category: record.category,
      date: localDateOf(record.occurredAt, defaults.timeZone),
      time: localTimeOf(record.occurredAt, defaults.timeZone),
      name: record.name,
      purpose: record.purpose ?? '',
      description: record.description ?? '',
      doseValue: record.doseValue === undefined ? '' : String(record.doseValue),
      doseUnit: record.doseUnit ?? '',
      productName: record.productName ?? '',
      manufacturer: record.manufacturer ?? '',
      provider: record.provider ?? '',
      note: record.note ?? '',
      nextDueOn: record.nextDueOn ?? '',
      scheduleKey: record.scheduleKey ?? '',
    };
  }
  return {
    category: 'vaccination',
    date: defaults.today,
    time: defaults.now,
    name: '',
    purpose: '',
    description: '',
    doseValue: '',
    doseUnit: '',
    productName: '',
    manufacturer: '',
    provider: '',
    note: '',
    nextDueOn: '',
    scheduleKey: '',
    ...prefill,
  };
}

export type HealthFormField = keyof HealthFormValues;
/** Field → i18n key under `health.form.errors`. */
export type HealthFormErrors = Partial<Record<HealthFormField, string>>;

export interface BuildContext {
  timeZone: string;
  /** The baby's birth date as 'YYYY-MM-DD', if known. */
  birthDate?: string | undefined;
  now: Date;
  /** The record being edited, if any. */
  original?: HealthRecord | undefined;
}

export type BuildResult =
  | { ok: true; body: CreateHealthRecordBody | UpdateHealthRecordBody }
  | { ok: false; errors: HealthFormErrors };

const isCalendarDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

/**
 * Validates the form and builds the request.
 *
 * A create sends only what was filled in. An edit sends every field, with the
 * emptied ones as `null` so they are removed rather than left behind.
 *
 * The schedule link is only sent when it changed: leaving a record's existing
 * link alone keeps the catalog version it was made under, instead of stamping
 * it with today's — a record's history must not move when the catalog does.
 *
 * A dose is whatever was typed; nothing here suggests, converts or checks it
 * against a medical range.
 */
export function buildHealthRecordBody(
  values: HealthFormValues,
  context: BuildContext,
): BuildResult {
  const errors: HealthFormErrors = {};
  const { timeZone, original } = context;

  const name = values.name.trim();
  if (name.length === 0) errors.name = 'nameRequired';

  const occurredAt = instantFrom(values.date, values.time, timeZone);
  if (occurredAt === null) {
    errors.date = 'invalidDate';
  } else {
    const today = toLocalDate(context.now, timeZone);
    if (
      values.date > addLocalDays(today, 1) ||
      Date.parse(occurredAt) > context.now.getTime() + 86_400_000
    ) {
      errors.date = 'futureDate';
    } else if (
      context.birthDate !== undefined &&
      values.date < addLocalDays(context.birthDate, -1)
    ) {
      errors.date = 'beforeBirth';
    }
  }

  const rawDose = values.doseValue.trim().replace(',', '.');
  let doseValue: number | undefined;
  if (rawDose !== '') {
    const parsed = Number(rawDose);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > HEALTH_LIMITS.dose.max) {
      errors.doseValue = 'doseInvalid';
    } else {
      doseValue = parsed;
    }
    if (values.doseUnit === '') errors.doseUnit = 'doseUnitRequired';
  } else if (values.doseUnit !== '') {
    errors.doseValue = 'doseValueRequired';
  }

  if (values.nextDueOn !== '') {
    if (!isCalendarDate(values.nextDueOn)) {
      errors.nextDueOn = 'invalidDate';
    } else if (values.nextDueOn < addLocalDays(values.date, -1)) {
      errors.nextDueOn = 'nextBeforeDate';
    }
  }

  if (Object.keys(errors).length > 0 || occurredAt === null) return { ok: false, errors };

  const text = (value: string): string | undefined => {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };
  const linked = values.category === 'vaccination' ? values.scheduleKey : '';

  if (original === undefined) {
    return {
      ok: true,
      body: {
        category: values.category,
        occurredAt,
        name,
        ...(text(values.purpose) ? { purpose: text(values.purpose) } : {}),
        ...(text(values.description) ? { description: text(values.description) } : {}),
        ...(doseValue === undefined || values.doseUnit === ''
          ? {}
          : { doseValue, doseUnit: values.doseUnit }),
        ...(text(values.productName) ? { productName: text(values.productName) } : {}),
        ...(text(values.manufacturer) ? { manufacturer: text(values.manufacturer) } : {}),
        ...(text(values.provider) ? { provider: text(values.provider) } : {}),
        ...(text(values.note) ? { note: text(values.note) } : {}),
        ...(values.nextDueOn === '' ? {} : { nextDueOn: values.nextDueOn }),
        ...(linked === ''
          ? {}
          : { scheduleKey: linked, catalogVersion: IMMUNIZATION_CATALOG_VERSION }),
      } as CreateHealthRecordBody,
    };
  }

  const linkChanged = linked !== (original.scheduleKey ?? '');
  return {
    ok: true,
    body: {
      category: values.category,
      occurredAt,
      name,
      purpose: text(values.purpose) ?? null,
      description: text(values.description) ?? null,
      doseValue: doseValue ?? null,
      doseUnit: doseValue === undefined || values.doseUnit === '' ? null : values.doseUnit,
      productName: text(values.productName) ?? null,
      manufacturer: text(values.manufacturer) ?? null,
      provider: text(values.provider) ?? null,
      note: text(values.note) ?? null,
      nextDueOn: values.nextDueOn === '' ? null : values.nextDueOn,
      ...(linkChanged
        ? linked === ''
          ? { scheduleKey: null, catalogVersion: null }
          : { scheduleKey: linked, catalogVersion: IMMUNIZATION_CATALOG_VERSION }
        : {}),
    } as UpdateHealthRecordBody,
  };
}

export const DOSE_UNITS: readonly HealthDoseUnit[] = HEALTH_DOSE_UNITS;
