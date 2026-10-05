import type { Baby } from '@baby-tracker/shared';

/**
 * The colour a baby is shown in.
 *
 * A boy is blue and a girl is pink. Gender is optional, so a baby without one
 * gets a neutral tone — mint for the first such baby and peach for the next —
 * which keeps two unspecified twins visually apart rather than identical.
 *
 * Colour is never the only signal: the baby's name is always beside it.
 */
export type BabyTone = 'boy' | 'girl' | 'mint' | 'peach';

const NEUTRAL_TONES = ['mint', 'peach'] as const;

/** A tone per baby id, stable for a given list order. */
export function babyTones(babies: readonly Pick<Baby, 'id' | 'gender'>[]): Map<string, BabyTone> {
  const tones = new Map<string, BabyTone>();
  let neutralIndex = 0;

  for (const baby of babies) {
    if (baby.gender === 'MALE') {
      tones.set(baby.id, 'boy');
    } else if (baby.gender === 'FEMALE') {
      tones.set(baby.id, 'girl');
    } else {
      tones.set(baby.id, NEUTRAL_TONES[neutralIndex % NEUTRAL_TONES.length] ?? 'mint');
      neutralIndex += 1;
    }
  }

  return tones;
}
