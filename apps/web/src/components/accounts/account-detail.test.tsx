// SPDX-License-Identifier: AGPL-3.0-only
import type { AccountSeriesPoint, AccountView } from '@wf/db/accounts';
import type { TransactionRow } from '@wf/db/transaction-query';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { accountView } from '../../../test/accounts.ts';
import { renderApp } from '../../../test/render.tsx';
import type { AccountDetail } from '../../server/fn/accounts.ts';
import { AccountDetailPanel, type AccountDetailPanelProps } from './account-detail.tsx';

const server = vi.hoisted(() => ({ getAccountDetail: vi.fn() }));
vi.mock('../../server/fn/accounts.ts', () => server);

const BCA = accountView({
  displayName: 'BCA Tahapan',
  balanceMinor: 42_810_000n,
  isDefaultQuickEntry: true,
  showAsCard: true,
  lastReconciledAt: new Date('2026-10-14T05:00:00Z'),
});
const JAGO = accountView({ displayName: 'Bank Jago' });
const FOOD = { id: 'c-food', name: 'system:food', builtInKey: 'system:food', icon: 'utensils', color: 'orange' };

const row = (overrides: Partial<TransactionRow>): TransactionRow =>
  ({
    id: crypto.randomUUID(),
    type: 'expense',
    occurredAt: new Date('2026-10-15T05:41:00Z'),
    localDate: '2026-10-15',
    merchant: null,
    description: null,
    categoryId: null,
    accountId: BCA.id,
    toAccountId: null,
    amountMinor: -28_000n,
    currency: 'IDR',
    receivedMinor: null,
    receivedCurrency: null,
    amountBaseMinor: -28_000n,
    feeMinor: null,
    fxDiffBaseMinor: null,
    tags: [],
    hasAttachment: false,
    hasNote: false,
    source: 'manual',
    splitParentId: null,
    ...overrides,
  }) as TransactionRow;

const point = (month: string, closingBalanceMinor: bigint): AccountSeriesPoint => ({
  month: month as AccountSeriesPoint['month'],
  closingBalanceMinor,
  inflowMinor: 0n,
  outflowMinor: 0n,
});

function detail(overrides: Partial<AccountDetail> = {}): { ok: true; value: AccountDetail } {
  return {
    ok: true,
    value: {
      today: '2026-10-15',
      series: [point('2026-09', 41_610_000n), point('2026-10', 42_810_000n)],
      flows: { inflowMinor: 24_700_000n, outflowMinor: 14_000_000n, transferInMinor: 0n, transferOutMinor: 9_500_000n },
      recent: [],
      categories: [],
      ...overrides,
    } as AccountDetail,
  };
}

async function renderPanel(props: Partial<AccountDetailPanelProps> = {}) {
  const handlers = { onReconcile: vi.fn(), onEdit: vi.fn(), onArchive: vi.fn(), onToggle: vi.fn() };
  const result = await renderApp(
    <AccountDetailPanel
      account={BCA}
      accounts={[BCA, JAGO]}
      timeZone="Asia/Jakarta"
      cardsFull={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...result, ...handlers };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AccountDetailPanel', () => {
  it('shows the balance, this month, the chart, the flows, and the latest transactions', async () => {
    server.getAccountDetail.mockResolvedValue(
      detail({
        recent: [
          row({ merchant: 'Warteg Bahari', categoryId: FOOD.id }),
          row({ description: 'Bayar listrik', amountMinor: -350_000n }),
          row({ categoryId: FOOD.id }),
          row({ type: 'transfer', toAccountId: JAGO.id, amountMinor: -500_000n }),
          row({
            type: 'transfer',
            accountId: JAGO.id,
            toAccountId: BCA.id,
            receivedMinor: 100_000n,
            receivedCurrency: 'IDR',
          }),
          row({ type: 'transfer', accountId: 'gone', toAccountId: BCA.id }),
          row({ type: 'transfer', toAccountId: 'gone' }),
          row({}),
        ],
        categories: [FOOD] as AccountDetail['categories'],
      }),
    );
    const { screen, onReconcile, onEdit, onArchive } = await renderPanel();
    await expect.element(screen.getByRole('heading', { name: 'BCA Tahapan' })).toBeVisible();
    await expect.element(screen.getByText('Bank · IDR · •• 4821')).toBeVisible();
    await expect.element(screen.getByText('Default Catat Cepat')).toBeVisible();
    await expect.element(screen.getByText('+1.200.000')).toBeVisible();
    expect(server.getAccountDetail).toHaveBeenCalledWith({ data: { id: BCA.id } });
    await expect.element(screen.getByRole('img', { name: 'Saldo 6 bulan' })).toBeVisible();
    await expect.element(screen.getByText('+2,88%')).toBeVisible();
    await expect.element(screen.getByText('Rp30.000.000')).toBeVisible();
    await expect.element(screen.getByText('+24.700.000')).toBeVisible();
    await expect.element(screen.getByText('Transfer masuk')).not.toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Transaksi terakhir' });
    await expect
      .element(recent.getByRole('link', { name: 'Lihat semua' }))
      .toHaveAttribute('href', `/transactions?account=${BCA.id}`);
    const titles = recent
      .getByRole('listitem')
      .elements()
      .map((item) => item.querySelector('.truncate')?.textContent);
    expect(titles).toEqual([
      'Warteg Bahari',
      'Bayar listrik',
      'Makan & Dapur',
      'Transfer · Bank Jago',
      'Transfer · Bank Jago',
      'Transfer · —',
      'Transfer · —',
      'Tanpa keterangan',
    ]);
    await expect.element(recent.getByText('+100.000')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Sesuaikan saldo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: /Arsipkan rekening/ }));
    expect([onReconcile, onEdit, onArchive].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('toggles the flags, explaining a full card strip', async () => {
    server.getAccountDetail.mockResolvedValue(
      detail({ flows: { inflowMinor: 0n, outflowMinor: 0n, transferInMinor: 5n, transferOutMinor: 0n } }),
    );
    const account = { ...BCA, showAsCard: false, isDefaultQuickEntry: false } satisfies AccountView;
    const { screen, onToggle } = await renderPanel({ account, cardsFull: true });
    await expect.element(screen.getByText('Transfer masuk')).toBeVisible();
    await expect.element(screen.getByRole('switch', { name: /Tampilkan sebagai kartu/ })).toBeDisabled();
    await expect.element(screen.getByText('Maks 3 rekening jadi kartu')).toBeVisible();
    await userEvent.click(screen.getByRole('switch', { name: /Hitung dalam saldo tersedia/ }));
    await userEvent.click(screen.getByRole('switch', { name: /Default untuk Catat Cepat/ }));
    expect(onToggle.mock.calls).toEqual([
      ['includeInAvailable', false],
      ['isDefaultQuickEntry', true],
    ]);
    await expect.element(screen.getByText('Belum ada transaksi di rekening ini.')).toBeVisible();
  });

  it('toggles the card flag when a slot is free', async () => {
    server.getAccountDetail.mockResolvedValue(detail());
    const { screen, onToggle } = await renderPanel();
    await userEvent.click(screen.getByRole('switch', { name: /Tampilkan sebagai kartu/ }));
    expect(onToggle).toHaveBeenCalledWith('showAsCard', false);
  });

  it('warns about an unchecked account and a low balance', async () => {
    server.getAccountDetail.mockResolvedValue(detail({ series: [point('2026-10', 86_000n)] }));
    const ovo = accountView({
      displayName: 'OVO',
      balanceMinor: 86_000n,
      lowBalanceThresholdMinor: 100_000n,
      lastReconciledAt: new Date('2026-09-11T05:00:00Z'),
    });
    const { screen } = await renderPanel({ account: ovo });
    await expect.element(screen.getByText('Perlu disesuaikan · 34 hari belum dicek')).toBeVisible();
    await expect.element(screen.getByText(/Saldo di bawah batas/)).toBeVisible();
    expect(screen.getByText(/Saldo di bawah batas/).element().textContent).toBe('Saldo di bawah batas Rp100.000');
    await expect.element(screen.getByText('+0%')).not.toBeInTheDocument();
  });

  it('shows each warning on its own', async () => {
    server.getAccountDetail.mockResolvedValue(detail());
    const low = { ...BCA, lowBalanceThresholdMinor: 50_000_000n } satisfies AccountView;
    const first = await renderPanel({ account: low });
    await expect.element(first.screen.getByText(/Saldo di bawah batas/)).toBeVisible();
    await expect.element(first.screen.getByText(/belum dicek/)).not.toBeInTheDocument();
    await first.screen.unmount();
    const stale = {
      ...BCA,
      lowBalanceThresholdMinor: 1n,
      lastReconciledAt: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    } satisfies AccountView;
    const second = await renderPanel({ account: stale });
    await expect.element(second.screen.getByText(/belum dicek/)).toBeVisible();
    await expect.element(second.screen.getByText(/Saldo di bawah batas/)).not.toBeInTheDocument();
  });

  it('shows a falling balance in red and no change from zero', async () => {
    server.getAccountDetail.mockResolvedValue(detail({ series: [point('2026-09', 200n), point('2026-10', 100n)] }));
    const { screen } = await renderPanel();
    await expect.element(screen.getByText('−50,00%')).toHaveClass(/text-red-fg/);
    await screen.unmount();
    server.getAccountDetail.mockResolvedValue(detail({ series: [] }));
    const empty = await renderPanel();
    await expect.element(empty.screen.getByRole('img', { name: 'Saldo 6 bulan' })).toBeVisible();
    expect(empty.screen.container.textContent).not.toContain('%');
  });

  it('shows archived accounts read-only', async () => {
    server.getAccountDetail.mockResolvedValue(detail());
    const archived = { ...BCA, status: 'archived', isDefaultQuickEntry: false, lastReconciledAt: null } as AccountView;
    const { screen } = await renderPanel({ account: archived });
    await expect.element(screen.getByRole('img', { name: 'Saldo 6 bulan' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Sesuaikan saldo' })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('switch')).not.toBeInTheDocument();
    await expect.element(screen.getByText(/Perlu disesuaikan/)).not.toBeInTheDocument();
  });

  it('shows a failure with a retry, and ignores an answer that arrives after switching accounts', async () => {
    server.getAccountDetail.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const { screen } = await renderApp(<Switcher />);
    await expect.element(screen.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
    server.getAccountDetail.mockResolvedValueOnce(detail());
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await expect.element(screen.getByRole('img', { name: 'Saldo 6 bulan' })).toBeVisible();

    const stale = Promise.withResolvers<unknown>();
    server.getAccountDetail.mockReturnValueOnce(stale.promise);
    server.getAccountDetail.mockResolvedValueOnce(
      detail({ recent: [row({ merchant: 'Jago saja', accountId: JAGO.id })] }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'saldo berubah' }));
    await userEvent.click(screen.getByRole('button', { name: 'ganti' }));
    await expect.element(screen.getByText('Jago saja')).toBeVisible();
    stale.resolve(detail({ recent: [row({ merchant: 'Basi' })] }));
    await expect.element(screen.getByText('Basi')).not.toBeInTheDocument();
  });
});

/** Changes the shown account the way the page does. */
function Switcher() {
  const [account, setAccount] = useState<AccountView>(BCA);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAccount({ ...BCA, balanceMinor: 1n });
        }}
      >
        saldo berubah
      </button>
      <button
        type="button"
        onClick={() => {
          setAccount(JAGO);
        }}
      >
        ganti
      </button>
      <AccountDetailPanel
        account={account}
        accounts={[BCA, JAGO]}
        timeZone="Asia/Jakarta"
        cardsFull={false}
        onReconcile={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onToggle={vi.fn()}
      />
    </>
  );
}
