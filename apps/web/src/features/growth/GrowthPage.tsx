import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DEFAULT_UNITS, type GrowthMeasurement } from '@baby-tracker/shared';
import { useAuth } from '../auth/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { RulerIcon } from '../../components/ui/icons.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { queryKeys } from '../../services/queryKeys.js';
import { BabySelector } from '../tracker/BabySelector.js';
import { babyTones } from '../tracker/babyTone.js';
import { currentLocalDate, trackerTimeZone } from '../tracker/day.js';
import { EditBabyForm } from '../tracker/EditBabyForm.js';
import { useFamilyBabies } from '../tracker/useFamilyBabies.js';
import { fetchGrowth } from './api.js';
import { GrowthCharts } from './GrowthCharts.js';
import { GrowthForm } from './GrowthForm.js';
import { GrowthSummary } from './GrowthSummary.js';
import { MeasurementList } from './MeasurementList.js';

/**
 * Health → Growth: one baby's weight, length and head circumference over time,
 * placed on the WHO Child Growth Standards for their age and sex.
 *
 * A periodic record, not a daily one — which is why it lives here and not in
 * Today's list. Today has a shortcut into the same form.
 */

type OpenForm = { kind: 'measurement'; measurement?: GrowthMeasurement } | { kind: 'baby' };

export function GrowthPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const units = user?.units ?? DEFAULT_UNITS;
  const today = currentLocalDate(trackerTimeZone(user?.timezone));

  const { familyId, babies, isError, isPending } = useFamilyBabies();
  const [requestedBabyId, setRequestedBabyId] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<OpenForm | null>(null);

  const baby = babies?.find((candidate) => candidate.id === requestedBabyId) ?? babies?.[0];

  const growthQuery = useQuery({
    queryKey: queryKeys.growth(familyId ?? '', baby?.id ?? ''),
    queryFn: () => fetchGrowth(familyId ?? '', baby?.id ?? ''),
    enabled: familyId !== undefined && baby !== undefined,
  });

  if (isError) return <StatusCard tone="critical">{t('growth.loadFailed')}</StatusCard>;
  if (isPending) return <StatusCard>{t('growth.loading')}</StatusCard>;
  if (familyId === undefined || !babies || babies.length === 0 || baby === undefined) {
    return (
      <Card title={t('growth.title')}>
        <p className="text-muted">
          {t('growth.noBabies')}{' '}
          <Link to="/" className="font-medium text-tone-ink underline">
            {t('nav.today')}
          </Link>
        </p>
      </Card>
    );
  }

  const missingDetails = baby.birthDate === undefined || baby.gender === undefined;
  const close = () => {
    setOpenForm(null);
  };

  return (
    <div className="space-y-4" data-tone={babyTones(babies).get(baby.id)}>
      <BabySelector
        babies={babies}
        selectedBabyId={baby.id}
        onSelect={(babyId) => {
          setRequestedBabyId(babyId);
          setOpenForm(null);
        }}
      />

      {openForm?.kind === 'measurement' ? (
        <GrowthForm
          key={openForm.measurement?.id ?? 'new'}
          familyId={familyId}
          baby={baby}
          units={units}
          today={today}
          measurement={openForm.measurement}
          onSaved={close}
          onCancel={close}
        />
      ) : openForm?.kind === 'baby' ? (
        <EditBabyForm familyId={familyId} baby={baby} onSaved={close} onCancel={close} />
      ) : (
        <div className="space-y-2">
          <Button
            fullWidth
            onClick={() => {
              setOpenForm({ kind: 'measurement' });
            }}
          >
            <RulerIcon className="h-5 w-5 shrink-0" />
            {t('growth.add')}
          </Button>
          <Button
            fullWidth
            variant="quiet"
            onClick={() => {
              setOpenForm({ kind: 'baby' });
            }}
          >
            {t('growth.editDetails', { name: baby.name })}
          </Button>
        </div>
      )}

      {missingDetails && openForm?.kind !== 'baby' ? (
        <Card>
          <p className="text-sm text-ink">{t('growth.missingDetails', { name: baby.name })}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              setOpenForm({ kind: 'baby' });
            }}
          >
            {t('growth.addDetails')}
          </Button>
        </Card>
      ) : null}

      {growthQuery.isPending ? (
        <Card>
          <p className="flex items-center gap-2 text-muted">
            <Spinner label={t('growth.loadingMeasurements')} /> {t('growth.loadingMeasurements')}
          </p>
        </Card>
      ) : growthQuery.isError ? (
        <StatusCard tone="critical">{t('growth.measurementsFailed')}</StatusCard>
      ) : growthQuery.data.length === 0 ? (
        <Card title={t('growth.summary.title')}>
          <p className="text-muted">{t('growth.empty', { name: baby.name })}</p>
        </Card>
      ) : (
        <>
          <GrowthSummary baby={baby} measurements={growthQuery.data} units={units} />
          <GrowthCharts baby={baby} measurements={growthQuery.data} units={units} />
          <Card title={t('growth.list.title')}>
            <MeasurementList
              familyId={familyId}
              babyId={baby.id}
              measurements={growthQuery.data}
              units={units}
              onEdit={(measurement) => {
                setOpenForm({ kind: 'measurement', measurement });
                window.scrollTo?.({ top: 0, behavior: 'smooth' });
              }}
            />
          </Card>
        </>
      )}
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
