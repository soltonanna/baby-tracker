import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button.js';

export interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Disables both buttons while the action runs. */
  busy?: boolean;
  /** Shown above the buttons when the action failed. */
  error?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal confirmation for an action that cannot be undone.
 *
 * Focus starts on the *safe* button, so Enter or a stray tap cancels rather
 * than destroys; Escape and the backdrop cancel as well. The confirm button is
 * the danger variant and carries the action in its own label.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-sm space-y-3 rounded-card border border-line bg-surface p-5 shadow-soft"
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onCancel();
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        <div id={bodyId} className="text-sm text-muted">
          {children}
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="danger" onClick={onConfirm} disabled={busy} fullWidth>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy} fullWidth data-cancel>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
