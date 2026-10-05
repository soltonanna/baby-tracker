import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { eventDetailsSchema, type Baby, type BabyEvent } from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { saveBabyEvent } from './api.js';
import { EventTargetField } from './EventTargetField.js';
import { babyTarget, refreshEventsFor, targetBabyIds, type EventTarget } from './eventTarget.js';
import { startedAtFrom, timeInputValue } from './eventTime.js';

/**
 * Writing a note — the first thing this app lets a parent record.
 *
 * Only NOTE: the other event types have their own fields and their own
 * decisions, and nothing here is generalised ahead of them.
 *
 * With an `event`, the same form edits it: the stored text and time are what the
 * fields start from, submitting sends a PATCH, and the 1000-character limit is
 * still `eventDetailsSchema` — the same shared rule the API validates with, not
 * a second copy of the number.
 */

export interface NoteFormProps {
  familyId: string;
  /** The baby on screen — the default target, and the only one an edit has. */
  babyId: string;
  /** Every baby in the family, so the entry can be aimed at one or at both. */
  babies: Baby[];
  /** The note being edited, if this is an edit rather than a new entry. */
  event?: BabyEvent | undefined;
  /** Called once the note is saved and the event list has been refreshed. */
  onSaved: () => void;
  onCancel: () => void;
}

export function NoteForm({ familyId, babyId, babies, event, onSaved, onCancel }: NoteFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const detailsId = useId();
  const detailsErrorId = `${detailsId}-error`;
  const editing = event !== undefined;

  // Defaulted once, on mount: the clock must not move under the parent while
  // they are typing. An edit starts from the stored values instead.
  const [time, setTime] = useState(() =>
    timeInputValue(event === undefined ? new Date() : new Date(event.startedAt)),
  );
  const [details, setDetails] = useState(() => event?.details ?? '');
  const [target, setTarget] = useState<EventTarget>(() => babyTarget(babyId));
  const [timeError, setTimeError] = useState<string | undefined>(undefined);
  const [detailsError, setDetailsError] = useState<string | undefined>(undefined);

  // An edit belongs to the event's own baby, so the target is not a choice
  // there: moving a note to the other twin is not editing it.
  const saveTarget = editing ? babyTarget(babyId) : target;

  const save = useMutation({
    mutationFn: (payload: { startedAt: string; details: string }) =>
      saveBabyEvent(familyId, saveTarget, event?.id, {
        type: 'NOTE',
        startedAt: payload.startedAt,
        details: payload.details,
      }),
    onSuccess: async () => {
      // Awaited, so the form is still in its saving state until the list the
      // parent is about to look at actually holds the new note. For "both"
      // that is each twin's list: the one on screen refreshes now, the other
      // the moment it is shown.
      await refreshEventsFor(queryClient, familyId, targetBabyIds(saveTarget, babies));
      onSaved();
    },
  });

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();

    // Trimmed the same way the shared schema trims it server-side, so what is
    // validated here is what the API will store.
    const trimmed = eventDetailsSchema.safeParse(details);
    // An edit keeps the day the note was written on; only its clock time is
    // being changed here.
    const day = event === undefined ? new Date() : new Date(event.startedAt);
    const startedAt = startedAtFrom(time, day);

    setTimeError(startedAt === null ? t('today.note.errors.invalidTime') : undefined);
    setDetailsError(
      !trimmed.success || trimmed.data.length === 0 ? t('today.note.errors.required') : undefined,
    );

    if (startedAt === null || !trimmed.success || trimmed.data.length === 0) {
      return;
    }

    save.mutate({ startedAt, details: trimmed.data });
  }

  return (
    <Card title={editing ? t('today.note.editTitle') : t('today.note.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {save.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {editing ? t('today.note.errors.updateFailed') : t('today.note.errors.saveFailed')}
          </p>
        ) : null}

        {editing ? null : (
          <EventTargetField
            babies={babies}
            value={target}
            onChange={setTarget}
            disabled={save.isPending}
          />
        )}

        <TextField
          label={t('today.note.time')}
          type="time"
          name="startedAt"
          value={time}
          onChange={(changeEvent) => {
            setTime(changeEvent.target.value);
          }}
          error={timeError}
          disabled={save.isPending}
          required
        />

        <div className="space-y-1">
          <label htmlFor={detailsId} className="block text-sm font-medium text-ink">
            {t('today.note.details')}
          </label>
          <textarea
            id={detailsId}
            name="details"
            rows={3}
            maxLength={1000}
            value={details}
            onChange={(changeEvent) => {
              setDetails(changeEvent.target.value);
            }}
            disabled={save.isPending}
            aria-invalid={detailsError ? true : undefined}
            aria-describedby={detailsError ? detailsErrorId : undefined}
            className={[
              'w-full rounded-field border bg-surface px-4 py-3 text-base text-ink',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
              detailsError ? 'border-critical' : 'border-line',
            ].join(' ')}
          />
          {detailsError ? (
            <p id={detailsErrorId} className="text-sm text-critical">
              {detailsError}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button type="submit" fullWidth disabled={save.isPending}>
            {save.isPending ? t('today.note.saving') : t('today.note.save')}
          </Button>
          <Button type="button" variant="quiet" onClick={onCancel} disabled={save.isPending}>
            {t('today.note.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
