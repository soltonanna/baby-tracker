import { describe, expect, it } from 'vitest';
import { encodeEventCursor, parseEventCursor } from './eventCursor.js';

const ID = '65f0c0ffee0000000000abcd';

describe('event cursor', () => {
  it('round-trips an event into a cursor and back', () => {
    const cursor = encodeEventCursor({ startedAt: '2026-11-10T08:00:00.000Z', id: ID });
    expect(cursor).toBe(`2026-11-10T08:00:00.000Z_${ID}`);
    expect(parseEventCursor(cursor)).toEqual({
      startedAt: new Date('2026-11-10T08:00:00.000Z'),
      id: ID,
    });
  });

  it('accepts a bare instant, with no tie-breaker, for a date jump', () => {
    expect(parseEventCursor('2026-11-10T20:00:00.000Z')).toEqual({
      startedAt: new Date('2026-11-10T20:00:00.000Z'),
    });
    expect(parseEventCursor('2026-11-10T20:00:00+04:00')?.startedAt.toISOString()).toBe(
      '2026-11-10T16:00:00.000Z',
    );
  });

  it.each([
    '',
    'yesterday',
    '2026-11-10',
    `2026-11-10T08:00:00.000Z_`,
    `2026-11-10T08:00:00.000Z_not-an-id`,
    `2026-11-10T08:00:00.000Z_${ID.toUpperCase()}`,
    `2026-13-40T08:00:00.000Z_${ID}`,
    `_${ID}`,
  ])('refuses %j', (value) => {
    expect(parseEventCursor(value)).toBeNull();
  });
});
