import { useId, type InputHTMLAttributes } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | undefined;
}

/** Label, input and error message, wired together for screen readers. */
export function TextField({ label, error, className = '', ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={[
          'min-h-touch w-full rounded-field border bg-surface px-4 text-base text-ink',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
          error ? 'border-critical' : 'border-line',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-sm text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
