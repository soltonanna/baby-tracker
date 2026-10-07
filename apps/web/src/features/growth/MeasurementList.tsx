import { useId, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  GROWTH_INDICATORS,
  type GrowthMeasurement,
  type UnitPreferences,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { PencilIcon, TrashIcon } from '../../components/ui/icons.js';
import { queryKeys } from '../../services/queryKeys.js';
import { deleteGrowth } from './api.js';
import { FIELD_FOR, formatAmount, formatMeasuredOn, toDisplay, unitFor } from './growthMath.js';

/**
 * Every measurement, newest first, each editable and deletable. Delete
 * confirms inline in the row, the way the Today list does, and the row goes
 * only once the refreshed list no longer holds it.
 */

export interface MeasurementListProps {
  familyId: string;
  babyId: string;
  measurements: readonly GrowthMeasurement[];
  units: UnitPreferences;
  onEdit: (measurement: GrowthMeasurement) => void;
}

export function MeasurementList({
  familyId,
  babyId,
  measurements,
  units,
  onEdit,
}: MeasurementListProps) {
  const newestFirst = [...measurements].reverse();
  return (
    <ul className="space-y-2">
      {newestFirst.map((measurement) => (
        <MeasurementRow
          key={measurement.id}
          familyId={familyId}
          babyId={babyId}
          measurement={measurement}
          units={units}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
}

function MeasurementRow({
  familyId,
  babyId,
  measurement,
  units,
  onEdit,
}: {
  familyId: string;
  babyId: string;
  measurement: GrowthMeasurement;
  units: UnitPreferences;
  onEdit: (measurement: GrowthMeasurement) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const questionId = useId();
  const [confirming, setConfirming] = useState(false);
  const date = formatMeasuredOn(measurement.measuredOn, i18n.language);

  const remove = useMutation({
    mutationFn: () => deleteGrowth(familyId, babyId, measurement.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.growth(familyId, babyId) });
    },
  });

  function handleKeyDown(keyEvent: KeyboardEvent<HTMLDivElement>): void {
    if (keyEvent.key === 'Escape' && !remove.isPending) {
      remove.reset();
      setConfirming(false);
    }
  }

  return (
    <li className="rounded-field border border-line bg-surface px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <time dateTime={measurement.measuredOn.slice(0, 10)} className="font-semibold text-ink">
            {date}
          </time>
          {GROWTH_INDICATORS.map((indicator) => {
            const stored = measurement[FIELD_FOR[indicator]];
            if (stored === undefined) return null;
            const unit = unitFor(indicator, units);
            return (
              <p key={indicator} className="text-sm text-ink">
                {t(`growth.indicator.${indicator}`)}:{' '}
                {formatAmount(toDisplay(indicator, stored, unit), unit, i18n.language)}{' '}
                {t(`growth.units.${unit}`)}
              </p>
            );
          })}
          {measurement.source === undefined ? null : (
            <p className="text-sm text-muted">{t(`growth.sources.${measurement.source}`)}</p>
          )}
          {measurement.note === undefined ? null : (
            <p className="text-sm text-muted">{measurement.note}</p>
          )}
        </div>

        {confirming ? null : (
          <div className="-my-1 flex shrink-0 items-center gap-1">
            <IconButton
              label={t('growth.list.edit', { date })}
              onClick={() => {
                onEdit(measurement);
              }}
            >
              <PencilIcon className="h-5 w-5" />
            </IconButton>
            <IconButton
              label={t('growth.list.delete', { date })}
              onClick={() => {
                remove.reset();
                setConfirming(true);
              }}
            >
              <TrashIcon className="h-5 w-5" />
            </IconButton>
          </div>
        )}
      </div>

      {confirming ? (
        <div
          role="group"
          aria-labelledby={questionId}
          onKeyDown={handleKeyDown}
          className="mt-3 space-y-2 rounded-field bg-critical-soft p-3"
        >
          <p id={questionId} className="text-sm text-ink">
            {t('growth.list.confirmDelete')}
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              fullWidth
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate();
              }}
            >
              {remove.isPending ? t('growth.list.deleting') : t('growth.list.confirm')}
            </Button>
            <Button
              variant="quiet"
              autoFocus
              disabled={remove.isPending}
              onClick={() => {
                remove.reset();
                setConfirming(false);
              }}
            >
              {t('growth.list.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {remove.isError ? (
        <p role="alert" className="mt-2 text-sm text-critical">
          {t('growth.list.deleteFailed')}
        </p>
      ) : null}
    </li>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        'inline-flex h-11 w-11 items-center justify-center rounded-full text-muted',
        'transition-colors active:bg-surface-sunken',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
