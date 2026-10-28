// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeReceipt, encodeReceipt, createReceiptJobs, type ReceiptPayload } from './receipt-jobs.ts';
import { createReceipts } from './receipts.ts';
import { createTransactions } from './transactions.ts';
import { fixtureGetDek, ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
describe('receipt evidence confidentiality', () => {
  it('authenticates both tenant and staged receipt identity and never stores plaintext names or OCR', () => {
    const dek = generateDek();
    const payload: ReceiptPayload = {
      name: 'private-apotek.jpg',
      original: { key: 'secret-object', size: 100, sha256: 'hash', mime: 'image/webp' },
      pages: [],
      timeZone: 'Asia/Jakarta',
      evidence: 'private OCR total 96500',
    };
    const encrypted = encodeReceipt(dek, 'alice', 'receipt-a', payload);
    expect(Buffer.from(encrypted).toString()).not.toContain('private');
    expect(decodeReceipt(dek, 'alice', 'receipt-a', encrypted)).toEqual(payload);
    expect(() => decodeReceipt(dek, 'bob', 'receipt-a', encrypted)).toThrow();
    expect(() => decodeReceipt(dek, 'alice', 'receipt-b', encrypted)).toThrow();
  });
});

let test: TestDatabase;
let alice: LedgerFixture;
let bob: LedgerFixture;
const app = <T>(work: () => Promise<T>) => test.as('wf_app', work);
const worker = <T>(work: () => Promise<T>) => test.as('wf_worker', work);
beforeAll(async () => {
  test = await startMigrated();
  alice = await ledgerFixture(test, 'receipt-retention-alice@example.test');
  bob = await ledgerFixture(test, 'receipt-retention-bob@example.test');
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});

describe('receipt retention and late worker results', () => {
  it('releases expired and ignored evidence, dedupes shared pages, preserves live reviews and attached objects across tenants', async () => {
    const repository = createReceipts(test.db, { getDek: fixtureGetDek });
    const jobs = createReceiptJobs(test.db, { getDek: fixtureGetDek });
    const staged = async (owner: string, status: string, ageDays: number, pages = true) => {
      const id = randomUUID();
      const original = { key: `u/${owner}/${randomUUID()}`, mime: 'application/pdf', size: 20, sha256: 'a'.repeat(64) };
      const page = { ...original, key: `u/${owner}/${randomUUID()}`, mime: 'image/webp' };
      await app(() =>
        repository.stage(owner, {
          id,
          revision: randomUUID(),
          provider: 'openrouter',
          payload: { name: 'private.pdf', original, pages: pages ? [page, page] : [], evidence: null, timeZone: 'UTC' },
        }),
      );
      await test.query('UPDATE receipt_uploads SET status=$2,updated_at=$3 WHERE id=$1', [
        id,
        status,
        new Date(Date.now() - ageDays * 86400000),
      ]);
      return { id, original: original.key, page: page.key };
    };
    const expired = await staged(alice.userId, 'reading', 8);
    const recent = await staged(alice.userId, 'queued', 6);
    const orphanReady = await staged(alice.userId, 'ready', 8, false);
    const foreign = await staged(bob.userId, 'failed', 8);
    const attached = await staged(alice.userId, 'attached', 0);
    const txId = await alice.entry('expense', '2026-10-15', 10n, alice.category('system:food'));
    await app(() =>
      createTransactions(test.db, { getDek: fixtureGetDek }).addAttachment(alice.userId, txId, {
        bucket: 'attachments',
        objectKey: attached.original,
        thumbnailKey: attached.page,
        mime: 'application/pdf',
        size: 20,
        sha256: 'a'.repeat(64),
        kind: 'receipt',
        name: 'private.pdf',
      }),
    );
    await app(() =>
      createTransactions(test.db, { getDek: fixtureGetDek }).addAttachment(alice.userId, txId, {
        bucket: 'attachments',
        objectKey: `u/${alice.userId}/${randomUUID()}`,
        thumbnailKey: null,
        mime: 'image/webp',
        size: 20,
        sha256: 'a'.repeat(64),
        kind: 'image',
        name: 'other.webp',
      }),
    );
    const pending = await staged(alice.userId, 'ready', 0);
    const ignored = await staged(alice.userId, 'ready', 0);
    for (const [row, status] of [
      [pending, 'pending'],
      [ignored, 'ignored'],
    ] as const) {
      const [item] = await test.query<{ id: string }>(
        `INSERT INTO review_items
        (user_id,reason,source,status,payload_enc,dedupe_key,resolved_at)
        VALUES ($1,'ai_suggestion','receipt',$2,$3,$4,$5) RETURNING id`,
        [alice.userId, status, new Uint8Array([1]), `retention.${row.id}`, status === 'ignored' ? new Date() : null],
      );
      await test.query('UPDATE receipt_uploads SET review_item_id=$2 WHERE id=$1', [row.id, item?.id]);
    }
    const before = await test.query('SELECT count(*) AS n FROM transactions');
    const released = await worker(() => jobs.cleanup(alice.userId));
    expect(new Set(released)).toEqual(new Set([expired.original, expired.page, ignored.original, ignored.page]));
    expect(released).toHaveLength(4);
    expect(released).not.toContain(foreign.original);
    for (const row of [recent, orphanReady, pending]) {
      expect(released).not.toContain(row.original);
    }
    expect(await test.query('SELECT status FROM receipt_uploads WHERE id=$1', [attached.id])).toEqual([
      { status: 'attached' },
    ]);
    expect(await test.query('SELECT status,error_code FROM receipt_uploads WHERE id=$1', [expired.id])).toEqual([
      { status: 'cancelled', error_code: 'RECEIPT_EXPIRED' },
    ]);
    await worker(() => jobs.fail(alice.userId, expired.id, 'LATE_PRIVATE_FAILURE'));
    await worker(() => jobs.fail(alice.userId, randomUUID(), 'LATE_PRIVATE_FAILURE'));
    expect(await test.query('SELECT status,error_code FROM receipt_uploads WHERE id=$1', [expired.id])).toEqual([
      { status: 'cancelled', error_code: 'RECEIPT_EXPIRED' },
    ]);
    expect(await test.query('SELECT count(*) AS n FROM transactions')).toEqual(before);
  });

  it('retains queued evidence at exactly seven days and releases it only after the cutoff', async () => {
    const [owner] = await test.query<{ id: string }>(
      "INSERT INTO users(name,email) VALUES('Retention edge','receipt-retention-edge@example.test') RETURNING id",
    );
    if (owner === undefined) throw new Error('Missing retention owner');
    const at = new Date('2026-10-15T09:00:00Z');
    const cutoff = new Date(at.getTime() - 7 * 86400000);
    const repository = createReceipts(test.db, { getDek: fixtureGetDek, now: () => at });
    const objects: { id: string; key: string }[] = [];
    for (const updatedAt of [cutoff, new Date(cutoff.getTime() - 1)]) {
      const id = randomUUID();
      const original = { key: `u/${owner.id}/${randomUUID()}`, size: 1, sha256: 'a'.repeat(64), mime: 'image/webp' };
      await app(() =>
        repository.stage(owner.id, {
          id,
          revision: randomUUID(),
          provider: 'openrouter',
          payload: { name: 'receipt.webp', original, pages: [], evidence: null, timeZone: 'UTC' },
        }),
      );
      await test.query('UPDATE receipt_uploads SET updated_at=$2 WHERE id=$1', [id, updatedAt]);
      objects.push({ id, key: original.key });
    }
    const released = await worker(() =>
      createReceiptJobs(test.db, { getDek: fixtureGetDek, now: () => at }).cleanup(owner.id),
    );
    expect(released).toEqual([objects[1]?.key]);
    expect(await test.query('SELECT status FROM receipt_uploads WHERE id=$1', [objects[0]?.id])).toEqual([
      { status: 'queued' },
    ]);
  });

  it('expires a ready receipt only once its proposal was ignored, keeping a still-pending one ready', async () => {
    const owner = await ledgerFixture(test, 'receipt-retention-ready@example.test');
    const repository = createReceipts(test.db, { getDek: fixtureGetDek });
    const ready: Record<'ignored' | 'pending', { id: string; key: string }> = {
      ignored: { id: randomUUID(), key: `u/${owner.userId}/${randomUUID()}` },
      pending: { id: randomUUID(), key: `u/${owner.userId}/${randomUUID()}` },
    };
    for (const [status, { id, key }] of Object.entries(ready)) {
      await app(() =>
        repository.stage(owner.userId, {
          id,
          revision: randomUUID(),
          provider: 'openrouter',
          payload: {
            name: 'receipt.webp',
            original: { key, size: 1, sha256: 'a'.repeat(64), mime: 'image/webp' },
            pages: [],
            evidence: null,
            timeZone: 'UTC',
          },
        }),
      );
      const [item] = await test.query<{ id: string }>(
        `INSERT INTO review_items (user_id,reason,source,status,payload_enc,dedupe_key,resolved_at)
        VALUES ($1,'ai_suggestion','receipt',$2,$3,$4,$5) RETURNING id`,
        [owner.userId, status, new Uint8Array([1]), `retention.${id}`, status === 'ignored' ? new Date() : null],
      );
      await test.query("UPDATE receipt_uploads SET status='ready',review_item_id=$2 WHERE id=$1", [id, item?.id]);
    }
    const released = await worker(() => createReceiptJobs(test.db, { getDek: fixtureGetDek }).cleanup(owner.userId));
    expect(released).toEqual([ready.ignored.key]);
    expect(
      await test.query('SELECT id,status,error_code FROM receipt_uploads WHERE user_id=$1 ORDER BY status::text', [
        owner.userId,
      ]),
    ).toEqual([
      { id: ready.ignored.id, status: 'cancelled', error_code: 'RECEIPT_EXPIRED' },
      { id: ready.pending.id, status: 'ready', error_code: null },
    ]);
  });
});
