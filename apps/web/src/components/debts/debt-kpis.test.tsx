// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { CARD_AFTER_PAYMENT, KULKAS_AFTER, MACBOOK, visa } from '../../../test/debt-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { cardState, debtKpis, type DebtKpis as Kpis } from '../../lib/debts.ts';
import { DebtKpis } from './debt-kpis.tsx';

const d = (value: string) => value as LocalDate;

async function kpisOf(kpis: Kpis, today: LocalDate, receivablesMinor = 0n) {
  const { screen } = await renderApp(
    <DebtKpis kpis={kpis} receivablesMinor={receivablesMinor} baseCurrency="IDR" today={today} locale="id" />,
  );
  return { screen, region: screen.getByRole('region', { name: 'Ringkasan utang' }) };
}

describe('DebtKpis', () => {
  it('golden exCE7: nothing owed', async () => {
    const { region } = await kpisOf(debtKpis([], [], d('2026-10-15'), 'IDR'), d('2026-10-15'));
    await expect
      .element(region)
      .toHaveTextContent(
        'Sisa utangRp0tidak ada utang aktifHarus dibayarRp0tidak ada tagihan bulan iniJatuh tempo terdekat—tidak ada jadwalPiutangRp0belum ada yang berutang padamu',
      );
  });

  it('golden rHTMd: the card bill, due 5 Nov in 21 days, and open receivables', async () => {
    const today = d('2026-10-15');
    const { region } = await kpisOf(debtKpis([], [cardState(visa(), [], today)], today, 'IDR'), today, 542_500n);
    await expect.element(region).toMatchTextContent(/Sisa utangRp1\.250\.0001 tagihan kartu kredit/);
    await expect.element(region).toMatchTextContent(/Harus dibayarRp1\.250\.000BCA Visa · tempo 5 Nov/);
    await expect.element(region).toMatchTextContent(/5 NovBCA Visa · 21 hari lagi/);
    await expect.element(region).toMatchTextContent(/PiutangRp542\.500uang ditalangi yang belum kembali/);
  });

  it('golden A7ttc: 1 cicilan · 1 tagihan berjalan, the statement with the installment', async () => {
    const today = d('2026-11-10');
    const state = cardState(CARD_AFTER_PAYMENT, [KULKAS_AFTER], today);
    const { region } = await kpisOf(debtKpis([KULKAS_AFTER], [state], today, 'IDR'), today);
    await expect.element(region).toMatchTextContent(/Rp2\.000\.0001 cicilan · 1 tagihan berjalan/);
    await expect.element(region).toMatchTextContent(/Rp1\.333\.334rekening koran 20 Nov · tempo 5 Des/);
  });

  it('names installments alone, mixed dues, and a due date today', async () => {
    const today = d('2026-11-25');
    const { region } = await kpisOf(debtKpis([MACBOOK], [], today, 'IDR'), today);
    await expect.element(region).toMatchTextContent(/1 cicilan/);
    await expect.element(region).toMatchTextContent(/cicilan & tagihan bulan ini/);
    await expect.element(region).toMatchTextContent(/MacBook Air M4 — iBox · hari ini/);
  });
});
