import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../services/queryKeys.js';
import { fetchBabies, fetchFamilies } from './api.js';

/**
 * The caller's (first) family and its babies — the same two queries, with the
 * same keys, that Today runs, so a screen using this reads Today's cache and
 * vice versa. Today keeps its own inline copy; it predates this hook and is
 * not rewritten for it.
 */
export function useFamilyBabies() {
  const familiesQuery = useQuery({ queryKey: queryKeys.families, queryFn: fetchFamilies });
  const familyId = familiesQuery.data?.[0]?.id;
  const babiesQuery = useQuery({
    queryKey: queryKeys.babies(familyId ?? ''),
    queryFn: () => fetchBabies(familyId ?? ''),
    enabled: familyId !== undefined,
  });

  return {
    familyId,
    babies: babiesQuery.data,
    isError: familiesQuery.isError || babiesQuery.isError,
    isPending: familiesQuery.isPending || (familyId !== undefined && babiesQuery.isPending),
  };
}
