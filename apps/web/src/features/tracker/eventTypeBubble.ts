import type { BabyEventType } from '@baby-tracker/shared';

/**
 * The soft bubble an event's icon sits in: peach for feeding, lavender for
 * sleep, mint for nappies, butter yellow for notes. Same `Record` trick, so a
 * new type cannot ship without a colour.
 */
export const EVENT_TYPE_BUBBLE: Record<BabyEventType, string> = {
  FEEDING: 'bg-feeding-soft text-feeding',
  SLEEP: 'bg-sleep-soft text-sleep',
  DIAPER: 'bg-diaper-soft text-diaper',
  NOTE: 'bg-note-soft text-note',
};
