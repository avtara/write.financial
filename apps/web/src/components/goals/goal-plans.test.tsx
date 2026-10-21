// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DANA_DARURAT,
  DANA_PENSIUN,
  GOAL_ACCOUNTS,
  goalsOverview,
  LIBURAN_BALI,
  plan,
} from '../../../test/goal-fixtures.ts';
import { BCA, JAGO, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { GoalPlans } from './goal-plans.tsx';

const server = vi.hoisted(() => ({
  addGoalPlan: vi.fn(),
  setGoalPlanActive: vi.fn(),
  updateGoalPlan: vi.fn(),
}));
vi.mock('../../server/fn/goals.ts', () => server);
const toasts = vi.hoisted(() => vi.fn());
vi.mock('@wf/ui/toast', () => ({ toast: toasts }));

const ok = { ok: true, value: {} };

function plans(goalId: string | null, overview = goalsOverview()) {
  const onChanged = vi.fn();
  const onOpenChange = vi.fn();
  const view = renderApp(
    <GoalPlans
      open
      goalId={goalId}
      overview={overview}
      accounts={GOAL_ACCOUNTS}
      locale="id"
      onOpenChange={onOpenChange}
      onChanged={onChanged}
    />,
  );
  return { view, onChanged, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  server.addGoalPlan.mockResolvedValue(ok);
  server.setGoalPlanActive.mockResolvedValue(ok);
  server.updateGoalPlan.mockResolvedValue(ok);
});

describe('GoalPlans', () => {
  it('golden: Dana Darurat’s two contributions, changed, paused, and a third added on payday', async () => {
    const { view, onChanged } = plans(DANA_DARURAT.id);
    const { screen } = await view;
    const sheet = screen.getByRole('dialog', { name: 'Setoran rutin Dana Darurat' });
    await expect
      .element(
        sheet.getByText(
          'Tiap jatuh tempo masuk Perlu ditinjau, lalu tercatat sebagai Transfer setelah kamu konfirmasi.',
        ),
      )
      .toBeVisible();
    const first = sheet.getByRole('switch', { name: /Tiap tgl 1 · perlu konfirmasi/ });
    await expect.element(first).toBeChecked();
    await expect.element(sheet.getByText(`${BCA.displayName} → ${JAGO.displayName}`)).toBeVisible();
    const amounts = sheet.getByRole('textbox', { name: 'Jumlah / bulan' });
    await expect.element(amounts.nth(0)).toHaveValue('500.000');
    await expect.element(sheet.getByRole('button', { name: 'Simpan' }).nth(0)).toBeDisabled();
    await amounts.nth(0).fill('750.000');
    await sheet.getByRole('button', { name: 'Simpan' }).nth(0).click();
    expect(server.updateGoalPlan).toHaveBeenCalledWith({ data: { planId: 'plan-kantong', amountMinor: 750_000n } });
    expect(toasts).toHaveBeenLastCalledWith({ tone: 'success', title: 'Setoran rutin disimpan' });
    expect(onChanged).toHaveBeenCalledTimes(1);
    await first.click();
    expect(server.setGoalPlanActive).toHaveBeenCalledWith({ data: { planId: 'plan-kantong', active: false } });
    expect(toasts).toHaveBeenLastCalledWith({ tone: 'success', title: 'Setoran rutin Dana Darurat dijeda' });

    await sheet.getByRole('button', { name: 'Tambah setoran rutin' }).click();
    const add = sheet.getByRole('button', { name: 'Tambahkan' });
    await expect.element(add).toBeDisabled();
    await expect.element(amounts.nth(2)).toHaveFocus();
    await amounts.nth(2).fill('250.000');
    await expect.element(sheet.getByRole('combobox', { name: 'Tanggal' })).toHaveValue('25');
    await sheet.getByRole('combobox', { name: 'Tanggal' }).selectOptions('10');
    await expect.element(sheet.getByRole('combobox', { name: 'Dari' })).toMatchTextContent(BCA.displayName);
    await expect.element(sheet.getByRole('combobox', { name: 'Ke' })).toMatchTextContent(JAGO.displayName);
    await sheet.getByRole('combobox', { name: 'Dari' }).click();
    await screen.getByRole('option', { name: OVO.displayName }).click();
    await add.click();
    expect(server.addGoalPlan).toHaveBeenCalledWith({
      data: {
        goalId: DANA_DARURAT.id,
        plan: {
          amountMinor: 250_000n,
          monthDay: 10,
          fromAccountId: OVO.id,
          toAccountId: JAGO.id,
          startOn: '2026-11-10',
        },
      },
    });
    expect(toasts).toHaveBeenLastCalledWith({ tone: 'success', title: 'Setoran rutin ditambahkan' });
    await expect.element(sheet.getByRole('button', { name: 'Tambah setoran rutin' })).toBeVisible();
  });

  it('lists every active goal, resumes a paused contribution, and reports refusals', async () => {
    server.setGoalPlanActive
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockRejectedValueOnce(new TypeError('offline'));
    server.updateGoalPlan.mockRejectedValueOnce(new TypeError('offline'));
    server.addGoalPlan
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_GOAL' })
      .mockRejectedValueOnce(new TypeError('offline'));
    const paused = {
      ...LIBURAN_BALI,
      plans: [plan({ id: 'p', amountMinor: 867_000n, active: false, monthDay: null })],
    };
    const done = { ...DANA_PENSIUN, status: 'completed' as const };
    const { view, onChanged } = plans(
      null,
      goalsOverview({ goals: [paused, done, { ...DANA_PENSIUN, id: 'kosong', name: 'Kosong' }] }),
    );
    const { screen } = await view;
    const sheet = screen.getByRole('dialog', { name: 'Setoran rutin' });
    expect(sheet.getByRole('region', { name: DANA_PENSIUN.name }).query()).toBeNull();
    await expect
      .element(sheet.getByRole('region', { name: 'Kosong' }).getByText('Belum ada setoran rutin.'))
      .toBeVisible();
    const toggle = sheet.getByRole('switch', { name: /Tiap bulan · dijeda/ });
    await toggle.click();
    expect(server.setGoalPlanActive).toHaveBeenCalledWith({ data: { planId: 'p', active: true } });
    expect(toasts).toHaveBeenLastCalledWith({ tone: 'error', title: 'Data ini sudah tidak ada. Muat ulang halaman.' });
    await toggle.click();
    expect(toasts).toHaveBeenLastCalledWith({
      tone: 'error',
      title: 'Tidak tersimpan. Periksa koneksi lalu coba lagi.',
    });
    await toggle.click();
    expect(toasts).toHaveBeenLastCalledWith({ tone: 'success', title: 'Setoran rutin Liburan Bali berjalan lagi' });
    await sheet.getByRole('textbox', { name: 'Jumlah / bulan' }).fill('900.000');
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    expect(toasts).toHaveBeenLastCalledWith({
      tone: 'error',
      title: 'Tidak tersimpan. Periksa koneksi lalu coba lagi.',
    });

    const region = sheet.getByRole('region', { name: 'Kosong' });
    await region.getByRole('button', { name: 'Tambah setoran rutin' }).click();
    await region.getByRole('textbox', { name: 'Jumlah / bulan' }).fill('100.000');
    await region.getByRole('combobox', { name: 'Ke' }).click();
    await screen.getByRole('option', { name: JAGO.displayName }).click();
    await region.getByRole('button', { name: 'Tambahkan' }).click();
    expect(toasts).toHaveBeenLastCalledWith({ tone: 'error', title: 'Periksa lagi data tujuan tabungan.' });
    await region.getByRole('button', { name: 'Tambahkan' }).click();
    expect(toasts).toHaveBeenLastCalledWith({
      tone: 'error',
      title: 'Tidak tersimpan. Periksa koneksi lalu coba lagi.',
    });
    // Still open after a refusal; "Batal" closes it.
    await region.getByRole('button', { name: 'Batal' }).click();
    await expect.element(region.getByRole('button', { name: 'Tambah setoran rutin' })).toBeVisible();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('names unknown accounts with a dash and renders nothing while closed', async () => {
    const odd = { ...DANA_DARURAT, plans: [plan({ id: 'odd', fromAccountId: 'gone', toAccountId: 'gone' })] };
    const { view } = plans(odd.id, goalsOverview({ goals: [odd] }));
    const { screen } = await view;
    await expect.element(screen.getByText('— → —')).toBeVisible();
    const bare = await renderApp(
      <GoalPlans
        open
        goalId={DANA_PENSIUN.id}
        overview={goalsOverview({ payday: null })}
        accounts={[]}
        locale="id"
        onOpenChange={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    const sheet = bare.screen.getByRole('dialog', { name: 'Setoran rutin Dana Pensiun' });
    await sheet.getByRole('button', { name: 'Tambah setoran rutin' }).click();
    await expect.element(sheet.getByRole('combobox', { name: 'Tanggal' })).toHaveValue('25');
    await expect.element(sheet.getByRole('combobox', { name: 'Dari' })).toMatchTextContent('Pilih rekening');
    await expect.element(sheet.getByRole('button', { name: 'Tambahkan' })).toBeDisabled();
    const closed = await renderApp(
      <GoalPlans
        open={false}
        goalId={null}
        overview={goalsOverview()}
        accounts={GOAL_ACCOUNTS}
        locale="id"
        onOpenChange={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(closed.screen.getByRole('dialog', { name: 'Setoran rutin' }).query()).toBeNull();
  });
});
