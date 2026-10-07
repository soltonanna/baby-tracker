import {
  lengthFromMm,
  weightFromGrams,
  type GrowthIndicator,
  type GrowthMeasurement,
  type LengthUnit,
  type UnitPreferences,
  type WeightUnit,
} from '@baby-tracker/shared';

/**
 * The growth screen's arithmetic, kept out of the components so it can be
 * tested without rendering: which stored field each indicator reads, the unit
 * it is shown in, the latest value and the change since the one before.
 *
 * Every number here is a neutral description of what was entered. Nothing in
 * this file — or anything that renders it — labels a value as good or bad.
 */

/** Which canonical field holds each indicator. */
export const FIELD_FOR: Record<
  GrowthIndicator,
  'weightGrams' | 'lengthMm' | 'headCircumferenceMm'
> = {
  weight: 'weightGrams',
  length: 'lengthMm',
  headCircumference: 'headCircumferenceMm',
};

export type DisplayUnit = WeightUnit | LengthUnit;

export const unitFor = (indicator: GrowthIndicator, units: UnitPreferences): DisplayUnit =>
  indicator === 'weight' ? units.weight : units.length;

/** Canonical grams / mm → the number shown, in the parent's unit. */
export function toDisplay(
  indicator: GrowthIndicator,
  canonical: number,
  unit: DisplayUnit,
): number {
  return indicator === 'weight'
    ? weightFromGrams(canonical, unit as WeightUnit)
    : lengthFromMm(canonical, unit as LengthUnit);
}

/** Canonical grams / mm → kg / cm, the units the WHO tables are in. */
export const toWhoUnit = (indicator: GrowthIndicator, canonical: number): number =>
  indicator === 'weight' ? canonical / 1000 : canonical / 10;

/** Decimals worth showing: grams in kg, millimetres in cm. */
const DECIMALS: Record<DisplayUnit, number> = { kg: 3, lb: 2, cm: 1, in: 1 };

export function formatAmount(
  value: number,
  unit: DisplayUnit,
  locale: string,
  signed = false,
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: DECIMALS[unit],
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(value);
}

/** A stored calendar date (UTC midnight), formatted as the date it names. */
export function formatMeasuredOn(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** 'YYYY-MM-DD' of a stored calendar date — exact, because it is UTC midnight. */
export const calendarDateOf = (iso: string): string => iso.slice(0, 10);

const MS_PER_DAY = 86_400_000;

export interface IndicatorSummary {
  indicator: GrowthIndicator;
  latest: GrowthMeasurement;
  /** Canonical value of the latest measurement. */
  value: number;
  previous?: { measurement: GrowthMeasurement; value: number; daysBefore: number };
}

/**
 * The latest measurement holding this indicator, and the one before it that
 * also holds it. Measurements arrive oldest first, as the API lists them.
 */
export function summarise(
  indicator: GrowthIndicator,
  measurements: readonly GrowthMeasurement[],
): IndicatorSummary | undefined {
  const field = FIELD_FOR[indicator];
  const withValue = measurements.filter((m) => typeof m[field] === 'number');
  const latest = withValue.at(-1);
  if (!latest) return undefined;
  const before = withValue.at(-2);
  return {
    indicator,
    latest,
    value: latest[field] as number,
    ...(before
      ? {
          previous: {
            measurement: before,
            value: before[field] as number,
            daysBefore: Math.round(
              (Date.parse(latest.measuredOn) - Date.parse(before.measuredOn)) / MS_PER_DAY,
            ),
          },
        }
      : {}),
  };
}

/**
 * The percentile as shown: a whole number from 1 to 99, or the side it falls
 * off. "Below 1" rather than "0", because no measurement is at the zeroth
 * percentile — it is only further out than the table resolves.
 */
export type PercentileLabel =
  { kind: 'value'; value: number } | { kind: 'below1' } | { kind: 'above99' };

export function percentileLabel(percentile: number): PercentileLabel {
  if (percentile < 1) return { kind: 'below1' };
  if (percentile > 99) return { kind: 'above99' };
  return { kind: 'value', value: Math.round(percentile) };
}

/** An age, in the unit a parent would say it in. */
export type AgeLabel = { unit: 'days' | 'weeks' | 'months'; value: number };

export function ageLabel(days: number): AgeLabel {
  if (days < 14) return { unit: 'days', value: days };
  if (days < 13 * 7) return { unit: 'weeks', value: Math.floor(days / 7) };
  return { unit: 'months', value: Math.floor(days / 30.4375) };
}
