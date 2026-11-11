import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BABY_EVENT_TYPES,
  type Baby,
  type BabyEventType,
  type LocalDate,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { PillRadioGroup } from '../../components/ui/PillRadioGroup.js';
import { EventTypeIcon } from '../tracker/EventTypeIcon.js';
import type { TimelineFilters as Filters } from './useTimeline.js';

/** The "every baby" choice, which is not a baby id and can never be one. */
const ALL_BABIES = 'all';

export interface TimelineFiltersProps {
  babies: Baby[];
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** The latest date the picker offers: today, in the tracker's time zone. */
  today: LocalDate;
  /** The earliest: the oldest baby's birth date, when it is known. */
  earliest: LocalDate | undefined;
}

/**
 * Whose events, which kinds, and from which day back.
 *
 * The baby choice is only offered when there is more than one baby. With no
 * type chip pressed every type is shown — pressing one narrows the list to it,
 * which is how a filter reads at a glance, rather than starting with all four
 * pressed and asking the parent to un-press three.
 */
export function TimelineFilters({
  babies,
  filters,
  onChange,
  today,
  earliest,
}: TimelineFiltersProps) {
  const { t } = useTranslation();
  const dateId = useId();

  const toggleType = (type: BabyEventType): void => {
    const types = filters.types.includes(type)
      ? filters.types.filter((candidate) => candidate !== type)
      : [...filters.types, type];
    onChange({ ...filters, types });
  };

  const babyOptions = [
    ...babies.map((baby) => ({ value: baby.id, label: baby.name })),
    {
      value: ALL_BABIES,
      label: babies.length === 2 ? t('timeline.filters.both') : t('timeline.filters.all'),
    },
  ];

  return (
    <div className="space-y-4 rounded-card border border-line bg-surface p-4 shadow-soft">
      {babies.length > 1 ? (
        <PillRadioGroup
          legend={t('timeline.filters.baby')}
          name="timeline-baby"
          options={babyOptions}
          value={filters.babyId ?? ALL_BABIES}
          columns={babyOptions.length === 3 ? 3 : 2}
          onChange={(value) => {
            onChange({ ...filters, babyId: value === ALL_BABIES ? null : value });
          }}
        />
      ) : null}

      <fieldset className="space-y-1">
        <legend className="mb-1 block text-sm font-medium text-ink">
          {t('timeline.filters.types')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {BABY_EVENT_TYPES.map((type) => {
            const pressed = filters.types.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={pressed}
                onClick={() => {
                  toggleType(type);
                }}
                className={[
                  'flex min-h-touch items-center gap-1.5 rounded-full border px-3 text-sm font-medium',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
                  pressed
                    ? 'border-tone bg-tone-soft text-tone-ink'
                    : 'border-line bg-surface text-muted',
                ].join(' ')}
              >
                <EventTypeIcon type={type} className="h-4 w-4 shrink-0" />
                {t(`today.eventType.${type}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={dateId} className="block text-sm font-medium text-ink">
            {t('timeline.filters.date')}
          </label>
          <input
            id={dateId}
            type="date"
            value={filters.jumpTo ?? ''}
            max={today}
            {...(earliest === undefined ? {} : { min: earliest })}
            onChange={(changeEvent) => {
              const value = changeEvent.target.value;
              // A date after today would show nothing new; treat it as today.
              const jumpTo = value === '' ? null : value > today ? today : value;
              onChange({ ...filters, jumpTo });
            }}
            className="min-h-touch w-full rounded-field border border-line bg-surface px-3 text-ink"
          />
        </div>
        {filters.jumpTo === null ? null : (
          <Button
            variant="secondary"
            onClick={() => {
              onChange({ ...filters, jumpTo: null });
            }}
          >
            {t('timeline.filters.latest')}
          </Button>
        )}
      </div>
    </div>
  );
}
