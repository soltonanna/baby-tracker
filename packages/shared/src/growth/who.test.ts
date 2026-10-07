import { describe, expect, it } from 'vitest';
import type { BabyGender } from '../constants.js';
import {
  compareWithWho,
  comparisonAge,
  normalCdf,
  percentileFromZ,
  valueAtZ,
  whoLmsAt,
  zScoreFromLms,
  type GrowthIndicator,
} from './who.js';
import { WHO_MAX_AGE_DAYS, WHO_TABLES } from './whoTables.js';

/**
 * Monthly rows transcribed from the WHO z-score tables in the project's
 * `who_standards/` folder (wfa-*-0-5-zscores.pdf, lfa_*_0_2_zscores.pdf),
 * months 0–24:
 *
 *   [month, L, M, S, -3SD, -2SD, -1SD, median, +1SD, +2SD, +3SD]
 *
 * The app reads WHO's *daily* tables; these are the independent check that the
 * daily data, the interpolation and the z-score formula agree with the
 * published monthly ones.
 */
type PdfRow = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
const PDF: Record<string, readonly PdfRow[]> = {
  weight_MALE: [
    [0, 0.3487, 3.3464, 0.14602, 2.1, 2.5, 2.9, 3.3, 3.9, 4.4, 5.0],
    [1, 0.2297, 4.4709, 0.13395, 2.9, 3.4, 3.9, 4.5, 5.1, 5.8, 6.6],
    [2, 0.197, 5.5675, 0.12385, 3.8, 4.3, 4.9, 5.6, 6.3, 7.1, 8.0],
    [3, 0.1738, 6.3762, 0.11727, 4.4, 5.0, 5.7, 6.4, 7.2, 8.0, 9.0],
    [4, 0.1553, 7.0023, 0.11316, 4.9, 5.6, 6.2, 7.0, 7.8, 8.7, 9.7],
    [5, 0.1395, 7.5105, 0.1108, 5.3, 6.0, 6.7, 7.5, 8.4, 9.3, 10.4],
    [6, 0.1257, 7.934, 0.10958, 5.7, 6.4, 7.1, 7.9, 8.8, 9.8, 10.9],
    [7, 0.1134, 8.297, 0.10902, 5.9, 6.7, 7.4, 8.3, 9.2, 10.3, 11.4],
    [8, 0.1021, 8.6151, 0.10882, 6.2, 6.9, 7.7, 8.6, 9.6, 10.7, 11.9],
    [9, 0.0917, 8.9014, 0.10881, 6.4, 7.1, 8.0, 8.9, 9.9, 11.0, 12.3],
    [10, 0.082, 9.1649, 0.10891, 6.6, 7.4, 8.2, 9.2, 10.2, 11.4, 12.7],
    [11, 0.073, 9.4122, 0.10906, 6.8, 7.6, 8.4, 9.4, 10.5, 11.7, 13.0],
    [12, 0.0644, 9.6479, 0.10925, 6.9, 7.7, 8.6, 9.6, 10.8, 12.0, 13.3],
    [13, 0.0563, 9.8749, 0.10949, 7.1, 7.9, 8.8, 9.9, 11.0, 12.3, 13.7],
    [14, 0.0487, 10.0953, 0.10976, 7.2, 8.1, 9.0, 10.1, 11.3, 12.6, 14.0],
    [15, 0.0413, 10.3108, 0.11007, 7.4, 8.3, 9.2, 10.3, 11.5, 12.8, 14.3],
    [16, 0.0343, 10.5228, 0.11041, 7.5, 8.4, 9.4, 10.5, 11.7, 13.1, 14.6],
    [17, 0.0275, 10.7319, 0.11079, 7.7, 8.6, 9.6, 10.7, 12.0, 13.4, 14.9],
    [18, 0.0211, 10.9385, 0.11119, 7.8, 8.8, 9.8, 10.9, 12.2, 13.7, 15.3],
    [19, 0.0148, 11.143, 0.11164, 8.0, 8.9, 10.0, 11.1, 12.5, 13.9, 15.6],
    [20, 0.0087, 11.3462, 0.11211, 8.1, 9.1, 10.1, 11.3, 12.7, 14.2, 15.9],
    [21, 0.0029, 11.5486, 0.11261, 8.2, 9.2, 10.3, 11.5, 12.9, 14.5, 16.2],
    [22, -0.0028, 11.7504, 0.11314, 8.4, 9.4, 10.5, 11.8, 13.2, 14.7, 16.5],
    [23, -0.0083, 11.9514, 0.11369, 8.5, 9.5, 10.7, 12.0, 13.4, 15.0, 16.8],
    [24, -0.0137, 12.1515, 0.11426, 8.6, 9.7, 10.8, 12.2, 13.6, 15.3, 17.1],
  ],
  weight_FEMALE: [
    [0, 0.3809, 3.2322, 0.14171, 2.0, 2.4, 2.8, 3.2, 3.7, 4.2, 4.8],
    [1, 0.1714, 4.1873, 0.13724, 2.7, 3.2, 3.6, 4.2, 4.8, 5.5, 6.2],
    [2, 0.0962, 5.1282, 0.13, 3.4, 3.9, 4.5, 5.1, 5.8, 6.6, 7.5],
    [3, 0.0402, 5.8458, 0.12619, 4.0, 4.5, 5.2, 5.8, 6.6, 7.5, 8.5],
    [4, -0.005, 6.4237, 0.12402, 4.4, 5.0, 5.7, 6.4, 7.3, 8.2, 9.3],
    [5, -0.043, 6.8985, 0.12274, 4.8, 5.4, 6.1, 6.9, 7.8, 8.8, 10.0],
    [6, -0.0756, 7.297, 0.12204, 5.1, 5.7, 6.5, 7.3, 8.2, 9.3, 10.6],
    [7, -0.1039, 7.6422, 0.12178, 5.3, 6.0, 6.8, 7.6, 8.6, 9.8, 11.1],
    [8, -0.1288, 7.9487, 0.12181, 5.6, 6.3, 7.0, 7.9, 9.0, 10.2, 11.6],
    [9, -0.1507, 8.2254, 0.12199, 5.8, 6.5, 7.3, 8.2, 9.3, 10.5, 12.0],
    [10, -0.17, 8.48, 0.12223, 5.9, 6.7, 7.5, 8.5, 9.6, 10.9, 12.4],
    [11, -0.1872, 8.7192, 0.12247, 6.1, 6.9, 7.7, 8.7, 9.9, 11.2, 12.8],
    [12, -0.2024, 8.9481, 0.12268, 6.3, 7.0, 7.9, 8.9, 10.1, 11.5, 13.1],
    [13, -0.2158, 9.1699, 0.12283, 6.4, 7.2, 8.1, 9.2, 10.4, 11.8, 13.5],
    [14, -0.2278, 9.387, 0.12294, 6.6, 7.4, 8.3, 9.4, 10.6, 12.1, 13.8],
    [15, -0.2384, 9.6008, 0.12299, 6.7, 7.6, 8.5, 9.6, 10.9, 12.4, 14.1],
    [16, -0.2478, 9.8124, 0.12303, 6.9, 7.7, 8.7, 9.8, 11.1, 12.6, 14.5],
    [17, -0.2562, 10.0226, 0.12306, 7.0, 7.9, 8.9, 10.0, 11.4, 12.9, 14.8],
    [18, -0.2637, 10.2315, 0.12309, 7.2, 8.1, 9.1, 10.2, 11.6, 13.2, 15.1],
    [19, -0.2703, 10.4393, 0.12315, 7.3, 8.2, 9.2, 10.4, 11.8, 13.5, 15.4],
    [20, -0.2762, 10.6464, 0.12323, 7.5, 8.4, 9.4, 10.6, 12.1, 13.7, 15.7],
    [21, -0.2815, 10.8534, 0.12335, 7.6, 8.6, 9.6, 10.9, 12.3, 14.0, 16.0],
    [22, -0.2862, 11.0608, 0.1235, 7.8, 8.7, 9.8, 11.1, 12.5, 14.3, 16.4],
    [23, -0.2903, 11.2688, 0.12369, 7.9, 8.9, 10.0, 11.3, 12.8, 14.6, 16.7],
    [24, -0.2941, 11.4775, 0.1239, 8.1, 9.0, 10.2, 11.5, 13.0, 14.8, 17.0],
  ],
  length_MALE: [
    [0, 1, 49.8842, 0.03795, 44.2, 46.1, 48.0, 49.9, 51.8, 53.7, 55.6],
    [1, 1, 54.7244, 0.03557, 48.9, 50.8, 52.8, 54.7, 56.7, 58.6, 60.6],
    [2, 1, 58.4249, 0.03424, 52.4, 54.4, 56.4, 58.4, 60.4, 62.4, 64.4],
    [3, 1, 61.4292, 0.03328, 55.3, 57.3, 59.4, 61.4, 63.5, 65.5, 67.6],
    [4, 1, 63.886, 0.03257, 57.6, 59.7, 61.8, 63.9, 66.0, 68.0, 70.1],
    [5, 1, 65.9026, 0.03204, 59.6, 61.7, 63.8, 65.9, 68.0, 70.1, 72.2],
    [6, 1, 67.6236, 0.03165, 61.2, 63.3, 65.5, 67.6, 69.8, 71.9, 74.0],
    [7, 1, 69.1645, 0.03139, 62.7, 64.8, 67.0, 69.2, 71.3, 73.5, 75.7],
    [8, 1, 70.5994, 0.03124, 64.0, 66.2, 68.4, 70.6, 72.8, 75.0, 77.2],
    [9, 1, 71.9687, 0.03117, 65.2, 67.5, 69.7, 72.0, 74.2, 76.5, 78.7],
    [10, 1, 73.2812, 0.03118, 66.4, 68.7, 71.0, 73.3, 75.6, 77.9, 80.1],
    [11, 1, 74.5388, 0.03125, 67.6, 69.9, 72.2, 74.5, 76.9, 79.2, 81.5],
    [12, 1, 75.7488, 0.03137, 68.6, 71.0, 73.4, 75.7, 78.1, 80.5, 82.9],
    [13, 1, 76.9186, 0.03154, 69.6, 72.1, 74.5, 76.9, 79.3, 81.8, 84.2],
    [14, 1, 78.0497, 0.03174, 70.6, 73.1, 75.6, 78.0, 80.5, 83.0, 85.5],
    [15, 1, 79.1458, 0.03197, 71.6, 74.1, 76.6, 79.1, 81.7, 84.2, 86.7],
    [16, 1, 80.2113, 0.03222, 72.5, 75.0, 77.6, 80.2, 82.8, 85.4, 88.0],
    [17, 1, 81.2487, 0.0325, 73.3, 76.0, 78.6, 81.2, 83.9, 86.5, 89.2],
    [18, 1, 82.2587, 0.03279, 74.2, 76.9, 79.6, 82.3, 85.0, 87.7, 90.4],
    [19, 1, 83.2418, 0.0331, 75.0, 77.7, 80.5, 83.2, 86.0, 88.8, 91.5],
    [20, 1, 84.1996, 0.03342, 75.8, 78.6, 81.4, 84.2, 87.0, 89.8, 92.6],
    [21, 1, 85.1348, 0.03376, 76.5, 79.4, 82.3, 85.1, 88.0, 90.9, 93.8],
    [22, 1, 86.0477, 0.0341, 77.2, 80.2, 83.1, 86.0, 89.0, 91.9, 94.9],
    [23, 1, 86.941, 0.03445, 78.0, 81.0, 83.9, 86.9, 89.9, 92.9, 95.9],
    [24, 1, 87.8161, 0.03479, 78.7, 81.7, 84.8, 87.8, 90.9, 93.9, 97.0],
  ],
  length_FEMALE: [
    [0, 1, 49.1477, 0.0379, 43.6, 45.4, 47.3, 49.1, 51.0, 52.9, 54.7],
    [1, 1, 53.6872, 0.0364, 47.8, 49.8, 51.7, 53.7, 55.6, 57.6, 59.5],
    [2, 1, 57.0673, 0.03568, 51.0, 53.0, 55.0, 57.1, 59.1, 61.1, 63.2],
    [3, 1, 59.8029, 0.0352, 53.5, 55.6, 57.7, 59.8, 61.9, 64.0, 66.1],
    [4, 1, 62.0899, 0.03486, 55.6, 57.8, 59.9, 62.1, 64.3, 66.4, 68.6],
    [5, 1, 64.0301, 0.03463, 57.4, 59.6, 61.8, 64.0, 66.2, 68.5, 70.7],
    [6, 1, 65.7311, 0.03448, 58.9, 61.2, 63.5, 65.7, 68.0, 70.3, 72.5],
    [7, 1, 67.2873, 0.03441, 60.3, 62.7, 65.0, 67.3, 69.6, 71.9, 74.2],
    [8, 1, 68.7498, 0.0344, 61.7, 64.0, 66.4, 68.7, 71.1, 73.5, 75.8],
    [9, 1, 70.1435, 0.03444, 62.9, 65.3, 67.7, 70.1, 72.6, 75.0, 77.4],
    [10, 1, 71.4818, 0.03452, 64.1, 66.5, 69.0, 71.5, 73.9, 76.4, 78.9],
    [11, 1, 72.771, 0.03464, 65.2, 67.7, 70.3, 72.8, 75.3, 77.8, 80.3],
    [12, 1, 74.015, 0.03479, 66.3, 68.9, 71.4, 74.0, 76.6, 79.2, 81.7],
    [13, 1, 75.2176, 0.03496, 67.3, 70.0, 72.6, 75.2, 77.8, 80.5, 83.1],
    [14, 1, 76.3817, 0.03514, 68.3, 71.0, 73.7, 76.4, 79.1, 81.7, 84.4],
    [15, 1, 77.5099, 0.03534, 69.3, 72.0, 74.8, 77.5, 80.2, 83.0, 85.7],
    [16, 1, 78.6055, 0.03555, 70.2, 73.0, 75.8, 78.6, 81.4, 84.2, 87.0],
    [17, 1, 79.671, 0.03576, 71.1, 74.0, 76.8, 79.7, 82.5, 85.4, 88.2],
    [18, 1, 80.7079, 0.03598, 72.0, 74.9, 77.8, 80.7, 83.6, 86.5, 89.4],
    [19, 1, 81.7182, 0.0362, 72.8, 75.8, 78.8, 81.7, 84.7, 87.6, 90.6],
    [20, 1, 82.7036, 0.03643, 73.7, 76.7, 79.7, 82.7, 85.7, 88.7, 91.7],
    [21, 1, 83.6654, 0.03666, 74.5, 77.5, 80.6, 83.7, 86.7, 89.8, 92.9],
    [22, 1, 84.604, 0.03688, 75.2, 78.4, 81.5, 84.6, 87.7, 90.8, 94.0],
    [23, 1, 85.5202, 0.03711, 76.0, 79.2, 82.3, 85.5, 88.7, 91.9, 95.0],
    [24, 1, 86.4153, 0.03734, 76.7, 80.0, 83.2, 86.4, 89.6, 92.9, 96.1],
  ],
};

/** WHO's monthly tables are evaluated at month × 30.4375 days. */
const DAYS_PER_MONTH = 30.4375;

const cases = Object.entries(PDF).map(([key, rows]) => {
  const [indicator, sex] = key.split('_') as [GrowthIndicator, BabyGender];
  return { key, indicator, sex, rows };
});

describe('WHO daily tables', () => {
  it('cover birth to day 730 for every indicator and sex', () => {
    for (const indicator of ['weight', 'length', 'headCircumference'] as const) {
      for (const sex of ['MALE', 'FEMALE'] as const) {
        const series = WHO_TABLES[indicator][sex];
        expect(series.l).toHaveLength(WHO_MAX_AGE_DAYS + 1);
        expect(series.m).toHaveLength(WHO_MAX_AGE_DAYS + 1);
        expect(series.s).toHaveLength(WHO_MAX_AGE_DAYS + 1);
      }
    }
  });

  it.each(cases)('match the monthly PDF LMS values ($key)', ({ indicator, sex, rows }) => {
    for (const [month, l, m, s] of rows) {
      const ageDays = month * DAYS_PER_MONTH;
      if (ageDays > WHO_MAX_AGE_DAYS) continue;
      const lms = whoLmsAt(indicator, sex, ageDays);
      expect(lms, `month ${month}`).toBeDefined();
      expect(lms!.m, `M at month ${month}`).toBeCloseTo(m, 2);
      expect(lms!.s, `S at month ${month}`).toBeCloseTo(s, 3);
      expect(lms!.l, `L at month ${month}`).toBeCloseTo(l, 2);
    }
  });

  it.each(cases)(
    'reproduce the PDF SD curves to the printed 0.1 ($key)',
    ({ indicator, sex, rows }) => {
      for (const [month, , , , ...curves] of rows) {
        const ageDays = month * DAYS_PER_MONTH;
        if (ageDays > WHO_MAX_AGE_DAYS) continue;
        const lms = whoLmsAt(indicator, sex, ageDays)!;
        curves.forEach((printed, index) => {
          const z = index - 3;
          // Within ±2 SD the curve is the plain LMS value; ±3 SD too, since the
          // restricted extrapolation only applies beyond it.
          expect(
            Math.abs(valueAtZ(lms, z) - printed),
            `z ${z} at month ${month}`,
          ).toBeLessThanOrEqual(0.051);
        });
      }
    },
  );

  it('has the WHO head-circumference medians at birth', () => {
    expect(WHO_TABLES.headCircumference.MALE.m[0]).toBeCloseTo(34.4618, 4);
    expect(WHO_TABLES.headCircumference.FEMALE.m[0]).toBeCloseTo(33.8787, 4);
  });
});

describe('zScoreFromLms', () => {
  it('is 0 at the median and inverts valueAtZ inside ±3 SD', () => {
    const lms = whoLmsAt('weight', 'MALE', 100)!;
    expect(zScoreFromLms(lms.m, lms)).toBeCloseTo(0, 10);
    for (const z of [-2.7, -1, 0.4, 2.9]) {
      expect(zScoreFromLms(valueAtZ(lms, z), lms)).toBeCloseTo(z, 8);
    }
  });

  it('uses WHO restricted extrapolation beyond ±3 SD', () => {
    const lms = whoLmsAt('weight', 'FEMALE', 0)!;
    const sd2 = valueAtZ(lms, 2);
    const sd3 = valueAtZ(lms, 3);
    // Half a 2–3 SD step past +3 SD is exactly z = 3.5.
    expect(zScoreFromLms(sd3 + (sd3 - sd2) / 2, lms)).toBeCloseTo(3.5, 10);
    const sdm2 = valueAtZ(lms, -2);
    const sdm3 = valueAtZ(lms, -3);
    expect(zScoreFromLms(sdm3 - (sdm2 - sdm3), lms)).toBeCloseTo(-4, 10);
  });

  it('handles L = 0 with the log form', () => {
    const lms = { l: 0, m: 10, s: 0.1 };
    expect(zScoreFromLms(10 * Math.exp(0.1), lms)).toBeCloseTo(1, 10);
  });
});

describe('percentiles', () => {
  it('maps z to the normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(percentileFromZ(1)).toBeCloseTo(84.13, 2);
    expect(percentileFromZ(-2)).toBeCloseTo(2.28, 2);
    expect(percentileFromZ(1.96)).toBeCloseTo(97.5, 2);
  });
});

describe('comparisonAge', () => {
  it('uses chronological age for a term baby or an unknown gestation', () => {
    expect(comparisonAge(30, { weeks: 39, days: 0 })).toEqual({ ageDays: 30, corrected: false });
    expect(comparisonAge(30, undefined)).toEqual({ ageDays: 30, corrected: false });
  });

  it('treats exactly 37+0 weeks as term', () => {
    expect(comparisonAge(10, { weeks: 37, days: 0 })).toEqual({ ageDays: 10, corrected: false });
  });

  it('corrects a preterm baby by the days born before 40 weeks', () => {
    // 34+3 → 39 days early.
    expect(comparisonAge(100, { weeks: 34, days: 3 })).toEqual({ ageDays: 61, corrected: true });
  });

  it('has no comparison before term-equivalent age', () => {
    expect(comparisonAge(20, { weeks: 34, days: 0 })).toBeUndefined();
  });

  it('stops correcting after two years', () => {
    expect(comparisonAge(731, { weeks: 32, days: 0 })).toEqual({ ageDays: 731, corrected: false });
  });
});

describe('compareWithWho', () => {
  const birthDate = new Date('2026-01-01T00:00:00.000Z');
  const base = {
    indicator: 'weight' as const,
    value: 3.3464,
    measuredOn: birthDate,
    birthDate,
    sex: 'MALE' as const,
    gestationalAge: undefined,
  };

  it('puts the WHO median at the 50th percentile', () => {
    const result = compareWithWho(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comparison.zScore).toBeCloseTo(0, 6);
    expect(result.comparison.percentile).toBeCloseTo(50, 4);
    expect(result.comparison).toMatchObject({ ageDays: 0, corrected: false });
  });

  it('says why when there is no comparison', () => {
    expect(compareWithWho({ ...base, birthDate: undefined })).toEqual({
      ok: false,
      reason: 'missingBirthDate',
    });
    expect(compareWithWho({ ...base, sex: undefined })).toEqual({
      ok: false,
      reason: 'missingSex',
    });
    expect(compareWithWho({ ...base, measuredOn: new Date('2025-12-31T00:00:00.000Z') })).toEqual({
      ok: false,
      reason: 'beforeBirth',
    });
    expect(compareWithWho({ ...base, gestationalAge: { weeks: 33, days: 0 } })).toEqual({
      ok: false,
      reason: 'beforeTermEquivalent',
    });
    expect(compareWithWho({ ...base, measuredOn: new Date('2028-06-01T00:00:00.000Z') })).toEqual({
      ok: false,
      reason: 'outsideRange',
    });
  });

  it('compares a preterm twin at corrected age', () => {
    const result = compareWithWho({
      ...base,
      measuredOn: new Date('2026-03-01T00:00:00.000Z'), // 59 days old
      gestationalAge: { weeks: 35, days: 0 }, // 35 days early → 24 days corrected
      value: whoLmsAt('weight', 'MALE', 24)!.m,
    });
    expect(result).toMatchObject({ ok: true, comparison: { ageDays: 24, corrected: true } });
    if (result.ok) expect(result.comparison.percentile).toBeCloseTo(50, 4);
  });
});
