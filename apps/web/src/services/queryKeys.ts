/**
 * Every TanStack Query key in the app is built here, so that invalidation after
 * a mutation is never a guess.
 */
export const queryKeys = {
  health: ['health'] as const,
};
