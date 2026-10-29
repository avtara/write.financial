// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { octoberInputs } from '../../../test/calendar-fixtures.ts';
import { day, scheduledItem } from '../../../test/dashboard-fixtures.ts';
import { CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import { weekStats } from './calendar-model.ts';
import { WeekView } from './week-view.tsx';

const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');

function renderWeek(first: string, safeDailyMinor: bigint | null, inputs = octoberInputs()) {
  return renderApp(
    <WeekView
      week={weekStats(d(first), inputs)}
      today={TODAY}
      safeDailyMinor={safeDailyMinor}
      categories={CATEGORIES}
      baseCurrency="IDR"
      timeZone="Asia/Jakarta"
      locale="id"
    />,
  );
}

describe('WeekView', () => {
  it('golden: this week so far, vs the same days last week, income, bills ahead, and the safe limit × 3 days', async () => {
    const { screen } = await renderWeek('2026-10-12', 140_000n);
    const kpis = screen.getByRole('region', { name: 'Ringkasan kalender' });
    await expect.element(kpis).toMatchTextContent(/Keluar minggu ini−Rp200\.0004 hari · rata-rata Rp50\.000/);
    await expect.element(kpis).toMatchTextContent(/vs Sen–Kam lalu−84,00%5–8 Okt: Rp1\.250\.000/);
    await expect.element(kpis).toMatchTextContent(/Masuk\+Rp6\.250\.000Studio Arunika · 14 Okt/);
    await expect.element(kpis).toMatchTextContent(/TerjadwalRp186\.000Netflix · Minggu, 18 Okt/);
    await expect.element(kpis).toMatchTextContent(/Batas aman sisa mingguRp420\.000Rp140\.000 × 3 hari$/);

    const days = screen.getByRole('region', { name: 'Hari dalam minggu ini' }).getByRole('listitem');
    const wednesday = screen.getByRole('listitem', { name: 'Rabu, 14 Oktober 2026' });
    await expect
      .element(wednesday)
      .toMatchTextContent(
        /^Rab14\+6\.152\.000surplus10\.20Starbucks−Rp48\.00021\.03Studio Arunika\+Rp6\.200\.000Catat$/,
      );
    const thursday = screen.getByRole('listitem', { name: 'Kamis, 15 Oktober 2026' });
    await expect.element(thursday).toHaveAttribute('data-today', 'true');
    await expect.element(thursday).toMatchTextContent(/Hari ini/);
    await expect
      .element(screen.getByRole('listitem', { name: 'Jumat, 16 Oktober 2026' }))
      .toMatchTextContent(/^Jum16Batas Rp140\.000$/);
    await expect
      .element(screen.getByRole('listitem', { name: 'Minggu, 18 Oktober 2026' }))
      .toMatchTextContent(/terjadwalNetflix−Rp186\.000/);
    expect(days.elements().length).toBeGreaterThan(7);
    await screen.getByRole('button', { name: 'Catat di 14 Okt' }).click();
    expect(record.open).toHaveBeenCalledWith({ date: '2026-10-14', time: '12:00' });
  });

  it('shows transfers unsigned and kinds by their edge; no safe limit without a budget', async () => {
    const { screen } = await renderWeek('2026-09-28', null);
    const payday = screen.getByRole('listitem', { name: 'Kamis, 1 Oktober 2026' });
    await expect.element(payday).toMatchTextContent(/Ke GotradeRp6\.000\.000/);
    const cards = [...payday.element().querySelectorAll('li')].map((card) => card.className);
    expect(cards.some((name) => name.includes('border-l-green'))).toBe(true);
    expect(cards.some((name) => name.includes('border-l-blue'))).toBe(true);
    expect(cards.some((name) => name.includes('border-l-subtle'))).toBe(true);
    await expect
      .element(screen.getByRole('region', { name: 'Ringkasan kalender' }))
      .toMatchTextContent(/Batas aman sisa minggu—atur anggaran dulu$/);
  });

  it('has no comparison or income before the week starts, and other edges for uncategorized and unnamed', async () => {
    const { screen } = await renderWeek(
      '2026-10-19',
      null,
      octoberInputs({
        scheduled: [
          scheduledItem({ sourceId: 'pay', dueDate: d('2026-10-20'), name: null, direction: 'in' }),
          scheduledItem({ sourceId: 'bill', dueDate: d('2026-10-21'), name: null }),
        ],
      }),
    );
    const kpis = screen.getByRole('region', { name: 'Ringkasan kalender' });
    await expect.element(kpis).toMatchTextContent(/vs Sen–Sen lalu—/);
    await expect.element(kpis).toMatchTextContent(/MasukRp0Terjadwal/);
    await expect.element(kpis).toMatchTextContent(/TerjadwalRp186\.000Terjadwal · Rabu/);
    await expect
      .element(screen.getByRole('listitem', { name: 'Jumat, 23 Oktober 2026' }))
      .toMatchTextContent(/^Jum23$/);
    await expect
      .element(screen.getByRole('listitem', { name: 'Selasa, 20 Oktober 2026' }))
      .toMatchTextContent(/Terjadwal\+Rp186\.000/);
    await screen.unmount();

    const lunch = await renderWeek('2026-10-05', 140_000n);
    const sunday = lunch.screen.getByRole('listitem', { name: 'Minggu, 11 Oktober 2026' });
    await expect.element(sunday).toMatchTextContent(/Tanpa catatan−Rp50\.000/);
    const edges = [...sunday.element().querySelectorAll('li')].map((card) => card.className);
    expect(edges.some((name) => name.includes('border-l-border'))).toBe(true);
    expect(edges.some((name) => name.includes('border-l-violet'))).toBe(true);
    await lunch.screen.unmount();

    const income = (id: string, description: string | null) =>
      transactionRow(id, {
        type: 'income',
        localDate: d('2026-10-20'),
        merchant: null,
        description,
        amountMinor: 10_000n,
        amountBaseMinor: 10_000n,
      });
    for (const [description, label] of [
      ['Refund', 'Refund'],
      [null, 'Tanpa catatan'],
    ] as const) {
      const rendered = await renderWeek(
        '2026-10-19',
        null,
        octoberInputs({ rows: [income('in', description)], days: [day('2026-10-20', 0n, 10_000n, 1)] }),
      );
      await expect
        .element(rendered.screen.getByRole('region', { name: 'Ringkasan kalender' }))
        .toMatchTextContent(new RegExp(`Masuk\\+Rp10\\.000${label} · 20 Okt`));
      await rendered.screen.unmount();
    }
  });
});
