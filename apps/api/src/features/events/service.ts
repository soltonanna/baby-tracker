import { Types, type QueryFilter } from 'mongoose';
import {
  babyEventFieldsSchemaFor,
  type BabyEvent as BabyEventDto,
  type CreateBabyEventInput,
  type ListBabyEventsQuery,
  type UpdateBabyEventInput,
} from '@baby-tracker/shared';
import { BabyEvent, type BabyEventAttributes } from '../../models/BabyEvent.js';
import { notFound, unprocessable } from '../../lib/httpError.js';
import type { FamilyScope } from '../../middleware/familyAccess.js';
import type { BabyScope } from '../../middleware/babyAccess.js';
import { toBabyEvent } from './mappers.js';

/**
 * Every function takes the resolved family and baby, never ids from the request
 * body — so an event is always written to, and read from, the baby whose
 * membership chain was actually checked.
 *
 * `familyId` is in every filter as well as `babyId`. It adds nothing the baby
 * check has not already established, and costs nothing; it means each query is
 * safe read on its own, without having to trace back to the middleware.
 */

/**
 * The filter every single-event operation uses — read, edit and delete alike.
 *
 * A malformed id throws the same 404 as a missing one, so an event id can be
 * probed for neither existence nor ownership: another family's event, another
 * baby's event and a typo are one answer (ARCHITECTURE_PROPOSAL.md §4.3).
 */
function scopedEventFilter(
  family: FamilyScope,
  baby: BabyScope,
  eventId: string,
): QueryFilter<BabyEventAttributes> {
  if (!Types.ObjectId.isValid(eventId)) {
    throw notFound('Event not found');
  }

  return { _id: eventId, familyId: family.familyId, babyId: baby.babyId };
}

export async function createEvent(
  family: FamilyScope,
  baby: BabyScope,
  input: CreateBabyEventInput,
): Promise<BabyEventDto> {
  const event = await BabyEvent.create({
    familyId: family.familyId,
    babyId: baby.babyId,
    type: input.type,
    startedAt: input.startedAt,
    ...(input.endedAt ? { endedAt: input.endedAt } : {}),
    ...(input.amount === undefined ? {} : { amount: input.amount }),
    ...(input.unit ? { unit: input.unit } : {}),
    ...(input.details ? { details: input.details } : {}),
    // Accepted from the caller because it groups rather than grants: two events
    // created by one action carry the same value. A future twin endpoint will
    // generate it server-side instead.
    ...(input.groupId ? { groupId: input.groupId } : {}),
  });

  return toBabyEvent(event);
}

/**
 * Most recent first, which is the order a tracker is read in.
 *
 * An optional `from`/`to` narrows the list to the events that *started* inside
 * the half-open interval [from, to). Start, not overlap: a sleep from 23:00 to
 * 01:00 belongs to the evening it began on and is listed there once, never in
 * both days (decision D5). A daily *total* is a different question, answered by
 * `overlapSeconds` when the statistics stage arrives; this is the list.
 *
 * The interval is half-open so that consecutive days neither drop an event at
 * midnight nor show it twice: an event exactly at the day's first instant is in,
 * one exactly at the next day's first instant is out.
 */
export async function listEvents(
  family: FamilyScope,
  baby: BabyScope,
  query: ListBabyEventsQuery,
): Promise<BabyEventDto[]> {
  const { limit, from, to } = query;

  const events = await BabyEvent.find({
    familyId: family.familyId,
    babyId: baby.babyId,
    // `from` and `to` are validated as a pair, so one without the other cannot
    // reach here; the check keeps that fact local and satisfies the types.
    ...(from !== undefined && to !== undefined ? { startedAt: { $gte: from, $lt: to } } : {}),
  })
    .sort({ startedAt: -1 })
    .limit(limit);

  return events.map(toBabyEvent);
}

export async function getEvent(
  family: FamilyScope,
  baby: BabyScope,
  eventId: string,
): Promise<BabyEventDto> {
  const event = await BabyEvent.findOne(scopedEventFilter(family, baby, eventId));
  if (!event) {
    throw notFound('Event not found');
  }

  return toBabyEvent(event);
}

/**
 * Edits one event in place.
 *
 * Only the fields present in the patch are touched; an absent field is left
 * exactly as it was, and `createdAt` and `updatedAt` are left to Mongoose, so an
 * edit never silently rewrites anything the parent did not send.
 *
 * Nothing here converts a value. Storage stays canonical (decision D3): the
 * client sends millilitres and millilitres are what is stored, the same
 * contract create has. And nothing here reinterprets a time: an end earlier than
 * a start is resolved to the following local day at the UI boundary, where the
 * family's calendar is known (decision D5, `apps/web/.../eventTime.ts`), so the
 * API sees two absolute instants and stores them as given.
 */
export async function updateEvent(
  family: FamilyScope,
  baby: BabyScope,
  eventId: string,
  input: UpdateBabyEventInput,
): Promise<BabyEventDto> {
  const event = await BabyEvent.findOne(scopedEventFilter(family, baby, eventId));
  if (!event) {
    throw notFound('Event not found');
  }

  // The stored type is the authority. A client may send it back unchanged,
  // because an edit form round-trips the whole event, but changing what an event
  // *is* would mean re-reading every one of its fields under different rules —
  // a different operation from editing one, and not one the product asks for.
  if (input.type !== undefined && input.type !== event.type) {
    throw unprocessable('An event’s type cannot be changed');
  }

  // Checked here rather than in `validate()` because the type these rules hang
  // off comes from the database, not from the request: a DIAPER stays a DIAPER
  // with a canonical kind in `details`, whatever the body claims to be.
  babyEventFieldsSchemaFor(event.type).parse(input);

  if (input.startedAt !== undefined) {
    event.startedAt = input.startedAt;
  }
  if (input.endedAt !== undefined) {
    event.endedAt = input.endedAt;
  }
  if (input.amount !== undefined) {
    event.amount = input.amount;
  }
  if (input.unit !== undefined) {
    event.unit = input.unit;
  }
  if (input.details !== undefined) {
    event.details = input.details;
  }

  await event.save();

  return toBabyEvent(event);
}

/**
 * Removes one event, and only one: the filter is the same family/baby/id triple
 * every other single-event operation uses, so a delete can no more reach across
 * a family or a sibling than a read can.
 *
 * A hard delete, deliberately. `ARCHITECTURE_PROPOSAL.md` §4.5 wants soft delete
 * on baby-owned records eventually; that is a field on the model, an exclusion
 * in every query and a restore path, and it is worth doing as its own change
 * rather than as a side effect of the first delete endpoint.
 */
export async function deleteEvent(
  family: FamilyScope,
  baby: BabyScope,
  eventId: string,
): Promise<void> {
  const { deletedCount } = await BabyEvent.deleteOne(scopedEventFilter(family, baby, eventId));
  if (deletedCount === 0) {
    throw notFound('Event not found');
  }
}
