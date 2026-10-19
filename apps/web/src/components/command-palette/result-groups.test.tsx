// SPDX-License-Identifier: AGPL-3.0-only
import type { NavigateFn } from '@tanstack/react-router';
import type { LocalDate } from '@wf/domain/period';
import { setLocale } from '@wf/i18n/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import type { AccountHit, CategoryHit, TagHit, TransactionHit } from '../../lib/search.ts';
import { RESULT_GROUPS, type ResultView } from './result-groups.tsx';

const EXPENSE: TransactionHit = {
  id: 'tx-1',
  type: 'expense',
  localDate: '2026-10-14' as LocalDate,
  title: 'Shopee — Rak buku 5 susun',
  amountMinor: -250_000n,
  currency: 'IDR',
  category: { name: 'system:shopping', builtInKey: 'system:shopping' },
  accountId: 'acc-bca',
  accountName: 'BCA Tahapan',
  toAccountName: null,
};
const ACCOUNT: AccountHit = {
  id: 'acc-1',
  displayName: 'BCA Lama',
  providerName: 'Bank Central Asia',
  type: 'bank',
  currency: 'USD',
  balanceMinor: 18_210n,
  archived: true,
};
const CATEGORY: CategoryHit = {
  id: 'cat-1',
  name: 'system:food',
  builtInKey: 'system:food',
  kind: 'expense',
  group: 'needs',
  archived: false,
};
const TAG: TagHit = { id: 'tag-1', slug: 'dana-darurat', usageCount: 3 };

/** A view as text: title | detail | aside (the aside rendered, for `<Money>`). */
async function shown(view: ResultView) {
  const { screen } = await renderApp(<p data-testid="aside">{view.aside}</p>);
  return [view.title, view.detail, screen.getByTestId('aside').element().textContent];
}

// The views call message functions directly; earlier test files may have left another locale.
beforeEach(async () => {
  await setLocale('id', { reload: false });
});

describe('RESULT_GROUPS', () => {
  it('shows transactions with their date, category, account, and amount', async () => {
    const { transactions } = RESULT_GROUPS;
    expect(transactions.heading()).toBe('Transaksi');
    expect(await shown(transactions.view(EXPENSE, 'id'))).toEqual([
      'Shopee — Rak buku 5 susun',
      '14 Okt · Belanja Online · BCA Tahapan',
      '−Rp250.000',
    ]);
    expect(transactions.view({ ...EXPENSE, title: null, category: null }, 'en')).toMatchObject({
      title: 'Tanpa keterangan',
      // The date follows the locale argument; message functions follow the rendered locale.
      detail: 'Oct 14 · Tanpa kategori · BCA Tahapan',
    });
    const transfer = { ...EXPENSE, type: 'transfer', title: null, category: null } as const;
    expect(transactions.view({ ...transfer, toAccountName: 'GoPay' }, 'id')).toMatchObject({
      title: 'Transfer',
      detail: '14 Okt · BCA Tahapan → GoPay',
    });
    expect(transactions.view(transfer, 'id').detail).toBe('14 Okt · BCA Tahapan → ');
  });

  it('shows accounts, categories, and tags', async () => {
    expect(await shown(RESULT_GROUPS.accounts.view(ACCOUNT, 'id'))).toEqual([
      'BCA Lama',
      'Bank Central Asia · Bank · diarsipkan',
      'US$182,10',
    ]);
    expect(RESULT_GROUPS.accounts.view({ ...ACCOUNT, archived: false }, 'id').detail).toBe('Bank Central Asia · Bank');
    expect(RESULT_GROUPS.categories.view(CATEGORY, 'id')).toEqual({ title: 'Makan & Dapur', detail: 'Kebutuhan' });
    expect(RESULT_GROUPS.categories.view({ ...CATEGORY, archived: true }, 'id').detail).toBe('Kebutuhan · diarsipkan');
    expect(RESULT_GROUPS.tags.view(TAG, 'id')).toEqual({ title: '#dana-darurat', detail: 'Dipakai 3×' });
  });

  it('remembers each hit under its recent kind and opens its page', async () => {
    const navigate = vi.fn(() => Promise.resolve()) as unknown as NavigateFn;
    expect(Object.values(RESULT_GROUPS).map((group) => group.recentKind)).toEqual([
      'transaction',
      'account',
      'category',
      'tag',
    ]);
    await RESULT_GROUPS.transactions.open(EXPENSE, navigate);
    await RESULT_GROUPS.accounts.open(ACCOUNT, navigate);
    await RESULT_GROUPS.categories.open(CATEGORY, navigate);
    await RESULT_GROUPS.tags.open(TAG, navigate);
    expect(vi.mocked(navigate).mock.calls).toEqual([[{ to: '/' }], [{ to: '/' }], [{ to: '/' }], [{ to: '/' }]]);
  });
});
