// SPDX-License-Identifier: AGPL-3.0-only
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { firstRow, isUuid, withUser, type Database } from './db.ts';
import { securityEvents, type JsonObject, type SECURITY_EVENT_TYPES } from './schema.ts';

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export interface NewSecurityEvent {
  readonly type: SecurityEventType;
  /** Keyed hash of the client IP (`hmacSha256Hex` from `@wf/crypto/hash`), never the IP itself. */
  readonly ipHash: string | null;
  /** Truncated to 512 characters. */
  readonly userAgent: string | null;
  /** Non-secret details, e.g. `{ newDevice: true }` or a passkey name. */
  readonly meta?: JsonObject;
}

export interface SecurityEvent extends Required<NewSecurityEvent> {
  readonly id: string;
  readonly at: Date;
}

export interface SecurityEventPage {
  /** 1–100. */
  readonly limit: number;
  /** `nextBefore` of the previous page; omit for the newest events. */
  readonly before?: string;
}

export interface SecurityEventList {
  /** Newest first. */
  readonly events: readonly SecurityEvent[];
  /** Pass as `before` to get the next (older) page; `null` on the last page. */
  readonly nextBefore: string | null;
}

export const MAX_PAGE_SIZE = 100;
const USER_AGENT_MAX = 512;

export interface SecurityEvents {
  /** Appends an event to the user's security history (FR-A10). The table rejects updates and deletes. */
  append: (userId: string, event: NewSecurityEvent) => Promise<void>;
  /** The user's events, newest first (UUID v7 ids are time-ordered). */
  list: (userId: string, page: SecurityEventPage) => Promise<SecurityEventList>;
  /**
   * Whether the user has signed in before, and whether from the device with this fingerprint (`meta.device` of a
   * `sign_in` event), for new-device notifications (FR-A10).
   */
  signInHistory: (userId: string, device: string) => Promise<SignInHistory>;
}

export interface SignInHistory {
  readonly hasSignedIn: boolean;
  readonly knownDevice: boolean;
}

export function createSecurityEvents(db: Database): SecurityEvents {
  return {
    append: async (userId, event) => {
      if (event.ipHash !== null && !/^[0-9a-f]{64}$/.test(event.ipHash)) {
        throw new RangeError('ipHash must be a lowercase hex HMAC-SHA256, not a raw IP address');
      }
      await withUser(db, userId, async (tx) => {
        await tx.insert(securityEvents).values({
          userId,
          type: event.type,
          ipHash: event.ipHash,
          userAgent: event.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
          meta: event.meta ?? {},
        });
      });
    },

    list: async (userId, { limit, before }) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
        throw new RangeError(`limit must be an integer 1–${MAX_PAGE_SIZE}`);
      }
      if (before !== undefined && !isUuid(before)) throw new RangeError('before must be an event id');
      return withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({
            id: securityEvents.id,
            type: securityEvents.type,
            ipHash: securityEvents.ipHash,
            userAgent: securityEvents.userAgent,
            meta: securityEvents.meta,
            at: securityEvents.at,
          })
          .from(securityEvents)
          .where(
            and(eq(securityEvents.userId, userId), before === undefined ? undefined : lt(securityEvents.id, before)),
          )
          .orderBy(desc(securityEvents.id))
          .limit(limit + 1);
        const events = rows.slice(0, limit);
        const last = rows.length > limit ? events.at(-1) : undefined;
        return { events, nextBefore: last?.id ?? null };
      });
    },

    signInHistory: (userId, device) =>
      withUser(db, userId, async (tx) =>
        firstRow(
          await tx
            .select({
              hasSignedIn: sql<boolean>`count(*) > 0`,
              knownDevice: sql<boolean>`coalesce(bool_or(${securityEvents.meta} ->> 'device' = ${device}), false)`,
            })
            .from(securityEvents)
            .where(and(eq(securityEvents.userId, userId), eq(securityEvents.type, 'sign_in'))),
          'security_events',
        ),
      ),
  };
}
