import { describe, expect, it } from 'vitest';
import {
  lengthFromMm,
  lengthToMm,
  volumeFromMl,
  volumeToMl,
  weightFromGrams,
  weightToGrams,
} from './units.js';

describe('weight', () => {
  it('converts canonical grams to the displayed unit', () => {
    expect(weightFromGrams(3450, 'kg')).toBe(3.45);
    expect(weightFromGrams(453.59237, 'lb')).toBe(1);
  });

  it('converts a typed value back to canonical grams', () => {
    expect(weightToGrams(3.45, 'kg')).toBe(3450);
    expect(weightToGrams(1, 'lb')).toBe(454);
  });

  it('round-trips a birth weight without visible drift', () => {
    const grams = weightToGrams(7.5, 'lb');
    expect(weightFromGrams(grams, 'lb')).toBeCloseTo(7.5, 2);
  });
});

describe('length', () => {
  it('converts millimetres in both directions', () => {
    expect(lengthFromMm(505, 'cm')).toBe(50.5);
    expect(lengthToMm(50.5, 'cm')).toBe(505);
    expect(lengthFromMm(254, 'in')).toBe(10);
    expect(lengthToMm(10, 'in')).toBe(254);
  });
});

describe('volume', () => {
  it('keeps millilitres whole', () => {
    expect(volumeFromMl(120.4, 'ml')).toBe(120);
    expect(volumeToMl(120, 'ml')).toBe(120);
  });

  it('converts fluid ounces', () => {
    expect(volumeToMl(4, 'oz')).toBe(118);
    expect(volumeFromMl(118, 'oz')).toBeCloseTo(4, 1);
  });
});
