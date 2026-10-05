import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_UNITS,
  VOLUME_UNITS,
  createBabyEventSchema,
  volumeToMl,
  type Baby,
  type BabyEvent,
  type VolumeUnit,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { saveBabyEvent } from './api.js';
import { EventTargetField } from './EventTargetField.js';
import { babyTarget, refreshEventsFor, targetBabyIds, type EventTarget } from './eventTarget.js';
import { startedAtFrom, timeInputValue } from './eventTime.js';

/**
 * Recording a feeding: when, how much, in which unit.
 *
 * A bottle amount is all the first version records. Breast/bottle, side and
 * duration are §9 of the spec and each needs its own field; none of them is
 * guessed at here, and nothing is generalised across NoteForm and this form
 * beyond the two time helpers they share.
 *
 * Millilitres are what leaves this form. Decision D3 puts canonical base units
 * in the database and conversion at the UI edge, and this form is that edge: the
 * parent picks ml or oz, the picked unit stays on screen while they type, and
 * `volumeToMl` — the shared conversion, not a copy of it — turns what they typed
 * into canonical millilitres on submit. Nothing downstream ever sees an ounce,
 * so a daily total is a sum rather than a unit-aware fold.
 *
 * The unit select is a per-entry choice, not a stored preference; the settings
 * that make it sticky are a later phase.
 *
 * With an `event`, the same form edits it instead of creating one: the fields
 * start from what was stored and submitting sends a PATCH. Editing shows the
 * stored value in millilitres, because that is what is stored — converting it
 * back into whichever unit it was typed in would be a guess, and D3 already
 * says ml is the canonical form. The parent can still switch to ounces and type
 * an amount there; the same conversion runs on the way out.
 */

/** `z.number().nonnegative()`, straight from the schema the API validates with. */
const amountSchema = createBabyEventSchema.shape.amount.unwrap();

/** What every volume is stored in, whatever the parent typed it in (D3). */
const CANONICAL_VOLUME_UNIT: VolumeUnit = 'ml';

/** The stored unit, when it is one this form can show; the default otherwise. */
const volumeUnitOf = (unit: string | undefined): VolumeUnit =>
  unit !== undefined && (VOLUME_UNITS as readonly string[]).includes(unit)
    ? (unit as VolumeUnit)
    : DEFAULT_UNITS.volume;

export interface FeedingFormProps {
  familyId: string;
  /** The baby on screen — the default target, and the only one an edit has. */
  babyId: string;
  /** Every baby in the family, so the entry can be aimed at one or at both. */
  babies: Baby[];
  /** The feeding being edited, if this is an edit rather than a new entry. */
  event?: BabyEvent | undefined;
  /** Called once the feeding is saved and the event list has been refreshed. */
  onSaved: () => void;
  onCancel: () => void;
}

export function FeedingForm({
  familyId,
  babyId,
  babies,
  event,
  onSaved,
  onCancel,
}: FeedingFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const unitId = useId();
  const editing = event !== undefined;

  // Defaulted once, on mount: the clock must not move under the parent while
  // they are typing. An edit starts from the stored values instead.
  const [time, setTime] = useState(() =>
    timeInputValue(event === undefined ? new Date() : new Date(event.startedAt)),
  );
  const [amount, setAmount] = useState(() =>
    event?.amount === undefined ? '' : String(event.amount),
  );
  const [unit, setUnit] = useState<VolumeUnit>(() => volumeUnitOf(event?.unit));
  const [target, setTarget] = useState<EventTarget>(() => babyTarget(babyId));
  const [timeError, setTimeError] = useState<string | undefined>(undefined);
  const [amountError, setAmountError] = useState<string | undefined>(undefined);

  // An edit belongs to the event's own baby, so the target is not a choice
  // there: moving a feeding to the other twin is not editing it.
  const saveTarget = editing ? babyTarget(babyId) : target;

  const save = useMutation({
    // `amountMl` is already canonical: the conversion happens in the submit
    // handler, so the mutation has one unit and no unit to decide about.
    mutationFn: (payload: { startedAt: string; amountMl: number }) =>
      saveBabyEvent(familyId, saveTarget, event?.id, {
        type: 'FEEDING',
        startedAt: payload.startedAt,
        amount: payload.amountMl,
        unit: CANONICAL_VOLUME_UNIT,
      }),
    onSuccess: async () => {
      // Awaited, so the form is still in its saving state until the list the
      // parent is about to look at actually holds the new feeding. For "both"
      // that is each twin's list: the one on screen refreshes now, the other
      // the moment it is shown.
      await refreshEventsFor(queryClient, familyId, targetBabyIds(saveTarget, babies));
      onSaved();
    },
  });

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();

    // An edit keeps the day the feeding was recorded on; only its clock time is
    // being changed here.
    const day = event === undefined ? new Date() : new Date(event.startedAt);
    const startedAt = startedAtFrom(time, day);
    const trimmedAmount = amount.trim();
    // `Number('')` is 0, so emptiness is answered before the schema is asked.
    const parsedAmount =
      trimmedAmount.length === 0 ? undefined : amountSchema.safeParse(Number(trimmedAmount));

    setTimeError(startedAt === null ? t('today.feeding.errors.invalidTime') : undefined);
    setAmountError(
      parsedAmount === undefined
        ? t('today.feeding.errors.requiredAmount')
        : parsedAmount.success
          ? undefined
          : t('today.feeding.errors.invalidAmount'),
    );

    if (startedAt === null || parsedAmount === undefined || !parsedAmount.success) {
      return;
    }

    // Validated in the unit the parent chose, converted once, here at the edge.
    save.mutate({ startedAt, amountMl: volumeToMl(parsedAmount.data, unit) });
  }

  return (
    <Card title={editing ? t('today.feeding.editTitle') : t('today.feeding.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {save.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {editing
              ? t('today.feeding.errors.updateFailed')
              : t('today.feeding.errors.saveFailed')}
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
          label={t('today.feeding.time')}
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

        <div className="flex items-start gap-2">
          <div className="flex-1">
            <TextField
              label={t('today.feeding.amount')}
              type="number"
              name="amount"
              inputMode="decimal"
              step="any"
              min={0}
              value={amount}
              onChange={(changeEvent) => {
                setAmount(changeEvent.target.value);
              }}
              error={amountError}
              disabled={save.isPending}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor={unitId} className="block text-sm font-medium text-ink">
              {t('today.feeding.unit')}
            </label>
            <select
              id={unitId}
              name="unit"
              value={unit}
              onChange={(changeEvent) => {
                setUnit(changeEvent.target.value as VolumeUnit);
              }}
              disabled={save.isPending}
              className={[
                'min-h-touch rounded-field border border-line bg-surface px-3 text-base text-ink',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
              ].join(' ')}
            >
              {VOLUME_UNITS.map((volumeUnit) => (
                <option key={volumeUnit} value={volumeUnit}>
                  {t(`today.feeding.units.${volumeUnit}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="submit" fullWidth disabled={save.isPending}>
            {save.isPending ? t('today.feeding.saving') : t('today.feeding.save')}
          </Button>
          <Button type="button" variant="quiet" onClick={onCancel} disabled={save.isPending}>
            {t('today.feeding.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
