// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Invitations (FR-OP1). Admins create them through `wf_app` (Row-Level Security admits admins only); the auth
 * module checks and consumes them through `wf_auth`, which may only set `used_at`. Only the SHA-256 of the token
 * is stored; the token itself travels in the invitation email. Expiry is judged by the database clock.
 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { NotAdminError } from './instance-settings.ts';
import { invitations } from './schema.ts';

export interface NewInvitation {
  readonly email: string;
  /** `sha256Hex(token)` from `@wf/crypto/hash`. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface InvitationsRepository {
  /**
   * Stores an invitation as `adminUserId` (from the session); the email is stored lower-cased.
   * @throws {NotAdminError} if `adminUserId` is not an admin.
   */
  create: (adminUserId: string, invitation: NewInvitation) => Promise<{ readonly id: string }>;
  /** Whether an unused, unexpired invitation with this token hash exists for `email` (any case). */
  isUsable: (tokenHash: string, email: string) => Promise<boolean>;
  /** Atomically marks that invitation used; `false` if there is none (or a concurrent sign-up took it). */
  claim: (tokenHash: string, email: string) => Promise<boolean>;
  /** Atomically marks the newest usable invitation for `email` used (sign-up with a verified Google email). */
  claimForEmail: (email: string) => Promise<boolean>;
}

const usableFor = (email: string) =>
  and(
    eq(sql`lower(${invitations.email})`, email.toLowerCase()),
    isNull(invitations.usedAt),
    gt(invitations.expiresAt, sql`now()`),
  );

export function createInvitations(db: Database): InvitationsRepository {
  return {
    create: (adminUserId, { email, tokenHash, expiresAt }) =>
      withUser(db, adminUserId, async (tx) => {
        const [admin] = await tx.execute<{ is_admin: boolean }>(sql`select app_is_admin() as is_admin`);
        if (admin?.is_admin !== true) throw new NotAdminError('invite users');
        const rows = await tx
          .insert(invitations)
          .values({ email: email.toLowerCase(), tokenHash, expiresAt, invitedBy: adminUserId })
          .returning({ id: invitations.id });
        return firstRow(rows, 'invitations');
      }),

    isUsable: async (tokenHash, email) => {
      const rows = await db
        .select({ id: invitations.id })
        .from(invitations)
        .where(and(eq(invitations.tokenHash, tokenHash), usableFor(email)));
      return rows.length > 0;
    },

    claim: async (tokenHash, email) => {
      const rows = await db
        .update(invitations)
        .set({ usedAt: sql`now()` })
        .where(and(eq(invitations.tokenHash, tokenHash), usableFor(email)))
        .returning({ id: invitations.id });
      return rows.length > 0;
    },

    claimForEmail: async (email) => {
      const newest = db
        .select({ id: invitations.id })
        .from(invitations)
        .where(usableFor(email))
        .orderBy(sql`${invitations.id} desc`)
        .limit(1)
        .for('update', { skipLocked: true });
      const rows = await db
        .update(invitations)
        .set({ usedAt: sql`now()` })
        .where(and(sql`${invitations.id} = (${newest})`, isNull(invitations.usedAt)))
        .returning({ id: invitations.id });
      return rows.length > 0;
    },
  };
}
