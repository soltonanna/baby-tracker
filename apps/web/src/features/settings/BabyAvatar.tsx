import type { Baby } from '@baby-tracker/shared';
import { useBabyPhotoUrl } from './useBabyPhotoUrl.js';

/**
 * A child's round picture: their stored photo if they have one, otherwise
 * their initial on their colour. Used on the Settings screen.
 *
 * The photo endpoint needs the access token, so the image is fetched through
 * the API client and shown from an object URL. The query key carries
 * `photoUpdatedAt`, so replacing the photo fetches the new one and an
 * unchanged photo is never downloaded twice.
 */

const SIZES = { sm: 'h-12 w-12 text-lg', lg: 'h-24 w-24 text-4xl' } as const;

export interface BabyAvatarProps {
  familyId: string;
  baby: Pick<Baby, 'id' | 'name' | 'hasPhoto' | 'photoUpdatedAt'>;
  size?: keyof typeof SIZES;
  /** A not-yet-saved picture to show instead (the form's preview). */
  previewUrl?: string | null;
  /** `null` shows the initial even if a photo is stored (a pending removal). */
  hidePhoto?: boolean;
}

export function BabyAvatar({
  familyId,
  baby,
  size = 'sm',
  previewUrl = null,
  hidePhoto = false,
}: BabyAvatarProps) {
  const stored = useBabyPhotoUrl(familyId, baby, previewUrl === null && !hidePhoto);
  const src = previewUrl ?? stored;

  return (
    <span
      className={[
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'border-2 border-tone-line bg-tone-soft font-semibold text-tone-ink',
        SIZES[size],
      ].join(' ')}
    >
      {src === null ? (
        <span aria-hidden="true">{Array.from(baby.name.trim())[0]?.toUpperCase() ?? '?'}</span>
      ) : (
        <img src={src} alt="" className="h-full w-full object-cover" />
      )}
    </span>
  );
}
