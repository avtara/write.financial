// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The design persona's savings goals on 15 Okt 2026 (design section 13, seed `DESIGN_SEED`): Dana Darurat kept wholly
 * in Bank Jago (Rp8.125.000 of 3 × Rp18.000.000, Rp500.000 on the 1st + Rp3.000.000 on the 14th), DP Rumah and Dana
 * Pensiun, and three sinking funds held as fixed amounts of BCA Tahapan and set aside together on the 25th
 * ("Sisihkan dana tidak rutin" Rp1.150.000), with October's contributions.
 */
import type { GoalPlanView, GoalSourceView, GoalView } from '@wf/db/goals';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import type { GoalMovement } from '../src/lib/goal-movements.ts';
import type { GoalSummary, GoalsOverview, SetAsideTransfer } from '../src/server/fn/goals.ts';
import type { AccountView } from '@wf/db/accounts';
import { ACCOUNTS, BCA, JAGO } from './ledger-fixtures.ts';

const d = (value: string) => value as LocalDate;

/** The ledger fixtures' accounts with Bank Jago's last digits ("Bank Jago •• 0377"). */
export const GOAL_ACCOUNTS: readonly AccountView[] = ACCOUNTS.map((account) =>
  account.id === JAGO.id ? { ...account, last4: '0377' } : account,
);
const ym = (value: string) => value as YearMonth;

export function source(overrides: Partial<GoalSourceView> & Pick<GoalSourceView, 'id'>): GoalSourceView {
  return {
    accountId: BCA.id,
    accountName: BCA.displayName,
    mode: 'fixed',
    amountMinor: 0n,
    valueMinor: overrides.amountMinor ?? 0n,
    sortOrder: 0,
    ...overrides,
  };
}

export function plan(overrides: Partial<GoalPlanView> & Pick<GoalPlanView, 'id'>): GoalPlanView {
  return {
    recurrenceId: `rec-${overrides.id}`,
    amountMinor: 0n,
    active: true,
    monthDay: 25,
    fromAccountId: BCA.id,
    toAccountId: JAGO.id,
    recurrenceStatus: 'active',
    ...overrides,
  };
}

export function goalView(overrides: Partial<GoalView> & Pick<GoalView, 'id' | 'name'>): GoalView {
  const sources = overrides.sources ?? [];
  const plans = overrides.plans ?? [];
  return {
    icon: 'target',
    color: 'blue',
    kind: 'savings',
    targetMinor: 1_000_000n,
    targetMode: 'fixed',
    targetMonths: null,
    currency: 'IDR',
    deadlineMonth: null,
    tag: null,
    accountId: null,
    status: 'active',
    completedAt: null,
    sortOrder: 0,
    archivedAt: null,
    savedMinor: sources.reduce((sum, part) => sum + part.valueMinor, 0n),
    monthlyPlanMinor: plans.reduce((sum, part) => sum + (part.active ? part.amountMinor : 0n), 0n),
    ...overrides,
    sources,
    plans,
  };
}

export function goalSummary(overrides: Partial<GoalSummary> & Pick<GoalSummary, 'id' | 'name'>): GoalSummary {
  return { ...goalView(overrides), nextMonth: overrides.nextMonth ?? ym('2026-11') };
}

export const DANA_DARURAT = goalSummary({
  id: 'goal-darurat',
  name: 'Dana Darurat',
  icon: 'shield',
  color: 'green',
  targetMinor: 54_000_000n,
  targetMode: 'monthly_expenses',
  targetMonths: 3,
  deadlineMonth: ym('2027-11'),
  tag: 'dana-darurat',
  accountId: JAGO.id,
  sources: [
    source({
      id: 'src-jago',
      accountId: JAGO.id,
      accountName: JAGO.displayName,
      mode: 'whole',
      amountMinor: null,
      valueMinor: 8_125_000n,
    }),
  ],
  plans: [
    plan({ id: 'plan-kantong', recurrenceId: 'rec-kantong', amountMinor: 500_000n, monthDay: 1 }),
    plan({
      id: 'plan-bibit',
      recurrenceId: 'rec-bibit',
      amountMinor: 3_000_000n,
      monthDay: 14,
      toAccountId: 'acc-bibit',
    }),
  ],
});

export const DP_RUMAH = goalSummary({
  id: 'goal-rumah',
  name: 'DP Rumah',
  icon: 'house',
  targetMinor: 150_000_000n,
  tag: 'dp-rumah',
  sortOrder: 1,
  sources: [source({ id: 'src-rumah', amountMinor: 5_000_000n, valueMinor: 5_000_000n })],
});

export const DANA_PENSIUN = goalSummary({
  id: 'goal-pensiun',
  name: 'Dana Pensiun',
  icon: 'sunset',
  color: 'violet',
  targetMinor: 500_000_000n,
  tag: 'dana-pensiun',
  sortOrder: 2,
  nextMonth: ym('2026-10'),
});

const sisihkan = (id: string, amountMinor: bigint) =>
  plan({ id: `plan-${id}`, recurrenceId: 'rec-sisihkan', amountMinor, monthDay: 25 });

export const LIBURAN_BALI = goalSummary({
  id: 'goal-liburan',
  name: 'Liburan Bali',
  icon: 'tree-palm',
  color: 'cyan',
  kind: 'sinking',
  targetMinor: 8_000_000n,
  deadlineMonth: ym('2027-03'),
  tag: 'liburan-bali',
  sortOrder: 3,
  nextMonth: ym('2026-10'),
  sources: [source({ id: 'src-liburan', amountMinor: 2_800_000n, valueMinor: 2_800_000n })],
  plans: [sisihkan('liburan', 867_000n)],
});

export const SERVIS_MOTOR = goalSummary({
  id: 'goal-servis',
  name: 'Servis motor',
  icon: 'wrench',
  color: 'amber',
  kind: 'sinking',
  targetMinor: 1_200_000n,
  deadlineMonth: ym('2026-12'),
  tag: 'servis-motor',
  sortOrder: 4,
  nextMonth: ym('2026-10'),
  sources: [source({ id: 'src-servis', amountMinor: 720_000n, valueMinor: 720_000n })],
  plans: [sisihkan('servis', 240_000n)],
});

export const PERPANJANG_STNK = goalSummary({
  id: 'goal-stnk',
  name: 'Perpanjang STNK',
  icon: 'file-text',
  color: 'orange',
  kind: 'sinking',
  targetMinor: 850_000n,
  deadlineMonth: ym('2027-02'),
  tag: 'perpanjang-stnk',
  sortOrder: 5,
  nextMonth: ym('2026-10'),
  sources: [source({ id: 'src-stnk', amountMinor: 680_000n, valueMinor: 680_000n })],
  plans: [sisihkan('stnk', 43_000n)],
});

export const SEED_GOALS: readonly GoalSummary[] = [
  DANA_DARURAT,
  DP_RUMAH,
  DANA_PENSIUN,
  LIBURAN_BALI,
  SERVIS_MOTOR,
  PERPANJANG_STNK,
];

export function movement(overrides: Partial<GoalMovement> & Pick<GoalMovement, 'key'>): GoalMovement {
  const shares = overrides.shares ?? [];
  return {
    date: d('2026-10-01'),
    kind: 'plan',
    name: null,
    amountMinor: shares.reduce((sum, share) => sum + share.amountMinor, 0n),
    fromAccountId: BCA.id,
    toAccountId: JAGO.id,
    status: 'recorded',
    transactionId: null,
    ...overrides,
    shares,
  };
}

/** October's contributions: Rp3.500.000 recorded, the 25th's Rp1.150.000 still scheduled. */
export const OCTOBER_MOVEMENTS: readonly GoalMovement[] = [
  movement({
    key: 'rec-kantong:2026-10-01',
    name: 'Kantong darurat',
    shares: [{ goalId: DANA_DARURAT.id, amountMinor: 500_000n }],
    transactionId: 'tx-kantong',
  }),
  movement({
    key: 'rec-bibit:2026-10-14',
    date: d('2026-10-14'),
    name: 'Setor dana darurat · Bibit RDPU',
    shares: [{ goalId: DANA_DARURAT.id, amountMinor: 3_000_000n }],
    toAccountId: 'acc-bibit',
    transactionId: 'tx-bibit',
  }),
  movement({
    key: 'rec-sisihkan:2026-10-25',
    date: d('2026-10-25'),
    name: 'Sisihkan dana tidak rutin',
    shares: [
      { goalId: LIBURAN_BALI.id, amountMinor: 867_000n },
      { goalId: SERVIS_MOTOR.id, amountMinor: 240_000n },
      { goalId: PERPANJANG_STNK.id, amountMinor: 43_000n },
    ],
    status: 'scheduled',
  }),
];

/** "Sisihkan dana tidak rutin": BCA Tahapan → Bank Jago on the 25th, Rp1.150.000 over the three sinking funds. */
export const SET_ASIDE: SetAsideTransfer = {
  recurrenceId: 'rec-sisihkan',
  name: 'Sisihkan dana tidak rutin',
  monthDay: 25,
  fromAccountId: BCA.id,
  toAccountId: JAGO.id,
  amountMinor: 1_150_000n,
  goalIds: [LIBURAN_BALI.id, SERVIS_MOTOR.id, PERPANJANG_STNK.id],
};

export function goalsOverview(overrides: Partial<GoalsOverview> = {}): GoalsOverview {
  return {
    today: d('2026-10-15'),
    month: ym('2026-10'),
    baseCurrency: 'IDR',
    goals: [...SEED_GOALS],
    movements: [...OCTOBER_MOVEMENTS],
    averageSpendingMinor: 18_000_000n,
    payday: 25,
    setAside: SET_ASIDE,
    ...overrides,
  };
}
