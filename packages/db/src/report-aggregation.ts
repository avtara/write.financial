// SPDX-License-Identifier: AGPL-3.0-only
/** D10: aggregate immutable monthly snapshots and disjoint live boundary segments, never re-query their closed flows. */
import { divideFloor } from '@wf/domain/decimal';
import { busiestWeek, combineMonths, dailyAverageMinor, topShareBps } from '@wf/domain/report';
import type { DateRange } from '@wf/domain/dashboard';
import type {
  ReportAccountLine,
  ReportCategoryLine,
  ReportIncomeLine,
  ReportMerchantLine,
  ReportSections,
  ReportTagLine,
  ReportView,
} from './reports.ts';

export type ReportSegment = Pick<ReportView, 'range' | 'totals' | 'sections'>;

/** Segments are non-empty, ordered oldest first, non-overlapping, and cover `range`. */
export function aggregateReports(segments: readonly ReportSegment[], range: DateRange): ReportSegment {
  const totals = combineMonths(segments);
  const last = segments.at(-1);
  if (totals === null || last === undefined) throw new RangeError('A report needs at least one segment');
  const categories = new Map<string | null, ReportCategoryLine>();
  const income = new Map<string | null, ReportIncomeLine>();
  const merchants = new Map<string, ReportMerchantLine>();
  const tags = new Map<string, ReportTagLine>();
  const accounts = new Map<string, ReportAccountLine>();
  const days: ReportSections['days'][number][] = [];
  const largest: ReportSections['largest'][number][] = [];
  const share = (amount: bigint) =>
    totals.expenseMinor > 0n ? Number(divideFloor(amount * 10_000n, totals.expenseMinor)) : 0;

  for (const { sections } of segments) {
    for (const row of sections.incomeSources) {
      const totalMinor = (income.get(row.categoryId)?.totalMinor ?? 0n) + row.totalMinor;
      income.set(row.categoryId, {
        ...row,
        totalMinor,
        shareBps: totals.incomeMinor > 0n ? Number(divideFloor(totalMinor * 10_000n, totals.incomeMinor)) : 0,
      });
    }
    for (const row of sections.categories) {
      const previous = categories.get(row.categoryId);
      const spentMinor = (previous?.spentMinor ?? 0n) + row.spentMinor;
      const limitMinor =
        previous === undefined
          ? row.limitMinor
          : previous.limitMinor === null || row.limitMinor === null
            ? null
            : previous.limitMinor + row.limitMinor;
      categories.set(row.categoryId, {
        ...row,
        spentMinor,
        limitMinor,
        shareBps: share(spentMinor),
        usedBps:
          limitMinor === null || limitMinor === 0n ? null : Number(divideFloor(spentMinor * 10_000n, limitMinor)),
        overMinor: limitMinor !== null && spentMinor > limitMinor ? spentMinor - limitMinor : 0n,
      });
    }
    for (const row of sections.merchants) {
      const previous = merchants.get(row.merchant);
      const totalMinor = (previous?.totalMinor ?? 0n) + row.totalMinor;
      merchants.set(row.merchant, {
        ...row,
        totalMinor,
        count: (previous?.count ?? 0) + row.count,
        shareBps: share(totalMinor),
      });
    }
    for (const row of sections.tags) {
      const previous = tags.get(row.tagId);
      tags.set(row.tagId, {
        ...row,
        totalMinor: (previous?.totalMinor ?? 0n) + row.totalMinor,
        count: (previous?.count ?? 0) + row.count,
      });
    }
    for (const row of sections.accounts) {
      const previous = accounts.get(row.accountId);
      accounts.set(row.accountId, {
        ...row,
        inMinor: (previous?.inMinor ?? 0n) + row.inMinor,
        outMinor: (previous?.outMinor ?? 0n) + row.outMinor,
      });
    }
    days.push(...sections.days);
    for (const row of sections.largest) largest.push({ ...row, shareBps: share(row.amountMinor) });
  }
  largest.sort((a, b) =>
    a.amountMinor > b.amountMinor
      ? -1
      : a.amountMinor < b.amountMinor
        ? 1
        : a.transactionId.localeCompare(b.transactionId),
  );
  largest.length = Math.min(largest.length, 6);
  const sections: ReportSections = {
    categories: [...categories.values()].sort((a, b) =>
      a.spentMinor > b.spentMinor
        ? -1
        : a.spentMinor < b.spentMinor
          ? 1
          : (a.categoryId ?? '').localeCompare(b.categoryId ?? ''),
    ),
    incomeSources: [...income.values()].sort((a, b) =>
      a.totalMinor > b.totalMinor
        ? -1
        : a.totalMinor < b.totalMinor
          ? 1
          : (a.categoryId ?? '').localeCompare(b.categoryId ?? ''),
    ),
    merchants: [...merchants.values()].sort((a, b) =>
      a.totalMinor > b.totalMinor ? -1 : a.totalMinor < b.totalMinor ? 1 : a.merchant.localeCompare(b.merchant),
    ),
    tags: [...tags.values()].sort((a, b) =>
      a.totalMinor > b.totalMinor ? -1 : a.totalMinor < b.totalMinor ? 1 : a.tagId.localeCompare(b.tagId),
    ),
    accounts: [...accounts.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId),
    ),
    goals: last.sections.goals,
    subscriptions: {
      ...last.sections.subscriptions,
      shareBps:
        totals.expenseMinor > 0n && last.sections.subscriptions.unconverted === 0
          ? share(last.sections.subscriptions.monthlyMinor)
          : null,
    },
    largest,
    largestShareBps: topShareBps(largest, 6, totals.expenseMinor),
    days,
    averageDailyMinor: dailyAverageMinor(totals.expenseMinor, range),
    busiestWeek: busiestWeek(days, range),
    netWorth: last.sections.netWorth,
    netWorthHistory: last.sections.netWorthHistory,
  };
  return { range, totals, sections };
}
