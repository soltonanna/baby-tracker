import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { addLocalDays, type Baby, type BabyEvent, type LocalDate } from '@baby-tracker/shared';
import { EventEditor } from '../tracker/EventEditor.js';
import { EventRow } from '../tracker/EventList.js';
import { EventTypeIcon } from '../tracker/EventTypeIcon.js';
import type { BabyTone } from '../tracker/babyTone.js';
import { editFormFor, type EventFormState } from '../tracker/eventForm.js';
import { BabyMarker } from './BabyMarker.js';
import type { BabyDaySummary, TimelineDay, TimelineRow } from './timelineModel.js';

export interface TimelineDaySectionProps {
  day: TimelineDay;
  /** `null` while the day is not wholly loaded — see `summariseTimelineDay`. */
  summary: BabyDaySummary[] | null;
  today: LocalDate;
  familyId: string;
  babies: Baby[];
  tones: ReadonlyMap<string, BabyTone>;
  /** Mark each row with its baby — whenever the list holds more than one. */
  showBabies: boolean;
  editing: EventFormState | null;
  onEdit: (form: EventFormState | null) => void;
}

/** "Today", "Yesterday", or the date in the reader's language. */
function dayLabel(date: LocalDate, today: LocalDate, t: TFunction, locale: string): string {
  if (date === today) return t('timeline.day.today');
  if (date === addLocalDays(today, -1)) return t('timeline.day.yesterday');
  // Noon UTC formatted in UTC: the calendar date as written, in any zone.
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function formatSleep(seconds: number, t: TFunction): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? t('today.duration.hoursMinutes', { hours, minutes })
    : t('today.duration.minutes', { minutes });
}

/**
 * One local day of the timeline: its heading, a compact summary per baby, and
 * its rows. A row being edited is replaced by its form, right where it is, so
 * correcting last Tuesday does not scroll the parent back to the top.
 */
export function TimelineDaySection(props: TimelineDaySectionProps) {
  const { day, summary, today, babies, tones, showBabies } = props;
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const nameOf = (babyId: string): string => babies.find((baby) => baby.id === babyId)?.name ?? '';

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <header
        className="sticky z-[1] -mx-1 space-y-1 rounded-field bg-canvas/95 px-1 py-2 backdrop-blur"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink uppercase">
          {dayLabel(day.date, today, t, i18n.language)}
        </h2>
        {summary === null ? (
          <p className="text-xs text-muted">{t('timeline.summary.pending')}</p>
        ) : (
          <ul aria-label={t('timeline.summary.label')} className="space-y-1">
            {summary.map((line) => (
              <li key={line.babyId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {showBabies ? (
                  <BabyMarker name={nameOf(line.babyId)} tone={tones.get(line.babyId)} />
                ) : null}
                {line.feedings === null ? null : (
                  <SummaryFact
                    type="FEEDING"
                    text={t('timeline.summary.feedings', { count: line.feedings })}
                  />
                )}
                {line.sleepSeconds === null ? null : (
                  <SummaryFact
                    type="SLEEP"
                    text={t('timeline.summary.sleep', {
                      duration: formatSleep(line.sleepSeconds, t),
                    })}
                  />
                )}
                {line.diapers === null ? null : (
                  <SummaryFact
                    type="DIAPER"
                    text={t('timeline.summary.diapers', { count: line.diapers })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </header>

      <ul className="space-y-2">
        {day.rows.map((row) => (
          <TimelineRowItem key={row.key} row={row} {...props} nameOf={nameOf} />
        ))}
      </ul>
    </section>
  );
}

function SummaryFact({ type, text }: { type: BabyEvent['type']; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink">
      <EventTypeIcon type={type} className="h-4 w-4 shrink-0 text-muted" />
      {text}
    </span>
  );
}

function TimelineRowItem({
  row,
  nameOf,
  ...props
}: TimelineDaySectionProps & { row: TimelineRow; nameOf: (babyId: string) => string }) {
  const { t } = useTranslation();

  if (row.kind === 'single') {
    return <EventOrEditor event={row.event} nameOf={nameOf} {...props} />;
  }

  // One twin action: a single card, each baby's half inside it with its own
  // details, and its own edit and delete — the API edits one event at a time.
  return (
    <li className="space-y-2 rounded-card border border-line bg-surface-sunken p-2">
      <p className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
        {t('timeline.bothBabies')}
      </p>
      <ul className="space-y-2">
        {row.events.map((event) => (
          <EventOrEditor key={event.id} event={event} nameOf={nameOf} {...props} />
        ))}
      </ul>
    </li>
  );
}

function EventOrEditor({
  event,
  nameOf,
  familyId,
  babies,
  tones,
  showBabies,
  editing,
  onEdit,
}: TimelineDaySectionProps & { event: BabyEvent; nameOf: (babyId: string) => string }) {
  if (editing?.event?.id === event.id) {
    return (
      <li data-tone={tones.get(event.babyId)}>
        <EventEditor
          familyId={familyId}
          babyId={event.babyId}
          babies={babies}
          form={editing}
          onClose={() => {
            onEdit(null);
          }}
        />
      </li>
    );
  }

  const name = nameOf(event.babyId);
  return (
    <EventRow
      event={event}
      familyId={familyId}
      babyId={event.babyId}
      onEdit={(target) => {
        onEdit(editFormFor(target));
      }}
      {...(showBabies
        ? { marker: <BabyMarker name={name} tone={tones.get(event.babyId)} />, babyName: name }
        : {})}
    />
  );
}
