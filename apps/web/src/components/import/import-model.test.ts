// SPDX-License-Identifier: AGPL-3.0-only
import type { AutoRuleView } from '@wf/domain/rules';
import type { TransactionRow } from '@wf/db/transaction-query';
import type { LocalDate } from '@wf/domain/period';
import { account, userCategory } from '../../../test/ledger-fixtures.ts';
import { describe, expect, it } from 'vitest';
import {
  buildCandidates,
  detectTransfer,
  guessCategory,
  isDuplicate,
  isNewCandidate,
  normalizeText,
  similarity,
  windowOf,
  withCategory,
  type ImportContext,
  type ImportStage,
  type ParsedRow,
} from './import-model.ts';

const BCA = account({ id: 'acc-bca', displayName: 'BCA Tahapan', currency: 'IDR' });
const JAGO = account({ id: 'acc-jago', displayName: 'Bank Jago', currency: 'IDR' });
const USD = account({ id: 'acc-usd', displayName: 'Gotrade', currency: 'USD' });

const row = (patch: Partial<ParsedRow> = {}): ParsedRow => ({
  row: 1,
  date: '2026-10-05' as LocalDate,
  amountMinor: 25_000,
  direction: 'out',
  description: 'QRIS MIXUE KEMANG',
  errors: [],
  ...patch,
});

const existing = (patch: Partial<TransactionRow> = {}): TransactionRow => ({
  id: 'tx-1',
  type: 'expense',
  occurredAt: new Date('2026-10-05T05:00:00Z'),
  localDate: '2026-10-05' as LocalDate,
  merchant: null,
  description: 'Mixue Kemang',
  categoryId: 'cat-food',
  accountId: BCA.id,
  toAccountId: null,
  amountMinor: -25_000n,
  currency: 'IDR',
  receivedMinor: null,
  receivedCurrency: null,
  amountBaseMinor: -25_000n,
  feeMinor: null,
  fxDiffBaseMinor: null,
  tags: [],
  hasAttachment: false,
  hasNote: false,
  source: 'manual',
  splitParentId: null,
  ...patch,
});

const context = (patch: Partial<ImportContext> = {}): ImportContext => ({
  accountId: BCA.id,
  currency: 'IDR',
  accounts: [BCA, JAGO, USD],
  categories: [],
  rules: [],
  subscriptionNames: [],
  existing: [],
  history: [],
  ...patch,
});

describe('normalizeText', () => {
  it('lowercases and strips everything but letters and digits', () => {
    expect(normalizeText('TRSF KE Bibit RDPU #1')).toBe('trsfkebibitrdpu1');
  });
});

describe('similarity', () => {
  it('is 1 for identical text and 0 without a shared bigram', () => {
    expect(similarity('QRIS MIXUE KEMANG', 'qris mixue kemang')).toBe(1);
    expect(similarity('ab', 'xyz')).toBe(0);
    expect(similarity('ab', 'a')).toBe(0);
    expect(similarity('a', 'a')).toBe(1);
    expect(similarity('Mixue Kemang', 'QRIS MIXUE KEMANG')).toBeGreaterThan(0.6);
  });
});

describe('detectTransfer', () => {
  it('names the own account the description mentions, longest name wins', () => {
    const mandiri = account({ id: 'acc-md', displayName: 'Mandiri', currency: 'IDR' });
    const jagoSavings = account({ id: 'acc-jago-2', displayName: 'Bank Jago Dana Darurat', currency: 'IDR' });
    expect(detectTransfer('TRSF KE BIBIT RDPU', BCA.id, 'IDR', [JAGO, USD])).toBeNull();
    expect(
      detectTransfer('TRSF KE JAGO', BCA.id, 'IDR', [account({ id: 'acc-j1', displayName: 'Jago', currency: 'IDR' })]),
    ).toMatchObject({ id: 'acc-j1' });
    expect(detectTransfer('TRSF KE BANK JAGO', BCA.id, 'IDR', [JAGO, USD])).toBe(JAGO);
    expect(detectTransfer('TRSF KE BANK JAGO DANA DARURAT', BCA.id, 'IDR', [jagoSavings, JAGO])).toBe(jagoSavings);
    expect(detectTransfer(null, BCA.id, 'IDR', [JAGO])).toBeNull();
    expect(detectTransfer('TRSF KE BANK JAGO', JAGO.id, 'IDR', [JAGO])).toBeNull();
    expect(detectTransfer('TRSF KE BANK JAGO', BCA.id, 'IDR', [mandiri, USD])).toBeNull();
  });
});

describe('guessCategory', () => {
  const history = [
    { description: 'GOJEK - makan siang', categoryId: 'cat-food' },
    { description: 'SALDO AWAL', categoryId: null },
    { description: 'Grab pulang kantor', categoryId: 'cat-transport' },
  ];

  it('returns the newest history match and its keyword', () => {
    expect(guessCategory('GOJEK kopi', history)).toEqual({ categoryId: 'cat-food', keyword: 'gojek' });
  });

  it('skips history rows without a description or a category', () => {
    const sparse = [
      { description: null, categoryId: 'cat-x' },
      { description: 'GOJEK', categoryId: null },
    ];
    expect(guessCategory('gojek makan', sparse)).toBeNull();
  });

  it('falls through to older rows and answers null without a match', () => {
    expect(guessCategory('Grab pulang', history)).toEqual({ categoryId: 'cat-transport', keyword: 'grab' });
    expect(guessCategory('BIAYA ADMIN', history)).toBeNull();
    expect(guessCategory(null, history)).toBeNull();
  });
});

describe('isDuplicate', () => {
  it('needs the same day and amount, and a similar description', () => {
    expect(isDuplicate('2026-10-05' as LocalDate, 25_000n, 'QRIS MIXUE KEMANG', existing())).toBe(true);
    expect(isDuplicate('2026-10-06' as LocalDate, 25_000n, 'QRIS MIXUE KEMANG', existing())).toBe(false);
    expect(isDuplicate('2026-10-05' as LocalDate, 26_000n, 'QRIS MIXUE KEMANG', existing())).toBe(false);
    expect(isDuplicate('2026-10-05' as LocalDate, 25_000n, 'QRIS STARBUCKS', existing())).toBe(false);
    expect(
      isDuplicate(
        '2026-10-05' as LocalDate,
        25_000n,
        'QRIS MIXUE KEMANG',
        existing({ description: 'MIXUE KEMANG', receivedMinor: 25_000n, amountMinor: -25_000n }),
      ),
    ).toBe(true);
  });

  it('matches rows without any description', () => {
    expect(isDuplicate('2026-10-05' as LocalDate, 25_000n, null, existing())).toBe(true);
    expect(isDuplicate('2026-10-05' as LocalDate, 25_000n, 'QRIS MIXUE', existing({ description: null }))).toBe(true);
  });
});

describe('buildCandidates', () => {
  it('marks duplicates against the account and within the file, and counts the tiles', () => {
    const parsed = [
      row({ row: 1 }),
      row({
        row: 2,
        date: '2026-10-06' as LocalDate,
        description: 'GAJI OKTOBER',
        direction: 'in',
        amountMinor: 6_200_000,
      }),
      row({ row: 3, date: '2026-10-07' as LocalDate, description: 'TRSF KE BANK JAGO', amountMinor: 1_000_000 }),
      row({ row: 4, date: '2026-10-07' as LocalDate, description: 'TRSF KE BANK JAGO', amountMinor: 1_000_000 }),
      row({ row: 5, errors: ['Baris 5: kolom jumlah kosong'], amountMinor: null, direction: null }),
    ];
    const { candidates, stats } = buildCandidates(
      parsed,
      context({
        existing: [existing()],
        history: [{ description: 'gaji bulanan', categoryId: 'cat-income' }],
      }),
    );
    expect(stats).toEqual({ found: 5, toImport: 2, duplicates: 2, unreadable: 1 });
    expect(candidates[0]).toMatchObject({ status: 'duplicate', categoryId: null, transfer: null });
    expect(candidates[1]).toMatchObject({ status: 'new', categoryId: 'cat-income', guessedFrom: 'gaji' });
    expect(candidates[2]).toMatchObject({ status: 'new', transfer: JAGO, categoryId: null });
    expect(candidates[3]).toMatchObject({ status: 'duplicate' });
    expect(candidates[4]).toMatchObject({ status: 'error', date: null, amountMinor: null });
  });

  it('deduplicates a readable row without a description within the file', () => {
    const { stats } = buildCandidates([row({ description: null }), row({ row: 2, description: null })], context());
    expect(stats).toEqual({ found: 2, toImport: 1, duplicates: 1, unreadable: 0 });
  });

  it('keeps an error row that still has a date and description', () => {
    const { candidates } = buildCandidates(
      [row({ row: 9, errors: ['Baris 9: format tanggal tidak valid'] })],
      context(),
    );
    expect(candidates[0]).toMatchObject({ row: 9, status: 'error', description: 'QRIS MIXUE KEMANG' });
  });
});

describe('isNewCandidate', () => {
  it('accepts the new rows and refuses duplicates and errors', () => {
    const { candidates } = buildCandidates(
      [row(), row({ row: 2 }), row({ row: 3, errors: ['x'], amountMinor: null, direction: null })],
      context(),
    );
    expect(candidates.filter(isNewCandidate).map((candidate) => candidate.row)).toEqual([1]);
    expect(candidates[1]).toMatchObject({ status: 'duplicate' });
    expect(candidates[2]).toMatchObject({ status: 'error' });
  });
});

describe('withCategory', () => {
  const statement = { name: 'mutasi.csv', size: 42, bank: null, headers: [], rows: [] };
  const stage = (candidates: Parameters<typeof buildCandidates>[0]): ImportStage => ({
    step: 'review',
    account: BCA,
    statement,
    candidates: buildCandidates(candidates, context()),
  });

  it('sets and clears the category of the target row and drops the guess hint', () => {
    const start = stage([row(), row({ row: 2, description: 'GAJI', direction: 'in' })]);
    const withKopi = withCategory(start, 1, 'cat-kopi');
    expect(withKopi.step !== 'review' ? null : withKopi.candidates.candidates[0]).toMatchObject({
      categoryId: 'cat-kopi',
      guessedFrom: null,
    });
    expect(withKopi.step !== 'review' ? null : withKopi.candidates.candidates[1]).toMatchObject({ categoryId: null });
    const cleared = withCategory(withKopi, 1, null);
    expect(cleared.step !== 'review' ? null : cleared.candidates.candidates[0]).toMatchObject({ categoryId: null });
  });

  it('leaves an error row and a non-review stage unchanged', () => {
    const withError = stage([row({ errors: ['Baris 1: kolom jumlah kosong'], amountMinor: null, direction: null })]);
    expect(withCategory(withError, 1, 'cat-kopi')).toEqual(withError);
    expect(withCategory({ step: 'upload' }, 1, 'cat-kopi')).toEqual({ step: 'upload' });
  });
});

describe('windowOf', () => {
  it('spans the readable rows and answers null without any', () => {
    expect(
      windowOf([row({ date: '2026-10-09' as LocalDate }), row({ row: 2, date: '2026-10-01' as LocalDate })]),
    ).toEqual({
      from: '2026-10-01',
      to: '2026-10-09',
    });
    expect(windowOf([row({ date: null }), row({ row: 2, errors: ['x'], date: null })])).toBeNull();
  });
});

describe('rule suggestions', () => {
  const RULE_CATEGORY = userCategory({ id: 'c-kopi', name: 'Kopi' });
  const ARCHIVED = userCategory({ id: 'c-archived', name: 'Lama', archivedAt: new Date('2026-09-01T00:00:00Z') });
  const rule = (patch: Partial<AutoRuleView> = {}): AutoRuleView => ({
    id: crypto.randomUUID(),
    name: 'Kopi',
    enabled: true,
    position: 0,
    conditions: [{ field: 'description', op: 'containsAny', values: ['kopi'] }],
    actions: [
      { type: 'setCategory', categoryId: RULE_CATEGORY.id },
      { type: 'addTag', tag: 'kopi' },
    ],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...patch,
  });

  it('names a matching tag-only rule when no rule sets a category', () => {
    const tagOnly = rule({ actions: [{ type: 'addTag', tag: 'kopi' }] });
    const { candidates } = buildCandidates(
      [row({ description: 'KOPI KENANGAN', amountMinor: 25_000 })],
      context({ rules: [tagOnly], categories: [RULE_CATEGORY] }),
    );
    expect(candidates[0]).toMatchObject({ ruleName: 'Kopi', tags: ['kopi'], categoryId: null });
  });

  it('prefers the top matching rule’s category over the history guess and adds its tags', () => {
    const { candidates } = buildCandidates(
      [row({ description: 'KOPI KENANGAN', amountMinor: 25_000 })],
      context({
        rules: [rule()],
        categories: [RULE_CATEGORY],
        history: [{ description: 'kopi lama', categoryId: 'cat-history' }],
      }),
    );
    expect(candidates[0]).toMatchObject({
      status: 'new',
      categoryId: RULE_CATEGORY.id,
      ruleName: 'Kopi',
      tags: ['kopi'],
      ruleTagOverflow: false,
      guessedFrom: null,
    });
  });

  it('falls back to the history guess when the rule category is archived or the other direction', () => {
    const archived = buildCandidates(
      [row({ description: 'KOPI KENANGAN', amountMinor: 25_000, direction: 'out' })],
      context({
        rules: [rule({ actions: [{ type: 'setCategory', categoryId: ARCHIVED.id }] })],
        categories: [ARCHIVED],
        history: [{ description: 'kopi lama', categoryId: 'cat-history' }],
      }),
    );
    expect(archived.candidates[0]).toMatchObject({
      categoryId: 'cat-history',
      ruleName: 'Kopi',
      guessedFrom: 'kopi',
    });
    const income = buildCandidates(
      [row({ description: 'KOPI KENANGAN', amountMinor: 25_000, direction: 'in' })],
      context({ rules: [rule()], categories: [RULE_CATEGORY], history: [] }),
    );
    expect(income.candidates[0]).toMatchObject({ categoryId: null, ruleName: 'Kopi' });
  });

  it('uses the own registered subscription names for the subscription condition', () => {
    const candidateRule = rule({
      conditions: [{ field: 'subscription', op: 'isRegistered' }],
      actions: [{ type: 'setCategory', categoryId: RULE_CATEGORY.id }],
    });
    const { candidates } = buildCandidates(
      [row({ description: 'NETFLIX BULANAN', amountMinor: 54_990 })],
      context({ rules: [candidateRule], categories: [RULE_CATEGORY], subscriptionNames: ['Netflix'] }),
    );
    expect(candidates[0]).toMatchObject({ categoryId: RULE_CATEGORY.id, ruleName: 'Kopi' });
  });

  it('keeps no tags when the matching rules add more than five, and says so', () => {
    const many = [
      rule({ position: 0 }),
      rule({ position: 1, actions: ['a', 'b', 'c', 'd', 'e'].map((tag) => ({ type: 'addTag' as const, tag })) }),
    ];
    const { candidates } = buildCandidates(
      [row({ description: 'KOPI KENANGAN', amountMinor: 25_000 })],
      context({ rules: many, categories: [RULE_CATEGORY] }),
    );
    expect(candidates[0]).toMatchObject({ tags: [], ruleTagOverflow: true });
  });

  it('keeps the rule name and tags but drops the guess hint after the user picks a category', () => {
    const start: ImportStage = {
      step: 'review',
      account: BCA,
      statement: { name: 'mutasi.csv', size: 1, bank: null, headers: [], rows: [] },
      candidates: buildCandidates(
        [row({ description: 'KOPI KENANGAN', amountMinor: 25_000 })],
        context({ rules: [rule()], categories: [RULE_CATEGORY] }),
      ),
    };
    const changed = withCategory(start, 1, 'c-other');
    expect(changed.step !== 'review' ? null : changed.candidates.candidates[0]).toMatchObject({
      categoryId: 'c-other',
      ruleName: 'Kopi',
      tags: ['kopi'],
      guessedFrom: null,
    });
  });
});
