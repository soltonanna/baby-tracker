import { describe, expect, it } from 'vitest';
import { createBabySchema, updateBabySchema } from './baby.js';
import { familyDataSchema, FAMILY_DATA_FORMAT, FAMILY_DATA_VERSION } from './familyData.js';

describe('createBabySchema profile fields', () => {
  it('needs only a name', () => {
    expect(createBabySchema.safeParse({ name: 'Mia' }).success).toBe(true);
  });

  it('accepts a full profile', () => {
    const parsed = createBabySchema.parse({
      name: ' Mia ',
      lastName: 'Sultanova',
      birthTime: '07:45',
      birthWeightGrams: 3400,
      birthLengthMm: 510,
      notes: ' healthy ',
    });
    expect(parsed.name).toBe('Mia');
    expect(parsed.notes).toBe('healthy');
  });

  it.each([
    { birthTime: '24:00' },
    { birthTime: '7:45' },
    { birthWeightGrams: 34 },
    { birthWeightGrams: 3400.5 },
    { birthLengthMm: 5 },
    { notes: 'x'.repeat(2001) },
    { lastName: '   ' },
  ])('rejects %o', (extra) => {
    expect(createBabySchema.safeParse({ name: 'Mia', ...extra }).success).toBe(false);
  });
});

describe('updateBabySchema profile fields', () => {
  it('lets every optional fact be cleared with null', () => {
    const patch = {
      lastName: null,
      birthTime: null,
      birthWeightGrams: null,
      birthLengthMm: null,
      notes: null,
    };
    expect(updateBabySchema.parse(patch)).toEqual(patch);
  });
});

describe('family data file', () => {
  const file = (baby: object) => ({
    format: FAMILY_DATA_FORMAT,
    version: FAMILY_DATA_VERSION,
    babies: [{ id: 'a', name: 'Mia', ...baby }],
  });

  it('still accepts a baby without any profile field', () => {
    expect(familyDataSchema.safeParse(file({})).success).toBe(true);
  });

  it('accepts profile fields and a photo', () => {
    const result = familyDataSchema.safeParse(
      file({
        lastName: 'S',
        birthWeightGrams: 3000,
        photo: { contentType: 'image/jpeg', data: '/9j/AAAA' },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a photo that is not an allowed image type or not base64', () => {
    expect(
      familyDataSchema.safeParse(file({ photo: { contentType: 'image/svg+xml', data: 'AAAA' } }))
        .success,
    ).toBe(false);
    expect(
      familyDataSchema.safeParse(file({ photo: { contentType: 'image/png', data: 'not base64!' } }))
        .success,
    ).toBe(false);
  });
});
