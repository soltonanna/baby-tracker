export interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-2 text-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-tone" />
    </span>
  );
}
