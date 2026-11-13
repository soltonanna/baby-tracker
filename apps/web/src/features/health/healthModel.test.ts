import { describe, expect, it } from 'vitest';
import { IMMUNIZATION_CATALOG_VERSION, type HealthRecord } from '@baby-tracker/shared';
import {
  buildHealthRecordBody,
  filterRecords,
  initialFormValues,
  instantFrom,
  localDateOf,
  localTimeOf,
  resolveLocale,
  toScheduleRefs,
  type BuildContext,
  type HealthFormValues,
} from './healthModel.js';

const TZ = 'Asia/Yerevan'; // UTC+4, no daylight saving

const record = (overrides: Partial<HealthRecord> = {}): HealthRecord => ({
  id: 'r1',
  familyId: 'f',
  babyId: 'b',
  category: 'vaccination',
  occurredAt: '2026-06-01T06:00:00.000Z',
  name: 'Hepatitis B',
  createdAt: '2026-06-01T07:00:00.000Z',
  updatedAt: '2026-06-01T07:00:00.000Z',
  ...overrides,
});

const values = (overrides: Partial<HealthFormValues> = {}): HealthFormValues => ({
  ...initialFormValues(undefined, { today: '2026-06-10', now: '09:30', timeZone: TZ }),
  name: 'BCG',
  ...overrides,
});

const context = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  timeZone: TZ,
  birthDate: '2026-06-01',
  now: new Date('2026-06-10T12:00:00.000Z'),
  ...overrides,
});

describe('time conversion in the user’s zone', () => {
  it('reads a date and a time on the zone’s clock', () => {
    expect(instantFrom('2026-06-10', '09:30', TZ)).toBe('2026-06-10T05:30:00.000Z');
    expect(instantFrom('2026-06-10', '00:15', TZ)).toBe('2026-06-09T20:15:00.000Z');
  });

  it('refuses what is not a real date or time', () => {
    for (const [date, time] of [
      ['2026-02-30', '09:00'],
      ['10/06/2026', '09:00'],
      ['2026-06-10', '25:00'],
      ['2026-06-10', ''],
    ] as const) {
      expect(instantFrom(date, time, TZ)).toBeNull();
    }
  });

  it('round-trips through the local date and time', () => {
    const iso = '2026-06-10T22:30:00.000Z'; // already 11 June in Yerevan
    expect(localDateOf(iso, TZ)).toBe('2026-06-11');
    expect(localTimeOf(iso, TZ)).toBe('02:30');
    expect(instantFrom(localDateOf(iso, TZ), localTimeOf(iso, TZ), TZ)).toBe(iso);
  });
});

describe('filterRecords', () => {
  const all = [
    record({ id: 'a', category: 'vaccination', occurredAt: '2026-06-02T06:00:00.000Z' }),
    record({ id: 'b', category: 'lab_test', occurredAt: '2026-06-10T21:30:00.000Z' }), // 11 June locally
    record({ id: 'c', category: 'checkup', occurredAt: '2026-06-20T06:00:00.000Z' }),
  ];
  const ids = (found: HealthRecord[]) => found.map((r) => r.id);

  it('filters by category', () => {
    expect(ids(filterRecords(all, { category: 'lab_test', from: '', to: '' }, TZ))).toEqual(['b']);
    expect(ids(filterRecords(all, { category: 'all', from: '', to: '' }, TZ))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('filters by inclusive local calendar days, not UTC days', () => {
    expect(
      ids(filterRecords(all, { category: 'all', from: '2026-06-11', to: '2026-06-11' }, TZ)),
    ).toEqual(['b']);
    expect(ids(filterRecords(all, { category: 'all', from: '2026-06-03', to: '' }, TZ))).toEqual([
      'b',
      'c',
    ]);
    expect(ids(filterRecords(all, { category: 'all', from: '', to: '2026-06-02' }, TZ))).toEqual([
      'a',
    ]);
  });

  it('combines category and dates', () => {
    expect(
      filterRecords(all, { category: 'checkup', from: '2026-06-01', to: '2026-06-10' }, TZ),
    ).toEqual([]);
  });
});

describe('toScheduleRefs', () => {
  it('keeps vaccinations only, as local dates with their schedule key', () => {
    const refs = toScheduleRefs(
      [
        record({ id: 'v', scheduleKey: 'bcg-1', occurredAt: '2026-06-10T21:30:00.000Z' }),
        record({ id: 'c', category: 'checkup' }),
      ],
      TZ,
    );
    expect(refs).toEqual([{ id: 'v', occurredOn: '2026-06-11', scheduleKey: 'bcg-1' }]);
  });
});

describe('buildHealthRecordBody — a new record', () => {
  it('sends only what was filled in', () => {
    const result = buildHealthRecordBody(values({ note: '  fine  ' }), context());
    expect(result).toEqual({
      ok: true,
      body: {
        category: 'vaccination',
        occurredAt: '2026-06-10T05:30:00.000Z',
        name: 'BCG',
        note: 'fine',
      },
    });
  });

  it('keeps the dose exactly as typed (comma allowed) with its unit', () => {
    const result = buildHealthRecordBody(values({ doseValue: '0,05', doseUnit: 'ml' }), context());
    expect(result).toMatchObject({ ok: true, body: { doseValue: 0.05, doseUnit: 'ml' } });
  });

  it('links a vaccination to the schedule and stamps the catalog version it was chosen from', () => {
    const result = buildHealthRecordBody(values({ scheduleKey: 'bcg-1' }), context());
    expect(result).toMatchObject({
      ok: true,
      body: { scheduleKey: 'bcg-1', catalogVersion: IMMUNIZATION_CATALOG_VERSION },
    });
  });

  it('never links anything but a vaccination', () => {
    const result = buildHealthRecordBody(
      values({ category: 'checkup', scheduleKey: 'bcg-1' }),
      context(),
    );
    expect(result).toMatchObject({ ok: true });
    expect((result as { body: object }).body).not.toHaveProperty('scheduleKey');
  });

  it('reports each problem on its field', () => {
    const result = buildHealthRecordBody(
      values({
        name: ' ',
        date: '2026-06-20',
        doseValue: '2',
        doseUnit: '',
        nextDueOn: '2026-05-01',
      }),
      context(),
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'nameRequired',
        date: 'futureDate',
        doseUnit: 'doseUnitRequired',
        nextDueOn: 'nextBeforeDate',
      },
    });
  });

  it('refuses a unit without a value, a non-positive dose and a date before birth', () => {
    expect(buildHealthRecordBody(values({ doseUnit: 'ml' }), context())).toMatchObject({
      ok: false,
      errors: { doseValue: 'doseValueRequired' },
    });
    expect(
      buildHealthRecordBody(values({ doseValue: '0', doseUnit: 'ml' }), context()),
    ).toMatchObject({ ok: false, errors: { doseValue: 'doseInvalid' } });
    expect(
      buildHealthRecordBody(values({ date: '2026-05-01' }), context({ birthDate: '2026-06-01' })),
    ).toMatchObject({ ok: false, errors: { date: 'beforeBirth' } });
  });
});

describe('buildHealthRecordBody — an edit', () => {
  const original = record({ scheduleKey: 'hepb-birth', catalogVersion: '2025.9', note: 'old' });

  it('sends emptied fields as null so they are removed', () => {
    const result = buildHealthRecordBody(
      values({ scheduleKey: 'hepb-birth', note: '' }),
      context({ original }),
    );
    expect(result).toMatchObject({
      ok: true,
      body: { name: 'BCG', note: null, doseValue: null, doseUnit: null, nextDueOn: null },
    });
  });

  it('leaves an unchanged link alone, so the record keeps the catalog version it was made under', () => {
    const result = buildHealthRecordBody(
      values({ scheduleKey: 'hepb-birth' }),
      context({ original }),
    );
    expect((result as { body: object }).body).not.toHaveProperty('scheduleKey');
    expect((result as { body: object }).body).not.toHaveProperty('catalogVersion');
  });

  it('relinks with the current version, and unlinks both fields together', () => {
    expect(
      buildHealthRecordBody(values({ scheduleKey: 'bcg-1' }), context({ original })),
    ).toMatchObject({
      body: { scheduleKey: 'bcg-1', catalogVersion: IMMUNIZATION_CATALOG_VERSION },
    });
    expect(buildHealthRecordBody(values({ scheduleKey: '' }), context({ original }))).toMatchObject(
      { body: { scheduleKey: null, catalogVersion: null } },
    );
  });

  it('unlinks when the category stops being a vaccination', () => {
    const result = buildHealthRecordBody(
      values({ category: 'checkup', scheduleKey: 'hepb-birth' }),
      context({ original }),
    );
    expect(result).toMatchObject({
      body: { category: 'checkup', scheduleKey: null, catalogVersion: null },
    });
  });
});

describe('resolveLocale', () => {
  it('maps regional tags and falls back to English', () => {
    expect(resolveLocale('hy')).toBe('hy');
    expect(resolveLocale('ru-RU')).toBe('ru');
    expect(resolveLocale('fr')).toBe('en');
  });
});
