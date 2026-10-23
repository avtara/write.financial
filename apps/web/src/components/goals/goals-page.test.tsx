// SPDX-License-Identifier: AGPL-3.0-only
import type { YearMonth } from '@wf/domain/period';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { RenderResult } from 'vitest-browser-react';
import {
  DANA_DARURAT,
  DANA_PENSIUN,
  DP_RUMAH,
  GOAL_ACCOUNTS,
  goalSummary,
  goalsOverview,
  LIBURAN_BALI,
  PERPANJANG_STNK,
  plan,
  SERVIS_MOTOR,
  source,
} from '../../../test/goal-fixtures.ts';
import { goalAssetOptions, SPY } from '../../../test/investment-fixtures.ts';
import { BCA, JAGO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { GoalsOverview } from '../../server/fn/goals.ts';
import { GoalsPage, type GoalsPageProps } from './goals-page.tsx';

const server = vi.hoisted(() => ({
  completeGoal: vi.fn(),
  depositToGoal: vi.fn(),
  moveGoalRemainder: vi.fn(),
  removeGoal: vi.fn(),
  reopenGoal: vi.fn(),
  setGoalPlanActive: vi.fn(),
  withdrawFromGoal: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  getGoalHistory: vi.fn(),
  addGoalPlan: vi.fn(),
  updateGoalPlan: vi.fn(),
}));
vi.mock('../../server/fn/goals.ts', () => server);
const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { undo: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@wf/ui/toast', () => toasts);
const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));

const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });
const refused = (code = 'INVALID_GOAL') => Promise.resolve({ ok: false, code });
const { toast } = toasts;
const lastToast = () => toast.mock.lastCall?.[0] as { title: string; action?: { onClick: () => void } };

async function renderPage(patch: Partial<GoalsPageProps> = {}) {
  const onConsumeSearch = vi.fn();
  const onMonthChange = vi.fn();
  const rendered = await renderApp(
    <GoalsPage
      overview={goalsOverview()}
      accounts={GOAL_ACCOUNTS}
      timeZone="Asia/Jakarta"
      onConsumeSearch={onConsumeSearch}
      onMonthChange={onMonthChange}
      {...patch}
    />,
  );
  const invalidate = vi.spyOn(rendered.router, 'invalidate').mockResolvedValue();
  const navigate = vi.spyOn(rendered.router, 'navigate').mockResolvedValue();
  return { ...rendered, onConsumeSearch, onMonthChange, invalidate, navigate };
}

const menu = async (screen: RenderResult, goal: string, item: string) => {
  await screen.getByRole('button', { name: `Menu ${goal}` }).click();
  await screen.getByRole('menuitem', { name: item }).click();
};

beforeEach(async () => {
  await page.viewport(1440, 1000);
  vi.clearAllMocks();
  server.getGoalHistory.mockResolvedValue({ ok: true, value: [] });
});

describe('GoalsPage', () => {
  it('golden: the header, KPIs, goals, October’s contributions, and the sinking funds of 15 Okt', async () => {
    const { screen, onMonthChange } = await renderPage();
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Tabungan' })).toBeVisible();
    await expect.element(screen.getByText('6 tujuan aktif · Oktober 2026')).toBeVisible();
    await expect
      .element(screen.getByRole('region', { name: 'Ringkasan tabungan' }))
      .toMatchTextContent(/Rp17\.325\.000/);
    await expect.element(screen.getByRole('region', { name: 'Tujuan tabungan' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Setoran Oktober' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Dana tidak rutin' })).toBeVisible();
    await screen.getByRole('button', { name: 'Bulan sebelumnya' }).click();
    expect(onMonthChange).toHaveBeenCalledWith('2026-09');
    await expect.element(screen.getByRole('button', { name: 'Bulan berikutnya' })).toBeDisabled();
  });

  it('opens what the search asks for, also when it changes, and consumes it', async () => {
    function Harness() {
      const [goal, setGoal] = useState<string | undefined>(undefined);
      const [isNew, setNew] = useState(false);
      const [remainder, setRemainder] = useState<string | undefined>(undefined);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setGoal(LIBURAN_BALI.id);
            }}
          >
            goal
          </button>
          <button
            type="button"
            onClick={() => {
              setNew(true);
            }}
          >
            new
          </button>
          <button
            type="button"
            onClick={() => {
              setRemainder(PERPANJANG_STNK.id);
            }}
          >
            remainder
          </button>
          <GoalsPage
            overview={goalsOverview()}
            accounts={GOAL_ACCOUNTS}
            timeZone="Asia/Jakarta"
            initialGoalId={goal}
            initialNew={isNew}
            initialRemainderId={remainder}
            onConsumeSearch={() => {
              consume();
              setGoal(undefined);
              setNew(false);
              setRemainder(undefined);
            }}
            onMonthChange={vi.fn()}
          />
        </>
      );
    }
    const consume = vi.fn();
    const { screen } = await renderApp(<Harness />);
    expect(consume).not.toHaveBeenCalled();
    await screen.getByRole('button', { name: 'goal', exact: true }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Liburan Bali' })).toBeVisible();
    expect(consume).toHaveBeenCalledTimes(1);
    await screen.getByRole('button', { name: 'Tutup' }).click();
    await screen.getByRole('button', { name: 'new', exact: true }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Tujuan tabungan baru' })).toBeVisible();
    await screen.getByRole('button', { name: 'Batal' }).click();
    await screen.getByRole('button', { name: 'remainder', exact: true }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Pindahkan sisa Perpanjang STNK' })).toBeVisible();
    expect(consume).toHaveBeenCalledTimes(3);
  });

  it('opens a goal from the URL right away', async () => {
    const { screen, onConsumeSearch } = await renderPage({ initialGoalId: DANA_DARURAT.id, initialNew: false });
    await expect.element(screen.getByRole('dialog', { name: 'Dana Darurat' })).toBeVisible();
    expect(onConsumeSearch).toHaveBeenCalled();
  });

  it('deposits through "Setor manual" and offers to view the transfer; a refusal stays in the dialog', async () => {
    server.depositToGoal
      .mockReturnValueOnce(refused())
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockReturnValueOnce(ok({ transactionId: 'tx-1', goal: DANA_DARURAT }));
    const { screen, invalidate, navigate } = await renderPage();
    await menu(screen, 'Dana Darurat', 'Setor manual');
    const dialog = screen.getByRole('dialog', { name: 'Setor ke Dana Darurat' });
    await dialog.getByRole('button', { name: '1.000.000' }).click();
    await dialog.getByRole('textbox', { name: 'Catatan' }).fill('  Bonus  ');
    await dialog.getByRole('button', { name: 'Setor Rp1.000.000' }).click();
    await expect.element(dialog.getByText('Periksa lagi data tujuan tabungan.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Setor Rp1.000.000' }).click();
    await expect.element(dialog.getByText('Tidak tersimpan. Periksa koneksi lalu coba lagi.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Setor Rp1.000.000' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(server.depositToGoal).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        id: DANA_DARURAT.id,
        fromAccountId: BCA.id,
        toAccountId: JAGO.id,
        amountMinor: 1_000_000n,
        note: 'Bonus',
      }) as unknown,
    });
    expect(lastToast().title).toBe('Setoran tercatat');
    expect(invalidate).toHaveBeenCalled();
    lastToast().action?.onClick();
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/transactions', search: { tx: 'tx-1' } }));
  });

  it('asks to complete a goal its deposit reaches, and withdraws without a note', async () => {
    server.depositToGoal.mockReturnValue(ok({ transactionId: 'tx-2', goal: PERPANJANG_STNK }));
    server.withdrawFromGoal.mockReturnValue(ok({ transactionId: 'tx-3', goal: DANA_DARURAT }));
    const { screen } = await renderPage();
    await menu(screen, 'Perpanjang STNK', 'Setor manual');
    const deposit = screen.getByRole('dialog', { name: 'Setor ke Perpanjang STNK' });
    await deposit.getByRole('button', { name: /Pas target/ }).click();
    await deposit.getByRole('button', { name: 'Setor Rp170.000' }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Tandai Perpanjang STNK selesai?' })).toBeVisible();
    await screen.getByRole('button', { name: 'Nanti saja' }).click();
    await menu(screen, 'Dana Darurat', 'Tarik dana');
    const withdraw = screen.getByRole('dialog', { name: 'Tarik dana dari Dana Darurat?' });
    await withdraw.getByRole('textbox', { name: 'Jumlah' }).fill('2.000.000');
    await withdraw.getByRole('button', { name: 'Tarik Rp2.000.000' }).click();
    await expect.element(withdraw).not.toBeInTheDocument();
    expect(server.withdrawFromGoal).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromAccountId: JAGO.id, toAccountId: BCA.id, note: null }) as unknown,
    });
    expect(lastToast().title).toBe('Dana ditarik');
  });

  it('withdraws from an account outside the account list', async () => {
    server.withdrawFromGoal.mockReturnValue(ok({ transactionId: 'tx-4', goal: DANA_DARURAT }));
    const bibit = {
      ...DANA_DARURAT,
      sources: [
        source({
          id: 'b',
          accountId: 'acc-bibit',
          accountName: 'Bibit',
          amountMinor: 3_000_000n,
          valueMinor: 3_000_000n,
        }),
      ],
      savedMinor: 3_000_000n,
    };
    const { screen } = await renderPage({ overview: goalsOverview({ goals: [bibit] }) });
    await menu(screen, 'Dana Darurat', 'Tarik dana');
    await screen.getByRole('textbox', { name: 'Jumlah' }).fill('1.000.000');
    await screen.getByRole('button', { name: 'Tarik Rp1.000.000' }).click();
    await vi.waitFor(() => {
      expect(lastToast().title).toBe('Dana ditarik');
    });
    const { screen: toastScreen } = await renderApp(
      <p>{(lastToast() as unknown as { description: ReactNode }).description}</p>,
    );
    await expect.element(toastScreen.getByText(/Transfer — → BCA Tahapan dibuat di Transaksi\./)).toBeVisible();
  });

  it('marks a goal done with "Urungkan", which reopens it with its contributions', async () => {
    server.completeGoal.mockReturnValueOnce(ok({ goal: SERVIS_MOTOR, stoppedPlanIds: ['plan-servis'] }));
    server.reopenGoal.mockReturnValue(ok(SERVIS_MOTOR));
    const { screen } = await renderPage();
    await menu(screen, 'Servis motor', 'Tandai selesai');
    await screen
      .getByRole('dialog', { name: 'Tandai Servis motor selesai?' })
      .getByRole('button', { name: 'Tandai selesai' })
      .click();
    expect(server.completeGoal).toHaveBeenCalledWith({ data: { id: SERVIS_MOTOR.id, stopPlans: true } });
    const undo = toast.undo.mock.lastCall?.[0] as { title: string; onUndo: () => void };
    expect(undo.title).toBe('Servis motor selesai');
    undo.onUndo();
    await vi.waitFor(() => {
      expect(server.reopenGoal).toHaveBeenCalledWith({ data: { id: SERVIS_MOTOR.id, resumePlanIds: ['plan-servis'] } });
    });
    await vi.waitFor(() => {
      expect(lastToast().title).toBe('Servis motor aktif lagi');
    });
  });

  it('completes a goal without contributions, and tells of a failed completion', async () => {
    server.completeGoal
      .mockReturnValueOnce(ok({ goal: DP_RUMAH, stoppedPlanIds: [] }))
      .mockRejectedValueOnce(new TypeError('offline'));
    const { screen } = await renderPage();
    await menu(screen, 'DP Rumah', 'Tandai selesai');
    await screen.getByRole('button', { name: 'Tandai selesai' }).click();
    expect(server.completeGoal).toHaveBeenCalledWith({ data: { id: DP_RUMAH.id, stopPlans: false } });
    await menu(screen, 'Dana Pensiun', 'Tandai selesai');
    await screen.getByRole('button', { name: 'Tandai selesai' }).click();
    await vi.waitFor(() => {
      expect(lastToast().title).toBe('Tidak tersimpan. Periksa koneksi lalu coba lagi.');
    });
  });

  it('pauses every contribution with "Urungkan", and stops at a refusal', async () => {
    server.setGoalPlanActive.mockReturnValue(ok(DANA_DARURAT));
    const { screen, invalidate } = await renderPage();
    await menu(screen, 'Dana Darurat', 'Jeda setoran rutin');
    await vi.waitFor(() => {
      expect(lastToast().title).toBe('Setoran rutin Dana Darurat dijeda');
    });
    expect(server.setGoalPlanActive.mock.calls.map(([call]) => call as unknown)).toEqual([
      { data: { planId: 'plan-kantong', active: false } },
      { data: { planId: 'plan-bibit', active: false } },
    ]);
    lastToast().action?.onClick();
    await vi.waitFor(() => {
      expect(server.setGoalPlanActive).toHaveBeenCalledTimes(4);
    });
    expect(server.setGoalPlanActive).toHaveBeenLastCalledWith({ data: { planId: 'plan-bibit', active: true } });
    server.setGoalPlanActive.mockReturnValueOnce(refused('NOT_FOUND'));
    await menu(screen, 'Liburan Bali', 'Jeda setoran rutin');
    await vi.waitFor(() => {
      expect(lastToast().title).toBe('Data ini sudah tidak ada. Muat ulang halaman.');
    });
    server.setGoalPlanActive.mockRejectedValueOnce(new TypeError('offline'));
    await menu(screen, 'Servis motor', 'Jeda setoran rutin');
    await vi.waitFor(() => {
      expect(lastToast().title).toBe('Tidak tersimpan. Periksa koneksi lalu coba lagi.');
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it('resumes paused contributions', async () => {
    server.setGoalPlanActive.mockReturnValue(ok(LIBURAN_BALI));
    const paused = {
      ...LIBURAN_BALI,
      plans: [plan({ id: 'p', amountMinor: 867_000n, active: false })],
      monthlyPlanMinor: 0n,
    };
    const { screen } = await renderPage({ overview: goalsOverview({ goals: [paused] }) });
    await menu(screen, 'Liburan Bali', 'Lanjutkan setoran rutin');
    await vi.waitFor(() => {
      expect(lastToast().title).toBe('Setoran rutin Liburan Bali berjalan lagi');
    });
  });

  it('pays from a goal through the Record sheet, from the account its money is in', async () => {
    const { screen } = await renderPage();
    await screen.getByRole('button', { name: 'Perpanjang STNK', exact: true }).click();
    await screen.getByRole('button', { name: 'Pakai dana' }).click();
    expect(record.open).toHaveBeenLastCalledWith({
      type: 'expense',
      goalId: PERPANJANG_STNK.id,
      description: 'Perpanjang STNK',
      accountId: BCA.id,
    });
    await screen.getByRole('button', { name: 'Dana Darurat', exact: true }).click();
    await screen.getByRole('button', { name: 'Pakai dana' }).click();
    expect(record.open).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: JAGO.id }) as unknown);
    await screen.getByRole('button', { name: 'Dana Pensiun', exact: true }).click();
    await screen.getByRole('button', { name: 'Pakai dana' }).click();
    expect(record.open).toHaveBeenLastCalledWith({
      type: 'expense',
      goalId: DANA_PENSIUN.id,
      description: 'Dana Pensiun',
    });
  });

  it('moves the remainder of a used goal, or releases it, and reopens a finished goal', async () => {
    const used = {
      ...PERPANJANG_STNK,
      status: 'used' as const,
      completedAt: new Date('2026-10-17T06:05:00Z'),
      sources: [source({ id: 's', amountMinor: 38_000n, valueMinor: 38_000n })],
      savedMinor: 38_000n,
    };
    const after = { ...SERVIS_MOTOR, savedMinor: 758_000n };
    server.moveGoalRemainder
      .mockReturnValueOnce(ok([{ ...used, sources: [], savedMinor: 0n }, after]))
      .mockReturnValueOnce(ok([{ ...used, sources: [], savedMinor: 0n }]))
      .mockReturnValueOnce(
        ok([
          { ...used, sources: [] },
          { ...SERVIS_MOTOR, targetMinor: 0n },
        ]),
      );
    server.reopenGoal.mockReturnValue(refused('NOT_FOUND'));
    const goals = [LIBURAN_BALI, SERVIS_MOTOR, used];
    const { screen } = await renderPage({ overview: goalsOverview({ goals }) });
    await screen.getByRole('tab', { name: 'Selesai · 1' }).click();
    await menu(screen, 'Perpanjang STNK', 'Pindahkan sisa');
    const dialog = screen.getByRole('dialog', { name: 'Pindahkan sisa Perpanjang STNK' });
    await dialog.getByRole('radio', { name: /^Servis motor/ }).click();
    await dialog.getByRole('button', { name: 'Pindahkan' }).click();
    expect(server.moveGoalRemainder).toHaveBeenCalledWith({ data: { id: used.id, toGoalId: SERVIS_MOTOR.id } });
    expect(lastToast().title).toBe('Sisa dipindah ke Servis motor');
    await menu(screen, 'Perpanjang STNK', 'Pindahkan sisa');
    await screen.getByRole('radio', { name: /^Lepas jadi saldo bebas/ }).click();
    await screen.getByRole('button', { name: 'Pindahkan' }).click();
    expect(lastToast().title).toBe('Sisa dilepas jadi saldo bebas');
    await menu(screen, 'Perpanjang STNK', 'Pindahkan sisa');
    await screen.getByRole('button', { name: 'Pindahkan' }).click();
    expect(lastToast().title).toBe('Sisa dipindah ke Servis motor');
    await menu(screen, 'Perpanjang STNK', 'Pindahkan sisa');
    await screen.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    await menu(screen, 'Perpanjang STNK', 'Aktifkan lagi');
    await vi.waitFor(() => {
      expect(lastToast().title).toBe('Data ini sudah tidak ada. Muat ulang halaman.');
    });
    expect(server.reopenGoal).toHaveBeenCalledWith({ data: { id: used.id, resumePlanIds: [] } });
  });

  it('creates, edits, and deletes goals, and adds a sinking fund', async () => {
    server.createGoal.mockReturnValue(ok({ id: 'new', name: 'Laptop' }));
    server.updateGoal.mockReturnValue(ok({ id: DP_RUMAH.id, name: 'DP Rumah' }));
    server.removeGoal.mockReturnValue(ok(null));
    const { screen } = await renderPage();
    await screen.getByRole('button', { name: 'Tujuan baru' }).click();
    const form = screen.getByRole('dialog', { name: 'Tujuan tabungan baru' });
    await form.getByRole('textbox', { name: 'Nama tujuan' }).fill('Laptop');
    await form.getByRole('textbox', { name: 'Target' }).fill('18.000.000');
    await form.getByRole('button', { name: 'Buat tujuan' }).click();
    expect(lastToast().title).toBe('Laptop dibuat');
    await menu(screen, 'DP Rumah', 'Ubah tujuan');
    await screen.getByRole('dialog', { name: 'Ubah DP Rumah' }).getByRole('button', { name: 'Simpan' }).click();
    expect(lastToast().title).toBe('DP Rumah disimpan');
    await menu(screen, 'DP Rumah', 'Hapus tujuan');
    const confirm = screen.getByRole('alertdialog', { name: 'Hapus DP Rumah?' });
    await confirm.getByRole('button', { name: 'Batal' }).click();
    await expect.element(confirm).not.toBeInTheDocument();
    await menu(screen, 'DP Rumah', 'Hapus tujuan');
    await screen.getByRole('alertdialog').getByRole('button', { name: 'Hapus tujuan' }).click();
    expect(server.removeGoal).toHaveBeenCalledWith({ data: { id: DP_RUMAH.id } });
    await vi.waitFor(() => {
      expect(lastToast().title).toBe('DP Rumah dihapus');
    });
    server.createGoal.mockReturnValueOnce(ok({ id: 'fund', name: 'Asuransi motor' }));
    await screen.getByRole('button', { name: 'Dana baru' }).click();
    const fund = screen.getByRole('dialog', { name: 'Dana tidak rutin baru' });
    await fund.getByRole('textbox', { name: 'Nama' }).fill('Asuransi motor');
    await fund.getByRole('textbox', { name: 'Target' }).fill('1.500.000');
    await fund.getByLabelText('Jatuh tempo').fill('2027-04');
    await fund.getByRole('button', { name: 'Buat dana' }).click();
    expect(lastToast().title).toBe('Asuransi motor dibuat');
    await screen.getByRole('button', { name: 'Dana baru' }).click();
    await screen.getByRole('dialog', { name: 'Dana tidak rutin baru' }).getByRole('button', { name: 'Batal' }).click();
  });

  it('opens the contributions of every goal or of one, and every dialog closes', async () => {
    const { screen, invalidate } = await renderPage();
    await screen.getByRole('button', { name: 'Setoran rutin', exact: true }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Setoran rutin' })).toBeVisible();
    await screen.getByRole('button', { name: 'Tutup' }).click();
    await menu(screen, 'Dana Darurat', 'Ubah setoran rutin');
    const sheet = screen.getByRole('dialog', { name: 'Setoran rutin Dana Darurat' });
    server.setGoalPlanActive.mockReturnValueOnce(ok(DANA_DARURAT));
    await sheet.getByRole('switch').first().click();
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    await screen.getByRole('button', { name: 'Tutup' }).click();
    await menu(screen, 'Dana Darurat', 'Setor manual');
    await screen.getByRole('button', { name: 'Batal' }).click();
    await menu(screen, 'Dana Darurat', 'Tarik dana');
    await screen.getByRole('button', { name: 'Batal' }).click();
    await menu(screen, 'Dana Darurat', 'Lihat detail');
    await screen
      .getByRole('dialog', { name: 'Dana Darurat' })
      .getByRole('button', { name: 'Ubah', exact: true })
      .first()
      .click();
    await expect.element(screen.getByRole('dialog', { name: 'Setoran rutin Dana Darurat' })).toBeVisible();
  });

  it('starts from a template when there are no goals yet', async () => {
    const overview: GoalsOverview = goalsOverview({ goals: [], movements: [], setAside: null });
    const { screen } = await renderPage({ overview });
    await expect
      .element(screen.getByText('Belum ada tujuan · Ditabung Oktober tetap dihitung dari transaksi'))
      .toBeVisible();
    expect(screen.getByRole('button', { name: 'Setoran rutin', exact: true }).query()).toBeNull();
    await screen.getByRole('button', { name: 'Pakai template Dana Darurat' }).click();
    await expect.element(screen.getByRole('textbox', { name: 'Nama tujuan' })).toHaveValue('Dana Darurat');
    await screen.getByRole('button', { name: 'Batal' }).click();
    await screen.getByRole('button', { name: 'Buat tujuan pertama' }).click();
    await expect.element(screen.getByRole('textbox', { name: 'Nama tujuan' })).toHaveValue('');
  });

  it('can go forward again from an earlier month', async () => {
    const { screen, onMonthChange } = await renderPage({
      overview: goalsOverview({ month: '2026-09' as YearMonth }),
    });
    await expect.element(screen.getByText('6 tujuan aktif · September 2026')).toBeVisible();
    await screen.getByRole('button', { name: 'Bulan berikutnya' }).click();
    expect(onMonthChange).toHaveBeenCalledWith('2026-10');
  });

  it('switches to account-only valuation, counts accounts only, and retries the prices', async () => {
    const goal = goalSummary({
      id: DP_RUMAH.id,
      name: DP_RUMAH.name,
      sources: DP_RUMAH.sources,
      assetSources: [
        {
          id: 'src-spy',
          assetId: SPY.id,
          symbol: 'SPY',
          assetName: SPY.name,
          mode: 'percent',
          valuation: 'market',
          bps: 6000,
          units: '0.718',
          valueMinor: 9_100_000n,
          sortOrder: 1,
        },
      ],
    });
    const { screen, invalidate } = await renderPage({
      overview: goalsOverview({ goals: [goal] }),
      assets: goalAssetOptions([{ ...SPY, quote: null }]),
    });
    const notice = screen.getByLabelText('Nilai tujuan berbasis investasi');
    await expect.element(notice).toMatchTextContent('Harga investasi belum tersedia');
    await screen.getByRole('button', { name: 'Coba lagi' }).click();
    expect(invalidate).toHaveBeenCalled();
    await screen.getByRole('button', { name: 'Lihat saldo rekening saja' }).click();
    await expect.element(notice).toMatchTextContent('Menampilkan saldo rekening saja');
    await screen.getByRole('button', { name: 'Hitung lagi dengan investasi' }).click();
    await expect.element(notice).toMatchTextContent('Harga investasi belum tersedia');
  });
});
