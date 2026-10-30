// SPDX-License-Identifier: AGPL-3.0-only
import type { BudgetLineView, BudgetStatus } from '@wf/db/budgets';
import type { TransactionRow } from '@wf/db/transaction-query';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { budgetLine, budgetStatus, FOOD, RENT, SEPTEMBER, SHOPPING } from '../../../test/budget-fixtures.ts';
import { BCA } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { BudgetCategoryDetail } from '../../server/fn/budget.ts';
import { BudgetCategorySheet } from './budget-category-sheet.tsx';

const server = vi.hoisted(() => ({ getBudgetCategory: vi.fn() }));
vi.mock('../../server/fn/budget.ts', () => server);

function row(patch: Partial<TransactionRow> & Pick<TransactionRow, 'id'>): TransactionRow {
  return {
    type: 'expense',
    occurredAt: new Date('2026-10-14T05:00:00Z'),
    localDate: '2026-10-14' as LocalDate,
    merchant: null,
    description: null,
    categoryId: 'food',
    accountId: BCA.id,
    toAccountId: null,
    amountMinor: -45_000n,
    currency: 'IDR',
    receivedMinor: null,
    receivedCurrency: null,
    amountBaseMinor: -45_000n,
    feeMinor: null,
    fxDiffBaseMinor: null,
    tags: [],
    hasAttachment: false,
    hasNote: false,
    source: 'manual',
    splitParentId: null,
    ...patch,
  };
}

const day = (date: string, outMinor: bigint) => ({ date: date as LocalDate, outMinor });
const month = (label: string, spentMinor: bigint, current = false) => ({
  label: label as YearMonth,
  spentMinor,
  current,
});

const DETAIL: BudgetCategoryDetail = {
  daily: [day('2026-10-01', 0n), day('2026-10-02', 50_000n), day('2026-10-03', 10_000n)],
  months: [
    month('2026-07', 3_000_000n),
    month('2026-08', 4_000_000n),
    month('2026-09', 3_400_000n),
    month('2026-10', 3_200_000n, true),
  ],
  transactions: [
    row({ id: 't1', merchant: 'Warung Bu Sri', amountBaseMinor: 45_000n }),
    row({ id: 't2', description: 'Belanja pasar' }),
    row({ id: 't3', accountId: 'gone' }),
  ],
  transactionCount: 12,
};

const EMPTY: BudgetCategoryDetail = {
  daily: [day('2026-10-01', 0n), day('2026-10-02', 0n)],
  months: [month('2026-10', 0n, true)],
  transactions: [],
  transactionCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

async function renderSheet(line: BudgetLineView | null, status: BudgetStatus = budgetStatus()) {
  const handlers = { onClose: vi.fn(), onCover: vi.fn(), onEditLimit: vi.fn() };
  const { screen } = await renderApp(
    <BudgetCategorySheet line={line} status={status} accounts={[BCA]} {...handlers} />,
  );
  return { screen, sheet: screen.getByRole('dialog'), ...handlers };
}

describe('BudgetCategorySheet', () => {
  it('shows a line’s pace, daily spending, recent months, and transactions with its actions', async () => {
    const pending = Promise.withResolvers<unknown>();
    server.getBudgetCategory.mockReturnValue(pending.promise);
    const { sheet, onCover, onEditLimit, onClose } = await renderSheet(FOOD);
    expect(server.getBudgetCategory).toHaveBeenCalledWith({ data: { periodId: 'p-okt', categoryId: 'food' } });
    await expect.element(sheet.getByRole('heading', { name: 'Makan' })).toBeVisible();
    await expect.element(sheet.getByText('Kebutuhan · Oktober 2026')).toBeVisible();
    await expect.element(sheet.getByText('91,43% · ideal 48,39%')).toBeVisible();
    await expect.element(sheet).toMatchTextContent(/SisaRp300\.00017 hari lagi/);
    await expect.element(sheet).toMatchTextContent(/Batas harianRp18\.000sisa ÷ 17 hari/);
    await expect.element(sheet.getByText('lewat Rp3.100.000')).toHaveClass('text-red-fg-soft');
    await expect.element(sheet.getByText('Memuat detail…')).toBeVisible();

    pending.resolve({ ok: true, value: DETAIL });
    const chart = sheet.getByRole('img', { name: 'Pengeluaran harian' });
    await expect.element(chart).toBeVisible();
    expect([...chart.element().querySelectorAll('rect')].map((rect) => rect.getAttribute('class'))).toEqual([
      'fill-surface-3',
      'fill-amber',
      'fill-blue',
    ]);
    expect(chart.element().querySelector('line')).not.toBeNull();
    await expect.element(sheet.getByText('batas aman Rp18.000/hari')).toBeVisible();
    await expect.element(sheet.getByText('31 Okt')).toBeVisible();
    const months = sheet.getByRole('region', { name: '3 bulan terakhir' });
    await expect
      .element(months)
      .toMatchTextContent(/JulRp3\.000\.000AguRp4\.000\.000SepRp3\.400\.000OktRp3\.200\.000 · berjalan/);
    const transactions = sheet.getByRole('region', { name: 'Transaksi Oktober · 12' });
    await expect.element(transactions.getByText('Warung Bu Sri')).toBeVisible();
    await expect.element(transactions.getByText('Belanja pasar')).toBeVisible();
    await expect.element(transactions.getByText('Makan', { exact: true })).toBeVisible();
    await expect.element(transactions.getByText('14 Okt · BCA Tahapan').first()).toBeVisible();
    expect(transactions.getByText('14 Okt · BCA Tahapan').elements()).toHaveLength(2);

    await sheet.getByRole('button', { name: 'Tambah dari kategori lain' }).click();
    expect(onCover).toHaveBeenCalledWith(FOOD);
    await sheet.getByRole('button', { name: 'Ubah batas' }).click();
    expect(onEditLimit).toHaveBeenCalledWith(FOOD);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an overspent line and a quiet period with no spending', async () => {
    server.getBudgetCategory.mockResolvedValue({ ok: true, value: EMPTY });
    const { sheet } = await renderSheet(SHOPPING);
    await expect.element(sheet).toMatchTextContent(/LewatRp400\.000/);
    await expect.element(sheet.getByText('Belum ada transaksi di periode ini.')).toBeVisible();
    const chart = sheet.getByRole('img', { name: 'Pengeluaran harian' });
    expect([...chart.element().querySelectorAll('rect')].map((rect) => rect.getAttribute('height'))).toEqual([
      '1',
      '1',
    ]);
  });

  it('shows a fixed line without a daily limit, and a closed period without actions', async () => {
    server.getBudgetCategory.mockResolvedValue({ ok: true, value: EMPTY });
    const first = await renderSheet(RENT);
    await expect.element(first.sheet.getByText('100,00%', { exact: true })).toBeVisible();
    await expect.element(first.sheet).toMatchTextContent(/Batas harian—anggaran tetap/);
    await expect.element(first.sheet.getByText('dalam batas')).toBeVisible();
    await expect.element(first.sheet.getByText('Belum ada transaksi di periode ini.')).toBeVisible();
    await expect.element(first.sheet.getByText(/batas aman/)).not.toBeInTheDocument();
    expect(first.sheet.getByRole('img', { name: 'Pengeluaran harian' }).element().querySelector('line')).toBeNull();
    await first.screen.unmount();

    const zero = budgetLine({ categoryId: 'zero', name: 'Zakat', limitMinor: 0n, spentMinor: 0n });
    const closed = budgetStatus({ period: SEPTEMBER, readOnly: true, lines: [zero] });
    const second = await renderSheet(zero, closed);
    await expect.element(second.sheet.getByText('Ditutup')).toBeVisible();
    await expect.element(second.sheet.getByText('Kebutuhan · September 2026')).toBeVisible();
    await expect.element(second.sheet.getByText('Belum ada transaksi di periode ini.')).toBeVisible();
    await expect.element(second.sheet.getByText(/berjalan/)).not.toBeInTheDocument();
    await expect.element(second.sheet.getByRole('button', { name: 'Ubah batas' })).not.toBeInTheDocument();
  });

  it('explains a failed load, ignores a late answer, and renders nothing without a line', async () => {
    server.getBudgetCategory.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const first = await renderSheet(FOOD);
    await expect.element(first.sheet.getByText('Detail kategori gagal dimuat')).toBeVisible();
    await expect.element(first.sheet.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
    await first.screen.unmount();

    const late = Promise.withResolvers<unknown>();
    server.getBudgetCategory.mockReturnValueOnce(late.promise);
    const second = await renderSheet(FOOD);
    await second.screen.unmount();
    late.resolve({ ok: true, value: DETAIL });
    await late.promise;

    const none = await renderSheet(null);
    await expect.element(none.screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});
