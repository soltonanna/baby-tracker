import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BabyEvent, BabyEventType } from '@baby-tracker/shared';
import { useAuth } from '../auth/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { queryKeys } from '../../services/queryKeys.js';
import { currentDayRange, trackerTimeZone } from './day.js';
import { fetchBabies, fetchBabyEvents, fetchFamilies } from './api.js';
import { AddBabyForm } from './AddBabyForm.js';
import { BabySelector } from './BabySelector.js';
import { babyTones } from './babyTone.js';
import { CreateFamilyForm } from './CreateFamilyForm.js';
import { EventList } from './EventList.js';
import { EventTypeIcon } from './EventTypeIcon.js';
import { DiaperForm } from './DiaperForm.js';
import { FeedingForm } from './FeedingForm.js';
import { NoteForm } from './NoteForm.js';
import { SleepForm } from './SleepForm.js';

/**
 * The daily tracker: pick a baby, see what happened to them today.
 *
 * Today is the current local calendar day, and the list is scoped to it: the
 * page asks the API for the events that started between this day's first
 * instant and the next day's, worked out from the shared calendar helpers in
 * `day.ts`. There is no date navigation — today is the only day this screen
 * shows — and no daily totals yet.
 *
 * Notes, feedings, sleeps and nappy changes can be added, edited and deleted,
 * each for one baby or for both of them at once; the remaining event types come
 * later.
 *
 * The tab strip stays a *view* filter. "Both" is not a third tab: it is a target
 * chosen inside the entry form, and choosing it writes an ordinary event for
 * each baby, so the list on screen is still one baby's day. The selected baby
 * never changes because an entry was saved.
 * The app is single-family for now, so the caller's first family is used
 * rather than asking them to choose one, and an account with no family — or a
 * family with no babies — is offered the form that fills the gap.
 */

/**
 * Which entry form is open, if any. One value rather than a flag per form: only
 * one form is ever open, and a union says so instead of relying on every flag
 * being cleared whenever another is set.
 *
 * `baby` is a member of the same union for that reason: adding a baby is not an
 * event, but it is another form that must not be open beside one.
 *
 * An event form carries the event it is editing, when there is one. Kept in the
 * same value rather than in a second piece of state, because the two always
 * change together: opening a form for a different event, or for none, is one
 * decision and one update.
 */
type EventFormKind = 'note' | 'feeding' | 'sleep' | 'diaper';

type OpenForm = { kind: 'baby' } | { kind: EventFormKind; event?: BabyEvent };

/**
 * Which form edits which kind of event.
 *
 * Each form is also keyed by the event it is editing, so opening one on a
 * different entry — or on a new one — remounts it and its fields start from that
 * entry's values rather than from whatever the previous one left behind.
 */
const FORM_FOR_EVENT: Record<BabyEventType, EventFormKind> = {
  FEEDING: 'feeding',
  SLEEP: 'sleep',
  DIAPER: 'diaper',
  NOTE: 'note',
};

export function TodayPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Recomputed on every render on purpose: it is a string pair derived from the
  // clock, identical all day, so the query key hashes the same and nothing
  // refetches — and when the clock does roll past midnight, the next render
  // asks for the new day rather than holding yesterday's until a reload.
  const today = currentDayRange(trackerTimeZone(user?.timezone));

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
    queryKey: queryKeys.babyEvents(familyId ?? '', selectedBabyId ?? '', today),
    queryFn: () => fetchBabyEvents(familyId ?? '', selectedBabyId ?? '', today),
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

  // A signed-in account with no family yet: the one thing to do here is make
  // one, so the screen offers it rather than reporting the absence.
  if (familyId === undefined) {
    return <CreateFamilyForm />;
  }

  if (babiesQuery.isPending) {
    return <StatusCard>{t('today.loading')}</StatusCard>;
  }

  // A family with no babies yet: the same reasoning as the family above — the
  // one thing to do here is add one, so the screen offers it. No cancel: there
  // is no tracker behind this form to go back to.
  if (!babies || babies.length === 0) {
    return <AddBabyForm familyId={familyId} />;
  }

  // Everything below the tabs — the add buttons, the open form, the day list —
  // takes the selected baby's colour, so it is always clear whose day this is.
  const selectedTone = selectedBabyId === null ? undefined : babyTones(babies).get(selectedBabyId);

  return (
    <div className="space-y-4" data-tone={selectedTone}>
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

      {openForm?.kind === 'baby' ? (
        // The same form as the empty state, reached from the tracker: this is
        // how the second twin is added, with no separate twin flow.
        // Not tinted with the selected baby's colour: the new baby is not them.
        <div data-tone="family">
          <AddBabyForm
            familyId={familyId}
            onCreated={() => {
              setOpenForm(null);
            }}
            onCancel={() => {
              setOpenForm(null);
            }}
          />
        </div>
      ) : openForm?.kind === 'feeding' && selectedBabyId !== null ? (
        <FeedingForm
          key={openForm.event?.id ?? 'new'}
          familyId={familyId}
          babyId={selectedBabyId}
          babies={babies}
          event={openForm.event}
          onSaved={() => {
            setOpenForm(null);
          }}
          onCancel={() => {
            setOpenForm(null);
          }}
        />
      ) : openForm?.kind === 'sleep' && selectedBabyId !== null ? (
        <SleepForm
          key={openForm.event?.id ?? 'new'}
          familyId={familyId}
          babyId={selectedBabyId}
          babies={babies}
          event={openForm.event}
          onSaved={() => {
            setOpenForm(null);
          }}
          onCancel={() => {
            setOpenForm(null);
          }}
        />
      ) : openForm?.kind === 'diaper' && selectedBabyId !== null ? (
        <DiaperForm
          key={openForm.event?.id ?? 'new'}
          familyId={familyId}
          babyId={selectedBabyId}
          babies={babies}
          event={openForm.event}
          onSaved={() => {
            setOpenForm(null);
          }}
          onCancel={() => {
            setOpenForm(null);
          }}
        />
      ) : openForm?.kind === 'note' && selectedBabyId !== null ? (
        <NoteForm
          key={openForm.event?.id ?? 'new'}
          familyId={familyId}
          babyId={selectedBabyId}
          babies={babies}
          event={openForm.event}
          onSaved={() => {
            setOpenForm(null);
          }}
          onCancel={() => {
            setOpenForm(null);
          }}
        />
      ) : (
        <div className="space-y-2">
          {/*
            A grid rather than a row: four actions of equal width, each still a
            full touch target, and a label that wraps rather than one that is cut
            off on the narrowest phone. Two columns rather than four, because four
            labels of this length side by side are four columns of wrapped text.
          */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              fullWidth
              className="px-2"
              onClick={() => {
                setOpenForm({ kind: 'feeding' });
              }}
            >
              <EventTypeIcon type="FEEDING" className="h-5 w-5 shrink-0" />
              {t('today.addFeeding')}
            </Button>
            <Button
              fullWidth
              variant="secondary"
              className="px-2"
              onClick={() => {
                setOpenForm({ kind: 'sleep' });
              }}
            >
              <EventTypeIcon type="SLEEP" className="h-5 w-5 shrink-0" />
              {t('today.addSleep')}
            </Button>
            <Button
              fullWidth
              variant="secondary"
              className="px-2"
              onClick={() => {
                setOpenForm({ kind: 'diaper' });
              }}
            >
              <EventTypeIcon type="DIAPER" className="h-5 w-5 shrink-0" />
              {t('today.addDiaper')}
            </Button>
            <Button
              fullWidth
              variant="secondary"
              className="px-2"
              onClick={() => {
                setOpenForm({ kind: 'note' });
              }}
            >
              <EventTypeIcon type="NOTE" className="h-5 w-5 shrink-0" />
              {t('today.addNote')}
            </Button>
          </div>

          {/*
            Adding a baby happens twice in the life of a family and a feeding
            happens eight times a day, so it is quiet and below the four daily
            actions rather than a fifth cell competing with them.
          */}
          <Button
            fullWidth
            variant="quiet"
            onClick={() => {
              setOpenForm({ kind: 'baby' });
            }}
          >
            {t('today.addBaby')}
          </Button>
        </div>
      )}

      <Card title={t('today.todayEvents')} className="border-tone-line">
        {eventsQuery.isPending ? (
          <p className="flex items-center gap-2 text-muted">
            <Spinner label={t('today.loadingEvents')} /> {t('today.loadingEvents')}
          </p>
        ) : eventsQuery.isError ? (
          <p className="text-critical">{t('today.eventsFailed')}</p>
        ) : eventsQuery.data.length === 0 ? (
          <p className="text-muted">{t('today.noEvents')}</p>
        ) : (
          <EventList
            events={eventsQuery.data}
            familyId={familyId}
            babyId={selectedBabyId ?? ''}
            onEdit={(event) => {
              setOpenForm({ kind: FORM_FOR_EVENT[event.type], event });
            }}
          />
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
