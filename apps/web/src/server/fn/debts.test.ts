// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_BEFORE_PAYMENT, KULKAS, OCTOBER_BILL, VISA_ACCOUNT, VISA_ID, visa } from '../../../test/debt-fixtures.ts';
import { fakeSession } from '../../../test/fixtures.ts';
import { BCA } from '../../../test/ledger-fixtures.ts';
import { posting, transactionDetail, transactionRow } from '../../../test/transaction-fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import * as fns from './debts.ts';

const CLIENT = '0192a6c0-0000-7000-8000-000000000009';
const ID = '0192a6c0-0000-7000-8000-000000000001';

const fake = vi.hoisted(() => ({
  ledgerError: (code: string) => Object.assign(new Error(code), { code }),
  debts: {
    list: vi.fn(),
    cards: vi.fn(),
    create: vi.fn((_userId: string, input: unknown) => Promise.resolve({ created: input })),
    recordInstallmentPurchase: vi.fn(() => Promise.resolve({ transactionId: 'tx', debt: 'debt' })),
    recordCardPayment: vi.fn(() => Promise.resolve({ transactionId: 'tx', debts: [] })),
  },
  accounts: { list: vi.fn(), get: vi.fn() },
  preferences: { get: vi.fn(), update: vi.fn() },
  receivables: { list: vi.fn() },
  transactionQuery: { summary: vi.fn(), list: vi.fn() },
  transactions: { get: vi.fn() },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      debts: fake.debts,
      accounts: fake.accounts,
      preferences: fake.preferences,
      receivables: fake.receivables,
      transactionQuery: fake.transactionQuery,
      transactions: fake.transactions,
      // 15 Okt 2026, 09.42 WIB (the E2E clock).
      now: () => new Date('2026-10-15T02:42:00Z'),
    }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());

const KULKAS_EXPENSE = {
  type: 'expense',
  clientId: CLIENT,
  occurredAt: new Date('2026-10-15T07:20:00Z'),
  accountId: VISA_ID,
  amountMinor: 3_000_000n,
  categoryId: null,
  description: 'Tokopedia — Kulkas 2 pintu',
};
const PAYMENT = {
  type: 'transfer',
  clientId: CLIENT,
  occurredAt: new Date('2026-10-15T01:30:00Z'),
  fromAccountId: BCA.id,
  toAccountId: VISA_ID,
  sentMinor: 2_000_000n,
  receivedMinor: 2_000_000n,
};
const KULKAS_ROWS = [
  { dueDate: '2026-10-20', principalMinor: 1_000_000n, interestMinor: 0n, feeMinor: 0n },
  { dueDate: '2026-11-20', principalMinor: 1_000_000n, interestMinor: 0n, feeMinor: 0n },
  { dueDate: '2026-12-20', principalMinor: 1_000_000n, interestMinor: 0n, feeMinor: 0n },
];
const PLAN = {
  kind: 'card_installment',
  name: 'Tokopedia — Kulkas 2 pintu',
  provider: 'BCA Visa',
  cardAccountId: VISA_ID,
  principalMinor: 3_000_000n,
  currency: 'IDR',
  interestMethod: 'flat',
  monthlyRateBps: 0,
  adminFeeMinor: 0n,
  tenorMonths: 3,
  firstDueDate: '2026-10-20',
  schedule: KULKAS_ROWS,
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.debts.list.mockResolvedValue({ today: '2026-10-15', debts: [], remainingMinor: 0n });
  fake.debts.cards.mockResolvedValue([visa()]);
  fake.accounts.list.mockResolvedValue({ baseCurrency: 'IDR', accounts: [BCA, VISA_ACCOUNT] });
  fake.accounts.get.mockResolvedValue(BCA);
  fake.preferences.get.mockResolvedValue({ ccPaymentPriority: [] });
  fake.preferences.update.mockImplementation((_userId: string, patch: object) => Promise.resolve(patch));
  fake.receivables.list.mockResolvedValue({ outstandingMinor: 542_500n });
  fake.transactionQuery.summary.mockResolvedValue({ inMinor: 26_000_000n, outMinor: 16_500_000n });
  fake.transactionQuery.list.mockResolvedValue({ rows: [...OCTOBER_BILL, transactionRow('tx-kulkas')], total: 4 });
});

describe('getDebtsOverview', () => {
  it('golden rHTMd: the card with its October cycle, without plan sources; the month and the receivables', async () => {
    fake.debts.list.mockResolvedValue({ today: '2026-10-15', debts: [KULKAS], remainingMinor: 3_000_000n });
    fake.debts.cards.mockResolvedValue([visa(), visa({ accountId: 'acc-new', statementDay: null })]);
    const result = await call(fns.getDebtsOverview, { context: signedIn() });
    expect(result).toEqual({
      ok: true,
      value: {
        today: '2026-10-15',
        accounts: { baseCurrency: 'IDR', accounts: [BCA, VISA_ACCOUNT] },
        debts: [KULKAS],
        cards: [
          { ...visa(), transactions: OCTOBER_BILL },
          { ...visa({ accountId: 'acc-new', statementDay: null }), transactions: [] },
        ],
        priority: ['installments', 'spending'],
        receivablesMinor: 542_500n,
        month: { incomeMinor: 26_000_000n, expenseMinor: 16_500_000n },
      },
    });
    expect(fake.transactionQuery.summary).toHaveBeenCalledWith(USER_ID, { from: '2026-10-01', to: '2026-10-31' });
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(
      USER_ID,
      { accountIds: [VISA_ID], types: ['expense', 'income'], from: '2026-09-21', to: '2026-10-20' },
      { sort: 'date_asc', limit: 200 },
    );
    expect(fake.transactionQuery.list).toHaveBeenCalledTimes(1);
  });
});

describe('getCardPaymentContext', () => {
  it('answers the card with its installments and the priority, or NOT_FOUND', async () => {
    fake.debts.list.mockResolvedValue({
      today: '2026-10-15',
      debts: [KULKAS, { ...KULKAS, id: 'other', cardAccountId: 'x' }],
    });
    fake.preferences.get.mockResolvedValue({ ccPaymentPriority: ['spending', 'installments'] });
    expect(await call(fns.getCardPaymentContext, { context: signedIn(), data: { accountId: VISA_ID } })).toEqual({
      ok: true,
      value: { today: '2026-10-15', card: visa(), debts: [KULKAS], priority: ['spending', 'installments'] },
    });
    expect(await call(fns.getCardPaymentContext, { context: signedIn(), data: { accountId: ID } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});

describe('createDebt', () => {
  const MACBOOK = {
    kind: 'zero_percent',
    name: 'MacBook Air M4 — iBox',
    provider: 'Kredivo',
    principalMinor: 18_999_000n,
    tenorMonths: 12,
    monthlyRateBps: 0,
    adminFeeMinor: 0n,
    firstDueDate: '2026-11-25',
    payFromAccountId: ID,
  };

  it('golden v3Igd: 12 × 1.583.250 from 25 Nov, flat for 0%, in the account currency', async () => {
    const result = await call<{ ok: true; value: { created: { schedule: { principalMinor: bigint }[] } } }>(
      fns.createDebt,
      { context: signedIn(), data: MACBOOK },
    );
    expect(fake.accounts.get).toHaveBeenCalledWith(USER_ID, ID);
    expect(fake.debts.create).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ ...MACBOOK, currency: 'IDR', interestMethod: 'flat' }),
    );
    expect(result.value.created.schedule).toHaveLength(12);
    expect(result.value.created.schedule.every((row) => row.principalMinor === 1_583_250n)).toBe(true);
  });

  it('uses an annuity for a mortgage and never passes undefined', async () => {
    await call(fns.createDebt, {
      context: signedIn(),
      data: { ...MACBOOK, kind: 'mortgage', monthlyRateBps: 75, provider: undefined },
    });
    const [, input] = fake.debts.create.mock.lastCall as [string, Record<string, unknown>];
    expect(input).toMatchObject({ interestMethod: 'annuity' });
    expect('provider' in input).toBe(false);
  });

  it('validates its input', () => {
    const create = validatorOf(fns.createDebt);
    expect(create.safeParse(MACBOOK).success).toBe(true);
    expect(create.safeParse({ ...MACBOOK, kind: 'card_installment' }).success).toBe(false);
    expect(create.safeParse({ ...MACBOOK, tenorMonths: 361 }).success).toBe(false);
    expect(create.safeParse({ ...MACBOOK, monthlyRateBps: 10_001 }).success).toBe(false);
    expect(create.safeParse({ ...MACBOOK, principalMinor: 0n }).success).toBe(false);
    expect(create.safeParse({ ...MACBOOK, name: ' ' }).success).toBe(false);
  });
});

describe('convertCardTransaction (OEZIG)', () => {
  const kulkas = (patch = {}) =>
    transactionDetail('tx-kulkas', {
      localDate: '2026-10-14' as never,
      description: 'Tokopedia — Kulkas 2 pintu',
      postings: [posting(VISA_ID, -3_000_000n)],
      ...patch,
    });
  const terms = { transactionId: ID, tenor: 3, monthlyRateBps: 0, adminFeeMinor: 0n };

  it('makes a plan of a recent card expense, named after it, on the cycle statement', async () => {
    fake.transactions.get.mockResolvedValue(kulkas());
    expect(await call(fns.convertCardTransaction, { context: signedIn(), data: terms })).toMatchObject({ ok: true });
    expect(fake.debts.create).toHaveBeenCalledWith(USER_ID, { ...PLAN, sourceTransactionId: 'tx-kulkas' });
    fake.transactions.get.mockResolvedValue(kulkas({ description: null, merchant: 'Tokopedia' }));
    await call(fns.convertCardTransaction, { context: signedIn(), data: terms });
    expect(fake.debts.create).toHaveBeenLastCalledWith(USER_ID, expect.objectContaining({ name: 'Tokopedia' }));
    fake.transactions.get.mockResolvedValue(kulkas({ description: null }));
    await call(fns.convertCardTransaction, { context: signedIn(), data: terms });
    expect(fake.debts.create).toHaveBeenLastCalledWith(USER_ID, expect.objectContaining({ name: 'BCA Visa' }));
  });

  it.each([
    ['an income', { type: 'income' }],
    ['a deleted expense', { deletedAt: new Date() }],
    ['an expense without postings', { postings: [] }],
    ['an expense off the cards', { postings: [posting(BCA.id, -3_000_000n)] }],
    ['a small expense', { postings: [posting(VISA_ID, -499_999n)] }],
    ['a billed expense', { localDate: '2026-09-20' }],
  ])('refuses %s', async (_, patch) => {
    fake.transactions.get.mockResolvedValue(kulkas(patch));
    expect(await call(fns.convertCardTransaction, { context: signedIn(), data: terms })).toEqual({
      ok: false,
      code: 'INVALID_DEBT',
    });
    expect(fake.debts.create).not.toHaveBeenCalled();
  });

  it('refuses a card without statement or due day, and other tenors', async () => {
    fake.transactions.get.mockResolvedValue(kulkas());
    fake.debts.cards.mockResolvedValue([visa({ dueDay: null })]);
    expect(await call(fns.convertCardTransaction, { context: signedIn(), data: terms })).toEqual({
      ok: false,
      code: 'INVALID_DEBT',
    });
    expect(validatorOf(fns.convertCardTransaction).safeParse({ ...terms, tenor: 5 }).success).toBe(false);
  });
});

describe('recordCardInstallment (hNvip)', () => {
  it('records the expense with its plan', async () => {
    const data = { transaction: KULKAS_EXPENSE, tenor: 3, monthlyRateBps: 0, adminFeeMinor: 0n };
    expect(await call(fns.recordCardInstallment, { context: signedIn(), data })).toEqual({
      ok: true,
      value: { transactionId: 'tx', debt: 'debt' },
    });
    expect(fake.debts.recordInstallmentPurchase).toHaveBeenCalledWith(USER_ID, { draft: KULKAS_EXPENSE, plan: PLAN });
    const { description, ...unnamed } = KULKAS_EXPENSE;
    expect(description).toBe('Tokopedia — Kulkas 2 pintu');
    await call(fns.recordCardInstallment, {
      context: signedIn(),
      data: { ...data, transaction: { ...unnamed, merchant: 'Tokopedia' } },
    });
    expect(fake.debts.recordInstallmentPurchase).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({ plan: expect.objectContaining({ name: 'Tokopedia' }) as unknown }),
    );
    await call(fns.recordCardInstallment, { context: signedIn(), data: { ...data, transaction: unnamed } });
    expect(fake.debts.recordInstallmentPurchase).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({ plan: expect.objectContaining({ name: 'BCA Visa' }) as unknown }),
    );
    // Without a time zone the user's day is Jakarta's.
    const session = fakeSession();
    await call(fns.recordCardInstallment, {
      context: requestContext({ ...session, user: { ...session.user, timezone: null } }),
      data,
    });
    expect(fake.debts.recordInstallmentPurchase).toHaveBeenLastCalledWith(USER_ID, {
      draft: KULKAS_EXPENSE,
      plan: PLAN,
    });
    expect(
      validatorOf(fns.recordCardInstallment).safeParse({ ...data, transaction: { ...KULKAS_EXPENSE, type: 'income' } })
        .success,
    ).toBe(false);
  });
});

describe('recordCardPayment (qrRRV)', () => {
  it('allocates installments first and recalculates with the chosen mode', async () => {
    fake.debts.cards.mockResolvedValue([CARD_BEFORE_PAYMENT]);
    fake.debts.list.mockResolvedValue({ today: '2026-11-10', debts: [KULKAS] });
    const data = { transaction: PAYMENT, priority: ['installments', 'spending'], mode: 'reduce_amount' };
    expect(await call(fns.recordCardPayment, { context: signedIn(), data })).toMatchObject({ ok: true });
    expect(fake.debts.recordCardPayment).toHaveBeenCalledWith(USER_ID, {
      draft: PAYMENT,
      allocations: [{ bucket: 'installments', debtId: 'debt-a', amountMinor: 2_000_000n }],
      recalculations: [
        {
          debtId: 'debt-a',
          mode: 'reduce_amount',
          schedule: [
            { dueDate: '2026-11-20', principalMinor: 333_334n, interestMinor: 0n, feeMinor: 0n },
            { dueDate: '2026-12-20', principalMinor: 333_333n, interestMinor: 0n, feeMinor: 0n },
            { dueDate: '2027-01-20', principalMinor: 333_333n, interestMinor: 0n, feeMinor: 0n },
          ],
        },
      ],
    });
    const payment = validatorOf(fns.recordCardPayment);
    expect(payment.safeParse({ ...data, priority: ['spending', 'spending'] }).success).toBe(false);
    expect(payment.safeParse({ ...data, priority: ['spending'] }).success).toBe(false);
    expect(payment.safeParse({ ...data, mode: 'later' }).success).toBe(false);
  });
});

describe('setCardPaymentPriority', () => {
  it('saves the order and answers it', async () => {
    const data = { priority: ['spending', 'installments'] };
    expect(await call(fns.setCardPaymentPriority, { context: signedIn(), data })).toEqual({
      ok: true,
      value: ['spending', 'installments'],
    });
    expect(fake.preferences.update).toHaveBeenCalledWith(USER_ID, { ccPaymentPriority: ['spending', 'installments'] });
  });
});

it('refuses signed-out requests before any repository call', async () => {
  const all = Object.values(fns);
  expect(all).toHaveLength(7);
  for (const fn of all) {
    expect(await call(fn, { context: requestContext(null), data: {} })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
  }
  expect(fake.debts.list).not.toHaveBeenCalled();
  expect(fake.preferences.update).not.toHaveBeenCalled();
});
