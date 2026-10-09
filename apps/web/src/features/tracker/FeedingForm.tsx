import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BREAST_SIDES,
  DEFAULT_UNITS,
  FEEDING_KINDS,
  VOLUME_UNITS,
  createBabyEventSchema,
  volumeToMl,
  type Baby,
  type BabyEvent,
  type BreastSide,
  type FeedingData,
  type FeedingKind,
  type VolumeUnit,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { PillRadioGroup } from '../../components/ui/PillRadioGroup.js';
import { TextField } from '../../components/ui/TextField.js';
import { saveBabyEvent, type UpdateBabyEventPayload } from './api.js';
import { EventTargetField } from './EventTargetField.js';
import { babyTarget, refreshEventsFor, targetBabyIds, type EventTarget } from './eventTarget.js';
import { endedAtFrom, startedAtFrom, timeInputValue, timePlusMinutes } from './eventTime.js';

/**
 * Recording a feeding: breast, expressed breast milk, or formula.
 *
 * The kind decides the rest of the form, because it decides what can honestly
 * be recorded:
 *
 * - **Breast** has no volume a parent can read, so there is no amount field at
 *   all. It records a side (optional), a start, and — only if the parent knows
 *   it — an end, typed or set with one tap of a quick duration. Nothing beyond
 *   the start time is required; at 3 a.m. "she fed at 03:10" is a complete entry.
 * - **Expressed milk** and **formula** are bottles, with an amount in ml or oz
 *   converted to canonical millilitres here, at the UI edge (D3), exactly as the
 *   form always did.
 *
 * A new feeding starts on the kind of the baby's last feeding today, falling
 * back to breast: most feedings repeat the previous one, and one tap fewer is
 * the point.
 *
 * Editing a feeding recorded before kinds existed opens with no kind chosen and
 * the bottle fields showing, and saves it exactly as it was unless the parent
 * picks a kind — the app does not guess what an old bottle held.
 *
 * Changing kind while editing clears what no longer applies — the volume of a
 * bottle turned breastfeed, the end time of a breastfeed turned bottle — by
 * sending `null`, which the API reads as "remove", so nothing stale is left on
 * the stored event.
 */

/** `z.number().nonnegative()`, straight from the schema the API validates with. */
const amountSchema = createBabyEventSchema.shape.amount.unwrap();

/** What every volume is stored in, whatever the parent typed it in (D3). */
const CANONICAL_VOLUME_UNIT: VolumeUnit = 'ml';

/** One-tap lengths for a breastfeed, in minutes. */
const QUICK_DURATIONS = [5, 10, 15, 20, 30] as const;

/**
 * Longer than any one breastfeed a parent would mean. Guards the case the
 * next-day rule creates: an end typed a few minutes *before* the start reads as
 * almost a day later, and that is far more likely a slip than a 23-hour feed.
 */
const MAX_BREASTFEED_MINUTES = 4 * 60;

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
  /** What a new feeding starts on; `breast` when not given. */
  defaultKind?: FeedingKind | undefined;
  /** Called once the feeding is saved and the event list has been refreshed. */
  onSaved: () => void;
  onCancel: () => void;
}

export function FeedingForm({
  familyId,
  babyId,
  babies,
  event,
  defaultKind,
  onSaved,
  onCancel,
}: FeedingFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const unitId = useId();
  const editing = event !== undefined;

  // Defaulted once, on mount: the clock must not move under the parent while
  // they are typing. An edit starts from the stored values instead.
  const [kind, setKind] = useState<FeedingKind | null>(() =>
    event === undefined ? (defaultKind ?? 'breast') : (event.feeding?.kind ?? null),
  );
  const [side, setSide] = useState<BreastSide | null>(() =>
    event?.feeding?.kind === 'breast' ? (event.feeding.side ?? null) : null,
  );
  const [time, setTime] = useState(() =>
    timeInputValue(event === undefined ? new Date() : new Date(event.startedAt)),
  );
  const [endTime, setEndTime] = useState(() =>
    event?.endedAt === undefined ? '' : timeInputValue(new Date(event.endedAt)),
  );
  const [amount, setAmount] = useState(() =>
    event?.amount === undefined ? '' : String(event.amount),
  );
  const [unit, setUnit] = useState<VolumeUnit>(() => volumeUnitOf(event?.unit));
  const [target, setTarget] = useState<EventTarget>(() => babyTarget(babyId));
  const [timeError, setTimeError] = useState<string | undefined>(undefined);
  const [endTimeError, setEndTimeError] = useState<string | undefined>(undefined);
  const [amountError, setAmountError] = useState<string | undefined>(undefined);

  // An edit belongs to the event's own baby, so the target is not a choice
  // there: moving a feeding to the other twin is not editing it.
  const saveTarget = editing ? babyTarget(babyId) : target;
  const isBreast = kind === 'breast';

  const save = useMutation({
    mutationFn: (payload: UpdateBabyEventPayload) =>
      saveBabyEvent(familyId, saveTarget, event?.id, { type: 'FEEDING', ...payload }),
    onSuccess: async () => {
      // Awaited, so the form is still in its saving state until the list the
      // parent is about to look at actually holds the new feeding. For "both"
      // that is each twin's list: the one on screen refreshes now, the other
      // the moment it is shown.
      await refreshEventsFor(queryClient, familyId, targetBabyIds(saveTarget, babies));
      onSaved();
    },
  });

  function breastPayload(startedAt: string, day: Date): UpdateBabyEventPayload | null {
    const trimmedEnd = endTime.trim();
    let endedAt: string | null = null;
    let endError: string | undefined;

    if (trimmedEnd.length > 0) {
      endedAt = endedAtFrom(trimmedEnd, startedAt, day);
      if (endedAt === null) {
        endError = t('today.feeding.errors.invalidEndTime');
      } else if ((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000 > MAX_BREASTFEED_MINUTES) {
        endError = t('today.feeding.errors.endTooLate');
      }
    }
    setEndTimeError(endError);
    setAmountError(undefined);
    if (endError !== undefined) {
      return null;
    }

    const feeding: FeedingData = side === null ? { kind: 'breast' } : { kind: 'breast', side };
    return {
      startedAt,
      feeding,
      // No end typed: nothing on a create, and a removal on an edit that had one.
      ...(endedAt !== null
        ? { endedAt }
        : editing && event.endedAt !== undefined
          ? { endedAt: null }
          : {}),
      // A bottle turned breastfeed loses its volume rather than keeping one
      // the breast never had.
      ...(editing && event.amount !== undefined ? { amount: null, unit: null } : {}),
    };
  }

  function bottlePayload(startedAt: string): UpdateBabyEventPayload | null {
    const trimmedAmount = amount.trim();
    // `Number('')` is 0, so emptiness is answered before the schema is asked.
    const parsedAmount =
      trimmedAmount.length === 0 ? undefined : amountSchema.safeParse(Number(trimmedAmount));

    setEndTimeError(undefined);
    setAmountError(
      parsedAmount === undefined
        ? t('today.feeding.errors.requiredAmount')
        : parsedAmount.success
          ? undefined
          : t('today.feeding.errors.invalidAmount'),
    );
    if (parsedAmount === undefined || !parsedAmount.success) {
      return null;
    }

    return {
      startedAt,
      // Validated in the unit the parent chose, converted once, here at the edge.
      amount: volumeToMl(parsedAmount.data, unit),
      unit: CANONICAL_VOLUME_UNIT,
      // `null` only for an old feeding nobody has given a kind: saved as it was.
      ...(kind === null ? {} : { feeding: { kind } }),
      // A breastfeed turned bottle drops the end time it no longer shows.
      ...(editing && kind !== null && event.endedAt !== undefined ? { endedAt: null } : {}),
    };
  }

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();

    // An edit keeps the day the feeding was recorded on; only its clock time is
    // being changed here.
    const day = event === undefined ? new Date() : new Date(event.startedAt);
    const startedAt = startedAtFrom(time, day);
    setTimeError(startedAt === null ? t('today.feeding.errors.invalidTime') : undefined);

    const payload =
      startedAt === null
        ? null
        : isBreast
          ? breastPayload(startedAt, day)
          : bottlePayload(startedAt);
    if (startedAt === null || payload === null) {
      return;
    }

    save.mutate(payload);
  }

  const kindOptions = FEEDING_KINDS.map((value) => ({
    value,
    label: t(`today.feeding.kinds.${value}`),
  }));
  const sideOptions = BREAST_SIDES.map((value) => ({
    value,
    label: t(`today.feeding.sides.${value}`),
  }));

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

        <PillRadioGroup
          legend={t('today.feeding.kind')}
          name="feedingKind"
          options={kindOptions}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setAmountError(undefined);
            setEndTimeError(undefined);
          }}
          disabled={save.isPending}
        />

        {isBreast ? (
          <PillRadioGroup
            legend={t('today.feeding.side')}
            name="breastSide"
            options={sideOptions}
            value={side}
            onChange={setSide}
            disabled={save.isPending}
          />
        ) : null}

        <TextField
          label={isBreast ? t('today.feeding.start') : t('today.feeding.time')}
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

        {isBreast ? (
          <div className="space-y-2">
            <TextField
              label={t('today.feeding.end')}
              type="time"
              name="endedAt"
              value={endTime}
              onChange={(changeEvent) => {
                setEndTime(changeEvent.target.value);
              }}
              error={endTimeError}
              disabled={save.isPending}
            />
            <div
              role="group"
              aria-label={t('today.feeding.quickDuration')}
              className="flex flex-wrap gap-2"
            >
              {QUICK_DURATIONS.map((minutes) => {
                const end = timePlusMinutes(time, minutes);
                const selected = end !== null && end === endTime;
                return (
                  <button
                    key={minutes}
                    type="button"
                    aria-pressed={selected}
                    disabled={save.isPending || end === null}
                    onClick={() => {
                      if (end !== null) {
                        setEndTime(end);
                        setEndTimeError(undefined);
                      }
                    }}
                    className={[
                      'min-h-touch rounded-full border px-3 text-sm font-medium',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
                      selected
                        ? 'border-tone bg-tone-soft text-tone-ink'
                        : 'border-line bg-surface text-muted',
                    ].join(' ')}
                  >
                    {t('today.feeding.plusMinutes', { minutes })}
                  </button>
                );
              })}
              {endTime.length > 0 ? (
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => {
                    setEndTime('');
                    setEndTimeError(undefined);
                  }}
                  className={[
                    'min-h-touch rounded-full px-3 text-sm font-medium text-muted underline',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
                  ].join(' ')}
                >
                  {t('today.feeding.clearEnd')}
                </button>
              ) : null}
            </div>
            <p className="text-sm text-muted">{t('today.feeding.endOptional')}</p>
          </div>
        ) : (
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
        )}

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
