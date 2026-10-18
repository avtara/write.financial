// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek, needsRewrap, rewrapDek, unwrapDek, wrapDek, type Dek } from '@wf/crypto/envelope';
import type { Keyring } from '@wf/crypto/keyring';
import { eq, ne, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { ROLES } from './roles.ts';
import { instanceSettings, userKeys } from './schema.ts';

/** AAD "user" of the instance DEK, which encrypts instance secrets such as the SMTP password. */
export const INSTANCE_KEY_OWNER = 'instance';

export interface RewrapResult {
  /** User DEKs re-wrapped under the active KEK. */
  readonly users: number;
  /** Whether the instance DEK was re-wrapped. */
  readonly instance: boolean;
}

export interface UserKeys {
  /**
   * The user's DEK, created on first use. Race-safe: concurrent first calls insert with `ON CONFLICT DO NOTHING` and
   * all return the row that won. Bound to `db`, so it can be passed around as `getDek: userKeys.getOrCreateDek`.
   */
  getOrCreateDek: (userId: string) => Promise<Dek>;
  /**
   * KEK rotation: re-wraps every DEK (all users' and the instance DEK) that is not wrapped with the keyring's active
   * KEK, in one transaction; data encrypted with the DEKs is untouched. Needs a `wf_migrate` connection, the only role
   * whose policies cover every user's key.
   * @throws {KeyRotationRoleError} on any other role, which would see no keys and silently re-wrap nothing.
   */
  rewrapAll: () => Promise<RewrapResult>;
}

export class KeyRotationRoleError extends Error {
  override readonly name = 'KeyRotationRoleError';

  constructor(role: string) {
    super(`KEK rotation must run as ${ROLES.migrate}, not ${role}`);
  }
}

export function createUserKeys(db: Database, keyring: Keyring): UserKeys {
  return {
    getOrCreateDek: (userId) =>
      withUser(db, userId, async (tx) => {
        const select = () =>
          tx.select({ dekWrapped: userKeys.dekWrapped }).from(userKeys).where(eq(userKeys.userId, userId));
        let [row] = await select();
        if (row === undefined) {
          const dekWrapped = wrapDek(generateDek(), keyring, userId);
          await tx
            .insert(userKeys)
            .values({ userId, dekWrapped, kekVersion: keyring.activeVersion })
            .onConflictDoNothing();
          // A new statement sees the row of a concurrent first call that won the insert (READ COMMITTED).
          row = firstRow(await select(), 'user_keys');
        }
        return unwrapDek(row.dekWrapped, keyring, userId);
      }),

    rewrapAll: () =>
      db.transaction(async (tx) => {
        const { role } = firstRow(await tx.execute<{ role: string }>(sql`select current_user as role`), 'current_user');
        if (role !== ROLES.migrate) throw new KeyRotationRoleError(role);
        const active = keyring.activeVersion;
        const stale = await tx
          .select({ userId: userKeys.userId, dekWrapped: userKeys.dekWrapped })
          .from(userKeys)
          .where(ne(userKeys.kekVersion, active))
          .for('update');
        for (const { userId, dekWrapped } of stale) {
          await tx
            .update(userKeys)
            .set({ dekWrapped: rewrapDek(dekWrapped, keyring, userId), kekVersion: active, rotatedAt: new Date() })
            .where(eq(userKeys.userId, userId));
        }
        const { wrapped } = firstRow(
          await tx.select({ wrapped: instanceSettings.instanceDekWrapped }).from(instanceSettings).for('update'),
          'instance_settings',
        );
        const instance = wrapped !== null && needsRewrap(wrapped, keyring);
        if (instance) {
          await tx
            .update(instanceSettings)
            .set({ instanceDekWrapped: rewrapDek(wrapped, keyring, INSTANCE_KEY_OWNER) });
        }
        return { users: stale.length, instance };
      }),
  };
}
