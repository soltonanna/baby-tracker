import { describe, expect, it } from 'vitest';
import { LOCALES } from '../constants.js';
import {
  CHECKUP_REFERENCE_PLACEHOLDER,
  IMMUNIZATION_DISCLAIMER,
  IMMUNIZATION_SCHEDULE,
  IMMUNIZATION_SOURCES,
  IMMUNIZATION_VACCINES,
  INTERNATIONAL_REFERENCES,
} from './catalog.js';
import { addAge, compareWithSchedule, type ScheduleRecordRef } from './schedule.js';

const BIRTH = '2026-04-01';
const at = (today: string, records: ScheduleRecordRef[] = [], birthDate = BIRTH) =>
  compareWithSchedule({ birthDate, today, records });
const statusOf = (result: ReturnType<typeof at>, key: string) =>
  result.items.find((r) => r.item.key === key)?.status;
const rec = (scheduleKey: string, occurredOn: string, id = scheduleKey): ScheduleRecordRef => ({
  id,
  occurredOn,
  scheduleKey,
});

describe('catalog integrity', () => {
  it('has unique keys, known vaccines and sources, and valid references between doses', () => {
    const keys = IMMUNIZATION_SCHEDULE.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    const vaccines = new Set(IMMUNIZATION_VACCINES.map((v) => v.id));
    const sources = new Set(IMMUNIZATION_SOURCES.map((s) => s.id));
    for (const item of IMMUNIZATION_SCHEDULE) {
      expect(vaccines.has(item.vaccineId)).toBe(true);
      expect(sources.has(item.sourceId)).toBe(true);
      if (item.minIntervalFrom) expect(keys).toContain(item.minIntervalFrom.key);
      expect(item.dose).toBeLessThanOrEqual(item.totalDoses);
    }
    for (const reference of INTERNATIONAL_REFERENCES) {
      expect(sources.has(reference.sourceId)).toBe(true);
    }
  });

  it('keeps official and international apart', () => {
    expect(IMMUNIZATION_SCHEDULE.every((i) => i.origin === 'official')).toBe(true);
    expect(INTERNATIONAL_REFERENCES.every((r) => r.origin === 'international')).toBe(true);
    const keys = new Set(IMMUNIZATION_SCHEDULE.map((i) => i.key));
    expect(INTERNATIONAL_REFERENCES.some((r) => keys.has(r.id))).toBe(false);
  });

  it('has every explanation in every language, non-empty', () => {
    const texts: Record<string, string>[] = [
      IMMUNIZATION_DISCLAIMER,
      CHECKUP_REFERENCE_PLACEHOLDER,
      ...IMMUNIZATION_VACCINES.flatMap((v) => [
        v.abbreviation,
        v.name,
        v.protectsAgainst,
        v.purpose,
        v.doses,
        ...(v.catchUp ? [v.catchUp] : []),
      ]),
      ...IMMUNIZATION_SOURCES.flatMap((s) => [s.issuer, s.title]),
      ...INTERNATIONAL_REFERENCES.flatMap((r) => [r.name, r.protectsAgainst, r.note]),
    ];
    for (const text of texts) {
      for (const locale of LOCALES) expect(text[locale]?.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps the decree’s own Armenian abbreviations', () => {
    const abbreviations = IMMUNIZATION_VACCINES.map((v) => v.abbreviation.hy);
    expect(abbreviations).toEqual(
      expect.arrayContaining(['ՎՀԲ', 'ԲՑԺ', 'ԱԿԴՓ/ՎՀԲ/ՀԻԲ/ԻՊՊ', 'ՌՈՏԱ', 'ՊՆԵՎՄՈ', 'ԿԿԽ']),
    );
  });
});

describe('addAge', () => {
  it('counts weeks and calendar months from birth, clamping to month end', () => {
    expect(addAge(BIRTH, { weeks: 6 })).toBe('2026-05-13');
    expect(addAge(BIRTH, { months: 12 })).toBe('2027-04-01');
    expect(addAge('2024-01-31', { months: 1 })).toBe('2024-02-29');
    expect(addAge('2024-02-29', { years: 1 })).toBe('2025-02-28');
  });
});

describe('compareWithSchedule', () => {
  it('on the day of birth the birth doses are due and the rest upcoming', () => {
    const result = at(BIRTH);
    expect(statusOf(result, 'hepb-birth')).toBe('due');
    expect(statusOf(result, 'bcg-1')).toBe('due');
    expect(statusOf(result, 'hexa-1')).toBe('upcoming');
    expect(result.next?.item.key).toBe('hepb-birth');
  });

  it('hepatitis B at birth is missed, not overdue, once 24 hours pass; BCG stays catch-up-able to 12 months', () => {
    const result = at('2026-04-05');
    expect(statusOf(result, 'hepb-birth')).toBe('missed');
    expect(statusOf(result, 'bcg-1')).toBe('overdue');
    expect(statusOf(at('2027-04-02'), 'bcg-1')).toBe('missed');
    expect(statusOf(at('2027-04-01'), 'bcg-1')).toBe('overdue');
  });

  it('is due for a window after the recommended date, then overdue', () => {
    expect(statusOf(at('2026-05-12'), 'hexa-1')).toBe('upcoming');
    expect(statusOf(at('2026-05-13'), 'hexa-1')).toBe('due');
    expect(statusOf(at('2026-06-10'), 'hexa-1')).toBe('due');
    expect(statusOf(at('2026-06-11'), 'hexa-1')).toBe('overdue');
  });

  it('applies the rotavirus age limits of the decree', () => {
    expect(statusOf(at('2026-07-15'), 'rota-1')).toBe('overdue'); // 15 weeks exactly
    expect(statusOf(at('2026-07-16'), 'rota-1')).toBe('missed');
    expect(statusOf(at('2026-11-11'), 'rota-2')).toBe('overdue'); // 32 weeks exactly
    expect(statusOf(at('2026-11-12'), 'rota-2')).toBe('missed');
  });

  it('shows the second varicella dose as scheduled from 2027, never overdue before', () => {
    const born = '2022-03-01';
    const before = at('2026-12-31', [], born);
    expect(statusOf(before, 'varicella-2')).toBe('scheduled_later');
    expect(statusOf(before, 'mmr-2')).toBe('due');
    expect(statusOf(at('2027-01-01', [], born), 'varicella-2')).toBe('due');
    expect(before.counts.scheduled_later).toBe(1);
    expect(before.progress.total).toBe(IMMUNIZATION_SCHEDULE.length - 1);
  });

  it('completes an item from a linked record and counts progress', () => {
    const result = at('2026-05-20', [rec('hepb-birth', '2026-04-01'), rec('bcg-1', '2026-04-02')]);
    expect(statusOf(result, 'hepb-birth')).toBe('completed');
    expect(result.progress.completed).toBe(2);
    expect(result.items[0]?.record?.id).toBe('hepb-birth');
  });

  it('uses the earliest record when a dose is entered twice', () => {
    const result = at('2026-06-01', [
      rec('hexa-1', '2026-05-20', 'later'),
      rec('hexa-1', '2026-05-13', 'earlier'),
    ]);
    expect(result.items.find((r) => r.item.key === 'hexa-1')?.record?.id).toBe('earlier');
    expect(result.progress.completed).toBe(1);
  });

  it('completes a dose that was given late', () => {
    expect(statusOf(at('2026-12-01', [rec('hexa-1', '2026-09-01')]), 'hexa-1')).toBe('completed');
  });

  it('reports records whose key is not in the catalog instead of dropping or failing', () => {
    const result = at('2026-06-01', [
      rec('retired-9', '2026-05-01'),
      { id: 'free', occurredOn: '2026-05-01' },
    ]);
    expect(result.unmatched.map((r) => r.id)).toEqual(['retired-9']);
    expect(result.progress.completed).toBe(0);
  });

  it('flags a dose given 5+ days before the minimum age, but not 4', () => {
    const early = (day: string) =>
      at('2026-06-01', [rec('hexa-1', day)]).items.find((r) => r.item.key === 'hexa-1');
    expect(early('2026-05-08')?.givenTooEarly).toBe(true); // 5 days early
    expect(early('2026-05-09')?.givenTooEarly).toBe(false); // 4 days early
    expect(early('2026-05-08')?.status).toBe('completed');
  });

  it('flags a dose given 5+ days inside the 4-week interval, but not 4', () => {
    const second = (day: string) =>
      at('2026-08-01', [rec('hexa-1', '2026-05-13'), rec('hexa-2', day)]).items.find(
        (r) => r.item.key === 'hexa-2',
      );
    expect(second('2026-06-05')?.intervalTooShort).toBe(true); // 23 days after
    expect(second('2026-06-06')?.intervalTooShort).toBe(false); // 24 days after
  });

  it('checks the 6-month gap between the third hexavalent dose and the 18-month dose', () => {
    const result = at('2027-12-01', [rec('hexa-3', '2026-08-05'), rec('dtapipv-1', '2026-12-01')]);
    expect(result.items.find((r) => r.item.key === 'dtapipv-1')?.intervalTooShort).toBe(true);
  });

  it('is unaffected by records of a catalog edition it does not know', () => {
    const records = [rec('hexa-1', '2026-05-13')];
    const custom = compareWithSchedule({
      birthDate: BIRTH,
      today: '2026-06-01',
      records,
      schedule: IMMUNIZATION_SCHEDULE.filter((i) => i.key !== 'hexa-1'),
    });
    expect(custom.unmatched).toHaveLength(1);
    expect(records[0]).toEqual({ id: 'hexa-1', occurredOn: '2026-05-13', scheduleKey: 'hexa-1' });
  });
});
