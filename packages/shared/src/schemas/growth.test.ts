import { describe, expect, it } from 'vitest';
import { createGrowthMeasurementSchema, updateGrowthMeasurementSchema } from './growth.js';
import { updateBabySchema } from './baby.js';

describe('createGrowthMeasurementSchema', () => {
  it('accepts any subset of the three measurements and stores the date as UTC midnight', () => {
    const parsed = createGrowthMeasurementSchema.parse({
      measuredOn: '2026-10-07',
      weightGrams: 4210,
    });
    expect(parsed.measuredOn.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(parsed.weightGrams).toBe(4210);
  });

  it('requires at least one measurement', () => {
    expect(
      createGrowthMeasurementSchema.safeParse({ measuredOn: '2026-10-07', note: 'clinic' }).success,
    ).toBe(false);
  });

  it('rejects a date-time, an impossible date and a missing date', () => {
    for (const measuredOn of ['2026-10-07T10:00:00Z', '2026-02-30', undefined]) {
      expect(
        createGrowthMeasurementSchema.safeParse({ measuredOn, weightGrams: 4000 }).success,
      ).toBe(false);
    }
  });

  it('catches values typed in the wrong unit', () => {
    const bad = [
      { weightGrams: 4 },
      { weightGrams: 42_000 },
      { lengthMm: 52 },
      { headCircumferenceMm: 3500 },
    ];
    for (const values of bad) {
      expect(
        createGrowthMeasurementSchema.safeParse({ measuredOn: '2026-10-07', ...values }).success,
      ).toBe(false);
    }
  });

  it('rejects fractional canonical units', () => {
    expect(
      createGrowthMeasurementSchema.safeParse({ measuredOn: '2026-10-07', weightGrams: 4000.5 })
        .success,
    ).toBe(false);
  });
});

describe('updateGrowthMeasurementSchema', () => {
  it('lets a value be cleared with null', () => {
    expect(updateGrowthMeasurementSchema.parse({ headCircumferenceMm: null })).toEqual({
      headCircumferenceMm: null,
    });
  });

  it('rejects an empty patch', () => {
    expect(updateGrowthMeasurementSchema.safeParse({}).success).toBe(false);
  });
});

describe('updateBabySchema', () => {
  it('accepts a gestational age and clears with null', () => {
    expect(updateBabySchema.parse({ gestationalAge: { weeks: 35, days: 4 } })).toEqual({
      gestationalAge: { weeks: 35, days: 4 },
    });
    expect(updateBabySchema.parse({ gestationalAge: null, birthDate: null })).toEqual({
      gestationalAge: null,
      birthDate: null,
    });
  });

  it('rejects impossible gestational ages and an empty patch', () => {
    expect(updateBabySchema.safeParse({ gestationalAge: { weeks: 50, days: 0 } }).success).toBe(
      false,
    );
    expect(updateBabySchema.safeParse({ gestationalAge: { weeks: 35, days: 7 } }).success).toBe(
      false,
    );
    expect(updateBabySchema.safeParse({}).success).toBe(false);
  });

  it('does not allow the name to be removed', () => {
    expect(updateBabySchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(updateBabySchema.safeParse({ name: null }).success).toBe(false);
  });
});
