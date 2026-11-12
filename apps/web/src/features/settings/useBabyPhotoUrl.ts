import { useQuery } from '@tanstack/react-query';
import type { Baby } from '@baby-tracker/shared';
import { fetchBabyPhoto } from './api.js';

/**
 * The URL to show a child's stored photo from, or `null` while it loads, when
 * there is none, or when `enabled` is false.
 *
 * The photo endpoint needs the access token, so the image is fetched through
 * the API client and shown from an object URL. The query data is that URL,
 * made once per photo version (the key carries `photoUpdatedAt`): replacing
 * the photo fetches the new one, an unchanged photo is never downloaded twice,
 * and every place that shows the child shares one download.
 *
 * Deliberately not revoked: it is a few tens of kilobytes held for the length
 * of the session, and revoking on unmount would break the picture when React
 * re-runs effects in development or the cache hands the same URL to a
 * remounted component.
 */
export function useBabyPhotoUrl(
  familyId: string | undefined,
  baby: Pick<Baby, 'id' | 'hasPhoto' | 'photoUpdatedAt'>,
  enabled = true,
): string | null {
  const wanted = enabled && familyId !== undefined && baby.hasPhoto === true;
  const photo = useQuery({
    queryKey: ['families', familyId ?? '', 'babies', baby.id, 'photo', baby.photoUpdatedAt ?? ''],
    queryFn: async () => URL.createObjectURL(await fetchBabyPhoto(familyId ?? '', baby.id)),
    enabled: wanted,
    staleTime: Infinity,
    retry: false,
  });
  return wanted ? (photo.data ?? null) : null;
}
