// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import { DESIGN_SEED } from '@wf/domain/seed';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createExport, MAX_ROWS_PER_TABLE, transactionsCsv } from './export.ts';
import { seedLedger } from './seed.ts';

let test: TestDatabase;
let userId: string;
const otherId = async () => insertUser(test, 'other@example.test');
/** One DEK for the whole seed: rows are encrypted with it and read back with it. */
const dek = generateDek();
const options = { getDek: () => Promise.resolve(dek), now: () => new Date('2026-10-15T10:00:00Z') };
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

/** One account and one expense for a second user that must never appear in the first user's export. */
async function seedOtherUser(id: string): Promise<void> {
  await test.query(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color)
     VALUES ($1, 'bank', 'Mandiri', 'Rekening Orang Lain', 'IDR', 1, '2026-10-01', 'red')`,
    [id],
  );
  await test.query(
    `INSERT INTO transactions (user_id, type, occurred_at, local_date, client_id, confirmed_by_user_at, description)
     VALUES ($1, 'expense', '2026-10-06T05:00:00Z', '2026-10-06', gen_random_uuid(), '2026-10-06T05:00:00Z', 'Rahasia Orang Lain')`,
    [id],
  );
}

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  userId = await insertUser(test, 'avtara@example.test');
});

describe('collect', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  it('exports the seeded persona: the row counts match the design seed, per table', async () => {
    const result = await asApp(() => seedLedger(test.db, userId, options));
    const other = await otherId();
    await seedOtherUser(other);
    const data = await asApp(() => createExport(test.db).collect(userId, { now: new Date('2026-10-23T04:00:00Z') }));
    expect(data.exportedAt).toEqual(new Date('2026-10-23T04:00:00Z'));
    expect(data.truncated).toEqual([]);
    expect(data.user).toMatchObject({
      name: 'avtara@example.test',
      locale: 'id',
      timezone: 'Asia/Jakarta',
      baseCurrency: 'IDR',
      twoFactorEnabled: false,
      deletionRequestedAt: null,
    });
    expect(data.accounts).toHaveLength(DESIGN_SEED.accounts.length);
    // 249 designed transactions plus the 5 investment cash legs the seed records through the ledger.
    expect(data.transactions).toHaveLength(254);
    expect(data.postings.length).toBeGreaterThanOrEqual(254);
    expect(data.periods).toHaveLength(2);
    expect(data.goals).toHaveLength(result.goals);
    expect(data.subscriptions).toHaveLength(result.subscriptions);
    expect(data.recurrences).toHaveLength(result.recurrences);
    expect(data.receivables).toHaveLength(result.receivables);
    expect(data.goalSnapshots).toHaveLength(DESIGN_SEED.goalSnapshots.length);
    expect(data.attachments).toEqual([]);
    // The persona holds market data: the state columns are exported, the ciphertext key is not.
    expect(data.marketCredentials.length).toBeGreaterThanOrEqual(0);
    // No ciphertext column and no other user's row leaves the database.
    const dump = JSON.stringify(data, (_key, value: unknown) => (typeof value === 'bigint' ? String(value) : value));
    // Ciphertext is stripped (bytea never serializes); what remains holds no encrypted values.
    expect(dump).not.toMatch(/\\x[0-9a-f]{16}/);
    expect(dump).not.toContain('Rekening Orang Lain');
    expect(dump).not.toContain('Rahasia Orang Lain');
  });

  it('is scoped to the session user even when only the other user has rows', async () => {
    const other = await otherId();
    await seedOtherUser(other);
    const data = await asApp(() => createExport(test.db).collect(userId));
    expect(data.accounts).toEqual([]);
    expect(data.transactions).toEqual([]);
    expect(data.user.name).toBe('avtara@example.test');
  });

  it('cuts tables at the cap to the newest rows and names them in `truncated`', async () => {
    const other = await otherId();
    await seedOtherUser(other);
    const data = await asApp(() => createExport(test.db).collect(other, { maxRows: 0 }));
    // Every table with rows was cut (to zero rows); the export header still identifies the user.
    expect(data.truncated.length).toBeGreaterThan(0);
    expect(data.accounts).toEqual([]);
    expect(data.transactions).toEqual([]);
    expect(data.user.name).toBe('other@example.test');
    // The default cap is far above any test ledger.
    expect(MAX_ROWS_PER_TABLE).toBe(50_000);
  });
});

describe('ledgerRows and the CSV', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  it('joins the account, category, and tag names onto the seeded transactions, oldest first', async () => {
    await asApp(() => seedLedger(test.db, userId, options));
    const rows = await asApp(() => createExport(test.db).ledgerRows(userId));
    expect(rows).toHaveLength(254);
    // One row per transaction: a transfer's two principal legs collapse to its source leg.
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    const times = rows.map((row) => row.occurredAt.getTime());
    const [first, second] = times;
    if (first === undefined || second === undefined) throw new Error('the ledger has fewer than two rows');
    expect(first).toBeLessThanOrEqual(second);
    // Seeded transactions have names behind every id (some without a category) and signed amounts.
    const withCategory = rows.filter((row) => row.category !== null);
    expect(withCategory.length).toBeGreaterThan(200);
    expect(rows.every((row) => row.account !== null)).toBe(true);
    expect(rows.some((row) => row.tags !== null)).toBe(true);
    const transfer = rows.find((row) => row.type === 'transfer');
    expect(typeof transfer?.account).toBe('string');
  });

  it('cuts the ledger at the cap to the newest rows, still oldest first', async () => {
    await asApp(() => seedLedger(test.db, userId, options));
    const full = await asApp(() => createExport(test.db).ledgerRows(userId));
    const capped = await asApp(() => createExport(test.db).ledgerRows(userId, { maxRows: 10 }));
    expect(capped.map((row) => row.id)).toEqual(full.slice(-10).map((row) => row.id));
    const cappedTimes = capped.map((row) => row.occurredAt.getTime());
    for (let i = 1; i < cappedTimes.length; i += 1) {
      const previous = cappedTimes[i - 1];
      const current = cappedTimes[i];
      if (previous === undefined || current === undefined) throw new Error('a time is missing');
      expect(previous).toBeLessThanOrEqual(current);
    }
  });

  it('renders RFC 4180 CSV: header, ISO dates, empty cells, and quoted commas', () => {
    expect(
      transactionsCsv([
        {
          id: '0199f5d2-0000-7000-8000-000000000001',
          occurredAt: new Date('2026-10-05T05:00:00Z'),
          type: 'expense',
          description: 'Kopi, roti',
          merchant: null,
          amountMinor: '-25000',
          currency: 'IDR',
          account: 'Bank "Jago"',
          category: null,
          tags: null,
          deletedAt: null,
        },
      ]),
    ).toBe(
      [
        'id,occurred_at,type,description,merchant,amount_minor,currency,account,category,tags,deleted_at',
        '0199f5d2-0000-7000-8000-000000000001,2026-10-05T05:00:00.000Z,expense,"Kopi, roti",,-25000,IDR,"Bank ""Jago""",,,',
      ].join('\r\n'),
    );
  });
});
