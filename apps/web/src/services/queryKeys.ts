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
  /**
   * The family timeline: every baby's events, cursor-paginated.
   *
   * The filters are the last segment, so `familyEvents(familyId)` is a prefix of
   * every filtered list and one invalidation refreshes whichever filters are on
   * screen — the same property `babyEvents` has for a day.
   */
  familyEvents: (familyId: string, filters?: object) =>
    filters === undefined
      ? (['families', familyId, 'events'] as const)
      : (['families', familyId, 'events', filters] as const),
  /** One baby's growth measurements — the whole series, never by day. */
  growth: (familyId: string, babyId: string) =>
    ['families', familyId, 'babies', babyId, 'growth'] as const,
  /** One baby's health records — the whole history; filters are applied in the browser. */
  healthRecords: (familyId: string, babyId: string) =>
    ['families', familyId, 'babies', babyId, 'health'] as const,
};
