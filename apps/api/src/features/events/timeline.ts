import { Types, type QueryFilter } from 'mongoose';
import {
  encodeEventCursor,
  type FamilyEventListResponse,
  type ListFamilyEventsQuery,
} from '@baby-tracker/shared';
import { Baby } from '../../models/Baby.js';
import { BabyEvent, type BabyEventAttributes } from '../../models/BabyEvent.js';
import { notFound } from '../../lib/httpError.js';
import type { FamilyScope } from '../../middleware/familyAccess.js';
import { toBabyEvent } from './mappers.js';

/**
 * The family timeline: every baby's events, newest first, a page at a time.
 *
 * **Order.** `startedAt` descending, then `_id` descending. `startedAt` alone
 * ties all the time — a both-babies entry writes two events at the same instant
 * — so the id makes the order total, and the cursor names both.
 *
 * **Twin pairs.** The two events of one both-babies action share a `groupId`
 * but need not sit next to each other: one twin's time can be edited, and other
 * events can fall between them. A page boundary could therefore split a pair,
 * and the screen would show half of it. So after the page is read, the siblings
 * of every grouped event in it are fetched and added to the response, wherever
 * they sort. `nextCursor` is still the page's own last event, so nothing older
 * is ever skipped; a sibling that sorts after the boundary is sent again by the
 * page that reaches it, and the client merges pages by id
 * (`FamilyEventListResponse`).
 *
 * **Scope.** Every read — the page and the sibling lookup — filters on the
 * family the caller's membership was resolved against. `groupId` is not an
 * authorization field (it can be supplied on a single-baby create), so a group
 * id that also appeared in another family must still only ever find this
 * family's events.
 */
export async function listFamilyEvents(
  family: FamilyScope,
  query: ListFamilyEventsQuery,
): Promise<FamilyEventListResponse> {
  const { babyId, types, before, activeAt, limit } = query;

  if (babyId !== undefined) {
    // The same answer, for the same reasons, as `requireBabyInFamily`: a baby
    // of another family and one that does not exist are indistinguishable.
    const belongsToFamily = await Baby.exists({ _id: babyId, familyId: family.familyId });
    if (!belongsToFamily) {
      throw notFound('Baby not found');
    }
  }

  const scope: QueryFilter<BabyEventAttributes> = {
    familyId: family.familyId,
    ...(types === undefined ? {} : { type: { $in: types } }),
  };

  const conditions: QueryFilter<BabyEventAttributes>[] = [
    scope,
    ...(babyId === undefined ? [] : [{ babyId }]),
  ];
  if (before !== undefined) {
    conditions.push(
      before.id === undefined
        ? { startedAt: { $lt: before.startedAt } }
        : {
            $or: [
              { startedAt: { $lt: before.startedAt } },
              { startedAt: before.startedAt, _id: { $lt: new Types.ObjectId(before.id) } },
            ],
          },
    );
  }
  if (activeAt !== undefined) {
    // Started before the instant, and not over by it. A sleep with no end is
    // still running, which is the only reason this is restricted to SLEEP.
    conditions.push(
      { startedAt: { $lt: activeAt } },
      { $or: [{ endedAt: { $gt: activeAt } }, { endedAt: null }] },
    );
  }

  // One extra, to know whether anything older exists without a second query.
  const found = await BabyEvent.find({ $and: conditions })
    .sort({ startedAt: -1, _id: -1 })
    .limit(limit + 1);

  const page = found.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    found.length > limit && last !== undefined
      ? encodeEventCursor({ startedAt: last.startedAt, id: last._id.toString() })
      : null;

  // Siblings only matter when the list shows every baby: filtered to one baby,
  // the other twin's half is not supposed to be there. Nor for `activeAt`,
  // which answers a question about sleep totals, not about rows on screen.
  const groupIds =
    babyId === undefined && activeAt === undefined
      ? [...new Set(page.flatMap((event) => (event.groupId ? [event.groupId] : [])))]
      : [];
  const siblings =
    groupIds.length === 0
      ? []
      : await BabyEvent.find({
          ...scope,
          groupId: { $in: groupIds },
          _id: { $nin: page.map((event) => event._id) },
        });

  const events = [...page, ...siblings]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || compareIdsDesc(a, b))
    .map(toBabyEvent);

  return { events, nextCursor };
}

function compareIdsDesc(a: { _id: Types.ObjectId }, b: { _id: Types.ObjectId }): number {
  const left = a._id.toHexString();
  const right = b._id.toHexString();
  return left < right ? 1 : left > right ? -1 : 0;
}
