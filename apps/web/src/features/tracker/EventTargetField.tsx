import { useTranslation } from 'react-i18next';
import type { Baby } from '@baby-tracker/shared';
import { CheckIcon } from '../../components/ui/icons.js';
import { BOTH_BABIES, babyTarget, type EventTarget } from './eventTarget.js';

/**
 * Who this entry is for: one baby, or both of them.
 *
 * The same pill pattern the nappy kinds use — real radios, visually hidden and
 * driven by their labels, so each option is a full touch target and the
 * keyboard and screen-reader behaviour is the browser's rather than something
 * re-implemented here. A tiny radio group component is not worth extracting for
 * two callers whose options are unrelated; what is shared is the styling
 * vocabulary, and that is already Tailwind.
 *
 * The babies are named, not labelled "Boy" and "Girl": the tab strip above the
 * form says "Ani" and "Nare", and a target that said something else would be a
 * second name for the same child.
 *
 * The chosen option carries a tick as well as a colour, so it is not colour
 * alone that says which one is selected. The tick's box is always there and
 * only its contents are hidden, so choosing does not move the labels.
 *
 * Nothing is rendered for a family with one baby: there is no choice to make,
 * and an empty question is worse than no question.
 */

export interface EventTargetFieldProps {
  babies: Baby[];
  value: EventTarget;
  onChange: (target: EventTarget) => void;
  disabled?: boolean;
}

export function EventTargetField({ babies, value, onChange, disabled }: EventTargetFieldProps) {
  const { t } = useTranslation();

  if (babies.length < 2) {
    return null;
  }

  const options: { key: string; label: string; target: EventTarget }[] = [
    ...babies.map((baby) => ({
      key: baby.id,
      label: baby.name,
      target: babyTarget(baby.id),
    })),
    { key: 'both', label: t('today.target.both'), target: BOTH_BABIES },
  ];

  const isSelected = (target: EventTarget): boolean =>
    target.kind === 'both'
      ? value.kind === 'both'
      : value.kind === 'baby' && value.babyId === target.babyId;

  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className="mb-1 block text-sm font-medium text-ink">{t('today.target.label')}</legend>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => {
          const selected = isSelected(option.target);
          return (
            <label
              key={option.key}
              className={[
                'min-h-touch flex cursor-pointer items-center justify-center gap-1 rounded-card',
                'border px-2 text-center text-base font-medium',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                'has-[:focus-visible]:outline-accent',
                selected
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-surface text-muted',
              ].join(' ')}
            >
              <input
                type="radio"
                name="target"
                value={option.key}
                checked={selected}
                onChange={() => {
                  onChange(option.target);
                }}
                className="sr-only"
              />
              <CheckIcon className={selected ? 'h-4 w-4 shrink-0' : 'h-4 w-4 shrink-0 opacity-0'} />
              <span className="min-w-0 truncate">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
