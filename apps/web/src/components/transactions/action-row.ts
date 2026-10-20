// SPDX-License-Identifier: AGPL-3.0-only
/** What the Transactions page's actions need of a transaction, from a table row or a detail. */
import type { TransactionRow } from '@wf/db/transaction-query';
import type { TransactionDetail } from '@wf/db/transactions';
import { m } from '@wf/i18n/messages';
import { categoryName } from '../../lib/ledger-labels.ts';
import type { LedgerData } from '../ledger/use-transaction-form.ts';

/** A table row has every field; a detail converts with {@link actionRowOf}. */
export type ActionRow = Pick<
  TransactionRow,
  | 'id'
  | 'type'
  | 'occurredAt'
  | 'merchant'
  | 'description'
  | 'categoryId'
  | 'accountId'
  | 'toAccountId'
  | 'amountMinor'
  | 'currency'
  | 'receivedMinor'
  | 'feeMinor'
  | 'hasAttachment'
>;

/** A detail as an {@link ActionRow}: the principal posting's account and signed amount (transfers: the source). */
export function actionRowOf(detail: TransactionDetail): ActionRow {
  const principal = detail.postings.filter((posting) => posting.role === 'principal');
  const from = principal.find((posting) => posting.amountMinor < 0n) ?? principal[0];
  const to = detail.type === 'transfer' ? principal.find((posting) => posting.amountMinor > 0n) : undefined;
  const fee = detail.postings.find((posting) => posting.role === 'fee');
  return {
    id: detail.id,
    type: detail.type,
    occurredAt: detail.occurredAt,
    merchant: detail.merchant,
    description: detail.description,
    categoryId: detail.categoryId,
    accountId: from?.accountId ?? '',
    toAccountId: to?.accountId ?? null,
    amountMinor: from?.amountMinor ?? 0n,
    currency: from?.currency ?? '',
    receivedMinor: to?.amountMinor ?? null,
    feeMinor: fee === undefined ? null : -fee.amountMinor,
    hasAttachment: detail.attachments.length > 0,
  };
}

/** "Shopee", else the description, else the category (or "Transfer"): how toasts and dialogs name a transaction. */
export function rowLabel(row: ActionRow, ledger: LedgerData): string {
  const category = ledger.categories.find((candidate) => candidate.id === row.categoryId);
  return (
    row.merchant ??
    row.description ??
    (category === undefined ? m.transactions_label_transfer() : categoryName(category))
  );
}
