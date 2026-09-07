import { Types } from 'mongoose';
import type { BabyEvent as BabyEventDto, CreateBabyEventInput } from '@baby-tracker/shared';
import { BabyEvent } from '../../models/BabyEvent.js';
import { notFound } from '../../lib/httpError.js';
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

/** Most recent first, which is the order a tracker is read in. */
export async function listEvents(
  family: FamilyScope,
  baby: BabyScope,
  limit: number,
): Promise<BabyEventDto[]> {
  const events = await BabyEvent.find({ familyId: family.familyId, babyId: baby.babyId })
    .sort({ startedAt: -1 })
    .limit(limit);

  return events.map(toBabyEvent);
}

export async function getEvent(
  family: FamilyScope,
  baby: BabyScope,
  eventId: string,
): Promise<BabyEventDto> {
  if (!Types.ObjectId.isValid(eventId)) {
    throw notFound('Event not found');
  }

  const event = await BabyEvent.findOne({
    _id: eventId,
    familyId: family.familyId,
    babyId: baby.babyId,
  });
  if (!event) {
    throw notFound('Event not found');
  }

  return toBabyEvent(event);
}
