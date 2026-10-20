// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ACCOUNTS, ARCHIVED, LEDGER } from '../../test/ledger-fixtures.ts';
import { renderApp } from '../../test/render.tsx';
import { RecordTransactionProvider } from './ledger/record-transaction.tsx';
import type { LedgerData } from './ledger/use-transaction-form.ts';
import { OverviewPage } from './overview-page.tsx';

const ledger = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  getReferenceRate: vi.fn(),
}));
vi.mock('../server/fn/ledger.ts', () => ledger);
const writes = vi.hoisted(() => ({
  recordTransaction: vi.fn(),
  removeTransactions: vi.fn(),
  restoreTransactions: vi.fn(),
  listDrafts: vi.fn(),
  saveDraft: vi.fn(),
  removeDraft: vi.fn(),
  listTransactionDays: vi.fn(),
}));
vi.mock('../server/fn/transactions-write.ts', () => writes);
vi.mock('../server/fn/budget.ts', () => ({
  getBudgetStatus: () => Promise.resolve({ ok: false, code: 'NOT_FOUND' }),
}));
// The record sheet's "Sesuaikan saldo" action (FR-R4) is not part of these tests.
vi.mock('./accounts/reconcile.tsx', () => ({ useReconcile: () => ({ openReconcile: vi.fn() }) }));

function renderOverview(data: LedgerData | null, locale: 'id' | 'en' = 'id') {
  return renderApp(
    <RecordTransactionProvider timeZone="Asia/Jakarta">
      <OverviewPage ledger={data} timeZone="Asia/Jakarta" />
    </RecordTransactionProvider>,
    { preferences: { locale } },
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('OverviewPage', () => {
  it('greets and shows the empty state while the ledger could not be loaded', async () => {
    const { screen } = await renderOverview(null);
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
    await expect
      .element(screen.getByRole('navigation', { name: 'Jejak halaman' }))
      .toHaveTextContent('KeuanganRingkasan');
    await expect.element(screen.getByText('Belum ada data')).toBeVisible();
    await expect.element(screen.getByText('Tambahkan rekening pertamamu untuk mulai.')).toBeVisible();
    expect(screen.getByRole('button', { name: /Catat Transaksi/ }).query()).toBeNull();
  });

  it('shows the empty state without an active account', async () => {
    const { screen } = await renderOverview({ ...LEDGER, accounts: [ARCHIVED] });
    await expect.element(screen.getByText('Belum ada data')).toBeVisible();
    expect(screen.getByRole('form', { name: 'Catat cepat' }).query()).toBeNull();
  });

  it('offers the Quick Add bar and "Catat Transaksi" (N), which opens the sheet', async () => {
    ledger.listAccounts.mockResolvedValue({
      ok: true,
      value: { baseCurrency: 'IDR', accounts: ACCOUNTS, availableMinor: 0n, missingRates: [] },
    });
    ledger.listCategories.mockResolvedValue({ ok: true, value: LEDGER.categories });
    ledger.listTags.mockResolvedValue({ ok: true, value: LEDGER.tags });
    writes.listDrafts.mockResolvedValue({ ok: true, value: [] });
    const { screen } = await renderOverview(LEDGER);
    await expect.element(screen.getByRole('form', { name: 'Catat cepat' })).toBeVisible();
    expect(screen.getByText('Belum ada data').query()).toBeNull();
    const open = screen.getByRole('button', { name: 'Catat Transaksi N' });
    await userEvent.click(open);
    await expect.element(page.getByRole('dialog', { name: 'Catat Transaksi' })).toBeVisible();
    expect(ledger.listAccounts).toHaveBeenCalledOnce();
  });

  it('renders in English', async () => {
    const { screen } = await renderOverview(null, 'en');
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible();
    await expect.element(screen.getByText('No data yet')).toBeVisible();
  });
});
