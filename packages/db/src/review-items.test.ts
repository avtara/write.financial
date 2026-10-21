// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { DecryptionError } from '@wf/crypto/cipher';
import { generateDek } from '@wf/crypto/envelope';
import type { LocalDate } from '@wf/domain/period';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { encodeTemplate } from './occurrences.ts';
import {
  insertReviewItemIn,
  occurrenceReviewItemIn,
  readReviewPayload,
  type NewReviewItem,
  type ReviewPayload,
} from './review-items.ts';
import type { JsonObject } from './schema.ts';

let test: TestDatabase;
let alice: string;
const dek = generateDek();

const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
});

const occurredAt = new Date('2026-10-18T05:00:00Z');
const payloads: ReviewPayload[] = [
  {
    kind: 'transaction',
    draft: {
      type: 'expense',
      occurredAt,
      accountId: randomUUID(),
      amountMinor: 186_000n,
      categoryId: null,
      merchant: 'Netflix',
      source: 'recurring',
    },
  },
  {
    kind: 'transaction',
    draft: {
      type: 'transfer',
      occurredAt,
      fromAccountId: randomUUID(),
      toAccountId: randomUUID(),
      sentMinor: 1_000_000n,
      receivedMinor: 1_000_000n,
      fee: { minor: 2_500n, categoryId: randomUUID() },
      tags: ['dana-darurat'],
    },
  },
  {
    kind: 'category',
    transactionId: randomUUID(),
    previousCategoryId: randomUUID(),
    previousCategoryName: 'Kopi',
  },
  {
    kind: 'rollover',
    periodId: randomUUID(),
    nextPeriodId: randomUUID(),
    categoryId: randomUUID(),
    deltaMinor: -50_000n,
  },
  {
    kind: 'leftover',
    periodId: randomUUID(),
    amountMinor: 1_150_000n,
    goalId: null,
    fromAccountId: randomUUID(),
    toAccountId: null,
  },
];

const insert = (item: NewReviewItem) =>
  asWorker(() => withUser(test.db, alice, (tx) => insertReviewItemIn(tx, alice, dek, item)));

const storedPayload = async (id: string) => {
  const [row] = await test.query<{ payload_enc: Uint8Array }>('SELECT payload_enc FROM review_items WHERE id = $1', [
    id,
  ]);
  return row?.payload_enc as Uint8Array;
};

describe('insertReviewItemIn', () => {
  it('stores every payload kind encrypted and reads it back with bigints and dates', async () => {
    for (const [index, payload] of payloads.entries()) {
      const { id, created } = await insert({
        reason: 'due_occurrence',
        source: 'schedule',
        dedupeKey: `k.${index}`,
        payload,
      });
      expect(created).toBe(true);
      const blob = await storedPayload(id);
      expect(Buffer.from(blob).toString('latin1')).not.toContain('Netflix');
      expect(readReviewPayload(dek, alice, blob)).toEqual(payload);
    }
  });

  it('restores a transfer without a fee as fee null', async () => {
    const { id } = await insert({
      reason: 'ai_suggestion',
      source: 'assistant',
      dedupeKey: 'transfer',
      aiConfidence: 92,
      payload: {
        kind: 'transaction',
        draft: {
          type: 'transfer',
          occurredAt,
          fromAccountId: 'a',
          toAccountId: 'b',
          sentMinor: 5n,
          receivedMinor: 6n,
        },
      },
    });
    const payload = readReviewPayload(dek, alice, await storedPayload(id));
    expect(payload).toEqual({
      kind: 'transaction',
      draft: {
        type: 'transfer',
        occurredAt,
        fromAccountId: 'a',
        toAccountId: 'b',
        sentMinor: 5n,
        receivedMinor: 6n,
        fee: null,
      },
    });
  });

  it('keeps the plain columns and is idempotent per dedupe key', async () => {
    const item: NewReviewItem = {
      reason: 'period_close_proposal',
      source: 'period_close',
      dedupeKey: 'close.x.leftover',
      dueDate: '2026-10-01' as LocalDate,
      payload: payloads[4] as ReviewPayload,
    };
    const first = await insert(item);
    const second = await insert({ ...item, payload: payloads[3] as ReviewPayload });
    expect(second).toEqual({ id: first.id, created: false });
    const rows = await test.query(
      'SELECT reason, source, due_date::text AS due, status, ai_confidence FROM review_items',
    );
    expect(rows).toEqual([
      {
        reason: 'period_close_proposal',
        source: 'period_close',
        due: '2026-10-01',
        status: 'pending',
        ai_confidence: null,
      },
    ]);
    expect(readReviewPayload(dek, alice, await storedPayload(first.id))).toEqual(payloads[4]);
  });

  it('binds the ciphertext to the user', async () => {
    const { id } = await insert({
      reason: 'category_deleted',
      source: 'system',
      dedupeKey: 'c',
      payload: payloads[2] as ReviewPayload,
    });
    const blob = await storedPayload(id);
    expect(() => readReviewPayload(dek, randomUUID(), blob)).toThrow(DecryptionError);
  });

  it('gives the worker no UPDATE on review items (D14)', async () => {
    const { id } = await insert({
      reason: 'category_deleted',
      source: 'system',
      dedupeKey: 'd',
      payload: payloads[2] as ReviewPayload,
    });
    await expect(
      asWorker(() =>
        withUser(test.db, alice, (tx) =>
          tx.execute(sql`UPDATE review_items SET status = 'ignored', resolved_at = now() WHERE id = ${id}`),
        ),
      ),
    ).rejects.toMatchObject(pgError(/permission denied/));
  });
});

describe('occurrenceReviewItemIn', () => {
  const one = async (text: string, params: unknown[]) => {
    const [row] = await test.query<{ id: string }>(text, params);
    return row?.id as string;
  };
  const occurrence = (type: string, sourceId: string, due: string, expected = 186_000) =>
    one(
      `INSERT INTO scheduled_occurrences (user_id, source_type, source_id, due_date, expected_minor, currency)
       VALUES ($1, $2::occurrence_source, $3, $4, $5, 'IDR') RETURNING id`,
      [alice, type, sourceId, due, expected],
    );
  const recurrence = (template: JsonObject) =>
    one(
      `INSERT INTO recurrences (user_id, template, freq, start_on, month_day)
       VALUES ($1, $2, 'monthly', '2026-01-25', 25) RETURNING id`,
      [alice, JSON.stringify(template)],
    );
  const build = (occurrenceId: string) =>
    asWorker(() => withUser(test.db, alice, (tx) => occurrenceReviewItemIn(tx, alice, occurrenceId)));
  // Due dates propose a transaction at 12.00 WIB.
  const noon = new Date('2026-10-18T05:00:00Z');

  it('proposes the subscription bill as a recurring expense', async () => {
    const account = await one(
      `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
       VALUES ($1, 'bank', 'BCA', 'BCA', 'IDR', '2026-01-01', 'blue') RETURNING id`,
      [alice],
    );
    const subscription = await one(
      `INSERT INTO subscriptions (user_id, name, plan, price_minor, currency, cycle, next_billing_date, pay_from_account_id, started_on)
       VALUES ($1, 'Netflix', 'Premium', 186000, 'IDR', 'monthly', '2026-10-18', $2, '2025-01-18') RETURNING id`,
      [alice, account],
    );
    const id = await occurrence('subscription', subscription, '2026-10-18');
    expect(await build(id)).toEqual({
      reason: 'due_occurrence',
      source: 'schedule',
      dedupeKey: `occ.${id}`,
      occurrenceId: id,
      dueDate: '2026-10-18',
      payload: {
        kind: 'transaction',
        draft: {
          type: 'expense',
          occurredAt: noon,
          source: 'recurring',
          accountId: account,
          amountMinor: 186_000n,
          categoryId: null,
          merchant: 'Netflix',
          description: 'Premium',
        },
      },
    });
  });

  it('proposes a recurrence template with the expected amount', async () => {
    const [accountId, from, to, categoryId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const entry = await recurrence(
      encodeTemplate({ type: 'income', accountId, amountMinor: 1n, categoryId, merchant: 'PT Maju', tags: ['gaji'] }),
    );
    const entryItem = await build(await occurrence('recurrence', entry, '2026-10-18', 25_000_000));
    expect(entryItem.payload).toEqual({
      kind: 'transaction',
      draft: {
        type: 'income',
        accountId,
        amountMinor: 25_000_000n,
        categoryId,
        merchant: 'PT Maju',
        description: null,
        tags: ['gaji'],
        occurredAt: noon,
        source: 'recurring',
      },
    });

    const same = await recurrence(
      encodeTemplate({
        type: 'transfer',
        fromAccountId: from,
        toAccountId: to,
        sentMinor: 500_000n,
        receivedMinor: 500_000n,
      }),
    );
    const sameItem = await build(await occurrence('recurrence', same, '2026-10-18', 600_000));
    expect(sameItem.payload).toMatchObject({
      draft: { type: 'transfer', sentMinor: 600_000n, receivedMinor: 600_000n },
    });

    const cross = await recurrence(
      encodeTemplate({
        type: 'transfer',
        fromAccountId: from,
        toAccountId: to,
        sentMinor: 3_000_000n,
        receivedMinor: 18_210n,
      }),
    );
    const crossItem = await build(await occurrence('recurrence', cross, '2026-10-18', 3_100_000));
    expect(crossItem.payload).toMatchObject({ draft: { sentMinor: 3_100_000n, receivedMinor: 18_210n } });
  });

  it('refuses missing occurrences, missing sources, and unsupported source types', async () => {
    await expect(build(randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(build(await occurrence('subscription', randomUUID(), '2026-10-18'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(build(await occurrence('recurrence', randomUUID(), '2026-10-18'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(build(await occurrence('goal_plan', randomUUID(), '2026-10-18'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
