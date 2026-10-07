import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BABY_GENDERS,
  babyNameSchema,
  gestationalAgeSchema,
  type Baby,
  type BabyGender,
  type UpdateBabyInput,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { queryKeys } from '../../services/queryKeys.js';
import { updateBaby } from './api.js';

/**
 * Editing a baby: name, birth date, sex and weeks of pregnancy at birth.
 *
 * Exists because a growth comparison needs the last three, and a baby added in
 * a hurry from the empty state often has none of them. Sends the whole form,
 * with an emptied optional field as `null` so it is cleared rather than kept.
 */

const GENDER_CHOICES = ['', ...BABY_GENDERS] as const;
const GENDER_TONE: Record<BabyGender | 'unspecified', string> = {
  MALE: 'boy',
  FEMALE: 'girl',
  unspecified: 'family',
};

export interface EditBabyFormProps {
  familyId: string;
  baby: Baby;
  onSaved: () => void;
  onCancel: () => void;
}

export function EditBabyForm({ familyId, baby, onSaved, onCancel }: EditBabyFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [name, setName] = useState(baby.name);
  const [birthDate, setBirthDate] = useState(baby.birthDate?.slice(0, 10) ?? '');
  const [gender, setGender] = useState<BabyGender | ''>(baby.gender ?? '');
  const [weeks, setWeeks] = useState(
    baby.gestationalAge === undefined ? '' : String(baby.gestationalAge.weeks),
  );
  const [days, setDays] = useState(
    baby.gestationalAge === undefined ? '' : String(baby.gestationalAge.days),
  );
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [birthDateError, setBirthDateError] = useState<string | undefined>(undefined);
  const [gestationError, setGestationError] = useState<string | undefined>(undefined);

  const save = useMutation({
    mutationFn: (patch: UpdateBabyInput) => updateBaby(familyId, baby.id, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.babies(familyId) });
      onSaved();
    },
  });

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();

    const parsedName = babyNameSchema.safeParse(name);
    setNameError(
      parsedName.success
        ? undefined
        : name.trim().length === 0
          ? t('today.baby.errors.required')
          : t('today.baby.errors.tooLong'),
    );

    const trimmedDate = birthDate.trim();
    const dateValid = trimmedDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(trimmedDate);
    setBirthDateError(dateValid ? undefined : t('today.baby.errors.invalidBirthDate'));

    // Weeks alone is enough (days default to 0); days without weeks is not.
    const weeksText = weeks.trim();
    const daysText = days.trim();
    const gestation =
      weeksText === '' && daysText === ''
        ? null
        : gestationalAgeSchema.safeParse({
            weeks: weeksText === '' ? Number.NaN : Number(weeksText),
            days: daysText === '' ? 0 : Number(daysText),
          });
    const gestationValid = gestation === null || gestation.success;
    setGestationError(gestationValid ? undefined : t('babyDetails.errors.gestation'));

    if (!parsedName.success || !dateValid || (gestation !== null && !gestation.success)) {
      return;
    }

    save.mutate({
      name: parsedName.data,
      birthDate: trimmedDate === '' ? null : new Date(`${trimmedDate}T00:00:00.000Z`),
      gender: gender === '' ? null : gender,
      gestationalAge: gestation === null ? null : gestation.data,
    });
  }

  return (
    <Card title={t('babyDetails.title', { name: baby.name })}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <p className="text-sm text-muted">{t('babyDetails.intro')}</p>

        {save.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {t('babyDetails.errors.saveFailed')}
          </p>
        ) : null}

        <TextField
          label={t('today.baby.name')}
          name="name"
          autoComplete="off"
          value={name}
          onChange={(changeEvent) => {
            setName(changeEvent.target.value);
          }}
          error={nameError}
          disabled={save.isPending}
          required
        />

        <TextField
          label={t('today.baby.birthDate')}
          type="date"
          name="birthDate"
          value={birthDate}
          onChange={(changeEvent) => {
            setBirthDate(changeEvent.target.value);
          }}
          error={birthDateError}
          disabled={save.isPending}
        />

        <fieldset className="space-y-1" disabled={save.isPending}>
          <legend className="mb-1 block text-sm font-medium text-ink">
            {t('babyDetails.sex')}
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {GENDER_CHOICES.map((choice) => {
              const selected = choice === gender;
              return (
                <label
                  key={choice === '' ? 'unspecified' : choice}
                  data-tone={GENDER_TONE[choice === '' ? 'unspecified' : choice]}
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
                    name="gender"
                    value={choice}
                    checked={selected}
                    onChange={() => {
                      setGender(choice);
                    }}
                    className="sr-only"
                  />
                  {t(`today.baby.genders.${choice === '' ? 'unspecified' : choice}`)}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-1" disabled={save.isPending}>
          <legend className="block text-sm font-medium text-ink">
            {t('babyDetails.gestation')}
          </legend>
          <p className="text-sm text-muted">{t('babyDetails.gestationHint')}</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <TextField
                label={t('babyDetails.weeks')}
                type="text"
                inputMode="numeric"
                name="gestationWeeks"
                autoComplete="off"
                value={weeks}
                onChange={(changeEvent) => {
                  setWeeks(changeEvent.target.value);
                }}
              />
            </div>
            <div className="flex-1">
              <TextField
                label={t('babyDetails.days')}
                type="text"
                inputMode="numeric"
                name="gestationDays"
                autoComplete="off"
                value={days}
                onChange={(changeEvent) => {
                  setDays(changeEvent.target.value);
                }}
              />
            </div>
          </div>
          {gestationError === undefined ? null : (
            <p className="text-sm text-critical">{gestationError}</p>
          )}
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" fullWidth disabled={save.isPending}>
            {save.isPending ? t('babyDetails.saving') : t('babyDetails.save')}
          </Button>
          <Button type="button" variant="quiet" onClick={onCancel} disabled={save.isPending}>
            {t('babyDetails.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
