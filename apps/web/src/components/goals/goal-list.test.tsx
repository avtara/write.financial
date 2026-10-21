// SPDX-License-Identifier: AGPL-3.0-only
import type { YearMonth } from '@wf/domain/period';
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  DANA_DARURAT,
  DANA_PENSIUN,
  DP_RUMAH,
  goalSummary,
  LIBURAN_BALI,
  PERPANJANG_STNK,
  plan,
  SEED_GOALS,
  SERVIS_MOTOR,
  source,
  GOAL_ACCOUNTS,
} from '../../../test/goal-fixtures.ts';
import { JAGO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { GoalList, type GoalActions, type GoalListProps, type GoalTab } from './goal-list.tsx';
import type { GoalSort } from './goals-model.ts';

const actions = (): { [K in keyof GoalActions]: Mock } => ({
  open: vi.fn(),
  deposit: vi.fn(),
  withdraw: vi.fn(),
  plans: vi.fn(),
  setPlansActive: vi.fn(),
  complete: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  reopen: vi.fn(),
  moveRemainder: vi.fn(),
});

function list(overrides: Partial<GoalListProps> = {}) {
  const props: GoalListProps = {
    goals: SEED_GOALS,
    accounts: GOAL_ACCOUNTS,
    currentMonth: '2026-10' as YearMonth,
    locale: 'id',
    tab: 'active',
    onTabChange: vi.fn<(tab: GoalTab) => void>(),
    sort: 'deadline',
    onSortChange: vi.fn<(sort: GoalSort) => void>(),
    showSinking: true,
    onShowSinkingChange: vi.fn<(show: boolean) => void>(),
    actions: actions(),
    ...overrides,
  };
  return { props, view: renderApp(<GoalList {...props} />) };
}

describe('GoalList', () => {
  it('golden: the six active goals by the nearest deadline, with their money, progress, plan, and badge', async () => {
    const { view } = list();
    const { screen } = await view;
    const card = screen.getByRole('region', { name: 'Tujuan tabungan' });
    await expect.element(card.getByRole('tab', { name: 'Aktif · 6' })).toHaveAttribute('aria-selected', 'true');
    await expect.element(card.getByRole('tab', { name: 'Selesai · 0' })).toBeVisible();
    const rows = card.getByRole('tabpanel').getByRole('listitem');
    await expect
      .element(rows.nth(0))
      .toMatchTextContent(
        /Servis motorDana tidak rutinRp720\.000dari Rp1\.200\.00060%Rp240\.000\/bulan · tgl 25 · Des 20262 bulan lagi/,
      );
    await expect
      .element(rows.nth(1))
      .toMatchTextContent(/Perpanjang STNK.*80%Rp43\.000\/bulan · tgl 25 · Feb 2027Hampir tercapai/);
    await expect
      .element(rows.nth(2))
      .toMatchTextContent(/Liburan Bali.*35%Rp867\.000\/bulan · tgl 25 · Mar 2027Sesuai rencana/);
    await expect
      .element(rows.nth(3))
      .toMatchTextContent(
        /Dana DaruratBank Jago •• 0377Rp8\.125\.000dari Rp54\.000\.00015%Rp3\.500\.000\/bulan · tgl 1 & 14 · Nov 2027Melewati tenggat/,
      );
    await expect
      .element(rows.nth(4))
      .toMatchTextContent(/DP RumahBCA Tahapan Rp5\.000\.000Rp5\.000\.000.*3%Belum ada setoran rutin$/);
    await expect
      .element(rows.nth(5))
      .toMatchTextContent(/Dana PensiunRp0dari Rp500\.000\.0000%Belum ada setoran rutin/);
  });

  it('runs every action of an active goal’s menu', async () => {
    const { props, view } = list({ goals: [DANA_DARURAT, DP_RUMAH] });
    const { screen } = await view;
    const run = async (goal: string, item: string) => {
      await screen.getByRole('button', { name: `Menu ${goal}` }).click();
      await screen.getByRole('menuitem', { name: item }).click();
    };
    await run('Dana Darurat', 'Lihat detail');
    expect(props.actions.open).toHaveBeenLastCalledWith(DANA_DARURAT);
    await run('Dana Darurat', 'Setor manual');
    expect(props.actions.deposit).toHaveBeenLastCalledWith(DANA_DARURAT);
    await run('Dana Darurat', 'Tarik dana');
    expect(props.actions.withdraw).toHaveBeenLastCalledWith(DANA_DARURAT);
    await run('Dana Darurat', 'Ubah setoran rutin');
    expect(props.actions.plans).toHaveBeenLastCalledWith(DANA_DARURAT);
    await run('Dana Darurat', 'Jeda setoran rutin');
    expect(props.actions.setPlansActive).toHaveBeenLastCalledWith(DANA_DARURAT, false);
    await run('Dana Darurat', 'Ubah tujuan');
    expect(props.actions.edit).toHaveBeenLastCalledWith(DANA_DARURAT);
    await run('Dana Darurat', 'Tandai selesai');
    expect(props.actions.complete).toHaveBeenLastCalledWith(DANA_DARURAT);
    await run('Dana Darurat', 'Hapus tujuan');
    expect(props.actions.remove).toHaveBeenLastCalledWith(DANA_DARURAT);
    // Without plans there is nothing to pause.
    await screen.getByRole('button', { name: 'Menu DP Rumah' }).click();
    expect(screen.getByRole('menuitem', { name: 'Jeda setoran rutin' }).query()).toBeNull();
    await screen.getByRole('menuitem', { name: 'Lihat detail' }).click();
    await screen.getByRole('button', { name: 'Dana Darurat', exact: true }).click();
    expect(props.actions.open).toHaveBeenLastCalledWith(DANA_DARURAT);
  });

  it('resumes paused plans, and offers no withdrawal without a source', async () => {
    const paused = {
      ...LIBURAN_BALI,
      plans: [plan({ id: 'p', amountMinor: 867_000n, active: false })],
      monthlyPlanMinor: 0n,
    };
    const { props, view } = list({ goals: [paused, DANA_PENSIUN] });
    const { screen } = await view;
    await screen.getByRole('button', { name: 'Menu Liburan Bali' }).click();
    await screen.getByRole('menuitem', { name: 'Lanjutkan setoran rutin' }).click();
    expect(props.actions.setPlansActive).toHaveBeenLastCalledWith(paused, true);
    await screen.getByRole('button', { name: 'Menu Dana Pensiun' }).click();
    await expect.element(screen.getByRole('menuitem', { name: 'Tarik dana' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows finished goals in Selesai, the latest first, with reopen and move-remainder', async () => {
    const used = {
      ...PERPANJANG_STNK,
      status: 'used' as const,
      completedAt: new Date('2026-10-17T06:05:00Z'),
      sources: [source({ id: 's', amountMinor: 38_000n, valueMinor: 38_000n })],
      savedMinor: 38_000n,
    };
    const done = {
      ...SERVIS_MOTOR,
      status: 'completed' as const,
      completedAt: new Date('2026-10-01'),
      sources: [],
      savedMinor: 0n,
    };
    const { props, view } = list({ goals: [DANA_DARURAT, done, used], tab: 'done' });
    const { screen } = await view;
    await expect.element(screen.getByText('Terbaru selesai')).toBeVisible();
    const rows = screen.getByRole('tabpanel').getByRole('listitem');
    await expect.element(rows.nth(0)).toMatchTextContent(/Perpanjang STNK.*Terpakai$/);
    await expect.element(rows.nth(1)).toMatchTextContent(/Servis motor.*Selesai$/);
    await screen.getByRole('button', { name: 'Menu Perpanjang STNK' }).click();
    await screen.getByRole('menuitem', { name: 'Pindahkan sisa' }).click();
    expect(props.actions.moveRemainder).toHaveBeenLastCalledWith(used);
    await screen.getByRole('button', { name: 'Menu Servis motor' }).click();
    await expect
      .element(screen.getByRole('menuitem', { name: 'Pindahkan sisa' }))
      .toHaveAttribute('aria-disabled', 'true');
    await screen.getByRole('menuitem', { name: 'Aktifkan lagi' }).click();
    expect(props.actions.reopen).toHaveBeenLastCalledWith(done);
    await screen.getByRole('tab', { name: 'Aktif · 1' }).click();
    expect(props.onTabChange).toHaveBeenCalledWith('active');
  });

  it('sorts, hides the sinking funds, and says when a tab is empty', async () => {
    const { props, view } = list({ goals: [LIBURAN_BALI], showSinking: false });
    const { screen } = await view;
    await expect.element(screen.getByText('Semua tujuan sudah selesai.')).toBeVisible();
    await screen.getByRole('button', { name: 'Tenggat terdekat' }).click();
    await screen.getByRole('menuitemradio', { name: 'Progres tertinggi' }).click();
    expect(props.onSortChange).toHaveBeenCalledWith('progress');
    await screen.getByRole('button', { name: 'Tenggat terdekat' }).click();
    await screen.getByRole('menuitemcheckbox', { name: 'Tampilkan dana tidak rutin' }).click();
    expect(props.onShowSinkingChange).toHaveBeenCalledWith(true);
    const done = await renderApp(<GoalList {...props} goals={[LIBURAN_BALI]} tab="done" sort="name" />);
    await expect.element(done.screen.getByText('Belum ada tujuan yang selesai.')).toBeVisible();
  });

  it('shows a whole source without its last digits, an estimate without a deadline, and a goal without a target', async () => {
    const plain = goalSummary({
      id: 'x',
      name: 'Gadget',
      targetMinor: 0n,
      sources: [
        source({ id: 'w', accountId: JAGO.id, accountName: 'Kas', mode: 'whole', amountMinor: null, valueMinor: 0n }),
      ],
    });
    const estimated = goalSummary({
      id: 'y',
      name: 'Laptop',
      targetMinor: 2_000_000n,
      sources: [
        source({ id: 'f', accountId: 'gone', accountName: 'Lama', mode: 'whole', amountMinor: null, valueMinor: 0n }),
      ],
      plans: [plan({ id: 'p', amountMinor: 1_000_000n })],
    });
    const due = goalSummary({ id: 'z', name: 'Pajak', deadlineMonth: '2026-10' as YearMonth });
    const { view } = list({ goals: [plain, estimated, due] });
    const { screen } = await view;
    const rows = screen.getByRole('tabpanel').getByRole('listitem');
    await expect.element(rows.nth(1)).toMatchTextContent(/GadgetKas •• 0377.*—/);
    await expect.element(rows.nth(0)).toMatchTextContent(/Pajak.*Okt 2026Bulan ini$/);
    await expect.element(rows.nth(2)).toMatchTextContent(/LaptopLama.*Rp1\.000\.000\/bulan · tgl 25 · Des 2026/);
  });
});
