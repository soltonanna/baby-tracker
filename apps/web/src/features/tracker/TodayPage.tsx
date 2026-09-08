import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { queryKeys } from '../../services/queryKeys.js';
import { fetchBabies, fetchBabyEvents, fetchFamilies } from './api.js';
import { BabySelector } from './BabySelector.js';
import { EventList } from './EventList.js';
import { DiaperForm } from './DiaperForm.js';
import { FeedingForm } from './FeedingForm.js';
import { NoteForm } from './NoteForm.js';
import { SleepForm } from './SleepForm.js';

/**
 * The daily tracker: pick a baby, see their recent events.
 *
 * Notes, feedings, sleeps and nappy changes can be added; the remaining event
 * types, editing and the "both babies" action come later.
 * The app is single-family for now, so the caller's first family is used
 * rather than asking them to choose one.
 */

/**
 * Which entry form is open, if any. One value rather than a flag per form: only
 * one form is ever open, and a union says so instead of relying on every flag
 * being cleared whenever another is set.
 */
type OpenForm = 'note' | 'feeding' | 'sleep' | 'diaper';
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
  const [openForm, setOpenForm] = useState<OpenForm | null>(null);

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
        onSelect={(babyId) => {
          setRequestedBabyId(babyId);
          // A half-written entry belongs to the baby it was started for, so
          // switching baby closes the form rather than re-aiming it.
          setOpenForm(null);
        }}
      />

      {openForm === 'feeding' && selectedBabyId !== null ? (
        <FeedingForm
          familyId={familyId}
          babyId={selectedBabyId}
          onSaved={() => {
            setOpenForm(null);
          }}
          onCancel={() => {
            setOpenForm(null);
          }}
        />
      ) : openForm === 'sleep' && selectedBabyId !== null ? (
        <SleepForm
          familyId={familyId}
          babyId={selectedBabyId}
          onSaved={() => {
            setOpenForm(null);
          }}
          onCancel={() => {
            setOpenForm(null);
          }}
        />
      ) : openForm === 'diaper' && selectedBabyId !== null ? (
        <DiaperForm
          familyId={familyId}
          babyId={selectedBabyId}
          onSaved={() => {
            setOpenForm(null);
          }}
          onCancel={() => {
            setOpenForm(null);
          }}
        />
      ) : openForm === 'note' && selectedBabyId !== null ? (
        <NoteForm
          familyId={familyId}
          babyId={selectedBabyId}
          onSaved={() => {
            setOpenForm(null);
          }}
          onCancel={() => {
            setOpenForm(null);
          }}
        />
      ) : (
        // A grid rather than a row: four actions of equal width, each still a
        // full touch target, and a label that wraps rather than one that is cut
        // off on the narrowest phone. Two columns rather than four, because four
        // labels of this length side by side are four columns of wrapped text.
        <div className="grid grid-cols-2 gap-2">
          <Button
            fullWidth
            className="px-2"
            onClick={() => {
              setOpenForm('feeding');
            }}
          >
            {t('today.addFeeding')}
          </Button>
          <Button
            fullWidth
            variant="secondary"
            className="px-2"
            onClick={() => {
              setOpenForm('sleep');
            }}
          >
            {t('today.addSleep')}
          </Button>
          <Button
            fullWidth
            variant="secondary"
            className="px-2"
            onClick={() => {
              setOpenForm('diaper');
            }}
          >
            {t('today.addDiaper')}
          </Button>
          <Button
            fullWidth
            variant="secondary"
            className="px-2"
            onClick={() => {
              setOpenForm('note');
            }}
          >
            {t('today.addNote')}
          </Button>
        </div>
      )}

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
