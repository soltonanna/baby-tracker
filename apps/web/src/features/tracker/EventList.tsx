import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DIAPER_KINDS, durationSeconds, type BabyEvent } from '@baby-tracker/shared';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '../../components/ui/Button.js';
import { PencilIcon, TrashIcon } from '../../components/ui/icons.js';
import { queryKeys } from '../../services/queryKeys.js';
import { deleteBabyEvent } from './api.js';
import { EventTypeIcon } from './EventTypeIcon.js';
import { EVENT_TYPE_BUBBLE } from './eventTypeBubble.js';

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

export interface EventListProps {
  events: BabyEvent[];
  familyId: string;
  babyId: string;
  /** Asks the page to open the right entry form on this event. */
  onEdit: (event: BabyEvent) => void;
}

export function EventList({ events, familyId, babyId, onEdit }: EventListProps) {
  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <EventRow
          key={event.id}
          event={event}
          familyId={familyId}
          babyId={babyId}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
}

/**
 * One event, with the two things a parent can do to it.
 *
 * The row owns its own delete: confirming is per-row state, and so is a failed
 * delete, so neither can leak onto the row above. Editing is not owned here —
 * the form belongs to the page, above the list, which is where every other entry
 * form already opens.
 */
function EventRow({
  event,
  familyId,
  babyId,
  onEdit,
}: {
  event: BabyEvent;
  familyId: string;
  babyId: string;
  onEdit: (event: BabyEvent) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const questionId = useId();
  const [confirming, setConfirming] = useState(false);

  const amount = formatAmount(event);
  const duration = sleepDuration(event);
  const details = formatDetails(event, t);
  const typeName = t(`today.eventType.${event.type}`);

  const remove = useMutation({
    mutationFn: () => deleteBabyEvent(familyId, babyId, event.id),
    onSuccess: async () => {
      // Awaited: the row goes when the refreshed list no longer holds it, so
      // nothing disappears from the screen before the API has agreed. Only this
      // baby's events are invalidated — the other twin's list is untouched.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.babyEvents(familyId, babyId),
      });
    },
  });

  /** Escape backs out of the confirmation, as it would out of any dialog. */
  function handleKeyDown(keyEvent: KeyboardEvent<HTMLDivElement>): void {
    if (keyEvent.key === 'Escape' && !remove.isPending) {
      remove.reset();
      setConfirming(false);
    }
  }

  return (
    <li className="rounded-field border border-line bg-surface px-3 py-3">
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${EVENT_TYPE_BUBBLE[event.type]}`}
        >
          <EventTypeIcon type={event.type} className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold text-ink">{typeName}</span>
            <time dateTime={event.startedAt} className="text-sm text-muted">
              {formatWhen(event, i18n.language)}
            </time>
          </div>

          <div className="mt-1 flex items-end justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {amount === null ? null : <p className="text-sm text-ink">{amount}</p>}
              {duration === null ? null : (
                <p className="text-sm text-ink">
                  {duration.hours > 0
                    ? t('today.duration.hoursMinutes', duration)
                    : t('today.duration.minutes', { minutes: duration.minutes })}
                </p>
              )}
              {details === null ? null : <p className="text-sm text-muted">{details}</p>}
            </div>

            {/*
              Hidden while the confirmation is open, so the row never offers two
              different Delete buttons at once.
            */}
            {confirming ? null : (
              <div className="-my-1 flex shrink-0 items-center gap-1">
                <IconButton
                  label={t('today.event.edit', { type: typeName })}
                  onClick={() => {
                    onEdit(event);
                  }}
                >
                  <PencilIcon className="h-5 w-5" />
                </IconButton>
                <IconButton
                  label={t('today.event.delete', { type: typeName })}
                  onClick={() => {
                    // A previous failure is not part of the new question.
                    remove.reset();
                    setConfirming(true);
                  }}
                >
                  <TrashIcon className="h-5 w-5" />
                </IconButton>
              </div>
            )}
          </div>

          {confirming ? (
            <div
              role="group"
              aria-labelledby={questionId}
              onKeyDown={handleKeyDown}
              className="mt-3 space-y-2 rounded-field bg-critical-soft p-3"
            >
              <p id={questionId} className="text-sm text-ink">
                {t('today.event.confirmDelete')}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  fullWidth
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate();
                  }}
                >
                  {remove.isPending ? t('today.event.deleting') : t('today.event.confirm')}
                </Button>
                <Button
                  variant="quiet"
                  autoFocus
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.reset();
                    setConfirming(false);
                  }}
                >
                  {t('today.event.cancel')}
                </Button>
              </div>
            </div>
          ) : null}

          {remove.isError ? (
            <p role="alert" className="mt-2 text-sm text-critical">
              {t('today.event.errors.deleteFailed')}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * A compact icon-only action.
 *
 * Comfortable to hit one-handed without dominating the entry it belongs to, and
 * named for a screen reader by `aria-label` — the glyph inside carries no
 * accessible text of its own.
 */
function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        'inline-flex h-11 w-11 items-center justify-center rounded-full text-muted',
        'transition-colors active:bg-surface-sunken',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
