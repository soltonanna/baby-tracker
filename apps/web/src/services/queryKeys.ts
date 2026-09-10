/**
 * Every TanStack Query key in the app is built here, so that invalidation after
 * a mutation is never a guess.
 */
export const queryKeys = {
  health: ['health'] as const,
  families: ['families'] as const,
  babies: (familyId: string) => ['families', familyId, 'babies'] as const,
  /**
   * One baby's events, optionally narrowed to a day.
   *
   * The range is the last segment, so the key without it is still a prefix of
   * every dated one: `invalidateQueries` on `babyEvents(familyId, babyId)`
   * refreshes whichever day is on screen, and a mutation does not have to know
   * which. The two babies keep separate keys either way, so switching twins
   * cannot read the other one's cache.
   */
  babyEvents: (familyId: string, babyId: string, range?: { from: string; to: string }) =>
    range === undefined
      ? (['families', familyId, 'babies', babyId, 'events'] as const)
      : (['families', familyId, 'babies', babyId, 'events', range] as const),
};
