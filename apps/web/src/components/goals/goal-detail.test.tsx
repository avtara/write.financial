// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DANA_DARURAT,
  DP_RUMAH,
  GOAL_ACCOUNTS,
  goalSummary,
  LIBURAN_BALI,
  movement,
  plan,
  source,
} from '../../../test/goal-fixtures.ts';
import { BCA, JAGO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { GoalSummary } from '../../server/fn/goals.ts';
import { GoalDetail, type GoalDetailProps } from './goal-detail.tsx';

const server = vi.hoisted(() => ({ getGoalHistory: vi.fn() }));
vi.mock('../../server/fn/goals.ts', () => server);

const TODAY = '2026-10-15' as LocalDate;
const d = (value: string) => value as LocalDate;

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

const HISTORY = [
  movement({
    key: 'rec-bibit:2026-10-14',
    date: d('2026-10-14'),
    name: 'Setor dana darurat · Bibit RDPU',
    toAccountId: 'acc-bibit',
    shares: [{ goalId: DARURAT.id, amountMinor: 3_000_000n }],
  }),
  movement({
    key: 'manual',
    kind: 'manual',
    date: d('2026-09-14'),
    shares: [{ goalId: DARURAT.id, amountMinor: 2_000_000n }],
  }),
  movement({
    key: 'out',
    kind: 'manual',
    date: d('2026-09-10'),
    fromAccountId: JAGO.id,
    toAccountId: null,
    shares: [{ goalId: DARURAT.id, amountMinor: -100_000n }],
  }),
];

function actions(): GoalDetailProps['actions'] {
  return {
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
    pay: vi.fn(),
  };
}

function detail(goal: GoalSummary | null, accounts = GOAL_ACCOUNTS) {
  const props: GoalDetailProps = {
    goal,
    accounts,
    today: TODAY,
    locale: 'id',
    onOpenChange: vi.fn(),
    actions: actions(),
  };
  return { props, view: renderApp(<GoalDetail {...props} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
  server.getGoalHistory.mockResolvedValue({ ok: true, value: HISTORY });
});

describe('GoalDetail', () => {
  it('golden (q9T3oQ): Dana Darurat 21%, 0,6 months, Nov 2027; where it is kept, its contributions, its history', async () => {
    const { props, view } = detail(DARURAT);
    const { screen } = await view;
    const sheet = screen.getByRole('dialog', { name: 'Dana Darurat' });
    await expect.element(sheet.getByText('Target 3× pengeluaran bulanan')).toBeVisible();
    await expect.element(sheet.getByText('Rp11.125.000', { exact: true })).toBeVisible();
    await expect.element(sheet.getByText('dari Rp54.000.000')).toBeVisible();
    await expect.element(sheet.getByText('21% · 0,6 bulan pengeluaran')).toBeVisible();
    await expect.element(sheet.getByText('Tercapai Nov 2027')).toBeVisible();
    await expect.element(sheet).toMatchTextContent(/Bank Jago•• 0377 · Seluruh saldoRp8\.125\.00073%/);
    await expect.element(sheet).toMatchTextContent(/BibitNominal tetapRp3\.000\.00027%/);
    await expect.element(sheet.getByText('Tiap tgl 1 · perlu konfirmasi')).toBeVisible();
    await expect.element(sheet.getByText(`${BCA.displayName} → ${JAGO.displayName}`).first()).toBeVisible();
    await expect
      .element(sheet.getByRole('link', { name: 'Buka di Transaksi' }))
      .toHaveAttribute('href', '/transactions?tag=dana-darurat');
    // Kept in 2 accounts, 2 contributions, then the history.
    const history = sheet.getByRole('listitem');
    await expect
      .element(history.nth(4))
      .toMatchTextContent(/14 OktSetor dana darurat · Bibit RDPUTransfer terjadwal · BCA Tahapan → —\+3\.000\.000/);
    await expect
      .element(history.nth(5))
      .toMatchTextContent(/14 SepSetor manualTransfer · BCA Tahapan → Bank Jago · #dana-darurat\+2\.000\.000/);
    await expect.element(history.nth(6)).toMatchTextContent(/10 SepTarik danaTransfer · Bank Jago → — · #dana-darurat/);
    expect(server.getGoalHistory).toHaveBeenCalledWith({ data: { id: DARURAT.id } });

    await sheet.getByRole('button', { name: 'Ubah', exact: true }).first().click();
    expect(props.actions.plans).toHaveBeenCalledWith(DARURAT);
    await sheet.getByRole('button', { name: 'Pakai dana' }).click();
    expect(props.actions.pay).toHaveBeenCalledWith(DARURAT);
    await sheet.getByRole('button', { name: 'Ubah' }).nth(1).click();
    expect(props.actions.edit).toHaveBeenCalledWith(DARURAT);
    await sheet.getByRole('button', { name: 'Tarik dana' }).click();
    expect(props.actions.withdraw).toHaveBeenCalledWith(DARURAT);
    await sheet.getByRole('button', { name: 'Setor manual' }).click();
    expect(props.actions.deposit).toHaveBeenCalledWith(DARURAT);
  });

  it('golden (McGzv): a sinking fund shows its due month, monthly amount, what is missing, and where it is kept', async () => {
    server.getGoalHistory.mockResolvedValueOnce({
      ok: true,
      value: [
        movement({
          key: 'next',
          date: d('2026-10-25'),
          name: 'Sisihkan dana tidak rutin',
          status: 'scheduled',
          shares: [{ goalId: LIBURAN_BALI.id, amountMinor: 867_000n }],
          amountMinor: 867_000n,
        }),
      ],
    });
    const { view } = detail(LIBURAN_BALI);
    const { screen } = await view;
    const sheet = screen.getByRole('dialog', { name: 'Liburan Bali' });
    await expect.element(sheet.getByText('Jatuh tempo Mar 2027 · 5 bulan lagi')).toBeVisible();
    await expect.element(sheet.getByText('Sesuai rencana').or(sheet.getByText('Tercapai Mar 2027'))).toBeVisible();
    const facts = sheet.getByRole('definition');
    await expect.element(facts.nth(0)).toMatchTextContent('Rp867.000');
    await expect.element(facts.nth(1)).toMatchTextContent('Rp5.200.000');
    await expect.element(facts.nth(2)).toMatchTextContent(BCA.displayName);
    expect(sheet.getByText('Disimpan di').nth(1).query()).toBeNull();
    await expect
      .element(sheet.getByRole('listitem').filter({ hasText: '25 Okt' }))
      .toMatchTextContent(/25 OktSisihkan dana tidak rutinJadwal berikutnya · BCA Tahapan → Bank Jago\+867\.000/);
    await expect.element(sheet.getByRole('button', { name: 'Sisihkan sekarang' })).toBeVisible();
  });

  it('says what it can without sources, contributions, history, a deadline, or a target', async () => {
    server.getGoalHistory.mockResolvedValueOnce({ ok: true, value: [] });
    const bare = goalSummary({ id: 'bare', name: 'Gadget', targetMinor: 0n });
    const { props, view } = detail(bare);
    const { screen } = await view;
    const sheet = screen.getByRole('dialog', { name: 'Gadget' });
    await expect.element(sheet.getByText('Tanpa tenggat')).toBeVisible();
    await expect.element(sheet.getByText('Tercapai', { exact: true })).toBeVisible();
    await expect
      .element(sheet.getByText('Belum ada rekening. Setor manual atau atur sumber dana di Ubah.'))
      .toBeVisible();
    await expect.element(sheet.getByText('Belum ada setoran rutin.')).toBeVisible();
    await expect.element(sheet.getByText('Belum ada setoran.')).toBeVisible();
    expect(sheet.getByRole('link', { name: 'Buka di Transaksi' }).query()).toBeNull();
    await expect.element(sheet.getByRole('button', { name: 'Tarik dana' })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Tutup' }).click();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows a deadline, a paused contribution, a whole source without digits, and a refused history', async () => {
    server.getGoalHistory.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const rumah: GoalSummary = {
      ...DP_RUMAH,
      deadlineMonth: '2030-01' as GoalSummary['deadlineMonth'],
      sources: [source({ id: 'w', accountId: BCA.id, mode: 'whole', amountMinor: null, valueMinor: 0n })],
      savedMinor: 0n,
      plans: [plan({ id: 'p', amountMinor: 100n, monthDay: null, active: false })],
    };
    const { view } = detail(rumah, []);
    const { screen } = await view;
    const sheet = screen.getByRole('dialog', { name: 'DP Rumah' });
    await expect.element(sheet.getByText('Tenggat Jan 2030')).toBeVisible();
    await expect.element(sheet.getByText('Tiap bulan · dijeda')).toBeVisible();
    await expect.element(sheet.getByText('Seluruh saldo', { exact: true })).toBeVisible();
    await expect.element(sheet.getByText('— → —')).toBeVisible();
    await expect.element(sheet.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
  });

  it('reports a history that cannot load, and is due this month or late', async () => {
    server.getGoalHistory.mockRejectedValueOnce(new TypeError('offline'));
    const due = { ...LIBURAN_BALI, deadlineMonth: '2026-10' as GoalSummary['deadlineMonth'], savedMinor: 7_000_000n };
    const { view } = detail(due);
    const { screen } = await view;
    await expect.element(screen.getByText('Jatuh tempo Okt 2026')).toBeVisible();
    await expect.element(screen.getByText('Riwayat setoran gagal dimuat.')).toBeVisible();
    await expect.element(screen.getByText(/^Tercapai/)).toHaveClass(/text-amber-fg/);
  });

  it('offers reactivating and moving what is left of a finished goal', async () => {
    const used: GoalSummary = {
      ...LIBURAN_BALI,
      status: 'used',
      kind: 'savings',
      deadlineMonth: null,
      accountId: JAGO.id,
      sources: [],
    };
    const { props, view } = detail(used);
    const { screen } = await view;
    const sheet = screen.getByRole('dialog', { name: 'Liburan Bali' });
    expect(sheet.getByRole('button', { name: 'Ubah', exact: true }).query()).toBeNull();
    await expect.element(sheet.getByRole('button', { name: 'Pindahkan sisa' })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Aktifkan lagi' }).click();
    expect(props.actions.reopen).toHaveBeenCalledWith(used);
    const kept = detail({
      ...used,
      kind: 'sinking',
      status: 'completed',
      sources: LIBURAN_BALI.sources,
      accountId: null,
    });
    const other = await kept.view;
    await expect.element(other.screen.getByText('Dana tidak rutin', { exact: true })).toBeVisible();
    await other.screen.getByRole('button', { name: 'Pindahkan sisa' }).click();
    expect(kept.props.actions.moveRemainder).toHaveBeenCalled();
  });

  it('shows where a sinking fund without sources is kept', async () => {
    const { view } = detail({ ...LIBURAN_BALI, sources: [], accountId: JAGO.id });
    const { screen } = await view;
    await expect.element(screen.getByRole('definition').nth(2)).toMatchTextContent(JAGO.displayName);
  });

  it('shows a dash for a sinking fund kept nowhere', async () => {
    const { view } = detail({ ...LIBURAN_BALI, sources: [], accountId: null });
    await expect.element((await view).screen.getByRole('definition').nth(2)).toMatchTextContent('—');
  });

  it('renders nothing without a goal', async () => {
    const { view } = detail(null);
    expect((await view).screen.getByRole('dialog').query()).toBeNull();
  });

  it('drops a history that arrives after the panel closed', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    server.getGoalHistory
      .mockReturnValueOnce(new Promise((done) => (resolve = done)))
      .mockReturnValueOnce(new Promise((_, fail) => (reject = fail)));
    const first = await detail(DARURAT).view;
    await first.screen.unmount();
    resolve({ ok: true, value: HISTORY });
    const second = await detail(DARURAT).view;
    await second.screen.unmount();
    reject(new TypeError('offline'));
    await Promise.resolve();
    expect(server.getGoalHistory).toHaveBeenCalledTimes(2);
  });
});
