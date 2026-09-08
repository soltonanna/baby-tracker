import type { Baby } from '@baby-tracker/shared';

export interface BabySelectorProps {
  babies: Baby[];
  selectedBabyId: string;
  onSelect: (babyId: string) => void;
}

/**
 * One tap per baby. Twins are the expected case, but nothing here assumes two:
 * one baby renders one button, three render three.
 */
export function BabySelector({ babies, selectedBabyId, onSelect }: BabySelectorProps) {
  return (
    <div role="tablist" aria-label="Babies" className="flex gap-2">
      {babies.map((baby) => {
        const selected = baby.id === selectedBabyId;
        return (
          <button
            key={baby.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              onSelect(baby.id);
            }}
            className={[
              'min-h-touch flex-1 rounded-card border px-4 text-base font-medium',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              selected
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-surface text-muted',
            ].join(' ')}
          >
            {baby.name}
          </button>
        );
      })}
    </div>
  );
}
