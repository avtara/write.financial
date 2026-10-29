// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { scheduledItem } from '../../../test/dashboard-fixtures.ts';
import { goalView } from '../../../test/goal-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { billsAhead, BillsCard, GoalsCard } from './extra-cards.tsx';

const TODAY = '2026-10-15' as LocalDate;
const d = (value: string) => value as LocalDate;

describe('GoalsCard', () => {
  it('shows each goal saved against its target, capped at full, four at most', async () => {
    const goals = [
      goalView({ id: 'g1', name: 'Dana Darurat', savedMinor: 30_000_000n, targetMinor: 40_000_000n, currency: 'IDR' }),
      goalView({ id: 'g2', name: 'Liburan', savedMinor: 9_000_000n, targetMinor: 6_000_000n, currency: 'IDR' }),
      goalView({ id: 'g3', name: 'Laptop', savedMinor: 0n, targetMinor: 0n, currency: 'IDR' }),
      goalView({ id: 'g4', name: 'Motor', savedMinor: 1n, targetMinor: 2n, currency: 'IDR' }),
      goalView({ id: 'g5', name: 'Kelima', savedMinor: 1n, targetMinor: 2n, currency: 'IDR' }),
    ];
    const { screen } = await renderApp(<GoalsCard goals={goals} locale="id" />);
    const card = screen.getByRole('region', { name: 'Tujuan tabungan' });
    await expect.element(card).toMatchTextContent(/Dana DaruratRp30\.000\.000 \/ Rp40\.000\.000/);
    await expect
      .element(card.getByRole('progressbar', { name: 'Dana Darurat' }))
      .toHaveAttribute('aria-valuenow', '75');
    await expect.element(card.getByRole('progressbar', { name: 'Liburan' })).toHaveAttribute('aria-valuenow', '100');
    // A target of zero has no share yet.
    await expect.element(card.getByRole('progressbar', { name: 'Laptop' })).toHaveAttribute('aria-valuenow', '0');
    expect(card.getByText('Kelima').query()).toBeNull();
    await expect.element(card.getByRole('link', { name: 'Lihat semua' })).toHaveAttribute('href', '/goals');
  });

  it('says when there is no active goal or the goals could not load', async () => {
    const { screen } = await renderApp(
      <>
        <GoalsCard goals={[]} locale="id" />
        <GoalsCard goals={null} locale="id" />
      </>,
    );
    await expect.element(screen.getByText('Belum ada tujuan aktif.')).toBeVisible();
    await expect.element(screen.getByText('Kartu ini tidak bisa dimuat.')).toBeVisible();
  });
});

describe('billsAhead', () => {
  it('keeps the unpaid outgoing bills from today through 6 days later, soonest first', () => {
    const keep = [
      scheduledItem({ sourceId: 'late', dueDate: d('2026-10-21') }),
      scheduledItem({ sourceId: 'today', dueDate: TODAY, status: 'due_review' }),
      scheduledItem({ sourceId: 'unconfirmed', dueDate: d('2026-10-16'), status: 'unconfirmed' }),
    ];
    const drop = [
      scheduledItem({ sourceId: 'yesterday', dueDate: d('2026-10-14') }),
      scheduledItem({ sourceId: 'day-8', dueDate: d('2026-10-22') }),
      scheduledItem({ sourceId: 'income', dueDate: TODAY, direction: 'in' }),
      scheduledItem({ sourceId: 'paid', dueDate: TODAY, transactionId: 'tx-1' }),
      scheduledItem({ sourceId: 'confirmed', dueDate: TODAY, status: 'confirmed' }),
      scheduledItem({ sourceId: 'skipped', dueDate: TODAY, status: 'skipped' }),
    ];
    expect(billsAhead([...drop, ...keep], TODAY).map((item) => item.sourceId)).toEqual([
      'today',
      'unconfirmed',
      'late',
    ]);
  });
});

describe('BillsCard', () => {
  it('lists what is due with the day and how soon, linking to the calendar', async () => {
    const items = [
      scheduledItem({ sourceId: 'netflix', dueDate: TODAY }),
      scheduledItem({ sourceId: 'pln', dueDate: d('2026-10-18'), name: null, expectedMinor: 350_000n }),
    ];
    const { screen } = await renderApp(<BillsCard items={items} today={TODAY} locale="id" />);
    const card = screen.getByRole('region', { name: 'Pengingat tagihan' });
    const rows = card.getByRole('listitem');
    await expect.element(rows.first()).toMatchTextContent(/Netflix15 Okt · hari iniRp186\.000/i);
    await expect.element(rows.last()).toMatchTextContent(/Tagihan tanpa nama18 Okt · 3 hari lagiRp350\.000/i);
    await expect.element(card.getByRole('link', { name: 'Lihat semua' })).toHaveAttribute('href', '/calendar');
  });

  it('says when nothing is due or the bills could not load', async () => {
    const { screen } = await renderApp(
      <>
        <BillsCard items={[scheduledItem({ sourceId: 'old', dueDate: d('2026-10-01') })]} today={TODAY} locale="id" />
        <BillsCard items={null} today={TODAY} locale="id" />
      </>,
    );
    await expect.element(screen.getByText('Tidak ada tagihan dalam 7 hari ke depan.')).toBeVisible();
    await expect.element(screen.getByText('Kartu ini tidak bisa dimuat.')).toBeVisible();
  });
});
