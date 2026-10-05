import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BABY_GENDERS,
  babyNameSchema,
  createBabySchema,
  type BabyGender,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { queryKeys } from '../../services/queryKeys.js';
import { createBaby } from './api.js';

/**
 * Adding a baby to the family — the second and last thing a fresh account has
 * to do before the tracker is usable.
 *
 * It is one form, used twice: this is how a family with twins gets both of
 * them, and how a family with one baby gets one. There is deliberately no
 * "add twins" action and no twin-shaped payload — the data model already
 * treats every baby as independent (spec §6), so two babies are simply two
 * creations, and nothing downstream has to know which is which.
 *
 * The fields are the whole of the existing create contract — `name`,
 * `birthDate`, `gender` — validated here with `createBabySchema`'s own pieces
 * rather than a second set of rules written out beside them.
 */

/** `z.coerce.date()`, straight from the schema the API validates with. */
const birthDateSchema = createBabySchema.shape.birthDate.unwrap();

/**
 * The gender choices, with the shared vocabulary preceded by the one the
 * contract expresses as absence. `''` is "not specified": the field is
 * optional, and a parent who does not want to record it should be able to say
 * so by leaving the visible default alone rather than by finding no answer
 * that fits.
 */
const GENDER_CHOICES = ['', ...BABY_GENDERS] as const;

/** Each choice previews the colour the baby will be shown in. */
const GENDER_TONE: Record<BabyGender | 'unspecified', string> = {
  MALE: 'boy',
  FEMALE: 'girl',
  unspecified: 'family',
};

export interface AddBabyFormProps {
  /** The family the baby is created in — resolved by the API from the path. */
  familyId: string;
  /** Called once the baby exists and the babies query has been refreshed. */
  onCreated?: () => void;
  /** Offered only when there is already a tracker to go back to. */
  onCancel?: () => void;
}

export function AddBabyForm({ familyId, onCreated, onCancel }: AddBabyFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<BabyGender | ''>('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [birthDateError, setBirthDateError] = useState<string | undefined>(undefined);

  const create = useMutation({
    mutationFn: (input: { name: string; birthDate?: Date; gender?: BabyGender }) =>
      createBaby(familyId, input),
    onSuccess: async () => {
      // Awaited, so the screen only leaves this form once the babies query
      // holds the new baby — no reload, and no flash of the empty state.
      await queryClient.invalidateQueries({ queryKey: queryKeys.babies(familyId) });
      onCreated?.();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // The shared schema is the contract the API validates against, so the same
    // trim and the same bounds decide here.
    const parsedName = babyNameSchema.safeParse(name);
    setNameError(
      parsedName.success
        ? undefined
        : name.trim().length === 0
          ? t('today.baby.errors.required')
          : t('today.baby.errors.tooLong'),
    );

    // Optional, so an empty field is not an error — it is the absence the
    // contract already allows, and nothing is sent for it.
    const trimmedBirthDate = birthDate.trim();
    const parsedBirthDate =
      trimmedBirthDate.length === 0 ? undefined : birthDateSchema.safeParse(trimmedBirthDate);
    setBirthDateError(
      parsedBirthDate?.success === false ? t('today.baby.errors.invalidBirthDate') : undefined,
    );

    if (!parsedName.success || parsedBirthDate?.success === false) {
      return;
    }

    // Both optional fields are omitted rather than sent empty: the API stores a
    // birth date or a gender only when there is one.
    create.mutate({
      name: parsedName.data,
      ...(parsedBirthDate?.success === true ? { birthDate: parsedBirthDate.data } : {}),
      ...(gender === '' ? {} : { gender }),
    });
  }

  return (
    <Card title={t('today.baby.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <p className="text-sm text-muted">{t('today.baby.intro')}</p>

        {create.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {t('today.baby.errors.createFailed')}
          </p>
        ) : null}

        <TextField
          label={t('today.baby.name')}
          name="name"
          autoComplete="off"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          error={nameError}
          disabled={create.isPending}
          required
        />

        <TextField
          label={t('today.baby.birthDate')}
          type="date"
          name="birthDate"
          value={birthDate}
          onChange={(event) => {
            setBirthDate(event.target.value);
          }}
          error={birthDateError}
          disabled={create.isPending}
        />

        <fieldset className="space-y-1" disabled={create.isPending}>
          <legend className="mb-1 block text-sm font-medium text-ink">
            {t('today.baby.gender')}
          </legend>
          {/*
            Real radios, visually hidden and driven by their labels, exactly as
            the nappy form does it: a full touch target each, and keyboard and
            screen-reader behaviour for free.
          */}
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

        {/* Nothing is cleared on failure: a failed create is retried, not retyped. */}
        <div className="flex gap-2">
          <Button type="submit" fullWidth disabled={create.isPending}>
            {create.isPending ? t('today.baby.submitting') : t('today.baby.submit')}
          </Button>
          {onCancel === undefined ? null : (
            <Button type="button" variant="quiet" onClick={onCancel} disabled={create.isPending}>
              {t('today.baby.cancel')}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
