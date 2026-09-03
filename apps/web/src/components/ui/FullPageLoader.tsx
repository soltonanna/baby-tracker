import { Spinner } from './Spinner.js';

export interface FullPageLoaderProps {
  label: string;
}

/** Shown while the session is still being determined, so nothing flashes. */
export function FullPageLoader({ label }: FullPageLoaderProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <p className="flex items-center gap-3 text-muted">
        <Spinner label={label} />
        {label}
      </p>
    </div>
  );
}
