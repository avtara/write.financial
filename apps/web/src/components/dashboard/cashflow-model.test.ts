// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dashboard, weekDashboard, yearDashboard } from '../../../test/dashboard-fixtures.ts';
import {
  averageSpending,
  axisTicks,
  biggestSpending,
  cashflowColumns,
  spendingTrendBps,
  type CashflowColumn,
} from './cashflow-model.ts';

const column = (key: string, expenseMinor: bigint, future = false): CashflowColumn => ({
  key,
  label: key,
  title: key,
  incomeMinor: 0n,
  expenseMinor,
  current: false,
  future,
});

describe('cashflowColumns', () => {
  it('shows the six trend periods of a month, the current one highlighted', () => {
    const columns = cashflowColumns(dashboard(), 'id');
    expect(columns.map((c) => c.label)).toEqual(['Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt']);
    expect(columns.at(-1)).toMatchObject({ title: 'Oktober 2026', current: true, future: false });
    expect(columns.at(-2)).toMatchObject({ incomeMinor: 25_800_000n, expenseMinor: 18_300_000n, current: false });
  });

  it('shows the week’s seven days, the days ahead empty', () => {
    const columns = cashflowColumns(weekDashboard(), 'id');
    expect(columns.map((c) => c.label)).toEqual(['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']);
    expect(columns[2]).toMatchObject({
      title: 'Rabu, 14 Oktober',
      incomeMinor: 6_200_000n,
      expenseMinor: 711_000n,
      current: false,
    });
    expect(columns[3]).toMatchObject({ incomeMinor: 0n, expenseMinor: 0n, current: true, future: false });
    expect(columns[4]).toMatchObject({ future: true });
  });

  it('shows the twelve periods of a year, those after today as placeholders', () => {
    const columns = cashflowColumns(yearDashboard(), 'id');
    expect(columns).toHaveLength(12);
    expect(columns[9]).toMatchObject({ label: 'Okt', current: true });
    expect(columns[10]).toMatchObject({ label: 'Nov', future: true, current: false });
  });
});

describe('figures', () => {
  it('finds the costliest started column', () => {
    expect(biggestSpending([column('a', 5n), column('b', 9n), column('c', 20n, true)])?.key).toBe('b');
    expect(biggestSpending([column('a', 0n)])).toBeNull();
  });

  it('compares the last three started periods with the three before', () => {
    const six = [10n, 10n, 10n, 9n, 9n, 9n].map((value, index) => column(String(index), value));
    expect(spendingTrendBps([...six, column('x', 50n, true)])).toBe(-1000);
    expect(spendingTrendBps(six.slice(1))).toBeNull();
  });

  it('averages the started columns', () => {
    expect(averageSpending([column('a', 10n), column('b', 20n), column('c', 99n, true)])).toBe(15n);
    expect(averageSpending([column('a', 10n, true)])).toBe(0n);
  });

  it('rounds the value axis to three steps', () => {
    expect(axisTicks(26_000_000n)).toEqual([0n, 10_000_000n, 20_000_000n, 30_000_000n]);
    expect(axisTicks(6_200_000n)).toEqual([0n, 2_500_000n, 5_000_000n, 7_500_000n]);
    expect(axisTicks(1_000n)).toEqual([0n, 500n, 1_000n, 1_500n]);
    expect(axisTicks(0n)).toEqual([0n, 1n, 2n, 3n]);
  });
});
