// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { debtView, installment, KULKAS_AFTER, MACBOOK, VISA_ACCOUNT, visa } from '../../../test/debt-fixtures.ts';
import { BCA } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { InstallmentCard } from './installment-card.tsx';

const CARD = { ...visa(), transactions: [] };

describe('InstallmentCard', () => {
  it('golden A7ttc: Rp1.000.000 of Rp3.000.000, 67% lunas, the recalculated schedule, and its history', async () => {
    const { screen } = await renderApp(
      <InstallmentCard
        debt={{ ...KULKAS_AFTER, sourceDate: '2026-11-02' as LocalDate }}
        card={CARD}
        accounts={[VISA_ACCOUNT]}
        locale="id"
      />,
    );
    const card = screen.getByRole('article', { name: 'Tokopedia — Kulkas 2 pintu' });
    await expect
      .element(card)
      .toMatchTextContent(/Cicilan kartu kreditBCA Visa •• 7710 · 0% · dari transaksi 2 Nov · 3 bulan/);
    await expect.element(card).toMatchTextContent(/Rp1\.000\.000sisa dari Rp3\.000\.000/);
    await expect
      .element(card)
      .toMatchTextContent(/67% lunas · Rp2\.000\.000 dilunasi lebih awal0 dari 3 cicilan tertagih/);
    await expect.element(card).toMatchTextContent(/Jadwal cicilan · dihitung ulang 10 Nov/i);
    const rows = card.getByRole('row');
    await expect
      .element(rows.nth(0))
      .toHaveTextContent('1/3Tertagih di rekening koran20 Nov · tempo 5 Des333.334Terjadwal');
    await expect
      .element(rows.nth(2))
      .toHaveTextContent('3/3Tertagih di rekening koran20 Jan · tempo 5 Feb333.333Terjadwal');
    await expect.element(card).toMatchTextContent(/pilihan: kurangi nominal, tenor tetap/);
    await expect.element(card).toMatchTextContent(/Dilunasi sebagian Rp2\.000\.00010 Nov/);
    await expect
      .element(card)
      .toMatchTextContent(/Dibuat dari transaksi kartu2 NovDipecah 3×; pengeluaran tetap tercatat 2 Nov/);
  });

  it('a paylater paid from BCA: rows paid and scheduled, created by hand, a shortened tenor', async () => {
    const paid = debtView({
      ...MACBOOK,
      installments: [
        installment(1, '2026-11-25', 1_583_250n, { status: 'paid' }),
        installment(2, '2026-12-25', 1_583_250n, { billed: true }),
        installment(3, '2027-01-25', 1_583_250n),
      ],
      monthlyRateBps: 175,
      provider: null,
      recalcMode: 'shorten_tenor',
      recalculatedAt: new Date('2026-12-01T00:00:00Z'),
    });
    const { screen } = await renderApp(
      <InstallmentCard debt={{ ...paid, sourceDate: null }} card={undefined} accounts={[BCA]} locale="id" />,
    );
    const card = screen.getByRole('article', { name: 'MacBook Air M4 — iBox' });
    await expect.element(card).toMatchTextContent(/Cicilan 0%BCA Tahapan · 1,75% · 12 bulan/);
    await expect.element(card).toMatchTextContent(/2 dari 3 cicilan dibayar/);
    await expect.element(card.getByRole('row').nth(0)).toMatchTextContent(/Bayar dari BCA Tahapan25 Nov.*Lunas/);
    await expect.element(card.getByRole('row').nth(1)).toMatchTextContent(/Tertagih$/);
    await expect.element(card).toMatchTextContent(/dihitung ulang 25 Nov/i);
    await expect.element(card).toMatchTextContent(/pilihan: persingkat tenor/);
    await expect.element(card).toMatchTextContent(/Dicatat25 NovDibagi 12× · pokok Rp18\.999\.000/);
  });

  it('names a card plan without its card account by provider, and a debt without provider or account by nothing', async () => {
    const { screen } = await renderApp(
      <>
        <InstallmentCard debt={{ ...KULKAS_AFTER, sourceDate: null }} card={undefined} accounts={[]} locale="id" />
        <InstallmentCard
          debt={{ ...MACBOOK, id: 'x', name: 'Pinjaman', provider: null, sourceDate: null }}
          card={undefined}
          accounts={[]}
          locale="id"
        />
      </>,
    );
    await expect
      .element(screen.getByRole('article', { name: 'Tokopedia — Kulkas 2 pintu' }))
      .toMatchTextContent(/BCA Visa · 0%/);
    await expect.element(screen.getByRole('article', { name: 'Pinjaman' })).toMatchTextContent(/Bayar dari 25 Nov/);
    const nameless = await renderApp(
      <InstallmentCard
        debt={{ ...KULKAS_AFTER, provider: null, sourceDate: null }}
        card={undefined}
        accounts={[]}
        locale="id"
      />,
    );
    await expect.element(nameless.screen.getByText(/^ · 0%/)).toBeInTheDocument();
  });
});
