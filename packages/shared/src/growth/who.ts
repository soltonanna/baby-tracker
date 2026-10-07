/**
 * Comparison of a measurement with the WHO Child Growth Standards.
 *
 * This is arithmetic, not assessment. It answers "where does this number sit
 * among the WHO reference population of the same sex and age?" and nothing
 * else. Nothing in this module — or anything built on it — may turn that
 * position into a statement about the baby's health (project rules §7).
 *
 * The method is WHO's own: the LMS parameters for the baby's age, the Box-Cox
 * z-score, and WHO's restricted extrapolation beyond ±3 SD. Reference:
 * WHO Child Growth Standards: Methods and development (2006), chapter 7.
 */
import type { BabyGender } from '../constants.js';
import type { GestationalAge } from '../types/baby.js';
import { WHO_MAX_AGE_DAYS, WHO_TABLES } from './whoTables.js';

/** The three measurements the growth feature records. */
export const GROWTH_INDICATORS = ['weight', 'length', 'headCircumference'] as const;
export type GrowthIndicator = (typeof GROWTH_INDICATORS)[number];

/** One sex's daily LMS series; index = age in completed days. */
export interface WhoLmsSeries {
  l: readonly number[];
  m: readonly number[];
  s: readonly number[];
}

export type WhoLmsTables = Record<GrowthIndicator, Record<BabyGender, WhoLmsSeries>>;

export interface Lms {
  l: number;
  m: number;
  s: number;
}

export const MS_PER_DAY = 86_400_000;

/** Term, in days of gestation. Corrected age counts from here. */
export const TERM_GESTATION_DAYS = 40 * 7;

/** Babies born before 37 completed weeks are compared by corrected age. */
export const PRETERM_BEFORE_DAYS = 37 * 7;

/** Corrected age is used until this chronological age, then actual age. */
export const CORRECT_AGE_UNTIL_DAYS = 2 * 365;

export { WHO_MAX_AGE_DAYS };

/** The oldest age a comparison is offered for. */
export function isWithinWhoRange(ageDays: number): boolean {
  return ageDays >= 0 && ageDays <= WHO_MAX_AGE_DAYS;
}

/**
 * LMS at a (possibly fractional) age in days, linearly interpolated between
 * the two neighbouring daily rows. For a whole day this is the row itself.
 *
 * Returns `undefined` outside the table rather than extrapolating: a comparison
 * the standard does not cover is no comparison at all.
 */
export function whoLmsAt(
  indicator: GrowthIndicator,
  sex: BabyGender,
  ageDays: number,
): Lms | undefined {
  if (!Number.isFinite(ageDays) || !isWithinWhoRange(ageDays)) return undefined;
  const series = WHO_TABLES[indicator][sex];
  const lower = Math.floor(ageDays);
  const upper = Math.min(lower + 1, WHO_MAX_AGE_DAYS);
  const t = ageDays - lower;
  const lerp = (values: readonly number[]): number => {
    const a = values[lower] as number;
    const b = values[upper] as number;
    return a + (b - a) * t;
  };
  return { l: lerp(series.l), m: lerp(series.m), s: lerp(series.s) };
}

/** The measurement value at a given z for these LMS parameters. */
export function valueAtZ({ l, m, s }: Lms, z: number): number {
  return l === 0 ? m * Math.exp(s * z) : m * (1 + l * s * z) ** (1 / l);
}

/**
 * WHO z-score for `value` (kg for weight, cm for lengths).
 *
 * Inside ±3 SD this is the plain LMS formula. Beyond it WHO extrapolates
 * linearly using the distance between the 2 SD and 3 SD curves, because the
 * skewed weight distribution otherwise compresses extreme values. For the
 * length and head-circumference tables L = 1 and the two forms coincide.
 */
export function zScoreFromLms(value: number, lms: Lms): number {
  const { l, m, s } = lms;
  const z = l === 0 ? Math.log(value / m) / s : ((value / m) ** l - 1) / (l * s);
  if (z > 3) {
    const sd3 = valueAtZ(lms, 3);
    return 3 + (value - sd3) / (sd3 - valueAtZ(lms, 2));
  }
  if (z < -3) {
    const sd3 = valueAtZ(lms, -3);
    return -3 + (value - sd3) / (valueAtZ(lms, -2) - sd3);
  }
  return z;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf; error < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Percentile (0–100) for a z-score. */
export function percentileFromZ(z: number): number {
  return normalCdf(z) * 100;
}

/* ------------------------------------------------------------------ age --- */

export const gestationalAgeInDays = ({ weeks, days }: GestationalAge): number => weeks * 7 + days;

/**
 * Whole days between two calendar dates.
 *
 * Both are calendar dates carried as UTC midnight — how `Baby.birthDate` and
 * `GrowthMeasurement.measuredOn` are stored — so this is exact division with
 * no time-zone arithmetic. Anything else is rounded to the nearest day.
 */
export function daysBetweenDates(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export interface ComparisonAge {
  /** The age the WHO table is read at. */
  ageDays: number;
  /** True when that age is corrected for preterm birth. */
  corrected: boolean;
}

/**
 * The age to compare at.
 *
 * WHO standards describe babies born at term. For a baby born before 37 weeks
 * the usual practice is to compare by *corrected* age — chronological age minus
 * the weeks born early — until two years. Before term-equivalent age the
 * corrected age is negative and WHO has nothing to compare against, so the
 * result is `undefined`.
 */
export function comparisonAge(
  chronologicalDays: number,
  gestationalAge: GestationalAge | undefined,
): ComparisonAge | undefined {
  if (chronologicalDays < 0) return undefined;
  const gestationDays = gestationalAge ? gestationalAgeInDays(gestationalAge) : undefined;
  const preterm = gestationDays !== undefined && gestationDays < PRETERM_BEFORE_DAYS;
  if (!preterm || chronologicalDays > CORRECT_AGE_UNTIL_DAYS) {
    return { ageDays: chronologicalDays, corrected: false };
  }
  const corrected = chronologicalDays - (TERM_GESTATION_DAYS - gestationDays);
  return corrected < 0 ? undefined : { ageDays: corrected, corrected: true };
}

/* ----------------------------------------------------------- comparison --- */

export interface WhoComparison {
  zScore: number;
  percentile: number;
  ageDays: number;
  corrected: boolean;
}

/** Why there is no comparison — each has its own message in the UI. */
export type WhoComparisonUnavailable =
  'missingBirthDate' | 'missingSex' | 'beforeTermEquivalent' | 'outsideRange' | 'beforeBirth';

export interface WhoComparisonInput {
  indicator: GrowthIndicator;
  /** kg for weight, cm for length and head circumference. */
  value: number;
  measuredOn: Date;
  birthDate: Date | undefined;
  sex: BabyGender | undefined;
  gestationalAge: GestationalAge | undefined;
}

export function compareWithWho(
  input: WhoComparisonInput,
): { ok: true; comparison: WhoComparison } | { ok: false; reason: WhoComparisonUnavailable } {
  if (!input.birthDate) return { ok: false, reason: 'missingBirthDate' };
  if (!input.sex) return { ok: false, reason: 'missingSex' };
  const chronological = daysBetweenDates(input.birthDate, input.measuredOn);
  if (chronological < 0) return { ok: false, reason: 'beforeBirth' };
  const age = comparisonAge(chronological, input.gestationalAge);
  if (!age) return { ok: false, reason: 'beforeTermEquivalent' };
  const lms = whoLmsAt(input.indicator, input.sex, age.ageDays);
  if (!lms) return { ok: false, reason: 'outsideRange' };
  const zScore = zScoreFromLms(input.value, lms);
  return {
    ok: true,
    comparison: {
      zScore,
      percentile: percentileFromZ(zScore),
      ageDays: age.ageDays,
      corrected: age.corrected,
    },
  };
}
