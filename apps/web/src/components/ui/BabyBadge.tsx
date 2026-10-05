/**
 * The app's little mark: two overlapping circles, one blue and one pink — a
 * pair of twins. Decorative only; the app name always sits beside it.
 */
export function BabyBadge({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const circle = size === 'sm' ? 'h-7 w-7' : 'h-10 w-10';
  return (
    <span aria-hidden="true" className="inline-flex items-center justify-center">
      <span className={`${circle} rounded-full border-2 border-surface bg-boy`} />
      <span className={`${circle} -ml-3 rounded-full border-2 border-surface bg-girl`} />
    </span>
  );
}
