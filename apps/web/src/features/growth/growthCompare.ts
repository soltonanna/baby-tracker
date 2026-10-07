import type { Baby, GrowthIndicator } from '@baby-tracker/shared';
import {
  compareWithWho,
  type WhoComparison,
  type WhoComparisonUnavailable,
} from '@baby-tracker/shared/growth';
import { toWhoUnit } from './growthMath.js';

/**
 * The one place the web app reaches the WHO tables. Kept out of growthMath so
 * the entry form — which Today also renders — never pulls ~120 kB of LMS data
 * into the main bundle; only the lazily loaded Growth screen does.
 */

export type BabyComparison =
  { ok: true; comparison: WhoComparison } | { ok: false; reason: WhoComparisonUnavailable };

/** One indicator of one measurement against the WHO standard for this baby. */
export function compareMeasurement(
  baby: Baby,
  indicator: GrowthIndicator,
  measuredOn: string,
  canonical: number,
): BabyComparison {
  return compareWithWho({
    indicator,
    value: toWhoUnit(indicator, canonical),
    measuredOn: new Date(measuredOn),
    birthDate: baby.birthDate === undefined ? undefined : new Date(baby.birthDate),
    sex: baby.gender,
    gestationalAge: baby.gestationalAge,
  });
}
