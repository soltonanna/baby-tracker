import type { BabyEvent } from '@baby-tracker/shared';
import { useTranslation } from 'react-i18next';

/** Times only — the list is one baby's recent events, so the date is context. */
function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function formatWhen(event: BabyEvent, locale: string): string {
  const started = formatTime(event.startedAt, locale);
  return event.endedAt ? `${started} – ${formatTime(event.endedAt, locale)}` : started;
}

/** `120 ml`, or just `120` if no unit was recorded. */
function formatAmount(event: BabyEvent): string | null {
  if (event.amount === undefined) {
    return null;
  }
  return event.unit ? `${event.amount} ${event.unit}` : String(event.amount);
}

export function EventList({ events }: { events: BabyEvent[] }) {
  const { t, i18n } = useTranslation();

  return (
    <ul className="space-y-2">
      {events.map((event) => {
        const amount = formatAmount(event);
        return (
          <li key={event.id} className="rounded-card border border-line bg-surface px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-ink">{t(`today.eventType.${event.type}`)}</span>
              <time dateTime={event.startedAt} className="text-sm text-muted">
                {formatWhen(event, i18n.language)}
              </time>
            </div>

            {amount === null ? null : <p className="mt-1 text-sm text-ink">{amount}</p>}
            {event.details ? <p className="mt-1 text-sm text-muted">{event.details}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
