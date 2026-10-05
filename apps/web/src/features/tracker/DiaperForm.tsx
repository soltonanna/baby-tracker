import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DIAPER_KINDS, type Baby, type BabyEvent, type DiaperKind } from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { saveBabyEvent } from './api.js';
import { EventTargetField } from './EventTargetField.js';
import { babyTarget, refreshEventsFor, targetBabyIds, type EventTarget } from './eventTarget.js';
import { startedAtFrom, timeInputValue } from './eventTime.js';

/**
 * Recording a nappy change: when, and which kind.
 *
 * The vocabulary is `DIAPER_KINDS` from the shared package — the same four
 * values as spec §11 and `ARCHITECTURE_PROPOSAL.md` §5.5 — not a list written
 * out again here. Nothing else is recorded: §11 asks for the simplest possible
 * interface and says extra fields can come later.
 *
 * The kind travels in `details`, because that is the contract the API already
 * has. `createBabyEventSchema` is flat and type-agnostic on purpose, and the
 * existing events integration test creates a diaper as `details: 'wet'` and
 * asserts it round-trips. A first-class `kind` field would be a shared and
 * backend change, so this form uses what is already there rather than inventing
 * a second way to say the same thing. What is stored is the canonical token,
 * never the translated label, so a Russian-language parent and an
 * English-language one write the same value.
 *
 * `wet` is preselected. That is the common change by a wide margin, it is the
 * difference between two taps and three at 3am, and — unlike the sleep form's
 * end time, which is deliberately left empty — the chosen kind is visible on
 * screen the whole time, so a default here cannot be saved unnoticed.
 *
 * With an `event`, the same form edits it: the stored kind is the one selected,
 * and submitting sends the canonical token again through a PATCH. A stored
 * `details` that is not one of the four — create still accepts free text — falls
 * back to the same default a new entry gets, because the four radios are all
 * this form can represent.
 */

/** The stored kind, when it is one of the four; the common one otherwise. */
const diaperKindOf = (details: string | undefined): DiaperKind =>
  details !== undefined && (DIAPER_KINDS as readonly string[]).includes(details)
    ? (details as DiaperKind)
    : 'wet';

export interface DiaperFormProps {
  familyId: string;
  /** The baby on screen — the default target, and the only one an edit has. */
  babyId: string;
  /** Every baby in the family, so the entry can be aimed at one or at both. */
  babies: Baby[];
  /** The nappy change being edited, if this is an edit rather than a new entry. */
  event?: BabyEvent | undefined;
  /** Called once the nappy change is saved and the event list has been refreshed. */
  onSaved: () => void;
  onCancel: () => void;
}

export function DiaperForm({
  familyId,
  babyId,
  babies,
  event,
  onSaved,
  onCancel,
}: DiaperFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const editing = event !== undefined;

  // Defaulted once, on mount: the clock must not move under the parent while
  // they are choosing. An edit starts from the stored values instead.
  const [time, setTime] = useState(() =>
    timeInputValue(event === undefined ? new Date() : new Date(event.startedAt)),
  );
  const [kind, setKind] = useState<DiaperKind>(() => diaperKindOf(event?.details));
  const [target, setTarget] = useState<EventTarget>(() => babyTarget(babyId));
  const [timeError, setTimeError] = useState<string | undefined>(undefined);

  // An edit belongs to the event's own baby, so the target is not a choice
  // there: moving a nappy change to the other twin is not editing it.
  const saveTarget = editing ? babyTarget(babyId) : target;

  const save = useMutation({
    mutationFn: (payload: { startedAt: string; kind: DiaperKind }) =>
      saveBabyEvent(familyId, saveTarget, event?.id, {
        type: 'DIAPER',
        startedAt: payload.startedAt,
        details: payload.kind,
      }),
    onSuccess: async () => {
      // Awaited, so the form is still in its saving state until the list the
      // parent is about to look at actually holds the new event. For "both"
      // that is each twin's list: the one on screen refreshes now, the other
      // the moment it is shown.
      await refreshEventsFor(queryClient, familyId, targetBabyIds(saveTarget, babies));
      onSaved();
    },
  });

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();

    // An edit keeps the day the change was recorded on; only its clock time is
    // being changed here.
    const day = event === undefined ? new Date() : new Date(event.startedAt);
    const startedAt = startedAtFrom(time, day);
    setTimeError(startedAt === null ? t('today.diaper.errors.invalidTime') : undefined);

    // The kind needs no validation: it is one of a fixed set and one of them is
    // always selected, so there is no empty state to reject.
    if (startedAt === null) {
      return;
    }

    save.mutate({ startedAt, kind });
  }

  return (
    <Card title={editing ? t('today.diaper.editTitle') : t('today.diaper.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {save.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {editing ? t('today.diaper.errors.updateFailed') : t('today.diaper.errors.saveFailed')}
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
          label={t('today.diaper.time')}
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

        <fieldset className="space-y-1" disabled={save.isPending}>
          <legend className="mb-1 block text-sm font-medium text-ink">
            {t('today.diaper.kind')}
          </legend>
          {/*
            Real radios, visually hidden and driven by their labels: a full
            touch target each, keyboard and screen-reader behaviour for free,
            and two columns rather than four so a label wraps instead of being
            cut off on the narrowest phone.
          */}
          <div className="grid grid-cols-2 gap-2">
            {DIAPER_KINDS.map((diaperKind) => {
              const selected = diaperKind === kind;
              return (
                <label
                  key={diaperKind}
                  className={[
                    'min-h-touch flex cursor-pointer items-center justify-center rounded-full',
                    'border px-3 text-center text-base font-medium',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                    'has-[:focus-visible]:outline-tone',
                    selected
                      ? 'border-tone bg-tone-soft text-tone-ink'
                      : 'border-line bg-surface text-muted',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={diaperKind}
                    checked={selected}
                    onChange={() => {
                      setKind(diaperKind);
                    }}
                    className="sr-only"
                  />
                  {t(`today.diaper.kinds.${diaperKind}`)}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" fullWidth disabled={save.isPending}>
            {save.isPending ? t('today.diaper.saving') : t('today.diaper.save')}
          </Button>
          <Button type="button" variant="quiet" onClick={onCancel} disabled={save.isPending}>
            {t('today.diaper.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
