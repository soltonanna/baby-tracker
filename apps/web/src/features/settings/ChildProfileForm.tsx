import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BABY_GENDERS,
  BABY_NOTES_MAX,
  BABY_PHOTO_CONTENT_TYPES,
  GROWTH_LIMITS,
  babyBirthLengthSchema,
  babyBirthTimeSchema,
  babyBirthWeightSchema,
  babyLastNameSchema,
  babyNameSchema,
  babyNotesSchema,
  lengthFromMm,
  lengthToMm,
  weightFromGrams,
  weightToGrams,
  type Baby,
  type BabyGender,
  type CreateBabyInput,
  type UnitPreferences,
  type UpdateBabyInput,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { queryKeys } from '../../services/queryKeys.js';
import { createBaby, updateBaby } from '../tracker/api.js';
import { BabyAvatar } from './BabyAvatar.js';
import { centimetresHint, gramsHint } from './birthMeasures.js';
import { deleteBabyPhoto, uploadBabyPhoto } from './api.js';
import { resizeImage } from './imageResize.js';

/**
 * Adding or editing a child's profile: name, birth details, notes and photo.
 *
 * Only the first name is required. Birth weight and length are typed in the
 * parent's own units and converted once, here, to the grams and millimetres
 * the API stores (D3); the metric value is shown under the field as they type,
 * so a hospital report in grams can be checked against what was entered.
 *
 * Editing sends the whole form, with an emptied optional field as `null` so it
 * is cleared rather than kept. The photo is a separate request after the
 * details are saved: a pending replacement is uploaded, a pending removal is
 * deleted, and neither touches the photo if the parent did not ask.
 */

const GENDER_CHOICES = ['', ...BABY_GENDERS] as const;
const GENDER_TONE: Record<BabyGender | 'unspecified', string> = {
  MALE: 'boy',
  FEMALE: 'girl',
  unspecified: 'family',
};

export interface ChildProfileFormProps {
  familyId: string;
  /** Present when editing; absent when adding a child. */
  baby?: Baby | undefined;
  units: UnitPreferences;
  /** `photoFailed` when the details were saved but the picture was not. */
  onSaved: (outcome: { photoFailed: boolean }) => void;
  onCancel: () => void;
}

/** The number a parent would type for a stored value, in their unit. */
const typed = (value: number | undefined, convert: (stored: number) => number): string =>
  value === undefined ? '' : String(convert(value));

const parseNumber = (raw: string): number => Number(raw.trim().replace(',', '.'));

export function ChildProfileForm({
  familyId,
  baby,
  units,
  onSaved,
  onCancel,
}: ChildProfileFormProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const editing = baby !== undefined;

  const [name, setName] = useState(baby?.name ?? '');
  const [lastName, setLastName] = useState(baby?.lastName ?? '');
  const [birthDate, setBirthDate] = useState(baby?.birthDate?.slice(0, 10) ?? '');
  const [birthTime, setBirthTime] = useState(baby?.birthTime ?? '');
  const [gender, setGender] = useState<BabyGender | ''>(baby?.gender ?? '');
  const [weight, setWeight] = useState(
    typed(baby?.birthWeightGrams, (grams) => weightFromGrams(grams, units.weight)),
  );
  const [length, setLength] = useState(
    typed(baby?.birthLengthMm, (mm) => lengthFromMm(mm, units.length)),
  );
  const [notes, setNotes] = useState(baby?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  // A new picture waits here, already shrunk, until Save. `removePhoto` marks a
  // stored one for removal.
  const [newPhoto, setNewPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | undefined>(undefined);
  const [processingPhoto, setProcessingPhoto] = useState(false);

  // Revokes the preview when it is replaced or the form closes.
  useEffect(() => {
    return () => {
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const locale = i18n.language;
  const weightGrams =
    weight.trim() === '' ? null : weightToGrams(parseNumber(weight), units.weight);
  const lengthMm = length.trim() === '' ? null : lengthToMm(parseNumber(length), units.length);
  const weightHint =
    weightGrams !== null && Number.isFinite(weightGrams) && weightGrams > 0
      ? t('childProfile.form.equals', { value: gramsHint(weightGrams, locale) })
      : undefined;
  const lengthHint =
    lengthMm !== null && Number.isFinite(lengthMm) && lengthMm > 0
      ? t('childProfile.form.equals', { value: centimetresHint(lengthMm, locale) })
      : undefined;

  const save = useMutation({
    mutationFn: async (details: CreateBabyInput | UpdateBabyInput): Promise<boolean> => {
      const saved = editing
        ? await updateBaby(familyId, baby.id, details as UpdateBabyInput)
        : await createBaby(familyId, details as CreateBabyInput);

      // The details are in; a failed picture must not undo them or hide that
      // they were saved, so it is reported rather than thrown.
      try {
        if (newPhoto !== null) {
          await uploadBabyPhoto(familyId, saved.id, newPhoto);
        } else if (removePhoto && baby?.hasPhoto === true) {
          await deleteBabyPhoto(familyId, saved.id);
        }
        return false;
      } catch {
        return true;
      }
    },
    onSuccess: async (photoFailed) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.babies(familyId) });
      onSaved({ photoFailed });
    },
  });

  async function handlePhoto(changeEvent: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = changeEvent.target;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;

    if (!(BABY_PHOTO_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      setPhotoError(t('childProfile.errors.photoType'));
      return;
    }
    setPhotoError(undefined);
    setProcessingPhoto(true);
    try {
      const shrunk = await resizeImage(file);
      setNewPhoto(shrunk);
      setPreviewUrl(URL.createObjectURL(shrunk));
      setRemovePhoto(false);
    } catch {
      setPhotoError(t('childProfile.errors.photoUnreadable'));
    } finally {
      setProcessingPhoto(false);
    }
  }

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();
    const next: Record<string, string | undefined> = {};

    const parsedName = babyNameSchema.safeParse(name);
    if (!parsedName.success) {
      next.name =
        name.trim().length === 0 ? t('today.baby.errors.required') : t('today.baby.errors.tooLong');
    }

    const trimmedLast = lastName.trim();
    if (trimmedLast !== '' && !babyLastNameSchema.safeParse(trimmedLast).success) {
      next.lastName = t('today.baby.errors.tooLong');
    }

    const trimmedDate = birthDate.trim();
    if (trimmedDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      next.birthDate = t('today.baby.errors.invalidBirthDate');
    }

    if (birthTime !== '' && !babyBirthTimeSchema.safeParse(birthTime).success) {
      next.birthTime = t('childProfile.errors.time');
    }

    if (weightGrams !== null && !babyBirthWeightSchema.safeParse(weightGrams).success) {
      next.weight = t('childProfile.errors.weight', {
        unit: units.weight,
        min: weightFromGrams(GROWTH_LIMITS.weightGrams.min, units.weight),
        max: weightFromGrams(GROWTH_LIMITS.weightGrams.max, units.weight),
      });
    }
    if (lengthMm !== null && !babyBirthLengthSchema.safeParse(lengthMm).success) {
      next.length = t('childProfile.errors.length', {
        unit: units.length,
        min: lengthFromMm(GROWTH_LIMITS.lengthMm.min, units.length),
        max: lengthFromMm(GROWTH_LIMITS.lengthMm.max, units.length),
      });
    }

    if (!babyNotesSchema.safeParse(notes).success) {
      next.notes = t('childProfile.errors.notes', { max: BABY_NOTES_MAX });
    }

    setErrors(next);
    if (Object.values(next).some((message) => message !== undefined) || !parsedName.success) {
      return;
    }

    const birthInstant = trimmedDate === '' ? null : new Date(`${trimmedDate}T00:00:00.000Z`);
    if (editing) {
      save.mutate({
        name: parsedName.data,
        lastName: trimmedLast === '' ? null : trimmedLast,
        birthDate: birthInstant,
        birthTime: birthTime === '' ? null : birthTime,
        gender: gender === '' ? null : gender,
        birthWeightGrams: weightGrams,
        birthLengthMm: lengthMm,
        notes: notes.trim() === '' ? null : notes.trim(),
      });
    } else {
      save.mutate({
        name: parsedName.data,
        ...(trimmedLast === '' ? {} : { lastName: trimmedLast }),
        ...(birthInstant === null ? {} : { birthDate: birthInstant }),
        ...(birthTime === '' ? {} : { birthTime }),
        ...(gender === '' ? {} : { gender }),
        ...(weightGrams === null ? {} : { birthWeightGrams: weightGrams }),
        ...(lengthMm === null ? {} : { birthLengthMm: lengthMm }),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      });
    }
  }

  const busy = save.isPending;
  const hasStoredPhoto = baby?.hasPhoto === true && !removePhoto;
  const showsPhoto = newPhoto !== null || hasStoredPhoto;
  const optional = ` ${t('childProfile.form.optional')}`;

  return (
    <Card
      title={
        editing
          ? t('childProfile.form.editTitle', { name: baby.name })
          : t('childProfile.form.addTitle')
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {save.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {t('childProfile.errors.saveFailed')}
          </p>
        ) : null}

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-1 block text-sm font-medium text-ink">
            {t('childProfile.form.photo')}
            {optional}
          </legend>
          <div
            className="flex items-center gap-4"
            data-tone={gender === '' ? 'family' : GENDER_TONE[gender]}
          >
            <BabyAvatar
              familyId={familyId}
              baby={{
                id: baby?.id ?? 'new',
                name: name || '?',
                hasPhoto: baby?.hasPhoto === true,
                ...(baby?.photoUpdatedAt === undefined
                  ? {}
                  : { photoUpdatedAt: baby.photoUpdatedAt }),
              }}
              size="lg"
              previewUrl={previewUrl}
              hidePhoto={removePhoto}
            />
            <div className="flex flex-col items-start gap-2">
              <label
                className={[
                  'inline-flex min-h-touch cursor-pointer items-center justify-center rounded-full',
                  'border border-tone-line bg-tone-soft px-5 text-base font-medium text-tone-ink',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                  'has-[:focus-visible]:outline-tone',
                ].join(' ')}
              >
                {processingPhoto
                  ? t('childProfile.form.photoProcessing')
                  : showsPhoto
                    ? t('childProfile.form.photoReplace')
                    : t('childProfile.form.photoChoose')}
                <input
                  type="file"
                  accept={BABY_PHOTO_CONTENT_TYPES.join(',')}
                  aria-label={t('childProfile.form.photoInput')}
                  className="sr-only"
                  disabled={processingPhoto}
                  onChange={(changeEvent) => {
                    void handlePhoto(changeEvent);
                  }}
                />
              </label>
              {showsPhoto ? (
                <Button
                  variant="quiet"
                  className="px-3"
                  onClick={() => {
                    setNewPhoto(null);
                    setPreviewUrl(null);
                    setRemovePhoto(true);
                  }}
                >
                  {t('childProfile.form.photoRemove')}
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-muted">{t('childProfile.form.photoHint')}</p>
          {photoError ? (
            <p role="alert" className="text-sm text-critical">
              {photoError}
            </p>
          ) : null}
        </fieldset>

        <TextField
          label={t('childProfile.form.firstName')}
          name="name"
          autoComplete="off"
          value={name}
          onChange={(changeEvent) => {
            setName(changeEvent.target.value);
          }}
          error={errors.name}
          disabled={busy}
          required
        />
        <TextField
          label={`${t('childProfile.form.lastName')}${optional}`}
          name="lastName"
          autoComplete="off"
          value={lastName}
          onChange={(changeEvent) => {
            setLastName(changeEvent.target.value);
          }}
          error={errors.lastName}
          disabled={busy}
        />

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={`${t('today.baby.birthDate')}${optional}`}
            type="date"
            name="birthDate"
            value={birthDate}
            onChange={(changeEvent) => {
              setBirthDate(changeEvent.target.value);
            }}
            error={errors.birthDate}
            disabled={busy}
          />
          <TextField
            label={`${t('childProfile.form.birthTime')}${optional}`}
            type="time"
            name="birthTime"
            value={birthTime}
            onChange={(changeEvent) => {
              setBirthTime(changeEvent.target.value);
            }}
            error={errors.birthTime}
            disabled={busy}
          />
        </div>

        <fieldset className="space-y-1" disabled={busy}>
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

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <TextField
              label={`${t('childProfile.form.birthWeight', { unit: units.weight })}${optional}`}
              name="birthWeight"
              inputMode="decimal"
              autoComplete="off"
              value={weight}
              onChange={(changeEvent) => {
                setWeight(changeEvent.target.value);
              }}
              error={errors.weight}
              disabled={busy}
            />
            {weightHint ? <p className="text-sm text-muted">{weightHint}</p> : null}
          </div>
          <div className="space-y-1">
            <TextField
              label={`${t('childProfile.form.birthLength', { unit: units.length })}${optional}`}
              name="birthLength"
              inputMode="decimal"
              autoComplete="off"
              value={length}
              onChange={(changeEvent) => {
                setLength(changeEvent.target.value);
              }}
              error={errors.length}
              disabled={busy}
            />
            {lengthHint ? <p className="text-sm text-muted">{lengthHint}</p> : null}
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="child-notes" className="block text-sm font-medium text-ink">
            {`${t('childProfile.form.notes')}${optional}`}
          </label>
          <textarea
            id="child-notes"
            name="notes"
            rows={3}
            value={notes}
            onChange={(changeEvent) => {
              setNotes(changeEvent.target.value);
            }}
            disabled={busy}
            aria-invalid={errors.notes ? true : undefined}
            className={[
              'w-full rounded-field border bg-surface px-4 py-3 text-base text-ink',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
              errors.notes ? 'border-critical' : 'border-line',
            ].join(' ')}
          />
          {errors.notes ? <p className="text-sm text-critical">{errors.notes}</p> : null}
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={busy || processingPhoto} fullWidth>
            {busy ? t('babyDetails.saving') : t('babyDetails.save')}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy} fullWidth>
            {t('babyDetails.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
