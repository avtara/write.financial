// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small hand-built ledger for the period, budget, and dashboard tests: two IDR accounts open since 1 Jan 2026,
 * the built-in categories, and helpers that record transactions through the repository at a fixed instant.
 */
import { randomUUID } from 'node:crypto';
import { generateDek, type Dek } from '@wf/crypto/envelope';
import type { BuiltInCategoryKey } from '@wf/domain/categories';
import { createCategories } from '../src/categories.ts';
import { createTransactions } from '../src/transactions.ts';
import { insertUser, type TestDatabase } from './pglite.ts';

const dek = generateDek();
/** `getDek` for repositories in fixture-based tests (one DEK for every user). */
export const fixtureGetDek = (): Promise<Dek> => Promise.resolve(dek);

export interface LedgerFixture {
  readonly userId: string;
  readonly bca: string;
  readonly jago: string;
  /** Built-in category id by key. */
  category(key: BuiltInCategoryKey): string;
  /** An expense (or income) of `amountMinor` on `date` (`YYYY-MM-DD`, 12.00 WIB) on BCA; returns its id. */
  entry(
    type: 'expense' | 'income',
    date: string,
    amountMinor: bigint,
    categoryId: string | null,
    extra?: { readonly merchant?: string; readonly accountId?: string },
  ): Promise<string>;
  /** A BCA → Jago transfer on `date`, optionally with a fee in `feeCategoryId`; returns its id. */
  transfer(
    date: string,
    sentMinor: bigint,
    fee?: { readonly minor: bigint; readonly categoryId: string },
  ): Promise<string>;
}

/** A user `email` with the fixture ledger; everything runs as `wf_app`. */
export async function ledgerFixture(test: TestDatabase, email: string): Promise<LedgerFixture> {
  const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
  const userId = await insertUser(test, email);
  const account = async (name: string) => {
    const [row] = await test.query<{ id: string }>(
      `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color)
       VALUES ($1, 'bank', $2, $3, 'IDR', 100000000, '2026-01-01', 'blue') RETURNING id`,
      [userId, name, name],
    );
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row');
    return row.id;
  };
  const bca = await account('BCA');
  const jago = await account('Jago');
  const categories = await asApp(() => createCategories(test.db, { getDek: fixtureGetDek }).list(userId));
  const byKey = new Map(categories.map((row) => [row.builtInKey, row.id]));
  const transactions = createTransactions(test.db, {
    getDek: fixtureGetDek,
    now: () => new Date('2026-10-15T05:00:00Z'),
  });
  const at = (date: string) => new Date(`${date}T12:00:00+07:00`);
  return {
    userId,
    bca,
    jago,
    category: (key) => byKey.get(key) as string,
    entry: async (type, date, amountMinor, categoryId, extra = {}) =>
      (
        await asApp(() =>
          transactions.create(userId, {
            type,
            clientId: randomUUID(),
            occurredAt: at(date),
            accountId: extra.accountId ?? bca,
            amountMinor,
            categoryId,
            merchant: extra.merchant ?? null,
          }),
        )
      ).id,
    transfer: async (date, sentMinor, fee) =>
      (
        await asApp(() =>
          transactions.create(userId, {
            type: 'transfer',
            clientId: randomUUID(),
            occurredAt: at(date),
            fromAccountId: bca,
            toAccountId: jago,
            sentMinor,
            receivedMinor: sentMinor,
            fee: fee ?? null,
          }),
        )
      ).id,
  };
}
