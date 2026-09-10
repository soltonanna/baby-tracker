import type {
  Baby,
  BabyEvent,
  BabyEventGroup,
  BabyEventGroupResponse,
  BabyEventListResponse,
  BabyEventResponse,
  BabyEventType,
  BabyListResponse,
  BabyResponse,
  CreateBabyInput,
  CreateFamilyInput,
  FamilyListResponse,
  FamilyResponse,
  FamilyWithRole,
  IsoDateTime,
} from '@baby-tracker/shared';
import { apiFetch } from '../../services/apiClient.js';
import type { DayRange } from './day.js';
import type { EventTarget } from './eventTarget.js';

/** The Today screen's reads and writes. Thin wrappers, like features/auth/api.ts. */

export async function fetchFamilies(): Promise<FamilyWithRole[]> {
  const { families } = await apiFetch<FamilyListResponse>('/families');
  return families;
}

/**
 * Creates the caller's family. The API makes them its OWNER; no role is sent.
 */
export async function createFamily(input: CreateFamilyInput): Promise<FamilyWithRole> {
  const { family } = await apiFetch<FamilyResponse>('/families', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return family;
}

/**
 * Adds a baby to one of the caller's families.
 *
 * The family comes from the path, never from the body: the API resolves it
 * through the caller's membership and ignores anything the client claims.
 */
export async function createBaby(familyId: string, input: CreateBabyInput): Promise<Baby> {
  const { baby } = await apiFetch<BabyResponse>(`/families/${familyId}/babies`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return baby;
}

export async function fetchBabies(familyId: string): Promise<Baby[]> {
  const { babies } = await apiFetch<BabyListResponse>(`/families/${familyId}/babies`);
  return babies;
}

/**
 * One baby's events, newest first.
 *
 * With a `range`, only the events that *started* inside it — which is how Today
 * asks for the current local calendar day. Without one, the endpoint's original
 * behaviour: the most recent events, whenever they happened.
 */
export async function fetchBabyEvents(
  familyId: string,
  babyId: string,
  range?: DayRange,
): Promise<BabyEvent[]> {
  const query = range === undefined ? '' : `?${new URLSearchParams({ ...range }).toString()}`;
  const { events } = await apiFetch<BabyEventListResponse>(
    `/families/${familyId}/babies/${babyId}/events${query}`,
  );
  return events;
}

/**
 * What the API accepts in the body of a create.
 *
 * No `familyId` or `babyId`: the API takes both from the path and resolves them
 * through the membership chain, and ignores anything the client claims.
 */
export interface CreateBabyEventPayload {
  type: BabyEventType;
  startedAt: IsoDateTime;
  /** Only for events that have a length, such as a sleep. */
  endedAt?: IsoDateTime;
  amount?: number;
  unit?: string;
  details?: string;
}

export async function createBabyEvent(
  familyId: string,
  babyId: string,
  payload: CreateBabyEventPayload,
): Promise<BabyEvent> {
  const { event } = await apiFetch<BabyEventResponse>(
    `/families/${familyId}/babies/${babyId}/events`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return event;
}

/**
 * Records one entry for both babies.
 *
 * Family-scoped, with no baby anywhere in the path or the body: the API resolves
 * the family's two babies itself, so "both" cannot be aimed at anyone else's
 * child. The payload is the same one a single-baby create sends — the same
 * event, written once for each baby.
 *
 * `groupId` is not a parameter and never will be. The two documents are linked
 * by an id the server generates; a client that chose it could point one action's
 * events at another action's group.
 */
export async function createBothBabiesEvent(
  familyId: string,
  payload: CreateBabyEventPayload,
): Promise<BabyEventGroup> {
  const { group } = await apiFetch<BabyEventGroupResponse>(`/families/${familyId}/event-groups`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return group;
}

/**
 * What the API accepts in the body of an edit.
 *
 * Every field of a create, all optional: an edit form sends the event back
 * whole, and `updateBabyEventSchema` in the shared package accepts exactly that
 * — `type` included, as long as it still matches the stored one. `familyId` and
 * `babyId` stay in the path here too, so an edit can never re-home an event.
 */
export type UpdateBabyEventPayload = Partial<CreateBabyEventPayload>;

export async function updateBabyEvent(
  familyId: string,
  babyId: string,
  eventId: string,
  payload: UpdateBabyEventPayload,
): Promise<BabyEvent> {
  const { event } = await apiFetch<BabyEventResponse>(
    `/families/${familyId}/babies/${babyId}/events/${eventId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
  return event;
}

/**
 * Deletes one event. The API answers 204 with no body, so there is nothing to
 * return and nothing to parse — a rejected promise is the only failure signal.
 */
export async function deleteBabyEvent(
  familyId: string,
  babyId: string,
  eventId: string,
): Promise<void> {
  await apiFetch<null>(`/families/${familyId}/babies/${babyId}/events/${eventId}`, {
    method: 'DELETE',
  });
}

/**
 * Create or edit, for one baby or for both.
 *
 * Four entry forms each need this one decision and nothing else in common, so
 * it lives here as one function rather than as a form abstraction: a form knows
 * its own fields, and this knows the verb. Adding "both" widened the verb rather
 * than the forms — each of them still describes a feeding, a sleep, a nappy or a
 * note, and none of them knows there are two endpoints.
 *
 * Always an array, however many events were written, so a caller has one shape
 * to handle rather than a union to unpack.
 */
export function saveBabyEvent(
  familyId: string,
  target: EventTarget,
  eventId: string | undefined,
  payload: CreateBabyEventPayload,
): Promise<BabyEvent[]> {
  if (target.kind === 'both') {
    // Both is a create. An edit belongs to the event's own baby — the forms
    // never offer the choice while editing — so this branch cannot be one.
    return createBothBabiesEvent(familyId, payload).then((group) => group.events);
  }

  return (
    eventId === undefined
      ? createBabyEvent(familyId, target.babyId, payload)
      : updateBabyEvent(familyId, target.babyId, eventId, payload)
  ).then((event) => [event]);
}
