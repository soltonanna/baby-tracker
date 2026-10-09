#!/usr/bin/env node
/**
 * Generates a realistic, *fictional* family data file for testing: twins — a
 * boy and a girl — with months of feedings, sleeps, nappies, notes and growth
 * visits. Import it from More → Your data → Import.
 *
 *   npm run build --workspace @baby-tracker/shared   # once, the script reads dist/
 *   node scripts/generate-test-data.mjs [--birth 2026-04-01] [--until 2026-10-08] [--seed 42] [--out test-data/twins-test-data.json]
 *
 * Deterministic for a given seed and date range. `--until` defaults to today,
 * and nothing is written after the moment the script runs, so Today always has
 * entries up to "now".
 *
 * What it is shaped to exercise:
 *   - twins born at 36+2 weeks, so growth is compared by *corrected* age and the
 *     first ~4 weeks have no WHO comparison at all;
 *   - growth that follows the WHO curves with catch-up, a first-week weight dip,
 *     clinic visits (all three values, DOCTOR) and home weigh-ins (weight only, PARENT);
 *   - feeding frequency falling and volume rising with age, night feeds dropping
 *     out (earlier for the boy than the girl);
 *   - sleeps that cross midnight, nappies of every kind, notes, and grouped
 *     "both babies" entries sharing a `groupId`.
 *
 * Times are generated on the Asia/Yerevan clock (UTC+4, no DST) — the app's
 * default zone. This is test data, not a model of any real child, and the app
 * draws no conclusions from it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shared = await import(join(root, 'packages/shared/dist/index.js'));
const who = await import(join(root, 'packages/shared/dist/growth/who.js'));

/* ------------------------------------------------------------- options --- */

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const ZONE_OFFSET_MS = 4 * 3_600_000; // Asia/Yerevan, UTC+4 all year
const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

const todayLocal = new Date(Date.now() + ZONE_OFFSET_MS).toISOString().slice(0, 10);
const BIRTH = option('birth', '2026-04-01');
const UNTIL = option('until', todayLocal);
const SEED = Number(option('seed', '42'));
const OUT = resolve(root, option('out', 'test-data/twins-test-data.json'));
const NOW = Date.now();

/* ---------------------------------------------------------------- random --- */

/** mulberry32: small, seedable, good enough for test data. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(SEED);
const between = (min, max) => min + random() * (max - min);
const chance = (p) => random() < p;
const pick = (items) => items[Math.floor(random() * items.length)];
/** Weighted pick from [[value, weight], …]. */
function weighted(pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let r = random() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}
const roundTo = (value, step) => Math.round(value / step) * step;

/* ------------------------------------------------------------------ time --- */

/** Local midnight of `date` (YYYY-MM-DD) on the Yerevan clock, as a UTC instant. */
const localMidnight = (date) => Date.parse(`${date}T00:00:00.000Z`) - ZONE_OFFSET_MS;
const iso = (ms) => new Date(ms).toISOString();
const birthMs = Date.parse(`${BIRTH}T00:00:00.000Z`);
const dayCount = Math.round((Date.parse(`${UNTIL}T00:00:00.000Z`) - birthMs) / MS_DAY) + 1;
const calendarDate = (day) => new Date(birthMs + day * MS_DAY).toISOString().slice(0, 10);
/** Hour of the local day, 0–24, for a UTC instant. */
const localHour = (ms) => ((((ms + ZONE_OFFSET_MS) % MS_DAY) + MS_DAY) % MS_DAY) / MS_HOUR;

/* ---------------------------------------------------------------- babies --- */

const GESTATIONAL_AGE = { weeks: 36, days: 2 };
const PRETERM_BY_DAYS = who.TERM_GESTATION_DAYS - who.gestationalAgeInDays(GESTATIONAL_AGE); // 26

const BABIES = [
  {
    id: 'boy',
    name: 'Aram',
    gender: 'MALE',
    // z-scores against WHO at corrected age: start → end of the period (catch-up).
    z: { weight: [-0.4, 0.05], length: [-0.5, -0.1], headCircumference: [-0.3, 0.1] },
    nightFeedsUntilDay: 120,
  },
  {
    id: 'girl',
    name: 'Ani',
    gender: 'FEMALE',
    z: { weight: [-0.75, -0.35], length: [-0.8, -0.45], headCircumference: [-0.6, -0.3] },
    nightFeedsUntilDay: 165,
  },
];

/** Daily intra-uterine-like growth used before term-equivalent age, in kg / cm. */
const PRETERM_RATE = { weight: 0.028, length: 0.11, headCircumference: 0.07 };

/**
 * A baby's smooth size on `day`, in WHO units (kg, cm). Read from the WHO
 * curve at corrected age with an easing z-score; before term-equivalent age
 * (corrected age < 0) it runs back from the corrected-day-0 value.
 */
function sizeOn(baby, indicator, day) {
  const progress = Math.min(1, day / 180);
  const eased = 1 - (1 - progress) ** 2;
  const [z0, z1] = baby.z[indicator];
  const z = z0 + (z1 - z0) * eased;
  const corrected = day - PRETERM_BY_DAYS;
  const lms = who.whoLmsAt(indicator, baby.gender, Math.max(0, corrected));
  let value = who.valueAtZ(lms, z);
  if (corrected < 0) value -= -corrected * PRETERM_RATE[indicator];
  if (indicator === 'weight') {
    // The physiological dip: about 7 % by day 3, regained by two weeks.
    const dip = day <= 3 ? 0.07 * (day / 3) : day <= 14 ? 0.07 * (1 - (day - 3) / 11) : 0;
    value *= 1 - dip;
  }
  return value;
}

/* ---------------------------------------------------------------- events --- */

const events = [];
const measurements = [];
let groupCounter = 0;
const nextGroupId = () => `test-group-${String(++groupCounter).padStart(5, '0')}`;

/** Whole minutes, as a parent would enter them. */
const toMinute = (isoString) => iso(Math.round(Date.parse(isoString) / MS_MIN) * MS_MIN);

function addEvent(babyId, rawFields, createdDelayMin = between(1, 6)) {
  const fields = {
    ...rawFields,
    startedAt: toMinute(rawFields.startedAt),
    ...(rawFields.endedAt ? { endedAt: toMinute(rawFields.endedAt) } : {}),
  };
  const lastInstant = Date.parse(fields.endedAt ?? fields.startedAt);
  if (Date.parse(fields.startedAt) > NOW || lastInstant > NOW) return;
  const createdAt = iso(lastInstant + Math.round(createdDelayMin * 60) * 1000);
  events.push({ babyId, ...fields, createdAt, updatedAt: createdAt });
}

/** Hours between feeds, falling with age. */
const feedInterval = (day) => (day < 30 ? 3 : day < 75 ? 3.4 : day < 130 ? 3.8 : 4.2);
/** Minutes a baby can comfortably stay awake, rising with age. */
const awakeWindow = (day) => 50 + day * 0.55;

const NOTES = [
  'Tummy time 10 minutes',
  'Walk in the park',
  'Fussy in the evening',
  'Visit from grandma',
  'Long cuddle after waking',
  'Played on the mat',
  'Hiccups after feeding',
  'Slept in the stroller outside',
  'Bath was a big success',
  'Smiled at the mobile',
];

const MILESTONES = [
  [42, 'boy', 'First real smile'],
  [47, 'girl', 'First real smile'],
  [95, 'boy', 'Rolled from tummy to back'],
  [110, 'girl', 'Laughed out loud'],
  [118, 'boy', 'Laughed out loud'],
  [131, 'girl', 'Rolled from tummy to back'],
  [165, 'boy', 'Sits with support'],
];

function generateBaby(baby) {
  for (let day = 0; day < dayCount; day += 1) {
    const midnight = localMidnight(calendarDate(day));
    const weightKg = sizeOn(baby, 'weight', day);
    const interval = feedInterval(day);
    const hasNightFeeds = day < baby.nightFeedsUntilDay;

    // Feeding times: from early morning through the day, and through the night
    // while night feeds last. Each baby keeps its own slightly shifted rhythm.
    const offset = baby.id === 'boy' ? 0 : 0.4;
    const feeds = [];
    for (let h = 6 + offset + between(-0.4, 0.4); h < 30; h += interval + between(-0.35, 0.35)) {
      const isNight = h >= 24 || h < 5.5;
      if (isNight && !hasNightFeeds && !(h >= 22 && h < 23.5)) continue;
      feeds.push(midnight + h * MS_HOUR);
    }
    const dailyMl = day < 4 ? 25 * (day + 1) * feeds.length : Math.min(150 * weightKg, 1000);
    const perFeed = dailyMl / feeds.length;

    feeds.forEach((startMs, index) => {
      // The 24–30 h tail is tomorrow's small hours. Each day's loop starts at
      // 06:00, so those night feeds are generated here and only here.
      const amount = Math.max(10, roundTo(perFeed * between(0.82, 1.15), 5));
      addEvent(baby.id, {
        type: 'FEEDING',
        startedAt: iso(startMs),
        amount,
        unit: 'ml',
      });

      // Nappy around most feeds; fewer overnight as the baby gets older.
      const nightFeed = localHour(startMs) < 6 || localHour(startMs) >= 23;
      if (chance(nightFeed ? (day < 60 ? 0.6 : 0.25) : day < 60 ? 0.9 : 0.75)) {
        const kind = weighted([
          ['wet', 55],
          ['wet_and_dirty', day < 40 ? 30 : 18],
          ['dirty', day < 40 ? 12 : 8],
          ['dry', 4],
        ]);
        addEvent(baby.id, {
          type: 'DIAPER',
          startedAt: iso(startMs + between(-12, 20) * MS_MIN),
          details: kind,
        });
      }

      // Sleep in the gap before the next feed. At night the baby goes back down
      // quickly; by day only after an awake window that grows with age.
      // After the day's last feed the next one is tomorrow's first, at ~06:00:
      // once night feeds stop, that gap is the long night sleep.
      const next = feeds[index + 1] ?? midnight + MS_DAY + (6 + offset) * MS_HOUR;
      const hour = localHour(startMs);
      const night = hour >= 20 || hour < 6;
      const feedMinutes = between(15, 30);
      const sleepStart =
        startMs +
        (night ? feedMinutes + between(5, 15) : Math.max(feedMinutes, awakeWindow(day))) * MS_MIN;
      const sleepEnd = next - between(3, 15) * MS_MIN;
      if (sleepEnd - sleepStart >= 20 * MS_MIN && (night || chance(0.93))) {
        addEvent(baby.id, {
          type: 'SLEEP',
          startedAt: iso(sleepStart),
          endedAt: iso(sleepEnd),
        });
      }
    });

    if (chance(0.22)) {
      addEvent(baby.id, {
        type: 'NOTE',
        startedAt: iso(midnight + between(10, 19) * MS_HOUR),
        details: pick(NOTES),
      });
    }
  }

  for (const [day, babyId, text] of MILESTONES) {
    if (babyId !== baby.id || day >= dayCount) continue;
    addEvent(baby.id, {
      type: 'NOTE',
      startedAt: iso(localMidnight(calendarDate(day)) + between(11, 17) * MS_HOUR),
      details: text,
    });
  }
}

/** "Both babies" entries: the same event on each twin, sharing a groupId. */
function generateShared() {
  for (let day = 7; day < dayCount; day += 1) {
    const midnight = localMidnight(calendarDate(day));
    if (day % 2 === 0) {
      const groupId = nextGroupId();
      const startedAt = iso(midnight + (19.5 + between(0, 0.75)) * MS_HOUR);
      for (const baby of BABIES)
        addEvent(baby.id, { type: 'NOTE', startedAt, details: 'Bath', groupId }, 3);
    }
    if (day > 14 && chance(0.3)) {
      const groupId = nextGroupId();
      const startedAt = iso(midnight + between(11, 16) * MS_HOUR);
      for (const baby of BABIES)
        addEvent(
          baby.id,
          { type: 'NOTE', startedAt, details: 'Walk outside together', groupId },
          3,
        );
    }
  }
}

/* ---------------------------------------------------------------- growth --- */

const CLINIC_DAYS = [0, 7, 14, 30, 60, 90, 120, 150, 180];
const HOME_DAYS = [3, 21, 45, 75, 105, 135, 165];

function generateGrowth(baby) {
  const noise = (sd) => (random() + random() + random() - 1.5) * sd;
  const visit = (day, source) => {
    if (day >= dayCount) return;
    const measuredOn = calendarDate(day);
    if (localMidnight(measuredOn) > NOW) return;
    const weightGrams = Math.round(sizeOn(baby, 'weight', day) * 1000 + noise(40));
    const row = { babyId: baby.id, measuredOn, weightGrams, source };
    if (source === 'DOCTOR') {
      row.lengthMm = Math.round(sizeOn(baby, 'length', day) * 10 + noise(4));
      row.headCircumferenceMm = Math.round(sizeOn(baby, 'headCircumference', day) * 10 + noise(2));
    }
    if (day === 0) row.note = 'Birth measurements';
    const createdAt = iso(localMidnight(measuredOn) + 14 * MS_HOUR);
    measurements.push({ ...row, createdAt, updatedAt: createdAt });
  };
  CLINIC_DAYS.forEach((day) => visit(day, 'DOCTOR'));
  HOME_DAYS.forEach((day) => visit(day, 'PARENT'));
  measurements.sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
}

/* ------------------------------------------------------------------ main --- */

for (const baby of BABIES) {
  generateBaby(baby);
  generateGrowth(baby);
}
generateShared();
events.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.babyId.localeCompare(b.babyId));

const birthDate = `${BIRTH}T00:00:00.000Z`;
const file = {
  format: shared.FAMILY_DATA_FORMAT,
  version: shared.FAMILY_DATA_VERSION,
  exportedAt: iso(NOW),
  babies: BABIES.map((baby, index) => ({
    id: baby.id,
    name: baby.name,
    birthDate,
    gender: baby.gender,
    gestationalAge: GESTATIONAL_AGE,
    // A millisecond apart, so the boy is listed first, as in the file.
    createdAt: iso(birthMs + index),
    updatedAt: iso(birthMs + index),
  })),
  events,
  measurements: measurements.sort((a, b) => a.measuredOn.localeCompare(b.measuredOn)),
};

// The same schema the API validates with: a file that would be refused is
// never written.
const parsed = shared.familyDataSchema.safeParse(file);
if (!parsed.success) {
  console.error(parsed.error.issues.slice(0, 10));
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(file)}\n`);

const byType = {};
for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
console.log(`Wrote ${OUT}`);
console.log(
  `  babies: ${BABIES.map((b) => `${b.name} (${b.gender})`).join(', ')} — born ${BIRTH} at 36+2`,
);
console.log(`  days: ${dayCount} (${BIRTH} → ${UNTIL})`);
console.log(`  events: ${events.length} ${JSON.stringify(byType)}, grouped pairs: ${groupCounter}`);
console.log(`  measurements: ${measurements.length}`);
