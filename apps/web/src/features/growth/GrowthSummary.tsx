import { useTranslation } from 'react-i18next';
import {
  GROWTH_INDICATORS,
  type Baby,
  type GrowthIndicator,
  type GrowthMeasurement,
  type UnitPreferences,
} from '@baby-tracker/shared';
import { Card } from '../../components/ui/Card.js';
import {
  ageLabel,
  formatAmount,
  formatMeasuredOn,
  percentileLabel,
  summarise,
  toDisplay,
  unitFor,
} from './growthMath.js';
import { compareMeasurement, type BabyComparison } from './growthCompare.js';

/**
 * The latest value of each measurement, the change since the one before, and
 * where it sits on the WHO standard — the three things spec §12 asks for.
 *
 * Wording is deliberately flat: a number, a date, a percentile. No colour says
 * good or bad, no arrow says up is better, and the footer says plainly what a
 * percentile is and is not.
 */

export interface GrowthSummaryProps {
  baby: Baby;
  measurements: readonly GrowthMeasurement[];
  units: UnitPreferences;
}

export function GrowthSummary({ baby, measurements, units }: GrowthSummaryProps) {
  const { t } = useTranslation();

  return (
    <Card
      title={t('growth.summary.title')}
      className="border-tone-line"
      footer={t('growth.disclaimer')}
    >
      <dl className="divide-y divide-line">
        {GROWTH_INDICATORS.map((indicator) => (
          <IndicatorRow
            key={indicator}
            baby={baby}
            indicator={indicator}
            measurements={measurements}
            units={units}
          />
        ))}
      </dl>
    </Card>
  );
}

function IndicatorRow({
  baby,
  indicator,
  measurements,
  units,
}: {
  baby: Baby;
  indicator: GrowthIndicator;
  measurements: readonly GrowthMeasurement[];
  units: UnitPreferences;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const summary = summarise(indicator, measurements);
  const unit = unitFor(indicator, units);
  const unitText = t(`growth.units.${unit}`);

  return (
    <div className="py-3 first:pt-0 last:pb-0" data-indicator={indicator}>
      <dt className="text-sm font-medium text-muted">{t(`growth.indicator.${indicator}`)}</dt>
      {summary === undefined ? (
        <dd className="text-ink">{t('growth.summary.notMeasured')}</dd>
      ) : (
        <dd className="space-y-0.5">
          <p className="text-ink">
            <span className="text-xl font-semibold">
              {formatAmount(toDisplay(indicator, summary.value, unit), unit, locale)} {unitText}
            </span>{' '}
            <span className="text-sm text-muted">
              · {formatMeasuredOn(summary.latest.measuredOn, locale)}
            </span>
          </p>
          <p className="text-sm text-ink">
            {summary.previous === undefined
              ? t('growth.summary.firstMeasurement')
              : t('growth.summary.change', {
                  change: `${formatAmount(
                    toDisplay(indicator, summary.value - summary.previous.value, unit),
                    unit,
                    locale,
                    true,
                  )} ${unitText}`,
                  date: formatMeasuredOn(summary.previous.measurement.measuredOn, locale),
                  days: summary.previous.daysBefore,
                })}
          </p>
          <ComparisonLine
            comparison={compareMeasurement(
              baby,
              indicator,
              summary.latest.measuredOn,
              summary.value,
            )}
          />
        </dd>
      )}
    </div>
  );
}

/** The WHO line under a value — or, when there is no comparison, why. */
export function ComparisonLine({ comparison }: { comparison: BabyComparison }) {
  const { t } = useTranslation();

  if (!comparison.ok) {
    // Missing details are asked for once, above the summary, not on every row.
    if (comparison.reason === 'missingBirthDate' || comparison.reason === 'missingSex') return null;
    return <p className="text-sm text-muted">{t(`growth.unavailable.${comparison.reason}`)}</p>;
  }

  const label = percentileLabel(comparison.comparison.percentile);
  const age = ageLabel(comparison.comparison.ageDays);
  return (
    <p className="text-sm text-muted">
      {label.kind === 'value'
        ? t('growth.percentile.value', { value: label.value })
        : t(`growth.percentile.${label.kind}`)}
      {comparison.comparison.corrected
        ? ` · ${t('growth.correctedAge', { age: t(`growth.age.${age.unit}`, { value: age.value }) })}`
        : null}
    </p>
  );
}
