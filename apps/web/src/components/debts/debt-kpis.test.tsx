// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { CARD_AFTER_PAYMENT, KULKAS_AFTER, MACBOOK, visa } from '../../../test/debt-fixtures.ts';
import { NADIA, NO_RECEIVABLES, RAKA, receivable, receivablesOverview } from '../../../test/receivable-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { cardState, debtKpis, type DebtKpis as Kpis } from '../../lib/debts.ts';
import { DebtKpis } from './debt-kpis.tsx';

const d = (value: string) => value as LocalDate;

async function kpisOf(kpis: Kpis, today: LocalDate, receivables = NO_RECEIVABLES) {
  const { screen } = await renderApp(
    <DebtKpis kpis={kpis} receivables={receivables} baseCurrency="IDR" today={today} locale="id" />,
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
    const { region } = await kpisOf(
      debtKpis([], [cardState(visa(), [], today)], today, 'IDR'),
      today,
      receivablesOverview(),
    );
    await expect.element(region).toMatchTextContent(/Sisa utangRp1\.250\.0001 tagihan kartu kredit/);
    await expect.element(region).toMatchTextContent(/Harus dibayarRp1\.250\.000BCA Visa · tempo 5 Nov/);
    await expect.element(region).toMatchTextContent(/5 NovBCA Visa · 21 hari lagi/);
    await expect.element(region).toMatchTextContent(/PiutangRp542\.5002 orang · 1 jatuh tempo 3 hari lagi/);
  });

  it('golden KZZZy: debt-free, the nearest due date is Nadia’s receivable', async () => {
    const today = d('2026-10-15');
    const { region } = await kpisOf(debtKpis([], [], today, 'IDR'), today, receivablesOverview());
    await expect.element(region).toMatchTextContent(/Jatuh tempo terdekat18 OktNadia · piutang Rp242\.500/);
  });

  it('counts receivables due today, without a due date, and overdue ones only by person', async () => {
    const today = d('2026-10-18');
    const due = await kpisOf(debtKpis([], [], today, 'IDR'), today, receivablesOverview());
    await expect.element(due.region).toMatchTextContent(/2 orang · 1 jatuh tempo hari ini/);
    await due.screen.unmount();
    const later = d('2026-11-01');
    const none = await kpisOf(
      debtKpis([], [], later, 'IDR'),
      later,
      receivablesOverview({ active: [NADIA, RAKA, receivable({ id: 'x', counterparty: 'Nadia' })] }),
    );
    await expect.element(none.region).toMatchTextContent(/Rp542\.5002 orang$/);
    await expect.element(none.region).toMatchTextContent(/Jatuh tempo terdekat—tidak ada jadwal/);
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

  it('draws one line under the first row of the 2 × 2 tablet grid and none under the last', async () => {
    await page.viewport(1024, 768);
    const { region } = await kpisOf(debtKpis([], [], d('2026-10-15'), 'IDR'), d('2026-10-15'));
    const bottoms = [...region.element().children].map((kpi) => getComputedStyle(kpi).borderBottomWidth);
    expect(bottoms).toEqual(['1px', '1px', '0px', '0px']);
  });
});
