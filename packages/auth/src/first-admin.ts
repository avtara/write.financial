// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The setup wizard's bootstrap path (FR-OP1): creates the instance's first admin with an email + password
 * credential, exactly as Better Auth's email sign-up stores it (`accounts_auth` row with provider `credential`
 * and `account_id` = user id). Race-safe: the check and both inserts run in one transaction under a
 * transaction-scoped advisory lock, so two concurrent wizards cannot both create an admin. The admin must then
 * enroll 2FA before any admin action (`requireTwoFactorEnrolled`).
 */
import { firstRow, type Database } from '@wf/db/db';
import { accountsAuth, users } from '@wf/db/schema';
import type { Locale } from '@wf/i18n/locale';
import { eq, or, sql } from 'drizzle-orm';
import type { BreachedPasswordCheck } from './breached.ts';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password.ts';

export interface FirstAdminInput {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly locale: Locale;
}

/** An admin already exists; the setup wizard is closed. */
export class AdminExistsError extends Error {
  override readonly name = 'AdminExistsError';
  readonly code = 'ADMIN_EXISTS';

  constructor() {
    super('This instance already has an admin');
  }
}

/** The input breaks a sign-up rule (`code` says which); the message never echoes the password. */
export class InvalidCredentialsInputError extends Error {
  override readonly name = 'InvalidCredentialsInputError';
  readonly code:
    | 'INVALID_EMAIL'
    | 'INVALID_NAME'
    | 'PASSWORD_TOO_SHORT'
    | 'PASSWORD_TOO_LONG'
    | 'PASSWORD_COMPROMISED'
    | 'EMAIL_TAKEN';

  constructor(code: InvalidCredentialsInputError['code']) {
    super(`Invalid first admin input: ${code}`);
    this.code = code;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Any value works; it only has to be the same for every caller. */
const FIRST_ADMIN_LOCK = sql`hashtext('write.financial:first-admin')`;

export interface FirstAdminDeps {
  /** `wf_auth` connection. */
  readonly db: Database;
  readonly hashPassword: (password: string) => Promise<string>;
  readonly isBreached: BreachedPasswordCheck;
}

export async function hasAdmin(db: Database): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  return rows.length > 0;
}

/**
 * Creates the first admin and returns its id.
 * @throws {InvalidCredentialsInputError} for an invalid or taken email, an empty name, or a too short, too long, or
 *   breached password.
 * @throws {AdminExistsError} if an admin exists, including one created concurrently.
 */
export async function createFirstAdmin(deps: FirstAdminDeps, input: FirstAdminInput): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!EMAIL.test(email)) throw new InvalidCredentialsInputError('INVALID_EMAIL');
  if (name === '') throw new InvalidCredentialsInputError('INVALID_NAME');
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new InvalidCredentialsInputError('PASSWORD_TOO_SHORT');
  if (input.password.length > MAX_PASSWORD_LENGTH) throw new InvalidCredentialsInputError('PASSWORD_TOO_LONG');
  if (await deps.isBreached(input.password)) throw new InvalidCredentialsInputError('PASSWORD_COMPROMISED');
  const passwordHash = await deps.hashPassword(input.password);

  return deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${FIRST_ADMIN_LOCK})`);
    const taken = await tx
      .select({ role: users.role })
      .from(users)
      .where(or(eq(users.role, 'admin'), eq(users.email, email)));
    if (taken.some((user) => user.role === 'admin')) throw new AdminExistsError();
    if (taken.length > 0) throw new InvalidCredentialsInputError('EMAIL_TAKEN');
    const { id: userId } = firstRow(
      await tx.insert(users).values({ email, name, locale: input.locale, role: 'admin' }).returning({ id: users.id }),
      'users',
    );
    await tx
      .insert(accountsAuth)
      .values({ userId, accountId: userId, providerId: 'credential', password: passwordHash });
    return { userId };
  });
}
