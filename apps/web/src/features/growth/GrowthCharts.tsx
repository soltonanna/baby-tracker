import { useId, useState } from 'react';
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
  DAYS_PER_MONTH,
  chartModel,
  monthTicks,
  niceTicks,
  type ChartModel,
} from './growthChart.js';
import { formatAmount, formatMeasuredOn } from './growthMath.js';

/**
 * The baby's measurements over age, on the WHO curves.
 *
 * Hand-drawn SVG, no chart library: it is one fixed chart — a neutral band
 * between the 2nd and 98th WHO percentiles, the median, and the baby's points
 * in their own colour. The band is grey on purpose: colouring it, or the space
 * outside it, would read as a verdict, and this screen gives none.
 *
 * One indicator at a time, picked above the chart, so a phone shows one
 * legible chart rather than three cramped ones. The list below the chart is
 * its table view.
 */

const WIDTH = 340;
const HEIGHT = 220;
const MARGIN = { top: 12, right: 34, bottom: 34, left: 40 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

/** WHO percentile each reference curve sits at, for its direct label. */
const PERCENTILE_OF_Z: Record<number, number> = { [-2]: 2, 0: 50, 2: 98 };

export interface GrowthChartsProps {
  baby: Baby;
  measurements: readonly GrowthMeasurement[];
  units: UnitPreferences;
}

export function GrowthCharts({ baby, measurements, units }: GrowthChartsProps) {
  const { t } = useTranslation();
  const groupName = useId();
  const available = GROWTH_INDICATORS.filter((indicator) =>
    chartModel(indicator, baby, measurements, units),
  );
  const [picked, setPicked] = useState<GrowthIndicator>('weight');
  const indicator = available.includes(picked) ? picked : available[0];
  if (indicator === undefined) return null;
  const model = chartModel(indicator, baby, measurements, units);
  if (!model) return null;

  return (
    <Card title={t('growth.chart.title')} className="border-tone-line">
      <fieldset className="mb-3">
        <legend className="sr-only">{t('growth.chart.pick')}</legend>
        <div className="grid grid-cols-3 gap-2">
          {GROWTH_INDICATORS.map((choice) => {
            const selected = choice === indicator;
            const disabled = !available.includes(choice);
            return (
              <label
                key={choice}
                className={[
                  'min-h-touch flex items-center justify-center rounded-full border px-2 text-center text-sm font-medium',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-tone',
                  disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                  selected
                    ? 'border-tone bg-tone-soft text-tone-ink'
                    : 'border-tone-line bg-surface text-tone-ink',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={choice}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => {
                    setPicked(choice);
                  }}
                  className="sr-only"
                />
                {t(`growth.indicator.${choice}`)}
              </label>
            );
          })}
        </div>
      </fieldset>

      <GrowthChart model={model} babyName={baby.name} />
    </Card>
  );
}

function GrowthChart({ model, babyName }: { model: ChartModel; babyName: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [active, setActive] = useState<string | null>(null);
  const unitText = t(`growth.units.${model.unit}`);

  const sx = (days: number) =>
    MARGIN.left + ((days - model.x.min) / (model.x.max - model.x.min || 1)) * PLOT_W;
  const sy = (value: number) =>
    MARGIN.top + (1 - (value - model.y.min) / (model.y.max - model.y.min || 1)) * PLOT_H;
  const path = (points: { ageDays: number; value: number }[]) =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.ageDays).toFixed(1)},${sy(p.value).toFixed(1)}`)
      .join('');

  const lower = model.reference.find((c) => c.z === -2);
  const upper = model.reference.find((c) => c.z === 2);
  const band =
    lower && upper
      ? `${path(upper.points)}${[...lower.points]
          .reverse()
          .map((p) => `L${sx(p.ageDays).toFixed(1)},${sy(p.value).toFixed(1)}`)
          .join('')}Z`
      : null;

  const yTicks = niceTicks(model.y.min, model.y.max);
  const xTicks = monthTicks(model.x.min, model.x.max);
  const activePoint = model.points.find((p) => p.measurementId === active);
  const indicatorName = t(`growth.indicator.${model.indicator}`);

  return (
    <figure className="space-y-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full touch-manipulation"
          role="img"
          aria-label={t('growth.chart.aria', {
            indicator: indicatorName,
            name: babyName,
            n: model.points.length,
          })}
          onPointerLeave={() => {
            setActive(null);
          }}
        >
          {/* Recessive grid: horizontal lines only. */}
          {yTicks.map((tick) => (
            <g key={`y${tick}`}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + PLOT_W}
                y1={sy(tick)}
                y2={sy(tick)}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 6}
                y={sy(tick)}
                dy="0.32em"
                textAnchor="end"
                fontSize={10}
                fill="var(--color-muted)"
              >
                {formatAmount(tick, model.unit, locale)}
              </text>
            </g>
          ))}
          {xTicks.map((month) => (
            <text
              key={`x${month}`}
              x={sx(month * DAYS_PER_MONTH)}
              y={MARGIN.top + PLOT_H + 14}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-muted)"
            >
              {month}
            </text>
          ))}
          <text
            x={MARGIN.left + PLOT_W / 2}
            y={HEIGHT - 4}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-muted)"
          >
            {model.byAge
              ? model.corrected
                ? t('growth.chart.xCorrected')
                : t('growth.chart.xAge')
              : t('growth.chart.xSinceFirst')}
          </text>

          {band ? <path d={band} fill="var(--color-surface-sunken)" stroke="none" /> : null}
          {model.reference.map((curve) => {
            const last = curve.points.at(-1);
            return (
              <g key={curve.z}>
                <path
                  d={path(curve.points)}
                  fill="none"
                  stroke="var(--color-muted)"
                  strokeOpacity={curve.z === 0 ? 0.7 : 0.4}
                  strokeWidth={curve.z === 0 ? 1.5 : 1}
                  strokeDasharray={curve.z === 0 ? '4 3' : undefined}
                />
                {last ? (
                  <text
                    x={sx(last.ageDays) + 4}
                    y={sy(last.value)}
                    dy="0.32em"
                    fontSize={10}
                    fill="var(--color-muted)"
                  >
                    {PERCENTILE_OF_Z[curve.z]}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* The baby: a 2px line in their colour, ringed points, generous hit targets. */}
          {model.points.length > 1 ? (
            <path
              d={path(model.points)}
              fill="none"
              stroke="var(--tone)"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ) : null}
          {model.points.map((point) => {
            const selected = point.measurementId === active;
            const label = `${formatMeasuredOn(point.measuredOn, locale)}: ${formatAmount(point.value, model.unit, locale)} ${unitText}`;
            return (
              <g
                key={point.measurementId}
                tabIndex={0}
                role="button"
                aria-label={label}
                className="cursor-pointer outline-none"
                onPointerEnter={() => {
                  setActive(point.measurementId);
                }}
                onClick={() => {
                  setActive(point.measurementId);
                }}
                onFocus={() => {
                  setActive(point.measurementId);
                }}
                onBlur={() => {
                  setActive(null);
                }}
              >
                <circle cx={sx(point.ageDays)} cy={sy(point.value)} r={14} fill="transparent" />
                <circle
                  cx={sx(point.ageDays)}
                  cy={sy(point.value)}
                  r={selected ? 6 : 4.5}
                  fill="var(--tone)"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              </g>
            );
          })}
        </svg>

        {activePoint ? (
          <div
            role="status"
            className="pointer-events-none absolute top-1 rounded-field border border-line bg-surface px-2 py-1 text-xs text-ink shadow-soft"
            style={{
              left: `${(sx(activePoint.ageDays) / WIDTH) * 100}%`,
              transform:
                sx(activePoint.ageDays) > WIDTH / 2 ? 'translateX(-105%)' : 'translateX(5%)',
            }}
          >
            <span className="block text-muted">
              {formatMeasuredOn(activePoint.measuredOn, locale)}
            </span>
            <span className="font-semibold">
              {formatAmount(activePoint.value, model.unit, locale)} {unitText}
            </span>
          </div>
        ) : null}
      </div>

      <figcaption className="space-y-1 text-xs text-muted">
        <span className="block">
          {model.reference.length > 0
            ? t('growth.chart.caption', { unit: unitText })
            : t('growth.chart.noReference')}
        </span>
        {model.omitted > 0 ? (
          <span className="block">{t('growth.chart.omitted', { n: model.omitted })}</span>
        ) : null}
      </figcaption>
    </figure>
  );
}
