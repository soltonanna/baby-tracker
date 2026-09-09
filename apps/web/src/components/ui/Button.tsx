import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-accent text-white active:brightness-95',
  secondary: 'bg-accent-soft text-accent active:brightness-95',
  quiet: 'bg-transparent text-muted active:bg-surface-sunken',
  // Filled, in the palette's one alarming colour: a destructive confirmation
  // must not look like the calm action beside it. The label says "delete" too,
  // so the warning never rests on the colour alone.
  danger: 'bg-critical text-white active:brightness-95',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
  children: ReactNode;
}

/** Minimum height is a full touch target: this app is used one-handed. */
export function Button({
  variant = 'primary',
  fullWidth = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex min-h-touch items-center justify-center gap-2 rounded-card px-5',
        'text-base font-medium transition-[filter,background-color]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:opacity-50',
        VARIANT_CLASSES[variant],
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
