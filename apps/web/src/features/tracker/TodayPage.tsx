import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui/Card.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { queryKeys } from '../../services/queryKeys.js';
import { fetchBabies, fetchBabyEvents, fetchFamilies } from './api.js';
import { BabySelector } from './BabySelector.js';
import { EventList } from './EventList.js';

/**
 * The daily tracker: pick a baby, see their recent events.
 *
 * Reading only — creating, editing and the "both babies" action come later.
 * The app is single-family for now, so the caller's first family is used
 * rather than asking them to choose one.
 */
export function TodayPage() {
  const { t } = useTranslation();

  const familiesQuery = useQuery({
    queryKey: queryKeys.families,
    queryFn: fetchFamilies,
  });
  const familyId = familiesQuery.data?.[0]?.id;

  const babiesQuery = useQuery({
    queryKey: queryKeys.babies(familyId ?? ''),
    queryFn: () => fetchBabies(familyId ?? ''),
    enabled: familyId !== undefined,
  });
  const babies = babiesQuery.data;

  const [requestedBabyId, setRequestedBabyId] = useState<string | null>(null);

  // Derived rather than synchronised: the baby the parent tapped, as long as
  // they are still in the list, and otherwise the first one. That covers both
  // the initial render, where nothing has been tapped yet, and a baby that has
  // been removed — with no effect and no extra render.
  const selectedBabyId =
    requestedBabyId !== null && babies?.some((baby) => baby.id === requestedBabyId)
      ? requestedBabyId
      : (babies?.[0]?.id ?? null);

  const eventsQuery = useQuery({
    queryKey: queryKeys.babyEvents(familyId ?? '', selectedBabyId ?? ''),
    queryFn: () => fetchBabyEvents(familyId ?? '', selectedBabyId ?? ''),
    enabled: familyId !== undefined && selectedBabyId !== null,
  });

  // Order matters here. A disabled query reports `isPending`, so the babies
  // query is still "pending" while there is no family to load babies for —
  // checking pending first would hide a failed families request behind a
  // spinner that never resolves.
  if (familiesQuery.isError || babiesQuery.isError) {
    return <StatusCard tone="critical">{t('today.loadFailed')}</StatusCard>;
  }

  if (familiesQuery.isPending) {
    return <StatusCard>{t('today.loading')}</StatusCard>;
  }

  if (familyId === undefined) {
    return <StatusCard>{t('today.noFamily')}</StatusCard>;
  }

  if (babiesQuery.isPending) {
    return <StatusCard>{t('today.loading')}</StatusCard>;
  }

  if (!babies || babies.length === 0) {
    return <StatusCard>{t('today.noBabies')}</StatusCard>;
  }

  return (
    <div className="space-y-4">
      <BabySelector
        babies={babies}
        selectedBabyId={selectedBabyId ?? ''}
        onSelect={setRequestedBabyId}
      />

      <Card title={t('today.recentEvents')}>
        {eventsQuery.isPending ? (
          <p className="flex items-center gap-2 text-muted">
            <Spinner label={t('today.loadingEvents')} /> {t('today.loadingEvents')}
          </p>
        ) : eventsQuery.isError ? (
          <p className="text-critical">{t('today.eventsFailed')}</p>
        ) : eventsQuery.data.length === 0 ? (
          <p className="text-muted">{t('today.noEvents')}</p>
        ) : (
          <EventList events={eventsQuery.data} />
        )}
      </Card>
    </div>
  );
}

function StatusCard({ children, tone }: { children: React.ReactNode; tone?: 'critical' }) {
  return (
    <Card>
      <p className={tone === 'critical' ? 'text-critical' : 'text-muted'}>{children}</p>
    </Card>
  );
}
