/**
 * Domain vocabularies shared by the API and the web app.
 *
 * These are plain `as const` tuples rather than TypeScript enums so that the
 * same value can be used at runtime (Zod schemas, form option lists) and at
 * type level, without a separate mapping.
 */

export const LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Roles inside a family.
 *
 * Deliberately only two for now. `ARCHITECTURE_PROPOSAL.md` §5.3 sketched
 * owner/parent/caregiver, but caregiver access is a Phase 6 concern and an
 * unused role is a permission nobody has thought through. Widening this tuple
 * later is additive; the authorization middleware reads from it, so nothing
 * hard-codes a role string.
 */
export const FAMILY_ROLES = ['OWNER', 'MEMBER'] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];

/**
 * Optional on a baby: the product never requires it, and a family that would
 * rather not record it should not have to.
 */
export const BABY_GENDERS = ['MALE', 'FEMALE'] as const;
export type BabyGender = (typeof BABY_GENDERS)[number];

/**
 * Event types. Adding a new one means adding a member here, a variant to the
 * event `data` union, and a form component — nothing else (spec §8, §28).
 */
export const EVENT_TYPES = [
  'feeding',
  'sleep',
  'diaper',
  'bath',
  'temperature',
  'medication',
  'pumping',
  'note',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const FEEDING_METHODS = ['breast', 'bottle'] as const;
export type FeedingMethod = (typeof FEEDING_METHODS)[number];

export const BREAST_SIDES = ['left', 'right', 'both'] as const;
export type BreastSide = (typeof BREAST_SIDES)[number];

export const BOTTLE_CONTENTS = ['breast_milk', 'formula', 'other'] as const;
export type BottleContent = (typeof BOTTLE_CONTENTS)[number];

export const SLEEP_PERIODS = ['day', 'night'] as const;
export type SleepPeriod = (typeof SLEEP_PERIODS)[number];

export const DIAPER_KINDS = ['wet', 'dirty', 'wet_and_dirty', 'dry'] as const;
export type DiaperKind = (typeof DIAPER_KINDS)[number];

export const MEDICAL_SPECIALTIES = [
  'pediatrician',
  'neurologist',
  'orthopedist',
  'ophthalmologist',
  'dentist',
  'other',
] as const;
export type MedicalSpecialty = (typeof MEDICAL_SPECIALTIES)[number];

/** Display units. Storage is always canonical (decision D3). */
export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const LENGTH_UNITS = ['cm', 'in'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const VOLUME_UNITS = ['ml', 'oz'] as const;
export type VolumeUnit = (typeof VOLUME_UNITS)[number];

export interface UnitPreferences {
  weight: WeightUnit;
  length: LengthUnit;
  volume: VolumeUnit;
}

export const DEFAULT_UNITS: UnitPreferences = { weight: 'kg', length: 'cm', volume: 'ml' };
export const DEFAULT_LOCALE: Locale = 'ru';
export const DEFAULT_TIME_ZONE = 'Asia/Yerevan';
