// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  DANA_DARURAT,
  DANA_PENSIUN,
  GOAL_ACCOUNTS,
  goalSummary,
  LIBURAN_BALI,
  PERPANJANG_STNK,
  plan,
  SEED_GOALS,
  SERVIS_MOTOR,
  source,
} from '../../../test/goal-fixtures.ts';
import { BCA, CARD, JAGO, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { GoalSummary } from '../../server/fn/goals.ts';
import { CompleteDialog, DepositDialog, RemainderDialog, WithdrawDialog, type MoveInput } from './goal-dialogs.tsx';

const TODAY = '2026-10-15' as LocalDate;

/** Dana Darurat with Bibit RDPU as in design 13: Rp11.125.000 (21%, 0,6 bulan, Nov 2027). */
const DARURAT: GoalSummary = {
  ...DANA_DARURAT,
  sources: [
    ...DANA_DARURAT.sources,
    source({
      id: 'src-bibit',
      accountId: 'acc-bibit',
      accountName: 'Bibit',
      amountMinor: 3_000_000n,
      valueMinor: 3_000_000n,
    }),
  ],
  savedMinor: 11_125_000n,
};

function moveDialog(
  Dialog: typeof DepositDialog,
  goal: GoalSummary | null,
  onSubmit = vi.fn<(goal: GoalSummary, input: MoveInput) => Promise<string | null>>().mockResolvedValue(null),
) {
  const onOpenChange = vi.fn();
  const view = renderApp(
    <Dialog
      goal={goal}
      goals={SEED_GOALS}
      accounts={GOAL_ACCOUNTS}
      today={TODAY}
      locale="id"
      platform="mac"
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />,
  );
  return { view, onSubmit, onOpenChange };
}

describe('DepositDialog', () => {
  it('golden (PCgK1): Rp1.000.000 from BCA to Bank Jago moves 21% → 22% and Nov 2027 → Okt 2027', async () => {
    const { view, onSubmit, onOpenChange } = moveDialog(DepositDialog, DARURAT);
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Setor ke Dana Darurat' });
    await expect
      .element(dialog.getByText('Terkumpul Rp11.125.000 dari Rp54.000.000 · kurang Rp42.875.000'))
      .toBeVisible();
    expect(dialog.getByRole('button', { name: /Pas target/ }).query()).toBeNull();
    await expect.element(dialog.getByRole('combobox', { name: 'Dari' })).toMatchTextContent('BCA Tahapan');
    await expect.element(dialog.getByRole('combobox', { name: 'Ke' })).toMatchTextContent('Bank Jago');
    await expect.element(dialog.getByText('Saldo Rp42.810.000')).toBeVisible();
    await expect.element(dialog.getByText('#dana-darurat')).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Setor', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '1.000.000' }).click();
    await expect.element(dialog.getByRole('button', { name: '1.000.000' })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(dialog).toMatchTextContent('Progres21% → 22%');
    await expect.element(dialog).toMatchTextContent('Ketahanan0,6 → 0,7 bulan');
    await expect.element(dialog).toMatchTextContent('Estimasi tercapaiNov 2027 → Okt 2027');
    await dialog.getByRole('textbox', { name: 'Catatan' }).fill('Bonus proyek freelance');
    await dialog.getByRole('button', { name: 'Setor Rp1.000.000' }).click();
    expect(onSubmit).toHaveBeenCalledWith(DARURAT, {
      clientId: expect.any(String) as unknown,
      fromAccountId: BCA.id,
      toAccountId: JAGO.id,
      amountMinor: 1_000_000n,
      date: TODAY,
      note: 'Bonus proyek freelance',
    });
    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('golden (biM3a): "Pas target" Rp170.000 reaches Perpanjang STNK, and ⌘↵ saves; a refusal is shown', async () => {
    const onSubmit = vi
      .fn<(goal: GoalSummary, input: MoveInput) => Promise<string | null>>()
      .mockResolvedValue('Ditolak');
    const { view } = moveDialog(DepositDialog, PERPANJANG_STNK, onSubmit);
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Setor ke Perpanjang STNK' });
    await expect.element(dialog.getByText(/kurang Rp170\.000/)).toBeVisible();
    // Kept in BCA Tahapan, so it comes from another account.
    await expect.element(dialog.getByRole('combobox', { name: 'Ke' })).toMatchTextContent('BCA Tahapan');
    await expect.element(dialog.getByRole('combobox', { name: 'Dari' })).toMatchTextContent('Bank Jago');
    await dialog.getByRole('button', { name: /Pas target/ }).click();
    await expect.element(dialog).toMatchTextContent('Progres80% → 100%');
    await expect.element(dialog.getByText('Tercapai setelah setoran ini')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Dari' }).click();
    await screen.getByRole('option', { name: OVO.displayName }).click();
    await dialog.getByRole('textbox', { name: 'Catatan' }).click();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledWith(
      PERPANJANG_STNK,
      expect.objectContaining({ fromAccountId: OVO.id, toAccountId: BCA.id, amountMinor: 170_000n }) as unknown,
    );
    await expect.element(dialog.getByRole('alert').filter({ hasText: 'Ditolak' })).toBeVisible();
  });

  it('asks for the amount and the accounts before saving', async () => {
    const { view, onSubmit } = moveDialog(DepositDialog, DANA_PENSIUN);
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Setor ke Dana Pensiun' });
    // Nothing saved yet: no "kurang" part, no preview.
    await expect.element(dialog.getByText('Terkumpul Rp0 dari Rp500.000.000', { exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Catatan' }).click();
    await userEvent.keyboard('{Enter}');
    await dialog.getByRole('button', { name: 'Setor', exact: true }).click();
    await expect.element(dialog.getByText('Isi jumlahnya.')).toBeVisible();
    await expect.element(dialog.getByText('Pilih rekening tujuan yang berbeda dari rekening asal.')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Ke' }).click();
    await screen.getByRole('option', { name: OVO.displayName }).click();
    await dialog.getByRole('button', { name: '500.000' }).click();
    await dialog.getByRole('button', { name: 'Setor Rp500.000' }).click();
    expect(onSubmit).toHaveBeenCalledWith(
      DANA_PENSIUN,
      expect.objectContaining({ fromAccountId: BCA.id, toAccountId: OVO.id }) as unknown,
    );
  });

  it('does not offer an account another goal holds wholly, nor a source when every account is taken', async () => {
    const kept = { ...LIBURAN_BALI, accountId: JAGO.id, plans: [] };
    const { view } = moveDialog(DepositDialog, kept);
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Setor ke Liburan Bali' });
    await expect.element(dialog.getByRole('combobox', { name: 'Ke' })).toMatchTextContent('Pilih rekening');
    await dialog.getByRole('combobox', { name: 'Ke' }).click();
    expect(screen.getByRole('option', { name: JAGO.displayName }).query()).toBeNull();
  });

  it('asks where the money comes from when there is no other account', async () => {
    const lonely = await renderApp(
      <DepositDialog
        goal={{ ...DANA_PENSIUN, tag: null }}
        goals={[]}
        accounts={[]}
        today={TODAY}
        locale="id"
        platform="other"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await lonely.screen.getByRole('button', { name: 'Setor', exact: true }).click();
    await expect.element(lonely.screen.getByText('Pilih rekening asal.')).toBeVisible();
  });

  it('renders nothing without a goal', async () => {
    const { view } = moveDialog(DepositDialog, null);
    const { screen } = await view;
    expect(screen.getByRole('dialog').query()).toBeNull();
  });
});

describe('WithdrawDialog', () => {
  it('golden (nVb1Q): Rp2.000.000 from Bank Jago back to BCA moves 21% → 17% and 0,6 → 0,5 months', async () => {
    const { view, onSubmit } = moveDialog(WithdrawDialog, DARURAT);
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Tarik dana dari Dana Darurat?' });
    await expect
      .element(
        dialog.getByText(/Dana dipindah kembali ke rekening pilihanmu dan dicatat sebagai Transfer di Transaksi\./),
      )
      .toBeVisible();
    await expect.element(dialog.getByRole('combobox', { name: 'Ke rekening' })).toMatchTextContent('BCA Tahapan');
    await expect.element(dialog.getByRole('combobox', { name: 'Dari rekening' })).toMatchTextContent('Bank Jago');
    await expect.element(dialog.getByRole('button', { name: 'Tarik dana', exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Jumlah' }).fill('2.000.000');
    await expect.element(dialog).toMatchTextContent('Progres21% → 17%');
    await expect.element(dialog).toMatchTextContent('Ketahanan0,6 → 0,5 bulan');
    // The design's "Des 2027" contradicts its own numbers: 44.875.000 / 3.500.000 → 13 contributions from Nov 2026.
    await expect.element(dialog).toMatchTextContent('Estimasi tercapaiNov 2027 → Nov 2027');
    await dialog.getByRole('button', { name: 'Tarik Rp2.000.000' }).click();
    expect(onSubmit).toHaveBeenCalledWith(DARURAT, {
      clientId: expect.any(String) as unknown,
      fromAccountId: JAGO.id,
      toAccountId: BCA.id,
      amountMinor: 2_000_000n,
      date: TODAY,
      note: '',
    });
  });

  it('keeps to what the chosen account holds for the goal, and asks for an amount', async () => {
    const onSubmit = vi
      .fn<(goal: GoalSummary, input: MoveInput) => Promise<string | null>>()
      .mockResolvedValue('Ditolak');
    const { view, onOpenChange } = moveDialog(WithdrawDialog, DARURAT, onSubmit);
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Tarik dana dari Dana Darurat?' });
    await dialog.getByRole('button', { name: 'Tarik dana', exact: true }).click();
    await expect.element(dialog.getByText('Isi jumlahnya.')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Dari rekening' }).click();
    await screen.getByRole('option', { name: 'Bibit' }).click();
    await dialog.getByRole('textbox', { name: 'Jumlah' }).fill('4.000.000');
    await dialog.getByRole('button', { name: 'Tarik Rp4.000.000' }).click();
    await expect.element(dialog.getByText('Maksimal Rp3.000.000 dari rekening ini.')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
    await dialog.getByRole('textbox', { name: 'Jumlah' }).fill('1.000.000');
    await dialog.getByRole('textbox', { name: 'Jumlah' }).click();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledWith(
      DARURAT,
      expect.objectContaining({ fromAccountId: 'acc-bibit', amountMinor: 1_000_000n }) as unknown,
    );
    await expect.element(dialog.getByRole('alert').filter({ hasText: 'Ditolak' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('needs an account to go to', async () => {
    const lonely = goalSummary({
      id: 'lonely',
      name: 'Sendiri',
      sources: [source({ id: 's', accountId: BCA.id, amountMinor: 10n, valueMinor: 10n })],
    });
    const onSubmit = vi.fn();
    const view = await renderApp(
      <WithdrawDialog
        goal={lonely}
        goals={[]}
        accounts={[BCA]}
        today={TODAY}
        locale="id"
        platform="mac"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const dialog = view.screen.getByRole('dialog', { name: 'Tarik dana dari Sendiri?' });
    expect(dialog.getByRole('combobox', { name: 'Dari rekening' }).query()).toBeNull();
    await dialog.getByRole('textbox', { name: 'Jumlah' }).fill('5');
    await dialog.getByRole('button', { name: 'Tarik Rp5' }).click();
    await expect.element(dialog.getByText('Pilih rekening tujuan yang berbeda dari rekening asal.')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('estimates again once a reached goal falls short, and skips a card as the destination', async () => {
    const reached = goalSummary({
      id: 'r',
      name: 'Pajak',
      targetMinor: 850_000n,
      nextMonth: '2026-10' as GoalSummary['nextMonth'],
      sources: [source({ id: 's', accountId: BCA.id, amountMinor: 850_000n, valueMinor: 850_000n })],
      plans: [plan({ id: 'p', amountMinor: 43_000n, fromAccountId: BCA.id })],
    });
    const onSubmit = vi.fn();
    const view = await renderApp(
      <WithdrawDialog
        goal={reached}
        goals={[]}
        accounts={[BCA, CARD, OVO]}
        today={TODAY}
        locale="id"
        platform="mac"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const dialog = view.screen.getByRole('dialog', { name: 'Tarik dana dari Pajak?' });
    await expect.element(dialog.getByRole('combobox', { name: 'Ke rekening' })).toMatchTextContent(OVO.displayName);
    await dialog.getByRole('textbox', { name: 'Jumlah' }).fill('100.000');
    await expect.element(dialog).toMatchTextContent('Estimasi tercapai— → Des 2026');
  });

  it('refuses any amount for a goal without sources', async () => {
    const onSubmit = vi.fn();
    const empty = await renderApp(
      <WithdrawDialog
        goal={goalSummary({ id: 'none', name: 'Kosong' })}
        goals={[]}
        accounts={[]}
        today={TODAY}
        locale="id"
        platform="mac"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await empty.screen.getByRole('textbox', { name: 'Jumlah' }).fill('5');
    await empty.screen.getByRole('button', { name: 'Tarik Rp5' }).click();
    await expect.element(empty.screen.getByText('Maksimal Rp0 dari rekening ini.')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders nothing without a goal', async () => {
    const { view } = moveDialog(WithdrawDialog, null);
    expect((await view).screen.getByRole('dialog').query()).toBeNull();
  });
});

describe('CompleteDialog', () => {
  const STNK_REACHED = { ...PERPANJANG_STNK, savedMinor: 850_000n };
  const complete = (goal: GoalSummary | null) => {
    const onComplete = vi.fn<(goal: GoalSummary, stop: boolean) => Promise<void>>().mockResolvedValue();
    const onOpenChange = vi.fn();
    const view = renderApp(
      <CompleteDialog goal={goal} today={TODAY} locale="id" onOpenChange={onOpenChange} onComplete={onComplete} />,
    );
    return { view, onComplete, onOpenChange };
  };

  it('golden (rbvBr): STNK reached 4 months early; stopping its Rp43.000 on the 25th marks it done', async () => {
    const { view, onComplete } = complete(STNK_REACHED);
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Perpanjang STNK tercapai' });
    await expect
      .element(
        dialog.getByText(
          'Rp850.000 terkumpul, 4 bulan lebih cepat dari rencana Feb 2027. Dananya siap dipakai kapan saja.',
        ),
      )
      .toBeVisible();
    await expect.element(dialog.getByText('Setoran rutin · Rp43.000 tiap tgl 25')).toBeVisible();
    await expect
      .element(dialog.getByText('Mulai 25 Okt tidak lagi disisihkan. Rencana setoran bulanan turun Rp43.000.'))
      .toBeVisible();
    await expect.element(dialog.getByRole('radio', { name: /Hentikan setoran rutin/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Tandai selesai' }).click();
    expect(onComplete).toHaveBeenCalledWith(STNK_REACHED, true);
  });

  it('keeps a reached goal going as a reserve, or later', async () => {
    const { view, onComplete, onOpenChange } = complete(STNK_REACHED);
    const { screen } = await view;
    await screen.getByRole('radio', { name: /Lanjutkan sebagai cadangan/ }).click();
    await expect.element(screen.getByText('Saldo boleh melebihi target. Tujuan tetap di tab Aktif.')).toBeVisible();
    await screen.getByRole('button', { name: 'Simpan' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await screen.getByRole('button', { name: 'Nanti saja' }).click();
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('marks an unreached goal done, its contributions stopping from next month', async () => {
    const { view, onComplete } = complete(DANA_DARURAT);
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Tandai Dana Darurat selesai?' });
    await expect
      .element(dialog.getByText('Rp8.125.000 terkumpul dari Rp54.000.000. Tujuan pindah ke tab Selesai.'))
      .toBeVisible();
    await expect.element(dialog.getByText(/^Mulai 1 Nov tidak lagi disisihkan/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Tandai selesai' }).click();
    expect(onComplete).toHaveBeenCalledWith(DANA_DARURAT, true);
  });

  it('says it plainly without a deadline ahead, and asks nothing without contributions', async () => {
    const late = { ...STNK_REACHED, deadlineMonth: null, plans: [plan({ id: 'p', amountMinor: 1n, monthDay: null })] };
    const first = complete(late);
    const { screen } = await first.view;
    await expect.element(screen.getByText('Rp850.000 terkumpul. Dananya siap dipakai kapan saja.')).toBeVisible();
    await expect.element(screen.getByText(/^Mulai — tidak lagi disisihkan/)).toBeVisible();
  });

  it('asks nothing about contributions a reached goal never had', async () => {
    const second = complete({ ...STNK_REACHED, deadlineMonth: '2026-10' as GoalSummary['deadlineMonth'], plans: [] });
    const { screen } = await second.view;
    await expect.element(screen.getByText('Rp850.000 terkumpul. Dananya siap dipakai kapan saja.')).toBeVisible();
    expect(screen.getByRole('radio').query()).toBeNull();
    await screen.getByRole('button', { name: 'Tandai selesai' }).click();
    expect(second.onComplete).toHaveBeenCalledWith(expect.objectContaining({ plans: [] }) as unknown, false);
  });

  it('renders nothing without a goal', async () => {
    const { view } = complete(null);
    expect((await view).screen.getByRole('dialog').query()).toBeNull();
  });
});

describe('RemainderDialog', () => {
  const USED = {
    ...PERPANJANG_STNK,
    status: 'used' as const,
    sources: [source({ id: 's', amountMinor: 38_000n, valueMinor: 38_000n })],
    savedMinor: 38_000n,
  };
  const remainder = (
    goal: GoalSummary | null,
    goals: readonly GoalSummary[] = [...SEED_GOALS.filter((g) => g.id !== USED.id), USED],
  ) => {
    const onMove = vi.fn<(goal: GoalSummary, to: string | null) => Promise<void>>().mockResolvedValue();
    const onOpenChange = vi.fn();
    const view = renderApp(
      <RemainderDialog goal={goal} goals={goals} locale="id" onOpenChange={onOpenChange} onMove={onMove} />,
    );
    return { view, onMove, onOpenChange };
  };

  it('golden (m535GI): Rp38.000 moves to Servis motor, Rp720.000 → Rp758.000 of Rp1.200.000, 60% → 63%', async () => {
    const { view, onMove } = remainder(USED);
    const { screen } = await view;
    const dialog = screen.getByRole('dialog', { name: 'Pindahkan sisa Perpanjang STNK' });
    await expect.element(dialog.getByRole('heading', { name: 'Pindahkan sisa Rp38.000' })).toBeVisible();
    await expect
      .element(dialog.getByText('Perpanjang STNK sudah terpakai. Sisanya masih tersimpan di BCA Tahapan.'))
      .toBeVisible();
    const options = dialog.getByRole('radio');
    // Only the other sinking funds, the nearest due first, then "Lepas jadi saldo bebas".
    expect(options.elements()).toHaveLength(3);
    await expect.element(options.nth(0)).toHaveAccessibleName(/^Servis motor/);
    await expect.element(options.nth(0)).toBeChecked();
    await expect.element(options.nth(1)).toHaveAccessibleName(/^Liburan Bali/);
    await expect.element(options.nth(2)).toHaveAccessibleName(/^Lepas jadi saldo bebas/);
    await expect.element(dialog).toMatchTextContent('Servis motorRp720.000 → Rp758.000 dari Rp1.200.00060% → 63%');
    await expect.element(dialog.getByText('Tetap di BCA Tahapan, tidak terikat tujuan mana pun')).toBeVisible();
    await dialog.getByRole('button', { name: 'Pindahkan' }).click();
    expect(onMove).toHaveBeenCalledWith(USED, SERVIS_MOTOR.id);
    await options.nth(2).click();
    await dialog.getByRole('button', { name: 'Pindahkan' }).click();
    expect(onMove).toHaveBeenLastCalledWith(USED, null);
  });

  it('says a completed goal is done, releases by default without other goals, and cancels', async () => {
    const done = { ...USED, status: 'completed' as const };
    const noTarget = goalSummary({ id: 't', name: 'Tanpa target', targetMinor: 0n });
    const { view, onMove, onOpenChange } = remainder(done, [done, noTarget, { ...DANA_PENSIUN, currency: 'USD' }]);
    const { screen } = await view;
    await expect.element(screen.getByText(/^Perpanjang STNK sudah selesai\./)).toBeVisible();
    await expect.element(screen.getByRole('dialog')).toMatchTextContent(/Tanpa targetRp0 → Rp38\.000 dari Rp0— → —/);
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('releases by default without another goal to move to', async () => {
    const done = { ...USED, status: 'completed' as const };
    const alone = remainder(done, [done]);
    const { screen } = await alone.view;
    await expect.element(screen.getByRole('radio', { name: /Lepas jadi saldo bebas/ })).toBeChecked();
    await screen.getByRole('button', { name: 'Pindahkan' }).click();
    expect(alone.onMove).toHaveBeenCalledWith(done, null);
  });

  it('renders nothing without a goal', async () => {
    const { view } = remainder(null);
    expect((await view).screen.getByRole('dialog').query()).toBeNull();
  });
});
