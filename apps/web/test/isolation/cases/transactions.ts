// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/transactions.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import type { TransactionDetail } from '@wf/db/transactions';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { TransactionRowsPage, TransactionsView } from '../../../src/server/fn/transactions.ts';
import {
  A_LEDGER,
  aAccountId,
  aId,
  aLedgerRows,
  as,
  aTransactionId,
  bAccountId,
  bExpense,
  bId,
  type Case,
  categoryId,
  count,
  isDeleted,
  type Name,
  notFoundForB,
  OCTOBER,
  ok,
  services,
  SOME_ID,
  superuser,
  transactionRow,
  UNAUTHENTICATED,
} from '../harness.ts';
import { bTransactionId } from './transactions-write.ts';

export const cases = {
  getTransactionsView: {
    input: () => ({ range: OCTOBER }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<TransactionsView>>('B', 'getTransactionsView', input);
      if (!ofB.ok) throw new Error(`getTransactionsView failed: ${ofB.code}`);
      expect(ofB.value.page.rows.map((row) => row.id)).toContain(bTransactionId);
      expect(ofB.value.page.rows.every((row) => row.accountId === bAccountId)).toBe(true);
      expect(ofB.value.accounts.map((group) => group.accountId)).toEqual([bAccountId]);
      expect(ofB.value).toMatchObject({ hasTransactions: true, unfilteredCount: ofB.value.page.total });
      // Filtering by A's account finds nothing, and no balance of it.
      expect(await as('B', 'getTransactionsView', { range: OCTOBER, account: aAccountId })).toMatchObject(
        ok({ page: { rows: [], total: 0, balances: {} }, accounts: [] }),
      );
      const ofA = await as<Result<TransactionsView>>('A', 'getTransactionsView', input);
      expect(ofA.ok && ofA.value.page.rows.map((row) => row.id)).toEqual([aTransactionId]);
    },
  },
  listTransactionRows: {
    input: () => ({ range: OCTOBER, account: bAccountId, offset: 0 }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<TransactionRowsPage>>('B', 'listTransactionRows', input);
      if (!ofB.ok) throw new Error(`listTransactionRows failed: ${ofB.code}`);
      expect(ofB.value.rows.map((row) => row.id)).toContain(bTransactionId);
      // Rekening B opened with Rp1.000.000 and B spent Rp25.000 on "Kopi B".
      expect(ofB.value.balances?.[bTransactionId]).toBe(975_000n);
      expect(await as('B', 'listTransactionRows', { range: OCTOBER, account: aAccountId, offset: 0 })).toEqual(
        ok({ rows: [], total: 0, balances: {} }),
      );
    },
  },
  getTransactionDetail: {
    input: () => ({ id: aTransactionId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('getTransactionDetail', input);
      expect(await as('B', 'getTransactionDetail', { id: bTransactionId })).toMatchObject(
        ok({ id: bTransactionId, description: 'Kopi B' }),
      );
    },
  },
  updateTransaction: {
    input: () => ({ id: aTransactionId, input: bExpense({ description: 'Pwned' }) }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('updateTransaction', input);
      expect(await transactionRow(aTransactionId)).toEqual({ user_id: aId, description: A_LEDGER.transaction });
      // B cannot move its own expense onto A's account.
      await notFoundForB('updateTransaction', { id: bTransactionId, input: bExpense({ accountId: aAccountId }) });
      expect(await as('B', 'updateTransaction', { id: bTransactionId, input: bExpense() })).toMatchObject(
        ok({ id: bTransactionId, description: 'Kopi B' }),
      );
    },
  },
  duplicateTransaction: {
    input: () => ({ id: aTransactionId, input: bExpense({ clientId: randomUUID() }) }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('duplicateTransaction', input);
      const before = await count('transactions', `user_id = '${bId}'`);
      expect(
        await as('B', 'duplicateTransaction', { id: bTransactionId, input: bExpense({ clientId: randomUUID() }) }),
      ).toMatchObject(ok({ created: true }));
      expect(await count('transactions', `user_id = '${bId}' AND duplicated_from_id = '${bTransactionId}'`)).toBe(1);
      expect(await count('transactions', `user_id = '${bId}'`)).toBe(before + 1);
    },
  },
  splitTransaction: {
    input: () => ({
      id: aTransactionId,
      clientId: randomUUID(),
      parts: [
        { amountMinor: 20_000n, categoryId: null },
        { amountMinor: 30_000n, categoryId: null },
      ],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('splitTransaction', input);
      expect(await count('transactions', `split_parent_id = '${aTransactionId}'`)).toBe(0);
      const split = await as<Result<{ partIds: string[] }>>('B', 'splitTransaction', {
        id: bTransactionId,
        clientId: randomUUID(),
        parts: [
          { amountMinor: 10_000n, categoryId: null },
          { amountMinor: 15_000n, categoryId: null },
        ],
      });
      expect(split.ok && split.value.partIds).toHaveLength(2);
    },
  },
  unsplitTransaction: {
    input: () => ({ id: aTransactionId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('unsplitTransaction', input);
      expect(await as('B', 'unsplitTransaction', { id: bTransactionId })).toMatchObject({ ok: true });
      expect(await isDeleted(bTransactionId)).toBe(false);
    },
  },
  bulkSetCategory: {
    input: () => ({ ids: [aTransactionId], categoryId: null }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // "Kategori B" was deleted by the deleteCategory case; B's budgeted category is still there.
      const categoryOfB = await categoryId(bId, 'Anggaran tag-b');
      expect(await as('B', 'bulkSetCategory', input)).toEqual(ok({ updated: [] }));
      expect(
        await as('B', 'bulkSetCategory', { ids: [bTransactionId, aTransactionId], categoryId: categoryOfB }),
      ).toEqual(ok({ updated: [bTransactionId] }));
      const categories = await superuser<{ category_id: string | null }[]>`
        SELECT category_id::text FROM transactions WHERE id = ${aTransactionId}`;
      expect(categories).toEqual([{ category_id: null }]);
      // A's category is not B's to use.
      expect(
        await as('B', 'bulkSetCategory', {
          ids: [bTransactionId],
          categoryId: await categoryId(aId, A_LEDGER.category),
        }),
      ).toMatchObject({ ok: false });
    },
  },
  bulkMoveAccount: {
    input: () => ({ ids: [aTransactionId], accountId: bAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const accountsOf = async (id: string) =>
        (
          await superuser<{ account_id: string }[]>`SELECT account_id::text FROM postings WHERE transaction_id = ${id}`
        ).map((row) => row.account_id);
      expect(await as('B', 'bulkMoveAccount', input)).toEqual(ok({ updated: [] }));
      expect(await accountsOf(aTransactionId)).toEqual([aAccountId]);
      await notFoundForB('bulkMoveAccount', { ids: [bTransactionId], accountId: aAccountId });
      expect(await accountsOf(bTransactionId)).toEqual([bAccountId]);
    },
  },
  bulkAddTag: {
    input: () => ({ ids: [aTransactionId], tag: 'tag-b' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const before = await aLedgerRows();
      expect(await as('B', 'bulkAddTag', input)).toEqual(ok({ updated: [] }));
      expect(await as('B', 'bulkAddTag', { ids: [bTransactionId, aTransactionId], tag: 'tag-b' })).toEqual(
        ok({ updated: [bTransactionId] }),
      );
      expect(await aLedgerRows()).toEqual(before);
    },
  },
  addAttachment: {
    input: () => {
      const form = new FormData();
      form.set('transactionId', aTransactionId);
      form.set('kind', 'image');
      form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'struk.png', { type: 'image/png' }));
      return form;
    },
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // Refused before the image is read or anything reaches storage.
      await notFoundForB('addAttachment', input);
      expect(await count('attachments')).toBe(0);
    },
  },
  removeAttachment: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // A's receipt (row only: B's request must be refused before storage is touched).
      const attachmentOfA =
        (
          await superuser<{ id: string }[]>`
          INSERT INTO attachments (user_id, transaction_id, bucket, object_key, mime, size, sha256, kind)
          VALUES (${aId}, ${aTransactionId}, 'attachments', ${`u/${aId}/${randomUUID()}`}, 'image/webp', 10,
            ${'a'.repeat(64)}, 'receipt')
          RETURNING id::text`
        )[0]?.id ?? '';
      await notFoundForB('removeAttachment', { id: attachmentOfA });
      expect(await count('attachments', `id = '${attachmentOfA}'`)).toBe(1);
      const detail = await as<Result<TransactionDetail>>('A', 'getTransactionDetail', { id: aTransactionId });
      expect(detail.ok && detail.value.attachments.map((attachment) => attachment.id)).toEqual([attachmentOfA]);
    },
  },
  saveTablePrefs: {
    input: () => ({ columns: [{ id: 'amount', visible: true }], density: 'compact' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'saveTablePrefs', input)).toMatchObject(ok({ density: 'compact' }));
      expect(await count('user_preferences', `user_id = '${bId}'`)).toBe(1);
      expect(await count('user_preferences', `user_id = '${aId}'`)).toBe(0);
      const ofA = await as<Result<TransactionsView>>('A', 'getTransactionsView', { range: OCTOBER });
      expect(ofA.ok && ofA.value.prefs.density).toBe('comfortable');
    },
  },
  countPeriodTransactions: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { current } = await services.periods.list(bId);
      const own = await count(
        'transactions',
        `user_id = '${bId}' AND deleted_at IS NULL AND local_date BETWEEN '${current.start}' AND '${current.end}'`,
      );
      expect(await as('B', 'countPeriodTransactions')).toEqual(ok(own));
    },
  },
} satisfies Partial<Record<Name, Case>>;
