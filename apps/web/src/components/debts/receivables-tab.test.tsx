// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { debtsOverview } from '../../../test/debt-fixtures.ts';
import { BCA } from '../../../test/ledger-fixtures.ts';
import {
  DIMAS,
  GOPAY,
  NADIA,
  NO_RECEIVABLES,
  RAKA,
  receivable,
  receivablesOverview,
  SARI,
} from '../../../test/receivable-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { ReceivablesTab, type ReceivablesTabProps } from './receivables-tab.tsx';

const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { undo: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@wf/ui/toast', () => toasts);

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const OVERVIEW = debtsOverview({
  accounts: { baseCurrency: 'IDR', accounts: [BCA, GOPAY], availableMinor: 0n, missingRates: [] },
  receivables: receivablesOverview(),
});

function renderTab(props: Partial<ReceivablesTabProps> = {}, balancesHidden = false) {
  return renderApp(
    <ReceivablesTab
      overview={OVERVIEW}
      locale="id"
      onRecord={vi.fn()}
      onReceive={vi.fn()}
      onWriteOff={vi.fn()}
      {...props}
    />,
    { preferences: { balancesHidden } },
  );
}

describe('ReceivablesTab', () => {
  it('golden KZZZy: Nadia and Raka, the 90-day history, and how write.financial calculates', async () => {
    const onReceive = vi.fn();
    const { screen } = await renderTab({ onReceive });
    const active = screen.getByRole('region', { name: 'Piutang aktif' });
    await expect.element(active.getByRole('heading', { name: 'Piutang aktif' })).toBeVisible();
    const nadia = screen.getByRole('article', { name: 'Nadia' });
    await expect
      .element(nadia)
      .toMatchTextContent(
        /NNadia3 hari lagiPisah tagihan · Nonton bareng CGV Grand Indonesia · 15 Okt · dari BCA TahapanRp242\.500belum dibayarJatuh tempo Min, 18 Okt · pengingat H-1 jam 09\.00/,
      );
    const raka = screen.getByRole('article', { name: 'Raka Pratama' });
    await expect
      .element(raka)
      .toMatchTextContent(
        /RPRaka PratamaSebagianDipinjam tunai · 2 Okt · dari GoPayRp300\.000dari Rp400\.000 · 25% kembaliJatuh tempo Sab, 31 Okt · terakhir dibayar Rp100\.000 pada 10 Okt/,
      );
    await raka.getByRole('button', { name: 'Terima pembayaran' }).click();
    expect(onReceive).toHaveBeenCalledWith(RAKA);
    const history = screen.getByRole('region', { name: 'Lunas · 90 hari' });
    await expect.element(history).toMatchTextContent(/DimasPatungan kado · Rp150\.000lunas 2 Okt ke GoPay/);
    await expect
      .element(history)
      .toMatchTextContent(/SariTalangan tiket kereta · Rp385\.000lunas 21 Sep ke BCA Tahapan/);
    const how = screen.getByRole('complementary', { name: 'Cara write.financial menghitung' });
    await expect.element(how.getByRole('listitem')).toHaveLength(5);
  });

  it('copies a friendly reminder (amount hidden in privacy mode) and says when it cannot', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const shown = await renderTab();
    await shown.screen.getByRole('article', { name: 'Nadia' }).getByRole('button', { name: 'Salin pengingat' }).click();
    expect(write).toHaveBeenCalledWith(
      'Halo Nadia, sekadar mengingatkan Nonton bareng CGV Grand Indonesia sebesar Rp242.500, jatuh tempo Min, 18 Okt. Terima kasih!',
    );
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({
        tone: 'success',
        title: 'Pengingat disalin — tempel di chat ke Nadia',
      });
    });
    await shown.screen.unmount();

    write.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const loan = receivable({
      id: 'bima',
      counterparty: 'Bima Aditya',
      principalMinor: 500_000n,
      remainingMinor: 500_000n,
    });
    const hidden = await renderTab(
      { overview: { ...OVERVIEW, receivables: receivablesOverview({ active: [loan], history: [] }) } },
      true,
    );
    await hidden.screen.getByRole('button', { name: 'Salin pengingat' }).click();
    expect(write).toHaveBeenLastCalledWith(
      'Halo Bima Aditya, sekadar mengingatkan pinjaman sebesar Rp••••••. Terima kasih!',
    );
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'error', title: 'Pengingat tidak bisa disalin' });
    });
    await expect.element(hidden.screen.getByRole('article')).toMatchTextContent(/Tanpa tenggat/);
  });

  it('offers "Hapuskan" in the menu and shows written-off, overdue, unknown accounts, and today’s due date', async () => {
    const onWriteOff = vi.fn();
    const overdue = receivable({
      id: 'late',
      counterparty: 'Tono',
      fromAccountId: 'gone',
      dueDate: '2026-10-10' as LocalDate,
    });
    const today = receivable({ id: 'today', counterparty: 'Ani', dueDate: '2026-10-15' as LocalDate, remind: true });
    const away = receivable({ id: 'away', counterparty: 'Budi', dueDate: '2026-12-01' as LocalDate });
    const written = {
      ...SARI,
      id: 'written',
      counterparty: 'Rudi',
      description: null,
      status: 'written_off' as const,
      settledAt: null,
      writtenOffAt: new Date('2026-10-01T18:00:00Z'),
      payments: [],
    };
    const settledElsewhere = {
      ...DIMAS,
      payments: [{ ...(DIMAS.payments[0] as (typeof DIMAS.payments)[number]), accountId: 'gone' }],
    };
    const { screen } = await renderTab({
      onWriteOff,
      overview: {
        ...OVERVIEW,
        receivables: receivablesOverview({
          active: [NADIA, overdue, today, away],
          history: [written, settledElsewhere],
        }),
      },
    });
    await expect.element(screen.getByRole('article', { name: 'Tono' })).toMatchTextContent(/Lewat 5 hari/);
    await expect.element(screen.getByRole('article', { name: 'Tono' })).not.toMatchTextContent(/dari /);
    await expect.element(screen.getByRole('article', { name: 'Ani' })).toMatchTextContent(/Jatuh tempo hari ini/);
    await expect.element(screen.getByRole('article', { name: 'Budi' })).toMatchTextContent(/47 hari lagi/);
    const history = screen.getByRole('region', { name: 'Lunas · 90 hari' });
    await expect.element(history).toMatchTextContent(/RudiDipinjam tunai · Rp385\.000dihapuskan 2 Okt/);
    await expect.element(history).toMatchTextContent(/DimasPatungan kado · Rp150\.000lunas 2 Okt$/);
    await screen.getByRole('button', { name: 'Lainnya · Nadia' }).click();
    await screen.getByRole('menuitem', { name: 'Hapuskan' }).click();
    expect(onWriteOff).toHaveBeenCalledWith(NADIA);
  });

  it('shows an empty state that records the first receivable, and a list without history', async () => {
    const onRecord = vi.fn();
    const empty = await renderTab({ onRecord, overview: { ...OVERVIEW, receivables: NO_RECEIVABLES } });
    await expect.element(empty.screen.getByText('Belum ada piutang')).toBeVisible();
    await empty.screen.getByRole('button', { name: 'Catat piutang' }).click();
    expect(onRecord).toHaveBeenCalled();
    await empty.screen.unmount();
    const { screen } = await renderTab({
      overview: { ...OVERVIEW, receivables: receivablesOverview({ history: [] }) },
    });
    await expect.element(screen.getByRole('region', { name: 'Lunas · 90 hari' })).not.toBeInTheDocument();
  });
});
