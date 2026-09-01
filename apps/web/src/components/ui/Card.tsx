import type { ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Card({ title, footer, className = '', children }: CardProps) {
  return (
    <section className={`rounded-card border border-line bg-surface p-4 ${className}`.trim()}>
      {title === undefined ? null : (
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
      )}
      {children}
      {footer === undefined ? null : <div className="mt-3 text-sm text-muted">{footer}</div>}
    </section>
  );
}
