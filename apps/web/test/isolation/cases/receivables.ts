// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/receivables.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`. A lends to "Teman Rahasia A"; B's calls aimed at A's receivable or
 * account are refused and leave A's receivables, payments, and transactions unchanged, and B never sees A's people.
 */
import { randomUUID } from 'node:crypto';
import type { ReceivableView } from '@wf/db/receivables';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { SplitBillContext } from '../../../src/server/fn/receivables.ts';
import {
  aAccountId,
  aId,
  as,
  bAccountId,
  bId,
  type Case,
  idsOf,
  type Name,
  NOT_FOUND,
  ok,
  SOME_ID,
  superuser,
  UNAUTHENTICATED,
} from '../harness.ts';

const PERSON_A = 'Teman Rahasia A';
const PERSON_B = 'Teman B';

/** A loan made now, as the "Catat piutang" dialog submits it. */
const loan = (fromAccountId: string, counterparty = PERSON_B) => ({
  clientId: randomUUID(),
  counterparty,
  amountMinor: 100_000n,
  fromAccountId,
  lentAt: new Date(),
  dueDate: null,
  remind: false,
});
const payment = (id: string, accountId: string) => ({
  id,
  clientId: randomUUID(),
  amountMinor: 10_000n,
  accountId,
  receivedAt: new Date(),
});
const splitBill = (accountId: string) => ({
  transaction: {
    type: 'expense',
    clientId: randomUUID(),
    occurredAt: new Date(),
    accountId,
    amountMinor: 50_000n,
    categoryId: null,
    description: 'Makan bareng',
  },
  shares: [{ clientId: randomUUID(), counterparty: PERSON_B, amountMinor: 50_000n, dueDate: null, remind: false }],
});

/** A's receivable (made once). */
async function aReceivable(): Promise<string> {
  const [existing] = await idsOf('receivables', aId);
  if (existing !== undefined) return existing;
  const made = await as<Result<ReceivableView>>('A', 'recordReceivable', loan(aAccountId, PERSON_A));
  expect(made).toMatchObject(ok({ counterparty: PERSON_A }));
  return made.ok ? made.value.id : '';
}

/** B's receivable (a new one each time, so payments always fit). */
async function bReceivable(): Promise<string> {
  const made = await as<Result<ReceivableView>>('B', 'recordReceivable', loan(bAccountId));
  return made.ok ? made.value.id : '';
}

/** A's receivables, payments, and transactions as stored. */
const aRows = async () => ({
  receivables: await superuser`SELECT * FROM receivables WHERE user_id = ${aId} ORDER BY id`,
  payments: await superuser`SELECT * FROM receivable_payments WHERE user_id = ${aId} ORDER BY id`,
  transactions: await superuser`SELECT id, deleted_at FROM transactions WHERE user_id = ${aId} ORDER BY id`,
});

export const cases = {
  getSplitBillContext: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await aReceivable();
      await bReceivable();
      const ofB = await as<Result<SplitBillContext>>('B', 'getSplitBillContext', undefined);
      expect(ofB.ok && ofB.value.people).toEqual([PERSON_B]);
      const ofA = await as<Result<SplitBillContext>>('A', 'getSplitBillContext', undefined);
      expect(ofA.ok && ofA.value.people).toEqual([PERSON_A]);
    },
  },
  recordReceivable: {
    input: () => loan(SOME_ID),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await aReceivable();
      const a = await aRows();
      expect(await as('B', 'recordReceivable', loan(aAccountId))).toEqual(NOT_FOUND);
      const made = await as<Result<ReceivableView>>('B', 'recordReceivable', loan(bAccountId));
      expect(made).toMatchObject(ok({ counterparty: PERSON_B, fromAccountId: bAccountId }));
      expect(await idsOf('receivables', bId)).toContain(made.ok && made.value.id);
      expect(await aRows()).toEqual(a);
    },
  },
  receiveReceivablePayment: {
    input: () => payment(SOME_ID, SOME_ID),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofA = await aReceivable();
      const a = await aRows();
      expect(await as('B', 'receiveReceivablePayment', payment(ofA, bAccountId))).toEqual(NOT_FOUND);
      const ofB = await bReceivable();
      expect(await as('B', 'receiveReceivablePayment', payment(ofB, aAccountId))).toEqual(NOT_FOUND);
      expect(await as('B', 'receiveReceivablePayment', payment(ofB, bAccountId))).toMatchObject(
        ok({ id: ofB, status: 'partial', paidMinor: 10_000n }),
      );
      expect(await aRows()).toEqual(a);
    },
  },
  writeOffReceivable: {
    input: () => ({ id: SOME_ID, clientId: randomUUID(), occurredAt: new Date() }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofA = await aReceivable();
      const a = await aRows();
      const writeOff = (id: string) => ({ id, clientId: randomUUID(), occurredAt: new Date() });
      expect(await as('B', 'writeOffReceivable', writeOff(ofA))).toEqual(NOT_FOUND);
      const ofB = await bReceivable();
      expect(await as('B', 'writeOffReceivable', writeOff(ofB))).toMatchObject(ok({ id: ofB, status: 'written_off' }));
      expect(await aRows()).toEqual(a);
    },
  },
  recordSplitBill: {
    input: () => splitBill(SOME_ID),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await aReceivable();
      const a = await aRows();
      expect(await as('B', 'recordSplitBill', splitBill(aAccountId))).toEqual(NOT_FOUND);
      expect(await as('B', 'recordSplitBill', splitBill(bAccountId))).toMatchObject(
        ok({ receivables: [{ counterparty: PERSON_B, fromAccountId: bAccountId, source: 'split_bill' }] }),
      );
      expect(await aRows()).toEqual(a);
    },
  },
} satisfies Partial<Record<Name, Case>>;
