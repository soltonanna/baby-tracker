import { describe, expect, it } from 'vitest';
import {
  createHealthRecordSchema,
  healthRecordRuleIssues,
  listHealthRecordsQuerySchema,
  updateHealthRecordSchema,
} from './health.js';

const base = {
  category: 'vaccination',
  occurredAt: '2026-05-13T08:30:00.000Z',
  name: 'Hexavalent, dose 1',
} as const;

describe('createHealthRecordSchema', () => {
  it('accepts the minimum: category, instant and name', () => {
    const parsed = createHealthRecordSchema.parse(base);
    expect(parsed.occurredAt.toISOString()).toBe('2026-05-13T08:30:00.000Z');
  });

  it('accepts a full vaccination and stores the follow-up as UTC midnight', () => {
    const parsed = createHealthRecordSchema.parse({
      ...base,
      purpose: 'Protection against six diseases',
      doseValue: 0.5,
      doseUnit: 'ml',
      productName: 'Product',
      manufacturer: 'Maker',
      provider: 'Clinic 5, Dr. A.',
      nextDueOn: '2026-06-24',
      scheduleKey: 'hexa-1',
      catalogVersion: '2026.1',
    });
    expect(parsed.nextDueOn?.toISOString()).toBe('2026-06-24T00:00:00.000Z');
  });

  it('requires a name and rejects an unknown category or a bad instant', () => {
    expect(createHealthRecordSchema.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(createHealthRecordSchema.safeParse({ ...base, category: 'surgery' }).success).toBe(
      false,
    );
    expect(createHealthRecordSchema.safeParse({ ...base, occurredAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('needs a dose value and unit together, and a positive value', () => {
    expect(createHealthRecordSchema.safeParse({ ...base, doseValue: 5 }).success).toBe(false);
    expect(createHealthRecordSchema.safeParse({ ...base, doseUnit: 'ml' }).success).toBe(false);
    expect(
      createHealthRecordSchema.safeParse({ ...base, doseValue: 0, doseUnit: 'ml' }).success,
    ).toBe(false);
    expect(
      createHealthRecordSchema.safeParse({ ...base, doseValue: 5, doseUnit: 'cups' }).success,
    ).toBe(false);
  });

  it('keeps the schedule link to vaccinations, with a well-formed key', () => {
    expect(
      createHealthRecordSchema.safeParse({ ...base, category: 'checkup', scheduleKey: 'hexa-1' })
        .success,
    ).toBe(false);
    expect(createHealthRecordSchema.safeParse({ ...base, scheduleKey: 'Hexa 1!' }).success).toBe(
      false,
    );
    expect(createHealthRecordSchema.safeParse({ ...base, catalogVersion: '2026.1' }).success).toBe(
      false,
    );
  });

  it('does not check the key against the current catalog, so old records stay valid', () => {
    expect(
      createHealthRecordSchema.safeParse({
        ...base,
        scheduleKey: 'retired-dose-9',
        catalogVersion: '2019.0',
      }).success,
    ).toBe(true);
  });

  it('refuses a follow-up before the record, allowing a day of slack', () => {
    expect(createHealthRecordSchema.safeParse({ ...base, nextDueOn: '2026-05-01' }).success).toBe(
      false,
    );
    expect(createHealthRecordSchema.safeParse({ ...base, nextDueOn: '2026-05-13' }).success).toBe(
      true,
    );
  });

  it('bounds free text', () => {
    expect(createHealthRecordSchema.safeParse({ ...base, name: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(createHealthRecordSchema.safeParse({ ...base, note: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });
});

describe('updateHealthRecordSchema', () => {
  it('allows removing a field with null and rejects an empty patch', () => {
    expect(updateHealthRecordSchema.safeParse({ note: null, doseValue: null }).success).toBe(true);
    expect(updateHealthRecordSchema.safeParse({}).success).toBe(false);
    expect(updateHealthRecordSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('healthRecordRuleIssues', () => {
  it('judges a patched record as it would be, so a null clears a dose pair together', () => {
    expect(healthRecordRuleIssues({ doseValue: null, doseUnit: null })).toEqual([]);
    expect(healthRecordRuleIssues({ doseValue: 2, doseUnit: null })).toHaveLength(1);
  });
});

describe('listHealthRecordsQuerySchema', () => {
  it('parses optional filters and rejects an inverted range', () => {
    const parsed = listHealthRecordsQuerySchema.parse({
      category: 'lab_test',
      from: '2026-01-01',
      to: '2026-06-30',
    });
    expect(parsed.category).toBe('lab_test');
    expect(listHealthRecordsQuerySchema.parse({})).toEqual({});
    expect(
      listHealthRecordsQuerySchema.safeParse({ from: '2026-07-01', to: '2026-06-30' }).success,
    ).toBe(false);
  });
});
