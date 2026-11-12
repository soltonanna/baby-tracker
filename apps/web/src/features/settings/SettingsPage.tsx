import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DEFAULT_UNITS, type Baby } from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { PencilIcon, TrashIcon } from '../../components/ui/icons.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { queryKeys } from '../../services/queryKeys.js';
import { useAuth } from '../auth/AuthContext.js';
import { fetchFamilies } from '../tracker/api.js';
import { babyTones } from '../tracker/babyTone.js';
import { useFamilyBabies } from '../tracker/useFamilyBabies.js';
import { deleteBaby } from './api.js';
import { BabyAvatar } from './BabyAvatar.js';
import { formatBirthLength, formatBirthWeight } from './birthMeasures.js';
import { ChildProfileForm } from './ChildProfileForm.js';

/**
 * Settings: the children in the family, each editable and — for the family's
 * owner — removable. Reached from the gear in the header.
 *
 * Deleting a child erases their tracker events and growth records too, so it
 * goes through a confirmation dialog that says so; the API enforces the same
 * owner-only rule.
 */

type OpenForm = { kind: 'add' } | { kind: 'edit'; baby: Baby };

function ChildRow({
  familyId,
  baby,
  tone,
  canDelete,
  onEdit,
  onDelete,
}: {
  familyId: string;
  baby: Baby;
  tone: string | undefined;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const units = user?.units ?? DEFAULT_UNITS;
  const fullName = [baby.name, baby.lastName].filter(Boolean).join(' ');

  const born =
    baby.birthDate === undefined
      ? undefined
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' }).format(
          new Date(baby.birthDate),
        );
  const details = [
    born === undefined
      ? undefined
      : baby.birthTime === undefined
        ? t('childProfile.list.born', { date: born })
        : t('childProfile.list.bornAt', { date: born, time: baby.birthTime }),
    baby.birthWeightGrams === undefined
      ? undefined
      : `${t('childProfile.list.weight')}: ${formatBirthWeight(baby.birthWeightGrams, units.weight, i18n.language)}`,
    baby.birthLengthMm === undefined
      ? undefined
      : `${t('childProfile.list.length')}: ${formatBirthLength(baby.birthLengthMm, units.length, i18n.language)}`,
  ].filter((line): line is string => line !== undefined);

  return (
    <li data-tone={tone} className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <BabyAvatar familyId={familyId} baby={baby} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink">{fullName}</p>
          {details.map((line) => (
            <p key={line} className="text-sm text-muted">
              {line}
            </p>
          ))}
          {baby.notes ? (
            <p className="mt-1 text-sm whitespace-pre-line text-ink">{baby.notes}</p>
          ) : null}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={onEdit}
          aria-label={t('childProfile.list.editLabel', { name: baby.name })}
          className="flex-1"
        >
          <PencilIcon className="h-5 w-5" />
          {t('childProfile.list.edit')}
        </Button>
        {canDelete ? (
          <Button
            variant="quiet"
            onClick={onDelete}
            aria-label={t('childProfile.list.deleteLabel', { name: baby.name })}
            className="flex-1 text-critical"
          >
            <TrashIcon className="h-5 w-5" />
            {t('childProfile.list.delete')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const units = user?.units ?? DEFAULT_UNITS;
  const queryClient = useQueryClient();

  const { familyId, babies, isError, isPending } = useFamilyBabies();
  // Same key as `useFamilyBabies`, so this is the cache's copy, not a request.
  const familiesQuery = useQuery({ queryKey: queryKeys.families, queryFn: fetchFamilies });
  const isOwner = familiesQuery.data?.[0]?.role === 'OWNER';

  const [openForm, setOpenForm] = useState<OpenForm | null>(null);
  const [deleting, setDeleting] = useState<Baby | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  const remove = useMutation({
    mutationFn: (baby: Baby) => deleteBaby(familyId ?? '', baby.id),
    onSuccess: async () => {
      // Everything recorded for the child is gone, so every cached view of the
      // family — babies, events, growth, timeline — is refetched.
      await queryClient.invalidateQueries({ queryKey: ['families', familyId] });
      setDeleting(null);
    },
  });

  if (isError) {
    return (
      <Card title={t('settings.title')}>
        <p role="alert" className="text-sm text-critical">
          {t('childProfile.loadFailed')}
        </p>
      </Card>
    );
  }
  if (isPending) {
    return (
      <Card title={t('settings.title')}>
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }
  if (familyId === undefined || babies === undefined) {
    return (
      <Card title={t('settings.title')}>
        <p className="text-muted">{t('childProfile.noFamily')}</p>
      </Card>
    );
  }

  const tones = babyTones(babies);
  const closeForm = () => {
    setOpenForm(null);
  };

  if (openForm !== null) {
    return (
      <ChildProfileForm
        // Remounts per child, so one child's edits never leak into the next.
        key={openForm.kind === 'edit' ? openForm.baby.id : 'new'}
        familyId={familyId}
        baby={openForm.kind === 'edit' ? openForm.baby : undefined}
        units={units}
        onSaved={({ photoFailed: failed }) => {
          setPhotoFailed(failed);
          closeForm();
        }}
        onCancel={closeForm}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card title={t('childProfile.title')}>
        <p className="mb-3 text-sm text-muted">{t('childProfile.intro')}</p>
        {photoFailed ? (
          <p
            role="alert"
            className="mb-3 rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {t('childProfile.errors.photoFailed')}
          </p>
        ) : null}
        {babies.length === 0 ? (
          <p className="text-muted">{t('childProfile.empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {babies.map((baby) => (
              <ChildRow
                key={baby.id}
                familyId={familyId}
                baby={baby}
                tone={tones.get(baby.id)}
                canDelete={isOwner}
                onEdit={() => {
                  setPhotoFailed(false);
                  setOpenForm({ kind: 'edit', baby });
                }}
                onDelete={() => {
                  remove.reset();
                  setDeleting(baby);
                }}
              />
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => {
              setPhotoFailed(false);
              setOpenForm({ kind: 'add' });
            }}
          >
            {t('childProfile.add')}
          </Button>
        </div>
      </Card>

      {deleting !== null ? (
        <ConfirmDialog
          title={t('childProfile.delete.title', { name: deleting.name })}
          confirmLabel={
            remove.isPending
              ? t('childProfile.delete.deleting')
              : t('childProfile.delete.confirm', { name: deleting.name })
          }
          cancelLabel={t('babyDetails.cancel')}
          busy={remove.isPending}
          error={remove.isError ? t('childProfile.delete.failed') : undefined}
          onConfirm={() => {
            remove.mutate(deleting);
          }}
          onCancel={() => {
            setDeleting(null);
          }}
        >
          {t('childProfile.delete.body', { name: deleting.name })}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
