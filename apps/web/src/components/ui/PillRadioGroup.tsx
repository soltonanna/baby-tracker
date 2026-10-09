/**
 * A short list of choices as large pills: one tap each, one hand.
 *
 * Real radios, visually hidden and driven by their labels — a full touch target
 * each, and keyboard and screen-reader behaviour for free. The same pattern the
 * nappy kinds and the "For" selector use, as a component so a form with two
 * such groups does not repeat it twice. Selected carries a border and a fill,
 * never colour alone.
 */

export interface PillOption<Value extends string> {
  value: Value;
  label: string;
}

export interface PillRadioGroupProps<Value extends string> {
  legend: string;
  /** The radios' shared `name`, so two groups in one form never interfere. */
  name: string;
  options: readonly PillOption<Value>[];
  /** `null` when nothing is chosen yet — an optional choice. */
  value: Value | null;
  onChange: (value: Value) => void;
  disabled?: boolean;
  /** Columns on a phone; a three-way choice fits on one row. */
  columns?: 2 | 3;
}

export function PillRadioGroup<Value extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  disabled = false,
  columns = 3,
}: PillRadioGroupProps<Value>) {
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className="mb-1 block text-sm font-medium text-ink">{legend}</legend>
      <div className={`grid gap-2 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={[
                'min-h-touch flex cursor-pointer items-center justify-center rounded-full',
                'border px-2 text-center text-sm leading-tight font-medium',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                'has-[:focus-visible]:outline-tone',
                selected
                  ? 'border-tone bg-tone-soft text-tone-ink'
                  : 'border-line bg-surface text-muted',
              ].join(' ')}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => {
                  onChange(option.value);
                }}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
