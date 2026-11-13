import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  HEALTH_CATEGORIES,
  IMMUNIZATION_SCHEDULE,
  IMMUNIZATION_VACCINES,
  type Baby,
  type HealthRecord,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { PillRadioGroup } from '../../components/ui/PillRadioGroup.js';
import { TextField } from '../../components/ui/TextField.js';
import { queryKeys } from '../../services/queryKeys.js';
import { saveHealthRecord } from './api.js';
import {
  DOSE_UNITS,
  buildHealthRecordBody,
  initialFormValues,
  localDateOf,
  localTimeOf,
  localized,
  type HealthFormErrors,
  type HealthFormField,
  type HealthFormValues,
} from './healthModel.js';

/**
 * Recording or editing one medical event.
 *
 * Optional everywhere except the category, the moment and the name. A dose is
 * only ever what the parent types from the label or the doctor's instruction —
 * the form shows the decree's stated volume as a hint on the schedule, never as
 * a value in the field. Choosing a dose from the Armenian schedule links the
 * record to it (see `buildHealthRecordBody`); the link is a pointer, and the
 * record keeps its own name, date and product.
 */

export interface HealthRecordFormProps {
  familyId: string;
  baby: Baby;
  timeZone: string;
  /** The record being edited; absent for a new one. */
  record?: HealthRecord | undefined;
  /** Starting values for a new record, e.g. from "Record this dose". */
  prefill?: Partial<HealthFormValues> | undefined;
  onSaved: () => void;
  onCancel: () => void;
}

function Select({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={[
          'min-h-touch w-full rounded-field border border-line bg-surface px-3 text-base text-ink',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
        ].join(' ')}
      >
        {children}
      </select>
    </div>
  );
}

export function HealthRecordForm({
  familyId,
  baby,
  timeZone,
  record,
  prefill,
  onSaved,
  onCancel,
}: HealthRecordFormProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const editing = record !== undefined;

  /** A dose picked from the schedule fills in an empty name and purpose, never a dose. */
  const withScheduledDefaults = (current: HealthFormValues, key: string): HealthFormValues => {
    const item = IMMUNIZATION_SCHEDULE.find((candidate) => candidate.key === key);
    const vaccine = IMMUNIZATION_VACCINES.find((candidate) => candidate.id === item?.vaccineId);
    if (!item || !vaccine) return { ...current, scheduleKey: key };
    return {
      ...current,
      scheduleKey: key,
      name:
        current.name.trim() === ''
          ? `${localized(vaccine.abbreviation, i18n.language)} (${t('health.schedule.doseOf', {
              n: item.dose,
              total: item.totalDoses,
            })})`
          : current.name,
      purpose:
        current.purpose.trim() === ''
          ? localized(vaccine.protectsAgainst, i18n.language)
          : current.purpose,
    };
  };

  const [values, setValues] = useState<HealthFormValues>(() => {
    const now = new Date().toISOString();
    const initial = initialFormValues(
      record,
      { today: localDateOf(now, timeZone), now: localTimeOf(now, timeZone), timeZone },
      prefill,
    );
    return record === undefined && initial.scheduleKey !== ''
      ? withScheduledDefaults(initial, initial.scheduleKey)
      : initial;
  });
  const [errors, setErrors] = useState<HealthFormErrors>({});

  const save = useMutation({
    mutationFn: (body: Parameters<typeof saveHealthRecord>[3]) =>
      saveHealthRecord(familyId, baby.id, record?.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.healthRecords(familyId, baby.id) });
      onSaved();
    },
  });

  const set = <Field extends HealthFormField>(field: Field, value: HealthFormValues[Field]) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();
    const result = buildHealthRecordBody(values, {
      timeZone,
      birthDate: baby.birthDate === undefined ? undefined : baby.birthDate.slice(0, 10),
      now: new Date(),
      original: record,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(result.body);
  }

  const error = (field: HealthFormField): string | undefined => {
    const key = errors[field];
    return key === undefined ? undefined : t(`health.form.errors.${key}`);
  };

  const scheduledDose = IMMUNIZATION_SCHEDULE.find((item) => item.key === values.scheduleKey);
  const retiredKey = values.scheduleKey !== '' && scheduledDose === undefined;
  const busy = save.isPending;

  function chooseScheduledDose(key: string): void {
    setValues((current) =>
      key === '' ? { ...current, scheduleKey: '' } : withScheduledDefaults(current, key),
    );
  }

  return (
    <Card
      title={
        editing
          ? t('health.form.editTitle', { name: baby.name })
          : t('health.form.title', { name: baby.name })
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {save.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {editing ? t('health.form.errors.updateFailed') : t('health.form.errors.saveFailed')}
          </p>
        ) : null}

        <PillRadioGroup
          legend={t('health.form.category')}
          name="health-category"
          columns={3}
          value={values.category}
          disabled={busy}
          options={HEALTH_CATEGORIES.map((category) => ({
            value: category,
            label: t(`health.categories.${category}`),
          }))}
          onChange={(category) => {
            set('category', category);
          }}
        />

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('health.form.date')}
            type="date"
            name="date"
            value={values.date}
            onChange={(event) => {
              set('date', event.target.value);
            }}
            error={error('date')}
            disabled={busy}
            required
          />
          <TextField
            label={t('health.form.time')}
            type="time"
            name="time"
            value={values.time}
            onChange={(event) => {
              set('time', event.target.value);
            }}
            disabled={busy}
            required
          />
        </div>

        {values.category === 'vaccination' ? (
          <div className="space-y-1">
            <Select
              label={t('health.form.scheduleDose')}
              value={values.scheduleKey}
              disabled={busy}
              onChange={chooseScheduledDose}
            >
              <option value="">{t('health.form.scheduleNone')}</option>
              {retiredKey ? (
                <option value={values.scheduleKey}>
                  {t('health.form.scheduleRetired', { key: values.scheduleKey })}
                </option>
              ) : null}
              {IMMUNIZATION_SCHEDULE.map((item) => {
                const vaccine = IMMUNIZATION_VACCINES.find(
                  (candidate) => candidate.id === item.vaccineId,
                );
                return (
                  <option key={item.key} value={item.key}>
                    {vaccine ? localized(vaccine.abbreviation, i18n.language) : item.key} —{' '}
                    {t('health.schedule.doseOf', { n: item.dose, total: item.totalDoses })}
                  </option>
                );
              })}
            </Select>
            <p className="text-sm text-muted">{t('health.form.scheduleHint')}</p>
          </div>
        ) : null}

        <TextField
          label={t('health.form.name')}
          name="name"
          autoComplete="off"
          maxLength={200}
          value={values.name}
          onChange={(event) => {
            set('name', event.target.value);
          }}
          error={error('name')}
          disabled={busy}
          required
        />
        <TextField
          label={t('health.form.purpose')}
          name="purpose"
          autoComplete="off"
          maxLength={1000}
          value={values.purpose}
          onChange={(event) => {
            set('purpose', event.target.value);
          }}
          disabled={busy}
        />
        <TextField
          label={t('health.form.description')}
          name="description"
          autoComplete="off"
          maxLength={1000}
          value={values.description}
          onChange={(event) => {
            set('description', event.target.value);
          }}
          disabled={busy}
        />

        <div className="space-y-1">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('health.form.doseValue')}
              name="doseValue"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.doseValue}
              onChange={(event) => {
                set('doseValue', event.target.value);
              }}
              error={error('doseValue')}
              disabled={busy}
            />
            <div className="space-y-1">
              <Select
                label={t('health.form.doseUnit')}
                value={values.doseUnit}
                disabled={busy}
                onChange={(unit) => {
                  set('doseUnit', unit as HealthFormValues['doseUnit']);
                }}
              >
                <option value="">{t('health.form.doseUnitNone')}</option>
                {DOSE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(`health.units.${unit}`)}
                  </option>
                ))}
              </Select>
              {errors.doseUnit === undefined ? null : (
                <p className="text-sm text-critical">{error('doseUnit')}</p>
              )}
            </div>
          </div>
          <p className="text-sm text-muted">{t('health.form.doseHint')}</p>
        </div>

        <TextField
          label={t('health.form.productName')}
          name="productName"
          autoComplete="off"
          maxLength={200}
          value={values.productName}
          onChange={(event) => {
            set('productName', event.target.value);
          }}
          disabled={busy}
        />
        <TextField
          label={t('health.form.manufacturer')}
          name="manufacturer"
          autoComplete="off"
          maxLength={200}
          value={values.manufacturer}
          onChange={(event) => {
            set('manufacturer', event.target.value);
          }}
          disabled={busy}
        />
        <TextField
          label={t('health.form.provider')}
          name="provider"
          autoComplete="off"
          maxLength={200}
          value={values.provider}
          onChange={(event) => {
            set('provider', event.target.value);
          }}
          disabled={busy}
        />
        <TextField
          label={t('health.form.nextDueOn')}
          type="date"
          name="nextDueOn"
          value={values.nextDueOn}
          onChange={(event) => {
            set('nextDueOn', event.target.value);
          }}
          error={error('nextDueOn')}
          disabled={busy}
        />
        <TextField
          label={t('health.form.note')}
          name="note"
          autoComplete="off"
          maxLength={2000}
          value={values.note}
          onChange={(event) => {
            set('note', event.target.value);
          }}
          disabled={busy}
        />

        <p className="text-sm text-muted">{t('health.records.attachmentsNote')}</p>

        <div className="flex gap-2">
          <Button type="submit" fullWidth disabled={busy}>
            {busy ? t('health.form.saving') : t('health.form.save')}
          </Button>
          <Button type="button" variant="quiet" onClick={onCancel} disabled={busy}>
            {t('health.form.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
