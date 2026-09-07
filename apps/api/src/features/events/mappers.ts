import type { BabyEvent as BabyEventDto } from '@baby-tracker/shared';
import type { BabyEventDocument } from '../../models/BabyEvent.js';

export function toBabyEvent(event: BabyEventDocument): BabyEventDto {
  return {
    id: event._id.toString(),
    familyId: event.familyId.toString(),
    babyId: event.babyId.toString(),
    type: event.type,
    startedAt: event.startedAt.toISOString(),
    ...(event.endedAt ? { endedAt: event.endedAt.toISOString() } : {}),
    ...(event.amount === undefined ? {} : { amount: event.amount }),
    ...(event.unit ? { unit: event.unit } : {}),
    ...(event.details ? { details: event.details } : {}),
    ...(event.groupId ? { groupId: event.groupId } : {}),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
