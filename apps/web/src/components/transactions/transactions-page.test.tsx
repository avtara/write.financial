// SPDX-License-Identifier: AGPL-3.0-only
import type * as RouterModule from '@tanstack/react-router';
import type { LocalDate } from '@wf/domain/period';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, JAGO, LEDGER } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionsView } from '../../../test/transaction-fixtures.ts';
import type { TransactionsSearch } from '../../lib/transactions-search.ts';
import type { TransactionsView } from '../../server/fn/transactions.ts';
import { TransactionsPage } from './transactions-page.tsx';

const fake = vi.hoisted(() => ({ record: vi.fn(), loading: false, table: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => ({ open: fake.record }) }));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const router = await importOriginal<typeof RouterModule>();
  return {
    ...router,
    // The page asks only whether the route is reloading.
    useRouterState: (options: Parameters<typeof router.useRouterState>[0]) =>
      fake.loading ? true : router.useRouterState(options),
  };
});
// The real table module (loaded below) imports these; in the browser they must never reach the server.
vi.mock('../../server/fn/transactions.ts', () => ({ listTransactionRows: vi.fn(), saveTablePrefs: vi.fn() }));
/**
 * The table, filters, detail, and actions are tested on their own; here they show what they were given. The table's
 * real module is still loaded: in browser mode a module mocked without loading it leaves its import statement
 * uncovered in the merged coverage of its own test.
 */
vi.mock('./transactions-table.tsx', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TransactionsTable: (props: {
    selectedId?: string;
    busy: boolean;
    onOpen: (id: string) => void;
    filters: ReactNode;
  }) => {
    fake.table(props);
    return (
      <section aria-label="table" aria-busy={props.busy} data-selected={props.selectedId ?? 'none'}>
        <button
          type="button"
          onClick={() => {
            props.onOpen('tx-2');
          }}
        >
          open row
        </button>
        {props.filters}
      </section>
    );
  },
}));
vi.mock('./transaction-filters.tsx', () => ({ TransactionFilters: () => <div>filters</div>, NoResults: () => null }));
vi.mock('./transaction-detail.tsx', () => ({
  TransactionDetailPanel: (props: { id: string; variant: string; onClose: () => void }) => (
    <div data-testid="detail" data-variant={props.variant}>
      detail {props.id}
      <button type="button" onClick={props.onClose}>
        close detail
      </button>
    </div>
  ),
}));
vi.mock('./transaction-actions.tsx', () => ({
  useTransactionActions: () => ({}),
  TransactionActionsProvider: (props: {
    onRemoved: (ids: readonly string[]) => void;
    onOpen: (id: string) => void;
    children: ReactNode;
  }) => (
    <>
      <button
        type="button"
        onClick={() => {
          props.onRemoved(['tx-1']);
        }}
      >
        removed tx-1
      </button>
      <button
        type="button"
        onClick={() => {
          props.onOpen('tx-copy');
        }}
      >
        open copy
      </button>
      {props.children}
    </>
  ),
}));

const TX = '0192a6c4-0000-7000-8000-0000000000b1';

async function renderPage(search: TransactionsSearch = {}, view: TransactionsView = transactionsView([])) {
  const onSearchChange = vi.fn();
  const result = await renderApp(
    <TransactionsPage
      view={view}
      search={search}
      ledger={LEDGER}
      available={48_146_000n}
      timeZone="Asia/Jakarta"
      onSearchChange={onSearchChange}
    />,
  );
  return { ...result, onSearchChange };
}

beforeEach(async () => {
  await page.viewport(1440, 900);
});

afterEach(() => {
  fake.loading = false;
  vi.clearAllMocks();
});

describe('TransactionsPage', () => {
  it('shows the header, summary, accounts, and table, and records a transaction', async () => {
    const view = transactionsView([], {
      accounts: [{ accountId: BCA.id, count: 128, inMinor: 0n, outMinor: 0n }],
      page: { rows: [], total: 128, balances: null },
    });
    const { screen, onSearchChange } = await renderPage({}, view);
    await expect.element(screen.getByRole('heading', { name: 'Transaksi', level: 1 })).toBeVisible();
    await expect.element(screen.getByText('128 transaksi di 1 rekening · 1–15 Okt')).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Ringkasan transaksi' })).toBeVisible();
    await expect.element(screen.getByText('Memperbarui transaksi…')).not.toBeInTheDocument();
    await expect.element(screen.getByRole('region', { name: 'table' })).toHaveAttribute('aria-busy', 'false');
    await expect.element(screen.getByRole('region', { name: 'table' })).toHaveAttribute('data-selected', 'none');
    await expect.element(screen.getByText('filters')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Catat Transaksi/ }));
    expect(fake.record).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'open row' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ tx: 'tx-2' });
    await userEvent.click(screen.getByRole('button', { name: 'open copy' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ tx: 'tx-copy' });
    await userEvent.click(screen.getByRole('button', { name: /BCA Visa/ }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ account: 'acc-card' });
    // Nothing open: a delete closes nothing.
    await userEvent.click(screen.getByRole('button', { name: 'removed tx-1' }));
    expect(onSearchChange).toHaveBeenCalledTimes(3);
  });

  it('shows the detail beside the table from 1280 px, closing it after its deletion', async () => {
    const { screen, onSearchChange } = await renderPage({ tx: 'tx-1' });
    const aside = screen.getByRole('complementary', { name: 'Detail transaksi' });
    await expect.element(aside.getByTestId('detail')).toHaveAttribute('data-variant', 'aside');
    await expect.element(aside).toMatchTextContent(/detail tx-1/);
    await expect.element(screen.getByRole('region', { name: 'table' })).toHaveAttribute('data-selected', 'tx-1');
    await userEvent.click(screen.getByRole('button', { name: 'close detail' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ tx: undefined });
    onSearchChange.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'removed tx-1' }));
    expect(onSearchChange).toHaveBeenCalledWith({ tx: undefined });
  });

  it('keeps another open detail after a deletion', async () => {
    const { screen, onSearchChange } = await renderPage({ tx: TX });
    await userEvent.click(screen.getByRole('button', { name: 'removed tx-1' }));
    expect(onSearchChange).not.toHaveBeenCalled();
  });

  it('shows the detail in a sheet below 1280 px', async () => {
    await page.viewport(1024, 800);
    const { screen, onSearchChange } = await renderPage({ tx: 'tx-1' });
    await expect.element(screen.getByRole('complementary', { name: 'Detail transaksi' })).not.toBeInTheDocument();
    const sheet = page.getByRole('dialog', { name: 'Detail transaksi' });
    await expect.element(sheet.getByTestId('detail')).toHaveAttribute('data-variant', 'sheet');
    await userEvent.keyboard('{Escape}');
    expect(onSearchChange).toHaveBeenCalledWith({ tx: undefined });
  });

  it('has no sheet below 1280 px without an open transaction', async () => {
    await page.viewport(1024, 800);
    await renderPage();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('says when the route reloads, and names a filtered account', async () => {
    fake.loading = true;
    const view = transactionsView([], { page: { rows: [], total: 49, balances: null } });
    const { screen } = await renderPage({ account: `${JAGO.id},acc-gone` }, view);
    const status = screen.getByRole('status').filter({ hasText: 'Memperbarui transaksi…' });
    await expect.element(status).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'table' })).toHaveAttribute('aria-busy', 'true');
    // An overlay over the table's top edge: the note is out of the flow, so the page does not move.
    expect(status.element().parentElement?.parentElement?.className).toContain('absolute');
    await expect.element(screen.getByText('Difilter: Bank Jago · 49 transaksi · 1–15 Okt')).toBeVisible();
  });

  it('ends the dates at the range’s end outside the current period', async () => {
    const past = transactionsView([], {
      period: null,
      from: '2026-09-01' as LocalDate,
      to: '2026-09-30' as LocalDate,
    });
    const { screen } = await renderPage({}, past);
    await expect.element(screen.getByText('0 transaksi di 0 rekening · 1–30 Sep')).toBeVisible();
    await screen.unmount();
    const future = transactionsView([], { from: '2026-10-16' as LocalDate, to: '2026-10-31' as LocalDate });
    const later = await renderPage({}, future);
    await expect.element(later.screen.getByText('0 transaksi di 0 rekening · 16–31 Okt')).toBeVisible();
    await later.screen.unmount();
    const current = transactionsView([], { to: '2026-10-31' as LocalDate });
    const now = await renderPage({}, current);
    await expect.element(now.screen.getByText('0 transaksi di 0 rekening · 1–15 Okt')).toBeVisible();
  });

  it('greets a first-time user with the empty state', async () => {
    const { screen } = await renderPage({}, transactionsView([], { hasTransactions: false }));
    await expect.element(screen.getByText('Belum ada transaksi')).toBeVisible();
    await expect.element(screen.getByText(/tidak pernah meminta login bank/)).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'table' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Catat transaksi', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: /Catat Transaksi N/ }));
    expect(fake.record).toHaveBeenCalledTimes(2);
  });
});
