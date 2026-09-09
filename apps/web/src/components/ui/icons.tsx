import type { ReactNode, SVGProps } from 'react';

/**
 * The app's icons, drawn inline.
 *
 * No icon package: six small line drawings do not justify a dependency, and an
 * inline `<svg>` inherits `currentColor`, so an icon is coloured by the text it
 * sits beside rather than by a second palette.
 *
 * Every icon is decorative by default — `aria-hidden`, and never the only way to
 * read a row or a button. A button that shows nothing but an icon carries its
 * own `aria-label`; the icon adds nothing to the accessibility tree.
 *
 * `data-icon` is how a test names one, the same way the event list's `<time>` is
 * found by its tag: it is a stable hook that costs the parent nothing.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Tailwind sizing and colour; defaults to a small, quiet glyph. */
  className?: string;
}

const BASE_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

function Icon({
  name,
  className = 'h-5 w-5',
  children,
  ...rest
}: IconProps & { name: string; children: ReactNode }) {
  return (
    <svg data-icon={name} className={className} {...BASE_PROPS} {...rest}>
      {children}
    </svg>
  );
}

/** A bottle, for a feeding. */
export function BottleIcon(props: IconProps) {
  return (
    <Icon name="bottle" {...props}>
      <path d="M10 2.75h4" />
      <path d="M10.75 2.75v2.1a2 2 0 0 1-.53 1.36l-.83.9a3 3 0 0 0-.8 2.04v9.6a2.5 2.5 0 0 0 2.5 2.5h1.82a2.5 2.5 0 0 0 2.5-2.5v-9.6a3 3 0 0 0-.8-2.04l-.83-.9a2 2 0 0 1-.53-1.36v-2.1" />
      <path d="M8.6 11.5h6.8M8.6 15h6.8" />
    </Icon>
  );
}

/** A crescent moon, for a sleep. */
export function MoonIcon(props: IconProps) {
  return (
    <Icon name="moon" {...props}>
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" />
    </Icon>
  );
}

/** A folded nappy, for a change. */
export function DiaperIcon(props: IconProps) {
  return (
    <Icon name="diaper" {...props}>
      <path d="M4 6.5h16v3.2a9 9 0 0 1-2.9 6.6L12 21l-5.1-4.7A9 9 0 0 1 4 9.7Z" />
      <path d="M4 9.8c2.6.9 5.3 1.35 8 1.35s5.4-.45 8-1.35" />
    </Icon>
  );
}

/** A written page, for a note. */
export function NoteIcon(props: IconProps) {
  return (
    <Icon name="note" {...props}>
      <path d="M6.5 3.25h7.7L19 8v12.75H6.5Z" />
      <path d="M14 3.25V8h5" />
      <path d="M9.2 12.5h6.1M9.2 16h4.2" />
    </Icon>
  );
}

/** A pencil, for editing an entry. */
export function PencilIcon(props: IconProps) {
  return (
    <Icon name="pencil" {...props}>
      <path d="M4.5 19.5h3.1l9.4-9.4a2.2 2.2 0 0 0 0-3.1l-.5-.5a2.2 2.2 0 0 0-3.1 0l-9.4 9.4Z" />
      <path d="M13.4 7.6l3 3" />
    </Icon>
  );
}

/** A waste bin, for deleting an entry. */
export function TrashIcon(props: IconProps) {
  return (
    <Icon name="trash" {...props}>
      <path d="M4.5 6.75h15" />
      <path d="M9.5 6.75V5.4a1.4 1.4 0 0 1 1.4-1.4h2.2a1.4 1.4 0 0 1 1.4 1.4v1.35" />
      <path d="M6.75 6.75 7.6 19a1.8 1.8 0 0 0 1.8 1.65h5.2A1.8 1.8 0 0 0 16.4 19l.85-12.25" />
      <path d="M10.6 10.4v6.2M13.4 10.4v6.2" />
    </Icon>
  );
}
