import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toLocalDate, type Baby, type LocalDate } from '@baby-tracker/shared';
import { useAuth } from '../auth/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { currentLocalDate, trackerTimeZone } from '../tracker/day.js';
import { babyTones } from '../tracker/babyTone.js';
import type { EventFormState } from '../tracker/eventForm.js';
import { useFamilyBabies } from '../tracker/useFamilyBabies.js';
import { TimelineDaySection } from './TimelineDaySection.js';
import { TimelineFilters } from './TimelineFilters.js';
import { summariseTimelineDay } from './timelineModel.js';
import { useTimeline, type TimelineFilters as Filters } from './useTimeline.js';

const NO_FILTERS: Filters = { babyId: null, types: [], jumpTo: null };

/** The oldest birth date in the family, as a calendar date — the picker's floor. */
function earliestBirthDate(babies: readonly Baby[]): LocalDate | undefined {
  const dates = babies.flatMap((baby) =>
    // Stored as the UTC midnight of the calendar date, so read in UTC.
    baby.birthDate === undefined ? [] : [toLocalDate(new Date(baby.birthDate), 'UTC')],
  );
  return dates.length === 0 ? undefined : dates.sort()[0];
}

/**
 * The family's history: every day, newest first, for one baby or all of them.
 *
 * Today is where entries are made; here they are read back and corrected. So
 * there are no add buttons — every row can be edited or deleted in place, with
 * the same forms Today uses.
 */
export function TimelinePage() {
  const { t } = useTranslation();
  const { familyId, babies, isError, isPending } = useFamilyBabies();

  if (isError) {
    return <StatusCard tone="critical">{t('timeline.loadFailed')}</StatusCard>;
  }
  if (isPending) {
    return <StatusCard>{t('timeline.loading')}</StatusCard>;
  }
  if (familyId === undefined || babies === undefined || babies.length === 0) {
    return (
      <StatusCard>
        {t('timeline.setUp')}{' '}
        <Link to="/" className="font-medium text-tone-ink underline">
          {t('timeline.goToToday')}
        </Link>
      </StatusCard>
    );
  }

  return <Timeline familyId={familyId} babies={babies} />;
}

function Timeline({ familyId, babies }: { familyId: string; babies: Baby[] }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const timeZone = trackerTimeZone(user?.timezone);
  const today = currentLocalDate(timeZone);

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [editing, setEditing] = useState<EventFormState | null>(null);

  // A filter that names a baby who is no longer in the family shows everyone.
  const babyId =
    filters.babyId !== null && babies.some((baby) => baby.id === filters.babyId)
      ? filters.babyId
      : null;
  const effective = { ...filters, babyId };
  const tones = babyTones(babies);
  const babyIds = babies.map((baby) => baby.id);

  const { list, data } = useTimeline(familyId, effective, timeZone, babyIds);
  const now = new Date();
  const filtered = effective.babyId !== null || effective.types.length > 0;

  return (
    <div className="space-y-4">
      <TimelineFilters
        babies={babies}
        filters={effective}
        today={today}
        earliest={earliestBirthDate(babies)}
        onChange={(next) => {
          setFilters(next);
          // A half-finished edit belongs to the list it was opened in.
          setEditing(null);
        }}
      />

      {list.isPending ? (
        <StatusCard>
          <span className="flex items-center gap-2">
            <Spinner label={t('timeline.loading')} /> {t('timeline.loading')}
          </span>
        </StatusCard>
      ) : list.isError && data.days.length === 0 ? (
        <StatusCard tone="critical">
          <span className="block">{t('timeline.eventsFailed')}</span>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              void list.refetch();
            }}
          >
            {t('timeline.retry')}
          </Button>
        </StatusCard>
      ) : data.days.length === 0 ? (
        <StatusCard>
          {filtered
            ? t('timeline.emptyFiltered')
            : effective.jumpTo !== null
              ? t('timeline.emptyBefore')
              : t('timeline.empty')}
        </StatusCard>
      ) : (
        <>
          {data.days.map((day) => (
            <TimelineDaySection
              key={day.date}
              day={day}
              summary={summariseTimelineDay(day, {
                allEvents: data.events,
                nextCursor: data.nextCursor,
                types: effective.types.length === 0 ? undefined : new Set(effective.types),
                carryOver: data.carryOver,
                babyIds: effective.babyId === null ? babyIds : [effective.babyId],
                timeZone,
                now,
              })}
              today={today}
              familyId={familyId}
              babies={babies}
              tones={tones}
              showBabies={effective.babyId === null && babies.length > 1}
              editing={editing}
              onEdit={setEditing}
            />
          ))}

          <div className="space-y-2 text-center">
            {list.isFetchNextPageError ? (
              <p role="alert" className="text-sm text-critical">
                {t('timeline.earlierFailed')}
              </p>
            ) : null}
            {list.hasNextPage ? (
              <Button
                fullWidth
                variant="secondary"
                disabled={list.isFetchingNextPage}
                onClick={() => {
                  void list.fetchNextPage();
                }}
              >
                {list.isFetchingNextPage ? t('timeline.loadingEarlier') : t('timeline.showEarlier')}
              </Button>
            ) : (
              <p className="text-sm text-muted">{t('timeline.end')}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatusCard({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'critical';
  children: ReactNode;
}) {
  return (
    <Card>
      <div
        role={tone === 'critical' ? 'alert' : 'status'}
        className={tone === 'critical' ? 'text-critical' : 'text-muted'}
      >
        {children}
      </div>
    </Card>
  );
}
