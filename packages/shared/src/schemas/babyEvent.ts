import { z, type ZodType } from 'zod';
import {
  BABY_EVENT_TYPES,
  BREAST_SIDES,
  DIAPER_KINDS,
  FEEDING_KINDS,
  isMeasuredFeedingKind,
  type BabyEventType,
} from '../constants.js';

/**
 * Tracker event input schemas.
 *
 * Deliberately not type-specific: FEEDING does not require an amount, SLEEP
 * does not require an end, DIAPER has no fixed vocabulary. The shape of each
 * event is a product question the UI has not answered yet, and guessing now
 * would mean rejecting entries a parent legitimately wants to make.
 */

/** Enough for a note a tired parent types one-handed, not enough to be abused. */
export const eventDetailsSchema = z.string().trim().max(1000);

/** `ml`, `oz`, `g`… a label, not a unit system. Conversion comes later. */
export const eventUnitSchema = z.string().trim().min(1).max(16);

/**
 * Links events created by one action — the twins' two documents share one.
 * Not an authorization field: it groups, it does not grant.
 */
export const eventGroupIdSchema = z.string().trim().min(1).max(64);

/**
 * What kind of feeding this was — the first type-specific structured data an
 * event carries (`ARCHITECTURE_PROPOSAL.md` §5.5).
 *
 * A feeding needs two values at once — its kind and, for the breast, a side —
 * which is the point at which packing them into `details` stops being honest.
 * So FEEDING gets its own object rather than a token, and the other types keep
 * the flat fields they already use until they need the same.
 *
 * A discriminated union so that `side` only exists where it means something:
 * a bottle has no side, and a parser that accepted one would store it.
 *
 * - `breast`: optional side. Its length is `startedAt` → `endedAt`, derived the
 *   same way a sleep's is, and optional, because a parent often does not know.
 *   It has no volume, and `amount` is refused on it (see `eventRuleIssues`).
 * - `expressed_milk` / `formula`: a bottle, with its volume in the existing
 *   `amount` field, canonical millilitres (D3).
 */
export const feedingDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(FEEDING_KINDS[0]), side: z.enum(BREAST_SIDES).optional() }),
  z.object({ kind: z.literal(FEEDING_KINDS[1]) }),
  z.object({ kind: z.literal(FEEDING_KINDS[2]) }),
]);

/**
 * The event itself, and nothing about whose it is.
 *
 * `familyId` and `babyId` are deliberately absent: identity comes from the
 * route's resolved scopes, so a body can never say which baby an entry belongs
 * to. `groupId` is absent for the same reason — it is grouping identity, which
 * the server decides.
 *
 * This is the one place the value rules live, and the three operations that
 * need them are all derived from it rather than restating it:
 *
 *   - a single-baby create is this plus an optional `groupId`;
 *   - an edit is this, partial;
 *   - a both-babies create is exactly this, because the two babies and the
 *     `groupId` are both resolved by the server.
 */
export const babyEventDataSchema = z.object({
  type: z.enum(BABY_EVENT_TYPES),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional(),
  // `z.number()` already rejects NaN and Infinity, so this is the whole of
  // "finite and non-negative".
  amount: z.number().nonnegative().optional(),
  unit: eventUnitSchema.optional(),
  details: eventDetailsSchema.optional(),
  /** FEEDING only. Absent on feedings recorded before kinds existed. */
  feeding: feedingDataSchema.optional(),
});

/** The fields the cross-field rules read, whichever operation produced them. */
interface EventRuleSubject {
  type?: BabyEventType | undefined;
  amount?: number | null | undefined;
  feeding?: z.infer<typeof feedingDataSchema> | undefined;
}

/**
 * The rules that span more than one field of an event, as messages.
 *
 * One function, used by every place that must agree on them: a create, a
 * both-babies create and an imported file check the body itself, and an edit
 * checks the event as it *would be* after the patch, in the service, because
 * only the stored event says what the patch is being applied to.
 *
 * - `feeding` belongs to FEEDING and nothing else.
 * - A breastfeed has no measured volume. Refusing an `amount` here is what keeps
 *   a daily volume total from ever adding an invented number to measured ones.
 * - A bottle (expressed milk or formula) has one, so it needs an `amount`.
 *
 * A FEEDING with no `feeding` at all is a feeding recorded before kinds existed,
 * and is left exactly as valid as it was.
 */
export function eventRuleIssues(event: EventRuleSubject): string[] {
  const issues: string[] = [];
  const { feeding } = event;
  if (feeding === undefined) {
    return issues;
  }

  if (event.type !== undefined && event.type !== 'FEEDING') {
    issues.push('Only a feeding can say what kind of feeding it was');
    return issues;
  }

  const hasAmount = event.amount !== undefined && event.amount !== null;
  if (feeding.kind === 'breast' && hasAmount) {
    issues.push('A breastfeed has no measured volume');
  }
  if (isMeasuredFeedingKind(feeding.kind) && !hasAmount) {
    issues.push('A bottle feeding needs an amount');
  }
  return issues;
}

/** `eventRuleIssues` as Zod issues, for the schemas that check a whole body. */
function checkEventRules(event: EventRuleSubject, ctx: z.RefinementCtx): void {
  for (const message of eventRuleIssues(event)) {
    ctx.addIssue({ code: 'custom', message, path: ['feeding'] });
  }
}

/**
 * What a create for one baby accepts.
 *
 * `groupId` is still accepted here, because it groups rather than grants and
 * the endpoint has taken it since the first tracker stage. The both-babies
 * endpoint does not accept it: there the server generates it, so that two
 * documents written by one action can never be told they belong to somebody
 * else's group.
 */
export const createBabyEventSchema = babyEventDataSchema
  .extend({
    groupId: eventGroupIdSchema.optional(),
  })
  .superRefine(checkEventRules);

/**
 * What the both-babies endpoint accepts: the event's own fields, under the same
 * cross-field rules as a single create.
 */
export const createBothBabiesEventSchema = babyEventDataSchema.superRefine(checkEventRules);

/**
 * What an edit may change.
 *
 * Derived from the shared event data rather than restated, so every rule — the
 * non-negative amount, the 1000-character note, the date coercion — has exactly
 * one definition and an edit can never be checked more loosely than the create
 * that produced the event.
 *
 * Three fields are deliberately not editable, and none of them is in
 * `babyEventDataSchema` to begin with:
 *
 *  - `groupId` links the two documents of one twin action: an identity the
 *    server assigns, not a value a parent types. Re-pointing it would silently
 *    move an event between groups, and "change both" is its own opt-in endpoint
 *    (ARCHITECTURE_PROPOSAL.md §5.5).
 *  - `familyId` and `babyId` were never in the body at all. Unknown keys are
 *    stripped, so sending them is not an error — it simply changes nothing.
 *
 * `type` stays accepted, because an edit form naturally sends the event back
 * whole, but the service requires it to equal the stored type: what an event
 * *is* is not editable here.
 *
 * At least one real field must be present. A patch that would change nothing is
 * a client mistake, and answering 200 to it would hide that.
 */
export const updateBabyEventSchema = babyEventDataSchema
  .partial()
  .extend({
    // `null` clears a field; absent still means unchanged. Needed the moment a
    // feeding can change kind: a breastfeed edited into a bottle drops its end
    // time, and a bottle edited into a breastfeed drops its volume. `z.null()`
    // is tried first, so `null` is never coerced into the epoch.
    endedAt: z.union([z.null(), z.coerce.date()]).optional(),
    amount: z.number().nonnegative().nullable().optional(),
    unit: eventUnitSchema.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).some((field) => field !== 'type'), {
    message: 'An update must change at least one field',
  });

/**
 * The canonical nappy vocabulary, as stored. DIAPER carries its kind in the
 * generic `details` field (see `docs`/project memory on the event data shape),
 * so this is the one place that says which strings are meaningful there.
 */
export const diaperDetailsSchema = z.enum(DIAPER_KINDS);

const diaperFieldsSchema = z.object({ details: diaperDetailsSchema.optional() });
const noTypeSpecificFields = z.object({});

/**
 * The rules a flat schema cannot express, because they depend on which kind of
 * event this is.
 *
 * Kept separate from `updateBabyEventSchema` on purpose: the type they apply to
 * is the *stored* one, which only the server knows, so this is parsed after the
 * event has been loaded rather than in request validation.
 */
export function babyEventFieldsSchemaFor(type: BabyEventType): ZodType {
  return type === 'DIAPER' ? diaperFieldsSchema : noTypeSpecificFields;
}

/**
 * What the list endpoint accepts.
 *
 * `limit` is unchanged: how many events, newest first, and it still defaults on
 * its own so a caller that asks for nothing keeps the behaviour it had.
 *
 * `from` and `to` are the half-open interval [from, to) an event's *start* must
 * fall in. They are absolute instants, not calendar dates: the day boundaries
 * of a local calendar day are worked out where the calendar is known — the UI,
 * with the shared `localDayRange` helpers — and what reaches the API is two
 * instants, exactly as decision D5 already does for a sleep's end. The API
 * therefore does no calendar arithmetic of its own and needs no notion of whose
 * time zone this is.
 *
 * Both or neither. A half-open request is a client mistake, and guessing the
 * missing end of it (the epoch? now?) would answer something nobody asked for.
 */
export const listBabyEventsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    // `z.coerce.date()` rejects an unparseable string rather than passing an
    // Invalid Date through, so malformed input fails validation like any other.
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'Both "from" and "to" are required to request a range',
    path: ['from'],
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from < query.to, {
    message: '"from" must be earlier than "to"',
    path: ['from'],
  });

export type BabyEventData = z.infer<typeof babyEventDataSchema>;
export type CreateBabyEventInput = z.infer<typeof createBabyEventSchema>;
export type UpdateBabyEventInput = z.infer<typeof updateBabyEventSchema>;
export type ListBabyEventsQuery = z.infer<typeof listBabyEventsQuerySchema>;
