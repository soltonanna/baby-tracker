import { describe, expect, it } from 'vitest';
import {
  countDiapers,
  dayPeriodOfHour,
  feedingIntervals,
  summariseFeedingDay,
  type SummaryEvent,
} from './feedingSummary.js';
import { localDayRange } from './time.js';

const ZONE = 'Asia/Yerevan'; // UTC+4, no daylight saving
const { start: dayStart, end: dayEnd } = localDayRange('2026-10-09', ZONE);

/** A Yerevan wall-clock time on 2026-10-09, as an ISO instant. */
const local = (hhmm: string): string => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return new Date(dayStart.getTime() + ((hours ?? 0) * 60 + (minutes ?? 0)) * 60_000).toISOString();
};

const breast = (start: string, end?: string): SummaryEvent => ({
  type: 'FEEDING',
  startedAt: local(start),
  ...(end === undefined ? {} : { endedAt: local(end) }),
  feeding: { kind: 'breast', side: 'left' },
});

const bottle = (start: string, kind: 'expressed_milk' | 'formula', ml: number): SummaryEvent => ({
  type: 'FEEDING',
  startedAt: local(start),
  amount: ml,
  feeding: { kind },
});

const summarise = (events: SummaryEvent[], extra: { previous?: string; now?: string } = {}) =>
  summariseFeedingDay({
    events,
    dayStart,
    dayEnd,
    timeZone: ZONE,
    previousFeedingAt: extra.previous,
    now: new Date(extra.now ?? local('23:00')),
  });

describe('summariseFeedingDay', () => {
  it('describes an empty day without inventing anything', () => {
    const summary = summarise([]);
    expect(summary.count).toBe(0);
    expect(summary.volumeMl.total).toBe(0);
    expect(summary.measuredFeedings).toBe(0);
    expect(summary.intervals).toBeNull();
    expect(summary.minutesSinceLast).toBeNull();
    expect(summary.marks).toEqual([]);
  });

  it('counts feedings by kind, in any input order, and ignores other events', () => {
    const summary = summarise([
      bottle('12:00', 'formula', 90),
      breast('03:00', '03:20'),
      { type: 'SLEEP', startedAt: local('04:00') },
      bottle('07:00', 'expressed_milk', 60),
      breast('19:30'),
    ]);
    expect(summary.count).toBe(4);
    expect(summary.byKind).toEqual({ breast: 2, expressed_milk: 1, formula: 1, unspecified: 0 });
    expect(summary.marks.map((mark) => mark.kind)).toEqual([
      'breast',
      'expressed_milk',
      'formula',
      'breast',
    ]);
  });

  it('adds up only measured bottle volume, never anything for a breastfeed', () => {
    const summary = summarise([
      breast('03:00', '03:20'),
      bottle('07:00', 'expressed_milk', 60),
      bottle('12:00', 'formula', 90),
      // A stored oddity must still not become volume.
      { ...breast('15:00'), amount: 500 },
    ]);
    expect(summary.volumeMl).toEqual({
      expressed_milk: 60,
      formula: 90,
      unspecified: 0,
      total: 150,
    });
    expect(summary.measuredFeedings).toBe(2);
  });

  it('treats an older feeding with no kind as a measured bottle', () => {
    const summary = summarise([{ type: 'FEEDING', startedAt: local('09:00'), amount: 110 }]);
    expect(summary.byKind.unspecified).toBe(1);
    expect(summary.volumeMl.unspecified).toBe(110);
    expect(summary.volumeMl.total).toBe(110);
  });

  it('totals breastfeeding time only from feeds whose end was recorded', () => {
    const summary = summarise([
      breast('03:00', '03:20'),
      breast('06:00', '06:15'),
      breast('09:00'),
    ]);
    expect(summary.breastMinutes).toBe(35);
    expect(summary.breastFeedsWithDuration).toBe(2);
    expect(summary.byKind.breast).toBe(3);
  });

  it('measures intervals start to start', () => {
    const summary = summarise([breast('03:00'), breast('06:00'), breast('08:30')]);
    expect(summary.intervals).toEqual({
      minutes: [180, 150],
      averageMinutes: 165,
      shortestMinutes: 150,
      longestMinutes: 180,
    });
  });

  it('measures the first interval from the previous day’s last feeding', () => {
    const previous = new Date(dayStart.getTime() - 75 * 60_000).toISOString(); // 22:45 yesterday
    const summary = summarise([breast('01:30'), breast('04:30')], { previous });
    expect(summary.intervals?.minutes).toEqual([165, 180]);
  });

  it('ignores a "previous" feeding that is not actually earlier', () => {
    const summary = summarise([breast('01:30'), breast('04:30')], { previous: local('02:00') });
    expect(summary.intervals?.minutes).toEqual([180]);
  });

  it('reports the time since the last feeding, or since yesterday’s', () => {
    expect(summarise([breast('20:15')], { now: local('22:00') }).minutesSinceLast).toBe(105);
    const previous = new Date(dayStart.getTime() - 60 * 60_000).toISOString();
    expect(summarise([], { previous, now: local('00:30') }).minutesSinceLast).toBe(90);
  });

  it('spreads feedings over the four parts of the local day', () => {
    const summary = summarise([
      breast('00:00'),
      breast('05:59'),
      breast('06:00'),
      breast('12:00'),
      breast('18:00'),
      breast('23:59'),
    ]);
    expect(summary.byPeriod).toEqual({ night: 2, morning: 1, afternoon: 1, evening: 2 });
    expect(summary.marks[0]?.position).toBe(0);
    expect(summary.marks[3]?.position).toBeCloseTo(0.5);
    expect(summary.marks[5]?.position).toBeLessThan(1);
  });
});

describe('feedingIntervals', () => {
  it('needs two feedings to have an interval', () => {
    expect(feedingIntervals([])).toBeNull();
    expect(feedingIntervals([0])).toBeNull();
  });
});

describe('dayPeriodOfHour', () => {
  it('has fixed six-hour boundaries', () => {
    expect([0, 5, 6, 11, 12, 17, 18, 23].map(dayPeriodOfHour)).toEqual([
      'night',
      'night',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
    ]);
  });
});

describe('countDiapers', () => {
  it('counts a wet-and-dirty nappy towards both, and a dry one towards neither', () => {
    const diaper = (details: string): SummaryEvent => ({
      type: 'DIAPER',
      startedAt: local('10:00'),
      details,
    });
    expect(
      countDiapers([
        diaper('wet'),
        diaper('wet'),
        diaper('dirty'),
        diaper('wet_and_dirty'),
        diaper('dry'),
        diaper('something else'),
        breast('09:00'),
      ]),
    ).toEqual({ total: 6, wet: 3, dirty: 2 });
  });
});
