import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { Baby, HealthRecord } from '@baby-tracker/shared';
import { useAuth } from '../auth/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { queryKeys } from '../../services/queryKeys.js';
import { GrowthPage } from '../growth/GrowthPage.js';
import { BabySelector } from '../tracker/BabySelector.js';
import { babyTones } from '../tracker/babyTone.js';
import { currentLocalDate, trackerTimeZone } from '../tracker/day.js';
import { EditBabyForm } from '../tracker/EditBabyForm.js';
import { useFamilyBabies } from '../tracker/useFamilyBabies.js';
import { fetchHealthRecords } from './api.js';
import { HealthRecordForm } from './HealthRecordForm.js';
import { HealthRecordList } from './HealthRecordList.js';
import type { HealthFormValues } from './healthModel.js';
import { VaccinationSchedule } from './VaccinationSchedule.js';

/**
 * Health: three views of one baby — Growth (the existing screen, unchanged),
 * Records (the medical history) and Vaccinations (the Armenian schedule against
 * that history).
 *
 * The chosen tab lives in the URL (`?tab=`) so a reload or a shared link keeps
 * it, and the chosen baby lives here so switching tab does not send a twin back
 * to the first child.
 */

const TABS = ['growth', 'records', 'vaccinations'] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | null): value is Tab =>
  value !== null && (TABS as readonly string[]).includes(value);

export function HealthPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'growth';
  const [requestedBabyId, setRequestedBabyId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t('health.tabs.label')} className="grid grid-cols-3 gap-2">
        {TABS.map((candidate) => {
          const selected = candidate === tab;
          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              id={`health-tab-${candidate}`}
              aria-selected={selected}
              aria-controls="health-panel"
              onClick={() => {
                setParams(candidate === 'growth' ? {} : { tab: candidate }, { replace: true });
              }}
              className={[
                'min-h-touch rounded-full border px-2 text-sm font-medium',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone',
                selected
                  ? 'border-tone bg-tone-soft text-tone-ink'
                  : 'border-line bg-surface text-muted',
              ].join(' ')}
            >
              {t(`health.tabs.${candidate}`)}
            </button>
          );
        })}
      </div>

      <div id="health-panel" role="tabpanel" aria-labelledby={`health-tab-${tab}`}>
        {tab === 'growth' ? (
          <GrowthPage requestedBabyId={requestedBabyId} onBabyChange={setRequestedBabyId} />
        ) : (
          <BabyShell requestedBabyId={requestedBabyId} onBabyChange={setRequestedBabyId}>
            {(familyId, baby, timeZone) =>
              tab === 'records' ? (
                <RecordsTab familyId={familyId} baby={baby} timeZone={timeZone} />
              ) : (
                <VaccinationsTab familyId={familyId} baby={baby} timeZone={timeZone} />
              )
            }
          </BabyShell>
        )}
      </div>
    </div>
  );
}

/** Loading, no-babies and the baby selector, shared by the two new tabs. */
function BabyShell({
  requestedBabyId,
  onBabyChange,
  children,
}: {
  requestedBabyId: string | null;
  onBabyChange: (babyId: string) => void;
  children: (familyId: string, baby: Baby, timeZone: string) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const timeZone = trackerTimeZone(user?.timezone);
  const { familyId, babies, isError, isPending } = useFamilyBabies();
  const baby = babies?.find((candidate) => candidate.id === requestedBabyId) ?? babies?.[0];

  if (isError) {
    return (
      <Card>
        <p className="text-critical">{t('health.loadFailed')}</p>
      </Card>
    );
  }
  if (isPending) {
    return (
      <Card>
        <p className="text-muted">{t('health.loading')}</p>
      </Card>
    );
  }
  if (familyId === undefined || !babies || babies.length === 0 || baby === undefined) {
    return (
      <Card title={t('health.title')}>
        <p className="text-muted">
          {t('health.noBabies')}{' '}
          <Link to="/" className="font-medium text-tone-ink underline">
            {t('nav.today')}
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-tone={babyTones(babies).get(baby.id)}>
      <BabySelector
        familyId={familyId}
        babies={babies}
        selectedBabyId={baby.id}
        onSelect={onBabyChange}
      />
      {children(familyId, baby, timeZone)}
    </div>
  );
}

function useHealthRecords(familyId: string, baby: Baby) {
  return useQuery({
    queryKey: queryKeys.healthRecords(familyId, baby.id),
    queryFn: () => fetchHealthRecords(familyId, baby.id),
  });
}

type OpenForm = { record?: HealthRecord; prefill?: Partial<HealthFormValues> };

function RecordsTab({
  familyId,
  baby,
  timeZone,
}: {
  familyId: string;
  baby: Baby;
  timeZone: string;
}) {
  const { t } = useTranslation();
  const query = useHealthRecords(familyId, baby);
  const [open, setOpen] = useState<OpenForm | null>(null);
  const close = () => {
    setOpen(null);
  };

  return (
    <div className="space-y-4">
      {open ? (
        <HealthRecordForm
          key={open.record?.id ?? 'new'}
          familyId={familyId}
          baby={baby}
          timeZone={timeZone}
          record={open.record}
          prefill={open.prefill}
          onSaved={close}
          onCancel={close}
        />
      ) : (
        <Button
          fullWidth
          onClick={() => {
            setOpen({});
          }}
        >
          {t('health.records.add')}
        </Button>
      )}

      {query.isPending ? (
        <Card>
          <p className="flex items-center gap-2 text-muted">
            <Spinner label={t('health.records.loading')} /> {t('health.records.loading')}
          </p>
        </Card>
      ) : query.isError ? (
        <Card>
          <p className="text-critical">{t('health.records.loadFailed')}</p>
        </Card>
      ) : query.data.length === 0 ? (
        <Card title={t('health.records.title')}>
          <p className="text-muted">{t('health.records.empty', { name: baby.name })}</p>
        </Card>
      ) : (
        <Card title={t('health.records.title')}>
          <HealthRecordList
            familyId={familyId}
            babyId={baby.id}
            records={query.data}
            timeZone={timeZone}
            onEdit={(record) => {
              setOpen({ record });
              window.scrollTo?.({ top: 0, behavior: 'smooth' });
            }}
          />
        </Card>
      )}
    </div>
  );
}

function VaccinationsTab({
  familyId,
  baby,
  timeZone,
}: {
  familyId: string;
  baby: Baby;
  timeZone: string;
}) {
  const { t } = useTranslation();
  const query = useHealthRecords(familyId, baby);
  const [open, setOpen] = useState<OpenForm | null>(null);
  const [editingBaby, setEditingBaby] = useState(false);
  const close = () => {
    setOpen(null);
    setEditingBaby(false);
  };
  const today = currentLocalDate(timeZone);

  if (editingBaby) {
    return <EditBabyForm familyId={familyId} baby={baby} onSaved={close} onCancel={close} />;
  }
  if (baby.birthDate === undefined) {
    return (
      <Card>
        <p className="text-sm text-ink">
          {t('health.schedule.needBirthDate', { name: baby.name })}
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => {
            setEditingBaby(true);
          }}
        >
          {t('health.schedule.addBirthDate')}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {open ? (
        <HealthRecordForm
          key={open.record?.id ?? open.prefill?.scheduleKey ?? 'new'}
          familyId={familyId}
          baby={baby}
          timeZone={timeZone}
          record={open.record}
          prefill={open.prefill}
          onSaved={close}
          onCancel={close}
        />
      ) : null}

      {query.isPending ? (
        <Card>
          <p className="flex items-center gap-2 text-muted">
            <Spinner label={t('health.records.loading')} /> {t('health.records.loading')}
          </p>
        </Card>
      ) : query.isError ? (
        <Card>
          <p className="text-critical">{t('health.records.loadFailed')}</p>
        </Card>
      ) : (
        <VaccinationSchedule
          babyName={baby.name}
          birthDate={baby.birthDate.slice(0, 10)}
          today={today}
          records={query.data}
          timeZone={timeZone}
          onRecordDose={(scheduleKey) => {
            setOpen({ prefill: { category: 'vaccination', scheduleKey } });
            window.scrollTo?.({ top: 0, behavior: 'smooth' });
          }}
          onEditRecord={(recordId) => {
            const record = query.data.find((candidate) => candidate.id === recordId);
            if (record) {
              setOpen({ record });
              window.scrollTo?.({ top: 0, behavior: 'smooth' });
            }
          }}
        />
      )}
    </div>
  );
}
