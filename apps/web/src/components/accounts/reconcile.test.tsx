// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { toLocalDate } from '@wf/ui/dates';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { accountView, CATEGORIES } from '../../../test/accounts.ts';
import { renderApp } from '../../../test/render.tsx';
import {
  MissingReconcileProviderError,
  occurredAtFor,
  ReconcileDialog,
  ReconcileProvider,
  useReconcile,
} from './reconcile.tsx';

const server = vi.hoisted(() => ({
  reconcileAccount: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../server/fn/accounts.ts', () => ({ reconcileAccount: server.reconcileAccount }));
vi.mock('../../server/fn/ledger.ts', () => ({
  listAccounts: server.listAccounts,
  listCategories: server.listCategories,
}));
vi.mock('@wf/ui/toast', () => ({ toast: server.toast }));

const BCA = accountView({
  displayName: 'BCA Tahapan',
  balanceMinor: 42_810_000n,
  lastReconciledAt: new Date('2026-10-01T05:00:00Z'),
});

async function renderDialog(account = BCA) {
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  const result = await renderApp(
    <ReconcileDialog
      account={account}
      categories={CATEGORIES}
      timeZone="Asia/Jakarta"
      onOpenChange={onOpenChange}
      onDone={onDone}
    />,
  );
  const dialog = page.getByRole('dialog', { name: 'Sesuaikan saldo' });
  return { ...result, dialog, onOpenChange, onDone, actual: dialog.getByRole('textbox', { name: 'Saldo sebenarnya' }) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('helpers', () => {
  it('records today at the current instant and earlier days at midday UTC', () => {
    const now = new Date('2026-10-15T12:40:00Z');
    const today = '2026-10-15' as LocalDate;
    expect(occurredAtFor(today, today, now)).toBe(now);
    expect(occurredAtFor('2026-10-01' as LocalDate, today, now)).toEqual(new Date('2026-10-01T12:00:00Z'));
  });
});

describe('ReconcileDialog', () => {
  it('records a shortfall as a categorized expense, defaulting to the monthly fee', async () => {
    server.reconcileAccount.mockResolvedValue({ ok: true, value: { differenceMinor: -15_000n } });
    const { dialog, actual, onDone } = await renderDialog();
    await expect.element(dialog).toHaveAccessibleDescription('BCA Tahapan · samakan dengan saldo di aplikasi bank');
    await expect.element(dialog.getByText('Rp42.810.000')).toBeVisible();
    await expect.element(dialog.getByText(/Terakhir disesuaikan/)).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Sesuaikan' })).toBeDisabled();
    await userEvent.fill(actual, '42.795.000');
    const status = dialog.getByRole('status');
    await expect.element(status).toBeVisible();
    expect(status.element().textContent).toBe(
      'Selisih −Rp15.000write.financial mencatat Rp15.000 lebih banyak dari saldo bank',
    );
    await expect.element(dialog.getByRole('radio', { name: /Catat sebagai pengeluaran/ })).toBeChecked();
    await expect.element(dialog.getByRole('combobox', { name: 'Kategori' })).toHaveTextContent('Admin bulanan');
    await userEvent.click(dialog.getByRole('button', { name: 'Sesuaikan' }));
    expect(server.reconcileAccount).toHaveBeenCalledWith({
      data: {
        id: BCA.id,
        mode: 'transaction',
        actualBalanceMinor: 42_795_000n,
        categoryId: CATEGORIES[0]?.id,
        clientId: expect.any(String) as unknown,
        occurredAt: expect.any(Date) as unknown,
      },
    });
    expect(server.toast).toHaveBeenCalledWith({ title: 'Saldo BCA Tahapan disesuaikan' });
    expect(onDone).toHaveBeenCalled();
  });

  it('records a correction without a transaction, and shows a refusal', async () => {
    server.reconcileAccount.mockResolvedValue({ ok: false, code: 'ACCOUNT_ARCHIVED' });
    const { dialog, actual, onDone } = await renderDialog();
    await userEvent.fill(actual, '42.795.000');
    await userEvent.click(dialog.getByRole('radio', { name: /Koreksi tanpa transaksi/ }));
    await expect.element(dialog.getByRole('combobox', { name: 'Kategori' })).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Sesuaikan' }));
    expect(server.reconcileAccount).toHaveBeenCalledWith({
      data: { id: BCA.id, mode: 'correction', actualBalanceMinor: 42_795_000n },
    });
    await expect.element(dialog.getByText('Rekening ini sudah diarsipkan.')).toBeVisible();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('asks for an income category for a surplus, on a chosen date', async () => {
    server.reconcileAccount.mockResolvedValue({ ok: true, value: {} });
    const { dialog, actual } = await renderDialog({ ...BCA, lastReconciledAt: null });
    await expect.element(dialog.getByText(/Terakhir disesuaikan/)).not.toBeInTheDocument();
    await userEvent.fill(actual, '42.900.000');
    await expect.element(dialog.getByRole('status')).toBeVisible();
    expect(dialog.getByRole('status').element().textContent).toContain('Rp90.000 lebih sedikit dari saldo bank');
    await expect.element(dialog.getByRole('radio', { name: /Catat sebagai pemasukan/ })).toBeChecked();
    const submit = dialog.getByRole('button', { name: 'Sesuaikan' });
    await expect.element(submit).toBeDisabled();
    await userEvent.click(dialog.getByRole('combobox', { name: 'Kategori' }));
    await userEvent.click(page.getByRole('option', { name: 'Cashback & refund' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Tanggal' }));
    await userEvent.click(page.getByRole('button', { name: / 1 Oktober 2026/ }));
    await userEvent.click(submit);
    expect(server.reconcileAccount).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mode: 'transaction',
        actualBalanceMinor: 42_900_000n,
        categoryId: CATEGORIES[2]?.id,
        occurredAt: new Date('2026-10-01T12:00:00Z'),
      }) as unknown,
    });
  });

  it('marks a matching balance as checked', async () => {
    server.reconcileAccount.mockResolvedValue({ ok: true, value: {} });
    const { dialog, actual, onOpenChange } = await renderDialog();
    await userEvent.fill(actual, '42.810.000');
    await expect.element(dialog.getByText(/Saldo sudah sama/)).toBeVisible();
    await expect.element(dialog.getByRole('radio')).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Sesuaikan' }));
    expect(server.reconcileAccount).toHaveBeenCalledWith({
      data: { id: BCA.id, mode: 'correction', actualBalanceMinor: 42_810_000n },
    });
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('submits nothing before an amount, or without a category when there is no default', async () => {
    const onOpenChange = vi.fn();
    await renderApp(
      <ReconcileDialog
        account={BCA}
        categories={CATEGORIES.slice(1)}
        timeZone="Asia/Jakarta"
        onOpenChange={onOpenChange}
        onDone={vi.fn()}
      />,
    );
    const dialog = page.getByRole('dialog', { name: 'Sesuaikan saldo' });
    const form = dialog.element().querySelector('form');
    form?.requestSubmit();
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Saldo sebenarnya' }), '42.795.000');
    await expect.element(dialog.getByRole('combobox', { name: 'Kategori' })).toHaveTextContent('Kategori');
    await expect.element(dialog.getByRole('button', { name: 'Sesuaikan' })).toBeDisabled();
    form?.requestSubmit();
    expect(server.reconcileAccount).not.toHaveBeenCalled();
  });

  it('looks for missed transactions since the last reconciliation, closing the dialog', async () => {
    const today = toLocalDate(new Date(), 'Asia/Jakarta');
    const { dialog, actual, router, onOpenChange } = await renderDialog();
    await userEvent.fill(actual, '42.795.000');
    const missed = dialog.getByRole('button', { name: /Ada transaksi yang terlewat/ });
    await expect
      .element(missed)
      .toMatchTextContent('Buka daftar transaksi BCA Tahapan sejak 1 Okt untuk dicatat manual');
    await userEvent.click(missed);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await expect.poll(() => router.state.location.pathname).toBe('/transactions');
    expect(router.state.location.search).toEqual({ account: BCA.id, range: `2026-10-01..${today}` });
  });

  it('looks for missed transactions since the start of the month when never reconciled', async () => {
    const today = toLocalDate(new Date(), 'Asia/Jakarta');
    const { dialog, actual, router } = await renderDialog({ ...BCA, lastReconciledAt: null });
    await userEvent.fill(actual, '42.900.000');
    await userEvent.click(dialog.getByRole('button', { name: /Ada transaksi yang terlewat/ }));
    await expect.poll(() => router.state.location.pathname).toBe('/transactions');
    expect(router.state.location.search).toEqual({ account: BCA.id, range: `${today.slice(0, 8)}01..${today}` });
  });
});

function Opener({ id }: { id: string }) {
  const { openReconcile } = useReconcile();
  return (
    <button
      type="button"
      onClick={() => {
        openReconcile(id);
      }}
    >
      buka
    </button>
  );
}

describe('ReconcileProvider', () => {
  const overview = (accounts = [BCA]) => ({
    ok: true,
    value: { baseCurrency: 'IDR', accounts, availableMinor: 0n, missingRates: [] },
  });

  it('opens the dialog for an account from anywhere and refreshes the page after saving', async () => {
    server.listAccounts.mockResolvedValue(overview());
    server.listCategories.mockResolvedValue({ ok: true, value: CATEGORIES });
    server.reconcileAccount.mockResolvedValue({ ok: true, value: {} });
    const { screen, router } = await renderApp(
      <ReconcileProvider timeZone="Asia/Jakarta">
        <Opener id={BCA.id} />
      </ReconcileProvider>,
    );
    const invalidate = vi.spyOn(router, 'invalidate');
    await userEvent.click(screen.getByRole('button', { name: 'buka' }));
    const dialog = page.getByRole('dialog', { name: 'Sesuaikan saldo' });
    await expect.element(dialog).toBeVisible();
    expect(server.listAccounts).toHaveBeenCalledWith({ data: { status: 'active' } });
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'buka' }));
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Saldo sebenarnya' }), '42.810.000');
    await userEvent.click(dialog.getByRole('button', { name: 'Sesuaikan' }));
    await expect.element(dialog).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalled();
  });

  it('explains why the dialog cannot open', async () => {
    const { screen } = await renderApp(
      <ReconcileProvider timeZone="Asia/Jakarta">
        <Opener id="missing" />
      </ReconcileProvider>,
    );
    const open = screen.getByRole('button', { name: 'buka' });
    for (const [accounts, categories, title] of [
      [overview(), { ok: true, value: [] }, 'Data ini sudah tidak ada. Muat ulang halaman.'],
      [{ ok: false, code: 'UNAUTHENTICATED' }, { ok: true, value: [] }, 'Sesimu sudah berakhir. Masuk lagi.'],
      [overview(), { ok: false, code: 'FX_RATE_MISSING' }, 'Kurs untuk mata uang ini belum tersedia. Isi kurs manual.'],
    ] as const) {
      server.listAccounts.mockResolvedValueOnce(accounts);
      server.listCategories.mockResolvedValueOnce(categories);
      server.toast.mockClear();
      await userEvent.click(open);
      await expect.poll(() => server.toast.mock.calls.length).toBe(1);
      expect(server.toast).toHaveBeenCalledWith({ title, tone: 'error' });
    }
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses to work outside the provider', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Opener id="x" />)).rejects.toThrow(MissingReconcileProviderError);
    errors.mockRestore();
  });
});
