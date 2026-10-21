// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { BCA, categoryId } from '../../../test/ledger-fixtures.ts';
import { GOPAY, NADIA, RAKA, receivablesOverview } from '../../../test/receivable-fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import * as fns from './receivables.ts';
import type { SplitBillContext } from './receivables.ts';

const CLIENT = '0192a6c0-0000-7000-8000-000000000009';
const SHARE = '0192a6c0-0000-7000-8000-00000000000a';
const ID = '0192a6c0-0000-7000-8000-000000000001';
const ACCOUNT = '0192a6c0-0000-7000-8000-000000000002';

const fake = vi.hoisted(() => ({
  receivables: {
    list: vi.fn(),
    record: vi.fn(() => Promise.resolve({ receivable: 'made', transactionId: 'tx' })),
    receivePayment: vi.fn(() => Promise.resolve('paid')),
    writeOff: vi.fn(() => Promise.resolve('written off')),
    recordSplitBill: vi.fn(() => Promise.resolve({ transactionId: 'tx', receivables: [] })),
  },
  transactionQuery: { summary: vi.fn() },
  budgets: { status: vi.fn() },
  notificationSettings: { get: vi.fn(() => Promise.resolve({ reminderTime: '09:00' })) },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      ...fake,
      // 15 Okt 2026, 09.42 WIB (the E2E clock).
      now: () => new Date('2026-10-15T02:42:00Z'),
    }),
}));

const session = fakeSession();
const USER_ID = session.user.id;
const signedIn = () => requestContext(session);

const BUDGET = {
  baseCurrency: 'IDR',
  period: { start: '2026-10-01', end: '2026-10-31', label: '2026-10' },
  version: { id: 'v' },
  totals: { limitMinor: 18_000_000n, spentMinor: 15_750_000n, daysLeft: 16 },
  lines: [{ categoryId: categoryId('system:entertainment'), spentMinor: 1_600_000n, limitMinor: 2_000_000n }],
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.receivables.list.mockResolvedValue(receivablesOverview());
  fake.transactionQuery.summary.mockResolvedValue({ inMinor: 26_000_000n, outMinor: 16_500_000n });
  fake.budgets.status.mockResolvedValue(BUDGET);
});

describe('getSplitBillContext', () => {
  it('gives the people, the receivables, the month, and the budget’s safe-daily inputs', async () => {
    expect(await call(fns.getSplitBillContext, { context: signedIn() })).toEqual({
      ok: true,
      value: {
        today: '2026-10-15',
        people: ['Nadia', 'Raka Pratama', 'Dimas', 'Sari', 'Bima Aditya'],
        receivablesMinor: 542_500n,
        month: { label: '2026-10', expenseMinor: 16_500_000n },
        budget: {
          start: '2026-10-01',
          end: '2026-10-31',
          label: '2026-10',
          remainingMinor: 2_250_000n,
          daysLeft: 16,
          stepMinor: 1_000n,
          lines: [{ categoryId: categoryId('system:entertainment'), spentMinor: 1_600_000n }],
        },
        reminderTime: '09:00',
      },
    });
    expect(fake.transactionQuery.summary).toHaveBeenCalledWith(USER_ID, { from: '2026-10-01', to: '2026-10-31' });
  });

  it('has no budget without one in force, and reads the date in Jakarta without a time zone', async () => {
    fake.budgets.status.mockResolvedValue({ ...BUDGET, version: null });
    const result = await call<{ ok: true; value: SplitBillContext }>(fns.getSplitBillContext, {
      context: requestContext({ ...session, user: { ...session.user, timezone: null } }),
    });
    expect(result.value).toMatchObject({ today: '2026-10-15', budget: null });
  });
});

describe('recordReceivable (H7g1A)', () => {
  it('records a loan from the session user and answers the receivable', async () => {
    const stored = {
      clientId: CLIENT,
      counterparty: 'Bima Aditya',
      amountMinor: 500_000n,
      fromAccountId: BCA.id,
      lentAt: new Date('2026-10-15T02:42:00Z'),
      dueDate: '2026-10-31',
      remind: true,
    };
    const data = { ...stored, note: undefined };
    expect(await call(fns.recordReceivable, { context: signedIn(), data })).toEqual({ ok: true, value: 'made' });
    expect(fake.receivables.record).toHaveBeenCalledWith(USER_ID, { ...stored, source: 'loan' });
    const validator = validatorOf(fns.recordReceivable);
    const input = { ...data, fromAccountId: ACCOUNT, note: ' Pinjam untuk servis motor ' };
    expect(validator.parse(input)).toMatchObject({ dueDate: '2026-10-31', note: 'Pinjam untuk servis motor' });
    expect(validator.safeParse({ ...input, counterparty: '  ' }).success).toBe(false);
    expect(validator.safeParse({ ...input, counterparty: 'x'.repeat(61) }).success).toBe(false);
    expect(validator.safeParse({ ...input, amountMinor: 0n }).success).toBe(false);
    expect(validator.safeParse({ ...input, dueDate: '31-10-2026' }).success).toBe(false);
    expect(validator.safeParse({ ...input, dueDate: null }).success).toBe(true);
  });
});

describe('receiveReceivablePayment (ivnWw)', () => {
  it('records Raka’s Rp200.000 into GoPay', async () => {
    const payment = {
      clientId: CLIENT,
      amountMinor: 200_000n,
      accountId: GOPAY.id,
      receivedAt: new Date('2026-10-15T02:42:00Z'),
    };
    const data = { id: RAKA.id, ...payment };
    expect(await call(fns.receiveReceivablePayment, { context: signedIn(), data })).toEqual({
      ok: true,
      value: 'paid',
    });
    expect(fake.receivables.receivePayment).toHaveBeenCalledWith(USER_ID, RAKA.id, payment);
    const validator = validatorOf(fns.receiveReceivablePayment);
    expect(validator.safeParse({ ...data, id: ID, accountId: ACCOUNT, amountMinor: -1n }).success).toBe(false);
  });
});

describe('writeOffReceivable ("Hapuskan")', () => {
  it('writes the remainder off', async () => {
    const data = { id: NADIA.id, clientId: CLIENT, occurredAt: new Date('2026-10-15T02:42:00Z') };
    expect(await call(fns.writeOffReceivable, { context: signedIn(), data })).toEqual({
      ok: true,
      value: 'written off',
    });
    expect(fake.receivables.writeOff).toHaveBeenCalledWith(USER_ID, NADIA.id, {
      clientId: CLIENT,
      occurredAt: data.occurredAt,
    });
    expect(validatorOf(fns.writeOffReceivable).safeParse({ ...data, id: 'nadia' }).success).toBe(false);
  });
});

describe('recordSplitBill (IGHyP)', () => {
  it('records the user’s part and the shares', async () => {
    const draft = {
      type: 'expense',
      clientId: CLIENT,
      occurredAt: new Date('2026-10-11T12:30:00Z'),
      accountId: ACCOUNT,
      amountMinor: 242_500n,
      categoryId: null,
      description: 'CGV Grand Indonesia',
    };
    const transaction = { ...draft, merchant: undefined };
    const shares = [
      { clientId: SHARE, counterparty: 'Nadia', amountMinor: 242_500n, dueDate: '2026-10-18', remind: true },
    ];
    expect(await call(fns.recordSplitBill, { context: signedIn(), data: { transaction, shares } })).toEqual({
      ok: true,
      value: { transactionId: 'tx', receivables: [] },
    });
    expect(fake.receivables.recordSplitBill).toHaveBeenCalledWith(USER_ID, { draft, shares });
    const validator = validatorOf(fns.recordSplitBill);
    expect(validator.safeParse({ transaction, shares }).success).toBe(true);
    expect(validator.safeParse({ transaction, shares: [] }).success).toBe(false);
    expect(validator.safeParse({ transaction: { ...transaction, type: 'income' }, shares }).success).toBe(false);
    expect(validator.safeParse({ transaction, shares: Array.from({ length: 21 }, () => shares[0]) }).success).toBe(
      false,
    );
  });
});

it('refuses signed-out requests before any repository call', async () => {
  const all = Object.values(fns);
  expect(all).toHaveLength(5);
  for (const fn of all) {
    expect(await call(fn, { context: requestContext(null), data: {} })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
  }
  expect(fake.receivables.list).not.toHaveBeenCalled();
  expect(fake.receivables.record).not.toHaveBeenCalled();
});
