import { describe, expect, it } from 'vitest';
import { formatBirthLength, formatBirthWeight } from './birthMeasures.js';

describe('formatBirthWeight', () => {
  it('shows kilograms with the grams beside them', () => {
    expect(formatBirthWeight(3400, 'kg', 'en')).toBe('3.4 kg · 3,400 g');
  });

  it('shows pounds with the grams beside them', () => {
    expect(formatBirthWeight(3400, 'lb', 'en')).toBe('7.5 lb · 3,400 g');
  });
});

describe('formatBirthLength', () => {
  it('shows centimetres once', () => {
    expect(formatBirthLength(510, 'cm', 'en')).toBe('51 cm');
  });

  it('shows inches with the centimetres beside them', () => {
    expect(formatBirthLength(510, 'in', 'en')).toBe('20.1 in · 51 cm');
  });
});
