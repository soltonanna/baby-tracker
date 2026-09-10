/**
 * Who an entry is being recorded for.
 *
 * Deliberately *not* the same question as which baby the screen is showing. The
 * tab strip above the forms is a view filter — it decides whose list is on
 * screen, and it has two options because there are two babies. The target is a
 * property of the entry being written, and it has a third option, "both", which
 * is not a baby and never becomes one: it means "the same entry for each of
 * them", and the server answers it with two ordinary events sharing a `groupId`
 * (decision D2).
 *
 * A union rather than a `string | 'both'`, so that a baby whose id happened to
 * be the word "both" could not be read as the twin action, and so that adding
 * the target to a form is a decision the compiler checks.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { Baby } from '@baby-tracker/shared';
import { queryKeys } from '../../services/queryKeys.js';

export type EventTarget = { kind: 'baby'; babyId: string } | { kind: 'both' };

/** One baby, by id — the default for every form, and the only target an edit has. */
export const babyTarget = (babyId: string): EventTarget => ({ kind: 'baby', babyId });

export const BOTH_BABIES: EventTarget = { kind: 'both' };

/**
 * The babies an entry with this target lands on — which is exactly the set of
 * event lists that has to be refreshed once it is saved.
 *
 * For "both" that is every baby in the family, because that is what the server
 * writes to: it resolves the family's two babies itself rather than being told
 * which. Deriving it here from the same list the target selector was built from
 * keeps the two in step without the form having to read the response.
 */
export function targetBabyIds(target: EventTarget, babies: readonly Baby[]): string[] {
  return target.kind === 'both' ? babies.map((baby) => baby.id) : [target.babyId];
}

/**
 * Refreshes the day on screen for each of those babies.
 *
 * `queryKeys.babyEvents(familyId, babyId)` without a range is a prefix of every
 * dated key, so this refreshes whichever day each list is showing without this
 * function knowing which — the same property the single-baby forms have relied
 * on since day scoping landed.
 *
 * Awaited, so a form can stay in its saving state until the list the parent is
 * about to look at actually holds the new entry. The twin's list is usually not
 * mounted, so its invalidation resolves at once and it refetches the moment the
 * parent switches to it — which is what makes a "both" entry appear there
 * without a reload.
 */
export async function refreshEventsFor(
  queryClient: QueryClient,
  familyId: string,
  babyIds: readonly string[],
): Promise<void> {
  await Promise.all(
    babyIds.map((babyId) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.babyEvents(familyId, babyId) }),
    ),
  );
}
