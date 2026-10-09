import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  DAY_PERIODS,
  FEEDING_KINDS,
  countDiapers,
  summariseFeedingDay,
  volumeFromMl,
  type BabyEvent,
  type FeedingKindOrUnspecified,
  type VolumeUnit,
} from '@baby-tracker/shared';
import { Card } from '../../components/ui/Card.js';
import type { DayRange } from './day.js';

/**
 * The day's feedings at a glance, with the nappies beside them.
 *
 * Everything here is computed by `summariseFeedingDay` from the events Today
 * already loaded, plus the start of the previous day's last feeding so that the
 * first interval and "since last" are real gaps rather than cut off at midnight.
 *
 * **Neutral by design** (project rules §7). It counts, measures intervals and
 * places feedings on the clock; it never says whether that is enough. Volume is
 * the *measured bottle volume* and is labelled so — a breastfeed has no volume,
 * and a total that silently left it out would read as a baby who ate little.
 * When any feeding today was at the breast, a short line says so in plain
 * words and points at what is more useful together: feedings, nappies, weight
 * and how the baby seems, with the paediatrician to interpret them.
 */

export interface FeedingSummaryProps {
  /** The day's events, as listed — any types; feedings and nappies are read. */
  events: BabyEvent[];
  day: DayRange;
  timeZone: string;
  /** Start of the last feeding before this day, if one was loaded. */
  previousFeedingAt?: string | undefined;
  volumeUnit: VolumeUnit;
  now?: Date;
}

/** `2h 05m`, or `45m` under an hour. */
function formatMinutes(total: number, t: TFunction): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0
    ? t('today.duration.hoursMinutes', { hours, minutes: String(minutes).padStart(2, '0') })
    : t('today.duration.minutes', { minutes });
}

function formatVolume(ml: number, unit: VolumeUnit, t: TFunction): string {
  const value = volumeFromMl(ml, unit);
  const shown = unit === 'ml' ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown} ${t(`today.feeding.units.${unit}`)}`;
}

/** Breast is drawn as a filled dot, a bottle as a ring: never colour alone. */
const MARK_STYLE: Record<FeedingKindOrUnspecified, string> = {
  breast: 'rounded-full bg-feeding border-feeding',
  expressed_milk: 'rounded-full bg-surface border-feeding',
  formula: 'rounded-sm bg-surface border-feeding',
  unspecified: 'rounded-full bg-surface border-muted',
};

export function FeedingSummary({
  events,
  day,
  timeZone,
  previousFeedingAt,
  volumeUnit,
  now = new Date(),
}: FeedingSummaryProps) {
  const { t, i18n } = useTranslation();

  const summary = summariseFeedingDay({
    events,
    dayStart: new Date(day.from),
    dayEnd: new Date(day.to),
    timeZone,
    previousFeedingAt,
    now,
  });
  const diapers = countDiapers(events);
  const kindCounts = [...FEEDING_KINDS, 'unspecified' as const].filter(
    (kind) => summary.byKind[kind] > 0,
  );

  return (
    <Card title={t('today.summary.title')} className="border-tone-line">
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl font-semibold text-ink">
            {t('today.summary.feedings', { count: summary.count })}
          </p>
          {summary.minutesSinceLast === null ? null : (
            <p className="text-right text-sm text-muted">
              {t('today.summary.sinceLast', {
                duration: formatMinutes(summary.minutesSinceLast, t),
              })}
            </p>
          )}
        </div>

        {kindCounts.length === 0 ? (
          <p className="text-sm text-muted">{t('today.summary.noFeedings')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label={t('today.summary.byKind')}>
            {kindCounts.map((kind) => (
              <li
                key={kind}
                className="rounded-full bg-feeding-soft px-3 py-1 text-sm font-medium text-ink"
              >
                {t(`today.summary.kinds.${kind}`)} {summary.byKind[kind]}
              </li>
            ))}
          </ul>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">{t('today.summary.averageInterval')}</dt>
          <dd className="text-right text-ink">
            {summary.intervals === null
              ? t('today.summary.notEnough')
              : formatMinutes(summary.intervals.averageMinutes, t)}
          </dd>

          {summary.intervals === null ? null : (
            <>
              <dt className="text-muted">{t('today.summary.intervalRange')}</dt>
              <dd className="text-right text-ink">
                {formatMinutes(summary.intervals.shortestMinutes, t)} –{' '}
                {formatMinutes(summary.intervals.longestMinutes, t)}
              </dd>
            </>
          )}

          <dt className="text-muted">{t('today.summary.bottleVolume')}</dt>
          <dd className="text-right text-ink">
            {summary.measuredFeedings === 0
              ? t('today.summary.noBottles')
              : t('today.summary.bottleVolumeValue', {
                  volume: formatVolume(summary.volumeMl.total, volumeUnit, t),
                  count: summary.measuredFeedings,
                })}
          </dd>

          {summary.byKind.breast === 0 ? null : (
            <>
              <dt className="text-muted">{t('today.summary.breastTime')}</dt>
              <dd className="text-right text-ink">
                {summary.breastFeedsWithDuration === 0
                  ? t('today.summary.notTimed')
                  : t('today.summary.breastTimeValue', {
                      duration: formatMinutes(summary.breastMinutes, t),
                      timed: summary.breastFeedsWithDuration,
                      count: summary.byKind.breast,
                    })}
              </dd>
            </>
          )}

          <dt className="text-muted">{t('today.summary.diapers')}</dt>
          <dd className="text-right text-ink">
            {t('today.summary.diapersValue', { wet: diapers.wet, dirty: diapers.dirty })}
          </dd>
        </dl>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{t('today.summary.distribution')}</p>
          {/*
            The strip is a picture of the list below it and of the event list:
            hidden from assistive technology, which gets the counts in words.
          */}
          <div aria-hidden="true" className="space-y-1">
            <div className="relative h-8 rounded-field bg-surface-sunken">
              {[0.25, 0.5, 0.75].map((at) => (
                <span
                  key={at}
                  className="absolute top-1 bottom-1 w-px bg-line"
                  style={{ left: `${at * 100}%` }}
                />
              ))}
              {summary.marks.map((mark, index) => (
                <span
                  key={`${mark.startedAt}-${String(index)}`}
                  data-feeding-mark={mark.kind}
                  title={new Date(mark.startedAt).toLocaleTimeString(i18n.language, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 ${MARK_STYLE[mark.kind]}`}
                  style={{ left: `${mark.position * 100}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted">
              <span>00</span>
              <span>06</span>
              <span>12</span>
              <span>18</span>
              <span>24</span>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            {DAY_PERIODS.map((period) => (
              <li key={period} className="flex justify-between gap-2">
                <span className="text-muted">{t(`today.summary.periods.${period}`)}</span>
                <span className="text-ink">{summary.byPeriod[period]}</span>
              </li>
            ))}
          </ul>
          {summary.count > 0 ? (
            <p aria-hidden="true" className="flex flex-wrap gap-x-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <span className={`h-2.5 w-2.5 border-2 ${MARK_STYLE.breast}`} />
                {t('today.summary.kinds.breast')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={`h-2.5 w-2.5 border-2 ${MARK_STYLE.expressed_milk}`} />
                {t('today.summary.kinds.expressed_milk')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={`h-2.5 w-2.5 border-2 ${MARK_STYLE.formula}`} />
                {t('today.summary.kinds.formula')}
              </span>
            </p>
          ) : null}
        </div>

        {summary.byKind.breast > 0 ? (
          <p className="rounded-field bg-surface-sunken px-3 py-2 text-sm text-muted">
            {t('today.summary.breastNote')}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
