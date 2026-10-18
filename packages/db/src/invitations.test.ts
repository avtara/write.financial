// SPDX-License-Identifier: AGPL-3.0-only
import { sha256Hex } from '@wf/crypto/hash';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { NotAdminError } from './instance-settings.ts';
import { createInvitations, type InvitationsRepository } from './invitations.ts';

let test: TestDatabase;
let repo: InvitationsRepository;
let admin: string;
let member: string;

const TOKEN_HASH = sha256Hex('invitation-token-1');
const OTHER_HASH = sha256Hex('invitation-token-2');
const inOneDay = () => new Date(Date.now() + 86_400_000);

beforeAll(async () => {
  test = await startMigrated();
  repo = createInvitations(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  admin = await insertUser(test, 'admin@example.test', 'admin');
  member = await insertUser(test, 'member@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const asAuth = <T>(fn: () => Promise<T>) => test.as('wf_auth', fn);
const invite = (email: string, tokenHash = TOKEN_HASH, expiresAt = inOneDay()) =>
  asApp(() => repo.create(admin, { email, tokenHash, expiresAt }));

describe('create', () => {
  it('stores the invitation with a lower-cased email, the inviting admin, and no use yet', async () => {
    const { id } = await invite('Sari@Example.TEST');
    expect(
      await test.query('SELECT email, token_hash, invited_by, used_at FROM invitations WHERE id = $1', [id]),
    ).toEqual([{ email: 'sari@example.test', token_hash: TOKEN_HASH, invited_by: admin, used_at: null }]);
  });

  it('refuses a user who is not an admin', async () => {
    await expect(
      asApp(() => repo.create(member, { email: 'x@example.test', tokenHash: TOKEN_HASH, expiresAt: inOneDay() })),
    ).rejects.toThrow(new NotAdminError('invite users'));
    expect(await test.query('SELECT id FROM invitations')).toEqual([]);
  });
});

describe('isUsable and claim', () => {
  it('match the token hash and the email in any case, once', async () => {
    await invite('sari@example.test');
    expect(await asAuth(() => repo.isUsable(TOKEN_HASH, 'SARI@example.test'))).toBe(true);
    expect(await asAuth(() => repo.claim(TOKEN_HASH, 'Sari@Example.test'))).toBe(true);
    expect(await asAuth(() => repo.isUsable(TOKEN_HASH, 'sari@example.test'))).toBe(false);
    expect(await asAuth(() => repo.claim(TOKEN_HASH, 'sari@example.test'))).toBe(false);
  });

  it('reject another email or token', async () => {
    await invite('sari@example.test');
    expect(await asAuth(() => repo.isUsable(TOKEN_HASH, 'eve@example.test'))).toBe(false);
    expect(await asAuth(() => repo.claim(OTHER_HASH, 'sari@example.test'))).toBe(false);
    expect(await asAuth(() => repo.isUsable(TOKEN_HASH, 'sari@example.test'))).toBe(true);
  });

  it('reject an expired invitation', async () => {
    await invite('sari@example.test', TOKEN_HASH, new Date(Date.now() - 1000));
    expect(await asAuth(() => repo.isUsable(TOKEN_HASH, 'sari@example.test'))).toBe(false);
    expect(await asAuth(() => repo.claim(TOKEN_HASH, 'sari@example.test'))).toBe(false);
  });
});

describe('claimForEmail', () => {
  it('uses one usable invitation for the email per call', async () => {
    await invite('sari@example.test', TOKEN_HASH);
    await invite('sari@example.test', OTHER_HASH);
    expect(await asAuth(() => repo.claimForEmail('SARI@example.test'))).toBe(true);
    expect(await asAuth(() => repo.claimForEmail('sari@example.test'))).toBe(true);
    expect(await asAuth(() => repo.claimForEmail('sari@example.test'))).toBe(false);
    expect(await test.query('SELECT token_hash FROM invitations WHERE used_at IS NULL')).toEqual([]);
  });

  it('finds nothing for an uninvited or expired email', async () => {
    await invite('old@example.test', TOKEN_HASH, new Date(Date.now() - 1000));
    expect(await asAuth(() => repo.claimForEmail('old@example.test'))).toBe(false);
    expect(await asAuth(() => repo.claimForEmail('eve@example.test'))).toBe(false);
  });
});
