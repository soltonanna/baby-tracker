import { describe, expect, it } from 'vitest';
import { LOCALES } from '@baby-tracker/shared';
import en from './locales/en.json';
import ru from './locales/ru.json';
import hy from './locales/hy.json';

const CATALOGUES: Record<(typeof LOCALES)[number], unknown> = { en, ru, hy };

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) => keysOf(child, `${prefix}${key}.`));
}

describe('locale catalogues', () => {
  const reference = keysOf(en).sort();

  it.each(LOCALES)('%s has exactly the keys English has', (locale) => {
    expect(keysOf(CATALOGUES[locale]).sort()).toEqual(reference);
  });
});
