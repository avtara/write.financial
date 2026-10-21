// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DANA_DARURAT, GOAL_ACCOUNTS, goalsOverview, SET_ASIDE, source } from '../../../test/goal-fixtures.ts';
import { BCA, JAGO, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { GoalsOverview } from '../../server/fn/goals.ts';
import { SinkingForm } from './sinking-form.tsx';

const server = vi.hoisted(() => ({ createGoal: vi.fn(), updateGoal: vi.fn() }));
vi.mock('../../server/fn/goals.ts', () => server);

function sinkingForm(overview: GoalsOverview = goalsOverview(), accounts = GOAL_ACCOUNTS) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const view = renderApp(
    <SinkingForm
      open
      overview={overview}
      accounts={accounts}
      locale="id"
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  );
  return { view, onSaved, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  server.createGoal.mockResolvedValue({ ok: true, value: { id: 'new', name: 'Asuransi motor' } });
});

describe('SinkingForm', () => {
  it('golden (j6G7bA): Asuransi motor Rp1.500.000 by Apr 2027 sets aside Rp250.000 over Nov–Apr with the payday transfer', async () => {
    const { view, onSaved } = sinkingForm();
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Dana tidak rutin baru' });
    await expect
      .element(dialog.getByText('Untuk biaya tahunan atau sesekali — disisihkan sedikit tiap bulan.'))
      .toBeVisible();
    await dialog.getByRole('textbox', { name: 'Nama' }).fill('Asuransi motor');
    await dialog.getByRole('textbox', { name: 'Target' }).fill('1.500.000');
    await dialog.getByLabelText('Jatuh tempo').fill('2027-04');
    await expect.element(dialog.getByText('Disisihkan tiap bulan')).toBeVisible();
    await expect.element(dialog.getByText('Rp250.000', { exact: true })).toBeVisible();
    await expect.element(dialog.getByText('6 bulan · Nov–Apr')).toBeVisible();
    expect(dialog.getByRole('listitem').elements()).toHaveLength(6);
    await expect
      .element(dialog.getByText('Total dana tidak rutin jadi Rp1.400.000/bulan (dari Rp1.150.000)'))
      .toBeVisible();
    await expect.element(dialog.getByRole('switch', { name: /Sisihkan tiap gajian/ })).toBeChecked();
    await expect
      .element(
        dialog.getByText(
          'Tiap 25 masuk Perlu ditinjau, tercatat sebagai transfer ke Bank Jago setelah kamu konfirmasi',
        ),
      )
      .toBeVisible();
    // Bank Jago, where the set-aside lands, is Dana Darurat's whole account here: the fund stays in BCA.
    await expect.element(dialog.getByRole('combobox', { name: 'Disimpan di' })).toMatchTextContent(BCA.displayName);
    await expect.element(dialog.getByText('bebas Rp33.610.000')).toBeVisible();
    // Joining the payday transfer needs no day or account of its own.
    expect(dialog.getByRole('combobox', { name: 'Tanggal' }).query()).toBeNull();
    await dialog.getByRole('button', { name: 'Buat dana' }).click();
    expect(server.createGoal).toHaveBeenCalledWith({
      data: {
        name: 'Asuransi motor',
        icon: 'calendar-clock',
        color: 'violet',
        kind: 'sinking',
        targetMinor: 1_500_000n,
        currency: 'IDR',
        deadlineMonth: '2027-04',
        tag: 'Asuransi motor',
        accountId: BCA.id,
        sources: [],
        plans: [
          { recurrenceId: SET_ASIDE.recurrenceId, amountMinor: 250_000n, startMonth: '2026-11', endMonth: '2027-04' },
        ],
      },
    });
    expect(onSaved).toHaveBeenCalledWith({ id: 'new', name: 'Asuransi motor' });
  });

  it('keeps a fund where the payday set-aside lands when no goal holds that account wholly', async () => {
    const fixed = { ...DANA_DARURAT, sources: [source({ id: 's', accountId: JAGO.id, amountMinor: 8_125_000n })] };
    const { view } = sinkingForm(goalsOverview({ goals: [fixed] }));
    const { screen } = await view;
    await expect
      .element(screen.getByRole('dialog').getByRole('combobox', { name: 'Disimpan di' }))
      .toMatchTextContent(JAGO.displayName);
  });

  it('makes its own monthly transfer on a chosen day when there is none to join, with what is already saved', async () => {
    const { view } = sinkingForm(goalsOverview({ goals: [DANA_DARURAT], setAside: null }));
    const { screen } = await view;
    const dialog = screen.getByRole('dialog');
    // Bank Jago is held wholly by Dana Darurat, so the fund is kept in BCA and set aside from elsewhere.
    await expect.element(dialog.getByRole('combobox', { name: 'Disimpan di' })).toMatchTextContent(BCA.displayName);
    await expect.element(dialog.getByRole('combobox', { name: 'Dari' })).toMatchTextContent(JAGO.displayName);
    await dialog.getByRole('textbox', { name: 'Nama' }).fill('Pajak motor');
    await dialog.getByRole('textbox', { name: 'Target' }).fill('1.500.000');
    await dialog.getByLabelText('Jatuh tempo').fill('2027-04');
    await dialog.getByRole('textbox', { name: 'Sudah terkumpul' }).fill('500.000');
    await dialog.getByRole('combobox', { name: 'Tanggal' }).selectOptions('1');
    await expect.element(dialog.getByText('Rp167.000', { exact: true }).first()).toBeVisible();
    await expect.element(dialog.getByText('Total dana tidak rutin jadi Rp167.000/bulan (dari Rp0)')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Dari' }).click();
    await screen.getByRole('option', { name: OVO.displayName }).click();
    await dialog.getByRole('button', { name: 'Buat dana' }).click();
    expect(server.createGoal).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: BCA.id,
        sources: [{ accountId: BCA.id, mode: 'fixed', amountMinor: 500_000n }],
        plans: [
          {
            amountMinor: 167_000n,
            monthDay: 1,
            fromAccountId: OVO.id,
            toAccountId: BCA.id,
            startOn: '2026-11-01',
            startMonth: '2026-11',
            endMonth: '2027-04',
          },
        ],
      }) as unknown,
    });
  });

  it('checks the name, target, due month, what is saved, and where the money comes from', async () => {
    server.createGoal.mockResolvedValueOnce({ ok: false, code: 'INVALID_GOAL' });
    const { view, onOpenChange } = sinkingForm(goalsOverview({ goals: [DANA_DARURAT], setAside: null, payday: null }));
    const { screen } = await view;
    const dialog = screen.getByRole('dialog');
    await expect.element(dialog.getByRole('combobox', { name: 'Tanggal' })).toHaveValue('25');
    await dialog.getByRole('button', { name: 'Buat dana' }).click();
    await expect.element(dialog.getByText('Isi nama tujuan.')).toBeVisible();
    await expect.element(dialog.getByText('Isi target, misalnya 18.000.000.')).toBeVisible();
    await expect.element(dialog.getByText('Pilih bulan jatuh tempo.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Nama' }).fill('Servis AC');
    await dialog.getByRole('textbox', { name: 'Target' }).fill('600.000');
    await dialog.getByLabelText('Jatuh tempo').fill('2026-12');
    await dialog.getByRole('textbox', { name: 'Sudah terkumpul' }).fill('900.000.000');
    await dialog.getByRole('button', { name: 'Buat dana' }).click();
    await expect.element(dialog.getByText('Melebihi saldo bebas rekening ini.')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Disimpan di' }).click();
    await screen.getByRole('option', { name: JAGO.displayName }).click();
    await dialog.getByRole('textbox', { name: 'Sudah terkumpul' }).fill('600.000');
    await expect.element(dialog.getByText('Melebihi saldo bebas rekening ini.')).toBeVisible();
    await expect.element(dialog.getByText('Pilih rekening asal setoran.')).toBeVisible();
    expect(server.createGoal).not.toHaveBeenCalled();
    // Fully saved already: nothing is set aside, so no transfer is needed.
    await dialog.getByRole('combobox', { name: 'Disimpan di' }).click();
    await screen.getByRole('option', { name: OVO.displayName }).click();
    await dialog.getByRole('textbox', { name: 'Sudah terkumpul' }).fill('60.000');
    await dialog.getByRole('switch', { name: /Sisihkan tiap gajian/ }).click();
    await expect.element(dialog.getByText('Total dana tidak rutin jadi Rp0/bulan (dari Rp0)')).toBeVisible();
    await dialog.getByRole('button', { name: 'Buat dana' }).click();
    expect(server.createGoal).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: OVO.id, plans: [] }) as unknown,
    });
    await expect.element(dialog.getByText('Periksa lagi data tujuan tabungan.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sets nothing aside once the target is saved, and reports a failed save', async () => {
    server.createGoal.mockRejectedValueOnce(new TypeError('offline'));
    const { view } = sinkingForm(goalsOverview({ setAside: { ...SET_ASIDE, monthDay: null } }));
    const { screen } = await view;
    const dialog = screen.getByRole('dialog');
    await expect.element(dialog.getByText(/^Tiap 25 masuk Perlu ditinjau/)).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Nama' }).fill('Kado');
    await dialog.getByRole('textbox', { name: 'Target' }).fill('100.000');
    await dialog.getByLabelText('Jatuh tempo').fill('2027-12');
    await dialog.getByRole('textbox', { name: 'Sudah terkumpul' }).fill('100.000');
    expect(dialog.getByRole('listitem').elements()).toHaveLength(12);
    await dialog.getByRole('button', { name: 'Buat dana' }).click();
    expect(server.createGoal).toHaveBeenCalledWith({ data: expect.objectContaining({ plans: [] }) as unknown });
    await expect.element(dialog.getByText('Tidak tersimpan. Periksa koneksi lalu coba lagi.')).toBeVisible();
  });

  it('works without accounts', async () => {
    const { view } = sinkingForm(goalsOverview({ goals: [], setAside: null }), []);
    const { screen } = await view;
    await expect.element(screen.getByText(/transfer ke — setelah kamu konfirmasi/)).toBeVisible();
    await screen.getByRole('textbox', { name: 'Sudah terkumpul' }).fill('1');
    await screen.getByRole('button', { name: 'Buat dana' }).click();
    await expect.element(screen.getByText('Melebihi saldo bebas rekening ini.')).toBeVisible();
  });

  it('renders nothing while closed', async () => {
    const { screen } = await renderApp(
      <SinkingForm
        open={false}
        overview={goalsOverview()}
        accounts={GOAL_ACCOUNTS}
        locale="id"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog').query()).toBeNull();
  });
});
