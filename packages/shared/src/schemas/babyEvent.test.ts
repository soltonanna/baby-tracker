import { describe, expect, it } from 'vitest';
import {
  babyEventFieldsSchemaFor,
  createBabyEventSchema,
  updateBabyEventSchema,
} from './babyEvent.js';

/**
 * The rules an edit is held to.
 *
 * The endpoints themselves are covered by `events.int.test.ts`, which needs a
 * database; these are the same rules checked as the plain functions they are, so
 * a mistake in them fails in seconds rather than in the integration suite.
 */

const parse = (body: unknown) => updateBabyEventSchema.safeParse(body);

describe('updateBabyEventSchema', () => {
  it('accepts a patch of one field, and leaves the rest absent', () => {
    const result = parse({ amount: 150 });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ amount: 150 });
  });

  it('coerces dates the same way create does', () => {
    const result = parse({ startedAt: '2026-09-04T08:00:00.000Z' });

    expect(result.success).toBe(true);
    expect(result.data?.startedAt?.toISOString()).toBe('2026-09-04T08:00:00.000Z');
  });

  it('inherits every value rule from the create schema', () => {
    for (const body of [
      { startedAt: 'not-a-date' },
      { endedAt: 'not-a-date' },
      { amount: -1 },
      { amount: Number.NaN },
      { amount: 'lots' },
      { unit: 'x'.repeat(17) },
      { unit: '' },
      { details: 'x'.repeat(1001) },
      { type: 'SOMETHING_ELSE' },
    ]) {
      expect(parse(body).success, JSON.stringify(body)).toBe(false);
    }

    expect(parse({ details: 'x'.repeat(1000) }).success).toBe(true);
  });

  it('refuses a patch that would change nothing', () => {
    expect(parse({}).success).toBe(false);
    // A type on its own is an echo of what the event already is, not a change.
    expect(parse({ type: 'NOTE' }).success).toBe(false);
    expect(parse({ type: 'NOTE', details: 'edited' }).success).toBe(true);
  });

  it('drops the fields an edit may not touch, rather than trusting them', () => {
    const result = parse({
      details: 'edited',
      familyId: '68b0000000000000000000aa',
      babyId: '68b0000000000000000000bb',
      groupId: 'action-2',
      id: '68b0000000000000000000cc',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ details: 'edited' });
  });

  it('is the create schema minus groupId, so no rule is defined twice', () => {
    const editable = Object.keys(updateBabyEventSchema.parse({ type: 'NOTE', details: 'x' }));
    expect(editable).not.toContain('groupId');
    // Every field an edit may set is one create knows about.
    const creatable = Object.keys(createBabyEventSchema.shape);
    for (const field of ['type', 'startedAt', 'endedAt', 'amount', 'unit', 'details']) {
      expect(creatable).toContain(field);
    }
  });
});

describe('babyEventFieldsSchemaFor', () => {
  it('holds a DIAPER to the canonical kinds', () => {
    const diaper = babyEventFieldsSchemaFor('DIAPER');

    for (const kind of ['wet', 'dirty', 'wet_and_dirty', 'dry']) {
      expect(diaper.safeParse({ details: kind }).success, kind).toBe(true);
    }
    expect(diaper.safeParse({ details: 'blowout' }).success).toBe(false);
    // A patch that does not touch `details` is not a nappy statement at all.
    expect(diaper.safeParse({ startedAt: new Date() }).success).toBe(true);
  });

  it('leaves the other types’ details as free text', () => {
    for (const type of ['FEEDING', 'SLEEP', 'NOTE'] as const) {
      expect(babyEventFieldsSchemaFor(type).safeParse({ details: 'blowout' }).success, type).toBe(
        true,
      );
    }
  });
});
