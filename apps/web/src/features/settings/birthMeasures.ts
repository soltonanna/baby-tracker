import {
  lengthFromMm,
  mmToCm,
  weightFromGrams,
  type LengthUnit,
  type WeightUnit,
} from '@baby-tracker/shared';

/**
 * How a birth weight and length are written on screen.
 *
 * Stored in grams and millimetres (D3) and shown in the parent's unit — but
 * grams and centimetres are always shown as well, because they are what a
 * hospital report says. In kilograms or centimetres that is the same value in
 * a second form (3.4 kg · 3,400 g); in pounds or inches it is the metric
 * equivalent beside it (7.5 lb · 3,400 g).
 */

const number = (value: number, locale: string, maxFractionDigits: number): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits }).format(value);

export function formatBirthWeight(grams: number, unit: WeightUnit, locale: string): string {
  const metric = `${number(grams, locale, 0)} g`;
  const shown = number(weightFromGrams(grams, unit), locale, unit === 'kg' ? 3 : 2);
  return `${shown} ${unit} · ${metric}`;
}

export function formatBirthLength(mm: number, unit: LengthUnit, locale: string): string {
  const cm = `${number(mmToCm(mm), locale, 1)} cm`;
  if (unit === 'cm') return cm;
  return `${number(lengthFromMm(mm, unit), locale, 1)} ${unit} · ${cm}`;
}

/** The "= 3,400 g" hint under the weight field, as the parent types. */
export const gramsHint = (grams: number, locale: string): string => `${number(grams, locale, 0)} g`;
export const centimetresHint = (mm: number, locale: string): string =>
  `${number(mmToCm(mm), locale, 1)} cm`;
