import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Baby, BabyEvent } from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { saveBabyEvent } from './api.js';
import { EventTargetField } from './EventTargetField.js';
import { babyTarget, refreshEventsFor, targetBabyIds, type EventTarget } from './eventTarget.js';
import { endedAtFrom, startedAtFrom, timeInputValue } from './eventTime.js';

/**
 * Recording a sleep: when it began and when it ended.
 *
 * Two times and nothing else. Day/night, location and a note are §10 of the
 * spec and each needs its own decision; duration is not a field at all, because
 * it is `endedAt - startedAt` and a stored copy of a derived number is a copy
 * that can disagree with its source.
 *
 * The start defaults to now, exactly as the note and feeding forms do. The end
 * starts empty and is required: a parent records a sleep once it is over, and
 * defaulting the end to now would make "now" the answer to a question nobody
 * asked — a zero-length sleep the parent never noticed saving.
 *
 * A sleep that crosses midnight needs no extra field: an end time earlier than
 * the start is read on the following day, which is decision D5's "one session,
 * listed on the day it started". 23:00 → 01:00 is two hours, not an error.
 *
 * With an `event`, the same form edits it. Both times start from what was
 * stored, and — this is the part that matters for D5 — the day both times are
 * read on is the day the sleep *started*, not today. So 23:00 → 01:00 recorded
 * last night stays 23:00 → 01:00 last night when it is edited, and stays one
 * session crossing one midnight. `endedAtFrom` does the rollover, here as in a
 * new entry; there is no date arithmetic in this form.
 */

export interface SleepFormProps {
  familyId: string;
  /** The baby on screen — the default target, and the only one an edit has. */
  babyId: string;
  /** Every baby in the family, so the entry can be aimed at one or at both. */
  babies: Baby[];
  /** The sleep being edited, if this is an edit rather than a new entry. */
  event?: BabyEvent | undefined;
  /** Called once the sleep is saved and the event list has been refreshed. */
  onSaved: () => void;
  onCancel: () => void;
}

export function SleepForm({ familyId, babyId, babies, event, onSaved, onCancel }: SleepFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const editing = event !== undefined;

  // Defaulted once, on mount: the clock must not move under the parent while
  // they are typing. An edit starts from the stored times instead.
  const [startTime, setStartTime] = useState(() =>
    timeInputValue(event === undefined ? new Date() : new Date(event.startedAt)),
  );
  const [endTime, setEndTime] = useState(() =>
    event?.endedAt === undefined ? '' : timeInputValue(new Date(event.endedAt)),
  );
  const [target, setTarget] = useState<EventTarget>(() => babyTarget(babyId));
  const [startError, setStartError] = useState<string | undefined>(undefined);
  const [endError, setEndError] = useState<string | undefined>(undefined);

  // An edit belongs to the event's own baby, so the target is not a choice
  // there: moving a sleep to the other twin is not editing it.
  const saveTarget = editing ? babyTarget(babyId) : target;

  const save = useMutation({
    mutationFn: (payload: { startedAt: string; endedAt: string }) =>
      saveBabyEvent(familyId, saveTarget, event?.id, {
        type: 'SLEEP',
        startedAt: payload.startedAt,
        endedAt: payload.endedAt,
      }),
    onSuccess: async () => {
      // Awaited, so the form is still in its saving state until the list the
      // parent is about to look at actually holds the new sleep. For "both"
      // that is each twin's list: the one on screen refreshes now, the other
      // the moment it is shown. Both documents carry the same two instants, so
      // a sleep that crossed midnight crossed it for each of them.
      await refreshEventsFor(queryClient, familyId, targetBabyIds(saveTarget, babies));
      onSaved();
    },
  });

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();

    // One `day` anchors both times: the start is read on it, and the end is read
    // relative to that start, so the pair is one interval rather than two
    // independently resolved instants. Editing anchors on the day the sleep
    // started, so an overnight sleep is not dragged onto today.
    const day = event === undefined ? new Date() : new Date(event.startedAt);
    const startedAt = startedAtFrom(startTime, day);
    const trimmedEnd = endTime.trim();
    const endedAt =
      trimmedEnd.length === 0 || startedAt === null
        ? null
        : endedAtFrom(trimmedEnd, startedAt, day);

    const nextStartError =
      startedAt === null ? t('today.sleep.errors.invalidStartTime') : undefined;
    const nextEndError =
      trimmedEnd.length === 0
        ? t('today.sleep.errors.requiredEndTime')
        : startedAt !== null && endedAt === null
          ? t('today.sleep.errors.invalidEndTime')
          : undefined;

    setStartError(nextStartError);
    setEndError(nextEndError);

    if (startedAt === null || endedAt === null) {
      return;
    }

    save.mutate({ startedAt, endedAt });
  }

  return (
    <Card title={editing ? t('today.sleep.editTitle') : t('today.sleep.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {save.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {editing ? t('today.sleep.errors.updateFailed') : t('today.sleep.errors.saveFailed')}
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
          label={t('today.sleep.start')}
          type="time"
          name="startedAt"
          value={startTime}
          onChange={(changeEvent) => {
            setStartTime(changeEvent.target.value);
          }}
          error={startError}
          disabled={save.isPending}
          required
        />

        <TextField
          label={t('today.sleep.end')}
          type="time"
          name="endedAt"
          value={endTime}
          onChange={(changeEvent) => {
            setEndTime(changeEvent.target.value);
          }}
          error={endError}
          disabled={save.isPending}
          required
        />

        <div className="flex gap-2">
          <Button type="submit" fullWidth disabled={save.isPending}>
            {save.isPending ? t('today.sleep.saving') : t('today.sleep.save')}
          </Button>
          <Button type="button" variant="quiet" onClick={onCancel} disabled={save.isPending}>
            {t('today.sleep.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
