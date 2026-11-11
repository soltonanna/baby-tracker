/**
 * Which entry form edits which kind of event — the state `EventEditor` renders
 * from, shared by Today and Timeline.
 */

import type { BabyEvent, BabyEventType } from '@baby-tracker/shared';

/** The four kinds of entry form, one per event type. */
export type EventFormKind = 'note' | 'feeding' | 'sleep' | 'diaper';

/**
 * An open entry form, and the event it is editing when there is one.
 *
 * Kept in one value rather than two pieces of state, because they always change
 * together: opening a form for a different event, or for none, is one decision.
 */
export interface EventFormState {
  kind: EventFormKind;
  event?: BabyEvent;
}

/** Which form edits which kind of event. */
export const FORM_FOR_EVENT: Record<BabyEventType, EventFormKind> = {
  FEEDING: 'feeding',
  SLEEP: 'sleep',
  DIAPER: 'diaper',
  NOTE: 'note',
};

/** The form that edits this event, opened on it. */
export const editFormFor = (event: BabyEvent): EventFormState => ({
  kind: FORM_FOR_EVENT[event.type],
  event,
});
