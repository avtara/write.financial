// SPDX-License-Identifier: AGPL-3.0-only
import type { BudgetStatus } from '@wf/db/budgets';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { budgetStatus, FOOD, periodsOverview, SEPTEMBER, TRANSPORT } from '../../../test/budget-fixtures.ts';
import { BCA, categoryView } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { BudgetPage } from './budget-page.tsx';

const writes = vi.hoisted(() => ({
  setBudgetLine: vi.fn(),
  removeBudgetLine: vi.fn(),
  moveBudgetLeftover: vi.fn(),
  undoBudgetMove: vi.fn(),
  dismissBudgetAlert: vi.fn(),
  restoreBudgetAlert: vi.fn(),
  saveBudgetVersion: vi.fn(),
}));
vi.mock('../../server/fn/budget-write.ts', () => writes);
const reads = vi.hoisted(() => ({
  getBudgetFill: vi.fn(),
  getBudgetHistory: vi.fn(),
  getBudgetCategory: vi.fn(),
}));
vi.mock('../../server/fn/budget.ts', () => reads);
const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { undo: vi.fn() }) }));
vi.mock('@wf/ui/toast', () => toasts);
// The category dialog has its own tests; here it only hands back a created category.
vi.mock('../settings/category-dialog.tsx', () => ({
  CategoryDialog: ({ open, onSaved }: { open: boolean; onSaved: (category: object) => void }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onSaved({ id: 'kopi', name: 'Kopi', builtInKey: null });
        }}
      >
        kategori dibuat
      </button>
    ) : null,
}));

const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });
const failed = (code = 'PERIOD_CLOSED') => Promise.resolve({ ok: false, code });
const CATEGORIES = [
  categoryView({ id: 'food', name: 'Makan', group: 'needs' }),
  categoryView({ id: 'health', name: 'Kesehatan', group: 'needs' }),
];

async function renderPage(status: BudgetStatus = budgetStatus()) {
  const onPeriodChange = vi.fn();
  const rendered = await renderApp(
    <BudgetPage
      status={status}
      periods={periodsOverview()}
      categories={CATEGORIES}
      accounts={[BCA]}
      spending={[]}
      timeZone="Asia/Jakarta"
      onPeriodChange={onPeriodChange}
    />,
  );
  const invalidate = vi.spyOn(rendered.router, 'invalidate');
  return { screen: rendered.screen, invalidate, onPeriodChange };
}

/** The `onUndo` of the latest undo toast. */
function lastUndo(): () => void {
  const options = toasts.toast.undo.mock.lastCall?.[0] as { onUndo: () => void };
  return options.onUndo;
}

beforeEach(() => {
  vi.clearAllMocks();
  reads.getBudgetFill.mockReturnValue(ok([]));
  reads.getBudgetHistory.mockReturnValue(ok([]));
  reads.getBudgetCategory.mockReturnValue(new Promise(() => undefined));
});

describe('BudgetPage', () => {
  it('shows the header, the transition, and opens the history, the setup, and other periods', async () => {
    writes.saveBudgetVersion.mockReturnValue(ok({ id: 'v-2' }));
    const { screen, invalidate, onPeriodChange } = await renderPage(
      budgetStatus({
        nextTransition: {
          period: {
            kind: 'transition',
            start: '2026-11-01' as LocalDate,
            end: '2026-11-24' as LocalDate,
            days: 24,
            label: '2026-11' as YearMonth,
          },
          limitMinor: 18_750_000n,
          proratedMinor: 15_000_000n,
        },
      }),
    );
    // The header's text column may be squeezed by the actions in the test viewport.
    await expect.element(screen.getByRole('heading', { name: 'Anggaran', level: 1 })).toBeInTheDocument();
    await expect
      .element(screen.getByText('Hari ke-15 dari 31 · 17 hari lagi menuju gajian berikutnya'))
      .toBeInTheDocument();
    await expect.element(screen.getByRole('region', { name: 'Periode transisi berikutnya' })).toBeVisible();
    await expect
      .element(screen.getByRole('complementary', { name: 'Ringkasan kelompok dan peringatan' }))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Periode sebelumnya' }).click();
    expect(onPeriodChange).toHaveBeenCalledWith('p-sep');

    // "Riwayat perubahan" is a secondary action, folded into ⋯ below 1024 px.
    await expect
      .element(screen.getByRole('button', { name: 'Riwayat perubahan', includeHidden: true }))
      .not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Aksi lainnya' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Riwayat perubahan' }));
    await expect.element(screen.getByText('Belum ada riwayat anggaran')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();

    await screen.getByRole('button', { name: 'Atur Anggaran' }).click();
    const setup = screen.getByRole('dialog', { name: 'Atur anggaran' });
    await setup.getByRole('button', { name: 'Simpan anggaran' }).click();
    await expect.element(setup).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalled();
  });

  it('saves an inline limit, keeps the editor when it fails, and skips an unchanged one', async () => {
    writes.setBudgetLine.mockReturnValueOnce(failed()).mockReturnValueOnce(ok(FOOD));
    const { screen, invalidate } = await renderPage();
    await screen.getByRole('button', { name: /^Ubah batas Makan / }).click();
    const input = screen.getByRole('textbox', { name: 'Ubah batas Makan' });
    await userEvent.keyboard('{Enter}');
    await expect.element(input).not.toBeInTheDocument();
    expect(writes.setBudgetLine).not.toHaveBeenCalled();

    await screen.getByRole('button', { name: /^Ubah batas Makan / }).click();
    await userEvent.fill(input, '3.700.000');
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({
        tone: 'error',
        title: 'Anggaran Makan gagal disimpan',
        description: 'Periode ini sudah ditutup dan hanya bisa dibaca.',
      });
    });
    expect(writes.setBudgetLine).toHaveBeenCalledWith({
      data: { periodId: 'p-okt', categoryId: 'food', limitMinor: 3_700_000n },
    });
    await expect.element(input).toBeEnabled();
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}');
    await expect.element(input).not.toBeInTheDocument();
    expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Batas Makan jadi Rp3.700.000' });
    expect(invalidate).toHaveBeenCalledTimes(2);

    await screen.getByRole('button', { name: /^Ubah batas Makan / }).click();
    await userEvent.keyboard('{Escape}');
    await expect.element(input).not.toBeInTheDocument();
  });

  it('saves options and removes a line with undo', async () => {
    writes.setBudgetLine.mockReturnValueOnce(ok(FOOD)).mockReturnValueOnce(failed()).mockReturnValue(ok(FOOD));
    writes.removeBudgetLine.mockReturnValueOnce(ok(null)).mockReturnValueOnce(failed());
    const { screen } = await renderPage();
    const option = async (name: string) => {
      await screen.getByRole('button', { name: 'Opsi Makan' }).click();
      await screen.getByRole('menuitemcheckbox', { name }).click();
    };
    await option('Bawa sisa ke bulan depan');
    expect(writes.setBudgetLine).toHaveBeenLastCalledWith({
      data: { periodId: 'p-okt', categoryId: 'food', rollover: true },
    });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ title: 'Opsi Makan disimpan' });
    });
    await option('Anggaran tetap');
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'error' }));
    });

    await screen.getByRole('button', { name: 'Opsi Makan' }).click();
    await screen.getByRole('menuitem', { name: 'Hapus dari anggaran' }).click();
    expect(writes.removeBudgetLine).toHaveBeenCalledWith({ data: { periodId: 'p-okt', categoryId: 'food' } });
    await vi.waitFor(() => {
      expect(toasts.toast.undo).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Makan dihapus dari anggaran', undoLabel: 'Urungkan' }),
      );
    });
    lastUndo()();
    expect(writes.setBudgetLine).toHaveBeenLastCalledWith({
      data: {
        periodId: 'p-okt',
        categoryId: 'food',
        limitMinor: 3_500_000n,
        rollover: false,
        isFixed: false,
        alertPct: 85,
      },
    });

    await screen.getByRole('button', { name: 'Opsi Makan' }).click();
    await screen.getByRole('menuitem', { name: 'Hapus dari anggaran' }).click();
    await vi.waitFor(() => {
      expect(writes.removeBudgetLine).toHaveBeenCalledTimes(2);
      expect(toasts.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'error' }));
    });
    expect(toasts.toast.undo).toHaveBeenCalledOnce();
  });

  it('moves a row’s leftover with undo, and reports failed moves and undos', async () => {
    writes.moveBudgetLeftover
      .mockReturnValueOnce(failed('INVALID_BUDGET'))
      .mockReturnValue(ok({ moveId: 'm-1', deltas: [] }));
    writes.undoBudgetMove.mockReturnValueOnce(ok(null)).mockReturnValueOnce(failed());
    const { screen } = await renderPage();
    await screen.getByRole('button', { name: 'Opsi Transportasi' }).click();
    await screen.getByRole('menuitem', { name: /^Pindahkan sisa ke…/ }).click();
    const dialog = screen.getByRole('dialog', { name: 'Pindahkan sisa' });
    await dialog.getByRole('combobox', { name: 'Pindahkan ke' }).selectOptions('shopping');
    await dialog.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'error', title: 'Sisa gagal dipindahkan' }),
      );
    });
    expect(writes.moveBudgetLeftover).toHaveBeenCalledWith({
      data: {
        periodId: 'p-okt',
        targetCategoryId: 'shopping',
        sources: [{ categoryId: 'transport', amountMinor: 400_000n }],
      },
    });
    await dialog.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(toasts.toast.undo).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Rp400.000 dipindahkan ke Belanja',
        description: 'Dari Transportasi Rp400.000.',
      }),
    );
    lastUndo()();
    expect(writes.undoBudgetMove).toHaveBeenCalledWith({ data: { moveId: 'm-1' } });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'info', title: 'Pemindahan sisa dibatalkan' });
    });
    lastUndo()();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith(
        expect.objectContaining({ tone: 'error', title: 'Sisa gagal dipindahkan' }),
      );
    });

    await screen.getByRole('button', { name: 'Opsi Transportasi' }).click();
    await screen.getByRole('menuitem', { name: /^Pindahkan sisa ke…/ }).click();
    await screen.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('acts on "Perlu perhatian": cover, raise, dismiss with undo, and restore', async () => {
    writes.moveBudgetLeftover.mockReturnValue(ok({ moveId: 'm-2', deltas: [] }));
    writes.dismissBudgetAlert.mockReturnValueOnce(ok(null)).mockReturnValueOnce(failed());
    writes.restoreBudgetAlert.mockReturnValue(ok(null));
    const status = budgetStatus({ lines: [FOOD, { ...TRANSPORT, dismissed: true }, ...budgetStatus().lines.slice(2)] });
    const { screen, invalidate } = await renderPage(status);
    const attention = screen.getByRole('region', { name: /Perlu perhatian/ });

    await attention.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();
    const dialog = screen.getByRole('dialog', { name: 'Tutup kekurangan Belanja' });
    await dialog.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(writes.moveBudgetLeftover).toHaveBeenCalledWith({
      data: {
        periodId: 'p-okt',
        targetCategoryId: 'shopping',
        sources: [{ categoryId: 'fun', amountMinor: 400_000n }],
      },
    });

    await attention.getByRole('button', { name: 'Naikkan batas' }).click();
    await expect.element(screen.getByRole('textbox', { name: 'Ubah batas Makan' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');

    await attention.getByRole('button', { name: 'Abaikan peringatan Makan sampai akhir periode' }).click();
    expect(writes.dismissBudgetAlert).toHaveBeenCalledWith({ data: { periodId: 'p-okt', categoryId: 'food' } });
    await vi.waitFor(() => {
      expect(toasts.toast.undo).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Peringatan Makan diabaikan sampai akhir periode' }),
      );
    });
    lastUndo()();
    expect(writes.restoreBudgetAlert).toHaveBeenCalledWith({ data: { periodId: 'p-okt', categoryId: 'food' } });
    const undos = toasts.toast.undo.mock.calls.length;
    await attention.getByRole('button', { name: 'Abaikan peringatan Makan sampai akhir periode' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'error' }));
    });
    expect(toasts.toast.undo).toHaveBeenCalledTimes(undos);

    invalidate.mockClear();
    await attention.getByRole('button', { name: 'Tampilkan' }).click();
    expect(writes.restoreBudgetAlert).toHaveBeenLastCalledWith({
      data: { periodId: 'p-okt', categoryId: 'transport' },
    });
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledOnce();
    });
  });

  it('opens a line’s detail, covers it, and edits its limit from there', async () => {
    const { screen } = await renderPage();
    await screen.getByRole('button', { name: 'Hiburan', exact: true }).click();
    const sheet = screen.getByRole('dialog', { name: 'Hiburan' });
    await sheet.getByRole('button', { name: 'Tambah dari kategori lain' }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Tutup kekurangan Hiburan' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();

    await screen.getByRole('button', { name: 'Opsi Hiburan' }).click();
    await screen.getByRole('menuitem', { name: 'Lihat detail' }).click();
    await screen.getByRole('dialog', { name: 'Hiburan' }).getByRole('button', { name: 'Ubah batas' }).click();
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(screen.getByRole('textbox', { name: 'Ubah batas Hiburan' })).toBeVisible();

    await userEvent.keyboard('{Escape}');
    await screen.getByRole('button', { name: 'Transportasi', exact: true }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Transportasi' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds an unbudgeted category or a new one and edits its limit', async () => {
    writes.setBudgetLine
      .mockReturnValueOnce(failed())
      .mockReturnValueOnce(ok(null))
      .mockReturnValueOnce(failed())
      .mockReturnValueOnce(ok(null));
    const { screen } = await renderPage();
    const add = async () => {
      await screen.getByRole('button', { name: 'Tambah kategori anggaran' }).click();
      await screen.getByRole('option', { name: /^Kesehatan/ }).click();
    };
    await add();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith(
        expect.objectContaining({ tone: 'error', title: 'Anggaran Kesehatan gagal disimpan' }),
      );
    });
    await add();
    expect(writes.setBudgetLine).toHaveBeenLastCalledWith({
      data: { periodId: 'p-okt', categoryId: 'health', limitMinor: 0n },
    });

    await screen.getByRole('button', { name: 'Tambah kategori anggaran' }).click();
    await screen.getByRole('button', { name: 'Buat kategori baru' }).click();
    await screen.getByRole('button', { name: 'kategori dibuat' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith(
        expect.objectContaining({ tone: 'error', title: 'Anggaran Kopi gagal disimpan' }),
      );
    });
    await screen.getByRole('button', { name: 'Tambah kategori anggaran' }).click();
    await screen.getByRole('button', { name: 'Buat kategori baru' }).click();
    await screen.getByRole('button', { name: 'kategori dibuat' }).click();
    await vi.waitFor(() => {
      expect(writes.setBudgetLine).toHaveBeenLastCalledWith({
        data: { periodId: 'p-okt', categoryId: 'kopi', limitMinor: 0n },
      });
    });
    await expect.element(screen.getByRole('button', { name: 'kategori dibuat' })).not.toBeInTheDocument();
  });

  it('invites to set up an empty budget', async () => {
    const { screen } = await renderPage(budgetStatus({ lines: [], attention: [] }));
    await expect.element(screen.getByText('Belum ada anggaran')).toBeVisible();
    await screen.getByRole('button', { name: 'Atur Anggaran' }).last().click();
    await expect.element(screen.getByRole('dialog', { name: 'Atur anggaran' })).toBeVisible();
  });

  it('shows a closed period read-only', async () => {
    const closed = budgetStatus({
      period: SEPTEMBER,
      readOnly: true,
      nextTransition: {
        period: {
          kind: 'transition',
          start: '2026-11-01' as LocalDate,
          end: '2026-11-24' as LocalDate,
          days: 24,
          label: '2026-11' as YearMonth,
        },
        limitMinor: 1n,
        proratedMinor: 1n,
      },
    });
    const first = await renderPage(closed);
    await expect.element(first.screen.getByText('Bulan selesai · sudah ditutup')).toBeInTheDocument();
    const setup = first.screen.getByRole('button', { name: 'Atur Anggaran' });
    await expect.element(setup).toBeDisabled();
    await expect.element(setup).toHaveAccessibleDescription('Hanya baca · bulan sudah ditutup');
    await expect
      .element(first.screen.getByRole('region', { name: 'Periode transisi berikutnya' }))
      .not.toBeInTheDocument();
    await expect.element(first.screen.getByRole('region', { name: /Perlu perhatian/ })).not.toBeInTheDocument();
    await expect.element(first.screen.getByRole('heading', { name: 'Hasil September' })).toBeVisible();
    await first.screen.unmount();

    const empty = await renderPage({ ...closed, lines: [] });
    await expect.element(empty.screen.getByText('Periode ini tidak punya anggaran')).toBeVisible();
    expect(empty.screen.getByRole('button', { name: 'Atur Anggaran' }).elements()).toHaveLength(1);
  });
});
