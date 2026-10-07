import type {
  Baby,
  GrowthIndicator,
  GrowthMeasurement,
  UnitPreferences,
} from '@baby-tracker/shared';
import {
  comparisonAge,
  daysBetweenDates,
  valueAtZ,
  whoLmsAt,
  WHO_MAX_AGE_DAYS,
} from '@baby-tracker/shared/growth';
import { FIELD_FOR, toDisplay, unitFor, type DisplayUnit } from './growthMath.js';

/**
 * The geometry-free model of one growth chart: points, WHO reference curves
 * and axis ranges, all in display units against age in days. Kept apart from
 * the SVG so the decisions — which age, which window, which points are left
 * out — are testable without rendering.
 */

/** The WHO curves drawn: ±2 SD (2nd and 98th percentile) and the median. */
export const REFERENCE_Z = [-2, 0, 2] as const;

export interface ChartPoint {
  measurementId: string;
  measuredOn: string;
  /** Age the point is plotted at — corrected when the baby was preterm. */
  ageDays: number;
  value: number;
}

export interface ReferenceCurve {
  z: (typeof REFERENCE_Z)[number];
  points: { ageDays: number; value: number }[];
}

export interface ChartModel {
  indicator: GrowthIndicator;
  unit: DisplayUnit;
  points: ChartPoint[];
  /** Empty when there is no WHO comparison for this baby (no birth date or sex). */
  reference: ReferenceCurve[];
  /** Plotted against age (true) or, without a birth date, days since the first measurement. */
  byAge: boolean;
  corrected: boolean;
  /** Measurements left off: before term-equivalent age, or past the WHO window. */
  omitted: number;
  x: { min: number; max: number };
  y: { min: number; max: number };
}

const DAYS_PER_MONTH = 30.4375;
/** The narrowest window worth drawing: three months. */
const MIN_WINDOW_DAYS = Math.round(3 * DAYS_PER_MONTH);
/** Room after the last point, so it is not pinned to the edge. */
const LEAD_DAYS = Math.round(1 * DAYS_PER_MONTH);

export function chartModel(
  indicator: GrowthIndicator,
  baby: Baby,
  measurements: readonly GrowthMeasurement[],
  units: UnitPreferences,
): ChartModel | undefined {
  const field = FIELD_FOR[indicator];
  const unit = unitFor(indicator, units);
  const withValue = measurements.filter((m) => typeof m[field] === 'number');
  if (withValue.length === 0) return undefined;

  const birthDate = baby.birthDate === undefined ? undefined : new Date(baby.birthDate);
  const byAge = birthDate !== undefined;
  const origin = birthDate ?? new Date((withValue[0] as GrowthMeasurement).measuredOn);

  let corrected = false;
  let omitted = 0;
  const points: ChartPoint[] = [];
  for (const measurement of withValue) {
    const chronological = daysBetweenDates(origin, new Date(measurement.measuredOn));
    const age = byAge
      ? comparisonAge(chronological, baby.gestationalAge)
      : { ageDays: chronological, corrected: false };
    if (age === undefined || age.ageDays > WHO_MAX_AGE_DAYS) {
      omitted += 1;
      continue;
    }
    corrected ||= age.corrected;
    points.push({
      measurementId: measurement.id,
      measuredOn: measurement.measuredOn,
      ageDays: age.ageDays,
      value: toDisplay(indicator, measurement[field] as number, unit),
    });
  }
  if (points.length === 0) return undefined;

  const lastAge = Math.max(...points.map((p) => p.ageDays));
  const firstAge = Math.min(...points.map((p) => p.ageDays));
  const xMax = Math.min(WHO_MAX_AGE_DAYS, Math.max(MIN_WINDOW_DAYS, lastAge + LEAD_DAYS));
  // From birth while the window is short; later, from a little before the
  // first point, so two years of curve does not squash the recent months.
  const xMin = byAge && firstAge < 6 * DAYS_PER_MONTH ? 0 : Math.max(0, firstAge - LEAD_DAYS);

  const sex = baby.gender;
  const reference: ReferenceCurve[] =
    byAge && sex !== undefined
      ? REFERENCE_Z.map((z) => {
          const curve: { ageDays: number; value: number }[] = [];
          const step = Math.max(1, Math.round((xMax - xMin) / 60));
          for (let day = xMin; day <= xMax; day += step)
            curve.push(referencePoint(indicator, sex, day, z, unit));
          if (curve.at(-1)?.ageDays !== xMax)
            curve.push(referencePoint(indicator, sex, xMax, z, unit));
          return { z, points: curve };
        })
      : [];

  const values = [
    ...points.map((p) => p.value),
    ...reference.flatMap((c) => c.points.map((p) => p.value)),
  ];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.08, high * 0.02);

  return {
    indicator,
    unit,
    points,
    reference,
    byAge,
    corrected,
    omitted,
    x: { min: xMin, max: xMax },
    y: { min: Math.max(0, low - pad), max: high + pad },
  };
}

function referencePoint(
  indicator: GrowthIndicator,
  sex: NonNullable<Baby['gender']>,
  ageDays: number,
  z: number,
  unit: DisplayUnit,
): { ageDays: number; value: number } {
  const lms = whoLmsAt(indicator, sex, ageDays);
  if (!lms) throw new Error(`No WHO data at day ${ageDays}`);
  // The tables are in kg / cm; convert through canonical units to the parent's.
  const whoValue = valueAtZ(lms, z);
  const canonical = indicator === 'weight' ? whoValue * 1000 : whoValue * 10;
  return { ageDays, value: toDisplay(indicator, canonical, unit) };
}

/** "Nice" tick values covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ??
    raw) as number;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

/** Month ticks for an age axis in days. */
export function monthTicks(minDays: number, maxDays: number): number[] {
  const spanMonths = (maxDays - minDays) / DAYS_PER_MONTH;
  const every = spanMonths <= 6 ? 1 : spanMonths <= 12 ? 2 : 3;
  const ticks: number[] = [];
  for (
    let month = Math.ceil(minDays / DAYS_PER_MONTH / every) * every;
    month * DAYS_PER_MONTH <= maxDays;
    month += every
  ) {
    ticks.push(month);
  }
  return ticks;
}

export { DAYS_PER_MONTH };
