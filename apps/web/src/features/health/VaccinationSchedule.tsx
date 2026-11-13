import { useTranslation } from 'react-i18next';
import {
  CHECKUP_REFERENCE_PLACEHOLDER,
  IMMUNIZATION_CATALOG_REVIEWED_ON,
  IMMUNIZATION_CATALOG_VERSION,
  IMMUNIZATION_DISCLAIMER,
  IMMUNIZATION_SOURCES,
  IMMUNIZATION_VACCINES,
  INTERNATIONAL_REFERENCES,
  compareWithSchedule,
  type AgeSpec,
  type HealthRecord,
  type ScheduleItemResult,
  type ScheduleStatus,
} from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { localized, toScheduleRefs } from './healthModel.js';

/**
 * The Armenian national calendar set against what has been recorded: each dose
 * with its date, a status, and — one tap away — what it protects against, how
 * the decree words it and where that comes from.
 *
 * The statuses are date arithmetic under the decree's rules (`compareWithSchedule`),
 * stated as such on screen; nothing here is a medical judgement, and no dose is
 * ever suggested.
 */

export interface VaccinationScheduleProps {
  babyName: string;
  /** 'YYYY-MM-DD'. */
  birthDate: string;
  /** Today's date on the user's calendar, 'YYYY-MM-DD'. */
  today: string;
  records: readonly HealthRecord[];
  timeZone: string;
  onRecordDose: (scheduleKey: string) => void;
  onEditRecord: (recordId: string) => void;
}

const STATUS_STYLE: Record<ScheduleStatus, string> = {
  completed: 'bg-mint-soft text-mint-ink',
  due: 'bg-note-soft text-note',
  upcoming: 'bg-surface-sunken text-muted',
  overdue: 'bg-critical-soft text-critical',
  missed: 'bg-critical-soft text-critical',
  scheduled_later: 'bg-surface-sunken text-muted',
};

const STATUS_MARK: Record<ScheduleStatus, string> = {
  completed: '✓',
  due: '●',
  upcoming: '○',
  overdue: '!',
  missed: '?',
  scheduled_later: '…',
};

export function VaccinationSchedule({
  babyName,
  birthDate,
  today,
  records,
  timeZone,
  onRecordDose,
  onEditRecord,
}: VaccinationScheduleProps) {
  const { t, i18n } = useTranslation();
  const comparison = compareWithSchedule({
    birthDate,
    today,
    records: toScheduleRefs(records, timeZone),
  });
  const { completed, total } = comparison.progress;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  const day = (calendarDate: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${calendarDate}T00:00:00.000Z`),
    );
  const age = (spec: AgeSpec): string => {
    if ('days' in spec) {
      return spec.days === 0 ? t('health.age.birth') : t('health.age.days', { n: spec.days });
    }
    if ('weeks' in spec) return t('health.age.weeks', { n: spec.weeks });
    if ('months' in spec) return t('health.age.months', { n: spec.months });
    return t('health.age.years', { n: spec.years });
  };

  const items = [...comparison.items].sort(
    (a, b) => a.dueOn.localeCompare(b.dueOn) || a.item.dose - b.item.dose,
  );
  const unmatchedNames = comparison.unmatched
    .map((ref) => records.find((record) => record.id === ref.id)?.name)
    .filter((name): name is string => name !== undefined);

  return (
    <div className="space-y-4">
      <Card title={t('health.schedule.title')}>
        <p className="text-ink">{t('health.schedule.progress', { completed, total })}</p>
        <div
          role="progressbar"
          aria-label={t('health.schedule.progress', { completed, total })}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          className="mt-2 h-3 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div className="h-full rounded-full bg-tone" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-3 text-sm text-muted">
          {localized(IMMUNIZATION_DISCLAIMER, i18n.language)}
        </p>
        <p className="mt-2 text-sm text-muted">{t('health.schedule.statusNote')}</p>
      </Card>

      <ul className="space-y-2">
        {items.map((result) => (
          <ScheduleRow
            key={result.item.key}
            result={result}
            babyName={babyName}
            day={day}
            age={age}
            onRecordDose={onRecordDose}
            onEditRecord={onEditRecord}
          />
        ))}
      </ul>

      {unmatchedNames.length > 0 ? (
        <Card title={t('health.schedule.unmatchedTitle')}>
          <p className="text-sm text-ink">
            {t('health.schedule.unmatchedBody', { names: unmatchedNames.join(', ') })}
          </p>
        </Card>
      ) : null}

      <Card title={t('health.schedule.internationalTitle')}>
        <p className="mb-3 text-sm text-muted">{t('health.schedule.internationalIntro')}</p>
        <ul className="space-y-3">
          {INTERNATIONAL_REFERENCES.map((reference) => {
            const source = IMMUNIZATION_SOURCES.find((s) => s.id === reference.sourceId);
            return (
              <li key={reference.id} className="space-y-0.5">
                <p className="font-semibold text-ink">
                  {localized(reference.name, i18n.language)}{' '}
                  <span className="text-sm font-normal text-muted">
                    · {t('health.schedule.recommendedFrom', { age: age(reference.fromAge) })}
                  </span>
                </p>
                <p className="text-sm text-ink">{localized(reference.note, i18n.language)}</p>
                <p className="text-xs text-muted">
                  {t('health.schedule.origin.international')}
                  {source ? ` — ${localized(source.title, i18n.language)}` : ''}
                  {source?.review === 'to_verify' ? ` ${t('health.schedule.unverified')}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={t('health.schedule.checkupsTitle')}>
        <p className="text-sm text-ink">
          {localized(CHECKUP_REFERENCE_PLACEHOLDER, i18n.language)}
        </p>
      </Card>

      <Card title={t('health.schedule.sourcesTitle')}>
        <ul className="space-y-2 text-sm text-ink">
          {IMMUNIZATION_SOURCES.map((source) => (
            <li key={source.id}>
              <span className="font-medium">{localized(source.issuer, i18n.language)}.</span>{' '}
              {localized(source.title, i18n.language)}
              <span className="text-muted">
                {' '}
                ({t(`health.schedule.origin.${source.origin}`)}
                {source.review === 'to_verify' ? ` — ${t('health.schedule.unverified')}` : ''})
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          {t('health.schedule.catalogInfo', {
            version: IMMUNIZATION_CATALOG_VERSION,
            date: day(IMMUNIZATION_CATALOG_REVIEWED_ON),
          })}
        </p>
      </Card>
    </div>
  );
}

function ScheduleRow({
  result,
  babyName,
  day,
  age,
  onRecordDose,
  onEditRecord,
}: {
  result: ScheduleItemResult;
  babyName: string;
  day: (calendarDate: string) => string;
  age: (spec: AgeSpec) => string;
  onRecordDose: (scheduleKey: string) => void;
  onEditRecord: (recordId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { item, status } = result;
  const vaccine = IMMUNIZATION_VACCINES.find((candidate) => candidate.id === item.vaccineId);
  const source = IMMUNIZATION_SOURCES.find((candidate) => candidate.id === item.sourceId);
  if (!vaccine) return null;

  const abbreviation = localized(vaccine.abbreviation, i18n.language);
  const doseLabel = t('health.schedule.doseOf', { n: item.dose, total: item.totalDoses });
  const statusLabel =
    status === 'scheduled_later'
      ? t('health.status.scheduled_later', { year: (item.effectiveFrom ?? '').slice(0, 4) })
      : t(`health.status.${status}`);
  const admin = item.administration;

  return (
    <li className="rounded-field border border-line bg-surface px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold break-words text-ink">
            {abbreviation} <span className="font-normal text-muted">· {doseLabel}</span>
          </p>
          <p className="text-sm text-ink">{localized(vaccine.name, i18n.language)}</p>
          <p className="text-sm text-muted">
            {t('health.schedule.recommended', { age: age(item.dueAge), date: day(result.dueOn) })}
          </p>
          {result.record ? (
            <p className="text-sm text-ink">
              {t('health.schedule.givenOn', { date: day(result.record.occurredOn) })}
            </p>
          ) : null}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}
        >
          <span aria-hidden="true">{STATUS_MARK[status]}</span>
          {statusLabel}
        </span>
      </div>

      {result.givenTooEarly ? (
        <p role="note" className="mt-2 rounded-field bg-note-soft px-3 py-2 text-sm text-note">
          {t('health.schedule.tooEarly')}
        </p>
      ) : null}
      {result.intervalTooShort ? (
        <p role="note" className="mt-2 rounded-field bg-note-soft px-3 py-2 text-sm text-note">
          {t('health.schedule.intervalShort')}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {result.record ? (
          <Button
            variant="quiet"
            onClick={() => {
              if (result.record) onEditRecord(result.record.id);
            }}
          >
            {t('health.schedule.viewRecord')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            aria-label={t('health.schedule.recordDoseAria', {
              name: `${abbreviation} (${babyName})`,
              dose: item.dose,
            })}
            onClick={() => {
              onRecordDose(item.key);
            }}
          >
            {t('health.schedule.recordDose')}
          </Button>
        )}
      </div>

      <details className="mt-2 text-sm">
        <summary className="min-h-touch cursor-pointer py-2 font-medium text-tone-ink">
          {t('health.schedule.details')}
        </summary>
        <dl className="space-y-2 pb-1 text-ink">
          <Detail label={t('health.schedule.protects')}>
            {localized(vaccine.protectsAgainst, i18n.language)}
          </Detail>
          <Detail label={t('health.schedule.purpose')}>
            {localized(vaccine.purpose, i18n.language)}
          </Detail>
          <Detail label={t('health.schedule.doses')}>
            {localized(vaccine.doses, i18n.language)}
          </Detail>
          {vaccine.catchUp ? (
            <Detail label={t('health.schedule.catchUp')}>
              {localized(vaccine.catchUp, i18n.language)}
            </Detail>
          ) : null}
          {admin ? (
            <p className="text-muted">
              {t('health.schedule.administration', {
                volume: admin.volumeMl,
                route: t(`health.schedule.routes.${admin.route}`),
                site: t(`health.schedule.sites.${admin.site}`),
                clause: admin.clause,
              })}
            </p>
          ) : null}
          <p className="text-xs text-muted">
            {t('health.schedule.origin.official')} ·{' '}
            {t('health.schedule.source', {
              source: source ? localized(source.issuer, i18n.language) : item.sourceId,
              clause: item.clause,
            })}
          </p>
        </dl>
      </details>
    </li>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
