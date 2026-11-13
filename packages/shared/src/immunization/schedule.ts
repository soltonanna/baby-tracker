import type { LocalDate } from '../types/common.js';
import { addLocalDays } from '../time.js';
import { IMMUNIZATION_SCHEDULE, type AgeSpec, type ImmunizationScheduleItem } from './catalog.js';

/**
 * Compares a child's recorded vaccinations with the Armenian calendar.
 *
 * Pure: the caller passes the birth date, today's date in the family's time
 * zone, and the vaccination records reduced to `{ id, occurredOn, scheduleKey }`.
 * Everything is calendar dates ('YYYY-MM-DD'), compared as strings — there is no
 * time-of-day or time-zone arithmetic in here.
 *
 * It reports; it does not judge. "Overdue" and "missed" are date facts under
 * the decree's rules, not medical conclusions, and the UI says so.
 */

export type ScheduleStatus =
  'completed' | 'due' | 'upcoming' | 'overdue' | 'missed' | 'scheduled_later';

export interface ScheduleRecordRef {
  id: string;
  /** The calendar date the vaccination was given, in the family's time zone. */
  occurredOn: LocalDate;
  scheduleKey?: string | null | undefined;
}

export interface ScheduleItemResult {
  item: ImmunizationScheduleItem;
  status: ScheduleStatus;
  /** Recommended date: birth + `dueAge`. */
  dueOn: LocalDate;
  /** Last day of the "due" window; after it the dose is overdue. */
  dueUntilOn: LocalDate;
  /** Last day the dose may be given at all, where the decree sets one. */
  catchUpUntilOn?: LocalDate;
  /** The record that completes it — the earliest one with this key. */
  record?: ScheduleRecordRef;
  /**
   * Given 5 or more days before the minimum age (decree 12(14)): such a dose is
   * not counted as valid by the decree and may need repeating. The dose still
   * shows as completed — it *was* recorded — with this flag for the doctor.
   */
  givenTooEarly: boolean;
  /** Given 5 or more days before the minimum interval after the previous dose. */
  intervalTooShort: boolean;
}

export interface ScheduleComparison {
  items: ScheduleItemResult[];
  /** Completed of the doses that are in force today (`scheduled_later` left out). */
  progress: { completed: number; total: number };
  counts: Record<ScheduleStatus, number>;
  /** The first dose not yet given that is due or upcoming, if any. */
  next?: ScheduleItemResult;
  /**
   * Vaccination records whose key is not in this catalog edition — an older
   * record, or a dose a later edition retired. Never an error: the record is
   * intact, it just has nothing to match.
   */
  unmatched: ScheduleRecordRef[];
}

/** Decree clauses 12(13)–(14): up to 4 days early is still a valid dose. */
export const EARLY_GRACE_DAYS = 4;
/** Decree clause 12(3): at least 4 weeks between doses of one vaccine. */
export const MIN_DOSE_INTERVAL_DAYS = 28;
/** How long a dose stays "due" before it is "overdue", unless the item says otherwise. */
export const DEFAULT_DUE_WINDOW_DAYS = 28;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function parse(date: LocalDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid calendar date "${date}"`);
  }
  return { year, month, day };
}

/**
 * A date plus whole calendar months, clamped to the end of a shorter month
 * (31 Jan + 1 month = 28/29 Feb) — never spilling into the next one.
 */
function addMonths(date: LocalDate, months: number): LocalDate {
  const { year, month, day } = parse(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${pad(targetYear, 4)}-${pad(targetMonth)}-${pad(Math.min(day, lastDay))}`;
}

/** The calendar date a child reaches `age`, counting from `birth`. */
export function addAge(birth: LocalDate, age: AgeSpec): LocalDate {
  if ('days' in age) return addLocalDays(birth, age.days);
  if ('weeks' in age) return addLocalDays(birth, age.weeks * 7);
  if ('months' in age) return addMonths(birth, age.months);
  return addMonths(birth, age.years * 12);
}

const dayBefore = (date: LocalDate, days: number): LocalDate => addLocalDays(date, -days);

interface Input {
  birthDate: LocalDate;
  today: LocalDate;
  records: readonly ScheduleRecordRef[];
  /** Defaults to the shipped calendar; tests and future editions pass their own. */
  schedule?: readonly ImmunizationScheduleItem[];
}

export function compareWithSchedule({
  birthDate,
  today,
  records,
  schedule = IMMUNIZATION_SCHEDULE,
}: Input): ScheduleComparison {
  const keys = new Set(schedule.map((item) => item.key));

  // The earliest record per key counts; a repeat entry of the same dose does not
  // complete anything twice.
  const byKey = new Map<string, ScheduleRecordRef>();
  const unmatched: ScheduleRecordRef[] = [];
  for (const record of [...records].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))) {
    if (!record.scheduleKey || !keys.has(record.scheduleKey)) {
      if (record.scheduleKey) unmatched.push(record);
      continue;
    }
    if (!byKey.has(record.scheduleKey)) byKey.set(record.scheduleKey, record);
  }

  const items = schedule.map((item): ScheduleItemResult => {
    const dueOn = addAge(birthDate, item.dueAge);
    const dueUntilOn = item.dueUntilAge
      ? addAge(birthDate, item.dueUntilAge)
      : addLocalDays(dueOn, item.dueWindowDays ?? DEFAULT_DUE_WINDOW_DAYS);
    const catchUpUntilOn = item.catchUpUntilAge
      ? addAge(birthDate, item.catchUpUntilAge)
      : undefined;
    const record = byKey.get(item.key);

    const intervalTooShort = (() => {
      if (!record) return false;
      const previous = item.minIntervalFrom
        ? {
            key: item.minIntervalFrom.key,
            earliest: (d: LocalDate) => addAge(d, item.minIntervalFrom!.age),
          }
        : (() => {
            const prior = schedule.find(
              (candidate) =>
                candidate.vaccineId === item.vaccineId && candidate.dose === item.dose - 1,
            );
            return prior
              ? {
                  key: prior.key,
                  earliest: (d: LocalDate) => addLocalDays(d, MIN_DOSE_INTERVAL_DAYS),
                }
              : undefined;
          })();
      const previousRecord = previous ? byKey.get(previous.key) : undefined;
      if (!previous || !previousRecord) return false;
      return (
        record.occurredOn <
        dayBefore(previous.earliest(previousRecord.occurredOn), EARLY_GRACE_DAYS)
      );
    })();

    const status = ((): ScheduleStatus => {
      if (record) return 'completed';
      if (item.effectiveFrom && today < item.effectiveFrom) return 'scheduled_later';
      if (today < dueOn) return 'upcoming';
      if (today <= dueUntilOn) return 'due';
      if (item.closedAfterWindow) return 'missed';
      if (catchUpUntilOn && today > catchUpUntilOn) return 'missed';
      return 'overdue';
    })();

    return {
      item,
      status,
      dueOn,
      dueUntilOn,
      ...(catchUpUntilOn ? { catchUpUntilOn } : {}),
      ...(record ? { record } : {}),
      givenTooEarly: record ? record.occurredOn < dayBefore(dueOn, EARLY_GRACE_DAYS) : false,
      intervalTooShort,
    };
  });

  const counts: Record<ScheduleStatus, number> = {
    completed: 0,
    due: 0,
    upcoming: 0,
    overdue: 0,
    missed: 0,
    scheduled_later: 0,
  };
  for (const result of items) counts[result.status] += 1;

  const next = items
    .filter((r) => r.status === 'due' || r.status === 'upcoming')
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];

  return {
    items,
    progress: {
      completed: counts.completed,
      total: items.length - counts.scheduled_later,
    },
    counts,
    ...(next ? { next } : {}),
    unmatched,
  };
}
