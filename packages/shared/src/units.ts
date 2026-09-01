/**
 * Unit conversion (decision D3).
 *
 * The database stores canonical base units only:
 *   weight -> grams, length -> millimetres, volume -> millilitres,
 *   temperature -> degrees Celsius, duration -> seconds.
 *
 * Conversion happens exactly once, at the UI boundary. Nothing in the API or in
 * any aggregation ever sees pounds, inches or ounces.
 */

import type { LengthUnit, VolumeUnit, WeightUnit } from './constants.js';

export const GRAMS_PER_POUND = 453.59237;
export const MM_PER_INCH = 25.4;
/** US fluid ounce, which is what bottle markings use. */
export const ML_PER_FLUID_OUNCE = 29.5735295625;

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/* -------------------------------------------------------------- weight --- */

export const gramsToKg = (grams: number): number => grams / 1000;
export const kgToGrams = (kg: number): number => Math.round(kg * 1000);
export const gramsToPounds = (grams: number): number => grams / GRAMS_PER_POUND;
export const poundsToGrams = (pounds: number): number => Math.round(pounds * GRAMS_PER_POUND);

/** Canonical grams -> the number to show, in the user's unit. */
export function weightFromGrams(grams: number, unit: WeightUnit): number {
  return round(unit === 'kg' ? gramsToKg(grams) : gramsToPounds(grams), 3);
}

/** A number the user typed, in their unit -> canonical grams. */
export function weightToGrams(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? kgToGrams(value) : poundsToGrams(value);
}

/* -------------------------------------------------------------- length --- */

export const mmToCm = (mm: number): number => mm / 10;
export const cmToMm = (cm: number): number => Math.round(cm * 10);
export const mmToInches = (mm: number): number => mm / MM_PER_INCH;
export const inchesToMm = (inches: number): number => Math.round(inches * MM_PER_INCH);

export function lengthFromMm(mm: number, unit: LengthUnit): number {
  return round(unit === 'cm' ? mmToCm(mm) : mmToInches(mm), 2);
}

export function lengthToMm(value: number, unit: LengthUnit): number {
  return unit === 'cm' ? cmToMm(value) : inchesToMm(value);
}

/* -------------------------------------------------------------- volume --- */

export const mlToOunces = (ml: number): number => ml / ML_PER_FLUID_OUNCE;
export const ouncesToMl = (ounces: number): number => Math.round(ounces * ML_PER_FLUID_OUNCE);

export function volumeFromMl(ml: number, unit: VolumeUnit): number {
  return unit === 'ml' ? round(ml, 0) : round(mlToOunces(ml), 2);
}

export function volumeToMl(value: number, unit: VolumeUnit): number {
  return unit === 'ml' ? Math.round(value) : ouncesToMl(value);
}
