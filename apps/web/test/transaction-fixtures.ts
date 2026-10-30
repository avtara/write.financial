// SPDX-License-Identifier: AGPL-3.0-only
/** Transactions page data for component tests (shapes from `server/fn/transactions.ts`). */
import type { TransactionRow } from '@wf/db/transaction-query';
import type { AttachmentView, PostingView, TransactionDetail } from '@wf/db/transactions';
import type { LocalDate } from '@wf/domain/period';
import { DEFAULT_TABLE_PREFS } from '../src/lib/transaction-columns.ts';
import type { TransactionsView } from '../src/server/fn/transactions.ts';
import { BCA, categoryId } from './ledger-fixtures.ts';

/** An expense of Rp10.000 from BCA Tahapan on 15 Oct 2026, 12.41 in Jakarta; override what the test needs. */
export function transactionRow(id: string, patch: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id,
    type: 'expense',
    occurredAt: new Date('2026-10-15T05:41:00Z'),
    localDate: '2026-10-15' as LocalDate,
    merchant: null,
    description: null,
    categoryId: categoryId('system:food'),
    accountId: BCA.id,
    toAccountId: null,
    amountMinor: -10_000n,
    currency: 'IDR',
    receivedMinor: null,
    receivedCurrency: null,
    amountBaseMinor: -10_000n,
    feeMinor: null,
    fxDiffBaseMinor: null,
    tags: [],
    hasAttachment: false,
    hasNote: false,
    source: 'manual',
    splitParentId: null,
    ...patch,
  };
}

/** The view of 1–15 Oct 2026 (today the 15th) showing `rows`; totals follow the rows unless overridden. */
export function transactionsView(
  rows: readonly TransactionRow[],
  patch: Partial<TransactionsView> = {},
): TransactionsView {
  const period: TransactionsView['periods'][number] = {
    id: 'p-10',
    kind: 'normal',
    label: '2026-10' as TransactionsView['periods'][number]['label'],
    start: '2026-10-01' as LocalDate,
    end: '2026-10-31' as LocalDate,
    days: 31,
    status: 'open',
    closedAt: null,
  };
  return {
    today: '2026-10-15' as LocalDate,
    from: '2026-10-01' as LocalDate,
    to: '2026-10-15' as LocalDate,
    period,
    periods: [period],
    rangeSummary: { days: 15, periodCount: 1 },
    summary: {
      inMinor: 0n,
      outMinor: 0n,
      transferMinor: 0n,
      transferInMinor: null,
      transferOutMinor: null,
      inCount: 0,
      outCount: 0,
      transferCount: 0,
      dailySpend: [],
      averageDailySpendMinor: 0n,
    },
    days: [],
    categories: [],
    accounts: [],
    page: { rows: [...rows], total: rows.length, balances: null },
    unfilteredCount: rows.length,
    hasTransactions: true,
    prefs: DEFAULT_TABLE_PREFS,
    ...patch,
  };
}

/** A receipt photo of 15 Oct 2026. */
export const RECEIPT: AttachmentView = {
  id: 'att-1',
  mime: 'image/jpeg',
  size: 120_000,
  kind: 'receipt',
  objectKey: 'u/user-1/att-1',
  thumbnailKey: 'u/user-1/att-1-thumb',
  sha256: 'a'.repeat(64),
  name: 'struk.jpg',
  createdAt: new Date('2026-10-15T06:00:00Z'),
};

/** A posting of `amountMinor` (signed) in `accountId`; principal, IDR, no category unless overridden. */
export function posting(accountId: string, amountMinor: bigint, patch: Partial<PostingView> = {}): PostingView {
  return {
    id: `p-${accountId}-${String(amountMinor)}`,
    accountId,
    amountMinor,
    currency: 'IDR',
    fxRateToBase: null,
    amountBaseMinor: amountMinor,
    role: 'principal',
    categoryId: null,
    ...patch,
  };
}

/** The detail of {@link transactionRow}'s default: Rp10.000 food from BCA Tahapan on 15 Oct 2026, 12.41 in Jakarta. */
export function transactionDetail(id: string, patch: Partial<TransactionDetail> = {}): TransactionDetail {
  const at = new Date('2026-10-15T05:41:00Z');
  return {
    id,
    type: 'expense',
    occurredAt: at,
    localDate: '2026-10-15' as LocalDate,
    description: null,
    merchant: null,
    note: null,
    categoryId: categoryId('system:food'),
    source: 'manual',
    splitParentId: null,
    duplicatedFromId: null,
    clientId: `client-${id}`,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    fees: [],
    postings: [posting(BCA.id, -10_000n, { categoryId: categoryId('system:food') })],
    tags: [],
    transfer: null,
    attachments: [],
    activity: [],
    ...patch,
  };
}
