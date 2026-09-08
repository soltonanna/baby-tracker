import { DIAPER_KINDS, durationSeconds, type BabyEvent } from '@baby-tracker/shared';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

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

/**
 * The details line, as a parent should read it.
 *
 * A nappy's `details` is a canonical `DIAPER_KINDS` token rather than prose —
 * that is how the kind is stored — so it is translated here instead of being
 * shown as `wet_and_dirty`. Everything else, including a diaper whose details
 * are not one of the four, is shown exactly as it was entered.
 */
function formatDetails(event: BabyEvent, t: TFunction): string | null {
  const { details } = event;
  if (details === undefined || details.length === 0) {
    return null;
  }
  if (event.type === 'DIAPER' && (DIAPER_KINDS as readonly string[]).includes(details)) {
    return t(`today.diaper.kinds.${details}`);
  }
  return details;
}

export function EventList({ events }: { events: BabyEvent[] }) {
  const { t, i18n } = useTranslation();

  return (
    <ul className="space-y-2">
      {events.map((event) => {
        const amount = formatAmount(event);
        const duration = sleepDuration(event);
        const details = formatDetails(event, t);
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
            {details === null ? null : <p className="mt-1 text-sm text-muted">{details}</p>}
          </li>
        );
      })}
    </ul>
  );
}
