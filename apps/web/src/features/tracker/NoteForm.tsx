import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { eventDetailsSchema } from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { queryKeys } from '../../services/queryKeys.js';
import { createBabyEvent } from './api.js';

/**
 * Writing a note — the first thing this app lets a parent record.
 *
 * Only NOTE: the other event types have their own fields and their own
 * decisions, and nothing here is generalised ahead of them.
 */

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** `HH:MM` in the browser's own zone, which is what `<input type="time">` reads. */
function timeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * The instant a time picked on the `day` in question refers to, as an ISO
 * string. Local by construction: a parent types 07:30 meaning their own 07:30.
 * `null` when the field is empty or not a time — a real browser's time input
 * will not produce that, but nothing here relies on the browser to be sure.
 */
function startedAtFrom(time: string, day: Date): string | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  const startedAt = new Date(day);
  startedAt.setHours(hours, minutes, 0, 0);
  return startedAt.toISOString();
}

export interface NoteFormProps {
  familyId: string;
  babyId: string;
  /** Called once the note is saved and the event list has been refreshed. */
  onSaved: () => void;
  onCancel: () => void;
}

export function NoteForm({ familyId, babyId, onSaved, onCancel }: NoteFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const detailsId = useId();
  const detailsErrorId = `${detailsId}-error`;

  // Defaulted once, on mount: the clock must not move under the parent while
  // they are typing.
  const [time, setTime] = useState(() => timeInputValue(new Date()));
  const [details, setDetails] = useState('');
  const [timeError, setTimeError] = useState<string | undefined>(undefined);
  const [detailsError, setDetailsError] = useState<string | undefined>(undefined);

  const save = useMutation({
    mutationFn: (payload: { startedAt: string; details: string }) =>
      createBabyEvent(familyId, babyId, {
        type: 'NOTE',
        startedAt: payload.startedAt,
        details: payload.details,
      }),
    onSuccess: async () => {
      // Awaited, so the form is still in its saving state until the list the
      // parent is about to look at actually holds the new note.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.babyEvents(familyId, babyId),
      });
      onSaved();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // Trimmed the same way the shared schema trims it server-side, so what is
    // validated here is what the API will store.
    const trimmed = eventDetailsSchema.safeParse(details);
    const startedAt = startedAtFrom(time, new Date());

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
    <Card title={t('today.note.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {save.isError ? (
          <p role="alert" className="rounded-card bg-accent-soft px-3 py-2 text-sm text-critical">
            {t('today.note.errors.saveFailed')}
          </p>
        ) : null}

        <TextField
          label={t('today.note.time')}
          type="time"
          name="startedAt"
          value={time}
          onChange={(event) => {
            setTime(event.target.value);
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
            onChange={(event) => {
              setDetails(event.target.value);
            }}
            disabled={save.isPending}
            aria-invalid={detailsError ? true : undefined}
            aria-describedby={detailsError ? detailsErrorId : undefined}
            className={[
              'w-full rounded-card border bg-surface px-4 py-3 text-base text-ink',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
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
