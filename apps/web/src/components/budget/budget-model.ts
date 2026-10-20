// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers of the budget page (FR-B2): list sorting ("Urutkan"), the tone of a line's bar and badge, and the
 * length of a bar in a 0–1000 SVG coordinate space.
 */
import type { BudgetLineView } from '@wf/db/budgets';
import type { CategoryGroup } from '@wf/domain/categories';

/** "Urutkan": % terpakai, Lewat batas dulu, Sisa terbanyak, Nama A–Z, Urutan sendiri. */
export const BUDGET_SORTS = ['used', 'over_first', 'remaining', 'name', 'custom'] as const;
export type BudgetSort = (typeof BUDGET_SORTS)[number];

/** The tabs of "Anggaran per kategori"; `all` = Semua. */
export type BudgetTab = 'all' | CategoryGroup;

/** The bar and badge colour of a line: red over the limit, amber at its warning threshold or paid, green else. */
export type BudgetTone = 'over' | 'warning' | 'ok' | 'idle';

export function lineTone(line: Pick<BudgetLineView, 'state'>): BudgetTone {
  switch (line.state) {
    case 'over':
      return 'over';
    case 'warning':
    case 'paid':
      return 'warning';
    case 'unused':
      return 'idle';
    case 'ok':
      return 'ok';
  }
}

/** Basis points as a length in the 0–1000 space of a bar's `viewBox` (clamped to the bar). */
export function barLength(bps: number | null): number {
  if (bps === null) return 0;
  return Math.min(Math.max(bps, 0), 10_000) / 10;
}

/** `lines` in the order of `sort`; `name` compares the shown names in `locale`. */
export function sortLines<T extends Pick<BudgetLineView, 'state' | 'usedBps' | 'remainingMinor'>>(
  lines: readonly T[],
  sort: BudgetSort,
  nameOf: (line: T) => string,
  locale: string,
): T[] {
  const byUsed = (a: T, b: T) => (b.usedBps ?? -1) - (a.usedBps ?? -1);
  switch (sort) {
    case 'custom':
      return [...lines];
    case 'used':
      return lines.toSorted(byUsed);
    case 'over_first':
      return lines.toSorted((a, b) => Number(b.state === 'over') - Number(a.state === 'over') || byUsed(a, b));
    case 'remaining':
      return lines.toSorted((a, b) =>
        b.remainingMinor > a.remainingMinor ? 1 : b.remainingMinor < a.remainingMinor ? -1 : 0,
      );
    case 'name':
      return lines.toSorted((a, b) => nameOf(a).localeCompare(nameOf(b), locale));
  }
}
