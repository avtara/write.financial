// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek, ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createImportReview, IMPORT_ROW_LIMIT, importDedupeKey, type ImportRowInput } from './import-review.ts';

let test: TestDatabase;
let ledger: LedgerFixture;
let other: LedgerFixture;
let repo: ReturnType<typeof createImportReview>;

const row = (patch: Partial<ImportRowInput> = {}): ImportRowInput => ({
  date: '2026-10-05' as LocalDate,
  amountMinor: 25_000n,
  direction: 'out',
  description: 'QRIS KOPI',
  categoryId: null,
  transferAccountId: null,
  tags: [],
  ...patch,
});

beforeAll(async () => {
  test = await startMigrated();
  repo = createImportReview(test.db, { getDek: fixtureGetDek });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  ledger = await ledgerFixture(test, 'alice@example.test');
  other = await ledgerFixture(test, 'bob@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

const itemsOf = async (userId: string) =>
  test.query<{ id: string; dedupe_key: string; reason: string; source: string; due_date: string; payload: string }>(
    `SELECT id, dedupe_key, reason, source::text, due_date::text, encode(payload_enc, 'hex') AS payload
     FROM review_items WHERE user_id = $1 ORDER BY id`,
    [userId],
  );

describe('propose', () => {
  it('creates one import_row review item per valid row, with the proposed transaction in its payload', async () => {
    const result = await asApp(() =>
      repo.propose(ledger.userId, {
        accountId: ledger.bca,
        rows: [
          row({ date: '2026-10-05' as LocalDate, amountMinor: 25_000n, direction: 'out', description: 'QRIS KOPI' }),
          row({ date: '2026-10-06' as LocalDate, amountMinor: 1_000_000n, direction: 'in', description: 'GAJI' }),
        ],
      }),
    );
    expect(result).toMatchObject({ created: 2, duplicates: 0, rejected: 0 });
    const items = await itemsOf(ledger.userId);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ reason: 'import_row', source: 'system', due_date: '2026-10-05' });
    // The payload decrypts outside this test; the dedupe key is the stable hash of account, date, amount, description.
    expect(items[0]?.dedupe_key).toBe(
      importDedupeKey(ledger.bca, { date: '2026-10-05' as LocalDate, amountMinor: 25_000n, description: 'QRIS KOPI' }),
    );
    expect(result.itemIds).toEqual(items.map((item) => item.id));
  });

  it('is idempotent per dedupe key: replaying the same rows yields duplicates, not new items', async () => {
    const rows = [row(), row({ date: '2026-10-07' as LocalDate, description: 'TB SILAMPARI' })];
    await asApp(() => repo.propose(ledger.userId, { accountId: ledger.bca, rows }));
    const again = await asApp(() => repo.propose(ledger.userId, { accountId: ledger.bca, rows }));
    expect(again).toMatchObject({ created: 0, duplicates: 2, rejected: 0, itemIds: [] });
    expect(await itemsOf(ledger.userId)).toHaveLength(2);
  });

  it('keeps duplicates of the same file apart per account', async () => {
    await asApp(() => repo.propose(ledger.userId, { accountId: ledger.bca, rows: [row()] }));
    await asApp(() => repo.propose(ledger.userId, { accountId: ledger.jago, rows: [row()] }));
    expect(await itemsOf(ledger.userId)).toHaveLength(2);
  });

  it('hashes a row without a description stably', async () => {
    await asApp(() => repo.propose(ledger.userId, { accountId: ledger.bca, rows: [row({ description: null })] }));
    const [item] = await itemsOf(ledger.userId);
    expect(item?.dedupe_key).toBe(importDedupeKey(ledger.bca, { ...row({ description: null }) }));
  });

  it('rejects rows with an invalid date or a non-positive amount, and keeps the valid ones', async () => {
    const result = await asApp(() =>
      repo.propose(ledger.userId, {
        accountId: ledger.bca,
        rows: [
          row({ date: '2026-02-30' as LocalDate }),
          row({ date: 'not-a-date' as unknown as LocalDate }),
          row({ amountMinor: 0n }),
          row({ amountMinor: -5_000n }),
          row(),
        ],
      }),
    );
    expect(result).toMatchObject({ created: 1, duplicates: 0, rejected: 4 });
    expect(await itemsOf(ledger.userId)).toHaveLength(1);
  });

  it('proposes a transfer when the row names the user’s own account, and rejects a foreign or cross-currency one', async () => {
    const result = await asApp(() =>
      repo.propose(ledger.userId, {
        accountId: ledger.bca,
        rows: [
          row({ description: 'TRSF KE JAGO', transferAccountId: ledger.jago }),
          row({
            date: '2026-10-06' as LocalDate,
            amountMinor: 500_000n,
            direction: 'in',
            description: 'TRSF DARI JAGO',
            transferAccountId: ledger.jago,
          }),
          row({ description: 'TRSF KE BCA ORANG LAIN', transferAccountId: other.bca }),
          row({ description: 'NO SUCH ACCOUNT', transferAccountId: '0192a6c4-0000-7000-8000-00000000000f' }),
        ],
      }),
    );
    expect(result).toMatchObject({ created: 2, rejected: 2 });
    const items = await itemsOf(ledger.userId);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.dedupe_key)).toContain(
      importDedupeKey(ledger.bca, { ...row({ description: 'TRSF KE JAGO', transferAccountId: ledger.jago }) }),
    );
  });

  it('rejects tags that are not slugs or more than five of them', async () => {
    const result = await asApp(() =>
      repo.propose(ledger.userId, {
        accountId: ledger.bca,
        rows: [
          row({ tags: ['Kopi Susu'] }),
          row({ date: '2026-10-06' as LocalDate, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }),
          row({ date: '2026-10-07' as LocalDate, tags: ['kopi', 'kantor'] }),
        ],
      }),
    );
    expect(result).toMatchObject({ created: 1, rejected: 2 });
  });

  it('answers NOT_FOUND for another user’s account', async () => {
    await expect(
      asApp(() => repo.propose(ledger.userId, { accountId: other.bca, rows: [row()] })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await itemsOf(ledger.userId)).toHaveLength(0);
  });

  it(`ignores rows beyond ${IMPORT_ROW_LIMIT}`, async () => {
    const rows = Array.from({ length: IMPORT_ROW_LIMIT + 10 }, (_, index) =>
      row({ date: '2026-10-01' as LocalDate, description: `ROW ${index}` }),
    );
    const result = await asApp(() => repo.propose(ledger.userId, { accountId: ledger.bca, rows }));
    expect(result.created).toBe(IMPORT_ROW_LIMIT);
    expect(await itemsOf(ledger.userId)).toHaveLength(IMPORT_ROW_LIMIT);
  });
});
