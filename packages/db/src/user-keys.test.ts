// SPDX-License-Identifier: AGPL-3.0-only
import { decryptText, encrypt } from '@wf/crypto/cipher';
import { generateDek, unwrapDek, wrapDek } from '@wf/crypto/envelope';
import { addKeyVersion, parseKeyring } from '@wf/crypto/keyring';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keyFileText } from '../test/keys.ts';
import { insertUser, startMigrated, PGLITE_HOOK_TIMEOUT, type TestDatabase } from '../test/pglite.ts';
import { InvalidUserIdError } from './db.ts';
import { createUserKeys, INSTANCE_KEY_OWNER, KeyRotationRoleError } from './user-keys.ts';

const v1Text = keyFileText();
const v1 = parseKeyring(v1Text);
const v2 = parseKeyring(addKeyVersion(v1Text));

let test: TestDatabase;
let alice: string;
let bob: string;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  await test.query('UPDATE instance_settings SET instance_dek_wrapped = NULL, smtp_password_enc = NULL');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const storedKeys = () =>
  test.query<{ user_id: string; dek_wrapped: Uint8Array; kek_version: number; rotated_at: Date | null }>(
    'SELECT user_id, dek_wrapped, kek_version, rotated_at FROM user_keys ORDER BY user_id',
  );

describe('getOrCreateDek', () => {
  const aad = { userId: '', purpose: 'test.note' };

  it('creates the DEK on first use and returns the same one afterwards', async () => {
    const keys = createUserKeys(test.db, v1);
    const ciphertext = await test.as('wf_app', async () =>
      encrypt(await keys.getOrCreateDek(alice), 'catatan', { ...aad, userId: alice }),
    );
    const again = await test.as('wf_app', () => keys.getOrCreateDek(alice));
    expect(decryptText(again, ciphertext, { ...aad, userId: alice })).toBe('catatan');
    expect(await storedKeys()).toHaveLength(1);
  });

  it('stores only the DEK wrapped by the active KEK and bound to the user', async () => {
    const keys = createUserKeys(test.db, v2);
    const dek = await test.as('wf_worker', () => keys.getOrCreateDek(alice));
    const [row] = await storedKeys();
    expect(row).toMatchObject({ user_id: alice, kek_version: 2, rotated_at: null });
    const wrapped = row?.dek_wrapped ?? new Uint8Array();
    expect(wrapped).toHaveLength(65);
    const ciphertext = encrypt(dek, 'x', { ...aad, userId: alice });
    expect(decryptText(unwrapDek(wrapped, v2, alice), ciphertext, { ...aad, userId: alice })).toBe('x');
    expect(() => unwrapDek(wrapped, v2, bob)).toThrow();
  });

  it('gives each user their own DEK and never another user’s row', async () => {
    const keys = createUserKeys(test.db, v1);
    const [aliceDek, bobDek] = await test.as('wf_app', async () => [
      await keys.getOrCreateDek(alice),
      await keys.getOrCreateDek(bob),
    ]);
    const ciphertext = encrypt(aliceDek, 'rahasia', { ...aad, userId: alice });
    expect(() => decryptText(bobDek, ciphertext, { ...aad, userId: alice })).toThrow();
    expect((await storedKeys()).map((row) => row.user_id).toSorted()).toEqual([alice, bob].toSorted());
  });

  it('cannot store a key for another user even with a forged row', async () => {
    await expect(
      test.as('wf_app', () =>
        test.pg.transaction(async (tx) => {
          await tx.query(`SELECT set_config('app.user_id', $1, true)`, [bob]);
          await tx.query('INSERT INTO user_keys (user_id, dek_wrapped, kek_version) VALUES ($1, $2, 1)', [
            alice,
            wrapDek(generateDek(), v1, alice),
          ]);
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('rejects a user id that is not a UUID', async () => {
    await expect(createUserKeys(test.db, v1).getOrCreateDek('alice')).rejects.toBeInstanceOf(InvalidUserIdError);
  });
});

describe('rewrapAll', () => {
  it('refuses to run as any role but wf_migrate', async () => {
    const result = test.as('wf_app', () => createUserKeys(test.db, v2).rewrapAll());
    await expect(result).rejects.toThrow(new KeyRotationRoleError('wf_app'));
    await expect(result).rejects.toThrow('KEK rotation must run as wf_migrate, not wf_app');
  });

  it('re-wraps every stale DEK under the active KEK; the DEKs themselves do not change', async () => {
    const before = createUserKeys(test.db, v1);
    const [aliceDek, bobDek] = await test.as('wf_app', async () => [
      await before.getOrCreateDek(alice),
      await before.getOrCreateDek(bob),
    ]);
    const notes = [
      encrypt(aliceDek, 'alice', { userId: alice, purpose: 'n' }),
      encrypt(bobDek, 'bob', { userId: bob, purpose: 'n' }),
    ] as const;

    const after = createUserKeys(test.db, v2);
    expect(await test.as('wf_migrate', () => after.rewrapAll())).toEqual({ users: 2, instance: false });
    for (const row of await storedKeys()) {
      expect(row.kek_version).toBe(2);
      expect(row.rotated_at).toBeInstanceOf(Date);
    }
    // Old KEK alone can no longer unwrap; the re-wrapped DEKs still decrypt the old data.
    const [aliceRow] = (await storedKeys()).filter((row) => row.user_id === alice);
    expect(() => unwrapDek(aliceRow?.dek_wrapped ?? new Uint8Array(), v1, alice)).toThrow();
    const [aliceNow, bobNow] = await test.as('wf_app', async () => [
      await after.getOrCreateDek(alice),
      await after.getOrCreateDek(bob),
    ]);
    expect(decryptText(aliceNow, notes[0], { userId: alice, purpose: 'n' })).toBe('alice');
    expect(decryptText(bobNow, notes[1], { userId: bob, purpose: 'n' })).toBe('bob');

    expect(await test.as('wf_migrate', () => after.rewrapAll())).toEqual({ users: 0, instance: false });
  });

  it('re-wraps the instance DEK when it is stale, and only then', async () => {
    const instanceDek = generateDek();
    await test.query('UPDATE instance_settings SET instance_dek_wrapped = $1', [
      wrapDek(instanceDek, v1, INSTANCE_KEY_OWNER),
    ]);
    const secret = encrypt(instanceDek, 'smtp', { userId: INSTANCE_KEY_OWNER, purpose: 'p' });
    const keys = createUserKeys(test.db, v2);
    expect(await test.as('wf_migrate', () => keys.rewrapAll())).toEqual({ users: 0, instance: true });
    expect(await test.as('wf_migrate', () => keys.rewrapAll())).toEqual({ users: 0, instance: false });
    const [row] = await test.query<{ wrapped: Uint8Array }>(
      'SELECT instance_dek_wrapped AS wrapped FROM instance_settings',
    );
    const rewrapped = unwrapDek(row?.wrapped ?? new Uint8Array(), v2, INSTANCE_KEY_OWNER);
    expect(decryptText(rewrapped, secret, { userId: INSTANCE_KEY_OWNER, purpose: 'p' })).toBe('smtp');
  });
});
