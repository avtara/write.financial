// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek, ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createDebts, type DebtInput, type InstallmentInput } from './debts.ts';
import { materializeIn } from './occurrences.ts';
import { createOccurrenceJobs } from './occurrence-jobs.ts';
import { occurrenceReviewItemIn } from './review-items.ts';
import { createReview } from './review.ts';
import { createSchedules } from './schedules.ts';
import { withUser } from './db.ts';
import { createTransactions } from './transactions.ts';

let test: TestDatabase;
let alice: LedgerFixture;
let card: string;

/** 10 Nov 2026, 12.00 WIB: the day the design recalculates installment A (`A7ttc`). */
const NOW = new Date('2026-11-10T05:00:00Z');
const debts = () => createDebts(test.db, { now: () => NOW });
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const at = (date: string) => new Date(`${date}T12:00:00+07:00`);
const d = (date: string) => date as LocalDate;
const row = (dueDate: string, principalMinor: bigint, extra: Partial<InstallmentInput> = {}): InstallmentInput => ({
  dueDate: d(dueDate),
  principalMinor,
  interestMinor: 0n,
  feeMinor: 0n,
  ...extra,
});

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

/** A credit card (limit 15.000.000, statement on the 20th, payment due on the 5th) of `userId`. */
async function creditCard(
  userId: string,
  { currency = 'IDR', dueDay = 5 }: { currency?: string; dueDay?: number | null } = {},
): Promise<string> {
  const [account] = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, last4, currency, opening_date, color,
       cc_limit_minor, cc_statement_day, cc_due_day, include_in_available)
     VALUES ($1, 'credit_card', 'BCA', 'BCA Visa', '7710', $2, '2026-01-01', 'blue', 15000000, 20, $3, false)
     RETURNING id`,
    [userId, currency, dueDay],
  );
  return account?.id as string;
}

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await ledgerFixture(test, 'alice@example.test');
  card = await creditCard(alice.userId);
});

/** Transaction A: Tokopedia — Kulkas 2 pintu, Rp3.000.000 on the card, 2 Nov. */
const kulkas = () =>
  alice.entry('expense', '2026-11-02', 3_000_000n, alice.category('system:shopping'), {
    accountId: card,
    merchant: 'Tokopedia',
  });

const cardPlan = (sourceTransactionId: string | null, schedule?: InstallmentInput[]): DebtInput => ({
  kind: 'card_installment',
  name: 'Tokopedia — Kulkas 2 pintu',
  provider: 'BCA Visa',
  cardAccountId: card,
  sourceTransactionId,
  principalMinor: 3_000_000n,
  currency: 'IDR',
  interestMethod: 'flat',
  monthlyRateBps: 0,
  adminFeeMinor: 0n,
  tenorMonths: 3,
  firstDueDate: d('2026-11-20'),
  schedule: schedule ?? [row('2026-11-20', 1_000_000n), row('2026-12-20', 1_000_000n), row('2027-01-20', 1_000_000n)],
});

/** Kredivo MacBook Air M4 (`v3Igd`): 18.999.000 in 12 × 1.583.250 from 25 Nov, paid from BCA. */
const macbook = (overrides: Partial<DebtInput> = {}): DebtInput => {
  const tenor = overrides.tenorMonths ?? 12;
  const principal = overrides.principalMinor ?? 18_999_000n;
  return {
    kind: 'paylater',
    name: '  MacBook Air M4  ',
    provider: ' Kredivo ',
    payFromAccountId: alice.bca,
    categoryId: alice.category('system:shopping'),
    principalMinor: principal,
    currency: 'IDR',
    interestMethod: 'flat',
    monthlyRateBps: 0,
    adminFeeMinor: 0n,
    tenorMonths: tenor,
    firstDueDate: d('2026-11-25'),
    schedule: Array.from({ length: tenor }, (_, index) => {
      const month = new Date(Date.UTC(2026, 10 + index, 25)).toISOString().slice(0, 10);
      return row(month, principal / BigInt(tenor));
    }),
    ...overrides,
  };
};

const transferToCard = (amountMinor: bigint, date = '2026-11-10') =>
  asApp(() =>
    createTransactions(test.db, { getDek: fixtureGetDek, now: () => NOW }).create(alice.userId, {
      type: 'transfer',
      clientId: randomUUID(),
      occurredAt: at(date),
      fromAccountId: alice.bca,
      toAccountId: card,
      sentMinor: amountMinor,
      receivedMinor: amountMinor,
    }),
  );

describe('card installments (FR-U2–U4, Section 18 scenario)', () => {
  it('golden: 3.000.000 0% in 3, 2.000.000 paid early, recalculated to 333.334/333.333/333.333, limit left 13.000.000', async () => {
    const a = await kulkas();
    await alice.entry('expense', '2026-11-06', 1_000_000n, alice.category('system:food'), {
      accountId: card,
      merchant: 'Superindo',
    });
    const plan = await asApp(() => debts().create(alice.userId, cardPlan(a)));
    expect(plan).toMatchObject({
      kind: 'card_installment',
      cardAccountId: card,
      payFromAccountId: null,
      sourceTransactionId: a,
      remainingPrincipalMinor: 3_000_000n,
      paidEarlyMinor: 0n,
      recalcMode: null,
    });
    expect(
      plan.installments.map((installment) => [installment.seq, installment.totalMinor, installment.billed]),
    ).toEqual([
      [1, 1_000_000n, false],
      [2, 1_000_000n, false],
      [3, 1_000_000n, false],
    ]);
    // "Ubah jadi cicilan" keeps the expense: card installments make no occurrences.
    expect(await test.query('SELECT count(*)::int AS n FROM scheduled_occurrences')).toEqual([{ n: 0 }]);
    expect(await asApp(() => debts().cards(alice.userId))).toEqual([
      {
        accountId: card,
        name: 'BCA Visa',
        currency: 'IDR',
        limitMinor: 15_000_000n,
        statementDay: 20,
        dueDay: 5,
        balanceMinor: -4_000_000n,
        installmentsHeldMinor: 3_000_000n,
      },
    ]);

    const { id: payment } = await transferToCard(2_000_000n);
    const [paid] = await asApp(() =>
      debts().allocateCardPayment(alice.userId, {
        transactionId: payment,
        allocations: [{ bucket: 'installments', debtId: plan.id, amountMinor: 2_000_000n }],
        recalculations: [
          {
            debtId: plan.id,
            mode: 'reduce_amount',
            schedule: [row('2026-11-20', 333_334n), row('2026-12-20', 333_333n), row('2027-01-20', 333_333n)],
          },
        ],
      }),
    );
    expect(paid).toMatchObject({
      remainingPrincipalMinor: 1_000_000n,
      paidEarlyMinor: 2_000_000n,
      recalcMode: 'reduce_amount',
      recalculatedAt: NOW,
      tenorMonths: 3,
      status: 'active',
      allocations: [{ transactionId: payment, amountMinor: 2_000_000n, localDate: '2026-11-10' }],
    });
    expect(paid?.installments.map((installment) => [installment.seq, installment.principalMinor])).toEqual([
      [1, 333_334n],
      [2, 333_333n],
      [3, 333_333n],
    ]);
    const [visa] = await asApp(() => debts().cards(alice.userId));
    expect(visa).toMatchObject({ balanceMinor: -2_000_000n, installmentsHeldMinor: 1_000_000n });
    expect((visa?.limitMinor as bigint) + (visa?.balanceMinor as bigint)).toBe(13_000_000n);

    // The expense and the payment are managed here now.
    const transactions = createTransactions(test.db, { getDek: fixtureGetDek, now: () => NOW });
    for (const id of [a, payment]) {
      await expect(asApp(() => transactions.remove(alice.userId, [id]))).rejects.toMatchObject({
        code: 'INVALID_TRANSACTION',
      });
    }
    // The same payment cannot be allocated twice.
    await expect(
      asApp(() =>
        debts().allocateCardPayment(alice.userId, {
          transactionId: payment,
          allocations: [{ bucket: 'spending', amountMinor: 1n }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DEBT' });
  });

  it('pays an installment off in full, shortens a tenor, and bills rows on their statement date', async () => {
    const a = await kulkas();
    const plan = await asApp(() => debts().create(alice.userId, cardPlan(a)));
    const { id: shorten } = await transferToCard(1_000_000n);
    const [short] = await asApp(() =>
      debts().allocateCardPayment(alice.userId, {
        transactionId: shorten,
        allocations: [{ bucket: 'installments', debtId: plan.id, amountMinor: 1_000_000n }],
        recalculations: [
          {
            debtId: plan.id,
            mode: 'shorten_tenor',
            schedule: [row('2026-11-20', 1_000_000n), row('2026-12-20', 1_000_000n)],
          },
        ],
      }),
    );
    expect(short).toMatchObject({ tenorMonths: 2, recalcMode: 'shorten_tenor', remainingPrincipalMinor: 2_000_000n });

    // On 21 Nov the first row is on the statement: only the second is still owed as installment.
    const later = createDebts(test.db, { now: () => new Date('2026-11-21T05:00:00Z') });
    const billed = await asApp(() => later.get(alice.userId, plan.id));
    expect(billed.installments.map((installment) => installment.billed)).toEqual([true, false]);
    expect(billed.remainingPrincipalMinor).toBe(1_000_000n);
    const { id: payoff } = await transferToCard(2_500_000n, '2026-11-21');
    const [done] = await asApp(() =>
      later.allocateCardPayment(alice.userId, {
        transactionId: payoff,
        allocations: [
          { bucket: 'installments', debtId: plan.id, amountMinor: 1_000_000n },
          { bucket: 'spending', amountMinor: 1_000_000n },
          { bucket: 'credit', amountMinor: 500_000n },
        ],
      }),
    );
    expect(done).toMatchObject({ status: 'paid_off', remainingPrincipalMinor: 0n, paidEarlyMinor: 2_000_000n });
    expect(done?.installments.map((installment) => installment.seq)).toEqual([1]);
    expect((await asApp(() => later.list(alice.userId, { status: 'paid_off' }))).debts).toHaveLength(1);
    expect((await asApp(() => later.cards(alice.userId)))[0]?.installmentsHeldMinor).toBe(0n);

    // A payment to the card's spending only pays no installment.
    const { id: spending } = await transferToCard(10_000n, '2026-11-21');
    expect(
      await asApp(() =>
        later.allocateCardPayment(alice.userId, {
          transactionId: spending,
          allocations: [{ bucket: 'spending', amountMinor: 10_000n }],
        }),
      ),
    ).toEqual([]);
  });

  it('refuses allocations that do not fit the payment, the card, or the installment', async () => {
    const source = await kulkas();
    const plan = await asApp(() => debts().create(alice.userId, cardPlan(source)));
    const other = await creditCard(alice.userId);
    const { id: payment } = await transferToCard(2_000_000n);
    const { id: wrongKind } = await asApp(() =>
      createTransactions(test.db, { getDek: fixtureGetDek, now: () => NOW }).create(alice.userId, {
        type: 'transfer',
        clientId: randomUUID(),
        occurredAt: at('2026-11-10'),
        fromAccountId: alice.bca,
        toAccountId: alice.jago,
        sentMinor: 1n,
        receivedMinor: 1n,
      }),
    );
    const otherPlan = await asApp(() =>
      debts().create(alice.userId, {
        ...cardPlan(null),
        cardAccountId: other,
      }),
    );
    const part = (amountMinor: bigint, debtId = plan.id) => ({ bucket: 'installments' as const, debtId, amountMinor });
    const recalc = (schedule: InstallmentInput[], mode: 'reduce_amount' | 'shorten_tenor' = 'reduce_amount') => ({
      debtId: plan.id,
      mode,
      schedule,
    });
    const three = [row('2026-11-20', 333_334n), row('2026-12-20', 333_333n), row('2027-01-20', 333_333n)];
    for (const input of [
      { transactionId: wrongKind, allocations: [] },
      { transactionId: payment, allocations: [{ bucket: 'installments' as const, amountMinor: 1n }] },
      { transactionId: payment, allocations: [{ bucket: 'spending' as const, debtId: plan.id, amountMinor: 1n }] },
      { transactionId: payment, allocations: [{ bucket: 'spending' as const, amountMinor: 0n }] },
      {
        transactionId: payment,
        allocations: [
          { bucket: 'spending' as const, amountMinor: 1n },
          { bucket: 'spending' as const, amountMinor: 1n },
        ],
      },
      { transactionId: payment, allocations: [{ bucket: 'spending' as const, amountMinor: 2_000_001n }] },
      {
        transactionId: payment,
        allocations: [{ bucket: 'spending' as const, amountMinor: 1n }],
        recalculations: [recalc(three)],
      },
      { transactionId: payment, allocations: [part(2_000_000n)], recalculations: [recalc(three), recalc(three)] },
      { transactionId: payment, allocations: [part(1n, otherPlan.id)] },
      { transactionId: payment, allocations: [part(1n, randomUUID())] },
      { transactionId: payment, allocations: [part(2_000_000n)] },
      { transactionId: payment, allocations: [part(2_000_000n)], recalculations: [recalc(three.slice(0, 2))] },
      { transactionId: payment, allocations: [part(2_000_000n)], recalculations: [recalc([], 'shorten_tenor')] },
      {
        transactionId: payment,
        allocations: [part(2_000_000n)],
        recalculations: [recalc([...three, row('2027-02-20', 1n)], 'shorten_tenor')],
      },
      {
        transactionId: payment,
        allocations: [part(2_000_000n)],
        recalculations: [recalc([row('2026-11-20', 1n), row('2026-12-20', 1n), row('2027-01-20', 1n)])],
      },
      {
        transactionId: payment,
        allocations: [part(2_000_000n)],
        recalculations: [
          recalc([row('2026-11-01', 333_334n), row('2026-12-20', 333_333n), row('2027-01-20', 333_333n)]),
        ],
      },
    ]) {
      await expect(asApp(() => debts().allocateCardPayment(alice.userId, input))).rejects.toMatchObject({
        code: 'INVALID_DEBT',
      });
    }
    // More than is left, and a recalculation of an installment paid off in full.
    const { id: big } = await transferToCard(5_000_000n);
    for (const input of [
      { transactionId: big, allocations: [part(3_000_001n)] },
      { transactionId: big, allocations: [part(3_000_000n)], recalculations: [recalc(three)] },
    ]) {
      await expect(asApp(() => debts().allocateCardPayment(alice.userId, input))).rejects.toMatchObject({
        code: 'INVALID_DEBT',
      });
    }
  });
});

describe('debts: create and validation (FR-U1, FR-U3)', () => {
  it.each<[string, (base: DebtInput) => DebtInput]>([
    ['a card installment without a card', (base) => ({ ...base, kind: 'card_installment', payFromAccountId: null })],
    [
      'a card installment with a payment account',
      (base) => ({ ...base, kind: 'card_installment', cardAccountId: card }),
    ],
    ['a debt without a payment account', (base) => ({ ...base, payFromAccountId: null })],
    ['a debt with a card', (base) => ({ ...base, cardAccountId: card })],
    ['a debt from a card transaction', (base) => ({ ...base, sourceTransactionId: randomUUID() })],
    ['a zero principal', (base) => ({ ...base, principalMinor: 0n })],
    ['a negative rate', (base) => ({ ...base, monthlyRateBps: -1 })],
    ['a fractional rate', (base) => ({ ...base, monthlyRateBps: 1.5 })],
    ['a rate over 100%', (base) => ({ ...base, monthlyRateBps: 10_001 })],
    ['a negative admin fee', (base) => ({ ...base, adminFeeMinor: -1n })],
    ['a zero tenor', (base) => ({ ...base, tenorMonths: 0 })],
    ['a fractional tenor', (base) => ({ ...base, tenorMonths: 1.5 })],
    ['a long tenor', (base) => ({ ...base, tenorMonths: 361 })],
    ['a short schedule', (base) => ({ ...base, schedule: base.schedule.slice(1) })],
    ['another first due date', (base) => ({ ...base, firstDueDate: d('2026-11-26') })],
    [
      'an invalid due date',
      (base) => ({
        ...base,
        tenorMonths: 1,
        principalMinor: 1n,
        firstDueDate: d('2026-02-30'),
        schedule: [row('2026-02-30', 1n)],
      }),
    ],
    [
      'decreasing due dates',
      (base) => ({
        ...base,
        tenorMonths: 2,
        principalMinor: 2n,
        schedule: [row('2026-11-25', 1n), row('2026-11-25', 1n)],
      }),
    ],
    [
      'a negative row',
      (base) => ({ ...base, tenorMonths: 1, principalMinor: 1n, schedule: [row('2026-11-25', 1n, { feeMinor: -1n })] }),
    ],
    [
      'an empty row',
      (base) => ({
        ...base,
        tenorMonths: 2,
        principalMinor: 1n,
        schedule: [row('2026-11-25', 1n), row('2026-12-25', 0n)],
      }),
    ],
    ['principals that do not add up', (base) => ({ ...base, principalMinor: 18_999_001n })],
    ['an empty name', (base) => ({ ...base, name: '  ' })],
    ['a long name', (base) => ({ ...base, name: 'x'.repeat(61) })],
    ['a long provider', (base) => ({ ...base, provider: 'x'.repeat(41) })],
    [
      'a card installment on an account that is not a credit card',
      (base) => ({
        ...base,
        kind: 'card_installment',
        cardAccountId: alice.bca,
        payFromAccountId: null,
        categoryId: null,
      }),
    ],
    ['another currency', (base) => ({ ...base, currency: 'USD' })],
    ['an unknown account', (base) => ({ ...base, payFromAccountId: randomUUID() })],
  ])('refuses %s', async (_, change) => {
    await expect(asApp(() => debts().create(alice.userId, change(macbook())))).rejects.toMatchObject({
      code: 'INVALID_DEBT',
    });
  });

  it('refuses a card plan from anything but a live, unconverted card expense of its amount', async () => {
    const a = await kulkas();
    const onBca = await alice.entry('expense', '2026-11-02', 3_000_000n, null);
    const income = await alice.entry('income', '2026-11-02', 3_000_000n, null, { accountId: card });
    const smaller = await alice.entry('expense', '2026-11-02', 2_999_999n, null, { accountId: card });
    for (const source of [onBca, income, smaller, randomUUID()]) {
      await expect(asApp(() => debts().create(alice.userId, cardPlan(source)))).rejects.toMatchObject({
        code: 'INVALID_DEBT',
      });
    }
    await asApp(() => debts().create(alice.userId, cardPlan(a)));
    await expect(asApp(() => debts().create(alice.userId, cardPlan(a)))).rejects.toMatchObject({
      code: 'INVALID_DEBT',
    });
    await expect(
      asApp(() => debts().create(alice.userId, macbook({ categoryId: alice.category('system:salary') }))),
    ).rejects.toMatchObject({ code: 'CATEGORY_KIND_MISMATCH' });
  });
});

describe('non-card installments (FR-U5, FR-U6)', () => {
  it('lists the KPIs, materializes the installments, and pays one with an expense', async () => {
    const debt = await asApp(() => debts().create(alice.userId, macbook()));
    expect(debt).toMatchObject({ name: 'MacBook Air M4', provider: 'Kredivo', remainingPrincipalMinor: 18_999_000n });
    // 25 Nov, 25 Des, 25 Jan are within 90 days of 10 Nov; H-1 09.00 WIB reminders.
    expect(
      await test.query(
        `SELECT due_date::text AS due, expected_minor::text AS expected, remind_at FROM scheduled_occurrences
         WHERE source_type = 'installment' ORDER BY due_date`,
      ),
    ).toEqual([
      { due: '2026-11-25', expected: '1583250', remind_at: new Date('2026-11-24T02:00:00Z') },
      { due: '2026-12-25', expected: '1583250', remind_at: new Date('2026-12-24T02:00:00Z') },
      { due: '2027-01-25', expected: '1583250', remind_at: new Date('2027-01-24T02:00:00Z') },
    ]);
    const list = await asApp(() => debts().list(alice.userId));
    expect(list).toMatchObject({
      today: '2026-11-10',
      remainingMinor: 18_999_000n,
      dueThisMonthMinor: 1_583_250n,
      nextDue: { debtId: debt.id, dueDate: '2026-11-25', totalMinor: 1_583_250n },
    });
    expect((await asApp(() => debts().list(alice.userId, { status: 'all' }))).debts).toHaveLength(1);
    expect((await asApp(() => debts().list(alice.userId, { status: 'paid_off' }))).debts).toEqual([]);

    const first = debt.installments[0]?.id as string;
    const clientId = randomUUID();
    const { transactionId } = await asApp(() =>
      debts().payInstallment(alice.userId, first, { clientId, occurredAt: at('2026-11-10') }),
    );
    const detail = await asApp(() =>
      createTransactions(test.db, { getDek: fixtureGetDek, now: () => NOW }).get(alice.userId, transactionId),
    );
    expect(detail).toMatchObject({
      type: 'expense',
      description: 'Cicilan MacBook Air M4 (1/12)',
      merchant: 'Kredivo',
      categoryId: alice.category('system:shopping'),
    });
    expect(
      await test.query(
        `SELECT status FROM scheduled_occurrences WHERE due_date = '2026-11-25' AND source_type = 'installment'`,
      ),
    ).toEqual([{ status: 'confirmed' }]);
    // A replay returns the same payment; another one is refused.
    expect(
      await asApp(() => debts().payInstallment(alice.userId, first, { clientId, occurredAt: at('2026-11-10') })),
    ).toEqual({
      transactionId,
    });
    await expect(
      asApp(() =>
        debts().payInstallment(alice.userId, first, { clientId: randomUUID(), occurredAt: at('2026-11-10') }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DEBT' });
    const after = await asApp(() => debts().get(alice.userId, debt.id));
    expect(after.installments[0]).toMatchObject({ status: 'paid', paidAt: NOW, transactionId });
    expect(after.remainingPrincipalMinor).toBe(17_415_750n);
    expect(await asApp(() => debts().list(alice.userId))).toMatchObject({
      dueThisMonthMinor: 0n,
      nextDue: { dueDate: '2026-12-25' },
    });
    // The calendar (FR-C2, FR-U6): every row in range, paid or not, with its occurrence while materialized.
    const calendar = await asApp(() =>
      createSchedules(test.db, { now: () => NOW }).listScheduled(alice.userId, {
        from: d('2026-11-01'),
        to: d('2027-05-31'),
      }),
    );
    expect(
      calendar.map((item) => [item.sourceType, item.dueDate, item.status, item.occurrenceId === null, item.name]),
    ).toEqual([
      ['installment', '2026-11-25', 'confirmed', false, 'MacBook Air M4'],
      ['installment', '2026-12-25', 'scheduled', false, 'MacBook Air M4'],
      ['installment', '2027-01-25', 'scheduled', false, 'MacBook Air M4'],
      ['installment', '2027-02-25', 'scheduled', true, 'MacBook Air M4'],
      ['installment', '2027-03-25', 'scheduled', true, 'MacBook Air M4'],
      ['installment', '2027-04-25', 'scheduled', true, 'MacBook Air M4'],
      ['installment', '2027-05-25', 'scheduled', true, 'MacBook Air M4'],
    ]);
    expect(calendar[0]).toMatchObject({
      expectedMinor: 1_583_250n,
      accountId: alice.bca,
      direction: 'out',
      transactionId,
    });
    // Its payment is managed by the debt.
    await expect(
      asApp(() =>
        createTransactions(test.db, { getDek: fixtureGetDek, now: () => NOW }).remove(alice.userId, [transactionId]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
  });

  it('becomes paid off with its last installment, from another account and amount if asked', async () => {
    const debt = await asApp(() =>
      debts().create(
        alice.userId,
        macbook({ tenorMonths: 2, principalMinor: 2_000_000n, categoryId: null, provider: null }),
      ),
    );
    for (const installment of debt.installments) {
      await asApp(() =>
        debts().payInstallment(alice.userId, installment.id, {
          clientId: randomUUID(),
          occurredAt: at('2026-11-10'),
          accountId: alice.jago,
          amountMinor: 1_000_500n,
        }),
      );
    }
    const done = await asApp(() => debts().get(alice.userId, debt.id));
    expect(done).toMatchObject({ status: 'paid_off', paidOffAt: NOW, remainingPrincipalMinor: 0n });
    expect(
      await test.query(
        `SELECT sum(-p.amount_minor)::text AS paid FROM postings p JOIN accounts a ON a.id = p.account_id WHERE a.display_name = 'Jago'`,
      ),
    ).toEqual([{ paid: '2001000' }]);
    expect((await asApp(() => debts().list(alice.userId))).nextDue).toBeNull();
  });

  it('refuses paying a card installment or a missing row', async () => {
    const source = await kulkas();
    const plan = await asApp(() => debts().create(alice.userId, cardPlan(source)));
    await expect(
      asApp(() =>
        debts().payInstallment(alice.userId, plan.installments[0]?.id as string, {
          clientId: randomUUID(),
          occurredAt: at('2026-11-10'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DEBT' });
    await expect(
      asApp(() => debts().payInstallment(alice.userId, randomUUID(), { clientId: randomUUID(), occurredAt: NOW })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('goes through the Review queue on its due date (D14) and the confirmation pays the row', async () => {
    const debt = await asApp(() => debts().create(alice.userId, macbook()));
    const jobs = createOccurrenceJobs(test.db, { getDek: fixtureGetDek });
    const dueDay = new Date('2026-11-25T00:05:00+07:00');
    await test.as('wf_worker', () => jobs.advance(alice.userId, dueDay));
    const review = createReview(test.db, { getDek: fixtureGetDek, now: () => dueDay });
    const { items } = await asApp(() => review.list(alice.userId));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      reason: 'due_occurrence',
      label: 'Kredivo',
      payload: {
        kind: 'transaction',
        draft: {
          type: 'expense',
          accountId: alice.bca,
          amountMinor: 1_583_250n,
          description: 'Cicilan MacBook Air M4 (1/12)',
          source: 'recurring',
        },
      },
    });
    const { transactionId } = await asApp(() => review.confirm(alice.userId, items[0]?.id as string));
    const after = await asApp(() => debts().get(alice.userId, debt.id));
    expect(after.installments[0]).toMatchObject({ status: 'paid', transactionId });
    expect(after.installments[1]?.status).toBe('scheduled');
  });

  it('reminds of installments and card payment dates by name (FR-R7 H-3)', async () => {
    await asApp(() => debts().create(alice.userId, macbook()));
    const noDue = await creditCard(alice.userId, { dueDay: null });
    await test.as('wf_worker', () =>
      withUser(test.db, alice.userId, (tx) => materializeIn(tx, alice.userId, { now: NOW })),
    );
    expect(
      await test.query(
        `SELECT due_date::text AS due, expected_minor::text AS expected, remind_at FROM scheduled_occurrences
         WHERE source_type = 'cc_statement' ORDER BY due_date`,
      ),
    ).toEqual([
      { due: '2026-12-05', expected: '0', remind_at: new Date('2026-12-02T02:00:00Z') },
      { due: '2027-01-05', expected: '0', remind_at: new Date('2027-01-02T02:00:00Z') },
      { due: '2027-02-05', expected: '0', remind_at: new Date('2027-02-02T02:00:00Z') },
    ]);
    expect(
      await test.query('SELECT count(*)::int AS n FROM scheduled_occurrences WHERE source_id = $1', [noDue]),
    ).toEqual([{ n: 0 }]);
    // One card on its own: everything is there already.
    expect(
      await test.as('wf_worker', () =>
        withUser(test.db, alice.userId, (tx) =>
          materializeIn(tx, alice.userId, { now: NOW, source: { type: 'cc_statement', id: card } }),
        ),
      ),
    ).toEqual({ created: 0 });
    const jobs = createOccurrenceJobs(test.db, { getDek: fixtureGetDek });
    const [installment] = await test.query<{ id: string }>(
      `SELECT id FROM scheduled_occurrences WHERE source_type = 'installment' ORDER BY due_date LIMIT 1`,
    );
    const [statement] = await test.query<{ id: string }>(
      `SELECT id FROM scheduled_occurrences WHERE source_type = 'cc_statement' ORDER BY due_date LIMIT 1`,
    );
    await test.as('wf_worker', () =>
      jobs.remind(alice.userId, installment?.id as string, new Date('2026-11-24T02:00:00Z')),
    );
    await test.as('wf_worker', () =>
      jobs.remind(alice.userId, statement?.id as string, new Date('2026-12-02T02:00:00Z')),
    );
    expect(
      await test.query(
        `SELECT type, params->>'name' AS name, params->>'account' AS account, action FROM notifications ORDER BY created_at`,
      ),
    ).toEqual([
      { type: 'bill_reminder', name: 'MacBook Air M4', account: 'BCA', action: { href: '/debts' } },
      { type: 'bill_reminder', name: 'BCA Visa', account: 'BCA Visa', action: { href: '/debts' } },
    ]);
  });
});

describe('debts: update, remove, isolation', () => {
  it('updates names, provider, category, and payment account; refuses those a card plan has not', async () => {
    const debt = await asApp(() => debts().create(alice.userId, macbook()));
    const updated = await asApp(() =>
      debts().update(alice.userId, debt.id, {
        name: 'MacBook',
        provider: '',
        categoryId: null,
        payFromAccountId: alice.jago,
      }),
    );
    expect(updated).toMatchObject({ name: 'MacBook', provider: null, categoryId: null, payFromAccountId: alice.jago });
    const recategorized = await asApp(() =>
      debts().update(alice.userId, debt.id, { categoryId: alice.category('system:bills') }),
    );
    expect(recategorized.categoryId).toBe(alice.category('system:bills'));
    expect(await asApp(() => debts().update(alice.userId, debt.id, {}))).toMatchObject({ name: 'MacBook' });
    await expect(asApp(() => debts().update(alice.userId, debt.id, { payFromAccountId: card }))).resolves.toMatchObject(
      { payFromAccountId: card },
    );
    const source = await kulkas();
    const plan = await asApp(() => debts().create(alice.userId, cardPlan(source)));
    for (const patch of [{ payFromAccountId: alice.bca }, { categoryId: alice.category('system:bills') }]) {
      await expect(asApp(() => debts().update(alice.userId, plan.id, patch))).rejects.toMatchObject({
        code: 'INVALID_DEBT',
      });
    }
    expect(
      await asApp(() => debts().update(alice.userId, plan.id, { categoryId: null, name: 'Kulkas' })),
    ).toMatchObject({
      name: 'Kulkas',
    });
    await expect(asApp(() => debts().update(alice.userId, randomUUID(), {}))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('removes a debt with its schedule and open occurrences; paid expenses stay', async () => {
    const debt = await asApp(() => debts().create(alice.userId, macbook()));
    const { transactionId } = await asApp(() =>
      debts().payInstallment(alice.userId, debt.installments[0]?.id as string, {
        clientId: randomUUID(),
        occurredAt: at('2026-11-10'),
      }),
    );
    await asApp(() => debts().remove(alice.userId, debt.id));
    expect(await test.query('SELECT count(*)::int AS n FROM debt_installments')).toEqual([{ n: 0 }]);
    expect(await test.query(`SELECT status FROM scheduled_occurrences WHERE source_type = 'installment'`)).toEqual([
      { status: 'confirmed' },
    ]);
    expect(await test.query('SELECT id FROM transactions WHERE id = $1', [transactionId])).toEqual([
      { id: transactionId },
    ]);
    await expect(asApp(() => debts().remove(alice.userId, debt.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps every user to their own debts', async () => {
    const debt = await asApp(() => debts().create(alice.userId, macbook()));
    const bob = await insertUser(test, 'bob@example.test');
    await expect(asApp(() => debts().get(bob, debt.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await asApp(() => debts().list(bob))).toMatchObject({ debts: [], remainingMinor: 0n, nextDue: null });
    expect(await asApp(() => createDebts(test.db).cards(bob))).toEqual([]);
    // An installment occurrence whose row is gone has no proposal.
    await test.query(
      `INSERT INTO scheduled_occurrences (user_id, source_type, source_id, due_date, expected_minor, currency)
       VALUES ($1, 'installment', $2, '2026-11-26', 1, 'IDR')`,
      [alice.userId, debt.id],
    );
    const [orphan] = await test.query<{ id: string }>(
      `SELECT id FROM scheduled_occurrences WHERE due_date = '2026-11-26'`,
    );
    await expect(
      test.as('wf_worker', () =>
        withUser(test.db, alice.userId, (tx) => occurrenceReviewItemIn(tx, alice.userId, orphan?.id as string)),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
