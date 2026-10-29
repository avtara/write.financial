// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BILL_OVERVIEW, debtsOverview, KULKAS, MACBOOK, VISA_ACCOUNT } from '../../../test/debt-fixtures.ts';
import { BCA, JAGO } from '../../../test/ledger-fixtures.ts';
import { receivablesOverview } from '../../../test/receivable-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AddDebtDialog, netWorthOf, type AddDebtStart } from './add-debt-dialog.tsx';

const fake = vi.hoisted(() => ({ createDebt: vi.fn(), convertCardTransaction: vi.fn() }));
vi.mock('../../server/fn/debts.ts', () => fake);

afterEach(() => {
  vi.clearAllMocks();
});

describe('netWorthOf', () => {
  it('counts every active account, receivables, and what non-card debts still owe', () => {
    const overview = debtsOverview({
      receivables: receivablesOverview(),
      debts: [
        { ...MACBOOK, sourceDate: null },
        { ...KULKAS, sourceDate: null },
        { ...MACBOOK, id: 'usd', currency: 'USD', sourceDate: null },
      ],
    });
    expect(netWorthOf(overview)).toBe(BCA.balanceMinor + JAGO.balanceMinor + 542_500n - 18_999_000n);
  });
});

describe('AddDebtDialog (v3Igd)', () => {
  it('golden: MacBook Air M4 Rp18.999.000 in 12× 0% → Rp1.583.250, 6,1%, 36,5% → 30,4%, then saves', async () => {
    const onSaved = vi.fn();
    fake.createDebt
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_DEBT' })
      .mockResolvedValueOnce({ ok: true, value: 'debt' });
    const { screen } = await renderApp(
      <AddDebtDialog
        start={{ kind: 'zero_percent' }}
        onClose={vi.fn()}
        overview={debtsOverview()}
        locale="id"
        onSaved={onSaved}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Tambah utang / cicilan' });
    const simulation = dialog.getByRole('region', { name: 'Simulasi dampak' });
    await expect.element(simulation).toMatchTextContent(/Isi pokok, tenor, dan bunga/);
    await dialog.getByRole('button', { name: 'Simpan cicilan' }).click();
    await expect.element(dialog.getByText('Isi nama utangnya')).toBeVisible();
    await expect.element(dialog.getByText('Isi pokok lebih dari 0')).toBeVisible();
    expect(fake.createDebt).not.toHaveBeenCalled();

    await dialog.getByRole('textbox', { name: 'Nama' }).fill('MacBook Air M4 — iBox');
    await dialog.getByRole('textbox', { name: 'Pokok' }).fill('18999000');
    await dialog.getByRole('textbox', { name: 'Penyedia' }).fill('Kredivo');
    await dialog.getByRole('button', { name: 'Cicilan pertama' }).click();
    await page.getByRole('button', { name: 'Rabu, 25 November 2026' }).click();
    await dialog.getByRole('button', { name: 'Bayar dari' }).click();
    await page.getByRole('option', { name: /^Bank Jago/ }).click();
    await dialog.getByRole('button', { name: 'Bayar dari' }).click();
    await page.getByRole('option', { name: /^BCA Tahapan/ }).click();
    await expect
      .element(dialog.getByText('Muncul di buku kas sebagai “Cicilan MacBook Air M4 — iBox (1/12)”'))
      .toBeVisible();
    await expect
      .element(simulation)
      .toMatchTextContent(/Cicilan per bulan12× · 25 Nov 2026 – 25 Okt 2027Rp1\.583\.250/);
    await expect.element(simulation).toMatchTextContent(/dari Rp26\.000\.000 · batas sehat ≤ 30,00%6,09%/);
    await expect.element(simulation).toMatchTextContent(/sisa ruang 0,4 poin36,54%30,45%/);
    await expect.element(simulation).toMatchTextContent(/Rp48\.060\.000Rp29\.061\.000/);

    await dialog.getByRole('textbox', { name: 'Tenor' }).fill('dua');
    await expect
      .element(dialog.getByText('Muncul di buku kas sebagai “Cicilan MacBook Air M4 — iBox (1/1)”'))
      .toBeVisible();
    await dialog.getByRole('textbox', { name: 'Tenor' }).fill('0');
    await expect.element(simulation).toMatchTextContent(/Isi pokok/);
    await dialog.getByRole('textbox', { name: 'Tenor' }).fill('12');
    await dialog.getByRole('textbox', { name: 'Bunga / biaya' }).fill('x');
    await dialog.getByRole('button', { name: 'Simpan cicilan' }).click();
    await expect.element(dialog.getByText('Isi bunga 0–100, maksimal 2 desimal')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Bunga / biaya' }).fill('0');
    await dialog.getByRole('button', { name: 'Simpan cicilan' }).click();
    await expect.element(dialog.getByRole('alert')).toHaveTextContent('Periksa lagi data utang atau cicilan.');
    expect(fake.createDebt).toHaveBeenCalledWith({
      data: {
        kind: 'zero_percent',
        name: 'MacBook Air M4 — iBox',
        provider: 'Kredivo',
        principalMinor: 18_999_000n,
        tenorMonths: 12,
        monthlyRateBps: 0,
        adminFeeMinor: 0n,
        firstDueDate: '2026-11-25',
        payFromAccountId: BCA.id,
      },
    });
    await dialog.getByRole('textbox', { name: 'Penyedia' }).fill(' ');
    await dialog.getByRole('button', { name: 'Simpan cicilan' }).click();
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('debt');
    });
    expect(fake.createDebt.mock.lastCall?.[0]).toMatchObject({ data: { provider: null } });
  });

  it('warns when installments pass 30% of income or the saving rate drops below target, and without income', async () => {
    const tight = debtsOverview({ month: { incomeMinor: 10_000_000n, expenseMinor: 9_000_000n } });
    const { screen } = await renderApp(
      <AddDebtDialog start={{ kind: 'mortgage' }} onClose={vi.fn()} overview={tight} locale="id" onSaved={vi.fn()} />,
    );
    const dialog = screen.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Pokok' }).fill('60000000');
    const simulation = dialog.getByRole('region', { name: 'Simulasi dampak' });
    await expect.element(simulation).toMatchTextContent(/di bawah target 30%/);
    await expect.element(simulation.getByText('50,00%')).toHaveClass(/text-red-fg/);
    await screen.unmount();

    const none = debtsOverview({
      month: { incomeMinor: 0n, expenseMinor: 0n },
      accounts: { baseCurrency: 'IDR', accounts: [VISA_ACCOUNT], availableMinor: 0n, missingRates: [] },
    });
    const second = await renderApp(
      <AddDebtDialog start={{ kind: 'paylater' }} onClose={vi.fn()} overview={none} locale="id" onSaved={vi.fn()} />,
    );
    const empty = second.screen.getByRole('dialog');
    await empty.getByRole('textbox', { name: 'Pokok' }).fill('1000000');
    await expect.element(empty.getByText('belum ada pemasukan bulan ini')).toBeVisible();
    await empty.getByRole('textbox', { name: 'Nama' }).fill('Paylater');
    await empty.getByRole('button', { name: 'Simpan cicilan' }).click();
    await expect.element(empty.getByText('Pilih rekening pembayarnya')).toBeVisible();
  });

  it('turns a card expense into installments from "Ubah jadi cicilan" or the kind, and closes', async () => {
    const onClose = vi.fn();
    const { screen, router } = await renderApp(
      <AddDebtDialog
        start={{ kind: 'card_installment', cardId: 'acc-visa' }}
        onClose={onClose}
        overview={BILL_OVERVIEW}
        locale="id"
        onSaved={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Ubah transaksi jadi cicilan' });
    await expect.element(dialog).toMatchTextContent(/BCA Visa · catat setelah bank menyetujui konversi\./);
    await expect.element(dialog.getByRole('radio', { name: 'Paylater' })).not.toBeInTheDocument();
    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    await screen.unmount();
    expect(router).toBeDefined();

    const second = await renderApp(
      <AddDebtDialog
        start={{ kind: 'paylater' }}
        onClose={onClose}
        overview={debtsOverview()}
        locale="id"
        onSaved={vi.fn()}
      />,
    );
    const add = second.screen.getByRole('dialog');
    await add.getByRole('radio', { name: 'Cicilan kartu' }).click();
    await expect.element(add.getByText('Belum ada kartu kredit')).toBeVisible();
    await expect.element(add).toMatchTextContent(/Cicilan kartu kredit · catat setelah bank/);
    await add.getByRole('button', { name: 'Batal' }).click();
    await add.getByRole('radio', { name: 'Pinjaman' }).click();
    await add.getByRole('button', { name: 'Batal' }).click();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('opens on a new start and closes with Escape', async () => {
    function Harness() {
      const [start, setStart] = useState<AddDebtStart | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setStart({ kind: 'mortgage' });
            }}
          >
            open
          </button>
          <AddDebtDialog
            start={start}
            onClose={() => {
              setStart(null);
            }}
            overview={debtsOverview()}
            locale="id"
            onSaved={vi.fn()}
          />
        </>
      );
    }
    const { screen } = await renderApp(<Harness />);
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'open' }).click();
    await expect.element(screen.getByRole('radio', { name: 'KPR' })).toBeChecked();
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});
