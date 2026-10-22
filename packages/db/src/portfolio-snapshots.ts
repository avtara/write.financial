// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The daily portfolio snapshot (plan §6 `snapshots`, daily 23.55 in the user's time zone; FR-I3 growth chart): the
 * portfolio's value and cost basis (base currency) as the Investments page computes them, the value per asset class,
 * and the money put into holdings during the month so far (Σ of the month's settled buys minus the cost the month's
 * sales took out). One row per user and local date, replaced when the job runs again that day; the rows of past
 * month-ends are what the monthly chart reads. Nothing is written for a user without investments. Worker (`wf_worker`
 * may read the portfolio and write `portfolio_snapshots` only, D14).
 */
import type { AssetClass } from '@wf/domain/investments';
import type { LocalDate } from '@wf/domain/period';
import { classItems } from '@wf/domain/valuation';
import { and, eq, gte, inArray, lte, sum } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { portfolioIn } from './investments.ts';
import { investmentTrades, portfolioSnapshots } from './schema.ts';

export interface SnapshotView {
  readonly date: LocalDate;
  readonly valueBaseMinor: bigint;
  readonly costBaseMinor: bigint;
  readonly contributionsBaseMinor: bigint;
  readonly breakdown: Partial<Record<AssetClass, string>>;
}

export interface PortfolioSnapshots {
  /** Records the user's snapshot for the local date of `now`; `null` (nothing written) without investments. */
  record: (userId: string, now: Date) => Promise<SnapshotView | null>;
}

export function createPortfolioSnapshots(db: Database): PortfolioSnapshots {
  return {
    record: (userId, now) =>
      withUser(db, userId, async (tx) => {
        const portfolio = await portfolioIn(tx, userId, now);
        if (portfolio.assets.length === 0 && portfolio.platforms.length === 0) return null;
        const { today, summary } = portfolio;
        const flows = await tx
          .select({ total: sum(investmentTrades.costBaseDeltaMinor).mapWith(BigInt) })
          .from(investmentTrades)
          .where(
            and(
              inArray(investmentTrades.kind, ['buy', 'sell']),
              eq(investmentTrades.status, 'settled'),
              gte(investmentTrades.localDate, `${today.slice(0, 8)}01` as LocalDate),
              lte(investmentTrades.localDate, today),
            ),
          );
        const snapshot: SnapshotView = {
          date: today,
          valueBaseMinor: summary.valueBaseMinor,
          costBaseMinor: summary.costBaseMinor,
          contributionsBaseMinor: firstRow(flows, 'sum').total ?? 0n,
          breakdown: Object.fromEntries(
            classItems(summary.positions).map((item) => [item.key, item.valueMinor.toString()]),
          ) as Partial<Record<AssetClass, string>>,
        };
        const { date, ...values } = snapshot;
        await tx
          .insert(portfolioSnapshots)
          .values({ ...values, userId, snapshotDate: date })
          .onConflictDoUpdate({ target: [portfolioSnapshots.userId, portfolioSnapshots.snapshotDate], set: values });
        return snapshot;
      }),
  };
}
