// SPDX-License-Identifier: AGPL-3.0-only
import type { BillingHistory } from '@wf/db/schedules';
import type { LocalDate } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ACCOUNTS, CATEGORIES, JAGO, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { S_CANVA, S_CHATGPT, S_HEADSPACE, S_NETFLIX } from '../../../test/subscription-fixtures.ts';
import { SubscriptionDetail, type SubscriptionDetailProps } from './subscription-detail.tsx';

const fns = vi.hoisted(() => ({ getSubscriptionBilling: vi.fn() }));
vi.mock('../../server/fn/schedules.ts', () => fns);

const d = (value: string) => value as LocalDate;
const HISTORY: BillingHistory = {
  charges: [
    {
      occurrenceId: 'o3',
      dueDate: d('2026-09-28'),
      transactionId: 't3',
      localDate: d('2026-09-28'),
      amountMinor: 329_000n,
      accountId: JAGO.id,
      confirmedAt: new Date(),
    },
    {
      occurrenceId: 'o2',
      dueDate: d('2026-08-28'),
      transactionId: 't2',
      localDate: d('2026-08-28'),
      amountMinor: 299_000n,
      accountId: JAGO.id,
      confirmedAt: new Date(),
    },
    {
      occurrenceId: 'o1',
      dueDate: d('2026-07-28'),
      transactionId: 't1',
      localDate: d('2026-07-29'),
      amountMinor: 299_000n,
      accountId: 'gone',
      confirmedAt: new Date(),
    },
  ],
  count: 3,
  totalPaidMinor: 927_000n,
  priceIncrease: S_CHATGPT.priceIncrease,
};

function handlers() {
  return {
    onOpenChange: vi.fn(),
    onEdit: vi.fn(),
    onMarkPaid: vi.fn(),
    onPause: vi.fn(),
    onCancel: vi.fn(),
    onReactivate: vi.fn(),
    onRate: vi.fn(),
    onChangeAccount: vi.fn(),
  };
}

async function renderDetail(subscription: SubscriptionDetailProps['subscription'], today = d('2026-10-15')) {
  const on = handlers();
  const { screen } = await renderApp(
    <SubscriptionDetail
      subscription={subscription}
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      today={today}
      timeZone="Asia/Jakarta"
      locale="id"
      {...on}
    />,
  );
  return { screen, on };
}

beforeEach(() => {
  fns.getSubscriptionBilling.mockReset();
});

describe('SubscriptionDetail', () => {
  it('golden: ChatGPT Plus with its next bill, account, total paid, price history and last bills', async () => {
    fns.getSubscriptionBilling.mockResolvedValue({ ok: true, value: HISTORY });
    const { on } = await renderDetail({ ...S_CHATGPT, description: 'Akun kerja' });
    const sheet = page.getByRole('dialog', { name: 'ChatGPT' });
    await expect.element(sheet).toMatchTextContent(/PlusTanpa kategori · aktif sejak Mar 2025/);
    await expect.element(sheet).toMatchTextContent(/Rp329\.000\/bulan · Rp3\.950\.000\/tahun/);
    await expect.element(sheet.getByText('Akun kerja')).toBeVisible();
    await expect.element(sheet).toMatchTextContent(/BerikutnyaRabu, 28 Okt13 hari lagi/);
    await expect.element(sheet).toMatchTextContent(/DariBank JagoGantiSaldo cukup/);
    await expect.element(sheet).toMatchTextContent(/Total dibayarRp6\.040\.00020 tagihan/);
    await expect.element(sheet).toMatchTextContent(/Riwayat harga\+10,03% sejak Sep/);
    await expect.element(sheet.getByText(/Rp299\.000 → Rp329\.000 · naik mulai tagihan September 2026/)).toBeVisible();
    const bills = sheet.getByRole('list').last().getByRole('listitem');
    await expect.element(bills.nth(0)).toMatchTextContent(/^28 Sep 2026Bank Jago · dikonfirmasi 28 Sep−Rp329\.000$/);
    await expect.element(bills.nth(2)).toMatchTextContent(/^28 Jul 2026— · dikonfirmasi 29 Jul−Rp299\.000$/);
    expect(sheet.element().querySelectorAll('rect.fill-green')).toHaveLength(1);
    expect(fns.getSubscriptionBilling).toHaveBeenCalledWith({ data: { id: 'chatgpt' } });

    await sheet.getByRole('button', { name: 'Sering' }).click();
    expect(on.onRate).toHaveBeenCalledWith(expect.objectContaining({ id: 'chatgpt' }), 'often');
    await expect.element(sheet.getByRole('button', { name: 'Sering' })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(sheet.getByText('Dinilai 1 Okt · ditanya lagi 1 Nov')).toBeVisible();

    for (const [name, handler] of [
      ['Edit', on.onEdit],
      ['Tandai sudah dibayar', on.onMarkPaid],
      ['Jeda', on.onPause],
      ['Batalkan', on.onCancel],
    ] as const) {
      await sheet.getByRole('button', { name, exact: true }).click();
      expect(handler).toHaveBeenCalled();
    }

    await sheet.getByRole('button', { name: 'Ganti', exact: true }).click();
    await page.getByRole('option', { name: /^OVO/ }).click();
    expect(on.onChangeAccount).toHaveBeenCalledWith(expect.objectContaining({ id: 'chatgpt' }), OVO);
    await sheet.getByRole('button', { name: 'Ganti', exact: true }).click();
    await page.getByRole('option', { name: /^Bank Jago/ }).click();
    expect(on.onChangeAccount).toHaveBeenCalledTimes(1);
  });

  it('shows a short balance, an overdue or due-today bill, no charges yet, and a failed history', async () => {
    fns.getSubscriptionBilling.mockResolvedValue({ ok: true, value: { ...HISTORY, charges: [], priceIncrease: null } });
    const short = await renderDetail({ ...S_NETFLIX, payFromAccountId: OVO.id, ratedAt: null });
    await expect.element(page.getByRole('dialog')).toMatchTextContent(/DariOVOGantiSaldo kurang/);
    await expect.element(page.getByText('Belum ada tagihan yang dikonfirmasi.')).toBeVisible();
    await expect.element(page.getByText(/^Dinilai/)).not.toBeInTheDocument();
    await short.screen.unmount();

    fns.getSubscriptionBilling.mockResolvedValue({ ok: true, value: { ...HISTORY, priceIncrease: null } });
    const overdue = await renderDetail({ ...S_NETFLIX, payFromAccountId: 'gone' }, d('2026-10-20'));
    await expect.element(page.getByRole('dialog')).toMatchTextContent(/Berikutnya.*belum dikonfirmasiDari—Ganti/);
    await expect.element(page.getByText('28 Sep 2026')).toBeVisible();
    expect(page.getByRole('dialog').element().querySelectorAll('rect.fill-green')).toHaveLength(0);
    await overdue.screen.unmount();

    const unscheduled = await renderDetail({ ...S_NETFLIX, nextBill: null });
    await expect.element(page.getByRole('button', { name: 'Tandai sudah dibayar' })).not.toBeInTheDocument();
    await unscheduled.screen.unmount();

    fns.getSubscriptionBilling.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    const today = await renderDetail({ ...S_NETFLIX, payFromAccountId: 'acc-gotrade' }, d('2026-10-18'));
    await expect.element(page.getByRole('dialog')).toMatchTextContent(/hari ini/);
    await expect.element(page.getByRole('dialog')).not.toMatchTextContent(/Saldo cukup|Saldo kurang/);
    await expect
      .element(page.getByRole('dialog').getByText('Data ini sudah tidak ada. Muat ulang halaman.'))
      .toBeVisible();
    await today.screen.unmount();
  });

  it('offers Aktifkan lagi for paused and cancelled ones, and nothing about usage', async () => {
    fns.getSubscriptionBilling.mockReturnValue(Promise.withResolvers().promise);
    const paused = await renderDetail({ ...S_HEADSPACE, nextBill: null });
    const sheet = page.getByRole('dialog', { name: 'Headspace' });
    await expect.element(sheet.getByText('Memuat riwayat tagihan…')).toBeVisible();
    await expect.element(sheet).toMatchTextContent(/Berikutnya—/);
    await expect.element(sheet.getByText('Seberapa sering dipakai?')).not.toBeInTheDocument();
    await sheet.getByRole('button', { name: 'Aktifkan lagi' }).click();
    expect(paused.on.onReactivate).toHaveBeenCalled();
    await expect.element(sheet.getByRole('button', { name: 'Batalkan' })).toBeVisible();
    await paused.screen.unmount();

    const cancelled = await renderDetail({ ...S_CANVA, cycle: 'yearly', plan: null, categoryId: 'cat-entertainment' });
    const other = page.getByRole('dialog', { name: 'Canva Pro' });
    await expect.element(other).toMatchTextContent(/Hiburan · aktif sejak/);
    await expect.element(other).toMatchTextContent(/Rp95\.000\/tahun/);
    await expect.element(other.getByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    await expect.element(other.getByRole('button', { name: 'Batalkan' })).not.toBeInTheDocument();
    await expect.element(other.getByRole('button', { name: 'Ganti' })).not.toBeInTheDocument();
    await cancelled.screen.unmount();

    await renderDetail(null);
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores a history that arrives after closing', async () => {
    const pending = Promise.withResolvers<{ ok: true; value: BillingHistory }>();
    fns.getSubscriptionBilling.mockReturnValue(pending.promise);
    const { screen } = await renderDetail(S_CHATGPT);
    await screen.unmount();
    pending.resolve({ ok: true, value: HISTORY });
    await pending.promise;
    expect(fns.getSubscriptionBilling).toHaveBeenCalledOnce();
  });
});
