// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testKeyring } from '../test/keys.ts';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createDrafts, type DraftsRepository } from './drafts.ts';
import { createUserKeys, type UserKeys } from './user-keys.ts';

let test: TestDatabase;
let drafts: DraftsRepository;
let keys: UserKeys;
let alice: string;
let bob: string;

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

beforeAll(async () => {
  test = await startMigrated();
  keys = createUserKeys(test.db, testKeyring().keyring);
  drafts = createDrafts(test.db, { getDek: keys.getOrCreateDek });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const payload = { type: 'expense', amount: '45000', merchant: 'Kopi Kenangan', note: 'rapat tim', tags: ['kerja'] };

describe('drafts', () => {
  it('lists nothing before the first draft', async () => {
    expect(await asApp(() => drafts.list(alice, 'transaction'))).toEqual([]);
  });

  it('saves encrypted payloads and lists them per kind, newest first', async () => {
    const first = await asApp(() => drafts.save(alice, { kind: 'transaction', payload }));
    const second = await asApp(() => drafts.save(alice, { kind: 'transaction', payload: { type: 'income' } }));
    await asApp(() => drafts.save(alice, { kind: 'transfer', payload: { sent: '1' } }));

    const [stored] = await test.query<{ payload_enc: Uint8Array }>('SELECT payload_enc FROM drafts WHERE id = $1', [
      first.id,
    ]);
    expect(Buffer.from(stored?.payload_enc ?? []).toString('latin1')).not.toContain('Kopi Kenangan');

    const listed = await asApp(() => drafts.list(alice, 'transaction'));
    expect(listed.map((draft) => [draft.id, draft.payload])).toEqual([
      [second.id, { type: 'income' }],
      [first.id, payload],
    ]);
    expect(listed[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it('updates a draft in place and moves it to the top', async () => {
    const first = await asApp(() => drafts.save(alice, { kind: 'transaction', payload }));
    const second = await asApp(() => drafts.save(alice, { kind: 'transaction', payload: { type: 'income' } }));
    const updated = await asApp(() =>
      drafts.save(alice, { id: first.id, kind: 'transaction', payload: { ...payload, amount: '50000' } }),
    );
    expect(updated).toEqual(first);
    const listed = await asApp(() => drafts.list(alice, 'transaction'));
    expect(listed.map((draft) => draft.id)).toEqual([first.id, second.id]);
    expect(listed[0]?.payload).toMatchObject({ amount: '50000' });
  });

  it('removes drafts and keeps users apart', async () => {
    const { id } = await asApp(() => drafts.save(alice, { kind: 'transaction', payload }));
    expect(await asApp(() => drafts.list(bob, 'transaction'))).toEqual([]);
    await expect(asApp(() => drafts.save(bob, { id, kind: 'transaction', payload: {} }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(asApp(() => drafts.remove(bob, id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await asApp(() => drafts.remove(alice, id));
    expect(await asApp(() => drafts.list(alice, 'transaction'))).toEqual([]);
    await expect(asApp(() => drafts.remove(alice, randomUUID()))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is not writable by the worker', async () => {
    const dek = await asApp(() => keys.getOrCreateDek(alice));
    const workerDrafts = createDrafts(test.db, { getDek: () => Promise.resolve(dek) });
    await expect(
      test.as('wf_worker', () => workerDrafts.save(alice, { kind: 'transaction', payload })),
    ).rejects.toMatchObject(pgError(/permission denied for table drafts/));
  });
});
