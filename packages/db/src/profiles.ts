// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The profile columns of `users` the user edits in Settings › Profile (FR-A7, FR-S8): full name, preferred name,
 * language, and IANA time zone. `wf_app` may update only these columns, and Row-Level Security limits it to the
 * caller's own row; email, role, and second factors change only through the auth module.
 */
import type { Locale } from '@wf/i18n/locale';
import { eq, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { users } from './schema.ts';

export interface Profile {
  readonly name: string;
  /** Preferred name for greetings; `null` falls back to the first word of `name`. */
  readonly nickname: string | null;
  readonly locale: Locale;
  readonly timezone: string;
}

export type ProfilePatch = Partial<Profile>;

/** The patch breaks a profile rule; `field` says which. The message never echoes the value. */
export class InvalidProfileError extends RangeError {
  override readonly name = 'InvalidProfileError';
  readonly code = 'INVALID_PROFILE';
  readonly field: keyof Profile;

  constructor(field: keyof Profile) {
    super(`Invalid profile field: ${field}`);
    this.field = field;
  }
}

/** Longest full or preferred name accepted. */
export const MAX_NAME_LENGTH = 100;

/** Whether `zone` is an IANA time zone this runtime knows (`Asia/Jakarta`), not an offset or abbreviation. */
export function isTimeZone(zone: string): boolean {
  return Intl.supportedValuesOf('timeZone').includes(zone) || zone === 'UTC';
}

function validate(patch: ProfilePatch): ProfilePatch {
  const name = patch.name?.trim();
  if (name !== undefined && (name === '' || name.length > MAX_NAME_LENGTH)) throw new InvalidProfileError('name');
  const nickname = patch.nickname === null ? null : patch.nickname?.trim();
  if (nickname !== undefined && nickname !== null && nickname.length > MAX_NAME_LENGTH) {
    throw new InvalidProfileError('nickname');
  }
  if (patch.timezone !== undefined && !isTimeZone(patch.timezone)) throw new InvalidProfileError('timezone');
  return {
    ...(name === undefined ? {} : { name }),
    // An empty preferred name means "none".
    ...(nickname === undefined ? {} : { nickname: nickname === '' ? null : nickname }),
    ...(patch.locale === undefined ? {} : { locale: patch.locale }),
    ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
  };
}

const COLUMNS = { name: users.name, nickname: users.nickname, locale: users.locale, timezone: users.timezone };

export interface ProfilesRepository {
  get: (userId: string) => Promise<Profile>;
  /**
   * Changes the given fields and returns the profile.
   * @throws {InvalidProfileError} for an empty or too long name, a too long preferred name, or an unknown time zone.
   */
  update: (userId: string, patch: ProfilePatch) => Promise<Profile>;
}

/** On a `wf_app` connection. */
export function createProfiles(db: Database): ProfilesRepository {
  return {
    get: (userId) =>
      withUser(db, userId, async (tx) =>
        firstRow(await tx.select(COLUMNS).from(users).where(eq(users.id, userId)), 'users'),
      ),
    update: (userId, patch) => {
      const values = validate(patch);
      return withUser(db, userId, async (tx) =>
        firstRow(
          await tx
            .update(users)
            .set({ ...values, updatedAt: sql`now()` })
            .where(eq(users.id, userId))
            .returning(COLUMNS),
          'users',
        ),
      );
    },
  };
}
