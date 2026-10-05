import { describe, expect, it } from 'vitest';
import { babyTones } from './babyTone.js';

describe('babyTones', () => {
  it('shows a boy in blue and a girl in pink', () => {
    const tones = babyTones([
      { id: 'a', gender: 'MALE' },
      { id: 'b', gender: 'FEMALE' },
    ]);
    expect(tones.get('a')).toBe('boy');
    expect(tones.get('b')).toBe('girl');
  });

  it('keeps two twins without a gender apart', () => {
    const tones = babyTones([{ id: 'a' }, { id: 'b' }]);
    expect(tones.get('a')).toBe('mint');
    expect(tones.get('b')).toBe('peach');
  });

  it('counts only unspecified babies when choosing a neutral tone', () => {
    const tones = babyTones([{ id: 'a', gender: 'FEMALE' }, { id: 'b' }]);
    expect(tones.get('b')).toBe('mint');
  });
});
