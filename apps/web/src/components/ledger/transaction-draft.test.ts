// SPDX-License-Identifier: AGPL-3.0-only
import type { TransferView } from '@wf/db/transactions';
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS,
  ARCHIVED,
  BCA,
  CARD,
  CATEGORIES,
  GOTRADE,
  JAGO,
  OVO,
  account,
  categoryId,
  userCategory,
} from '../../../test/ledger-fixtures.ts';
import { posting, transactionDetail } from '../../../test/transaction-fixtures.ts';
import {
  activeAccounts,
  balancesAfter,
  datePresets,
  defaultAccountId,
  emptyValues,
  fromDraftPayload,
  fxFigures,
  guessCategory,
  isCrossCurrency,
  isFilled,
  parseRateInput,
  ratePair,
  shortfall,
  toDraftPayload,
  toRecordInput,
  transferAccounts,
  unitValue,
  validate,
  valuesFromDetail,
  wallTime,
  zonedInstant,
  type TransactionFormValues,
} from './transaction-draft.ts';

const TODAY = '2026-10-19' as LocalDate;
const REFERENCE = { base: 'USD', quote: 'IDR', rate: '16350.0275' };

const values = (patch: Partial<TransactionFormValues> = {}): TransactionFormValues => ({
  ...emptyValues({ accountId: BCA.id, date: TODAY, time: '19:30' }),
  ...patch,
});

/** IDR → USD: Rp3.000.000 sent from BCA, US$182,10 received in Gotrade. */
const fxTransfer = (patch: Partial<TransactionFormValues> = {}) =>
  values({
    type: 'transfer',
    amountMinor: 3_000_000n,
    toAccountId: GOTRADE.id,
    receivedMinor: 18_210n,
    ...patch,
  });

const context = { accounts: ACCOUNTS, baseCurrency: 'IDR', locale: 'id' as const, reference: REFERENCE };

describe('accounts', () => {
  it('offers active accounts only', () => {
    expect(activeAccounts(ACCOUNTS)).not.toContain(ARCHIVED);
    expect(activeAccounts(ACCOUNTS)).toHaveLength(5);
  });

  it('defaults to the quick-entry account, else the first active one, else none', () => {
    expect(defaultAccountId(ACCOUNTS)).toBe(BCA.id);
    expect(defaultAccountId([ARCHIVED, OVO, JAGO])).toBe(OVO.id);
    expect(defaultAccountId([ARCHIVED, { ...BCA, status: 'archived' }])).toBeNull();
  });
});

describe('emptyValues / isFilled', () => {
  it('starts as an empty expense unless a type is given', () => {
    expect(values()).toMatchObject({ type: 'expense', amountMinor: null, rateMode: 'reference', tags: [] });
    expect(emptyValues({ type: 'income', accountId: null, date: TODAY, time: '08:00' })).toMatchObject({
      type: 'income',
      accountId: null,
    });
  });

  it('is filled once anything was typed or picked', () => {
    expect(isFilled(values({ description: '  ', note: ' ' }))).toBe(false);
    for (const patch of [
      { amountMinor: 1n },
      { categoryId: 'c' },
      { toAccountId: JAGO.id },
      { feeMinor: 0n },
      { description: 'Kopi' },
      { note: 'x' },
      { tags: ['kantor'] },
    ]) {
      expect(isFilled(values(patch))).toBe(true);
    }
  });
});

describe('transfer accounts', () => {
  it('pairs the two accounts once both are known', () => {
    expect(transferAccounts(values({ toAccountId: JAGO.id }), ACCOUNTS)).toEqual({ from: BCA, to: JAGO });
    expect(transferAccounts(values({ accountId: null, toAccountId: JAGO.id }), ACCOUNTS)).toBeNull();
    expect(transferAccounts(values({ toAccountId: 'missing' }), ACCOUNTS)).toBeNull();
  });

  it('tells a cross-currency transfer', () => {
    expect(isCrossCurrency(fxTransfer(), ACCOUNTS)).toBe(true);
    expect(isCrossCurrency(fxTransfer({ type: 'expense' }), ACCOUNTS)).toBe(false);
    expect(isCrossCurrency(fxTransfer({ toAccountId: JAGO.id }), ACCOUNTS)).toBe(false);
    expect(isCrossCurrency(fxTransfer({ toAccountId: null }), ACCOUNTS)).toBe(false);
  });

  it('orients the rate as one foreign unit in the base currency', () => {
    expect(ratePair('IDR', 'USD', 'IDR')).toEqual({ base: 'USD', quote: 'IDR' });
    expect(ratePair('USD', 'IDR', 'IDR')).toEqual({ base: 'USD', quote: 'IDR' });
    expect(ratePair('USD', 'SGD', 'IDR')).toEqual({ base: 'USD', quote: 'SGD' });
  });
});

describe('parseRateInput', () => {
  it('reads Indonesian and English separators', () => {
    expect(parseRateInput('16.474', 'id')).toBe('16474');
    expect(parseRateInput(' 16.474,5 ', 'id')).toBe('16474.5');
    expect(parseRateInput('16,474.5', 'en')).toBe('16474.5');
    expect(parseRateInput('0,75', 'id')).toBe('0.75');
  });

  it('rejects what is not a rate', () => {
    expect(parseRateInput('', 'id')).toBeNull();
    expect(parseRateInput('abc', 'en')).toBeNull();
    expect(parseRateInput('-5', 'id')).toBeNull();
  });
});

describe('fxFigures', () => {
  it('values the golden IDR → USD transfer at the reference rate', () => {
    const figures = fxFigures(fxTransfer(), context);
    expect(figures).toEqual({
      rate: REFERENCE,
      receivedMinor: 18_210n,
      difference: { expectedReceivedMinor: 18_349n, shortfallReceivedMinor: 139n, differenceBaseMinor: -22_660n },
      effectiveRate: expect.stringMatching(/^16474\.4/) as unknown,
      deviationBps: null,
    });
  });

  it('values it at an exact reference rate', () => {
    const figures = fxFigures(fxTransfer(), { ...context, reference: { ...REFERENCE, rate: '16350' } });
    expect(figures?.difference.differenceBaseMinor).toBe(-22_665n);
  });

  it('expects the converted amount until "Diterima" is typed', () => {
    const figures = fxFigures(fxTransfer({ receivedMinor: null }), context);
    expect(figures?.receivedMinor).toBe(18_349n);
    expect(figures?.difference.differenceBaseMinor).toBe(0n);
  });

  it('uses a manual rate and measures it against the reference', () => {
    const manual = fxTransfer({ rateMode: 'manual', manualRate: '16.474', receivedMinor: null });
    const figures = fxFigures(manual, { ...context, reference: { ...REFERENCE, rate: '16350' } });
    expect(figures?.rate).toEqual({ base: 'USD', quote: 'IDR', rate: '16474' });
    expect(figures?.deviationBps).toBe(76);
    expect(fxFigures(manual, { ...context, reference: null })?.deviationBps).toBeNull();
    expect(fxFigures({ ...manual, manualRate: 'x' }, context)).toBeNull();
  });

  it('values the destination in the base currency when neither side is in it', () => {
    const sgd = account({ id: 'acc-sgd', displayName: 'DBS', currency: 'SGD' });
    const figures = fxFigures(
      values({
        type: 'transfer',
        accountId: GOTRADE.id,
        toAccountId: sgd.id,
        amountMinor: 10_000n,
        receivedMinor: 12_000n,
      }),
      {
        ...context,
        accounts: [...ACCOUNTS, sgd],
        reference: { base: 'USD', quote: 'SGD', rate: '1.3' },
        receivedToBase: { base: 'SGD', quote: 'IDR', rate: '12000' },
      },
    );
    // Expected S$130,00; S$10,00 short at Rp12.000.
    expect(figures?.difference.expectedReceivedMinor).toBe(13_000n);
    expect(figures?.difference.differenceBaseMinor).toBe(-120_000n);
  });

  it('has nothing to show without both accounts, an amount, a rate or something received', () => {
    expect(fxFigures(fxTransfer({ toAccountId: null }), context)).toBeNull();
    expect(fxFigures(fxTransfer({ toAccountId: JAGO.id }), context)).toBeNull();
    expect(fxFigures(fxTransfer({ amountMinor: null }), context)).toBeNull();
    expect(fxFigures(fxTransfer(), { ...context, reference: null })).toBeNull();
    expect(fxFigures(fxTransfer({ receivedMinor: 0n }), context)).toBeNull();
  });

  it('shows one unit of the rate base', () => {
    expect(unitValue({ base: 'USD', quote: 'IDR', rate: '16350' })).toBe(16_350n);
    expect(unitValue({ base: 'IDR', quote: 'USD', rate: '0.0001' })).toBe(0n);
  });
});

describe('validate', () => {
  it('needs an amount, an account and a category for expenses and incomes', () => {
    expect(validate(values({ accountId: null }), ACCOUNTS, null)).toEqual({
      amount: 'required',
      account: 'required',
      category: 'required',
    });
    expect(validate(values({ amountMinor: 0n }), ACCOUNTS, null)).toEqual({ amount: 'required', category: 'required' });
    expect(validate(values({ type: 'income', amountMinor: 5n, categoryId: 'c' }), ACCOUNTS, null)).toEqual({});
  });

  it('needs a destination other than the source', () => {
    const transfer = values({ type: 'transfer', amountMinor: 5n });
    expect(validate(transfer, ACCOUNTS, null)).toEqual({ toAccount: 'required' });
    expect(validate({ ...transfer, toAccountId: BCA.id }, ACCOUNTS, null)).toEqual({ toAccount: 'same_account' });
    expect(validate({ ...transfer, toAccountId: JAGO.id }, ACCOUNTS, null)).toEqual({});
  });

  it('needs a fee category once there is a fee', () => {
    const transfer = values({ type: 'transfer', amountMinor: 5n, toAccountId: JAGO.id });
    expect(validate({ ...transfer, feeMinor: 0n }, ACCOUNTS, null)).toEqual({});
    expect(validate({ ...transfer, feeMinor: 2_500n }, ACCOUNTS, null)).toEqual({ feeCategory: 'required' });
    expect(validate({ ...transfer, feeMinor: 2_500n, feeCategoryId: 'f' }, ACCOUNTS, null)).toEqual({});
  });

  it('needs something received and a usable rate across currencies', () => {
    const figures = fxFigures(fxTransfer(), context);
    expect(validate(fxTransfer(), ACCOUNTS, figures)).toEqual({});
    expect(validate(fxTransfer({ receivedMinor: 0n }), ACCOUNTS, null)).toEqual({ received: 'invalid' });
    expect(validate(fxTransfer(), ACCOUNTS, null)).toEqual({ rate: 'required' });
    expect(validate(fxTransfer({ rateMode: 'manual' }), ACCOUNTS, null)).toEqual({ rate: 'invalid' });
    // Without an amount, only the amount is wrong.
    expect(validate(fxTransfer({ amountMinor: null }), ACCOUNTS, null)).toEqual({ amount: 'required' });
  });
});

describe('shortfall', () => {
  it('warns when the balance does not cover an expense', () => {
    expect(shortfall(values({ accountId: OVO.id, amountMinor: 100_000n }), ACCOUNTS)).toEqual({
      account: OVO,
      outflowMinor: 100_000n,
      shortMinor: 14_000n,
    });
    expect(shortfall(values({ accountId: OVO.id, amountMinor: 86_000n }), ACCOUNTS)).toBeNull();
  });

  it('counts a transfer fee', () => {
    const transfer = values({ type: 'transfer', accountId: OVO.id, toAccountId: JAGO.id, amountMinor: 80_000n });
    expect(shortfall({ ...transfer, feeMinor: 10_000n }, ACCOUNTS)?.shortMinor).toBe(4_000n);
    expect(shortfall({ ...transfer, feeMinor: 0n }, ACCOUNTS)).toBeNull();
    expect(shortfall({ ...transfer, feeMinor: null }, ACCOUNTS)).toBeNull();
    // A fee on an expense means nothing.
    expect(shortfall({ ...transfer, type: 'expense', feeMinor: 10_000n }, ACCOUNTS)).toBeNull();
  });

  it('never warns for incomes, credit cards, or without an amount or account', () => {
    expect(shortfall(values({ type: 'income', accountId: OVO.id, amountMinor: 1_000_000n }), ACCOUNTS)).toBeNull();
    expect(shortfall(values({ accountId: CARD.id, amountMinor: 1_000_000n }), ACCOUNTS)).toBeNull();
    expect(shortfall(values({ accountId: OVO.id }), ACCOUNTS)).toBeNull();
    expect(shortfall(values({ accountId: OVO.id, amountMinor: 0n }), ACCOUNTS)).toBeNull();
    expect(shortfall(values({ accountId: null, amountMinor: 5n }), ACCOUNTS)).toBeNull();
  });
});

describe('balancesAfter', () => {
  it('previews incomes and expenses', () => {
    expect(balancesAfter(values({ type: 'income', amountMinor: 1_000n }), ACCOUNTS, null)).toEqual([
      { account: BCA, afterMinor: 42_811_000n },
    ]);
    expect(balancesAfter(values({ amountMinor: 1_000n }), ACCOUNTS, null)).toEqual([
      { account: BCA, afterMinor: 42_809_000n },
    ]);
  });

  it('previews nothing without an account or amount', () => {
    expect(balancesAfter(values({ accountId: null, amountMinor: 5n }), ACCOUNTS, null)).toEqual([]);
    expect(balancesAfter(values(), ACCOUNTS, null)).toEqual([]);
  });

  it('previews both sides of a transfer', () => {
    const transfer = values({ type: 'transfer', amountMinor: 1_000_000n, feeMinor: 2_500n });
    expect(balancesAfter(transfer, ACCOUNTS, null)).toEqual([{ account: BCA, afterMinor: 41_807_500n }]);
    expect(balancesAfter({ ...transfer, toAccountId: BCA.id }, ACCOUNTS, null)).toHaveLength(1);
    expect(balancesAfter({ ...transfer, toAccountId: JAGO.id }, ACCOUNTS, null)).toEqual([
      { account: BCA, afterMinor: 41_807_500n },
      { account: JAGO, afterMinor: 6_250_000n },
    ]);
  });

  it('previews what arrives across currencies once known', () => {
    expect(balancesAfter(fxTransfer(), ACCOUNTS, fxFigures(fxTransfer(), context))).toEqual([
      { account: BCA, afterMinor: 39_810_000n },
      { account: GOTRADE, afterMinor: 23_410n },
    ]);
    expect(balancesAfter(fxTransfer(), ACCOUNTS, null)).toHaveLength(1);
  });
});

describe('time zones', () => {
  it('places a wall-clock time in Asia/Jakarta', () => {
    expect(zonedInstant(TODAY, '19:30', 'Asia/Jakarta').toISOString()).toBe('2026-10-19T12:30:00.000Z');
    expect(zonedInstant('2026-01-01' as LocalDate, '03:15', 'Asia/Jakarta').toISOString()).toBe(
      '2025-12-31T20:15:00.000Z',
    );
    expect(wallTime(new Date('2026-10-19T12:30:00Z'), 'Asia/Jakarta')).toBe('19:30');
    expect(wallTime(new Date('2026-10-19T17:05:00Z'), 'Asia/Jakarta')).toBe('00:05');
  });

  it('follows daylight saving time in America/New_York', () => {
    expect(zonedInstant('2026-01-15' as LocalDate, '12:00', 'America/New_York').toISOString()).toBe(
      '2026-01-15T17:00:00.000Z',
    );
    expect(zonedInstant('2026-07-15' as LocalDate, '12:00', 'America/New_York').toISOString()).toBe(
      '2026-07-15T16:00:00.000Z',
    );
    // The day clocks go forward (8 Mar 2026, 02:00 → 03:00) and back (1 Nov 2026, 02:00 → 01:00).
    expect(zonedInstant('2026-03-08' as LocalDate, '03:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    expect(zonedInstant('2026-11-01' as LocalDate, '00:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T04:30:00.000Z',
    );
    expect(zonedInstant('2026-11-01' as LocalDate, '03:00', 'America/New_York').toISOString()).toBe(
      '2026-11-01T08:00:00.000Z',
    );
    expect(wallTime(new Date('2026-07-15T16:00:00Z'), 'America/New_York')).toBe('12:00');
  });
});

describe('datePresets', () => {
  it('counts back from a Monday', () => {
    expect(datePresets(TODAY)).toEqual({
      today: '2026-10-19',
      yesterday: '2026-10-18',
      twoDaysAgo: '2026-10-17',
      lastSaturday: '2026-10-17',
      monthStart: '2026-10-01',
    });
  });

  it('takes the Saturday a week before on a Saturday, and the day before on a Sunday', () => {
    expect(datePresets('2026-10-17' as LocalDate).lastSaturday).toBe('2026-10-10');
    expect(datePresets('2026-10-18' as LocalDate).lastSaturday).toBe('2026-10-17');
    expect(datePresets('2026-11-02' as LocalDate)).toMatchObject({ yesterday: '2026-11-01', monthStart: '2026-11-01' });
  });
});

describe('valuesFromDetail', () => {
  const id = { timeZone: 'Asia/Jakarta', locale: 'id' } as const;
  /** Rp3.000.000 from BCA, US$182,10 into Gotrade at a manual Rp16.474,5, Rp6.500 fee. */
  const FX: TransferView = {
    sentMinor: 3_000_000n,
    sentCurrency: 'IDR',
    receivedMinor: 18_210n,
    receivedCurrency: 'USD',
    referenceRate: '16474.5',
    rateBase: 'USD',
    rateQuote: 'IDR',
    rateSource: 'manual',
    rateAsOf: '2026-10-15' as LocalDate,
    fxDiffBaseMinor: -22_665n,
    fxDiffAsExpense: true,
  };
  const fxTransferDetail = (transfer: Partial<TransferView> = {}) =>
    transactionDetail('tx-fx', {
      type: 'transfer',
      categoryId: null,
      postings: [
        posting(BCA.id, -3_000_000n),
        posting(GOTRADE.id, 18_210n, { currency: 'USD', amountBaseMinor: 2_977_335n }),
        posting(BCA.id, -6_500n, { role: 'fee', categoryId: categoryId('system:bank_fee') }),
      ],
      transfer: { ...FX, ...transfer },
    });

  it('fills an expense from its outgoing posting, on the wall clock of the time zone', () => {
    const detail = transactionDetail('tx-1', { description: 'Makan siang', note: 'Bareng tim', tags: ['kantor'] });
    expect(valuesFromDetail(detail, id)).toEqual({
      ...emptyValues({ accountId: BCA.id, date: '2026-10-15' as LocalDate, time: '12:41' }),
      amountMinor: 10_000n,
      categoryId: categoryId('system:food'),
      description: 'Makan siang',
      note: 'Bareng tim',
      tags: ['kantor'],
    });
    // A copy of the tags, not the detail's array.
    expect(valuesFromDetail(detail, id).tags).not.toBe(detail.tags);
  });

  it('fills an income from its only (incoming) posting', () => {
    const detail = transactionDetail('tx-2', {
      type: 'income',
      categoryId: categoryId('system:salary'),
      postings: [posting(JAGO.id, 8_500_000n)],
    });
    expect(valuesFromDetail(detail, id)).toMatchObject({
      type: 'income',
      amountMinor: 8_500_000n,
      categoryId: categoryId('system:salary'),
      accountId: JAGO.id,
      toAccountId: null,
      description: '',
      note: '',
    });
  });

  it('dates a copy at `at` instead (a duplicate is dated now)', () => {
    const values = valuesFromDetail(transactionDetail('tx-3'), { ...id, at: new Date('2026-10-19T17:05:00Z') });
    expect(values).toMatchObject({ date: '2026-10-20', time: '00:05' });
  });

  it('has neither account nor amount without postings', () => {
    expect(valuesFromDetail(transactionDetail('tx-4', { postings: [] }), id)).toMatchObject({
      amountMinor: null,
      accountId: null,
    });
  });

  it('fills a same-currency transfer: both accounts, no category, no received amount or rate', () => {
    const detail = transactionDetail('tx-5', {
      type: 'transfer',
      categoryId: null,
      postings: [posting(BCA.id, -500_000n), posting(OVO.id, 500_000n)],
      transfer: {
        ...FX,
        sentMinor: 500_000n,
        receivedMinor: 500_000n,
        receivedCurrency: 'IDR',
        referenceRate: null,
        rateBase: null,
        rateQuote: null,
        rateSource: null,
        rateAsOf: null,
        fxDiffBaseMinor: 0n,
      },
    });
    expect(valuesFromDetail(detail, id)).toMatchObject({
      type: 'transfer',
      amountMinor: 500_000n,
      categoryId: null,
      accountId: BCA.id,
      toAccountId: OVO.id,
      receivedMinor: null,
      rateMode: 'reference',
      manualRate: '',
      feeMinor: null,
      feeCategoryId: null,
    });
  });

  it('fills a cross-currency transfer with its fee and manual rate, typed in the locale’s decimal format', () => {
    const expected = {
      type: 'transfer',
      amountMinor: 3_000_000n,
      accountId: BCA.id,
      toAccountId: GOTRADE.id,
      receivedMinor: 18_210n,
      rateMode: 'manual',
      feeMinor: 6_500n,
      feeCategoryId: categoryId('system:bank_fee'),
    };
    expect(valuesFromDetail(fxTransferDetail(), id)).toMatchObject({ ...expected, manualRate: '16474,5' });
    expect(valuesFromDetail(fxTransferDetail(), { ...id, locale: 'en' })).toMatchObject({
      ...expected,
      manualRate: '16474.5',
    });
  });

  it('uses the reference rate unless the transfer kept a manual one', () => {
    for (const transfer of [{ rateSource: 'frankfurter' }, { rateSource: 'manual', referenceRate: null }]) {
      expect(valuesFromDetail(fxTransferDetail(transfer), id)).toMatchObject({ rateMode: 'reference', manualRate: '' });
    }
  });

  it('keeps a fee without a category, and a transfer missing its destination posting', () => {
    const detail = transactionDetail('tx-6', {
      type: 'transfer',
      categoryId: null,
      postings: [posting(BCA.id, -500_000n), posting(BCA.id, -2_500n, { role: 'fee' })],
      transfer: { ...FX, receivedCurrency: 'IDR', rateSource: null },
    });
    expect(valuesFromDetail(detail, id)).toMatchObject({ toAccountId: null, feeMinor: 2_500n, feeCategoryId: null });
  });
});

describe('toRecordInput', () => {
  const base = { clientId: 'client-1', timeZone: 'Asia/Jakarta', source: 'manual' as const, accounts: ACCOUNTS };

  it('turns an expense into its server input', () => {
    expect(
      toRecordInput(
        values({ amountMinor: 25_000n, categoryId: 'c', description: ' Kopi ', note: ' rahasia ', tags: ['kantor'] }),
        { ...base, source: 'quick', figures: null },
      ),
    ).toEqual({
      clientId: 'client-1',
      occurredAt: new Date('2026-10-19T12:30:00Z'),
      description: 'Kopi',
      note: 'rahasia',
      tags: ['kantor'],
      source: 'quick',
      type: 'expense',
      accountId: BCA.id,
      amountMinor: 25_000n,
      categoryId: 'c',
    });
    expect(toRecordInput(values({ accountId: null, description: ' ' }), { ...base, figures: null })).toMatchObject({
      accountId: '',
      amountMinor: 0n,
      description: null,
      note: null,
    });
  });

  it('turns a same-currency transfer into its server input', () => {
    const transfer = values({ type: 'transfer', amountMinor: 1_000_000n, toAccountId: JAGO.id });
    expect(
      toRecordInput({ ...transfer, feeMinor: 2_500n, feeCategoryId: 'fee' }, { ...base, figures: null }),
    ).toMatchObject({
      type: 'transfer',
      fromAccountId: BCA.id,
      toAccountId: JAGO.id,
      sentMinor: 1_000_000n,
      receivedMinor: 1_000_000n,
      manualRate: null,
      fee: { minor: 2_500n, categoryId: 'fee' },
    });
    expect(toRecordInput({ ...transfer, feeMinor: 2_500n }, { ...base, figures: null })).toMatchObject({ fee: null });
    expect(
      toRecordInput({ ...transfer, feeMinor: 0n, feeCategoryId: 'fee' }, { ...base, figures: null }),
    ).toMatchObject({
      fee: null,
    });
    expect(toRecordInput(values({ type: 'transfer', accountId: null }), { ...base, figures: null })).toMatchObject({
      fromAccountId: '',
      toAccountId: '',
      sentMinor: 0n,
      receivedMinor: 0n,
    });
  });

  it('turns a cross-currency transfer into its server input', () => {
    const figures = fxFigures(fxTransfer(), context);
    expect(toRecordInput(fxTransfer(), { ...base, figures })).toMatchObject({
      sentMinor: 3_000_000n,
      receivedMinor: 18_210n,
      manualRate: null,
    });
    const manual = fxTransfer({ rateMode: 'manual', manualRate: '16.474' });
    expect(toRecordInput(manual, { ...base, figures: fxFigures(manual, context) })).toMatchObject({
      receivedMinor: 18_210n,
      manualRate: { base: 'USD', quote: 'IDR', rate: '16474' },
    });
  });
});

describe('guessCategory', () => {
  const name = (category: { readonly name: string; readonly builtInKey: string | null }) =>
    category.builtInKey === null ? category.name : category.name.replace('system:', '');
  const categories = [...CATEGORIES, userCategory({ id: 'cat-kopi', name: 'Kopi Pagi' })];

  it('picks the first category named by a word of the text', () => {
    expect(guessCategory('kopi susu 25rb', categories, name)?.id).toBe('cat-kopi');
    expect(guessCategory('Food court', categories, name)?.id).toBe(categoryId('system:food'));
  });

  it('guesses nothing from short or unknown words', () => {
    expect(guessCategory('25 rb', categories, name)).toBeNull();
    expect(guessCategory('parkir motor', categories, name)).toBeNull();
  });
});

describe('draft payload', () => {
  const filled = fxTransfer({
    rateMode: 'manual',
    manualRate: '16.474',
    feeMinor: 2_500n,
    feeCategoryId: 'fee',
    description: 'Top up',
    note: 'n',
    tags: ['kantor', 'kopi'],
  });

  it('round-trips through JSON', () => {
    const payload = toDraftPayload(filled);
    expect(payload).toMatchObject({ version: 1, amountMinor: '3000000', receivedMinor: '18210', feeMinor: '2500' });
    expect(fromDraftPayload(JSON.parse(JSON.stringify(payload)) as never)).toEqual(filled);
    expect(fromDraftPayload(toDraftPayload(values()))).toEqual(values());
  });

  it('fills what is missing or malformed with defaults', () => {
    expect(
      fromDraftPayload({
        version: 1,
        type: 'income',
        date: '2026-10-19',
        time: '07:05',
        amountMinor: '-5',
        receivedMinor: 12,
        rateMode: 'other',
        tags: ['a', 3, 'b'],
      }),
    ).toEqual({
      ...emptyValues({ type: 'income', accountId: null, date: TODAY, time: '07:05' }),
      tags: ['a', 'b'],
    });
    expect(
      fromDraftPayload({ version: 1, type: 'expense', date: '2026-10-19', time: '07:05', tags: 'x' })?.tags,
    ).toEqual([]);
  });

  it('rejects payloads this release cannot read', () => {
    const good = { version: 1, type: 'expense', date: '2026-10-19', time: '07:05' };
    for (const bad of [
      { ...good, version: 2 },
      { ...good, type: null },
      { ...good, type: 'refund' },
      { ...good, date: 5 },
      { ...good, date: '19/10/2026' },
      { ...good, time: null },
      { ...good, time: '7:05' },
    ]) {
      expect(fromDraftPayload(bad)).toBeNull();
    }
  });
});
