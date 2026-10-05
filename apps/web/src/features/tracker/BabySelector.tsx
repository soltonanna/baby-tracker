import { useTranslation } from 'react-i18next';
import type { Baby } from '@baby-tracker/shared';
import { babyTones } from './babyTone.js';

export interface BabySelectorProps {
  babies: Baby[];
  selectedBabyId: string;
  onSelect: (babyId: string) => void;
}

/**
 * One tap per baby. Twins are the expected case, but nothing here assumes two:
 * one baby renders one button, three render three.
 *
 * Each tab is drawn in its baby's own colour — blue for a boy, pink for a girl —
 * soft when idle and filled when selected, so which twin is on screen is
 * obvious at a glance. The name and the initial are always there too, so the
 * colour is never the only signal.
 */
export function BabySelector({ babies, selectedBabyId, onSelect }: BabySelectorProps) {
  const { t } = useTranslation();
  const tones = babyTones(babies);

  return (
    <div role="tablist" aria-label={t('today.babies')} className="flex gap-2">
      {babies.map((baby) => {
        const selected = baby.id === selectedBabyId;
        return (
          <button
            key={baby.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-tone={tones.get(baby.id)}
            onClick={() => {
              onSelect(baby.id);
            }}
            className={[
              'flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-full border-2 py-1.5 pr-4 pl-1.5',
              'text-base font-semibold transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
              selected
                ? 'border-tone bg-tone text-on-tone shadow-soft'
                : 'border-tone-line bg-tone-soft text-tone-ink',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold',
                selected ? 'bg-on-tone text-tone' : 'bg-tone text-on-tone',
              ].join(' ')}
            >
              {baby.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 truncate">{baby.name}</span>
          </button>
        );
      })}
    </div>
  );
}
