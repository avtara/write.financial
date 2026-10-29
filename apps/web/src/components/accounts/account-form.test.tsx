// SPDX-License-Identifier: AGPL-3.0-only
import type { AccountView } from '@wf/db/accounts';
import type { LocalDate } from '@wf/domain/period';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { accountView } from '../../../test/accounts.ts';
import { renderApp } from '../../../test/render.tsx';
import type { AccountFields } from '../../server/fn/accounts.ts';
import { AccountForm, draftOf, validateDraft, type AccountFormProps } from './account-form.tsx';

const server = vi.hoisted(() => ({
  createAccount: vi.fn(),
  updateAccount: vi.fn<(input: { data: { id: string; patch: Partial<AccountFields> } }) => Promise<unknown>>(),
  setAccountLogo: vi.fn(),
  removeAccountLogo: vi.fn(),
}));
vi.mock('../../server/fn/accounts.ts', () => server);

const TODAY = '2026-10-15' as LocalDate;

/** The hidden file input behind "Unggah PNG". */
function fileInput(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]');
  if (input === null) throw new Error('no file input');
  return page.elementLocator(input);
}
const SAVED = accountView({ displayName: 'SeaBank' });

async function renderForm(props: Partial<AccountFormProps> = {}) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const result = await renderApp(
    <AccountForm
      baseCurrency="IDR"
      today={TODAY}
      cardHolders={[]}
      submitLabel="Tambah rekening"
      onSaved={onSaved}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...result, onSaved, onCancel, submit: result.screen.getByRole('button', { name: 'Tambah rekening' }) };
}

beforeEach(() => {
  server.createAccount.mockResolvedValue({ ok: true, value: SAVED });
  server.updateAccount.mockResolvedValue({ ok: true, value: SAVED });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('draftOf and validateDraft', () => {
  it('starts a new investment outside the available balance, and an edit from the account', () => {
    expect(draftOf(undefined, 'investment', TODAY, 'IDR')).toMatchObject({
      type: 'investment',
      currency: 'IDR',
      openingDate: TODAY,
      includeInAvailable: false,
      openingMinor: null,
    });
    const card = accountView({ type: 'credit_card', openingBalanceMinor: -250_000n, ccLimitMinor: 15_000_000n });
    expect(draftOf(card, 'bank', TODAY, 'IDR')).toMatchObject({
      type: 'credit_card',
      openingMinor: 250_000n,
      last4: '4821',
    });
    expect(draftOf(accountView({ last4: null }), 'bank', TODAY, 'IDR').last4).toBe('');
  });

  it('builds the server input per type', () => {
    const base = {
      ...draftOf(undefined, 'bank', TODAY, 'IDR'),
      displayName: ' Sea ',
      providerName: ' SeaBank ',
      openingMinor: 1n,
    };
    expect(validateDraft({ ...base, type: 'cash' }).input).toMatchObject({
      providerName: 'Sea',
      last4: null,
      phoneMasked: null,
    });
    expect(validateDraft({ ...base, type: 'ewallet', phone: '' }).input).not.toHaveProperty('phoneMasked');
    expect(validateDraft({ ...base, type: 'ewallet', phone: '0812 3456 7818' }).input).toMatchObject({
      phoneMasked: '0812•• 18',
    });
    expect(
      validateDraft({
        ...base,
        type: 'credit_card',
        last4: '7710',
        ccLimitMinor: 9n,
        ccStatementDay: 20,
        ccDueDay: 5,
        lowBalanceMinor: 3n,
      }).input,
    ).toMatchObject({
      openingBalanceMinor: -1n,
      last4: '7710',
      ccLimitMinor: 9n,
      ccStatementDay: 20,
      ccDueDay: 5,
      lowBalanceThresholdMinor: null,
    });
    expect(validateDraft({ ...base, lowBalanceMinor: 3n, ccLimitMinor: 9n }).input).toMatchObject({
      lowBalanceThresholdMinor: 3n,
      ccLimitMinor: null,
      ccDueDay: null,
    });
    expect(validateDraft({ ...base, type: 'ewallet', phone: '0812' }).errors).toEqual({
      phone: 'Nomor HP minimal 8 digit.',
    });
  });
});

describe('AccountForm', () => {
  it('adds a bank account and reports it', async () => {
    const { screen, submit, onSaved } = await renderForm();
    await expect.element(screen.getByRole('radio', { name: 'Bank' })).toBeChecked();
    await userEvent.fill(screen.getByRole('combobox', { name: 'Nama bank / penyedia' }), 'SeaBank');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama tampilan' }), 'SeaBank');
    await userEvent.fill(screen.getByRole('textbox', { name: '4 digit akhir' }), '77a1');
    await expect.element(screen.getByRole('textbox', { name: '4 digit akhir' })).toHaveValue('771');
    await userEvent.fill(screen.getByRole('textbox', { name: '4 digit akhir' }), '7710');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Saldo awal' }), '1.500.000');
    await userEvent.click(screen.getByRole('radio', { name: 'violet' }));
    await expect
      .element(screen.getByRole('region', { name: 'Pratinjau kartu' }).getByText('Rp1.500.000'))
      .toBeVisible();
    await userEvent.click(submit);
    expect(server.createAccount).toHaveBeenCalledWith({
      data: {
        type: 'bank',
        providerName: 'SeaBank',
        catalogId: null,
        displayName: 'SeaBank',
        currency: 'IDR',
        openingBalanceMinor: 1_500_000n,
        openingDate: TODAY,
        color: 'violet',
        last4: '7710',
        phoneMasked: null,
        includeInAvailable: true,
        showAsCard: false,
        isDefaultQuickEntry: false,
        lowBalanceThresholdMinor: null,
        ccLimitMinor: null,
        ccStatementDay: null,
        ccDueDay: null,
      },
    });
    expect(onSaved).toHaveBeenCalledWith(SAVED);
  });

  it('starts from the given values (onboarding "Detail" of a quick row)', async () => {
    const { screen, submit } = await renderForm({
      initial: { type: 'ewallet', providerName: 'GoPay', displayName: 'GoPay', openingMinor: 412_000n, color: 'green' },
    });
    await expect.element(screen.getByRole('radio', { name: 'E-Wallet' })).toBeChecked();
    await expect.element(screen.getByRole('textbox', { name: 'Nama tampilan' })).toHaveValue('GoPay');
    await userEvent.click(submit);
    expect(server.createAccount).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ewallet',
        providerName: 'GoPay',
        displayName: 'GoPay',
        openingBalanceMinor: 412_000n,
        color: 'green',
        includeInAvailable: true,
      }) as object,
    });
  });

  it('shows field errors instead of saving', async () => {
    const { screen, submit } = await renderForm();
    await userEvent.fill(screen.getByRole('textbox', { name: '4 digit akhir' }), '12');
    await userEvent.click(submit);
    await expect.element(screen.getByText('Isi 4 digit angka.')).toBeVisible();
    expect(screen.getByText('Wajib diisi.').elements()).toHaveLength(2);
    await expect.element(screen.getByText('Isi saldo, misalnya 1.500.000.')).toBeVisible();
    expect(server.createAccount).not.toHaveBeenCalled();
  });

  it('asks for what each type needs', async () => {
    const { screen } = await renderForm();
    await userEvent.click(screen.getByRole('radio', { name: 'E-Wallet' }));
    await expect.element(screen.getByRole('combobox', { name: 'Penyedia e-wallet' })).toBeVisible();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nomor HP' }), '0812 3456 7818');
    await expect.element(screen.getByRole('region', { name: 'Pratinjau kartu' }).getByText('0812•• 18')).toBeVisible();

    await userEvent.click(screen.getByRole('radio', { name: 'Tunai' }));
    await expect.element(screen.getByRole('combobox', { name: /penyedia/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Investasi' }));
    await expect.element(screen.getByRole('textbox', { name: 'Nilai saat ini' })).toBeVisible();
    await expect.element(screen.getByRole('switch', { name: /Hitung dalam total saldo/ })).not.toBeChecked();
    await expect.element(screen.getByText('Masuk kekayaan bersih · tidak masuk saldo tersedia')).toBeVisible();

    await userEvent.click(screen.getByRole('radio', { name: 'Kartu kredit' }));
    await expect.element(screen.getByRole('combobox', { name: 'Penerbit' })).toBeVisible();
    await expect.element(screen.getByRole('textbox', { name: 'Nama kartu' })).toBeVisible();
    await expect.element(screen.getByRole('switch', { name: /Kurangi tagihan berjalan/ })).toBeChecked();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Limit kredit' }), '15jt');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tanggal tagihan' }), '20');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Batas bayar' }), '5');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Batas bayar' }), '');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tanggal tagihan' }), '');
    await expect.element(screen.getByRole('textbox', { name: 'Batas saldo rendah' })).not.toBeInTheDocument();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Tagihan berjalan' }), '250.000');
    await userEvent.fill(screen.getByRole('combobox', { name: 'Penerbit' }), 'BCA');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama kartu' }), 'BCA Visa');
    await userEvent.click(screen.getByRole('button', { name: 'Tambah rekening' }));
    expect(server.createAccount).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'credit_card',
        openingBalanceMinor: -250_000n,
        ccLimitMinor: 15_000_000n,
        ccStatementDay: null,
        ccDueDay: null,
      }) as unknown,
    });
  });

  it('sets the flags, the threshold, a custom color, the currency, and the date', async () => {
    const { screen } = await renderForm({ cardHolders: ['BCA Tahapan'] });
    await userEvent.fill(screen.getByRole('combobox', { name: 'Nama bank / penyedia' }), 'Wise');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama tampilan' }), 'Wise');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Saldo awal' }), '100');
    await userEvent.click(screen.getByRole('switch', { name: /Hitung dalam total saldo/ }));
    await userEvent.click(screen.getByRole('switch', { name: /Tampilkan sebagai kartu/ }));
    await userEvent.click(screen.getByRole('switch', { name: /Default Catat Cepat/ }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Batas saldo rendah' }), '50');
    // A color input has no text to type; set it as the native picker does (React tracks the value setter).
    const custom = screen.getByLabelText('Warna kustom').element();
    if (!(custom instanceof HTMLInputElement)) throw new Error('no color input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(custom, '#22c55e');
    custom.dispatchEvent(new Event('input', { bubbles: true }));
    await expect.element(screen.getByText('#22c55e')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Mata uang' }));
    await userEvent.fill(page.getByRole('combobox', { name: 'Mata uang' }), 'USD');
    await userEvent.click(page.getByRole('option', { name: /^USD/ }));
    await expect.element(screen.getByRole('button', { name: 'Mata uang' })).toHaveTextContent('USD');

    await userEvent.click(screen.getByRole('button', { name: 'Per tanggal' }));
    await userEvent.click(page.getByRole('button', { name: / 1 Oktober 2026/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Tambah rekening' }));
    expect(server.createAccount).toHaveBeenCalledWith({
      data: expect.objectContaining({
        currency: 'USD',
        // Typed while the currency was IDR: the minor units stay as entered.
        openingBalanceMinor: 100n,
        openingDate: '2026-10-01',
        color: '#22c55e',
        includeInAvailable: false,
        showAsCard: true,
        isDefaultQuickEntry: true,
        lowBalanceThresholdMinor: 50n,
      }) as unknown,
    });
  });

  it('explains the card limit and keeps the switch off', async () => {
    const { screen } = await renderForm({ cardHolders: ['BCA Tahapan', 'Bank Jago', 'GoPay'] });
    const card = screen.getByRole('switch', { name: /Tampilkan sebagai kartu/ });
    await expect.element(card).toBeDisabled();
    await expect.element(screen.getByText(/Kartu sudah dipakai BCA Tahapan, Bank Jago, dan GoPay/)).toBeVisible();
  });

  it('edits a locked account without sending the locked fields', async () => {
    const account = accountView({
      displayName: 'BCA Tahapan',
      locked: true,
      transactionCount: 214,
      isDefaultQuickEntry: true,
      showAsCard: true,
    });
    const { screen, onCancel } = await renderForm({
      account,
      submitLabel: 'Simpan perubahan',
      cardHolders: ['A', 'B', 'C'],
      footerNote: 'Tidak perlu login bank',
    });
    await expect.element(screen.getByText('Mata uang & saldo awal terkunci')).toBeVisible();
    await expect.element(screen.getByRole('textbox', { name: 'Mata uang' })).toBeDisabled();
    await expect.element(screen.getByRole('textbox', { name: 'Saldo awal' })).toBeDisabled();
    await expect.element(screen.getByRole('switch', { name: /Tampilkan sebagai kartu/ })).toBeEnabled();
    await expect.element(screen.getByRole('switch', { name: /Default Catat Cepat/ })).toBeDisabled();
    await expect.element(screen.getByText('Tidak perlu login bank')).toBeVisible();
    // The date cannot change either.
    await userEvent.click(screen.getByRole('button', { name: 'Sejak' }));
    await userEvent.click(page.getByRole('button', { name: / 1 September 2026/ }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama tampilan' }), 'BCA Utama');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(server.updateAccount).toHaveBeenCalledWith({
      data: {
        id: account.id,
        patch: expect.objectContaining({ displayName: 'BCA Utama' }) as unknown,
      },
    });
    for (const locked of ['currency', 'openingBalanceMinor', 'openingDate']) {
      expect(server.updateAccount).not.toHaveBeenCalledWith({
        data: { id: account.id, patch: expect.objectContaining({ [locked]: expect.anything() as unknown }) as unknown },
      });
    }
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('sends the currency and opening balance of an unlocked account, and shows server refusals', async () => {
    server.updateAccount.mockResolvedValueOnce({ ok: false, code: 'ACCOUNT_LOCKED' });
    const account = accountView({ type: 'ewallet', last4: null, phoneMasked: '0812•• 18' });
    const { screen, onSaved } = await renderForm({ account, submitLabel: 'Simpan perubahan' });
    await expect.element(screen.getByRole('textbox', { name: 'Nomor HP' })).toHaveAttribute('placeholder', '0812•• 18');
    await expect.element(screen.getByRole('region', { name: 'Pratinjau kartu' }).getByText('0812•• 18')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(server.updateAccount).toHaveBeenCalledWith({
      data: {
        id: account.id,
        patch: expect.objectContaining({
          currency: 'IDR',
          openingBalanceMinor: 1_000_000n,
          openingDate: '2026-09-30',
        }) as unknown,
      },
    });
    await expect
      .element(screen.getByText('Mata uang dan saldo awal terkunci karena rekening ini sudah punya transaksi.'))
      .toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('uploads a picked logo after saving, and keeps the dialog when the upload fails', async () => {
    const withLogo = { ...SAVED, logoKey: 'k' } satisfies AccountView;
    server.setAccountLogo.mockResolvedValueOnce({ ok: true, value: withLogo });
    server.setAccountLogo.mockResolvedValueOnce({ ok: false, code: 'IMAGE_REJECTED', detail: 'corrupt' });
    const { screen, onSaved } = await renderForm({ account: SAVED, submitLabel: 'Simpan perubahan' });
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'seabank.png', { type: 'image/png' });
    await userEvent.upload(fileInput(screen.container), file);
    await expect.element(screen.getByText('seabank.png')).toBeVisible();
    expect(screen.container.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    const call: unknown = server.setAccountLogo.mock.calls[0]?.[0];
    const form: unknown = call !== null && typeof call === 'object' && 'data' in call ? call.data : null;
    if (!(form instanceof FormData)) throw new Error('setAccountLogo got no form data');
    expect(form.get('id')).toBe(SAVED.id);
    const sent = form.get('file');
    expect(sent instanceof File && sent.name).toBe('seabank.png');
    expect(onSaved).toHaveBeenCalledWith(withLogo);

    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await expect.element(screen.getByText(/logonya gagal diunggah/)).toBeVisible();
    expect(onSaved).toHaveBeenCalledTimes(1);

    // "Pakai ikon" drops the picked file again; picking nothing changes nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Pakai ikon' }));
    await expect.element(screen.getByText('seabank.png')).not.toBeInTheDocument();
    const input = fileInput(screen.container).element();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await expect.element(screen.getByText('seabank.png')).not.toBeInTheDocument();
  });

  it('removes a stored logo with "Pakai ikon", and still saves when that fails', async () => {
    const account = accountView({ logoKey: 'u/x/0192a6c4-0000-7000-8000-0000000000c1' });
    server.removeAccountLogo.mockResolvedValueOnce({ ok: true, value: { ...account, logoKey: null } });
    server.removeAccountLogo.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    server.updateAccount.mockResolvedValue({ ok: true, value: account });
    const { screen, onSaved } = await renderForm({ account, submitLabel: 'Simpan perubahan' });
    expect(screen.container.querySelector('img')?.getAttribute('src')).toContain('/api/account-logo/');
    await userEvent.click(screen.getByRole('button', { name: 'Pakai ikon' }));
    expect(screen.container.querySelector('img')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(server.removeAccountLogo).toHaveBeenCalledWith({ data: { id: account.id } });
    expect(onSaved).toHaveBeenLastCalledWith({ ...account, logoKey: null });
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(onSaved).toHaveBeenLastCalledWith(account);
  });

  it('opens the file picker from "Unggah PNG"', async () => {
    const { screen } = await renderForm();
    const input = fileInput(screen.container).element();
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Unggah PNG' }));
    expect(click).toHaveBeenCalled();
  });
  it('prefills a provider without financial defaults and clears incompatible references on type changes', async () => {
    const { screen, submit } = await renderForm();
    const provider = screen.getByRole('combobox', { name: 'Nama bank / penyedia' });
    await provider.fill('Bank Central Asia');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.element(provider).toHaveValue('BCA');
    await expect.element(screen.getByRole('textbox', { name: 'Nama tampilan' })).toHaveValue('BCA');
    await expect.element(screen.getByRole('textbox', { name: 'Saldo awal' })).toHaveValue('');
    expect(screen.container.querySelector('img')?.getAttribute('src')).toBe('/catalog-logos/bca.svg');
    await screen.getByRole('textbox', { name: 'Saldo awal' }).fill('1.000');
    await submit.click();
    expect(server.createAccount.mock.lastCall?.[0]).toMatchObject({
      data: {
        providerName: 'BCA',
        displayName: 'BCA',
        catalogId: 'provider:bca',
        currency: 'IDR',
        openingBalanceMinor: 1_000n,
        openingDate: TODAY,
      },
    });
    await screen.getByRole('button', { name: 'Pakai ikon' }).click();
    expect(screen.container.querySelector('img')).toBeNull();
    await provider.fill('BCA');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await screen.getByRole('radio', { name: 'Kartu kredit' }).click();
    await screen.getByRole('radio', { name: 'Bank', exact: true }).click();
    await provider.fill('Mandiri');
    await screen.getByRole('option', { name: 'Bank Mandiri', exact: true }).click();
    await expect.element(screen.getByRole('textbox', { name: 'Nama tampilan' })).toHaveValue('BCA');
    await screen.getByRole('radio', { name: 'E-Wallet' }).click();
    await submit.click();
    expect(server.createAccount.mock.lastCall?.[0]).toMatchObject({
      data: {
        type: 'ewallet',
        catalogId: null,
        openingBalanceMinor: 1_000n,
      },
    });
  });

  it('keeps uploaded logos, customized names, and locked money when selecting or manually overriding a provider', async () => {
    const account = accountView({
      locked: true,
      currency: 'USD',
      displayName: 'My emergency fund',
      catalogId: 'provider:mandiri',
      logoKey: 'u/x/0000000000c1',
    });
    const { screen } = await renderForm({ account, submitLabel: 'Simpan perubahan' });
    const provider = screen.getByRole('combobox', { name: 'Nama bank / penyedia' });
    await provider.fill('BCA');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.element(screen.getByRole('textbox', { name: 'Nama tampilan' })).toHaveValue('My emergency fund');
    expect(screen.container.querySelector('img')?.getAttribute('src')).toContain('/api/account-logo/');
    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();
    const patch = server.updateAccount.mock.lastCall?.[0].data.patch;
    expect(patch).toMatchObject({ catalogId: 'provider:bca', providerName: 'BCA', displayName: 'My emergency fund' });
    expect(patch).not.toHaveProperty('currency');
    expect(patch).not.toHaveProperty('openingBalanceMinor');
    expect(patch).not.toHaveProperty('openingDate');
    expect(server.removeAccountLogo).not.toHaveBeenCalled();
    await provider.fill('An unlisted bank');
    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();
    expect(server.updateAccount.mock.lastCall?.[0]).toMatchObject({
      data: { id: account.id, patch: { providerName: 'An unlisted bank', catalogId: null } },
    });
  });
});
