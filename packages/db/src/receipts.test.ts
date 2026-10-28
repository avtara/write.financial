// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { decryptText } from '@wf/crypto/cipher';
import { parseLocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureGetDek, ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createFxRates } from './fx-rates.ts';
import { createReceiptJobs, type ReceiptPayload } from './receipt-jobs.ts';
import { createReceipts, attachReceiptIn, receiptDuplicateIn } from './receipts.ts';
import { createReview } from './review.ts';
import { createPeriods } from './periods.ts';
import { createTransactions } from './transactions.ts';
import { withUser } from './db.ts';
let test: TestDatabase;
let alice: LedgerFixture;
let bob: LedgerFixture;
const now = new Date('2026-10-15T09:00:00Z');
const options = { getDek: fixtureGetDek, now: () => now };
const app = <T>(work: () => Promise<T>) => test.as('wf_app', work);
const worker = <T>(work: () => Promise<T>) => test.as('wf_worker', work);
const receipts = () => createReceipts(test.db, options);
const jobs = () => createReceiptJobs(test.db, options);
const reviews = () => createReview(test.db, options);
const count = async () => (await test.query<{ n: number }>('SELECT count(*)::int AS n FROM transactions'))[0]?.n;
const evidence = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    merchant: 'Apotek K-24',
    description: 'Obat',
    amountMinor: '96500',
    currency: 'IDR',
    date: '2026-10-15',
    time: '15:20',
    accountId: alice.bca,
    categoryId: alice.category('system:health'),
    uncertain: ['account'],
    items: [{ name: 'Plester luka', quantity: '1', amountMinor: null, uncertain: true }],
    ...patch,
  });
async function stage(text?: string, patch: Partial<ReceiptPayload> = {}) {
  const id = randomUUID();
  const key = `u/${alice.userId}/${randomUUID()}`;
  const payload: ReceiptPayload = {
    name: 'apotek-private.jpg',
    original: { key, size: 100, sha256: 'a'.repeat(64), mime: 'image/webp' },
    pages: [{ key, size: 100, sha256: 'a'.repeat(64), mime: 'image/webp' }],
    timeZone: 'Asia/Jakarta',
    evidence: null,
    ...patch,
  };
  expect(
    await app(() => receipts().stage(alice.userId, { id, revision: randomUUID(), provider: 'openrouter', payload })),
  ).toBe(true);
  await worker(() => jobs().claim(alice.userId, id));
  if (text !== undefined) await worker(() => jobs().complete(alice.userId, id, text));
  return { id, payload };
}
beforeAll(async () => {
  test = await startMigrated();
  alice = await ledgerFixture(test, 'receipts-alice@example.test');
  bob = await ledgerFixture(test, 'receipts-bob@example.test');
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});
describe('receipt proposals and confirmation', () => {
  it('creates no ledger row until confirmation, atomically attaches encrypted evidence and replays exactly once', async () => {
    const before = await count();
    const original = evidence();
    const { id } = await stage(original);
    const view = await app(() => receipts().get(alice.userId, id));
    expect(view).toMatchObject({ status: 'ready', draft: { source: 'receipt', amountMinor: 96500n } });
    expect(await count()).toBe(before);
    expect(await worker(() => jobs().claim(alice.userId, id))).toBeNull();
    const result = await app(() =>
      reviews().confirm(alice.userId, view.reviewItemId as string, {
        amountMinor: 97500n,
        merchant: 'Apotek K-24 dikoreksi',
        receiptItems: [{ name: 'Plester luka', quantity: '1', amountMinor: 12500n, uncertain: false }],
      }),
    );
    expect(await count()).toBe((before ?? 0) + 1);
    expect(await app(() => reviews().confirm(alice.userId, view.reviewItemId as string))).toEqual(result);
    const [attachment] = await test.query<{ name_enc: Uint8Array; ocr_enc: Uint8Array }>(
      'SELECT name_enc, ocr_enc FROM attachments WHERE transaction_id = $1',
      [result.transactionId],
    );
    const dek = await fixtureGetDek();
    expect(
      decryptText(dek, attachment?.name_enc as Uint8Array, { userId: alice.userId, purpose: 'attachments.name' }),
    ).toBe('apotek-private.jpg');
    expect(
      JSON.parse(
        decryptText(dek, attachment?.ocr_enc as Uint8Array, { userId: alice.userId, purpose: 'attachments.ocr' }),
      ),
    ).toEqual({
      original,
      correctedItems: [{ name: 'Plester luka', quantity: '1', amountMinor: '12500', uncertain: false }],
    });
    expect(await test.query('SELECT source FROM transactions WHERE id = $1', [result.transactionId])).toEqual([
      { source: 'receipt' },
    ]);
    expect(await test.query('SELECT merchant FROM transactions WHERE id=$1', [result.transactionId])).toEqual([
      { merchant: 'Apotek K-24 dikoreksi' },
    ]);
    expect(
      await app(() => createTransactions(test.db, options).remove(alice.userId, [result.transactionId as string])),
    ).toEqual({ deleted: [result.transactionId] });
    expect(
      await app(() => createTransactions(test.db, options).restore(alice.userId, [result.transactionId as string])),
    ).toEqual({ restored: [result.transactionId] });
  });
  it('denies cross-tenant status, cancel, OCR claim, manual draft, and review confirmation', async () => {
    const { id } = await stage(evidence());
    const view = await app(() => receipts().get(alice.userId, id));
    for (const work of [
      () => receipts().get(bob.userId, id),
      () => receipts().cancel(bob.userId, id),
      () => reviews().confirm(bob.userId, view.reviewItemId as string),
    ]) {
      await expect(app<unknown>(work)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(worker(() => jobs().claim(bob.userId, id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      app(() =>
        receipts().manual(bob.userId, id, {
          type: 'expense',
          accountId: bob.bca,
          amountMinor: 1n,
          categoryId: bob.category('system:food'),
          occurredAt: now,
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('attaches a matching duplicate only on confirmation without growing the ledger; record-new is a separate explicit choice', async () => {
    const existing = await app(() =>
      createTransactions(test.db, options).create(alice.userId, {
        type: 'expense',
        accountId: alice.bca,
        amountMinor: 110000n,
        categoryId: alice.category('system:food'),
        merchant: 'Indomaret',
        occurredAt: new Date('2026-10-15T00:55:00Z'),
        clientId: randomUUID(),
      }),
    );
    const { id } = await stage(evidence({ merchant: 'Indomaret', amountMinor: '110000', time: '07:55' }));
    const view = await app(() => receipts().get(alice.userId, id));
    expect(view.duplicates.map((entry) => entry.id)).toContain(existing.id);
    const before = await count();
    await expect(
      app(() => reviews().confirm(alice.userId, view.reviewItemId as string, { receiptDuplicateId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const result = await app(() =>
      reviews().confirm(alice.userId, view.reviewItemId as string, { receiptDuplicateId: existing.id }),
    );
    expect(result.transactionId).toBe(existing.id);
    expect(await count()).toBe(before);
    await app(() => reviews().confirm(alice.userId, view.reviewItemId as string, { receiptDuplicateId: existing.id }));
    expect(
      await test.query('SELECT count(*)::int AS n FROM attachments WHERE transaction_id = $1', [existing.id]),
    ).toEqual([{ n: 1 }]);
    const next = await stage(evidence({ merchant: 'Indomaret', amountMinor: '110000', time: '07:55' }));
    const nextView = await app(() => receipts().get(alice.userId, next.id));
    await app(() => reviews().confirm(alice.userId, nextView.reviewItemId as string));
    expect(await count()).toBe((before ?? 0) + 1);
  });
  it('finds and explicitly attaches same-currency duplicates across accounts without leaking another tenant or currency', async () => {
    const merchant = 'Cross-account receipt';
    const existing = await alice.entry('expense', '2026-10-15', 110000n, alice.category('system:food'), {
      merchant,
      accountId: alice.jago,
    });
    await bob.entry('expense', '2026-10-15', 110000n, bob.category('system:food'), { merchant });
    const [usdAccount] = await test.query<{ id: string }>(
      `INSERT INTO accounts (user_id,type,provider_name,display_name,currency,opening_balance_minor,opening_date,color)
       VALUES ($1,'bank','USD fixture','USD duplicate exclusion','USD',100000000,'2026-01-01','blue') RETURNING id`,
      [alice.userId],
    );
    if (usdAccount === undefined) throw new Error('Missing USD fixture account');
    await app(() =>
      createFxRates(test.db).upsertManual(alice.userId, {
        base: 'USD',
        quote: 'IDR',
        rate: '16350.0275',
        asOf: parseLocalDate('2026-10-01'),
      }),
    );
    await alice.entry('expense', '2026-10-15', 110000n, alice.category('system:food'), {
      merchant,
      accountId: usdAccount.id,
    });
    const { id } = await stage(evidence({ merchant, amountMinor: '110000', time: '12:00', accountId: alice.bca }));
    const view = await app(() => receipts().get(alice.userId, id));
    expect(view.draft).toMatchObject({ accountId: alice.bca });
    expect(view.duplicates.map((entry) => entry.id)).toEqual([existing]);
    const before = await count();
    const result = await app(() =>
      reviews().confirm(alice.userId, view.reviewItemId as string, { receiptDuplicateId: existing }),
    );
    expect(result.transactionId).toBe(existing);
    expect(await count()).toBe(before);
    expect(await test.query('SELECT transaction_id FROM attachments WHERE transaction_id=$1', [existing])).toEqual([
      { transaction_id: existing },
    ]);
  });
  it('keeps a failed confirmation and original receipt intact and rejects foreign accounts/categories', async () => {
    const { id } = await stage(evidence());
    const view = await app(() => receipts().get(alice.userId, id));
    const before = await count();
    await expect(
      app(() => reviews().confirm(alice.userId, view.reviewItemId as string, { accountId: bob.bca })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      app(() =>
        reviews().confirm(alice.userId, view.reviewItemId as string, { categoryId: bob.category('system:food') }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await count()).toBe(before);
    expect(await app(() => receipts().get(alice.userId, id))).toMatchObject({ status: 'ready' });
  });
  it('permits manual entry after failed OCR but only through a proposal and the same explicit confirmation', async () => {
    const { id } = await stage();
    await worker(() => jobs().fail(alice.userId, id, 'RECEIPT_UNREADABLE'));
    const before = await count();
    const itemId = await app(() =>
      receipts().manual(alice.userId, id, {
        type: 'expense',
        occurredAt: now,
        accountId: alice.bca,
        amountMinor: 42000n,
        categoryId: alice.category('system:food'),
        description: 'Manual receipt',
      }),
    );
    expect(await count()).toBe(before);
    const result = await app(() => reviews().confirm(alice.userId, itemId));
    expect(await count()).toBe((before ?? 0) + 1);
    expect(await test.query('SELECT kind FROM attachments WHERE transaction_id = $1', [result.transactionId])).toEqual([
      { kind: 'receipt' },
    ]);
  });
  it('cancels without ledger writes and fences interrupted jobs against another billed replay', async () => {
    const before = await count();
    const staged = await stage();
    expect(await worker(() => jobs().claim(alice.userId, staged.id))).toBeNull();
    expect(await app(() => receipts().get(alice.userId, staged.id))).toMatchObject({
      status: 'failed',
      errorCode: 'RECEIPT_INTERRUPTED',
    });
    expect(await app(() => receipts().cancel(alice.userId, staged.id))).toEqual([staged.payload.original.key]);
    await worker(() => jobs().complete(alice.userId, staged.id, evidence()));
    expect(await count()).toBe(before);
    expect(await app(() => receipts().get(alice.userId, staged.id))).toMatchObject({
      status: 'cancelled',
      reviewItemId: null,
    });
  });
  it('keeps ordered auto-rules as editable suggestions, not ledger writes', async () => {
    await test.query('INSERT INTO auto_rules (user_id,name,position,conditions,actions) VALUES ($1,$2,0,$3,$4)', [
      alice.userId,
      'First',
      JSON.stringify([{ field: 'description', op: 'containsAny', values: ['Apotek'] }]),
      JSON.stringify([
        { type: 'setCategory', categoryId: alice.category('system:food') },
        { type: 'addTag', tag: 'kesehatan' },
      ]),
    ]);
    await test.query('INSERT INTO auto_rules (user_id,name,position,conditions,actions) VALUES ($1,$2,1,$3,$4)', [
      alice.userId,
      'Second',
      JSON.stringify([{ field: 'description', op: 'containsAny', values: ['Apotek'] }]),
      JSON.stringify([
        { type: 'setCategory', categoryId: alice.category('system:health') },
        { type: 'addTag', tag: 'struk' },
      ]),
    ]);
    const before = await count();
    const { id } = await stage(evidence());
    const view = await app(() => receipts().get(alice.userId, id));
    expect(view.draft).toMatchObject({ categoryId: alice.category('system:food'), tags: ['kesehatan', 'struk'] });
    expect(await count()).toBe(before);
    await app(() =>
      reviews().confirm(alice.userId, view.reviewItemId as string, {
        categoryId: alice.category('system:health'),
        tags: [],
      }),
    );
    await test.query('DELETE FROM auto_rules WHERE user_id=$1', [alice.userId]);
  });

  it('keeps staging and manual correction replays idempotent and fences late failures after cancellation', async () => {
    const staged = await stage();
    expect(
      await app(() =>
        receipts().stage(alice.userId, {
          id: staged.id,
          revision: randomUUID(),
          provider: 'openrouter',
          payload: { ...staged.payload, name: 'redundant.jpg' },
        }),
      ),
    ).toBe(false);
    expect((await app(() => receipts().get(alice.userId, staged.id))).name).toBe('apotek-private.jpg');
    const draft = {
      type: 'expense' as const,
      occurredAt: now,
      accountId: alice.bca,
      amountMinor: 400n,
      categoryId: null,
    };
    await expect(app(() => receipts().manual(alice.userId, staged.id, draft))).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION',
    });
    await worker(() => jobs().fail(alice.userId, staged.id, 'RECEIPT_UNREADABLE', 'private failed extraction'));
    const itemId = await app(() => receipts().manual(alice.userId, staged.id, draft));
    expect(await app(() => receipts().manual(alice.userId, staged.id, draft))).toBe(itemId);
    const result = await app(() => reviews().confirm(alice.userId, itemId));
    const dek = await fixtureGetDek();
    await app(() =>
      withUser(test.db, alice.userId, (tx) =>
        attachReceiptIn(tx, alice.userId, dek, staged.id, result.transactionId as string, now),
      ),
    );
    await expect(
      app(() =>
        withUser(test.db, alice.userId, (tx) => attachReceiptIn(tx, alice.userId, dek, staged.id, randomUUID(), now)),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
    expect(await app(() => receipts().cancel(alice.userId, staged.id))).toEqual([]);
    const [attachment] = await test.query<{ ocr_enc: Uint8Array }>(
      'SELECT ocr_enc FROM attachments WHERE transaction_id=$1',
      [result.transactionId],
    );
    expect(
      decryptText(dek, attachment?.ocr_enc as Uint8Array, { userId: alice.userId, purpose: 'attachments.ocr' }),
    ).toContain('private failed extraction');
    const pending = await stage(evidence());
    await app(() => receipts().cancel(alice.userId, pending.id));
    expect(await test.query('SELECT status FROM review_items WHERE dedupe_key=$1', [`receipt.${pending.id}`])).toEqual([
      { status: 'ignored' },
    ]);
    await worker(() => jobs().fail(alice.userId, pending.id, 'LATE_FAILURE'));
    expect((await app(() => receipts().get(alice.userId, pending.id))).status).toBe('cancelled');
  });

  it('refuses absent evidence, missing/deleted targets, wrong currency and non-ready attachment transitions atomically', async () => {
    const reading = await stage();
    const ready = await stage(evidence());
    const dek = await fixtureGetDek();
    await expect(
      app(() =>
        withUser(test.db, alice.userId, (tx) => receiptDuplicateIn(tx, alice.userId, dek, reading.id, randomUUID())),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
    await expect(
      app(() =>
        withUser(test.db, alice.userId, (tx) => attachReceiptIn(tx, alice.userId, dek, reading.id, randomUUID(), now)),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
    await expect(
      app(() =>
        withUser(test.db, alice.userId, (tx) => attachReceiptIn(tx, alice.userId, dek, ready.id, randomUUID(), now)),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [foreignCurrency] = await test.query<{ id: string }>(
      "SELECT id FROM accounts WHERE user_id=$1 AND currency='USD'",
      [alice.userId],
    );
    if (foreignCurrency === undefined) throw new Error('USD account missing');
    const target = await alice.entry('expense', '2026-10-15', 100n, alice.category('system:food'), {
      accountId: foreignCurrency.id,
    });
    await expect(
      app(() => withUser(test.db, alice.userId, (tx) => attachReceiptIn(tx, alice.userId, dek, ready.id, target, now))),
    ).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' });
    expect((await app(() => receipts().get(alice.userId, ready.id))).status).toBe('ready');
    await test.query('UPDATE receipt_uploads SET review_item_id=NULL WHERE id=$1', [ready.id]);
    await expect(
      app(() => withUser(test.db, alice.userId, (tx) => receiptDuplicateIn(tx, alice.userId, dek, ready.id, target))),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
  });

  it('attaches PDF originals with an optional thumbnail and keeps reviewed evidence when pages are absent', async () => {
    for (const withPage of [false, true]) {
      const original = {
        key: `u/${alice.userId}/${randomUUID()}`,
        size: 100,
        sha256: 'b'.repeat(64),
        mime: 'application/pdf',
      };
      const page = { ...original, key: `u/${alice.userId}/${randomUUID()}`, mime: 'image/webp' };
      const staged = await stage(evidence(), { original, pages: withPage ? [page] : [] });
      const view = await app(() => receipts().get(alice.userId, staged.id));
      const result = await app(() => reviews().confirm(alice.userId, view.reviewItemId as string));
      expect(
        await test.query('SELECT object_key,thumbnail_key FROM attachments WHERE transaction_id=$1', [
          result.transactionId,
        ]),
      ).toEqual([{ object_key: original.key, thumbnail_key: withPage ? page.key : null }]);
    }
  });

  it('uses only owned matching-currency accounts, drops unavailable categories and overflowing rule tags, never writes the ledger', async () => {
    const before = await count();
    const noCurrency = await stage();
    await expect(
      worker(() => jobs().complete(alice.userId, noCurrency.id, evidence({ currency: 'JPY' }))),
    ).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' });
    const fallback = await stage(evidence({ accountId: bob.bca, categoryId: null }));
    const fallbackDraft = (await app(() => receipts().get(alice.userId, fallback.id))).draft;
    if (fallbackDraft?.type !== 'expense') throw new Error('Ready receipt must propose an expense');
    expect(fallbackDraft.categoryId).toBeNull();
    expect(await test.query('SELECT user_id,currency FROM accounts WHERE id=$1', [fallbackDraft.accountId])).toEqual([
      { user_id: alice.userId, currency: 'IDR' },
    ]);
    await test.query('UPDATE categories SET archived_at=$1 WHERE id=$2', [now, alice.category('system:health')]);
    const archived = await stage(evidence());
    expect((await app(() => receipts().get(alice.userId, archived.id))).draft).toMatchObject({
      type: 'expense',
      categoryId: null,
    });
    await test.query('UPDATE categories SET archived_at=NULL WHERE id=$1', [alice.category('system:health')]);
    await test.query('INSERT INTO auto_rules(user_id,name,position,conditions,actions) VALUES($1,$2,0,$3,$4)', [
      alice.userId,
      'Overflow',
      JSON.stringify([{ field: 'description', op: 'containsAny', values: ['Overflow'] }]),
      JSON.stringify(Array.from({ length: 6 }, (_, index) => ({ type: 'addTag', tag: `tag-${index}` }))),
    ]);
    const overflow = await stage(evidence({ merchant: 'Overflow' }));
    expect((await app(() => receipts().get(alice.userId, overflow.id))).draft?.tags).toEqual([]);
    await test.query('DELETE FROM auto_rules WHERE user_id=$1', [alice.userId]);
    expect(await count()).toBe(before);
  });
  it('honors closed-period guards without dropping a ready receipt', async () => {
    await app(() =>
      createTransactions(test.db, options).create(alice.userId, {
        type: 'expense',
        accountId: alice.bca,
        amountMinor: 96500n,
        categoryId: alice.category('system:health'),
        merchant: 'Apotek K-24',
        occurredAt: new Date('2026-10-15T08:20:00Z'),
        clientId: randomUUID(),
      }),
    );
    const { id } = await stage(evidence());
    const view = await app(() => receipts().get(alice.userId, id));
    const duplicateId = view.duplicates[0]?.id;
    expect(duplicateId).toBeDefined();
    const beforeAttachments = await test.query('SELECT count(*) AS n FROM attachments');
    const before = await count();
    await app(() => createPeriods(test.db, { now: () => now }).list(alice.userId));
    await test.query(
      "UPDATE periods SET status='closed', closed_at=$1 WHERE user_id=$2 AND start_date <= '2026-10-15' AND end_date >= '2026-10-15'",
      [now, alice.userId],
    );
    await expect(app(() => reviews().confirm(alice.userId, view.reviewItemId as string))).rejects.toMatchObject({
      code: 'PERIOD_CLOSED',
    });
    await expect(
      app(() =>
        reviews().confirm(alice.userId, view.reviewItemId as string, { receiptDuplicateId: duplicateId as string }),
      ),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    expect(await test.query('SELECT count(*) AS n FROM attachments')).toEqual(beforeAttachments);
    expect(await count()).toBe(before);
    expect(await app(() => receipts().get(alice.userId, id))).toMatchObject({ status: 'ready' });
  });
});
