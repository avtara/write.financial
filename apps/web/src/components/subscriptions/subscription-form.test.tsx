// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ACCOUNTS, BCA, CATEGORIES, GOTRADE, OVO, categoryId } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { S_CHATGPT, S_YOUTUBE } from '../../../test/subscription-fixtures.ts';
import { draftOf, SubscriptionForm, type SubscriptionFormProps } from './subscription-form.tsx';

const fns = vi.hoisted(() => ({
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  setSubscriptionLogo: vi.fn<(input: { data: FormData }) => Promise<unknown>>(),
  removeSubscriptionLogo: vi.fn(),
}));
vi.mock('../../server/fn/schedules.ts', () => fns);
const ledger = vi.hoisted(() => ({ getReferenceRate: vi.fn() }));
vi.mock('../../server/fn/ledger.ts', () => ledger);

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');
const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });

async function renderForm(patch: Partial<SubscriptionFormProps> = {}) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const { screen } = await renderApp(
    <SubscriptionForm
      open
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      baseCurrency="IDR"
      today={TODAY}
      locale="id"
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      {...patch}
    />,
  );
  return { screen, onSaved, onOpenChange, dialog: page.getByRole('dialog') };
}

beforeEach(() => {
  vi.clearAllMocks();
  ledger.getReferenceRate.mockResolvedValue({
    ok: true,
    value: {
      base: 'USD',
      quote: 'IDR',
      rate: '16350',
      provider: 'test',
      rateType: 'blended',
      asOf: TODAY,
      fetchedAt: new Date(),
      manual: false,
    },
  });
});

describe('SubscriptionForm', () => {
  it('golden: Disney+ Hotstar Rp39.000 monthly from BCA, reminded 3 days before', async () => {
    fns.createSubscription.mockReturnValue(ok({ id: 'new', name: 'Disney+ Hotstar' }));
    const { dialog, onSaved } = await renderForm();
    await expect.element(page.getByRole('dialog', { name: 'Langganan baru' })).toBeVisible();
    await expect
      .element(dialog.getByText('Tagihan rutin muncul di kalender dan masuk Perlu ditinjau saat jatuh tempo.'))
      .toBeVisible();
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    await expect.element(dialog.getByText('Tulis nama layanannya.')).toBeVisible();
    await expect.element(dialog.getByText('Isi harga lebih dari 0.')).toBeVisible();
    expect(fns.createSubscription).not.toHaveBeenCalled();

    await dialog.getByRole('combobox', { name: 'Layanan' }).fill('  Disney+ Hotstar ');
    await dialog.getByRole('textbox', { name: 'Paket' }).fill('Premium');
    await dialog.getByRole('textbox', { name: 'Harga' }).fill('39.000');
    await dialog.getByRole('radio', { name: 'Tahunan' }).click();
    await dialog.getByRole('radio', { name: 'Bulanan' }).click();
    await dialog.getByRole('textbox', { name: 'Deskripsi' }).fill('  Akun keluarga ');
    await dialog.getByRole('button', { name: 'Kategori' }).click();
    await page.getByRole('option', { name: /Hiburan/ }).click();
    await dialog.getByRole('combobox', { name: 'Berapa hari sebelumnya' }).selectOptions('5');
    await expect.element(dialog.getByText('5 hari sebelumnya · notifikasi')).toBeVisible();
    await dialog.getByRole('button', { name: 'Tagihan berikutnya' }).click();
    await page.getByRole('button', { name: 'Bulan berikutnya' }).click();
    await page.getByRole('button', { name: 'Senin, 2 November 2026' }).click();
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    expect(fns.createSubscription).toHaveBeenCalledWith({
      data: {
        name: 'Disney+ Hotstar',
        catalogId: null,
        plan: 'Premium',
        icon: null,
        description: 'Akun keluarga',
        priceMinor: 39_000n,
        currency: 'IDR',
        cycle: 'monthly',
        nextBillingDate: '2026-11-02',
        payFromAccountId: BCA.id,
        categoryId: categoryId('system:entertainment'),
        remindDaysBefore: 5,
        startedOn: TODAY,
        trial: null,
      },
    });
    expect(onSaved).toHaveBeenCalledWith({ id: 'new', name: 'Disney+ Hotstar' }, true);
  });

  it('converts a USD price paid from an IDR account, with the estimate at the reference rate', async () => {
    fns.createSubscription.mockReturnValue(ok({ id: 'n' }));
    const { dialog } = await renderForm();
    await dialog.getByRole('combobox', { name: 'Layanan' }).fill('Notion Plus');
    await dialog.getByRole('combobox', { name: 'Mata uang' }).selectOptions('USD');
    await expect.element(dialog.getByText(/^Dikonversi saat ditagih/)).toBeVisible();
    await expect.element(dialog.getByText(/≈/)).not.toBeInTheDocument();
    await dialog.getByRole('textbox', { name: 'Harga' }).fill('10');
    await expect
      .element(dialog.getByText(/^Dikonversi saat ditagih · ≈ Rp163\.500 per tagihan · kurs Rp16\.350/))
      .toBeVisible();
    await expect.element(dialog.getByText(/Nominal IDR dikonfirmasi di Perlu ditinjau\./)).toBeVisible();
    expect(ledger.getReferenceRate).toHaveBeenCalledWith({ data: { base: 'USD', quote: 'IDR' } });
    // Paid from the USD account: no conversion.
    await dialog.getByRole('button', { name: 'Bayar dari' }).click();
    await page.getByRole('option', { name: /^Gotrade/ }).click();
    await expect.element(dialog.getByText(/Dikonversi saat ditagih/)).not.toBeInTheDocument();
    await dialog.getByRole('switch', { name: /Ingatkan sebelum ditagih/ }).click();
    await expect.element(dialog.getByText('Tanpa pengingat')).toBeVisible();
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    expect(fns.createSubscription).toHaveBeenCalledWith({
      data: expect.objectContaining({
        currency: 'USD',
        priceMinor: 1_000n,
        payFromAccountId: GOTRADE.id,
        remindDaysBefore: null,
      }) as unknown,
    });
  });

  it('shows no estimate without a rate, and drops a late rate after switching back', async () => {
    ledger.getReferenceRate.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const { dialog } = await renderForm();
    await dialog.getByRole('textbox', { name: 'Harga' }).fill('10');
    await dialog.getByRole('combobox', { name: 'Mata uang' }).selectOptions('USD');
    await expect.element(dialog.getByText(/^Dikonversi saat ditagih/)).toBeVisible();
    await expect.element(dialog.getByText(/≈/)).not.toBeInTheDocument();
    const late = Promise.withResolvers<unknown>();
    ledger.getReferenceRate.mockReturnValueOnce(late.promise);
    await dialog.getByRole('combobox', { name: 'Mata uang' }).selectOptions('IDR');
    await dialog.getByRole('combobox', { name: 'Mata uang' }).selectOptions('USD');
    await dialog.getByRole('combobox', { name: 'Mata uang' }).selectOptions('IDR');
    late.resolve({ ok: true, value: { base: 'USD', quote: 'IDR', rate: '1' } });
    await late.promise;
    await expect.element(dialog.getByText(/Dikonversi/)).not.toBeInTheDocument();
  });

  it('starts a free trial: 7/14 days, a month, or until a date, and the first bill follows it', async () => {
    fns.createSubscription.mockReturnValue(ok({ id: 'n' }));
    const { dialog } = await renderForm();
    await dialog.getByRole('combobox', { name: 'Layanan' }).fill('Trial');
    await dialog.getByRole('textbox', { name: 'Harga' }).fill('50.000');
    await dialog.getByRole('switch', { name: /Masa uji coba gratis/ }).click();
    await expect.element(dialog.getByText('Kamis, 22 Okt')).toBeVisible();
    await dialog.getByRole('radio', { name: '14 hari' }).click();
    await expect.element(dialog.getByText('Kamis, 29 Okt')).toBeVisible();
    await dialog.getByRole('radio', { name: '1 bulan' }).click();
    await expect.element(dialog.getByText('Minggu, 15 Nov')).toBeVisible();
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    expect(fns.createSubscription).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ trial: { months: 1 } }) as unknown,
    });
    await dialog.getByRole('radio', { name: '7 hari' }).click();
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    expect(fns.createSubscription).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ trial: { days: 7 } }) as unknown,
    });
    await dialog.getByRole('radio', { name: '14 hari' }).click();
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    expect(fns.createSubscription).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ trial: { days: 14 } }) as unknown,
    });

    fns.createSubscription.mockClear();
    await dialog.getByRole('radio', { name: 'Sampai tanggal…' }).click();
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    await expect.element(dialog.getByText('Pilih tanggal akhir uji coba, hari ini atau setelahnya.')).toBeVisible();
    expect(fns.createSubscription).not.toHaveBeenCalled();
    await dialog.getByRole('button', { name: 'Uji coba sampai' }).click();
    await page.getByRole('button', { name: 'Sabtu, 31 Oktober 2026' }).click();
    await expect.element(dialog.getByText('Minggu, 1 Nov')).toBeVisible();
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    expect(fns.createSubscription).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ trial: { until: '2026-10-31' } }) as unknown,
    });
    await dialog.getByRole('switch', { name: /Masa uji coba gratis/ }).click();
    await expect.element(dialog.getByRole('radio', { name: '7 hari' })).not.toBeInTheDocument();
  });

  it('needs a paying account', async () => {
    const { dialog, onSaved } = await renderForm({ accounts: [] });
    await dialog.getByRole('combobox', { name: 'Layanan' }).fill('X');
    await dialog.getByRole('textbox', { name: 'Harga' }).fill('1.000');
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    await expect.element(dialog.getByText('Pilih rekening pembayar.')).toBeVisible();
    expect(fns.createSubscription).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('uploads a logo after saving, or picks an icon instead', async () => {
    fns.createSubscription.mockReturnValue(ok({ id: 'new', name: 'Vidio' }));
    fns.setSubscriptionLogo
      .mockReturnValueOnce(Promise.resolve({ ok: false, code: 'IMAGE_REJECTED' }))
      .mockReturnValueOnce(ok({ id: 'new', name: 'Vidio', logoKey: 'k' }));
    const { dialog, onSaved } = await renderForm({ prefill: { name: 'Vidio', priceMinor: 39_000n } });
    await expect.element(dialog.getByText('Belum ada logo')).toBeVisible();
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'vidio.png', { type: 'image/png' });
    await userEvent.upload(dialog.getByTestId('subscription-logo-file'), file);
    await expect.element(dialog.getByText('Logo diunggah')).toBeVisible();
    expect(dialog.element().querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/);
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    await expect
      .element(dialog.getByText('Langganan tersimpan, tapi logonya gagal diunggah. Coba lagi.'))
      .toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    expect(fns.setSubscriptionLogo).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledWith({ id: 'new', name: 'Vidio', logoKey: 'k' }, true);
    expect(fns.setSubscriptionLogo.mock.lastCall?.[0].data.get('id')).toBe('new');

    // "Pakai ikon" drops the picked file and offers the icons.
    await dialog.getByRole('button', { name: 'Pakai ikon' }).click();
    await expect.element(dialog.getByText('Belum ada logo')).toBeVisible();
    await dialog.getByRole('radio', { name: 'TV & streaming' }).click();
    await dialog.getByRole('button', { name: 'Pakai ikon' }).click();
    await expect.element(dialog.getByRole('radio', { name: 'TV & streaming' })).not.toBeInTheDocument();
    await userEvent.upload(dialog.getByTestId('subscription-logo-file'), []);
  });

  it('edits a subscription: its fields, the price increase, removing its logo; Batal closes', async () => {
    fns.updateSubscription.mockReturnValue(ok({ ...S_CHATGPT, logoKey: 'old' }));
    fns.removeSubscriptionLogo
      .mockReturnValueOnce(Promise.resolve({ ok: false, code: 'NOT_FOUND' }))
      .mockReturnValueOnce(ok({ ...S_CHATGPT, logoKey: null }));
    const { dialog, onSaved, onOpenChange } = await renderForm({
      subscription: { ...S_CHATGPT, logoKey: 'u/x/logo-old' },
    });
    await expect.element(page.getByRole('dialog', { name: 'Edit langganan' })).toBeVisible();
    await expect.element(dialog.getByText('20 tagihan tercatat sejak Mar 2025')).toBeVisible();
    await expect.element(dialog.getByRole('combobox', { name: 'Layanan' })).toHaveValue('ChatGPT');
    await expect.element(dialog.getByText('Logo diunggah')).toBeVisible();
    await expect.element(dialog.getByText(/^Rp299\.000 → Rp329\.000 · \+Rp30\.000 · \+10,03%$/)).toBeVisible();
    await expect.element(dialog.getByRole('switch', { name: /Masa uji coba gratis/ })).not.toBeInTheDocument();
    await dialog.getByRole('button', { name: 'Pakai ikon' }).click();
    await dialog.getByRole('button', { name: 'Simpan perubahan' }).click();
    expect(fns.updateSubscription).toHaveBeenCalledWith({
      data: {
        id: 'chatgpt',
        patch: expect.objectContaining({
          name: 'ChatGPT',
          plan: 'Plus',
          description: null,
          remindDaysBefore: 1,
        }) as unknown,
      },
    });
    expect(fns.removeSubscriptionLogo).toHaveBeenCalledWith({ data: { id: 'chatgpt' } });
    expect(onSaved).toHaveBeenLastCalledWith({ ...S_CHATGPT, logoKey: 'old' }, false);
    await dialog.getByRole('button', { name: 'Simpan perubahan' }).click();
    expect(onSaved).toHaveBeenLastCalledWith({ ...S_CHATGPT, logoKey: null }, false);

    fns.updateSubscription.mockReturnValueOnce(Promise.resolve({ ok: false, code: 'INVALID_SUBSCRIPTION' }));
    await dialog.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect.element(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('edits one without a reminder or increase, and builds drafts with a prefill', async () => {
    const { dialog } = await renderForm({ subscription: { ...S_YOUTUBE, remindDaysBefore: null } });
    await expect.element(dialog.getByRole('switch', { name: /Ingatkan sebelum ditagih/ })).not.toBeChecked();
    await expect.element(dialog.getByText('Harga naik dari tagihan lalu')).not.toBeInTheDocument();
    expect(draftOf(undefined, { today: TODAY, currency: 'IDR', accountId: OVO.id }, { name: 'Vidio' })).toMatchObject({
      name: 'Vidio',
      payFromAccountId: OVO.id,
      remind: true,
      remindDays: 3,
    });
  });

  it('opens the file picker from "Unggah PNG"', async () => {
    const { dialog } = await renderForm();
    const input = dialog.getByTestId('subscription-logo-file').element();
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    await dialog.getByRole('button', { name: 'Unggah PNG' }).click();
    expect(click).toHaveBeenCalled();
  });
  it('selects a local service without changing price, billing date, account, or an uploaded logo', async () => {
    const subscription = { ...S_YOUTUBE, catalogId: 'service:youtube-premium', logoKey: 'u/x/0000000000c1' };
    fns.updateSubscription.mockReturnValue(ok(subscription));
    const { dialog } = await renderForm({ subscription });
    await dialog.getByRole('combobox', { name: 'Layanan' }).fill('Netflix');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(dialog.element().querySelector('img')?.getAttribute('src')).toContain('/api/subscription-logo/');
    await dialog.getByRole('button', { name: 'Simpan perubahan' }).click();
    expect(fns.updateSubscription.mock.lastCall?.[0]).toMatchObject({
      data: {
        id: subscription.id,
        patch: {
          name: 'Netflix',
          catalogId: 'service:netflix',
          priceMinor: subscription.priceMinor,
          nextBillingDate: subscription.nextBillingDate,
          payFromAccountId: subscription.payFromAccountId,
          currency: subscription.currency,
        },
      },
    });
    expect(fns.removeSubscriptionLogo).not.toHaveBeenCalled();
    await dialog.getByRole('combobox', { name: 'Layanan' }).fill('My local service');
    await dialog.getByRole('button', { name: 'Simpan perubahan' }).click();
    expect(fns.updateSubscription.mock.lastCall?.[0]).toMatchObject({
      data: { id: subscription.id, patch: { name: 'My local service', catalogId: null } },
    });
  });

  it('offers common service aliases and persists branding only after the user supplies a charge', async () => {
    fns.createSubscription.mockReturnValue(ok({ ...S_YOUTUBE, name: 'Spotify', catalogId: 'service:spotify' }));
    const { dialog } = await renderForm();
    await dialog.getByRole('combobox', { name: 'Layanan' }).fill('Spotify Premium');
    await dialog.getByRole('option', { name: 'Spotify', exact: true }).click();
    await expect.element(dialog.getByText('Logo referensi lokal')).toBeVisible();
    await expect.element(dialog.getByRole('textbox', { name: 'Harga' })).toHaveValue('');
    expect(dialog.element().querySelector('img')?.getAttribute('src')).toBe('/catalog-logos/spotify.svg');
    await dialog.getByRole('textbox', { name: 'Harga' }).fill('10.000');
    await dialog.getByRole('button', { name: 'Simpan langganan' }).click();
    expect(fns.createSubscription.mock.lastCall?.[0]).toMatchObject({
      data: {
        name: 'Spotify',
        catalogId: 'service:spotify',
        priceMinor: 10_000n,
        nextBillingDate: TODAY,
      },
    });
  });
});
