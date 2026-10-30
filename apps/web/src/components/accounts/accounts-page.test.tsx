// SPDX-License-Identifier: AGPL-3.0-only
import type { AccountsOverview, AccountView } from '@wf/db/accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { accountView, CATEGORIES } from '../../../test/accounts.ts';
import { renderApp } from '../../../test/render.tsx';
import { AccountsPage, type AccountsPageProps } from './accounts-page.tsx';

const fake = vi.hoisted(() => ({
  updateAccount: vi.fn(),
  reorderAccounts: vi.fn(),
  restoreAccount: vi.fn(),
  deleteAccount: vi.fn(),
  openReconcile: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../server/fn/accounts.ts', () => ({
  updateAccount: fake.updateAccount,
  reorderAccounts: fake.reorderAccounts,
  restoreAccount: fake.restoreAccount,
  deleteAccount: fake.deleteAccount,
}));
vi.mock('./reconcile.tsx', () => ({ useReconcile: () => ({ openReconcile: fake.openReconcile }) }));
vi.mock('@wf/ui/toast', () => ({ toast: fake.toast }));
// The dialogs and the panel have their own tests; here they only report which callbacks the page passes.
vi.mock('./account-form.tsx', () => ({
  AccountForm: (props: {
    account?: AccountView;
    defaultType?: string;
    onSaved: (a: AccountView) => void;
    onCancel: () => void;
  }) => (
    <div>
      <p>form {props.account?.displayName ?? props.defaultType}</p>
      <button
        type="button"
        onClick={() => {
          props.onSaved(props.account ?? NEW);
        }}
      >
        stub save
      </button>
      <button type="button" onClick={props.onCancel}>
        stub cancel
      </button>
    </div>
  ),
}));
vi.mock('./account-detail.tsx', () => ({
  AccountDetailPanel: (props: {
    account: AccountView;
    onReconcile: () => void;
    onEdit: () => void;
    onArchive: () => void;
    onToggle: (flag: string, value: boolean) => void;
  }) => (
    <div>
      <p>detail {props.account.displayName}</p>
      <button type="button" onClick={props.onReconcile}>
        stub reconcile
      </button>
      <button type="button" onClick={props.onEdit}>
        stub edit
      </button>
      <button type="button" onClick={props.onArchive}>
        stub archive
      </button>
      <button
        type="button"
        onClick={() => {
          props.onToggle('includeInAvailable', true);
        }}
      >
        stub toggle
      </button>
    </div>
  ),
}));
vi.mock('./archive-dialog.tsx', () => ({
  ArchiveDialog: (props: { account: AccountView; onOpenChange: (o: boolean) => void; onDone: () => void }) => (
    <div role="dialog" aria-label={`archive ${props.account.displayName}`}>
      <button type="button" onClick={props.onDone}>
        stub archive done
      </button>
      <button
        type="button"
        onClick={() => {
          props.onOpenChange(false);
        }}
      >
        stub archive close
      </button>
    </div>
  ),
}));
vi.mock('./bulk-reconcile.tsx', () => ({
  BulkReconcileDialog: (props: { accounts: AccountView[]; onOpenChange: (o: boolean) => void; onDone: () => void }) => (
    <div role="dialog" aria-label={`bulk ${props.accounts.length}`}>
      <button type="button" onClick={props.onDone}>
        stub bulk done
      </button>
    </div>
  ),
}));

const BCA = accountView({
  displayName: 'BCA Tahapan',
  balanceMinor: 42_810_000n,
  balanceBaseMinor: 42_810_000n,
  lastReconciledAt: new Date(),
});
const JAGO = accountView({ displayName: 'Bank Jago', lastReconciledAt: new Date() });
const MANDIRI = accountView({ displayName: 'Mandiri', lastReconciledAt: new Date() });
const OVO = accountView({
  displayName: 'OVO',
  type: 'ewallet',
  last4: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
});
const GOTRADE = accountView({
  displayName: 'Gotrade',
  type: 'investment',
  currency: 'USD',
  includeInAvailable: false,
  balanceBaseMinor: 45_420_300n,
  lastReconciledAt: new Date(),
});
const JENIUS = accountView({ displayName: 'Jenius', status: 'archived', transactionCount: 87 });
const NEW = accountView({ displayName: 'SeaBank' });

function overview(accounts: AccountView[] = [BCA, JAGO, MANDIRI, OVO, GOTRADE, JENIUS]): AccountsOverview {
  return { baseCurrency: 'IDR', accounts, availableMinor: 55_023_000n, missingRates: [] };
}

function wide(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList);
}

async function renderPage(props: Partial<AccountsPageProps> = {}) {
  const onConsumeSearch = vi.fn();
  const result = await renderApp(
    <AccountsPage
      overview={overview()}
      categories={CATEGORIES}
      timeZone="Asia/Jakarta"
      onConsumeSearch={onConsumeSearch}
      {...props}
    />,
  );
  const invalidate = vi.spyOn(result.router, 'invalidate').mockResolvedValue();
  return { ...result, invalidate, onConsumeSearch };
}

beforeEach(async () => {
  wide(true);
  await page.viewport(1440, 900);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('AccountsPage', () => {
  it('shows the totals, the cards, the list, and the first account’s details', async () => {
    const { screen, onConsumeSearch } = await renderPage();
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Rekening & dompet' })).toBeVisible();
    await expect.element(screen.getByText('5 rekening · 4 untuk belanja')).toBeVisible();
    const kpis = screen.getByRole('region', { name: 'Ringkasan rekening' });
    const text = kpis.element().textContent;
    expect(text).toContain('Rp55.023.000');
    expect(text).toContain('dari 4 rekening siap pakai');
    // The investment platform is counted in the total but its own value is not shown here.
    expect(text).not.toContain('≈ Rp45.420.300');
    expect(text).toContain('≈ Rp91.230.300');
    expect(text).toContain('dalam USD');
    expect(text).toContain('kekayaan bersih');
    expect(text).toContain('OVO');
    await expect.element(kpis.getByRole('button', { name: '1 rekening' })).toHaveClass(/text-amber-fg/);
    await expect.element(screen.getByRole('list', { name: 'Kartu rekening' })).toBeVisible();
    await expect
      .element(screen.getByRole('complementary', { name: 'Detail rekening' }).getByText('detail BCA Tahapan'))
      .toBeVisible();
    expect(onConsumeSearch).not.toHaveBeenCalled();
  });

  it('opens the dialogs and reconciles from the panel', async () => {
    const { screen, invalidate } = await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Tambah rekening' }));
    await expect.element(page.getByRole('dialog', { name: 'Rekening baru' }).getByText('form bank')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'stub save' }));
    expect(fake.toast).toHaveBeenCalledWith({ title: 'SeaBank tersimpan' });
    expect(invalidate).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'stub edit' }));
    const edit = page.getByRole('dialog', { name: 'Edit rekening' });
    await expect.element(edit).toHaveAccessibleDescription('BCA Tahapan · 0 transaksi');
    await userEvent.click(page.getByRole('button', { name: 'stub cancel' }));
    await expect.element(edit).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'stub reconcile' }));
    expect(fake.openReconcile).toHaveBeenCalledWith(BCA.id);

    await userEvent.click(screen.getByRole('button', { name: 'stub archive' }));
    await userEvent.click(page.getByRole('button', { name: 'stub archive close' }));
    await userEvent.click(screen.getByRole('button', { name: 'stub archive' }));
    await userEvent.click(page.getByRole('button', { name: 'stub archive done' }));
    await expect.element(page.getByRole('dialog', { name: 'archive BCA Tahapan' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sesuaikan saldo' }));
    await expect.element(page.getByRole('dialog', { name: 'bulk 5' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'stub bulk done' }));
    await userEvent.click(screen.getByRole('button', { name: '1 rekening' }));
    await expect.element(page.getByRole('dialog', { name: 'bulk 5' })).toBeVisible();
  });

  it('folds "Sesuaikan saldo" into ⋯ and keeps the cards readable on a portrait tablet', async () => {
    wide(false);
    await page.viewport(768, 1024);
    const { screen } = await renderPage();
    const header = screen.getByRole('banner');
    await expect
      .element(header.getByRole('button', { name: 'Sesuaikan saldo', includeHidden: true }))
      .not.toBeVisible();
    await expect.element(header.getByRole('button', { name: 'Tambah rekening' })).toBeVisible();
    // The cards keep their width and the strip scrolls rather than squeezing the amounts.
    for (const card of screen.getByRole('list', { name: 'Kartu rekening' }).getByRole('listitem').elements()) {
      expect(card.getBoundingClientRect().width).toBeGreaterThanOrEqual(160);
    }
    await userEvent.click(header.getByRole('button', { name: 'Aksi lainnya' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Sesuaikan saldo' }));
    await expect.element(page.getByRole('dialog', { name: 'bulk 5' })).toBeVisible();
  });

  it('runs the list actions and flags through the server, reporting refusals', async () => {
    fake.updateAccount.mockResolvedValueOnce({ ok: true, value: BCA });
    fake.updateAccount.mockResolvedValueOnce({ ok: false, code: 'TOO_MANY_CARDS' });
    const { screen, invalidate } = await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'stub toggle' }));
    await userEvent.click(screen.getByRole('button', { name: 'Menu Mandiri' }));
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Hitung di saldo tersedia' }));
    await expect.poll(() => fake.toast.mock.calls.length).toBe(1);
    expect(fake.toast).toHaveBeenCalledWith({ title: 'Maksimal 3 rekening ditampilkan sebagai kartu.', tone: 'error' });
    expect(invalidate).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: 'Menu Mandiri' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Edit rekening' }));
    await expect.element(page.getByText('form Mandiri')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'stub cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Menu Mandiri' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Sesuaikan saldo' }));
    expect(fake.openReconcile).toHaveBeenCalledWith(MANDIRI.id);
    await userEvent.click(screen.getByRole('button', { name: 'Menu Mandiri' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Arsipkan' }));
    await expect.element(page.getByRole('dialog', { name: 'archive Mandiri' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'stub archive close' }));

    // Selecting another account and the "N lainnya" card.
    await userEvent.click(screen.getByRole('button', { name: /^Mandiri/ }));
    await expect.element(page.getByText('detail Mandiri')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /1 lainnya/ }));
  });

  it('reorders optimistically and reports a refused order', async () => {
    fake.reorderAccounts.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    fake.reorderAccounts.mockResolvedValueOnce({ ok: true, value: null });
    const { screen } = await renderPage();
    const move = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Seret untuk mengurutkan Mandiri' }));
      await userEvent.keyboard(' ');
      await userEvent.keyboard('{ArrowUp}');
      await userEvent.keyboard(' ');
    };
    await move();
    await expect.poll(() => fake.reorderAccounts.mock.calls.length).toBe(1);
    expect(fake.reorderAccounts).toHaveBeenCalledWith({
      data: { ids: [BCA.id, MANDIRI.id, JAGO.id, OVO.id, GOTRADE.id] },
    });
    await expect.poll(() => fake.toast.mock.calls.length).toBe(1);
    await move();
    await expect.poll(() => fake.reorderAccounts.mock.calls.length).toBe(2);
    expect(fake.toast).toHaveBeenCalledTimes(1);
  });

  it('restores and deletes archived accounts', async () => {
    fake.restoreAccount.mockResolvedValueOnce({ ok: true, value: JENIUS });
    fake.restoreAccount.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    fake.deleteAccount.mockResolvedValueOnce({ ok: true, value: { deletedTransactions: 87 } });
    fake.deleteAccount.mockResolvedValueOnce({ ok: false, code: 'ACCOUNT_NOT_ARCHIVED' });
    const { screen } = await renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Diarsipkan 1/ }));
    await expect.element(screen.getByRole('heading', { name: 'Rekening diarsipkan' })).toBeVisible();
    await expect.element(screen.getByText('Pilih rekening diarsipkan')).toBeVisible();
    await expect.element(screen.getByRole('list', { name: 'Kartu rekening' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pulihkan' }));
    expect(fake.toast).toHaveBeenLastCalledWith({ title: 'Jenius dipulihkan' });
    await userEvent.click(screen.getByRole('button', { name: 'Pulihkan' }));
    await expect.poll(() => fake.toast.mock.calls.length).toBe(2);

    await userEvent.click(screen.getByRole('button', { name: 'Hapus permanen' }));
    const confirm = page.getByRole('alertdialog', { name: 'Hapus Jenius permanen?' });
    await expect.element(confirm).toHaveAccessibleDescription(/87 transaksinya/);
    await userEvent.click(confirm.getByRole('button', { name: 'Hapus permanen' }));
    await expect.poll(() => fake.toast.mock.calls.length).toBe(3);
    expect(fake.toast).toHaveBeenLastCalledWith({ title: 'Jenius dihapus permanen', description: '87 transaksi' });
    await userEvent.click(screen.getByRole('button', { name: 'Hapus permanen' }));
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Hapus permanen' }));
    await expect.poll(() => fake.toast.mock.calls.length).toBe(4);
    expect(fake.toast).toHaveBeenLastCalledWith({
      title: 'Arsipkan rekening ini dulu sebelum menghapusnya permanen.',
      tone: 'error',
    });
    await userEvent.click(screen.getByRole('button', { name: /^Jenius/ }));
    await expect.element(page.getByText('detail Jenius')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Aktif/ }));
  });

  it('puts the details in a Sheet below 1280 px', async () => {
    wide(false);
    const { screen } = await renderPage();
    await expect.element(screen.getByRole('complementary', { name: 'Detail rekening' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^OVO/ }));
    const sheet = page.getByRole('dialog', { name: 'OVO' });
    await expect.element(sheet.getByText('detail OVO')).toBeVisible();
    await userEvent.click(sheet.getByRole('button', { name: 'Tutup' }));
    await expect.element(sheet).not.toBeInTheDocument();
  });

  it('starts with the account or the new-account dialog from the address, then drops the search', async () => {
    wide(false);
    const first = await renderPage({ initialNewType: 'cash' });
    await expect.element(page.getByText('form cash')).toBeVisible();
    expect(first.onConsumeSearch).toHaveBeenCalledTimes(1);
    await first.screen.unmount();
    const second = await renderPage({ initialAccountId: MANDIRI.id });
    await expect.element(page.getByRole('dialog', { name: 'Mandiri' })).toBeVisible();
    expect(second.onConsumeSearch).toHaveBeenCalledTimes(1);
  });

  it('invites a new user to add a first account', async () => {
    const { screen } = await renderPage({ overview: overview([]) });
    await expect.element(screen.getByText('Tambahkan rekening pertamamu')).toBeVisible();
    await expect.element(screen.getByText('Tanpa login bank · tanpa akses mutasi')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Sesuaikan saldo' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tambah dompet tunai' }));
    await expect.element(page.getByText('form cash')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'stub cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tambah rekening' }).last());
    await expect.element(page.getByText('form bank')).toBeVisible();
  });

  it('shows only the archived accounts when nothing is active', async () => {
    const { screen } = await renderPage({ overview: overview([JENIUS]) });
    await expect.element(screen.getByRole('tab', { name: /Diarsipkan 1/ })).toBeVisible();
    await expect.element(screen.getByText('Pilih rekening diarsipkan')).toBeVisible();
  });

  it('shows no stale accounts and no "≈" in a single-currency ledger', async () => {
    const { screen } = await renderPage({ overview: overview([{ ...BCA }]) });
    const text = screen.getByRole('region', { name: 'Ringkasan rekening' }).element().textContent;
    expect(text).toContain('Semua dicek dalam 14 hari');
    expect(text).not.toContain('≈');
  });
});
