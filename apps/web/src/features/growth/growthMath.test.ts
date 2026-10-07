import { describe, expect, it } from 'vitest';
import type { Baby, GrowthMeasurement } from '@baby-tracker/shared';
import { ageLabel, percentileLabel, summarise, toDisplay } from './growthMath.js';
import { compareMeasurement } from './growthCompare.js';

const m = (
  id: string,
  measuredOn: string,
  values: Partial<GrowthMeasurement>,
): GrowthMeasurement => ({
  id,
  familyId: 'f',
  babyId: 'b',
  measuredOn: `${measuredOn}T00:00:00.000Z`,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...values,
});

const baby: Baby = {
  id: 'b',
  familyId: 'f',
  name: 'Ani',
  birthDate: '2026-06-01T00:00:00.000Z',
  gender: 'FEMALE',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

describe('summarise', () => {
  const series = [
    m('1', '2026-06-01', { weightGrams: 3200, lengthMm: 490 }),
    m('2', '2026-06-15', { weightGrams: 3600 }),
    m('3', '2026-07-01', { weightGrams: 4100, headCircumferenceMm: 370 }),
  ];

  it('takes the latest value and the previous one that has the same indicator', () => {
    expect(summarise('weight', series)).toMatchObject({
      value: 4100,
      previous: { value: 3600, daysBefore: 16 },
    });
    expect(summarise('length', series)).toMatchObject({ value: 490 });
    expect(summarise('length', series)?.previous).toBeUndefined();
  });

  it('is undefined when the indicator was never measured', () => {
    expect(summarise('headCircumference', series.slice(0, 2))).toBeUndefined();
  });
});

describe('toDisplay', () => {
  it('converts canonical values to the parent’s unit', () => {
    expect(toDisplay('weight', 4100, 'kg')).toBe(4.1);
    expect(toDisplay('weight', 4536, 'lb')).toBeCloseTo(10, 2);
    expect(toDisplay('length', 545, 'cm')).toBe(54.5);
    expect(toDisplay('headCircumference', 254, 'in')).toBe(10);
  });
});

describe('compareMeasurement', () => {
  it('uses the baby’s birth date and sex', () => {
    // WHO girls' weight median at birth is 3.2322 kg.
    const result = compareMeasurement(baby, 'weight', '2026-06-01T00:00:00.000Z', 3232);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.comparison.percentile).toBeCloseTo(50, 0);
  });

  it('explains a missing birth date or sex', () => {
    const { birthDate: _b, ...noBirth } = baby;
    const { gender: _g, ...noSex } = baby;
    expect(compareMeasurement(noBirth, 'weight', '2026-06-01T00:00:00.000Z', 3232)).toEqual({
      ok: false,
      reason: 'missingBirthDate',
    });
    expect(compareMeasurement(noSex, 'weight', '2026-06-01T00:00:00.000Z', 3232)).toEqual({
      ok: false,
      reason: 'missingSex',
    });
  });

  it('applies corrected age for a preterm baby', () => {
    const result = compareMeasurement(
      { ...baby, gestationalAge: { weeks: 34, days: 0 } },
      'weight',
      '2026-08-01T00:00:00.000Z',
      4000,
    );
    expect(result).toMatchObject({ ok: true, comparison: { corrected: true, ageDays: 61 - 42 } });
  });
});

describe('labels', () => {
  it('clamps percentiles to 1–99 and says which side', () => {
    expect(percentileLabel(0.4)).toEqual({ kind: 'below1' });
    expect(percentileLabel(42.4)).toEqual({ kind: 'value', value: 42 });
    expect(percentileLabel(99.6)).toEqual({ kind: 'above99' });
  });

  it('names an age in days, then weeks, then months', () => {
    expect(ageLabel(10)).toEqual({ unit: 'days', value: 10 });
    expect(ageLabel(30)).toEqual({ unit: 'weeks', value: 4 });
    expect(ageLabel(200)).toEqual({ unit: 'months', value: 6 });
  });
});
