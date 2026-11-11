import type { BabyTone } from '../tracker/babyTone.js';

/**
 * Whose event a timeline row is: the baby's name on a pill in their own colour.
 * The name is always there, so colour is never the only signal.
 */
export function BabyMarker({ name, tone }: { name: string; tone: BabyTone | undefined }) {
  return (
    <span
      data-tone={tone}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-tone-line bg-tone-soft px-2 py-0.5 text-xs font-semibold text-tone-ink"
    >
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-tone" />
      <span className="truncate">{name}</span>
    </span>
  );
}
