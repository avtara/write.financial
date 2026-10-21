// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Design Section 19 ("Piutang", KZZZy) as the repositories return it on 15 Okt 2026: Nadia's split bill Rp242.500
 * due 18 Okt with the H-1 reminder, Raka Pratama's Rp400.000 loan with Rp100.000 back, and Dimas and Sari settled
 * within 90 days — Rp542.500 outstanding.
 */
import type { ReceivablesOverview, ReceivableView } from '@wf/db/receivables';
import type { LocalDate } from '@wf/domain/period';
import type { SplitBillContext } from '../src/server/fn/receivables.ts';
import { account, BCA, categoryId } from './ledger-fixtures.ts';

const d = (value: string) => value as LocalDate;

export const GOPAY = account({
  id: 'acc-gopay',
  type: 'ewallet',
  displayName: 'GoPay',
  providerName: 'GoPay',
  color: 'green',
  balanceMinor: 412_000n,
  balanceBaseMinor: 412_000n,
  sortOrder: 3,
});

/** A receivable as `receivables.list` returns it; an open Rp100.000 loan from BCA by default. */
export function receivable(overrides: Partial<ReceivableView> & Pick<ReceivableView, 'id'>): ReceivableView {
  return {
    counterparty: 'Teman',
    description: null,
    note: null,
    principalMinor: 100_000n,
    paidMinor: 0n,
    remainingMinor: 100_000n,
    repaidBps: 0,
    currency: 'IDR',
    fromAccountId: BCA.id,
    source: 'loan',
    sourceTransactionId: null,
    transactionId: null,
    lentOn: d('2026-10-01'),
    dueDate: null,
    remind: false,
    status: 'open',
    settledAt: null,
    writtenOffAt: null,
    writeoffTransactionId: null,
    payments: [],
    ...overrides,
  };
}

export const NADIA = receivable({
  id: 'rcv-nadia',
  counterparty: 'Nadia',
  description: 'Nonton bareng CGV Grand Indonesia',
  principalMinor: 242_500n,
  remainingMinor: 242_500n,
  source: 'split_bill',
  lentOn: d('2026-10-15'),
  dueDate: d('2026-10-18'),
  remind: true,
});

export const RAKA = receivable({
  id: 'rcv-raka',
  counterparty: 'Raka Pratama',
  principalMinor: 400_000n,
  paidMinor: 100_000n,
  remainingMinor: 300_000n,
  repaidBps: 2_500,
  fromAccountId: GOPAY.id,
  lentOn: d('2026-10-02'),
  dueDate: d('2026-10-31'),
  status: 'partial',
  payments: [
    { id: 'pay-raka-1', amountMinor: 100_000n, accountId: GOPAY.id, receivedOn: d('2026-10-10'), transactionId: null },
  ],
});

export const DIMAS = receivable({
  id: 'rcv-dimas',
  counterparty: 'Dimas',
  description: 'Patungan kado',
  principalMinor: 150_000n,
  paidMinor: 150_000n,
  remainingMinor: 0n,
  repaidBps: 10_000,
  source: 'split_bill',
  lentOn: d('2026-09-26'),
  status: 'settled',
  settledAt: new Date('2026-10-02T05:00:00Z'),
  payments: [
    { id: 'pay-dimas', amountMinor: 150_000n, accountId: GOPAY.id, receivedOn: d('2026-10-02'), transactionId: null },
  ],
});

export const SARI = receivable({
  id: 'rcv-sari',
  counterparty: 'Sari',
  description: 'Talangan tiket kereta',
  principalMinor: 385_000n,
  paidMinor: 385_000n,
  remainingMinor: 0n,
  repaidBps: 10_000,
  lentOn: d('2026-09-12'),
  status: 'settled',
  settledAt: new Date('2026-09-21T05:00:00Z'),
  payments: [
    { id: 'pay-sari', amountMinor: 385_000n, accountId: BCA.id, receivedOn: d('2026-09-21'), transactionId: null },
  ],
});

/** The Receivables tab of KZZZy by default. */
export function receivablesOverview(overrides: Partial<ReceivablesOverview> = {}): ReceivablesOverview {
  return {
    today: d('2026-10-15'),
    active: [NADIA, RAKA],
    history: [DIMAS, SARI],
    outstandingMinor: 542_500n,
    people: ['Nadia', 'Raka Pratama', 'Dimas', 'Sari', 'Bima Aditya'],
    ...overrides,
  };
}

/** No receivable at all (exCE7). */
export const NO_RECEIVABLES = receivablesOverview({ active: [], history: [], outstandingMinor: 0n, people: [] });

/** "Pisah tagihan" on 15 Okt: Rp542.500 outstanding, Oktober spending 16.500.000, Hiburan 1.600.000 spent. */
export function splitBillContext(overrides: Partial<SplitBillContext> = {}): SplitBillContext {
  return {
    today: d('2026-10-15'),
    people: ['Nadia', 'Raka Pratama', 'Dimas'],
    receivablesMinor: 542_500n,
    month: { label: '2026-10', expenseMinor: 16_500_000n } as SplitBillContext['month'],
    budget: {
      start: d('2026-10-01'),
      end: d('2026-10-31'),
      label: '2026-10' as SplitBillContext['month']['label'],
      remainingMinor: 2_250_000n,
      daysLeft: 16,
      stepMinor: 1_000n,
      lines: [{ categoryId: categoryId('system:entertainment'), spentMinor: 1_600_000n }],
    },
    ...overrides,
  };
}
