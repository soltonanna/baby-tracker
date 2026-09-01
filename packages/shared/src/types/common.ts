/** MongoDB ObjectId serialised as a 24-character hex string. */
export type Id = string;

/** An absolute instant, always UTC, ISO-8601. Example: '2026-09-01T07:30:00.000Z'. */
export type IsoDateTime = string;

/**
 * A calendar date in the family's time zone, 'YYYY-MM-DD'.
 * Decision D4: events denormalise this so "today" is an indexed equality match.
 */
export type LocalDate = string;

/** The single error shape every API endpoint returns on failure. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Cursor-paginated list response (used by the timeline in Phase 2). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Audit fields present on every human-written record. */
export interface AuditFields {
  createdBy: Id;
  updatedBy?: Id;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime | null;
}
