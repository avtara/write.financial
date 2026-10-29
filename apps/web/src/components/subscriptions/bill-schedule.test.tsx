// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { subscription } from '../../../test/dashboard-fixtures.ts';
import { ACCOUNTS, CARD, GOTRADE, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { S_CHATGPT, S_ICLOUD, S_NETFLIX, S_SPOTIFY, seedOverview } from '../../../test/subscription-fixtures.ts';
import { BillSchedule, type BillScheduleProps } from './bill-schedule.tsx';

const d = (value: string) => value as LocalDate;

async function renderSchedule(patch: Partial<BillScheduleProps> = {}, locale: 'id' | 'en' = 'id') {
  const handlers = {
    onConfirm: vi.fn(),
    onNotCharged: vi.fn(),
    onPause: vi.fn(),
    onOpen: vi.fn(),
    onTopUp: vi.fn(),
    onChangeAccount: vi.fn(),
  };
  const { screen } = await renderApp(
    <BillSchedule overview={seedOverview()} accounts={ACCOUNTS} locale={locale} {...handlers} {...patch} />,
    { preferences: { locale } },
  );
  return { screen, ...handlers };
}

describe('BillSchedule', () => {
  it('golden: October’s bills on the day axis, the overdue iCloud+ and the short OVO, and the sums', async () => {
    const { screen, onConfirm, onNotCharged, onOpen, onTopUp, onChangeAccount } = await renderSchedule();
    const card = screen.getByRole('region', { name: 'Jadwal tagihan Oktober' });
    await expect.element(card.getByText('1 tagihan lewat tanggal tapi belum tercatat')).toBeVisible();
    await expect
      .element(card.getByText(/iCloud\+ Rp45\.000 seharusnya ditagih 9 Okt\. Sudah terpotong dari BCA Tahapan\?/))
      .toBeVisible();
    await card.getByRole('button', { name: 'Ya, catat' }).click();
    expect(onConfirm).toHaveBeenCalledWith(S_ICLOUD, 'occ-icloud-2026-10-09');
    await card.getByRole('button', { name: 'Belum ditagih' }).click();
    expect(onNotCharged).toHaveBeenCalledWith(S_ICLOUD, 'occ-icloud-2026-10-09');

    // Spotify pays from OVO (Rp86.000) on 20 Okt.
    await expect.element(card.getByText(/^Spotify Rp86\.900 · Selasa, 20 Okt dari OVO$/)).toBeVisible();
    await expect.element(card.getByText('Saldo OVO Rp86.000 — kurang Rp900')).toBeVisible();
    await card.getByRole('button', { name: 'Top-up' }).click();
    expect(onTopUp).toHaveBeenCalledWith(expect.objectContaining({ account: OVO, shortMinor: 900n }));
    await card.getByRole('button', { name: 'Ganti rekening' }).click();
    expect(onChangeAccount).toHaveBeenCalledWith(S_SPOTIFY);

    const days = card.getByRole('list', { name: 'Jadwal tagihan Oktober' });
    await expect.element(days.getByRole('button', { name: 'Netflix, 18 Okt, Akan ditagih' })).toBeVisible();
    await expect
      .element(days.getByRole('button', { name: 'Fit Hub, 3 Okt, Sudah dibayar' }))
      .toHaveAttribute('data-status', 'paid');
    await days.getByRole('button', { name: 'iCloud+, 9 Okt, Belum dikonfirmasi' }).click();
    expect(onOpen).toHaveBeenCalledWith(S_ICLOUD);
    await expect.element(days).toMatchTextContent(/Hari ini/);
    await expect.element(days).toMatchTextContent(/18152229$/);

    await expect.element(card.getByText('Rp859.900')).toBeVisible();
    await expect.element(card.getByText('Fit Hub, Niagahoster')).toBeVisible();
    await expect.element(card.getByText(/^iCloud\+ · 9 Okt/)).toBeVisible();
    await expect.element(card.getByText('Rp660.900').last()).toBeVisible();
    await expect.element(card.getByText('4 tagihan')).toBeVisible();
    await expect.element(card.getByText('ChatGPT · 28 Okt')).toBeVisible();
    onOpen.mockClear();
    await card.getByRole('button', { name: 'Tinjau' }).click();
    expect(onOpen).toHaveBeenCalledWith(S_ICLOUD);
  });

  it('stacks bills a few days apart, each label right above its own icon, and no labels touching', async () => {
    const { screen } = await renderSchedule();
    const days = screen.getByRole('list', { name: 'Jadwal tagihan Oktober' });
    const stacks = days.getByRole('listitem');
    // 3 · 5 Okt, 9 Okt, 18 · 20 · 22 Okt, 28 Okt.
    expect(stacks.elements()).toHaveLength(4);
    await expect.element(stacks.nth(0)).toMatchTextContent(/^3 OktRp199\.000.*5 OktRp660\.900.*$/);
    await expect.element(stacks.nth(2)).toMatchTextContent(/^18 OktRp186\.000.*20 OktRp86\.900.*22 OktRp59\.000.*$/);
    const box = (element: Element) => element.getBoundingClientRect();
    const labels = ['3 Okt', '5 Okt', '9 Okt', '18 Okt', '20 Okt', '22 Okt', '28 Okt'].map((day) => {
      const label = days.getByText(day, { exact: true }).element().parentElement as HTMLElement;
      const icon = days.getByRole('button', { name: new RegExp(`, ${day}, `) }).element();
      // The label sits right above its icon, centred on it.
      expect(box(icon).top - box(label).bottom).toBeGreaterThanOrEqual(0);
      expect(box(icon).top - box(label).bottom).toBeLessThan(8);
      expect(Math.abs(box(icon).left + box(icon).width / 2 - (box(label).left + box(label).width / 2))).toBeLessThan(1);
      return box(label);
    });
    for (const [index, a] of labels.entries()) {
      for (const b of labels.slice(index + 1)) {
        const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        expect(apart).toBe(true);
      }
    }
  });

  it('shows a bill’s account, balance after, reminder and status in its tooltip', async () => {
    const { screen } = await renderSchedule();
    await userEvent.hover(screen.getByRole('button', { name: 'Netflix, 18 Okt, Akan ditagih' }));
    const tip = screen.getByRole('tooltip');
    await expect.element(tip).toMatchTextContent(/Minggu, 18 Okt · 3 hari lagi/);
    await expect
      .element(tip)
      .toMatchTextContent(/DariBCA TahapanSaldo setelahRp42\.624\.000PengingatH-1 · 17 OktStatusSaldo cukup/);
    await userEvent.unhover(screen.getByRole('button', { name: 'Netflix, 18 Okt, Akan ditagih' }));
    await userEvent.hover(screen.getByRole('button', { name: 'Spotify, 20 Okt, Akan ditagih' }));
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent(/StatusSaldo kurang/);
  });

  it('tells covered accounts, a bill due tomorrow, and the statuses of bills elsewhere', async () => {
    const tomorrow = seedOverview({
      today: d('2026-10-17'),
      subscriptions: [
        S_NETFLIX,
        { ...S_CHATGPT, nextBill: { ...S_CHATGPT.nextBill, dueDate: d('2026-10-18') } as never },
      ],
      monthSchedule: seedOverview().monthSchedule.filter((bill) => bill.subscriptionId !== 'icloud'),
    });
    const { screen, onPause, onOpen } = await renderSchedule({ overview: tomorrow });
    await expect
      .element(screen.getByText('Saldo BCA Tahapan, Bank Jago cukup untuk semua tagihan tersisa'))
      .toBeVisible();
    await expect.element(screen.getByText(/^Besok: Netflix Rp186\.000$/)).toBeVisible();
    await expect
      .element(screen.getByText('Minggu, 18 Okt dari BCA Tahapan · Saldo cukup. Mau dijeda dulu?'))
      .toBeVisible();
    await expect.element(screen.getByText('Rabu, 28 Okt dari Bank Jago · Saldo cukup. Mau dijeda dulu?')).toBeVisible();
    await screen.getByRole('button', { name: 'Jeda' }).first().click();
    expect(onPause).toHaveBeenCalledWith(S_NETFLIX);
    await screen.getByRole('button', { name: 'Lihat' }).first().click();
    expect(onOpen).toHaveBeenCalledWith(S_NETFLIX);
    await expect.element(screen.getByRole('button', { name: 'Tinjau' })).not.toBeInTheDocument();
  });

  it('warns tomorrow without a balance check across currencies, and with a short one', async () => {
    const usd = subscription({
      id: 'usd',
      name: 'Notion',
      currency: 'USD',
      priceMinor: 1_000n,
      nextBill: { occurrenceId: 'o-usd', dueDate: d('2026-10-16'), status: 'scheduled' },
      nextBillingDate: d('2026-10-16'),
    });
    const short = subscription({
      id: 'short',
      name: 'Gym',
      payFromAccountId: OVO.id,
      priceMinor: 199_000n,
      nextBill: { occurrenceId: 'o-short', dueDate: d('2026-10-16'), status: 'scheduled' },
      nextBillingDate: d('2026-10-16'),
    });
    const lost = subscription({
      id: 'lost',
      name: 'Lost',
      payFromAccountId: 'gone',
      nextBill: { occurrenceId: 'o-lost', dueDate: d('2026-10-16'), status: 'scheduled' },
      nextBillingDate: d('2026-10-16'),
    });
    const { screen } = await renderSchedule(
      { overview: seedOverview({ subscriptions: [usd, short, lost], monthSchedule: [] }) },
      'en',
    );
    await expect.element(screen.getByText('Friday, Oct 16 from BCA Tahapan. Pause it first?')).toBeVisible();
    await expect
      .element(screen.getByText('Friday, Oct 16 from OVO · Not enough balance. Pause it first?'))
      .toBeVisible();
    await expect.element(screen.getByText('Friday, Oct 16 from —. Pause it first?')).toBeVisible();
    await expect.element(screen.getByText('No bills in October yet.')).toBeVisible();
    await expect.element(screen.getByText('No bills left this month')).toBeVisible();
  });

  it('judges tooltips of card, foreign-currency, paid and unknown bills, and skips snoozed warnings', async () => {
    const overview = seedOverview({
      today: d('2026-10-20'),
      subscriptions: [
        { ...S_NETFLIX, payFromAccountId: CARD.id },
        { ...S_SPOTIFY, payFromAccountId: GOTRADE.id, remindDaysBefore: null },
        S_ICLOUD,
      ],
      monthSchedule: [
        ...seedOverview().monthSchedule.filter((bill) =>
          ['netflix', 'spotify', 'icloud'].includes(bill.subscriptionId),
        ),
        {
          occurrenceId: 'o-x',
          subscriptionId: 'missing',
          name: 'Ghost',
          icon: null,
          dueDate: d('2026-10-20'),
          amountMinor: 10n,
          currency: 'USD',
          status: 'will_charge',
        },
      ],
    });
    const { screen, onOpen } = await renderSchedule({ overview, snoozed: ['occ-icloud-2026-10-09'] });
    await expect.element(screen.getByText('Ya, catat')).not.toBeInTheDocument();
    await expect.element(screen.getByText('1 tagihan lewat tanggal tapi belum tercatat')).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole('button', { name: 'Netflix, 18 Okt, Akan ditagih' }));
    await expect
      .element(screen.getByRole('tooltip'))
      .toMatchTextContent(/^NetflixMinggu, 18 OktDariBCA Visa.*StatusAkan ditagih$/);
    await userEvent.unhover(screen.getByRole('button', { name: 'Netflix, 18 Okt, Akan ditagih' }));
    await userEvent.hover(screen.getByRole('button', { name: 'Spotify, 20 Okt, Akan ditagih' }));
    await expect
      .element(screen.getByRole('tooltip'))
      .toMatchTextContent(/^SpotifySelasa, 20 Okt · hari iniDariGotradeStatusAkan ditagih$/);
    await userEvent.unhover(screen.getByRole('button', { name: 'Spotify, 20 Okt, Akan ditagih' }));
    await userEvent.hover(screen.getByRole('button', { name: 'iCloud+, 9 Okt, Belum dikonfirmasi' }));
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent(/StatusBelum dikonfirmasi$/);
    await userEvent.unhover(screen.getByRole('button', { name: 'iCloud+, 9 Okt, Belum dikonfirmasi' }));
    await userEvent.hover(screen.getByRole('button', { name: 'Ghost, 20 Okt, Akan ditagih' }));
    await expect
      .element(screen.getByRole('tooltip'))
      .toMatchTextContent(/DariStatusAkan ditagih|Dari—StatusAkan ditagih/);
    await screen.getByRole('button', { name: 'Ghost, 20 Okt, Akan ditagih' }).click();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('heads the card with a short paying account when nothing is overdue', async () => {
    const overview = seedOverview({
      subscriptions: seedOverview().subscriptions.filter((view) => view.id !== 'icloud'),
      monthSchedule: seedOverview().monthSchedule.filter((bill) => bill.subscriptionId !== 'icloud'),
    });
    const { screen } = await renderSchedule({ overview });
    await expect.element(screen.getByText('Saldo OVO tidak cukup untuk 1 tagihan')).toBeVisible();
  });

  it('names no account it does not know, and opens nothing for a bill without its subscription', async () => {
    const overview = seedOverview({
      subscriptions: [{ ...S_ICLOUD, id: 'other', payFromAccountId: 'gone' }],
      monthSchedule: seedOverview().monthSchedule.filter((bill) => bill.subscriptionId === 'icloud'),
    });
    const { screen, onOpen } = await renderSchedule({ overview });
    await expect.element(screen.getByText(/seharusnya ditagih 9 Okt\. Sudah terpotong dari —\?/)).toBeVisible();
    await screen.getByRole('button', { name: 'Tinjau' }).click();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

it('retains service branding on the scheduled bill after loading a saved catalog association', async () => {
  const overview = seedOverview({ subscriptions: [{ ...S_NETFLIX, catalogId: 'service:netflix' }] });
  const { screen } = await renderSchedule({ overview });
  const bill = screen.getByRole('button', { name: 'Netflix, 18 Okt, Akan ditagih' }).element();
  expect(bill.querySelector('img')?.getAttribute('src')).toBe('/catalog-logos/netflix.svg');
});
