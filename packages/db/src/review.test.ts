// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek, ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { recordTransactionIn } from './ledger-core.ts';
import { createReview, type ReviewRepository } from './review.ts';
import { insertReviewItemIn, occurrenceReviewItemIn, type NewReviewItem, type ReviewPayload } from './review-items.ts';

// 20 Okt 2026 10.00 WIB.
const NOW = new Date('2026-10-20T03:00:00Z');

let test: TestDatabase;
let ledger: LedgerFixture;
let userId: string;
let review: ReviewRepository;
let september: string;
let october: string;
let november: string;

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

async function one(text: string, params: unknown[]): Promise<string> {
  const [row] = await test.query<{ id: string }>(text, params);
  return row?.id as string;
}

const period = (start: string, end: string, label: string, closed: boolean) =>
  one(
    `INSERT INTO periods (user_id, label, start_date, end_date, days, status, closed_at)
     VALUES ($1, $2, $3, $4, $4::date - $3::date + 1, $5::period_status, $6) RETURNING id`,
    [userId, label, start, end, closed ? 'closed' : 'open', closed ? '2026-10-01T00:05:00+07:00' : null],
  );

const subscription = (next = '2026-10-18', extra: { cycle?: string; name?: string } = {}) =>
  one(
    `INSERT INTO subscriptions (user_id, name, price_minor, currency, cycle, next_billing_date, pay_from_account_id, category_id, started_on)
     VALUES ($1, $2, 186000, 'IDR', $3::subscription_cycle, $4, $5, $6, '2025-01-18') RETURNING id`,
    [
      userId,
      extra.name ?? 'Netflix',
      extra.cycle ?? 'monthly',
      next,
      ledger.bca,
      ledger.category('system:subscriptions'),
    ],
  );

const occurrence = (sourceId: string, due: string, status = 'due_review', type = 'subscription') =>
  one(
    `INSERT INTO scheduled_occurrences (user_id, source_type, source_id, due_date, expected_minor, currency, status)
     VALUES ($1, $2::occurrence_source, $3, $4, 186000, 'IDR', $5::occurrence_status) RETURNING id`,
    [userId, type, sourceId, due, status],
  );

const insertItem = (item: NewReviewItem) =>
  asApp(async () => {
    const dek = await fixtureGetDek();
    return withUser(test.db, userId, (tx) => insertReviewItemIn(tx, userId, dek, item));
  }).then((result) => result.id);

const occurrenceItem = (occurrenceId: string) =>
  asApp(async () => {
    const dek = await fixtureGetDek();
    return withUser(test.db, userId, async (tx) =>
      insertReviewItemIn(tx, userId, dek, await occurrenceReviewItemIn(tx, userId, occurrenceId)),
    );
  }).then((result) => result.id);

const draftItem = (payload: ReviewPayload, extra: Partial<NewReviewItem> = {}) =>
  insertItem({ reason: 'ai_suggestion', source: 'assistant', dedupeKey: randomUUID(), payload, ...extra });

async function balance(accountId: string): Promise<bigint> {
  const [row] = await test.query<{ total: string }>(
    'SELECT coalesce(sum(amount_minor), 0)::text AS total FROM postings WHERE account_id = $1',
    [accountId],
  );
  return BigInt(row?.total ?? '0');
}

const row = async <T>(text: string, params: unknown[]) => (await test.query<T>(text, params))[0] as T;

const nextBilling = async (id: string) =>
  (await row<{ d: string }>('SELECT next_billing_date::text AS d FROM subscriptions WHERE id = $1', [id])).d;

const occurrenceStatus = async (id: string) =>
  row<{ status: string; transaction_id: string | null }>(
    'SELECT status, transaction_id FROM scheduled_occurrences WHERE id = $1',
    [id],
  );

beforeAll(async () => {
  test = await startMigrated();
  review = createReview(test.db, { getDek: fixtureGetDek, now: () => NOW });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  ledger = await ledgerFixture(test, 'alice@example.test');
  userId = ledger.userId;
  september = await period('2026-09-01', '2026-09-30', '2026-09', true);
  october = await period('2026-10-01', '2026-10-31', '2026-10', false);
  november = await period('2026-11-01', '2026-11-30', '2026-11', false);
});

describe('confirm a due bill', () => {
  it('records exactly one transaction only on confirmation and advances the subscription', async () => {
    const netflix = await subscription();
    const due = await occurrence(netflix, '2026-10-18');
    await occurrence(netflix, '2026-11-18', 'scheduled');
    const itemId = await occurrenceItem(due);
    const before = await balance(ledger.bca);
    expect(await test.query('SELECT id FROM transactions')).toEqual([]);

    const result = await asApp(() => review.confirm(userId, itemId));
    expect(result.overrideIds).toEqual([]);
    expect(await balance(ledger.bca)).toBe(before - 186_000n);
    expect(
      await row('SELECT client_id, source, merchant, category_id, local_date::text AS d FROM transactions', []),
    ).toEqual({
      client_id: itemId,
      source: 'recurring',
      merchant: 'Netflix',
      category_id: ledger.category('system:subscriptions'),
      d: '2026-10-18',
    });
    expect(await occurrenceStatus(due)).toEqual({ status: 'confirmed', transaction_id: result.transactionId });
    expect(
      await row('SELECT status, resolved_at, resulting_transaction_id FROM review_items WHERE id = $1', [itemId]),
    ).toEqual({ status: 'confirmed', resolved_at: NOW, resulting_transaction_id: result.transactionId });
    expect(await nextBilling(netflix)).toBe('2026-11-18');

    await expect(asApp(() => review.confirm(userId, itemId))).rejects.toMatchObject({ code: 'REVIEW_RESOLVED' });
    await expect(asApp(() => review.confirm(userId, randomUUID()))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await test.query('SELECT id FROM transactions')).toHaveLength(1);
    expect(await balance(ledger.bca)).toBe(before - 186_000n);
  });

  it('returns the transaction already recorded for the item (replay)', async () => {
    const netflix = await subscription();
    const itemId = await occurrenceItem(await occurrence(netflix, '2026-10-18'));
    const earlier = await asApp(async () => {
      const dek = await fixtureGetDek();
      return withUser(test.db, userId, (tx) =>
        recordTransactionIn(
          tx,
          userId,
          {
            type: 'expense',
            clientId: itemId,
            occurredAt: NOW,
            accountId: ledger.bca,
            amountMinor: 186_000n,
            categoryId: null,
          },
          dek,
          NOW,
        ),
      );
    });
    const before = await balance(ledger.bca);
    expect((await asApp(() => review.confirm(userId, itemId))).transactionId).toBe(earlier.id);
    expect(await balance(ledger.bca)).toBe(before);
    expect(await test.query('SELECT id FROM transactions')).toHaveLength(1);
  });

  it('applies the edits of the review card', async () => {
    const itemId = await draftItem(
      {
        kind: 'transaction',
        draft: {
          type: 'expense',
          occurredAt: NOW,
          accountId: ledger.bca,
          amountMinor: 50_000n,
          categoryId: null,
          merchant: 'Kopi',
        },
      },
      { aiConfidence: 80 },
    );
    const result = await asApp(() =>
      review.confirm(userId, itemId, {
        amountMinor: 45_000n,
        accountId: ledger.jago,
        categoryId: ledger.category('system:food'),
        occurredAt: new Date('2026-10-19T05:00:00Z'),
        description: 'Rapat',
        merchant: 'Kopi Kenangan',
        note: 'tim',
        tags: ['kerja'],
      }),
    );
    expect(
      await row(
        `SELECT t.source, t.merchant, t.description, t.category_id, t.local_date::text AS d, t.note_enc IS NOT NULL AS has_note,
                (SELECT count(*)::int FROM transaction_tags tt WHERE tt.transaction_id = t.id) AS tags
         FROM transactions t WHERE t.id = $1`,
        [result.transactionId],
      ),
    ).toEqual({
      source: 'manual',
      merchant: 'Kopi Kenangan',
      description: 'Rapat',
      category_id: ledger.category('system:food'),
      d: '2026-10-19',
      has_note: true,
      tags: 1,
    });
    expect(await balance(ledger.jago)).toBe(-45_000n);
  });

  it('applies transfer edits; the received amount follows within one currency', async () => {
    const transfer = (sentMinor: bigint, receivedMinor: bigint) =>
      draftItem({
        kind: 'transaction',
        draft: {
          type: 'transfer',
          occurredAt: NOW,
          fromAccountId: ledger.bca,
          toAccountId: ledger.jago,
          sentMinor,
          receivedMinor,
        },
      });
    const first = await transfer(100_000n, 100_000n);
    await asApp(() => review.confirm(userId, first, { amountMinor: 70_000n }));
    expect(await balance(ledger.jago)).toBe(70_000n);

    const reversed = await transfer(100_000n, 100_000n);
    await asApp(() =>
      review.confirm(userId, reversed, {
        fromAccountId: ledger.jago,
        toAccountId: ledger.bca,
        receivedMinor: 100_000n,
      }),
    );
    expect(await balance(ledger.jago)).toBe(70_000n - 100_000n);

    // Different planned amounts keep the received one (the transfer then fails: one currency must match).
    const uneven = await transfer(100_000n, 90_000n);
    await expect(asApp(() => review.confirm(userId, uneven, { amountMinor: 80_000n }))).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION',
    });
    expect(await row('SELECT status FROM review_items WHERE id = $1', [uneven])).toEqual({ status: 'pending' });
  });
});

describe('list and counts', () => {
  it('orders AI suggestions by confidence, then due items by due date, with labels', async () => {
    const netflix = await subscription();
    const spotify = await subscription('2026-10-10', { name: 'Spotify' });
    const lateBill = await occurrenceItem(await occurrence(netflix, '2026-10-18'));
    const earlyBill = await occurrenceItem(await occurrence(spotify, '2026-10-10'));
    const recurrence = await one(
      `INSERT INTO recurrences (user_id, template, freq, start_on, month_day)
       VALUES ($1, $2, 'monthly', '2026-01-25', 25) RETURNING id`,
      [
        userId,
        JSON.stringify({
          type: 'expense',
          accountId: ledger.bca,
          amountMinor: '1',
          categoryId: null,
          description: 'Kos',
        }),
      ],
    );
    const kos = await occurrenceItem(await occurrence(recurrence, '2026-10-12', 'due_review', 'recurrence'));
    const low = await draftItem(
      {
        kind: 'transaction',
        draft: {
          type: 'expense',
          occurredAt: NOW,
          accountId: ledger.bca,
          amountMinor: 1n,
          categoryId: null,
          description: 'Parkir',
        },
      },
      { aiConfidence: 40 },
    );
    const high = await draftItem(
      {
        kind: 'transaction',
        draft: {
          type: 'expense',
          occurredAt: NOW,
          accountId: ledger.bca,
          amountMinor: 1n,
          categoryId: null,
          merchant: 'Grab',
        },
      },
      { aiConfidence: 95 },
    );
    const blank = await draftItem(
      {
        kind: 'transaction',
        draft: { type: 'expense', occurredAt: NOW, accountId: ledger.bca, amountMinor: 1n, categoryId: null },
      },
      { reason: 'import_row', source: 'gmail' },
    );
    const coffee = await ledger.entry('expense', '2026-10-15', 20_000n, null, { merchant: 'Kopi' });
    const category = await insertItem({
      reason: 'category_deleted',
      source: 'system',
      dedupeKey: 'catdel',
      subjectTransactionId: coffee,
      dueDate: '2026-10-15' as LocalDate,
      payload: {
        kind: 'category',
        transactionId: coffee,
        previousCategoryId: randomUUID(),
        previousCategoryName: 'Kopi',
      },
    });
    const goal = await one(
      `INSERT INTO goals (user_id, name, icon, color, target_minor, currency) VALUES ($1, 'Dana Darurat', 'shield', 'green', 1, 'IDR') RETURNING id`,
      [userId],
    );
    const leftover = await insertItem({
      reason: 'period_close_proposal',
      source: 'period_close',
      dedupeKey: 'close.leftover',
      periodId: september,
      dueDate: '2026-10-01' as LocalDate,
      payload: {
        kind: 'leftover',
        periodId: september,
        amountMinor: 1n,
        goalId: goal,
        fromAccountId: null,
        toAccountId: null,
      },
    });
    const rollover = await insertItem({
      reason: 'period_close_proposal',
      source: 'period_close',
      dedupeKey: 'close.rollover',
      periodId: september,
      dueDate: '2026-10-01' as LocalDate,
      payload: {
        kind: 'rollover',
        periodId: september,
        nextPeriodId: october,
        categoryId: randomUUID(),
        deltaMinor: 1n,
      },
    });
    const noGoal = await insertItem({
      reason: 'period_close_proposal',
      source: 'period_close',
      dedupeKey: 'close.leftover.2',
      payload: {
        kind: 'leftover',
        periodId: september,
        amountMinor: 1n,
        goalId: null,
        fromAccountId: null,
        toAccountId: null,
      },
    });
    const lostGoal = await insertItem({
      reason: 'period_close_proposal',
      source: 'period_close',
      dedupeKey: 'close.leftover.3',
      payload: {
        kind: 'leftover',
        periodId: september,
        amountMinor: 1n,
        goalId: randomUUID(),
        fromAccountId: null,
        toAccountId: null,
      },
    });

    const { items, total } = await asApp(() => review.list(userId));
    expect(total).toBe(11);
    expect(items.map((item) => [item.id, item.label])).toEqual([
      [high, 'Grab'],
      [low, 'Parkir'],
      [leftover, 'Dana Darurat'],
      [rollover, null],
      [earlyBill, 'Spotify'],
      [kos, 'Kos'],
      [category, 'Kopi'],
      [lateBill, 'Netflix'],
      [blank, null],
      [noGoal, null],
      [lostGoal, null],
    ]);
    const late = items.find((item) => item.id === lateBill);
    expect(late).toMatchObject({
      reason: 'due_occurrence',
      source: 'schedule',
      status: 'pending',
      dueDate: '2026-10-18',
      occurrence: { sourceType: 'subscription', sourceId: netflix, status: 'due_review', dueDate: '2026-10-18' },
      payload: { kind: 'transaction', draft: { amountMinor: 186_000n, merchant: 'Netflix' } },
      resolvedAt: null,
      resultingTransactionId: null,
    });
    expect(items.find((item) => item.id === leftover)).toMatchObject({ periodLabel: '2026-09', occurrence: null });

    expect((await asApp(() => review.list(userId, { reason: 'period_close_proposal' }))).total).toBe(4);
    expect((await asApp(() => review.list(userId, { source: 'gmail' }))).items.map((item) => item.id)).toEqual([blank]);
    const page = await asApp(() => review.list(userId, { limit: 2, offset: 1 }));
    expect(page.items.map((item) => item.id)).toEqual([low, leftover]);
    expect(page.total).toBe(11);
    expect((await asApp(() => review.list(userId, { limit: 0, offset: -5 }))).items.map((item) => item.id)).toEqual([
      high,
    ]);

    expect(await asApp(() => review.counts(userId))).toEqual({
      total: 11,
      byReason: {
        ai_suggestion: 2,
        category_deleted: 1,
        due_occurrence: 3,
        import_row: 1,
        period_close_proposal: 4,
      },
    });
    await asApp(() => review.ignore(userId, [high]));
    const resolved = await asApp(() => review.list(userId, { status: 'resolved' }));
    expect(resolved.items.map((item) => [item.id, item.status])).toEqual([[high, 'ignored']]);
    expect((await asApp(() => review.counts(userId))).total).toBe(10);
  });

  it('lists nothing for a new user and uses the real clock by default', async () => {
    const plain = createReview(test.db, { getDek: fixtureGetDek });
    expect(await asApp(() => plain.list(userId))).toEqual({ items: [], total: 0 });
    const itemId = await draftItem({
      kind: 'transaction',
      draft: { type: 'expense', occurredAt: NOW, accountId: ledger.bca, amountMinor: 1n, categoryId: null },
    });
    await asApp(() => plain.confirm(userId, itemId));
    const resolved = await row<{ resolved_at: Date }>('SELECT resolved_at FROM review_items WHERE id = $1', [itemId]);
    expect(Math.abs(resolved.resolved_at.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe('bulk, ignore, and unpaid', () => {
  it('confirms each item on its own and reports the refusals', async () => {
    const netflix = await subscription();
    const bill = await occurrenceItem(await occurrence(netflix, '2026-10-18'));
    const coffee = await ledger.entry('expense', '2026-10-15', 20_000n, null);
    const lost = await insertItem({
      reason: 'category_deleted',
      source: 'system',
      dedupeKey: 'catdel.1',
      subjectTransactionId: coffee,
      payload: {
        kind: 'category',
        transactionId: coffee,
        previousCategoryId: randomUUID(),
        previousCategoryName: 'Kopi',
      },
    });
    const missing = randomUUID();

    const all = await asApp(() => review.confirmBulk(userId, [bill, missing, lost]));
    expect(all).toEqual({
      confirmed: [bill],
      failed: [
        { id: missing, code: 'NOT_FOUND' },
        { id: lost, code: 'INVALID_CATEGORY' },
      ],
    });

    const food = ledger.category('system:food');
    expect(await asApp(() => review.confirmBulk(userId, [lost], { categoryId: food }))).toEqual({
      confirmed: [lost],
      failed: [],
    });
    expect(await row('SELECT category_id FROM transactions WHERE id = $1', [coffee])).toEqual({ category_id: food });
    await expect(asApp(() => review.confirmBulk(userId, ['not-a-uuid']))).rejects.toThrow();
  });

  it('ignores pending items and skips their occurrences', async () => {
    const netflix = await subscription();
    const due = await occurrence(netflix, '2026-10-18');
    await occurrence(netflix, '2026-11-18', 'scheduled');
    const bill = await occurrenceItem(due);
    const loose = await draftItem({
      kind: 'transaction',
      draft: { type: 'expense', occurredAt: NOW, accountId: ledger.bca, amountMinor: 1n, categoryId: null },
    });
    const before = await balance(ledger.bca);

    expect(await asApp(() => review.ignore(userId, []))).toEqual({ ignored: 0 });
    expect(await asApp(() => review.ignore(userId, [bill, loose]))).toEqual({ ignored: 2 });
    expect(await asApp(() => review.ignore(userId, [bill]))).toEqual({ ignored: 0 });
    expect(await occurrenceStatus(due)).toEqual({ status: 'skipped', transaction_id: null });
    expect(await nextBilling(netflix)).toBe('2026-11-18');
    expect(await row('SELECT status FROM review_items WHERE id = $1', [bill])).toEqual({ status: 'ignored' });
    expect(await balance(ledger.bca)).toBe(before);
    await expect(asApp(() => review.confirm(userId, bill))).rejects.toMatchObject({ code: 'REVIEW_RESOLVED' });
  });

  it('moves the next bill past confirmed or skipped bills, and only from the next bill', async () => {
    const netflix = await subscription();
    const october18 = await occurrence(netflix, '2026-10-18');
    const november18 = await occurrence(netflix, '2026-11-18', 'scheduled');
    // "Tandai dibayar" on November first: not the next bill, so the date stays.
    await asApp(() => review.confirmOccurrence(userId, november18));
    expect(await nextBilling(netflix)).toBe('2026-10-18');
    // Skipping October then jumps over the paid November bill.
    const october18Item = await occurrenceItem(october18);
    await asApp(() => review.ignore(userId, [october18Item]));
    expect(await nextBilling(netflix)).toBe('2026-12-18');

    // A cancelled subscription has no bill after its end: the date is kept.
    const ended = await subscription('2026-10-05', { name: 'Vidio' });
    await test.query(
      `UPDATE subscriptions SET status = 'cancelled', cancel_mode = 'after_next_bill', ends_on = '2026-10-05', cancelled_at = now() WHERE id = $1`,
      [ended],
    );
    const lastBill = await occurrenceItem(await occurrence(ended, '2026-10-05'));
    await asApp(() => review.confirm(userId, lastBill));
    expect(await nextBilling(ended)).toBe('2026-10-05');

    // Recurrence occurrences have no billing date to move.
    const recurrence = await one(
      `INSERT INTO recurrences (user_id, template, freq, start_on, month_day)
       VALUES ($1, $2, 'monthly', '2026-01-25', 25) RETURNING id`,
      [userId, JSON.stringify({ type: 'expense', accountId: ledger.bca, amountMinor: '1', categoryId: null })],
    );
    const kos = await occurrence(recurrence, '2026-10-12', 'due_review', 'recurrence');
    const kosItem = await occurrenceItem(kos);
    await asApp(() => review.ignore(userId, [kosItem]));
    expect(await occurrenceStatus(kos)).toEqual({ status: 'skipped', transaction_id: null });
  });

  it('skips several bills at once, oldest first', async () => {
    const netflix = await subscription();
    const november = await occurrenceItem(await occurrence(netflix, '2026-11-18', 'due_review'));
    const october = await occurrenceItem(await occurrence(netflix, '2026-10-18'));
    expect(await asApp(() => review.ignore(userId, [november, october]))).toEqual({ ignored: 2 });
    expect(await nextBilling(netflix)).toBe('2026-12-18');
  });

  it('marks a bill unpaid: the item stays pending, the occurrence unconfirmed', async () => {
    const netflix = await subscription();
    const due = await occurrence(netflix, '2026-10-18');
    const bill = await occurrenceItem(due);
    await asApp(() => review.markUnpaid(userId, bill));
    expect(await occurrenceStatus(due)).toEqual({ status: 'unconfirmed', transaction_id: null });
    expect(await row('SELECT status FROM review_items WHERE id = $1', [bill])).toEqual({ status: 'pending' });

    const loose = await draftItem({
      kind: 'transaction',
      draft: { type: 'expense', occurredAt: NOW, accountId: ledger.bca, amountMinor: 1n, categoryId: null },
    });
    await expect(asApp(() => review.markUnpaid(userId, loose))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(asApp(() => review.markUnpaid(userId, randomUUID()))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await asApp(() => review.confirm(userId, bill));
    await expect(asApp(() => review.markUnpaid(userId, bill))).rejects.toMatchObject({ code: 'REVIEW_RESOLVED' });
  });
});

describe('confirmOccurrence', () => {
  it('pays a bill before its due date through its review item', async () => {
    const netflix = await subscription();
    const due = await occurrence(netflix, '2026-10-25', 'scheduled');
    const result = await asApp(() => review.confirmOccurrence(userId, due, { amountMinor: 190_000n }));
    expect(await occurrenceStatus(due)).toEqual({ status: 'confirmed', transaction_id: result.transactionId });
    expect(await row('SELECT reason, dedupe_key, status, resulting_transaction_id FROM review_items', [])).toEqual({
      reason: 'due_occurrence',
      dedupe_key: `occ.${due}`,
      status: 'confirmed',
      resulting_transaction_id: result.transactionId,
    });
    await expect(asApp(() => review.confirmOccurrence(userId, due))).rejects.toMatchObject({ code: 'REVIEW_RESOLVED' });
    await expect(asApp(() => review.confirmOccurrence(userId, randomUUID()))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // An occurrence already in review reuses its item.
    const next = await occurrence(netflix, '2026-11-18', 'unconfirmed');
    const itemId = await occurrenceItem(next);
    await asApp(() => review.confirmOccurrence(userId, next));
    expect(await row('SELECT status FROM review_items WHERE id = $1', [itemId])).toEqual({ status: 'confirmed' });
    expect(await row('SELECT count(*)::int AS n FROM review_items', [])).toEqual({ n: 2 });
    const skipped = await occurrence(netflix, '2026-12-18', 'skipped');
    await expect(asApp(() => review.confirmOccurrence(userId, skipped))).rejects.toMatchObject({
      code: 'REVIEW_RESOLVED',
    });
  });
});

describe('category, rollover, and leftover proposals', () => {
  const categoryItem = (transactionId: string) =>
    insertItem({
      reason: 'category_deleted',
      source: 'system',
      dedupeKey: `catdel.${transactionId}`,
      subjectTransactionId: transactionId,
      payload: { kind: 'category', transactionId, previousCategoryId: randomUUID(), previousCategoryName: 'Kopi' },
    });

  it('assigns the chosen category to the transaction that lost one', async () => {
    const coffee = await ledger.entry('expense', '2026-10-15', 20_000n, null);
    const itemId = await categoryItem(coffee);
    await expect(asApp(() => review.confirm(userId, itemId))).rejects.toMatchObject({ code: 'INVALID_CATEGORY' });
    await expect(asApp(() => review.confirm(userId, itemId, { categoryId: null }))).rejects.toMatchObject({
      code: 'INVALID_CATEGORY',
    });
    await expect(
      asApp(() => review.confirm(userId, itemId, { categoryId: ledger.category('system:salary') })),
    ).rejects.toMatchObject({ code: 'CATEGORY_KIND_MISMATCH' });
    const food = ledger.category('system:food');
    expect(await asApp(() => review.confirm(userId, itemId, { categoryId: food }))).toEqual({
      transactionId: coffee,
      overrideIds: [],
    });
    expect(await row('SELECT category_id FROM transactions WHERE id = $1', [coffee])).toEqual({ category_id: food });
    expect(
      await row(`SELECT action, meta FROM activity_log WHERE entity_id = $1 AND action = 'updated'`, [coffee]),
    ).toEqual({ action: 'updated', meta: { fields: ['categoryId'], source: 'review' } });
  });

  it('refuses deleted transactions, transfers, and closed periods', async () => {
    const food = ledger.category('system:food');
    const gone = await ledger.entry('expense', '2026-10-15', 20_000n, null);
    const goneItem = await categoryItem(gone);
    await test.query('UPDATE transactions SET deleted_at = now() WHERE id = $1', [gone]);
    await expect(asApp(() => review.confirm(userId, goneItem, { categoryId: food }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const transfer = await ledger.transfer('2026-10-15', 10_000n);
    await expect(
      categoryItem(transfer).then((id) => asApp(() => review.confirm(userId, id, { categoryId: food }))),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });

    await test.query(`UPDATE periods SET status = 'open', closed_at = NULL WHERE id = $1`, [september]);
    const old = await ledger.entry('expense', '2026-09-15', 20_000n, null);
    await test.query(`UPDATE periods SET status = 'closed', closed_at = now() WHERE id = $1`, [september]);
    await expect(
      categoryItem(old).then((id) => asApp(() => review.confirm(userId, id, { categoryId: food }))),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
  });

  it('applies a rollover as an override on the next period', async () => {
    const food = ledger.category('system:food');
    const rollover = (nextPeriodId: string, key: string) =>
      insertItem({
        reason: 'period_close_proposal',
        source: 'period_close',
        dedupeKey: `close.${key}.rollover.${food}`,
        periodId: september,
        payload: { kind: 'rollover', periodId: september, nextPeriodId, categoryId: food, deltaMinor: 150_000n },
      });
    const itemId = await rollover(october, 'a');
    const result = await asApp(() => review.confirm(userId, itemId));
    expect(result.transactionId).toBeNull();
    expect(
      await test.query(
        'SELECT id, period_id, category_id, delta_minor::text AS delta, reason, review_item_id FROM budget_period_overrides',
      ),
    ).toEqual([
      {
        id: result.overrideIds[0],
        period_id: october,
        category_id: food,
        delta: '150000',
        reason: 'rollover',
        review_item_id: itemId,
      },
    ]);

    await test.query(`UPDATE periods SET status = 'closed', closed_at = now() WHERE id = $1`, [november]);
    const closedNext = await rollover(november, 'b');
    await expect(asApp(() => review.confirm(userId, closedNext))).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    const missingNext = await rollover(randomUUID(), 'c');
    await expect(asApp(() => review.confirm(userId, missingNext))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('moves the leftover to the goal as a transfer tagged with its tag', async () => {
    const tag = await one(`INSERT INTO tags (user_id, slug) VALUES ($1, 'dana-darurat') RETURNING id`, [userId]);
    const goal = await one(
      `INSERT INTO goals (user_id, name, icon, color, target_minor, currency, tag_id)
       VALUES ($1, 'Dana Darurat', 'shield', 'green', 1, 'IDR', $2) RETURNING id`,
      [userId, tag],
    );
    const untagged = await one(
      `INSERT INTO goals (user_id, name, icon, color, target_minor, currency) VALUES ($1, 'Liburan', 'plane', 'blue', 1, 'IDR') RETURNING id`,
      [userId],
    );
    const leftover = (key: string, accounts: { from: string | null; to: string | null }) =>
      insertItem({
        reason: 'period_close_proposal',
        source: 'period_close',
        dedupeKey: `close.${key}.leftover`,
        periodId: september,
        payload: {
          kind: 'leftover',
          periodId: september,
          amountMinor: 1_150_000n,
          goalId: goal,
          fromAccountId: accounts.from,
          toAccountId: accounts.to,
        },
      });
    const bca = await balance(ledger.bca);
    const itemId = await leftover('a', { from: ledger.bca, to: ledger.jago });
    const result = await asApp(() => review.confirm(userId, itemId));
    expect(await balance(ledger.bca)).toBe(bca - 1_150_000n);
    expect(
      await row(
        `SELECT t.type, t.source, t.client_id, t.local_date::text AS d, array(SELECT tg.slug FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id) AS tags
         FROM transactions t WHERE t.id = $1`,
        [result.transactionId],
      ),
    ).toEqual({ type: 'transfer', source: 'period_close', client_id: itemId, d: '2026-10-20', tags: ['dana-darurat'] });
    expect(await row('SELECT resulting_transaction_id FROM review_items WHERE id = $1', [itemId])).toEqual({
      resulting_transaction_id: result.transactionId,
    });

    // The user can change goal, accounts, and amount.
    const edited = await leftover('b', { from: null, to: null });
    await expect(asApp(() => review.confirm(userId, edited))).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
    await expect(asApp(() => review.confirm(userId, edited, { fromAccountId: ledger.bca }))).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION',
    });
    await expect(
      asApp(() =>
        review.confirm(userId, edited, { fromAccountId: ledger.bca, toAccountId: ledger.jago, goalId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    const moved = await asApp(() =>
      review.confirm(userId, edited, {
        fromAccountId: ledger.jago,
        toAccountId: ledger.bca,
        goalId: untagged,
        amountMinor: 500_000n,
        occurredAt: new Date('2026-10-19T05:00:00Z'),
        description: 'Sisa September',
        note: 'catatan',
      }),
    );
    expect(
      await row(
        `SELECT t.description, (SELECT count(*)::int FROM transaction_tags tt WHERE tt.transaction_id = t.id) AS tags FROM transactions t WHERE t.id = $1`,
        [moved.transactionId],
      ),
    ).toEqual({ description: 'Sisa September', tags: 0 });
    expect(await balance(ledger.bca)).toBe(bca - 1_150_000n + 500_000n);

    const noGoal = await leftover('c', { from: ledger.bca, to: ledger.jago });
    await asApp(() => review.confirm(userId, noGoal, { goalId: null, receivedMinor: 1_150_000n }));
    expect(await row(`SELECT count(*)::int AS n FROM transactions WHERE source = 'period_close'`, [])).toEqual({
      n: 3,
    });
  });
});
