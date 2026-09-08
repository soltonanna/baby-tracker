import { durationSeconds, type BabyEvent } from '@baby-tracker/shared';
import { useTranslation } from 'react-i18next';

/** Times only — the list is one baby's recent events, so the date is context. */
function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function formatWhen(event: BabyEvent, locale: string): string {
  const started = formatTime(event.startedAt, locale);
  return event.endedAt ? `${started} – ${formatTime(event.endedAt, locale)}` : started;
}

/**
 * How long a sleep lasted, in whole minutes split into hours and minutes.
 *
 * Derived here rather than stored: `startedAt` and `endedAt` are the record, and
 * a duration written alongside them is a second copy that can disagree. Only
 * SLEEP asks for it — an event type that gains an end of its own can say so
 * then.
 */
function sleepDuration(event: BabyEvent): { hours: number; minutes: number } | null {
  if (event.type !== 'SLEEP' || event.endedAt === undefined) {
    return null;
  }

  const totalMinutes = Math.round(
    durationSeconds(new Date(event.startedAt), new Date(event.endedAt)) / 60,
  );
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
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
        const duration = sleepDuration(event);
        return (
          <li key={event.id} className="rounded-card border border-line bg-surface px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-ink">{t(`today.eventType.${event.type}`)}</span>
              <time dateTime={event.startedAt} className="text-sm text-muted">
                {formatWhen(event, i18n.language)}
              </time>
            </div>

            {amount === null ? null : <p className="mt-1 text-sm text-ink">{amount}</p>}
            {duration === null ? null : (
              <p className="mt-1 text-sm text-ink">
                {duration.hours > 0
                  ? t('today.duration.hoursMinutes', duration)
                  : t('today.duration.minutes', { minutes: duration.minutes })}
              </p>
            )}
            {event.details ? <p className="mt-1 text-sm text-muted">{event.details}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
