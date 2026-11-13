import { useId, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  HEALTH_CATEGORIES,
  IMMUNIZATION_SCHEDULE,
  IMMUNIZATION_VACCINES,
  type HealthRecord,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { PencilIcon, TrashIcon } from '../../components/ui/icons.js';
import { TextField } from '../../components/ui/TextField.js';
import { queryKeys } from '../../services/queryKeys.js';
import { deleteHealthRecord } from './api.js';
import { NO_FILTER, filterRecords, localized, type HistoryFilter } from './healthModel.js';

/**
 * The medical history, newest first, with a category and date filter. Filtering
 * is done on what is loaded, on the user's own calendar days — the history is a
 * few dozen rows, and a filter by day has to agree with the day shown on each
 * row, which only the browser knows.
 *
 * Each row can be edited or deleted; delete confirms inline, as the growth list
 * does.
 */

export interface HealthRecordListProps {
  familyId: string;
  babyId: string;
  records: readonly HealthRecord[];
  timeZone: string;
  onEdit: (record: HealthRecord) => void;
}

export function HealthRecordList({
  familyId,
  babyId,
  records,
  timeZone,
  onEdit,
}: HealthRecordListProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<HistoryFilter>(NO_FILTER);
  const visible = filterRecords(records, filter, timeZone);
  const filtering = filter.category !== 'all' || filter.from !== '' || filter.to !== '';

  return (
    <div className="space-y-3">
      <fieldset className="space-y-3">
        <legend className="sr-only">{t('health.filters.title')}</legend>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t('health.filters.category')}
        >
          {(['all', ...HEALTH_CATEGORIES] as const).map((category) => {
            const selected = filter.category === category;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setFilter((current) => ({ ...current, category }));
                }}
                className={[
                  'min-h-touch rounded-full border px-4 text-sm font-medium',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
                  selected
                    ? 'border-tone bg-tone-soft text-tone-ink'
                    : 'border-line bg-surface text-muted',
                ].join(' ')}
              >
                {selected ? <span aria-hidden="true">✓ </span> : null}
                {category === 'all' ? t('health.filters.all') : t(`health.categories.${category}`)}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('health.filters.from')}
            type="date"
            name="filter-from"
            value={filter.from}
            max={filter.to === '' ? undefined : filter.to}
            onChange={(event) => {
              setFilter((current) => ({ ...current, from: event.target.value }));
            }}
          />
          <TextField
            label={t('health.filters.to')}
            type="date"
            name="filter-to"
            value={filter.to}
            min={filter.from === '' ? undefined : filter.from}
            onChange={(event) => {
              setFilter((current) => ({ ...current, to: event.target.value }));
            }}
          />
        </div>
        {filtering ? (
          <Button
            variant="quiet"
            onClick={() => {
              setFilter(NO_FILTER);
            }}
          >
            {t('health.filters.clear')}
          </Button>
        ) : null}
      </fieldset>

      {visible.length === 0 ? (
        <p className="text-muted">{t('health.records.emptyFiltered')}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((record) => (
            <RecordRow
              key={record.id}
              familyId={familyId}
              babyId={babyId}
              record={record}
              timeZone={timeZone}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordRow({
  familyId,
  babyId,
  record,
  timeZone,
  onEdit,
}: {
  familyId: string;
  babyId: string;
  record: HealthRecord;
  timeZone: string;
  onEdit: (record: HealthRecord) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const questionId = useId();
  const [confirming, setConfirming] = useState(false);

  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(record.occurredAt));
  const day = (calendarDate: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${calendarDate}T00:00:00.000Z`),
    );

  const remove = useMutation({
    mutationFn: () => deleteHealthRecord(familyId, babyId, record.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.healthRecords(familyId, babyId) });
    },
  });

  function handleKeyDown(keyEvent: KeyboardEvent<HTMLDivElement>): void {
    if (keyEvent.key === 'Escape' && !remove.isPending) {
      remove.reset();
      setConfirming(false);
    }
  }

  const linked = IMMUNIZATION_SCHEDULE.find((item) => item.key === record.scheduleKey);
  const linkedVaccine = IMMUNIZATION_VACCINES.find((item) => item.id === linked?.vaccineId);

  return (
    <li className="rounded-field border border-line bg-surface px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-semibold tracking-wide text-tone-ink uppercase">
            {t(`health.categories.${record.category}`)}
          </p>
          <p className="font-semibold break-words text-ink">{record.name}</p>
          <time dateTime={record.occurredAt} className="block text-sm text-muted">
            {when}
          </time>
          {record.purpose === undefined ? null : (
            <p className="text-sm text-ink">
              {t('health.records.purpose', { value: record.purpose })}
            </p>
          )}
          {record.description === undefined ? null : (
            <p className="text-sm text-ink">{record.description}</p>
          )}
          {record.doseValue === undefined || record.doseUnit === undefined ? null : (
            <p className="text-sm text-ink">
              {t('health.records.dose', {
                value: record.doseValue,
                unit: t(`health.units.${record.doseUnit}`),
              })}
            </p>
          )}
          {record.productName === undefined ? null : (
            <p className="text-sm text-ink">
              {t('health.records.product', { value: record.productName })}
            </p>
          )}
          {record.manufacturer === undefined ? null : (
            <p className="text-sm text-ink">
              {t('health.records.manufacturer', { value: record.manufacturer })}
            </p>
          )}
          {record.provider === undefined ? null : (
            <p className="text-sm text-ink">
              {t('health.records.provider', { value: record.provider })}
            </p>
          )}
          {linked && linkedVaccine ? (
            <p className="text-sm text-muted">
              {t('health.records.linked', {
                dose: `${localized(linkedVaccine.abbreviation, i18n.language)} — ${t(
                  'health.schedule.doseOf',
                  { n: linked.dose, total: linked.totalDoses },
                )}`,
              })}
            </p>
          ) : null}
          {record.nextDueOn === undefined ? null : (
            <p className="text-sm font-medium text-tone-ink">
              {t('health.records.nextDue', { date: day(record.nextDueOn) })}
            </p>
          )}
          {record.note === undefined ? null : <p className="text-sm text-muted">{record.note}</p>}
        </div>

        {confirming ? null : (
          <div className="-my-1 flex shrink-0 items-center gap-1">
            <IconButton
              label={t('health.list.edit', { name: record.name })}
              onClick={() => {
                onEdit(record);
              }}
            >
              <PencilIcon className="h-5 w-5" />
            </IconButton>
            <IconButton
              label={t('health.list.delete', { name: record.name })}
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
            {t('health.list.confirmDelete')}
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
              {remove.isPending ? t('health.list.deleting') : t('health.list.confirm')}
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
              {t('health.list.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {remove.isError ? (
        <p role="alert" className="mt-2 text-sm text-critical">
          {t('health.list.deleteFailed')}
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
