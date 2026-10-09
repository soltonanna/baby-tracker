import type { BabyEvent as BabyEventDto, FeedingData } from '@baby-tracker/shared';
import type { BabyEventAttributes, BabyEventDocument } from '../../models/BabyEvent.js';

/**
 * A stored feeding kind as plain wire data: no Mongoose subdocument, and no
 * `side` key at all on a bottle. Shared with the family-data export.
 */
export function toFeedingData(
  feeding: BabyEventAttributes['feeding'] | null | undefined,
): FeedingData | undefined {
  if (!feeding) {
    return undefined;
  }
  if (feeding.kind === 'breast') {
    return feeding.side ? { kind: 'breast', side: feeding.side } : { kind: 'breast' };
  }
  return { kind: feeding.kind };
}

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
    ...feedingField(event.feeding),
    ...(event.groupId ? { groupId: event.groupId } : {}),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

function feedingField(feeding: BabyEventAttributes['feeding']): { feeding?: FeedingData } {
  const data = toFeedingData(feeding);
  return data === undefined ? {} : { feeding: data };
}
