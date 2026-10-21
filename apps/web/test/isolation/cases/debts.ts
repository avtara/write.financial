// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/debts.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`. A and B each get a credit card (statement on the 28th, so an expense
 * made today is in the current cycle) with an expense split into installments; B's calls aimed at A's card,
 * transaction, or account are refused and leave A's debts, allocations, and preferences unchanged.
 */
import { randomUUID } from 'node:crypto';
import type { DebtView } from '@wf/db/debts';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { CardPaymentContext, DebtsOverview } from '../../../src/server/fn/debts.ts';
import {
  aAccountId,
  aId,
  as,
  bAccountId,
  bId,
  type Case,
  idsOf,
  type LocalDate,
  type Name,
  NOT_FOUND,
  ok,
  services,
  SOME_ID,
  superuser,
  UNAUTHENTICATED,
} from '../harness.ts';

const CARD_A = 'Kartu Rahasia A';
const CARD_B = 'Kartu B';
const INVALID_DEBT = { ok: false, code: 'INVALID_DEBT' };

/** The user's credit card `name`, created on first use. */
async function cardOf(userId: string, name: string): Promise<string> {
  const [existing] = await idsOf('accounts', userId, `display_name = '${name}'`);
  if (existing !== undefined) return existing;
  const card = await services.accounts.create(userId, {
    type: 'credit_card',
    providerName: 'BCA',
    displayName: name,
    currency: 'IDR',
    openingBalanceMinor: 0n,
    openingDate: '2026-10-01' as LocalDate,
    color: 'blue',
    includeInAvailable: false,
    ccLimitMinor: 15_000_000n,
    ccStatementDay: 28,
    ccDueDay: 10,
  });
  return card.id;
}

/** A card expense made now, as the Record sheet submits it. */
const cardExpense = (accountId: string) => ({
  type: 'expense',
  clientId: randomUUID(),
  occurredAt: new Date(),
  accountId,
  amountMinor: 3_000_000n,
  categoryId: null,
  description: 'Kulkas',
});
const split = (accountId: string) => ({
  transaction: cardExpense(accountId),
  tenor: 3,
  monthlyRateBps: 0,
  adminFeeMinor: 0n,
});
const payment = (fromAccountId: string, toAccountId: string) => ({
  transaction: {
    type: 'transfer',
    clientId: randomUUID(),
    occurredAt: new Date(),
    fromAccountId,
    toAccountId,
    sentMinor: 100_000n,
    receivedMinor: 100_000n,
  },
  priority: ['installments', 'spending'],
  mode: 'reduce_amount',
});
const debtInput = (payFromAccountId: string) => ({
  kind: 'paylater',
  name: 'Paylater',
  principalMinor: 1_200_000n,
  tenorMonths: 3,
  monthlyRateBps: 0,
  adminFeeMinor: 0n,
  firstDueDate: '2027-01-25',
  payFromAccountId,
});

/** A's card with one installment plan (made once). */
async function aCard(): Promise<string> {
  const card = await cardOf(aId, CARD_A);
  if ((await idsOf('debts', aId)).length === 0) {
    expect(await as('A', 'recordCardInstallment', split(card))).toMatchObject({ ok: true });
  }
  return card;
}

/** A's debts, schedules, card allocations, and preferences as stored. */
const aDebtRows = async () => ({
  debts: await superuser`SELECT * FROM debts WHERE user_id = ${aId} ORDER BY id`,
  installments: await superuser`SELECT * FROM debt_installments WHERE user_id = ${aId} ORDER BY id`,
  allocations: await superuser`SELECT * FROM card_payment_allocations WHERE user_id = ${aId} ORDER BY id`,
  preferences: await superuser`SELECT * FROM user_preferences WHERE user_id = ${aId}`,
});

export const cases = {
  getDebtsOverview: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await aCard();
      const cardB = await cardOf(bId, CARD_B);
      const ofB = await as<Result<DebtsOverview>>('B', 'getDebtsOverview', undefined);
      expect(ofB.ok && ofB.value.cards.map((card) => card.accountId)).toEqual([cardB]);
      expect(ofB.ok && ofB.value.debts.map((debt) => debt.id)).toEqual(await idsOf('debts', bId, `status = 'active'`));
      const ofA = await as<Result<DebtsOverview>>('A', 'getDebtsOverview', undefined);
      expect(ofA.ok && ofA.value.cards.map((card) => card.name)).toEqual([CARD_A]);
      expect(ofA.ok && ofA.value.debts).toHaveLength(1);
    },
  },
  getCardPaymentContext: {
    input: () => ({ accountId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as('B', 'getCardPaymentContext', { accountId: await aCard() })).toEqual(NOT_FOUND);
      const cardB = await cardOf(bId, CARD_B);
      expect(await as<Result<CardPaymentContext>>('B', 'getCardPaymentContext', { accountId: cardB })).toMatchObject(
        ok({ card: { accountId: cardB, name: CARD_B } }),
      );
    },
  },
  createDebt: {
    input: () => debtInput(SOME_ID),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await aCard();
      const a = await aDebtRows();
      expect(await as('B', 'createDebt', debtInput(aAccountId))).toEqual(NOT_FOUND);
      const created = await as<Result<DebtView>>('B', 'createDebt', debtInput(bAccountId));
      expect(created).toMatchObject(ok({ name: 'Paylater', payFromAccountId: bAccountId }));
      expect(await idsOf('debts', bId)).toContain(created.ok && created.value.id);
      expect(await aDebtRows()).toEqual(a);
    },
  },
  convertCardTransaction: {
    input: () => ({ transactionId: SOME_ID, tenor: 3, monthlyRateBps: 0, adminFeeMinor: 0n }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const card = await aCard();
      const a = await aDebtRows();
      const aExpense = await as<Result<{ id: string }>>('A', 'recordTransaction', cardExpense(card));
      const terms = { tenor: 3, monthlyRateBps: 0, adminFeeMinor: 0n };
      expect(
        await as('B', 'convertCardTransaction', { transactionId: aExpense.ok && aExpense.value.id, ...terms }),
      ).toEqual(NOT_FOUND);
      const bExpense = await as<Result<{ id: string }>>(
        'B',
        'recordTransaction',
        cardExpense(await cardOf(bId, CARD_B)),
      );
      expect(
        await as('B', 'convertCardTransaction', { transactionId: bExpense.ok && bExpense.value.id, ...terms }),
      ).toMatchObject(ok({ sourceTransactionId: bExpense.ok && bExpense.value.id }));
      expect(await aDebtRows()).toEqual(a);
    },
  },
  recordCardInstallment: {
    input: () => split(SOME_ID),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const card = await aCard();
      const a = await aDebtRows();
      expect(await as('B', 'recordCardInstallment', split(card))).toEqual(INVALID_DEBT);
      expect(await as('B', 'recordCardInstallment', split(await cardOf(bId, CARD_B)))).toMatchObject(
        ok({ debt: { name: 'Kulkas' } }),
      );
      expect(await aDebtRows()).toEqual(a);
    },
  },
  recordCardPayment: {
    input: () => payment(SOME_ID, SOME_ID),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const card = await aCard();
      const a = await aDebtRows();
      expect(await as('B', 'recordCardPayment', payment(bAccountId, card))).toEqual(INVALID_DEBT);
      const cardB = await cardOf(bId, CARD_B);
      if ((await idsOf('debts', bId, `card_account_id = '${cardB}'`)).length === 0) {
        expect(await as('B', 'recordCardInstallment', split(cardB))).toMatchObject({ ok: true });
      }
      expect(await as('B', 'recordCardPayment', payment(bAccountId, cardB))).toMatchObject(
        ok({ debts: [{ cardAccountId: cardB, paidEarlyMinor: 100_000n }] }),
      );
      expect(await aDebtRows()).toEqual(a);
    },
  },
  setCardPaymentPriority: {
    input: () => ({ priority: ['spending', 'installments'] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aDebtRows();
      expect(await as('B', 'setCardPaymentPriority', input)).toEqual(ok(['spending', 'installments']));
      expect(await aDebtRows()).toEqual(a);
    },
  },
} satisfies Partial<Record<Name, Case>>;
