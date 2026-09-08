/**
 * Every TanStack Query key in the app is built here, so that invalidation after
 * a mutation is never a guess.
 */
export const queryKeys = {
  health: ['health'] as const,
  families: ['families'] as const,
  babies: (familyId: string) => ['families', familyId, 'babies'] as const,
  babyEvents: (familyId: string, babyId: string) =>
    ['families', familyId, 'babies', babyId, 'events'] as const,
};
