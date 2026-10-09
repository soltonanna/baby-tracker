import { describe, expect, it } from 'vitest';
import { timePlusMinutes } from './eventTime.js';

describe('timePlusMinutes', () => {
  it('moves a wall-clock time on by whole minutes', () => {
    expect(timePlusMinutes('10:00', 15)).toBe('10:15');
    expect(timePlusMinutes('09:55', 10)).toBe('10:05');
  });

  it('wraps past midnight, leaving the next-day reading to endedAtFrom', () => {
    expect(timePlusMinutes('23:50', 20)).toBe('00:10');
  });

  it('answers null for something that is not a time', () => {
    expect(timePlusMinutes('', 5)).toBeNull();
    expect(timePlusMinutes('soon', 5)).toBeNull();
  });
});
