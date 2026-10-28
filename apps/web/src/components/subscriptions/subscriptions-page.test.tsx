// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ACCOUNTS, CATEGORIES, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import {
  S_CANVA,
  S_HEADSPACE,
  S_NETFLIX,
  detectedOverview,
  seedOverview,
} from '../../../test/subscription-fixtures.ts';
import { SubscriptionsPage, type SubscriptionsPageProps } from './subscriptions-page.tsx';

const schedules = vi.hoisted(() => ({
  addDetectedSubscriptions: vi.fn(),
  cancelSubscription: vi.fn(),
  changeSubscriptionAccount: vi.fn(),
  deleteSubscription: vi.fn(),
  dismissDetectedSubscriptions: vi.fn(),
  pauseSubscription: vi.fn(),
  rateSubscriptionUsage: vi.fn(),
  reactivateSubscription: vi.fn(),
  getSubscriptionBilling: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  setSubscriptionLogo: vi.fn(),
  removeSubscriptionLogo: vi.fn(),
}));
vi.mock('../../server/fn/schedules.ts', () => schedules);
const review = vi.hoisted(() => ({
  confirmOccurrence: vi.fn(),
  listReviewItems: vi.fn(),
  markReviewUnpaid: vi.fn(),
}));
vi.mock('../../server/fn/review.ts', () => review);
vi.mock('../../server/fn/ledger.ts', () => ({ getReferenceRate: vi.fn(() => Promise.withResolvers().promise) }));
const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { undo: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@wf/ui/toast', () => toasts);
const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));

const d = (value: string) => value as LocalDate;
const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });
const refused = (code = 'INVALID_SUBSCRIPTION') => Promise.resolve({ ok: false, code });

async function renderPage(patch: Partial<SubscriptionsPageProps> = {}) {
  const onConsumeSearch = vi.fn();
  const rendered = await renderApp(
    <SubscriptionsPage
      overview={seedOverview()}
      detected={detectedOverview()}
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      spentMinor={16_500_000n}
      incomeMinor={26_000_000n}
      timeZone="Asia/Jakarta"
      onConsumeSearch={onConsumeSearch}
      {...patch}
    />,
  );
  const invalidate = vi.spyOn(rendered.router, 'invalidate').mockResolvedValue();
  return { ...rendered, onConsumeSearch, invalidate };
}

beforeEach(async () => {
  await page.viewport(1440, 1000);
  vi.clearAllMocks();
  schedules.getSubscriptionBilling.mockReturnValue(Promise.withResolvers().promise);
});

describe('SubscriptionsPage', () => {
  it('golden: the header, KPIs, schedule, table and cards of 15 Okt; "Ya, catat" goes through the Review queue', async () => {
    const { screen, invalidate, onConsumeSearch } = await renderPage();
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Langganan' })).toBeVisible();
    await expect
      .element(screen.getByText('7 aktif · 4 tagihan tersisa bulan ini · berikutnya Netflix, 3 hari lagi'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('region', { name: 'Ringkasan biaya langganan' }))
      .toMatchTextContent(/Rp904\.900/);
    expect(onConsumeSearch).not.toHaveBeenCalled();

    review.confirmOccurrence.mockReturnValueOnce(ok({ transactionId: 't', overrideIds: [] }));
    await screen.getByRole('button', { name: 'Ya, catat' }).click();
    expect(review.confirmOccurrence).toHaveBeenCalledWith({ data: { occurrenceId: 'occ-icloud-2026-10-09' } });
    expect(toasts.toast).toHaveBeenCalledWith({
      tone: 'success',
      title: 'iCloud+ ditandai sudah dibayar',
      description: 'Tercatat lewat Perlu ditinjau; saldo rekening sudah dipotong.',
    });
    expect(invalidate).toHaveBeenCalled();

    review.confirmOccurrence.mockReturnValueOnce(refused('PERIOD_CLOSED'));
    invalidate.mockClear();
    await screen.getByRole('button', { name: 'Ya, catat' }).click();
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'error', title: expect.any(String) as unknown });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('"Belum ditagih" keeps the bill waiting and stops asking for this visit', async () => {
    for (const queue of [refused(), ok({ items: [{ id: 'other', occurrence: null }], total: 1 })]) {
      const { screen } = await renderPage();
      review.listReviewItems.mockReturnValueOnce(queue);
      // No review item to mark: the warning still goes.
      await screen.getByRole('button', { name: 'Belum ditagih' }).click();
      await expect.element(screen.getByRole('button', { name: 'Belum ditagih' })).not.toBeInTheDocument();
      await screen.unmount();
    }
    expect(review.markReviewUnpaid).not.toHaveBeenCalled();

    const second = await renderPage();
    review.listReviewItems.mockReturnValue(
      ok({ items: [{ id: 'item-icloud', occurrence: { id: 'occ-icloud-2026-10-09' } }], total: 1 }),
    );
    review.markReviewUnpaid.mockReturnValueOnce(refused('REVIEW_RESOLVED')).mockReturnValueOnce(ok(null));
    await second.screen.getByRole('button', { name: 'Belum ditagih' }).click();
    expect(review.markReviewUnpaid).toHaveBeenCalledWith({ data: { itemId: 'item-icloud' } });
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'error', title: expect.any(String) as unknown });
    await second.screen.getByRole('button', { name: 'Belum ditagih' }).click();
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'info', title: 'iCloud+ tetap menunggu di Perlu ditinjau' });
    expect(review.listReviewItems).toHaveBeenCalledWith({ data: { reason: 'due_occurrence', limit: 200 } });
  });

  it('changes the paying account, warning when its balance falls short', async () => {
    const { screen } = await renderPage();
    const change = async () => {
      await screen.getByRole('button', { name: 'Aksi untuk Netflix' }).click();
      await page.getByRole('menuitem', { name: 'Ganti rekening' }).click();
      await userEvent.keyboard('{ArrowRight}');
      await userEvent.keyboard('O');
      await userEvent.keyboard('{Enter}');
    };
    schedules.changeSubscriptionAccount
      .mockReturnValueOnce(
        ok({ effectiveFrom: '2026-10-18', insufficient: { balanceMinor: 86_000n, shortMinor: 100_000n } }),
      )
      .mockReturnValueOnce(ok({ effectiveFrom: '2026-10-18', insufficient: null }))
      .mockReturnValueOnce(ok({ effectiveFrom: null, insufficient: null }));
    await change();
    expect(schedules.changeSubscriptionAccount).toHaveBeenCalledWith({ data: { id: 'netflix', accountId: OVO.id } });
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'warning', title: 'Saldo OVO kurang untuk tagihan 18 Okt' });
    await change();
    expect(toasts.toast).toHaveBeenLastCalledWith({
      tone: 'success',
      title: 'Netflix sekarang dibayar dari OVO',
      description: 'Berlaku mulai tagihan 18 Okt',
    });
    await change();
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Netflix sekarang dibayar dari OVO' });
  });

  // One flow per test: together they outgrow the browser test timeout on a loaded CI runner.
  it('pauses a subscription from its menu, saying when it resumes', async () => {
    const { screen } = await renderPage();
    schedules.pauseSubscription
      .mockReturnValueOnce(ok({ ...S_NETFLIX, pausedUntil: '2026-11-18' }))
      .mockReturnValueOnce(ok({ ...S_NETFLIX, pausedUntil: null }));
    for (const description of [{ description: 'aktif lagi Rabu, 18 Nov' }, {}]) {
      await screen.getByRole('button', { name: 'Aksi untuk Netflix' }).click();
      await page.getByRole('menuitem', { name: 'Jeda' }).click();
      await page.getByRole('dialog', { name: 'Jeda Netflix' }).getByRole('button', { name: 'Jeda 1 bulan' }).click();
      expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Netflix dijeda', ...description });
    }
    expect(schedules.pauseSubscription).toHaveBeenCalledWith({
      data: { id: 'netflix', length: { months: 1 }, remindDaysBefore: 3 },
    });
  });

  it('cancels a subscription after its next bill', async () => {
    const { screen } = await renderPage();
    schedules.cancelSubscription.mockReturnValueOnce(ok(S_NETFLIX));
    await screen.getByRole('button', { name: 'Aksi untuk Netflix' }).click();
    await page.getByRole('menuitem', { name: 'Batalkan langganan' }).click();
    const cancel = page.getByRole('dialog', { name: 'Batalkan Netflix?' });
    await expect.element(cancel).toMatchTextContent(/ditagih 18 Okt dari BCA Tahapan/);
    await cancel.getByRole('checkbox').click();
    await cancel.getByRole('button', { name: 'Batalkan langganan' }).click();
    expect(schedules.cancelSubscription).toHaveBeenCalledWith({ data: { id: 'netflix', mode: 'after_next_bill' } });
  });

  it('reactivates a paused subscription', async () => {
    const { screen } = await renderPage();
    schedules.reactivateSubscription.mockReturnValueOnce(ok(S_HEADSPACE));
    await screen.getByRole('tab', { name: 'Dijeda 1' }).click();
    await screen.getByRole('button', { name: 'Aksi untuk Headspace' }).click();
    await page.getByRole('menuitem', { name: 'Aktifkan lagi' }).click();
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Headspace aktif lagi' });
  });

  it('deletes a cancelled subscription once confirmed', async () => {
    const { screen } = await renderPage();
    schedules.deleteSubscription.mockReturnValueOnce(ok({ deletedOccurrences: 0 }));
    await screen.getByRole('tab', { name: 'Dibatalkan 1' }).click();
    await screen.getByRole('button', { name: 'Aksi untuk Canva Pro' }).click();
    await page.getByRole('menuitem', { name: 'Hapus langganan' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Batal' }).click();
    expect(schedules.deleteSubscription).not.toHaveBeenCalled();
    await screen.getByRole('button', { name: 'Aksi untuk Canva Pro' }).click();
    await page.getByRole('menuitem', { name: 'Hapus langganan' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hapus langganan' }).click();
    expect(schedules.deleteSubscription).toHaveBeenCalledWith({ data: { id: S_CANVA.id } });
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Canva Pro dihapus' });
  });

  it('rates a subscription in the monthly review', async () => {
    const { screen } = await renderPage();
    schedules.rateSubscriptionUsage.mockReturnValueOnce(ok({}));
    await screen.getByRole('region', { name: 'Review bulanan' }).getByRole('button', { name: 'Sering' }).click();
    expect(schedules.rateSubscriptionUsage).toHaveBeenCalledWith({ data: { id: 'youtube', rating: 'often' } });
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Penilaian YouTube Premium disimpan' });
  });

  it('marks a bill paid from the menu', async () => {
    const { screen } = await renderPage();
    review.confirmOccurrence.mockReturnValueOnce(ok({}));
    await screen.getByRole('tab', { name: 'Aktif 7' }).click();
    await screen.getByRole('button', { name: 'Aksi untuk ChatGPT' }).click();
    await page.getByRole('menuitem', { name: /^Tandai sudah dibayar/ }).click();
    expect(review.confirmOccurrence).toHaveBeenCalledWith({ data: { occurrenceId: 'occ-chatgpt-2026-10-28' } });
  });

  it('opens a subscription from the search, edits it, and adds a new one', async () => {
    const { screen, onConsumeSearch } = await renderPage({ initialSubscriptionId: 'netflix' });
    expect(onConsumeSearch).toHaveBeenCalledOnce();
    const sheet = page.getByRole('dialog', { name: 'Netflix' });
    await expect.element(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Edit' }).click();
    schedules.updateSubscription.mockReturnValueOnce(ok({ ...S_NETFLIX }));
    await page
      .getByRole('dialog', { name: 'Edit langganan' })
      .getByRole('button', { name: 'Simpan perubahan' })
      .click();
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Netflix disimpan' });
    await expect.element(page.getByRole('dialog', { name: 'Edit langganan' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog', { name: 'Netflix' })).not.toBeInTheDocument();

    await screen.getByRole('region', { name: 'Semua langganan' }).getByRole('button', { name: 'Spotify' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Spotify' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await screen.getByRole('button', { name: 'Tambah langganan' }).click();
    const form = page.getByRole('dialog', { name: 'Langganan baru' });
    await form.getByRole('button', { name: 'Batal' }).click();
    await expect.element(form).not.toBeInTheDocument();
  });

  it('opens what a later search asks for while the page stays (⌘K on this page)', async () => {
    const onConsumeSearch = vi.fn();
    function Searching() {
      const [search, setSearch] = useState<{ id?: string; isNew?: boolean }>({});
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setSearch({ id: 'chatgpt' });
            }}
          >
            find
          </button>
          <button
            type="button"
            onClick={() => {
              setSearch({ isNew: true });
            }}
          >
            new
          </button>
          <SubscriptionsPage
            overview={seedOverview()}
            detected={detectedOverview()}
            accounts={ACCOUNTS}
            categories={CATEGORIES}
            spentMinor={16_500_000n}
            incomeMinor={26_000_000n}
            timeZone="Asia/Jakarta"
            onConsumeSearch={onConsumeSearch}
            {...(search.id === undefined ? {} : { initialSubscriptionId: search.id })}
            {...(search.isNew === true ? { initialNew: true } : {})}
          />
        </>
      );
    }
    const { screen } = await renderApp(<Searching />);
    expect(onConsumeSearch).not.toHaveBeenCalled();
    await screen.getByRole('button', { name: 'find', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: 'ChatGPT' })).toBeVisible();
    expect(onConsumeSearch).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Escape}');
    await screen.getByRole('button', { name: 'new', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: 'Langganan baru' })).toBeVisible();
    expect(onConsumeSearch).toHaveBeenCalledTimes(2);
  });

  it('opens the form from `?new`, and records a top-up for a short account', async () => {
    const { screen, onConsumeSearch } = await renderPage({ initialNew: true });
    expect(onConsumeSearch).toHaveBeenCalledOnce();
    schedules.createSubscription.mockReturnValueOnce(ok({ ...S_NETFLIX, id: 'n', name: 'Vidio' }));
    const form = page.getByRole('dialog', { name: 'Langganan baru' });
    await form.getByRole('textbox', { name: 'Layanan' }).fill('Vidio');
    await form.getByRole('textbox', { name: 'Harga' }).fill('39.000');
    await form.getByRole('button', { name: 'Simpan langganan' }).click();
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Vidio ditambahkan' });
    await screen.getByRole('button', { name: 'Top-up' }).click();
    expect(record.open).toHaveBeenCalledWith({ type: 'transfer', toAccountId: OVO.id, amountMinor: 900n });
  });

  it('opens detection from the header: a button from 1024 px, folded into ⋯ below (FR-TB3)', async () => {
    const { screen } = await renderPage();
    await screen.getByRole('button', { name: 'Deteksi dari transaksi · 2 baru' }).click();
    await expect.element(page.getByRole('heading', { name: '2 tagihan berulang terdeteksi' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('heading', { name: '2 tagihan berulang terdeteksi' })).not.toBeInTheDocument();

    await page.viewport(768, 1000);
    await expect.poll(() => screen.getByRole('button', { name: 'Deteksi dari transaksi · 2 baru' }).query()).toBeNull();
    await expect.element(screen.getByRole('button', { name: 'Tambah langganan' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Aksi lainnya' }));
    await page.getByRole('menuitem', { name: 'Deteksi dari transaksi · 2 baru' }).click();
    await expect.element(page.getByRole('heading', { name: '2 tagihan berulang terdeteksi' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('adds and dismisses detected candidates, compares overlaps, and filters by category', async () => {
    const { screen } = await renderPage();
    schedules.addDetectedSubscriptions.mockReturnValueOnce(ok({ subscriptionIds: ['a', 'b'] }));
    schedules.dismissDetectedSubscriptions.mockReturnValueOnce(ok({ dismissed: 1 }));
    await screen.getByRole('region', { name: 'Bisa dihemat' }).getByRole('button', { name: 'Tinjau' }).click();
    const panel = page.getByRole('dialog');
    // "Tinjau" sits further down the page: opening scrolls the header the panel hangs off back into view.
    await expect.element(panel).toBeInViewport();
    await panel.getByRole('button', { name: 'Tambah semua' }).click();
    expect(schedules.addDetectedSubscriptions).toHaveBeenCalledWith({ data: { ids: ['det-vidio', 'det-google'] } });
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: '2 langganan ditambahkan' });
    await panel.getByRole('button', { name: 'Bukan langganan' }).first().click();
    await expect.poll(() => schedules.dismissDetectedSubscriptions.mock.calls.length).toBe(1);
    expect(schedules.dismissDetectedSubscriptions).toHaveBeenCalledWith({ data: { ids: ['det-vidio'] } });
    await userEvent.keyboard('{Escape}');

    await screen.getByRole('button', { name: 'Bandingkan' }).click();
    await expect.element(screen.getByText('Fungsi dobel: musik').last()).toBeVisible();
    expect(screen.getByRole('region', { name: 'Semua langganan' }).getByRole('row').elements()).toHaveLength(3);
    const legend = screen.getByRole('list', { name: 'Saring tabel per kategori' });
    await legend.getByRole('button', { name: /^Hiburan/ }).click();
    await expect.element(screen.getByText(/^3 langganan Hiburan/)).toBeVisible();
    await legend.getByRole('button', { name: /^Hiburan/ }).click();
    await expect.element(screen.getByText(/^3 langganan Hiburan/)).not.toBeInTheDocument();
    await legend.getByRole('button', { name: /^Tanpa kategori/ }).click();
    await screen.getByRole('button', { name: 'Hapus filter kategori' }).click();
    expect(screen.getByRole('region', { name: 'Semua langganan' }).getByRole('row').elements()).toHaveLength(8);
  });

  it('starts empty, and names a next bill due today or tomorrow', async () => {
    const empty = await renderPage({
      overview: seedOverview({ subscriptions: [], counts: { active: 0, paused: 0, cancelled: 0 } }),
      detected: null,
    });
    await expect.element(empty.screen.getByText('Belum ada langganan atau tagihan rutin')).toBeVisible();
    await expect.element(empty.screen.getByText('Belum ada langganan', { exact: true })).toBeVisible();
    await empty.screen.getByRole('button', { name: 'Tambah langganan' }).last().click();
    await expect.element(page.getByRole('dialog', { name: 'Langganan baru' })).toBeVisible();
    await empty.screen.unmount();

    const tomorrow = await renderPage({ overview: seedOverview({ today: d('2026-10-17') }) });
    await expect.element(tomorrow.screen.getByText(/berikutnya Netflix, besok$/)).toBeVisible();
    await tomorrow.screen.unmount();
    const today = await renderPage({ overview: seedOverview({ today: d('2026-10-18') }) });
    await expect.element(today.screen.getByText(/berikutnya Netflix, hari ini$/)).toBeVisible();
    await today.screen.unmount();
    const none = await renderPage({ overview: seedOverview({ today: d('2026-12-20') }) });
    await expect.element(none.screen.getByText('7 aktif · 4 tagihan tersisa bulan ini')).toBeVisible();
  });
});
