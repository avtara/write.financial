// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { BCA, categoryId, GOTRADE, LEDGER, userCategory } from '../../../test/ledger-fixtures.ts';
import { posting, RECEIPT, transactionDetail, transactionRow } from '../../../test/transaction-fixtures.ts';
import { actionRowOf, rowLabel } from './action-row.ts';

describe('actionRowOf', () => {
  it('takes an expense’s outgoing posting', () => {
    const detail = transactionDetail('tx-1', { merchant: 'Shopee', description: 'Kabel' });
    expect(actionRowOf(detail)).toEqual({
      id: 'tx-1',
      type: 'expense',
      occurredAt: detail.occurredAt,
      merchant: 'Shopee',
      description: 'Kabel',
      categoryId: categoryId('system:food'),
      accountId: BCA.id,
      toAccountId: null,
      amountMinor: -10_000n,
      currency: 'IDR',
      receivedMinor: null,
      feeMinor: null,
      hasAttachment: false,
    });
  });

  it('takes an income’s only posting and notes attachments', () => {
    const detail = transactionDetail('tx-2', {
      type: 'income',
      postings: [posting(BCA.id, 500_000n)],
      attachments: [RECEIPT],
    });
    expect(actionRowOf(detail)).toMatchObject({
      accountId: BCA.id,
      amountMinor: 500_000n,
      toAccountId: null,
      receivedMinor: null,
      hasAttachment: true,
    });
  });

  it('takes a transfer’s source, destination, and fee', () => {
    const detail = transactionDetail('tx-3', {
      type: 'transfer',
      categoryId: null,
      postings: [
        posting(BCA.id, -3_000_000n),
        posting(GOTRADE.id, 18_210n, { currency: 'USD' }),
        posting(BCA.id, -6_500n, { role: 'fee' }),
      ],
    });
    expect(actionRowOf(detail)).toMatchObject({
      accountId: BCA.id,
      amountMinor: -3_000_000n,
      currency: 'IDR',
      toAccountId: GOTRADE.id,
      receivedMinor: 18_210n,
      feeMinor: 6_500n,
    });
  });

  it('has no account or amount without postings', () => {
    expect(actionRowOf(transactionDetail('tx-4', { type: 'transfer', postings: [] }))).toMatchObject({
      accountId: '',
      amountMinor: 0n,
      currency: '',
      toAccountId: null,
      receivedMinor: null,
    });
  });
});

describe('rowLabel', () => {
  it('names a transaction by merchant, else description, else category, else “Transfer”', () => {
    const kopi = userCategory({ id: 'c-kopi', name: 'Kopi' });
    const ledger = { ...LEDGER, categories: [...LEDGER.categories, kopi] };
    expect(rowLabel(transactionRow('a', { merchant: 'Shopee', description: 'Kabel' }), ledger)).toBe('Shopee');
    expect(rowLabel(transactionRow('b', { description: 'Kabel' }), ledger)).toBe('Kabel');
    expect(rowLabel(transactionRow('c', { categoryId: kopi.id }), ledger)).toBe('Kopi');
    expect(rowLabel(transactionRow('d', { type: 'transfer', categoryId: null }), ledger)).toBe('Transfer');
  });
});
