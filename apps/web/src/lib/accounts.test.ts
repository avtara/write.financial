// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { accountView, CATEGORIES } from '../../test/accounts.ts';
import {
  accountMeta,
  accountTotals,
  axisStart,
  byCheckAge,
  cardSlots,
  changeRatio,
  differenceCategories,
  daysSinceCheck,
  groupByType,
  maskPhone,
  MAX_CARDS,
  STALE_AFTER_DAYS,
} from './accounts.ts';

const TODAY = '2026-10-15' as LocalDate;

describe('groupByType', () => {
  it('groups in type order, keeps the account order, and totals the known base values', () => {
    const bca = accountView({ balanceBaseMinor: 42_810_000n });
    const gopay = accountView({ type: 'ewallet', balanceBaseMinor: 412_000n });
    const jago = accountView({ balanceBaseMinor: 8_125_000n });
    const gotrade = accountView({ type: 'investment', currency: 'USD', balanceBaseMinor: null });
    const groups = groupByType([gopay, gotrade, bca, jago]);
    expect(groups.map((group) => [group.type, group.accounts.map((a) => a.id), group.totalBaseMinor])).toEqual([
      ['bank', [bca.id, jago.id], 50_935_000n],
      ['ewallet', [gopay.id], 412_000n],
      ['investment', [gotrade.id], 0n],
    ]);
  });
});

describe('accountTotals', () => {
  it('sums investments and all accounts, lists foreign currencies, and counts spending accounts', () => {
    const totals = accountTotals(
      [
        accountView({ balanceBaseMinor: 1_000n }),
        accountView({ type: 'investment', currency: 'USD', balanceBaseMinor: 45_420_300n, includeInAvailable: false }),
        accountView({ type: 'investment', currency: 'EUR', balanceBaseMinor: null, includeInAvailable: false }),
        accountView({ type: 'credit_card', balanceBaseMinor: -500n }),
      ],
      'IDR',
    );
    expect(totals).toEqual({
      investmentsMinor: 45_420_300n,
      investmentCount: 2,
      totalMinor: 45_420_800n,
      foreignCurrencies: ['EUR', 'USD'],
      spendingCount: 2,
    });
  });
});

describe('daysSinceCheck and byCheckAge', () => {
  it('counts whole days in the user’s time zone since the last check, or since creation', () => {
    const created = accountView({ createdAt: new Date('2026-09-30T17:00:00Z') }); // 1 Okt WIB
    const checked = accountView({ lastReconciledAt: new Date('2026-09-11T05:00:00Z') });
    const today = accountView({ lastReconciledAt: new Date('2026-10-15T01:00:00Z') });
    expect(daysSinceCheck(created, TODAY, 'Asia/Jakarta')).toBe(14);
    expect(daysSinceCheck(created, TODAY, 'UTC')).toBe(15);
    expect(daysSinceCheck(checked, TODAY, 'Asia/Jakarta')).toBe(34);
    expect(daysSinceCheck(today, TODAY, 'Asia/Jakarta')).toBe(0);
    expect(
      byCheckAge([today, created, checked], TODAY, 'Asia/Jakarta').map(({ account, days }) => [account.id, days]),
    ).toEqual([
      [checked.id, 34],
      [created.id, 14],
      [today.id, 0],
    ]);
    expect(STALE_AFTER_DAYS).toBe(14);
  });
});

describe('cardSlots', () => {
  it('takes at most three active card accounts and merges the other everyday accounts', () => {
    const cards = [1, 2, 3, 4].map(() => accountView({ showAsCard: true }));
    const mandiri = accountView();
    const archived = accountView({ status: 'archived', showAsCard: true });
    const bibit = accountView({ type: 'investment' });
    const slots = cardSlots([archived, ...cards, mandiri, bibit]);
    expect(slots.cards.map((a) => a.id)).toEqual(cards.slice(0, MAX_CARDS).map((a) => a.id));
    expect(slots.others.map((a) => a.id)).toEqual([mandiri.id]);
  });
});

describe('maskPhone', () => {
  it('keeps the first four and last two digits only', () => {
    expect(maskPhone('0812 3456 7818')).toBe('0812•• 18');
    expect(maskPhone('+62-812-3456-7818')).toBe('6281•• 18');
    expect(maskPhone('0812 345')).toBeNull();
  });
});

describe('axisStart and changeRatio', () => {
  it('starts the axis below the lowest balance at a round value, or at the lowest non-positive one', () => {
    expect(axisStart([41_610_000n, 42_810_000n])).toBe(30_000_000n);
    expect(axisStart([136_000n, 86_000n])).toBe(60_000n);
    expect(axisStart([5n])).toBe(3n);
    expect(axisStart([100n, -250n])).toBe(-250n);
    expect(axisStart([])).toBe(0n);
  });

  it('gives the relative change, or null from zero', () => {
    expect(changeRatio(100n, 112n)).toBeCloseTo(0.12);
    expect(changeRatio(-100n, -50n)).toBeCloseTo(0.5);
    expect(changeRatio(0n, 5n)).toBeNull();
  });
});

describe('differenceCategories', () => {
  it('offers categories of the difference’s sign, never archived ones or the FX difference', () => {
    expect(differenceCategories(CATEGORIES, -1n).map((c) => c.builtInKey)).toEqual([
      'system:monthly_admin',
      'system:food',
    ]);
    expect(differenceCategories(CATEGORIES, 1n).map((c) => c.builtInKey)).toEqual(['system:cashback']);
  });
});

describe('accountMeta', () => {
  it('joins type, currency, and the last digits or phone', () => {
    expect(accountMeta(accountView())).toBe('Bank · IDR · •• 4821');
    expect(accountMeta(accountView({ type: 'ewallet', last4: null, phoneMasked: '0812•• 18' }))).toBe(
      'E-Wallet · IDR · 0812•• 18',
    );
    expect(accountMeta(accountView({ type: 'cash', last4: null }))).toBe('Tunai · IDR');
  });
});
