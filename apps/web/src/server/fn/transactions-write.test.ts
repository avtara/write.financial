// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import {
  listDrafts,
  listTransactionDays,
  recordTransaction,
  removeDraft,
  removeTransactions,
  restoreTransactions,
  saveDraft,
} from './transactions-write.ts';

const fake = vi.hoisted(() => {
  const ledgerError = (code: string) => Object.assign(new Error(code), { code });
  return {
    ledgerError,
    transactions: {
      create: vi.fn(() => Promise.resolve({ id: 'tx', created: true, fxDifference: null })),
      remove: vi.fn((_userId: string, ids: readonly string[]) => Promise.resolve({ deleted: [...ids] })),
      restore: vi.fn((_userId: string, ids: readonly string[]) => Promise.resolve({ restored: [...ids] })),
    },
    transactionQuery: {
      groupByDay: vi.fn(() =>
        Promise.resolve([
          { date: '2026-10-15', inMinor: 0n, outMinor: 5000n, count: 2 },
          { date: '2026-10-14', inMinor: 0n, outMinor: 0n, count: 0 },
          { date: '2026-10-02', inMinor: 100n, outMinor: 0n, count: 1 },
        ]),
      ),
    },
    drafts: {
      list: vi.fn(() => Promise.resolve([])),
      save: vi.fn(() => Promise.resolve({ id: 'draft' })),
      remove: vi.fn(() => Promise.resolve()),
    },
  };
});

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      transactions: fake.transactions,
      transactionQuery: fake.transactionQuery,
      drafts: fake.drafts,
      now: () => new Date('2026-10-18T09:00:00Z'),
    }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());
const signedOut = () => requestContext(null);

const ID = '0192a6c4-0000-7000-8000-000000000001';
const OTHER_ID = '0192a6c4-0000-7000-8000-000000000002';
const AT = new Date('2026-10-15T05:00:00Z');

const expense = {
  type: 'expense',
  clientId: ID,
  occurredAt: AT,
  accountId: OTHER_ID,
  amountMinor: 25_000n,
  categoryId: null,
} as const;
const transfer = {
  type: 'transfer',
  clientId: ID,
  occurredAt: AT,
  fromAccountId: ID,
  toAccountId: OTHER_ID,
  sentMinor: 3_000_000n,
  receivedMinor: 18_210n,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordTransaction', () => {
  it('records for the session user and drops undefined optional keys', async () => {
    expect(
      await call(recordTransaction, {
        context: signedIn(),
        data: { ...expense, description: undefined, note: 'Makan siang', tags: ['makan'], source: undefined },
      }),
    ).toEqual({ ok: true, value: { id: 'tx', created: true, fxDifference: null } });
    const [[userId, draft]] = fake.transactions.create.mock.calls as unknown as [[string, object]];
    expect(userId).toBe(USER_ID);
    expect(draft).toStrictEqual({ ...expense, note: 'Makan siang', tags: ['makan'] });
    expect(Object.keys(draft)).not.toContain('description');
    expect(Object.keys(draft)).not.toContain('source');
  });

  it('records a transfer with a manual rate and a fee', async () => {
    const data = {
      ...transfer,
      manualRate: { base: 'USD', quote: 'IDR', rate: '16474.46' },
      fee: { minor: 6500n, categoryId: ID },
      description: null,
    };
    await call(recordTransaction, { context: signedIn(), data });
    expect(fake.transactions.create).toHaveBeenCalledWith(USER_ID, data);
  });

  it('turns ledger errors into expected results', async () => {
    fake.transactions.create.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(recordTransaction, { context: signedIn(), data: expense })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('validates the input', () => {
    const validator = validatorOf(recordTransaction);
    const valid = (input: unknown) => validator.safeParse(input).success;
    expect(valid(expense)).toBe(true);
    expect(valid({ ...expense, type: 'income', categoryId: ID, source: 'quick', merchant: 'Warung' })).toBe(true);
    expect(valid(transfer)).toBe(true);
    expect(valid({ ...transfer, manualRate: null, fee: null, tags: ['a', 'b', 'c', 'd', 'e'] })).toBe(true);

    expect(valid({ ...expense, accountId: 'not-a-uuid' })).toBe(false);
    expect(valid({ ...expense, clientId: 'x' })).toBe(false);
    expect(valid({ ...expense, amountMinor: 0n })).toBe(false);
    expect(valid({ ...expense, amountMinor: 1000 })).toBe(false);
    expect(valid({ ...expense, occurredAt: '2026-10-15' })).toBe(false);
    expect(valid({ ...expense, tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(false);
    expect(valid({ ...expense, tags: [''] })).toBe(false);
    expect(valid({ ...expense, tags: ['x'.repeat(65)] })).toBe(false);
    expect(valid({ ...expense, description: 'x'.repeat(201) })).toBe(false);
    expect(valid({ ...expense, note: 'x'.repeat(2001) })).toBe(false);
    expect(valid({ ...expense, source: 'import' })).toBe(false);
    expect(valid({ ...expense, type: 'adjustment' })).toBe(false);
    expect(valid({ ...transfer, receivedMinor: undefined })).toBe(false);
    expect(valid({ ...transfer, sentMinor: -1n })).toBe(false);
    expect(valid({ ...transfer, manualRate: { base: 'USD', quote: 'IDR', rate: '16,474' } })).toBe(false);
    expect(valid({ ...transfer, manualRate: { base: 'USD', quote: 'IDR', rate: '1.123456789' } })).toBe(false);
    expect(valid({ ...transfer, manualRate: { base: 'usd', quote: 'IDR', rate: '16474' } })).toBe(false);
    expect(valid({ ...transfer, fee: { minor: 0n, categoryId: ID } })).toBe(false);
  });
});

describe('removeTransactions and restoreTransactions', () => {
  it('delete and restore the session user’s transactions', async () => {
    expect(await call(removeTransactions, { context: signedIn(), data: { ids: [ID] } })).toEqual({
      ok: true,
      value: { deleted: [ID] },
    });
    expect(fake.transactions.remove).toHaveBeenCalledWith(USER_ID, [ID]);
    expect(await call(restoreTransactions, { context: signedIn(), data: { ids: [ID, OTHER_ID] } })).toEqual({
      ok: true,
      value: { restored: [ID, OTHER_ID] },
    });
    expect(fake.transactions.restore).toHaveBeenCalledWith(USER_ID, [ID, OTHER_ID]);
  });

  it('validates the ids', () => {
    for (const fn of [removeTransactions, restoreTransactions]) {
      const validator = validatorOf(fn);
      expect(validator.safeParse({ ids: [ID] }).success).toBe(true);
      expect(validator.safeParse({ ids: [] }).success).toBe(false);
      expect(validator.safeParse({ ids: ['x'] }).success).toBe(false);
      expect(validator.safeParse({ ids: Array.from({ length: 201 }, () => ID) }).success).toBe(false);
    }
  });
});

describe('drafts', () => {
  it('lists, saves, and removes the session user’s drafts', async () => {
    expect(await call(listDrafts, { context: signedIn(), data: { kind: 'transaction' } })).toEqual({
      ok: true,
      value: [],
    });
    expect(fake.drafts.list).toHaveBeenCalledWith(USER_ID, 'transaction');

    const payload = { description: 'Kopi', amount: '25000' };
    expect(await call(saveDraft, { context: signedIn(), data: { kind: 'transaction', payload } })).toEqual({
      ok: true,
      value: { id: 'draft' },
    });
    expect(fake.drafts.save).toHaveBeenLastCalledWith(USER_ID, { kind: 'transaction', payload });
    const [[, saved]] = fake.drafts.save.mock.calls as unknown as [[string, object]];
    expect(Object.keys(saved)).not.toContain('id');
    await call(saveDraft, { context: signedIn(), data: { id: ID, kind: 'transaction', payload } });
    expect(fake.drafts.save).toHaveBeenLastCalledWith(USER_ID, { id: ID, kind: 'transaction', payload });

    expect(await call(removeDraft, { context: signedIn(), data: { id: ID } })).toEqual({ ok: true, value: null });
    expect(fake.drafts.remove).toHaveBeenCalledWith(USER_ID, ID);
  });

  it('answers NOT_FOUND for drafts of others', async () => {
    fake.drafts.save.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    fake.drafts.remove.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    const notFound = { ok: false, code: 'NOT_FOUND' };
    expect(await call(saveDraft, { context: signedIn(), data: { id: ID, kind: 'transaction', payload: {} } })).toEqual(
      notFound,
    );
    expect(await call(removeDraft, { context: signedIn(), data: { id: ID } })).toEqual(notFound);
  });

  it('validates kinds, ids, and payloads', () => {
    expect(validatorOf(listDrafts).safeParse({ kind: 'transaction' }).success).toBe(true);
    expect(validatorOf(listDrafts).safeParse({ kind: 'goal' }).success).toBe(false);
    const save = validatorOf(saveDraft);
    expect(save.safeParse({ kind: 'transaction', payload: { a: [1, { b: null }], c: true } }).success).toBe(true);
    expect(save.safeParse({ kind: 'transfer', payload: {} }).success).toBe(false);
    expect(save.safeParse({ id: 'x', kind: 'transaction', payload: {} }).success).toBe(false);
    expect(save.safeParse({ kind: 'transaction', payload: [] }).success).toBe(false);
    expect(save.safeParse({ kind: 'transaction', payload: { at: new Date() } }).success).toBe(false);
    // `{"text":"…"}` is 11 characters plus the text: 16 384 in all is the largest draft.
    expect(save.safeParse({ kind: 'transaction', payload: { text: 'x'.repeat(16_373) } }).success).toBe(true);
    expect(save.safeParse({ kind: 'transaction', payload: { text: 'x'.repeat(16_374) } }).success).toBe(false);
    expect(validatorOf(removeDraft).safeParse({ id: 'x' }).success).toBe(false);
  });
});

describe('listTransactionDays', () => {
  it('answers the days with transactions, ascending', async () => {
    expect(
      await call(listTransactionDays, { context: signedIn(), data: { from: '2026-10-01', to: '2026-10-31' } }),
    ).toEqual({ ok: true, value: ['2026-10-02', '2026-10-15'] });
    expect(fake.transactionQuery.groupByDay).toHaveBeenCalledWith(USER_ID, { from: '2026-10-01', to: '2026-10-31' });
  });

  it('validates the range', () => {
    const valid = (input: unknown) => validatorOf(listTransactionDays).safeParse(input).success;
    expect(valid({ from: '2026-10-01', to: '2026-10-01' })).toBe(true);
    expect(valid({ from: '2026-09-28', to: '2026-11-08' })).toBe(true);
    expect(valid({ from: '2026-08-01', to: '2026-11-08' })).toBe(true);
    expect(valid({ from: '2026-08-01', to: '2026-11-09' })).toBe(false);
    expect(valid({ from: '2026-10-02', to: '2026-10-01' })).toBe(false);
    expect(valid({ from: '2026-10-1', to: '2026-10-31' })).toBe(false);
    expect(valid({ from: '2026-02-30', to: '2026-03-01' })).toBe(false);
  });
});

describe('signed out', () => {
  it('refuses every function', async () => {
    const unauthenticated = { ok: false, code: 'UNAUTHENTICATED' };
    const cases: [unknown, unknown][] = [
      [recordTransaction, expense],
      [removeTransactions, { ids: [ID] }],
      [restoreTransactions, { ids: [ID] }],
      [listDrafts, { kind: 'transaction' }],
      [saveDraft, { kind: 'transaction', payload: {} }],
      [removeDraft, { id: ID }],
      [listTransactionDays, { from: '2026-10-01', to: '2026-10-31' }],
    ];
    for (const [fn, data] of cases) {
      expect(await call(fn, { context: signedOut(), data })).toEqual(unauthenticated);
    }
    expect(fake.transactions.create).not.toHaveBeenCalled();
    expect(fake.transactions.remove).not.toHaveBeenCalled();
    expect(fake.transactions.restore).not.toHaveBeenCalled();
    expect(fake.drafts.list).not.toHaveBeenCalled();
    expect(fake.drafts.save).not.toHaveBeenCalled();
    expect(fake.drafts.remove).not.toHaveBeenCalled();
    expect(fake.transactionQuery.groupByDay).not.toHaveBeenCalled();
  });
});
