// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { budgetStatus, RECORD_BUDGET } from '../../../test/budget-fixtures.ts';
import { VIEWER } from '../../../test/fake-auth.ts';
import { ACCOUNTS, CATEGORIES, TAGS } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { RecordTransactionProvider } from '../../components/ledger/record-transaction.tsx';
import { Route } from './index.tsx';

const ledger = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  getReferenceRate: vi.fn(),
}));
vi.mock('../../server/fn/ledger.ts', () => ledger);
const budget = vi.hoisted(() => ({ getBudgetStatus: vi.fn() }));
vi.mock('../../server/fn/budget.ts', () => budget);
const writes = vi.hoisted(() => ({
  recordTransaction: vi.fn(),
  removeTransactions: vi.fn(),
  restoreTransactions: vi.fn(),
  listDrafts: vi.fn(),
  saveDraft: vi.fn(),
  removeDraft: vi.fn(),
  listTransactionDays: vi.fn(),
}));
vi.mock('../../server/fn/transactions-write.ts', () => writes);
// The record sheet's "Sesuaikan saldo" action (FR-R4) is not part of these tests.
vi.mock('../../components/accounts/reconcile.tsx', () => ({ useReconcile: () => ({ openReconcile: vi.fn() }) }));

const ACCOUNTS_OK = {
  ok: true,
  value: { baseCurrency: 'IDR', accounts: ACCOUNTS, availableMinor: 0n, missingRates: [] },
};
const CATEGORIES_OK = { ok: true, value: CATEGORIES };
const TAGS_OK = { ok: true, value: TAGS };
const BUDGET_OK = { ok: true, value: budgetStatus({ lines: [...RECORD_BUDGET.lines] }) };
/** Without a budget the Overview works as before, only without category notes. */
const NO_BUDGET = { ok: false, code: 'NOT_FOUND' };

type Loader = () => Promise<unknown>;
const loader = Route.options.loader as unknown as Loader;

async function renderOverview(data: unknown) {
  vi.spyOn(Route, 'useLoaderData').mockReturnValue(data);
  vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: VIEWER });
  const OverviewRoute = Route.options.component as ComponentType;
  const { screen } = await renderApp(
    <RecordTransactionProvider timeZone={VIEWER.timezone}>
      <OverviewRoute />
    </RecordTransactionProvider>,
  );
  return screen;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('/ (Overview)', () => {
  it('loads what the Quick Add bar picks from, with the budget', async () => {
    ledger.listAccounts.mockResolvedValue(ACCOUNTS_OK);
    ledger.listCategories.mockResolvedValue(CATEGORIES_OK);
    ledger.listTags.mockResolvedValue(TAGS_OK);
    budget.getBudgetStatus.mockResolvedValue(BUDGET_OK);
    await expect(loader()).resolves.toEqual({
      accounts: ACCOUNTS_OK,
      categories: CATEGORIES_OK,
      tags: TAGS_OK,
      budget: BUDGET_OK,
    });
    for (const fn of [ledger.listAccounts, ledger.listCategories, ledger.listTags, budget.getBudgetStatus]) {
      expect(fn).toHaveBeenCalledWith({ data: {} });
    }
  });

  it('shows the Quick Add bar once the ledger is loaded, with budget notes when there is a budget', async () => {
    const screen = await renderOverview({
      accounts: ACCOUNTS_OK,
      categories: CATEGORIES_OK,
      tags: TAGS_OK,
      budget: BUDGET_OK,
    });
    const bar = screen.getByRole('form', { name: 'Catat cepat' });
    await expect.element(bar).toBeVisible();
    await userEvent.click(bar.getByRole('button', { name: 'Kategori' }));
    await expect.element(page.getByRole('option', { name: /^Makan & Dapur/ })).toMatchTextContent('sisa Rp300.000');
  });

  it('shows the Quick Add bar without notes when the budget could not be loaded', async () => {
    const screen = await renderOverview({
      accounts: ACCOUNTS_OK,
      categories: CATEGORIES_OK,
      tags: TAGS_OK,
      budget: NO_BUDGET,
    });
    const bar = screen.getByRole('form', { name: 'Catat cepat' });
    await userEvent.click(bar.getByRole('button', { name: 'Kategori' }));
    await expect.element(page.getByRole('option', { name: /^Makan & Dapur/ })).not.toMatchTextContent(/sisa/);
  });

  it.each([
    ['accounts', { accounts: { ok: false, code: 'NOT_FOUND' }, categories: CATEGORIES_OK, tags: TAGS_OK }],
    ['categories', { accounts: ACCOUNTS_OK, categories: { ok: false, code: 'NOT_FOUND' }, tags: TAGS_OK }],
    ['tags', { accounts: ACCOUNTS_OK, categories: CATEGORIES_OK, tags: { ok: false, code: 'NOT_FOUND' } }],
  ])('shows the empty state when the %s could not be loaded', async (_what, data) => {
    const screen = await renderOverview({ ...data, budget: BUDGET_OK });
    await expect.element(screen.getByText('Belum ada data')).toBeVisible();
  });
});
