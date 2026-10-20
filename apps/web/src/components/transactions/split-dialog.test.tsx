// SPDX-License-Identifier: AGPL-3.0-only
import type { BudgetStatus } from '@wf/db/budgets';
import type { LocalDate } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, LEDGER, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { posting, RECEIPT, transactionDetail } from '../../../test/transaction-fixtures.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { budgetImpact, evenParts, SplitDialog, type SplitPartDraft } from './split-dialog.tsx';

const server = vi.hoisted(() => ({ getBudgetStatus: vi.fn(), splitTransaction: vi.fn() }));
vi.mock('../../server/fn/budget.ts', () => ({ getBudgetStatus: server.getBudgetStatus }));
vi.mock('../../server/fn/transactions.ts', () => ({ splitTransaction: server.splitTransaction }));

const KOPI = userCategory({ id: 'c-kopi', name: 'Kopi' });
const HOBI = userCategory({ id: 'c-hobi', name: 'Hobi' });
const GAJI = userCategory({ id: 'c-gaji', name: 'Gaji', kind: 'income', group: 'active' });
const ledger = { ...LEDGER, categories: [KOPI, HOBI, GAJI] };

/** Rp465.000 at Tokopedia, 15 Oct 2026, in Kopi. */
const DETAIL = transactionDetail('tx-1', {
  merchant: 'Tokopedia',
  description: 'Belanja',
  categoryId: KOPI.id,
  postings: [posting(BCA.id, -465_000n)],
});

interface Line {
  readonly categoryId: string;
  readonly spentMinor: bigint;
  readonly limitMinor: bigint;
}
const line = (categoryId: string, spentMinor: bigint, limitMinor: bigint): Line => ({
  categoryId,
  spentMinor,
  limitMinor,
});
/** Only the fields the dialog reads; the rest of a budget status does not matter here. */
const status = (lines: Line[], start = '2026-10-01', end = '2026-10-31') =>
  ({ period: { start, end }, lines }) as unknown as BudgetStatus;

afterEach(() => {
  vi.clearAllMocks();
});

async function renderDialog(detail = DETAIL) {
  const onClose = vi.fn();
  const onSplit = vi.fn(() => Promise.resolve());
  const result = await renderApp(<SplitDialog detail={detail} ledger={ledger} onClose={onClose} onSplit={onSplit} />);
  const dialog = page.getByRole('dialog', { name: 'Pisah transaksi' });
  return { ...result, dialog, onClose, onSplit };
}

const part = (key: number, categoryId: string | null, amountMinor: bigint | null): SplitPartDraft => ({
  key,
  categoryId,
  description: '',
  amountMinor,
});

describe('evenParts', () => {
  it('shares the total evenly, with the remainder on the first part', () => {
    expect(evenParts(465_000n, [part(0, KOPI.id, 465_000n), part(1, null, null)])).toEqual([
      part(0, KOPI.id, 232_500n),
      part(1, null, 232_500n),
    ]);
    expect(
      evenParts(100_001n, [part(0, null, 1n), part(1, null, 2n), part(2, null, 3n)]).map((p) => p.amountMinor),
    ).toEqual([33_335n, 33_333n, 33_333n]);
  });
});

describe('budgetImpact', () => {
  it('moves spending from the original category to the parts’, only for lines that change', () => {
    const budget = status([line(KOPI.id, 400_000n, 500_000n), line(HOBI.id, 0n, 100_000n), line('c-other', 1n, 2n)]);
    const parts = [part(0, KOPI.id, 400_000n), part(1, HOBI.id, 65_000n), part(2, null, 1n), part(3, HOBI.id, null)];
    expect(budgetImpact(budget, { categoryId: KOPI.id, amountMinor: 465_000n }, parts)).toEqual([
      { categoryId: KOPI.id, limitMinor: 500_000n, beforeMinor: 400_000n, afterMinor: 335_000n },
      { categoryId: HOBI.id, limitMinor: 100_000n, beforeMinor: 0n, afterMinor: 65_000n },
    ]);
    // An uncategorized original only adds.
    expect(budgetImpact(budget, { categoryId: null, amountMinor: 1n }, [part(0, HOBI.id, 5n)])).toEqual([
      { categoryId: HOBI.id, limitMinor: 100_000n, beforeMinor: 0n, afterMinor: 5n },
    ]);
  });
});

describe('SplitDialog', () => {
  it('splits an expense into parts that add up, previewing the budgets they change', async () => {
    server.getBudgetStatus.mockResolvedValue({
      ok: true,
      value: status([line(KOPI.id, 400_000n, 500_000n), line(HOBI.id, 80_000n, 100_000n)]),
    });
    server.splitTransaction.mockResolvedValue({ ok: true, value: {} });
    const { dialog, onSplit } = await renderDialog();
    await expect.element(dialog).toHaveAccessibleDescription(/^Tokopedia — Belanja · .+ · BCA Tahapan$/);
    await expect.element(dialog.getByText('−Rp465.000')).toBeVisible();
    const state = dialog.getByRole('status');
    await expect.element(state).toMatchTextContent('Sisa Rp0 · pas');
    await expect.element(dialog.getByText('Tag ikut ke semua bagian.', { exact: false })).toBeVisible();
    const submit = dialog.getByRole('button', { name: 'Pisah jadi 2' });
    await expect.element(submit).toBeDisabled();
    expect(server.getBudgetStatus).toHaveBeenCalledWith({ data: {} });

    await userEvent.fill(dialog.getByRole('textbox', { name: 'Jumlah bagian 2' }), '65.000');
    await expect.element(state).toMatchTextContent(/^Lebih/);
    await expect.element(state.getByText('Rp65.000')).toBeVisible();
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Jumlah bagian 1' }), '300.000');
    await expect.element(state).toMatchTextContent(/^Sisa/);
    await expect.element(state.getByText('Rp100.000')).toBeVisible();
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Jumlah bagian 1' }), '400.000');
    await expect.element(state).toMatchTextContent('Sisa Rp0 · pas');
    await expect.element(submit).toBeDisabled();

    await userEvent.click(dialog.getByRole('button', { name: 'Kategori bagian 2' }));
    await userEvent.click(page.getByRole('option', { name: 'Hobi' }));
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Keterangan bagian 1' }), '  Kopi bubuk ');
    const impact = dialog.getByRole('region', { name: 'Setelah dipisah' });
    await expect.poll(() => impact.getByRole('listitem').all()).toHaveLength(2);
    const kopi = impact.getByRole('listitem').nth(0);
    await expect.element(kopi).toMatchTextContent(/^Kopi/);
    await expect.element(kopi.getByText('Rp335.000')).toHaveClass('font-semibold');
    await expect.element(kopi.getByText('Rp335.000')).not.toHaveClass('text-red-fg');
    // Hobi goes over its limit: Rp80.000 → Rp145.000 / Rp100.000.
    await expect.element(impact.getByRole('listitem').nth(1).getByText('Rp145.000')).toHaveClass('text-red-fg');

    await userEvent.click(submit);
    expect(server.splitTransaction).toHaveBeenCalledWith({
      data: {
        id: 'tx-1',
        clientId: expect.any(String) as unknown,
        parts: [
          { amountMinor: 400_000n, categoryId: KOPI.id, description: 'Kopi bubuk' },
          { amountMinor: 65_000n, categoryId: HOBI.id, description: null },
        ],
      },
    });
    expect(onSplit).toHaveBeenCalledWith(2);
  });

  it('adds parts with what is left, removes them down to two, and splits evenly', async () => {
    server.getBudgetStatus.mockResolvedValue({ ok: false, code: 'INTERNAL' });
    const { dialog } = await renderDialog();
    const add = dialog.getByRole('button', { name: 'Tambah bagian' });
    // Nothing is left: the new part starts empty.
    await userEvent.click(add);
    await expect.element(dialog.getByRole('textbox', { name: 'Jumlah bagian 3' })).toHaveValue('');
    await expect.element(dialog.getByRole('button', { name: 'Hapus bagian 1' })).toBeEnabled();
    await userEvent.click(dialog.getByRole('button', { name: 'Hapus bagian 3' }));
    await expect.element(dialog.getByRole('button', { name: 'Hapus bagian 1' })).toBeDisabled();
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Jumlah bagian 1' }), '400.000');
    // Rp65.000 left: the new part takes it.
    await userEvent.click(add);
    await expect.element(dialog.getByRole('textbox', { name: 'Jumlah bagian 3' })).toHaveValue('65.000');
    await userEvent.click(dialog.getByRole('button', { name: 'Bagi rata' }));
    await expect.element(dialog.getByRole('textbox', { name: 'Jumlah bagian 1' })).toHaveValue('155.000');
    await expect.element(dialog.getByRole('textbox', { name: 'Jumlah bagian 3' })).toHaveValue('155.000');
    await expect.element(dialog.getByRole('button', { name: 'Pisah jadi 3' })).toBeVisible();
    for (let count = 3; count < 10; count++) await userEvent.click(add);
    await expect.element(dialog.getByRole('textbox', { name: 'Jumlah bagian 10' })).toBeVisible();
    await expect.element(add).toBeDisabled();
    await expect.element(dialog.getByRole('region', { name: 'Setelah dipisah' })).not.toBeInTheDocument();
  });

  it('shows why splitting failed, and does not close while splitting', async () => {
    server.getBudgetStatus.mockResolvedValue({ ok: true, value: status([line(KOPI.id, 0n, 1n)], '2026-11-01') });
    const split = Promise.withResolvers<{ ok: false; code: string }>();
    server.splitTransaction.mockReturnValue(split.promise);
    const { dialog, onClose, onSplit } = await renderDialog();
    await userEvent.click(dialog.getByRole('button', { name: 'Bagi rata' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Kategori bagian 2' }));
    await userEvent.click(page.getByRole('option', { name: 'Hobi' }));
    // The budget is of another period: no preview.
    await expect.element(dialog.getByRole('region', { name: 'Setelah dipisah' })).not.toBeInTheDocument();
    const submit = dialog.getByRole('button', { name: 'Pisah jadi 2' });
    await userEvent.click(submit);
    await expect.element(submit).toHaveAttribute('aria-busy', 'true');
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    split.resolve({ ok: false, code: 'PERIOD_CLOSED' });
    await expect.element(dialog.getByRole('alert')).toMatchTextContent(ledgerErrorMessage('PERIOD_CLOSED', 'id'));
    expect(onSplit).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(onClose).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('ignores a budget of a period that ended before the transaction', async () => {
    server.getBudgetStatus.mockResolvedValue({
      ok: true,
      value: status([line(KOPI.id, 0n, 1n)], '2026-09-01', '2026-09-30'),
    });
    const { dialog } = await renderDialog();
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Jumlah bagian 1' }), '1');
    await expect.element(dialog.getByRole('status')).toMatchTextContent(/^Sisa/);
    await expect.element(dialog.getByRole('region', { name: 'Setelah dipisah' })).not.toBeInTheDocument();
  });

  it('previews a budget line of a category the ledger no longer lists', async () => {
    server.getBudgetStatus.mockResolvedValue({ ok: true, value: status([line('c-gone', 50_000n, 100_000n)]) });
    const { dialog } = await renderDialog({ ...DETAIL, categoryId: 'c-gone' });
    await userEvent.click(dialog.getByRole('button', { name: 'Kategori bagian 1' }));
    await userEvent.click(page.getByRole('option', { name: 'Hobi' }));
    const item = dialog.getByRole('region', { name: 'Setelah dipisah' }).getByRole('listitem');
    await expect.element(item).toBeVisible();
    await expect.element(item.getByText('−Rp415.000')).toBeVisible();
  });

  it('splits an income without a budget preview, with attachments going along', async () => {
    const detail = transactionDetail('tx-2', {
      type: 'income',
      merchant: null,
      description: null,
      categoryId: GAJI.id,
      postings: [posting('acc-gone', 1_000_000n)],
      attachments: [RECEIPT],
      localDate: '2026-10-15' as LocalDate,
    });
    const { dialog } = await renderDialog(detail);
    await expect.element(dialog).toHaveAccessibleDescription(/^[^·]+$/);
    await expect.element(dialog.getByText('Tag, struk, dan gambar ikut', { exact: false })).toBeVisible();
    await expect.element(dialog.getByText('Rp1.000.000')).toBeVisible();
    expect(server.getBudgetStatus).not.toHaveBeenCalled();
  });

  it('drops a budget that arrives after closing', async () => {
    const budget = Promise.withResolvers<unknown>();
    server.getBudgetStatus.mockReturnValue(budget.promise);
    const { screen } = await renderDialog();
    await screen.unmount();
    budget.resolve({ ok: true, value: status([line(KOPI.id, 0n, 1n)]) });
    await budget.promise;
  });
});
