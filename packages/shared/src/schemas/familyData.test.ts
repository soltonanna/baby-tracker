import { describe, expect, it } from 'vitest';
import { familyDataSchema } from './familyData.js';

const file = (overrides: Record<string, unknown> = {}) => ({
  format: 'baby-tracker/family-data',
  version: 1,
  babies: [
    { id: 'boy', name: 'Aram', birthDate: '2026-04-01', gender: 'MALE' },
    { id: 'girl', name: 'Ani', gestationalAge: { weeks: 36, days: 2 } },
  ],
  events: [
    { babyId: 'boy', type: 'FEEDING', startedAt: '2026-04-02T08:00:00Z', amount: 60, unit: 'ml' },
    { babyId: 'girl', type: 'NOTE', startedAt: '2026-04-02T08:00:00Z', groupId: 'g1' },
  ],
  measurements: [{ babyId: 'girl', measuredOn: '2026-04-15', weightGrams: 2900 }],
  ...overrides,
});

describe('familyDataSchema', () => {
  it('accepts a well-formed file and turns dates into instants', () => {
    const parsed = familyDataSchema.parse(file());
    expect(parsed.events[0]?.startedAt).toEqual(new Date('2026-04-02T08:00:00Z'));
    expect(parsed.measurements[0]?.measuredOn).toEqual(new Date('2026-04-15T00:00:00.000Z'));
  });

  it('treats missing events and measurements as empty', () => {
    const parsed = familyDataSchema.parse(file({ events: undefined, measurements: undefined }));
    expect(parsed.events).toEqual([]);
    expect(parsed.measurements).toEqual([]);
  });

  it.each([
    ['another format', { format: 'csv' }],
    ['a future version', { version: 2 }],
    [
      'an unknown event type',
      { events: [{ babyId: 'boy', type: 'BATH', startedAt: '2026-04-02T08:00:00Z' }] },
    ],
    [
      'a negative amount',
      {
        events: [{ babyId: 'boy', type: 'FEEDING', startedAt: '2026-04-02T08:00:00Z', amount: -5 }],
      },
    ],
    ['a measurement of nothing', { measurements: [{ babyId: 'boy', measuredOn: '2026-04-15' }] }],
    [
      'a measurement in kilograms',
      { measurements: [{ babyId: 'boy', measuredOn: '2026-04-15', weightGrams: 3.2 }] },
    ],
    [
      'a reference to an unknown baby',
      { measurements: [{ babyId: 'nobody', measuredOn: '2026-04-15', weightGrams: 3200 }] },
    ],
    [
      'duplicate baby ids',
      {
        babies: [
          { id: 'a', name: 'A' },
          { id: 'a', name: 'B' },
        ],
        events: [],
        measurements: [],
      },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(familyDataSchema.safeParse(file(overrides)).success).toBe(false);
  });
});
