// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { toLocalDate } from '@wf/ui/dates';
import { ACCOUNTS, categoryId } from '../../test/ledger-fixtures.ts';
import { DIMAS, NADIA, RAKA, receivable, splitBillContext } from '../../test/receivable-fixtures.ts';
import {
  avatarClass,
  dateLabel,
  lendingAccounts,
  momentOf,
  parsePercentBps,
  partialChips,
  receivableBadge,
  receivableKpis,
  reminderClock,
  splitImpact,
  splitShares,
  type SplitPerson,
} from './receivables.ts';

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');
const person = (name: string, amountMinor: bigint | null = null, percent = ''): SplitPerson => ({
  name,
  amountMinor,
  percent,
});

describe('receivableBadge', () => {
  it('golden KZZZy: Nadia "3 hari lagi" (amber), Raka "Sebagian"', () => {
    expect(receivableBadge(NADIA, TODAY)).toEqual({ kind: 'due', days: 3, tone: 'soon' });
    expect(receivableBadge(RAKA, TODAY)).toEqual({ kind: 'partial' });
  });

  it('is neutral far ahead, overdue after the date, and absent without one', () => {
    expect(receivableBadge({ ...NADIA, dueDate: d('2026-10-31') }, TODAY)).toMatchObject({ tone: 'neutral', days: 16 });
    expect(receivableBadge(NADIA, d('2026-10-20'))).toMatchObject({ tone: 'overdue', days: -2 });
    expect(receivableBadge(DIMAS, TODAY)).toBeNull();
  });
});

describe('avatarClass', () => {
  it('keeps a tint per name', () => {
    expect(avatarClass('Nadia')).toBe(avatarClass('Nadia'));
    expect(
      new Set(['Nadia', 'Raka Pratama', 'Dimas', 'Sari', 'Bima Aditya', ''].map(avatarClass)).size,
    ).toBeGreaterThan(1);
  });
});

describe('receivableKpis', () => {
  it('golden KZZZy: 2 people, 1 due in 3 days (Nadia Rp242.500)', () => {
    expect(receivableKpis({ active: [NADIA, RAKA] }, TODAY)).toEqual({
      people: 2,
      nearest: { date: '2026-10-18', days: 3, count: 1, name: 'Nadia', remainingMinor: 242_500n, currency: 'IDR' },
    });
  });

  it('counts the people once, every receivable due that day, and ignores past and missing due dates', () => {
    const late = receivable({ id: 'late', counterparty: 'Nadia', dueDate: d('2026-10-01') });
    const open = receivable({ id: 'open', counterparty: 'Sari' });
    const same = receivable({ id: 'same', counterparty: 'Dimas', dueDate: d('2026-10-18') });
    expect(receivableKpis({ active: [late, open, RAKA, same, NADIA] }, TODAY)).toMatchObject({
      people: 4,
      nearest: { date: '2026-10-18', count: 2, name: 'Dimas' },
    });
    expect(receivableKpis({ active: [late, open] }, TODAY)).toEqual({ people: 2, nearest: null });
  });
});

describe('partialChips', () => {
  it('golden ivnWw: Rp300.000 → Rp100.000 and Rp200.000', () => {
    expect(partialChips(300_000n, 1_000n)).toEqual([100_000n, 200_000n]);
  });

  it('rounds down to the step and drops empty or duplicate chips', () => {
    expect(partialChips(242_500n, 1_000n)).toEqual([80_000n, 161_000n]);
    expect(partialChips(1_500n, 1_000n)).toEqual([1_000n]);
    expect(partialChips(500n, 1_000n)).toEqual([]);
  });
});

describe('parsePercentBps', () => {
  it('reads whole and decimal percents with a comma or a dot', () => {
    expect(parsePercentBps('50')).toBe(5_000);
    expect(parsePercentBps(' 33,5 ')).toBe(3_350);
    expect(parsePercentBps('12.25')).toBe(1_225);
    expect(parsePercentBps('100')).toBe(10_000);
  });

  it('refuses what is not a percent', () => {
    for (const text of ['', 'x', '101', '1,234', '-5']) expect(parsePercentBps(text)).toBeNull();
  });
});

describe('splitShares', () => {
  const people = [person('Kamu'), person('Nadia')];

  it('golden IGHyP: CGV Rp485.000 equally → 242.500 + 242.500', () => {
    expect(splitShares(485_000n, 'equal', people, [])).toEqual({ ok: true, amounts: [242_500n, 242_500n] });
  });

  it('takes typed amounts that add up, and says what is missing or off', () => {
    const typed = [person('Kamu', 285_000n), person('Nadia', 200_000n)];
    expect(splitShares(485_000n, 'amount', typed, [])).toEqual({ ok: true, amounts: [285_000n, 200_000n] });
    expect(splitShares(485_000n, 'amount', [typed[0] as SplitPerson, person('Nadia')], [])).toEqual({
      ok: false,
      reason: 'incomplete',
      differenceMinor: 0n,
    });
    expect(splitShares(500_000n, 'amount', typed, [])).toEqual({
      ok: false,
      reason: 'mismatch',
      differenceMinor: 15_000n,
    });
  });

  it('splits by percent adding up to 100%', () => {
    const typed = [person('Kamu', null, '60'), person('Nadia', null, '40')];
    expect(splitShares(485_000n, 'percent', typed, [])).toEqual({ ok: true, amounts: [291_000n, 194_000n] });
    expect(splitShares(485_000n, 'percent', [person('Kamu', null, '60'), person('Nadia')], [])).toMatchObject({
      reason: 'incomplete',
    });
    expect(splitShares(485_000n, 'percent', [person('Kamu', null, '60'), person('Nadia', null, '30')], [])).toEqual({
      ok: false,
      reason: 'mismatch',
      differenceMinor: 48_500n,
    });
  });

  it('splits per item with the rest (tax, service) in proportion, once every item is complete', () => {
    const items = [
      { amountMinor: 200_000n, people: [0] },
      { amountMinor: 100_000n, people: [1] },
      { amountMinor: 140_000n, people: [0, 1] },
    ];
    // 440.000 of items + 10% → 484.000.
    expect(splitShares(484_000n, 'item', people, items)).toEqual({ ok: true, amounts: [297_000n, 187_000n] });
    expect(splitShares(484_000n, 'item', people, [])).toMatchObject({ reason: 'incomplete' });
    expect(splitShares(484_000n, 'item', people, [{ amountMinor: null, people: [0] }])).toMatchObject({
      reason: 'incomplete',
    });
    expect(splitShares(484_000n, 'item', people, [{ amountMinor: 1n, people: [] }])).toMatchObject({
      reason: 'incomplete',
    });
  });
});

describe('splitImpact', () => {
  const ENTERTAINMENT = categoryId('system:entertainment');
  const bill = { date: d('2026-10-11'), categoryId: ENTERTAINMENT, totalMinor: 485_000n, ownMinor: 242_500n };

  it('golden IGHyP: recorded whole vs split — Hiburan, Oktober spending, safe daily limit, receivables', () => {
    expect(splitImpact(splitBillContext(), bill)).toEqual({
      category: { beforeMinor: 2_085_000n, afterMinor: 1_842_500n },
      month: { beforeMinor: 16_985_000n, afterMinor: 16_742_500n },
      safeDaily: { beforeMinor: 110_000n, afterMinor: 125_000n },
      receivables: { beforeMinor: 542_500n, afterMinor: 785_000n },
    });
  });

  it('leaves out what the bill does not touch', () => {
    expect(splitImpact(splitBillContext(), { ...bill, categoryId: null })).toMatchObject({
      category: null,
      safeDaily: null,
    });
    expect(splitImpact(splitBillContext(), { ...bill, date: d('2026-09-30') })).toMatchObject({
      category: null,
      month: null,
      safeDaily: null,
    });
    expect(splitImpact(splitBillContext(), { ...bill, date: d('2026-11-01') })).toMatchObject({ category: null });
    expect(splitImpact(splitBillContext({ budget: null }), bill)).toMatchObject({ category: null, safeDaily: null });
  });
});

describe('dialog helpers', () => {
  it('lends from active accounts that are neither cards nor investments', () => {
    expect(lendingAccounts(ACCOUNTS).map((account) => account.displayName)).toEqual([
      'BCA Tahapan',
      'Bank Jago',
      'OVO',
    ]);
  });

  it('labels today, places a date in time, and writes the reminder clock per locale', () => {
    expect(dateLabel(TODAY, TODAY, 'id')).toBe('Hari ini, 15 Okt');
    expect(dateLabel(d('2026-10-14'), TODAY, 'en')).toBe('Oct 14');
    expect(momentOf(d('2026-10-14'), TODAY, 'Asia/Jakarta')).toEqual(new Date('2026-10-14T05:00:00Z'));
    expect(toLocalDate(momentOf(TODAY, TODAY, 'Asia/Jakarta'), 'Asia/Jakarta')).toBe(TODAY);
    expect(reminderClock('09:00', 'id')).toBe('09.00');
    expect(reminderClock('09:00', 'en')).toBe('09:00');
  });
});
