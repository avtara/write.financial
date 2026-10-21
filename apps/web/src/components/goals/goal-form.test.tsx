// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DANA_DARURAT,
  DP_RUMAH,
  GOAL_ACCOUNTS,
  goalSummary,
  LIBURAN_BALI,
  SEED_GOALS,
  source,
} from '../../../test/goal-fixtures.ts';
import { BCA, GOTRADE, JAGO, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { GoalSummary } from '../../server/fn/goals.ts';
import { freeBalance, GoalForm, type GoalFormProps } from './goal-form.tsx';

const server = vi.hoisted(() => ({ createGoal: vi.fn(), updateGoal: vi.fn() }));
vi.mock('../../server/fn/goals.ts', () => server);

const TODAY = '2026-10-15' as LocalDate;

function form(overrides: Partial<GoalFormProps> = {}) {
  const props: GoalFormProps = {
    open: true,
    goals: SEED_GOALS,
    accounts: GOAL_ACCOUNTS,
    baseCurrency: 'IDR',
    today: TODAY,
    averageSpendingMinor: 18_000_000n,
    payday: 25,
    locale: 'id',
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  return { props, view: renderApp(<GoalForm {...props} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
  server.createGoal.mockResolvedValue({ ok: true, value: { id: 'new', name: 'Laptop kerja baru' } });
  server.updateGoal.mockResolvedValue({ ok: true, value: { id: DANA_DARURAT.id, name: 'Dana Darurat' } });
});

describe('GoalForm', () => {
  it('golden (q0jRa): Laptop kerja baru, Rp18.000.000 by Juni 2027, 8× Rp2.250.000 on the 25th from BCA', async () => {
    const { props, view } = form();
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Tujuan tabungan baru' });
    await expect.element(dialog.getByText('Progres dihitung dari saldo rekening & transaksi berlabel.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Nama tujuan' }).fill('Laptop kerja baru');
    await dialog.getByRole('radio', { name: 'Laptop' }).click();
    await dialog.getByRole('radio', { name: 'Sian' }).click();
    await dialog.getByRole('textbox', { name: 'Target' }).fill('18.000.000');
    await dialog.getByLabelText('Tenggat').fill('2027-06');
    await dialog.getByRole('combobox', { name: 'Simpan di rekening' }).click();
    await screen.getByRole('option', { name: JAGO.displayName }).click();
    await expect.element(dialog.getByText('Setor manual & setoran rutin masuk ke rekening ini')).toBeVisible();
    await dialog.getByRole('switch', { name: /Setoran rutin bulanan/ }).click();
    await expect.element(dialog.getByRole('textbox', { name: 'Jumlah / bulan' })).toHaveValue('2.250.000');
    await expect.element(dialog.getByRole('combobox', { name: 'Tanggal' })).toHaveValue('25');
    await expect.element(dialog.getByRole('combobox', { name: 'Dari' })).toMatchTextContent(BCA.displayName);
    await expect.element(dialog.getByText('8× setoran (Nov 2026 – Jun 2027) · label #laptop-kerja-baru')).toBeVisible();
    await expect.element(dialog.getByText('Bisa diubah kapan saja')).toBeVisible();
    await dialog.getByRole('button', { name: 'Buat tujuan' }).click();
    expect(server.createGoal).toHaveBeenCalledWith({
      data: {
        name: 'Laptop kerja baru',
        icon: 'laptop',
        color: 'cyan',
        targetMinor: 18_000_000n,
        targetMode: 'fixed',
        targetMonths: null,
        deadlineMonth: '2027-06',
        accountId: JAGO.id,
        kind: 'savings',
        currency: 'IDR',
        tag: 'Laptop kerja baru',
        sources: [],
        // "8× setoran (Nov 2026 – Jun 2027)": the plan runs in exactly those months.
        plans: [
          {
            amountMinor: 2_250_000n,
            monthDay: 25,
            fromAccountId: BCA.id,
            toAccountId: JAGO.id,
            startOn: '2026-11-25',
            startMonth: '2026-11',
            endMonth: '2027-06',
          },
        ],
      },
    });
    expect(props.onSaved).toHaveBeenCalledWith({ id: 'new', name: 'Laptop kerja baru' }, true);
  });

  it('starts the emergency fund at 3× the monthly spending, and changes the multiple', async () => {
    const { view } = form({ template: { name: 'Dana Darurat', icon: 'shield', color: 'blue', dynamic: true } });
    const { screen } = await view;
    const dialog = screen.getByRole('dialog');
    await expect.element(dialog.getByRole('textbox', { name: 'Nama tujuan' })).toHaveValue('Dana Darurat');
    await expect.element(dialog.getByRole('checkbox', { name: /Target dinamis/ })).toBeChecked();
    await expect.element(dialog.getByText('Rp54.000.000')).toBeVisible();
    await expect.element(dialog.getByText('rata-rata Rp18.000.000/bulan')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Berapa bulan pengeluaran' }).selectOptions('6');
    await expect.element(dialog.getByText('Rp108.000.000')).toBeVisible();
    await dialog.getByRole('switch', { name: /Setoran rutin bulanan/ }).click();
    await expect.element(dialog.getByText('Mulai Nov 2026 · label #dana-darurat')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Jumlah / bulan' }).fill('3.500.000');
    await dialog.getByRole('combobox', { name: 'Tanggal' }).selectOptions('1');
    await dialog.getByRole('button', { name: 'Buat tujuan' }).click();
    // No account to keep it in: the contribution has nowhere to go.
    await expect.element(dialog.getByText('Pilih rekening tujuan yang berbeda dari rekening asal.')).toBeVisible();
    await dialog.getByRole('switch', { name: /Setoran rutin bulanan/ }).click();
    await dialog.getByRole('button', { name: 'Buat tujuan' }).click();
    expect(server.createGoal).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetMode: 'monthly_expenses',
        targetMonths: 6,
        targetMinor: 108_000_000n,
        icon: 'shield',
        plans: [],
      }) as unknown,
    });
  });

  it('asks for a name, a target, the monthly amount and where it comes from', async () => {
    const { view } = form({ accounts: [], averageSpendingMinor: 0n, payday: null });
    const { screen } = await view;
    const dialog = screen.getByRole('dialog');
    expect(dialog.getByRole('checkbox', { name: /Target dinamis/ }).query()).toBeNull();
    await dialog.getByRole('switch', { name: /Setoran rutin bulanan/ }).click();
    await expect.element(dialog.getByRole('combobox', { name: 'Tanggal' })).toHaveValue('25');
    await dialog.getByRole('button', { name: 'Buat tujuan' }).click();
    await expect.element(dialog.getByText('Isi nama tujuan.')).toBeVisible();
    await expect.element(dialog.getByText('Isi target, misalnya 18.000.000.')).toBeVisible();
    await expect.element(dialog.getByText('Isi jumlah setoran per bulan.')).toBeVisible();
    await expect.element(dialog.getByText('Pilih rekening asal setoran.')).toBeVisible();
    expect(server.createGoal).not.toHaveBeenCalled();
    await expect.element(dialog.getByText(/Mulai Nov 2026 · label #—/)).toBeVisible();
    await dialog.getByLabelText('Tenggat').fill('2027-06');
    await expect.element(dialog.getByText('8× setoran (Nov 2026 – Jun 2027) · label #—')).toBeVisible();
  });

  it('edits the account sources: whole or a fixed amount within the free balance', async () => {
    const { view } = form({ goal: DP_RUMAH });
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Ubah DP Rumah' });
    expect(dialog.getByRole('switch').query()).toBeNull();
    await expect.element(dialog.getByRole('textbox', { name: 'Nominal tetap' })).toHaveValue('5.000.000');
    // BCA's other goals hold Rp4.200.000 of it.
    await expect.element(dialog.getByText('bebas Rp38.610.000')).toBeVisible();
    await dialog.getByRole('button', { name: 'Tambah sumber' }).click();
    await dialog.getByRole('button', { name: 'Simpan' }).click();
    await expect.element(dialog.getByText('Pilih rekening dan isi nominalnya.')).toBeVisible();
    const accounts = dialog.getByRole('combobox', { name: 'Rekening sumber' });
    await accounts.nth(1).click();
    // An account is used once per goal; Gotrade is in USD, the card holds no savings.
    expect(screen.getByRole('option', { name: BCA.displayName }).query()).toBeNull();
    expect(screen.getByRole('option', { name: GOTRADE.displayName }).query()).toBeNull();
    await screen.getByRole('option', { name: JAGO.displayName }).click();
    await expect.element(dialog.getByText('Seluruh saldonya dipakai tujuan lain')).toBeVisible();
    await dialog.getByRole('button', { name: `Hapus sumber ${JAGO.displayName}` }).click();
    await dialog.getByRole('button', { name: 'Tambah sumber' }).click();
    await accounts.nth(1).click();
    await screen.getByRole('option', { name: OVO.displayName }).click();
    await dialog.getByRole('combobox', { name: 'Cara hitung' }).nth(1).click();
    await screen.getByRole('option', { name: 'Seluruh saldo' }).click();
    expect(dialog.getByRole('textbox', { name: 'Nominal tetap' }).nth(1).query()).toBeNull();
    await dialog.getByRole('textbox', { name: 'Nominal tetap' }).fill('6.000.000');
    await dialog.getByRole('textbox', { name: 'Nama tujuan' }).fill('DP Rumah Bekasi');
    await dialog.getByRole('button', { name: 'Simpan' }).click();
    expect(server.updateGoal).toHaveBeenCalledWith({
      data: {
        id: DP_RUMAH.id,
        patch: {
          name: 'DP Rumah Bekasi',
          icon: 'house',
          color: 'blue',
          targetMinor: 150_000_000n,
          targetMode: 'fixed',
          targetMonths: null,
          deadlineMonth: null,
          accountId: null,
        },
        sources: [
          { accountId: BCA.id, mode: 'fixed', amountMinor: 6_000_000n },
          { accountId: OVO.id, mode: 'whole', amountMinor: null },
        ],
      },
    });
  });

  it('keeps an emergency fund’s target when there is no spending to compute it from, and reports refusals', async () => {
    server.updateGoal
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_GOAL' })
      .mockRejectedValueOnce(new TypeError('offline'));
    const { props, view } = form({ goal: DANA_DARURAT, averageSpendingMinor: 0n });
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Ubah Dana Darurat' });
    await expect.element(dialog.getByRole('checkbox', { name: /Target dinamis/ })).toBeChecked();
    await expect.element(dialog.getByText('Rp54.000.000')).toBeVisible();
    await expect.element(dialog.getByText(/^rata-rata/)).not.toBeInTheDocument();
    await dialog.getByRole('button', { name: 'Simpan' }).click();
    await expect.element(dialog.getByText('Periksa lagi data tujuan tabungan.')).toBeVisible();
    expect(server.updateGoal).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patch: expect.objectContaining({
          targetMode: 'monthly_expenses',
          targetMonths: 3,
          targetMinor: 54_000_000n,
        }) as unknown,
        sources: [{ accountId: JAGO.id, mode: 'whole', amountMinor: null }],
      }) as unknown,
    });
    await dialog.getByRole('button', { name: 'Simpan' }).click();
    await expect.element(dialog.getByText('Tidak tersimpan. Periksa koneksi lalu coba lagi.')).toBeVisible();
    await dialog.getByRole('checkbox', { name: /Target dinamis/ }).click();
    await dialog.getByRole('textbox', { name: 'Target' }).fill('60.000.000');
    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('keeps an emergency fund’s target while its multiple stays, and recomputes it from the spending once it changes', async () => {
    const { view } = form({ goal: DANA_DARURAT, averageSpendingMinor: 18_300_000n });
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Ubah Dana Darurat' });
    await expect.element(dialog.getByText('Rp54.000.000')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Berapa bulan pengeluaran' }).selectOptions('6');
    await expect.element(dialog.getByText('Rp109.800.000')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Berapa bulan pengeluaran' }).selectOptions('3');
    await dialog.getByRole('button', { name: 'Simpan' }).click();
    expect(server.updateGoal).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patch: expect.objectContaining({ targetMinor: 54_000_000n, targetMonths: 3 }) as unknown,
      }) as unknown,
    });
  });

  it('renders nothing while closed, and a template without a dynamic target', async () => {
    const closed = form({ open: false });
    expect((await closed.view).screen.getByRole('dialog').query()).toBeNull();
    const { view } = form({ template: { name: 'Liburan', icon: 'plane', color: 'violet', dynamic: false } });
    const { screen } = await view;
    await expect.element(screen.getByRole('checkbox', { name: /Target dinamis/ })).not.toBeChecked();
    await expect.element(screen.getByRole('radio', { name: 'Perjalanan' })).toBeChecked();
    server.createGoal.mockRejectedValueOnce(new TypeError('offline'));
    await screen.getByRole('textbox', { name: 'Target' }).fill('8.000.000');
    await screen.getByRole('button', { name: 'Buat tujuan' }).click();
    await expect.element(screen.getByText('Tidak tersimpan. Periksa koneksi lalu coba lagi.')).toBeVisible();
  });
});

describe('freeBalance', () => {
  it('is the balance less other goals’ fixed amounts, or none when another goal holds it wholly', () => {
    expect(freeBalance(BCA, SEED_GOALS, null)).toBe(42_810_000n - 9_200_000n);
    expect(freeBalance(BCA, SEED_GOALS, DP_RUMAH.id)).toBe(42_810_000n - 4_200_000n);
    expect(freeBalance(JAGO, SEED_GOALS, null)).toBeNull();
    expect(freeBalance(JAGO, SEED_GOALS, DANA_DARURAT.id)).toBe(JAGO.balanceMinor);
    const odd: GoalSummary = goalSummary({
      id: 'odd',
      name: 'Odd',
      sources: [source({ id: 'x', accountId: OVO.id, amountMinor: null, valueMinor: 0n })],
    });
    expect(freeBalance(OVO, [odd, LIBURAN_BALI], null)).toBe(OVO.balanceMinor);
  });
});
