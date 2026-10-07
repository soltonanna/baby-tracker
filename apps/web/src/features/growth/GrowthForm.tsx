import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  GROWTH_INDICATORS,
  GROWTH_LIMITS,
  MEASUREMENT_SOURCES,
  lengthToMm,
  weightToGrams,
  type Baby,
  type GrowthIndicator,
  type GrowthMeasurement,
  type LengthUnit,
  type MeasurementSource,
  type UnitPreferences,
  type WeightUnit,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { queryKeys } from '../../services/queryKeys.js';
import { saveGrowth } from './api.js';
import { FIELD_FOR, calendarDateOf, toDisplay, unitFor } from './growthMath.js';

/**
 * Recording one measurement visit: the date, and any of weight, length and
 * head circumference. A home weigh-in fills one field, a clinic visit three.
 *
 * The parent types in their own units (their account's preference); this form
 * is the D3 edge, so grams and millimetres are what leave it. With a
 * `measurement` it edits instead: fields start from the stored values in the
 * parent's units, and a field emptied during an edit is sent as `null`, which
 * removes that value rather than leaving the old one behind.
 *
 * The range checks catch a value typed in the wrong unit. They never say a
 * value is too high or too low for a baby — only that it does not look like a
 * weight, a length or a head circumference at all.
 */

type Values = Record<GrowthIndicator, string>;

export interface GrowthFormProps {
  familyId: string;
  baby: Baby;
  units: UnitPreferences;
  /** Today's date in the parent's calendar, 'YYYY-MM-DD' — the default for a new entry. */
  today: string;
  measurement?: GrowthMeasurement | undefined;
  onSaved: () => void;
  onCancel: () => void;
}

function initialValues(measurement: GrowthMeasurement | undefined, units: UnitPreferences): Values {
  const value = (indicator: GrowthIndicator): string => {
    const stored = measurement?.[FIELD_FOR[indicator]];
    return stored === undefined
      ? ''
      : String(toDisplay(indicator, stored, unitFor(indicator, units)));
  };
  return {
    weight: value('weight'),
    length: value('length'),
    headCircumference: value('headCircumference'),
  };
}

function toCanonical(indicator: GrowthIndicator, value: number, units: UnitPreferences): number {
  return indicator === 'weight'
    ? weightToGrams(value, units.weight as WeightUnit)
    : lengthToMm(value, units.length as LengthUnit);
}

export function GrowthForm({
  familyId,
  baby,
  units,
  today,
  measurement,
  onSaved,
  onCancel,
}: GrowthFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editing = measurement !== undefined;

  const [measuredOn, setMeasuredOn] = useState(() =>
    measurement === undefined ? today : calendarDateOf(measurement.measuredOn),
  );
  const [values, setValues] = useState<Values>(() => initialValues(measurement, units));
  const [source, setSource] = useState<MeasurementSource | ''>(measurement?.source ?? '');
  const [note, setNote] = useState(measurement?.note ?? '');
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<GrowthIndicator, string>>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof saveGrowth>[3]) =>
      saveGrowth(familyId, baby.id, measurement?.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.growth(familyId, baby.id) });
      onSaved();
    },
  });

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();

    // The date: a real calendar date, not after today, not before birth.
    const birthDate = baby.birthDate === undefined ? undefined : calendarDateOf(baby.birthDate);
    const nextDateError = !/^\d{4}-\d{2}-\d{2}$/.test(measuredOn)
      ? t('growth.form.errors.invalidDate')
      : measuredOn > today
        ? t('growth.form.errors.futureDate')
        : birthDate !== undefined && measuredOn < birthDate
          ? t('growth.form.errors.beforeBirth')
          : undefined;

    // Each value: empty is allowed, otherwise a positive number that converts
    // into the canonical range.
    const canonical: Partial<Record<GrowthIndicator, number>> = {};
    const nextFieldErrors: Partial<Record<GrowthIndicator, string>> = {};
    for (const indicator of GROWTH_INDICATORS) {
      const raw = values[indicator].trim().replace(',', '.');
      if (raw.length === 0) continue;
      const number = Number(raw);
      if (!Number.isFinite(number) || number <= 0) {
        nextFieldErrors[indicator] = t('growth.form.errors.notANumber');
        continue;
      }
      const converted = toCanonical(indicator, number, units);
      const { min, max } = GROWTH_LIMITS[FIELD_FOR[indicator]];
      if (converted < min || converted > max) {
        nextFieldErrors[indicator] = t('growth.form.errors.outOfRange', {
          unit: t(`growth.units.${unitFor(indicator, units)}`),
        });
        continue;
      }
      canonical[indicator] = converted;
    }

    const anyValue = Object.keys(canonical).length > 0;
    const anyFieldError = Object.keys(nextFieldErrors).length > 0;
    setDateError(nextDateError);
    setFieldErrors(nextFieldErrors);
    setFormError(!anyValue && !anyFieldError ? t('growth.form.errors.nothingEntered') : undefined);
    if (nextDateError !== undefined || anyFieldError || !anyValue) return;

    const trimmedNote = note.trim();
    if (editing) {
      // A whole body, with emptied fields as `null` so they are removed.
      save.mutate({
        measuredOn,
        weightGrams: canonical.weight ?? null,
        lengthMm: canonical.length ?? null,
        headCircumferenceMm: canonical.headCircumference ?? null,
        source: source === '' ? null : source,
        note: trimmedNote === '' ? null : trimmedNote,
      });
    } else {
      save.mutate({
        measuredOn,
        ...(canonical.weight === undefined ? {} : { weightGrams: canonical.weight }),
        ...(canonical.length === undefined ? {} : { lengthMm: canonical.length }),
        ...(canonical.headCircumference === undefined
          ? {}
          : { headCircumferenceMm: canonical.headCircumference }),
        ...(source === '' ? {} : { source }),
        ...(trimmedNote === '' ? {} : { note: trimmedNote }),
      });
    }
  }

  return (
    <Card
      title={
        editing
          ? t('growth.form.editTitle', { name: baby.name })
          : t('growth.form.title', { name: baby.name })
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {save.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {editing ? t('growth.form.errors.updateFailed') : t('growth.form.errors.saveFailed')}
          </p>
        ) : null}
        {formError === undefined ? null : (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {formError}
          </p>
        )}

        <TextField
          label={t('growth.form.date')}
          type="date"
          name="measuredOn"
          max={today}
          value={measuredOn}
          onChange={(changeEvent) => {
            setMeasuredOn(changeEvent.target.value);
          }}
          error={dateError}
          disabled={save.isPending}
          required
        />

        {GROWTH_INDICATORS.map((indicator) => (
          <TextField
            key={indicator}
            label={t('growth.form.valueLabel', {
              indicator: t(`growth.indicator.${indicator}`),
              unit: t(`growth.units.${unitFor(indicator, units)}`),
            })}
            type="text"
            inputMode="decimal"
            name={indicator}
            autoComplete="off"
            value={values[indicator]}
            onChange={(changeEvent) => {
              setValues((current) => ({ ...current, [indicator]: changeEvent.target.value }));
            }}
            error={fieldErrors[indicator]}
            disabled={save.isPending}
          />
        ))}

        <fieldset className="space-y-1" disabled={save.isPending}>
          <legend className="mb-1 block text-sm font-medium text-ink">
            {t('growth.form.source')}
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {(['', ...MEASUREMENT_SOURCES] as const).map((choice) => {
              const selected = choice === source;
              return (
                <label
                  key={choice === '' ? 'none' : choice}
                  className={[
                    'min-h-touch flex cursor-pointer items-center justify-center rounded-full',
                    'border px-3 text-center text-base font-medium',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                    'has-[:focus-visible]:outline-tone',
                    selected
                      ? 'border-tone bg-tone-soft text-tone-ink'
                      : 'border-tone-line bg-surface text-tone-ink',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="source"
                    value={choice}
                    checked={selected}
                    onChange={() => {
                      setSource(choice);
                    }}
                    className="sr-only"
                  />
                  {selected ? <span aria-hidden="true">✓</span> : null}
                  {t(`growth.sources.${choice === '' ? 'none' : choice}`)}
                </label>
              );
            })}
          </div>
        </fieldset>

        <TextField
          label={t('growth.form.note')}
          name="note"
          autoComplete="off"
          maxLength={1000}
          value={note}
          onChange={(changeEvent) => {
            setNote(changeEvent.target.value);
          }}
          disabled={save.isPending}
        />

        <div className="flex gap-2">
          <Button type="submit" fullWidth disabled={save.isPending}>
            {save.isPending ? t('growth.form.saving') : t('growth.form.save')}
          </Button>
          <Button type="button" variant="quiet" onClick={onCancel} disabled={save.isPending}>
            {t('growth.form.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
