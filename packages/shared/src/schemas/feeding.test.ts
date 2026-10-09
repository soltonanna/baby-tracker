import { describe, expect, it } from 'vitest';
import {
  createBabyEventSchema,
  createBothBabiesEventSchema,
  eventRuleIssues,
  updateBabyEventSchema,
} from './babyEvent.js';
import { familyDataEventSchema } from './familyData.js';

/**
 * Feeding kinds: breast, expressed breast milk, formula.
 *
 * The rules that matter most are the ones that keep a volume total honest — a
 * breastfeed never carries an amount, a bottle always does — and the ones that
 * keep old data valid.
 */

const at = '2026-10-09T08:00:00.000Z';

describe('feeding on create', () => {
  it('accepts a breastfeed with a side and an optional end, and no amount', () => {
    const result = createBabyEventSchema.safeParse({
      type: 'FEEDING',
      startedAt: at,
      endedAt: '2026-10-09T08:20:00.000Z',
      feeding: { kind: 'breast', side: 'left' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.feeding).toEqual({ kind: 'breast', side: 'left' });

    expect(
      createBabyEventSchema.safeParse({
        type: 'FEEDING',
        startedAt: at,
        feeding: { kind: 'breast' },
      }).success,
    ).toBe(true);
  });

  it('refuses a volume on a breastfeed', () => {
    const result = createBabyEventSchema.safeParse({
      type: 'FEEDING',
      startedAt: at,
      amount: 100,
      unit: 'ml',
      feeding: { kind: 'breast' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['feeding']);
  });

  it('requires a volume on a bottle of expressed milk or formula', () => {
    for (const kind of ['expressed_milk', 'formula'] as const) {
      expect(
        createBabyEventSchema.safeParse({ type: 'FEEDING', startedAt: at, feeding: { kind } })
          .success,
        kind,
      ).toBe(false);
      expect(
        createBabyEventSchema.safeParse({
          type: 'FEEDING',
          startedAt: at,
          amount: 90,
          unit: 'ml',
          feeding: { kind },
        }).success,
        kind,
      ).toBe(true);
    }
  });

  it('strips a side from a bottle rather than storing it', () => {
    const result = createBabyEventSchema.safeParse({
      type: 'FEEDING',
      startedAt: at,
      amount: 90,
      feeding: { kind: 'formula', side: 'left' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.feeding).toEqual({ kind: 'formula' });
  });

  it('refuses an unknown kind or side', () => {
    expect(
      createBabyEventSchema.safeParse({
        type: 'FEEDING',
        startedAt: at,
        amount: 90,
        feeding: { kind: 'juice' },
      }).success,
    ).toBe(false);
    expect(
      createBabyEventSchema.safeParse({
        type: 'FEEDING',
        startedAt: at,
        feeding: { kind: 'breast', side: 'middle' },
      }).success,
    ).toBe(false);
  });

  it('refuses feeding data on anything that is not a feeding', () => {
    expect(
      createBabyEventSchema.safeParse({
        type: 'SLEEP',
        startedAt: at,
        feeding: { kind: 'breast' },
      }).success,
    ).toBe(false);
  });

  it('keeps a feeding without a kind valid, as every older feeding is', () => {
    expect(
      createBabyEventSchema.safeParse({ type: 'FEEDING', startedAt: at, amount: 120, unit: 'ml' })
        .success,
    ).toBe(true);
  });

  it('holds the both-babies body and an imported row to the same rules', () => {
    const bad = { type: 'FEEDING', startedAt: at, amount: 50, feeding: { kind: 'breast' } };
    expect(createBothBabiesEventSchema.safeParse(bad).success).toBe(false);
    expect(familyDataEventSchema.safeParse({ ...bad, babyId: 'boy' }).success).toBe(false);
    expect(
      familyDataEventSchema.safeParse({
        type: 'FEEDING',
        startedAt: at,
        babyId: 'boy',
        feeding: { kind: 'breast', side: 'right' },
      }).success,
    ).toBe(true);
  });
});

describe('feeding on edit', () => {
  it('accepts null to clear an end time, an amount or a unit', () => {
    const result = updateBabyEventSchema.safeParse({
      endedAt: null,
      amount: null,
      unit: null,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ endedAt: null, amount: null, unit: null });
  });

  it('never reads null as the epoch', () => {
    const result = updateBabyEventSchema.safeParse({ endedAt: null });
    expect(result.data?.endedAt).toBeNull();
  });

  it('accepts a change of kind', () => {
    expect(
      updateBabyEventSchema.safeParse({ feeding: { kind: 'breast', side: 'both' } }).success,
    ).toBe(true);
  });
});

describe('eventRuleIssues', () => {
  it('reads a cleared amount as no amount', () => {
    expect(eventRuleIssues({ type: 'FEEDING', amount: null, feeding: { kind: 'breast' } })).toEqual(
      [],
    );
    expect(
      eventRuleIssues({ type: 'FEEDING', amount: null, feeding: { kind: 'formula' } }),
    ).toHaveLength(1);
  });
});
