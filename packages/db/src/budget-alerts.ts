// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-B5/FR-ST3 budget threshold notifications (`budget-alerts` job, hourly from 09.00 in the user's time zone): for
 * every line of the current period that reached its warning threshold (`alert_pct`) or its limit (100%), one
 * `budget_threshold` notification per period, category, and threshold (ref `bud.{periodId}.{categoryId}.{pct}`), so
 * an hourly rerun, a retry, or a restart adds nothing. Dismissed warnings (FR-B5) stay quiet for the period. Reads
 * the budget through the same computation as the budget page (`budgetStatusIn`); writes only notifications.
 */
import { withUser, type Database } from './db.ts';
import { budgetStatusIn } from './budgets.ts';
import { insertNotificationIn } from './notifications.ts';
import { ensureIn, periodOnIn, settingsIn, type PeriodView } from './periods.ts';

export interface BudgetAlerts {
  /** Notifies the thresholds reached in the period containing today; returns how many notifications were new. */
  check: (userId: string, now: Date) => Promise<{ readonly created: number }>;
}

/** The limit is the 100% threshold; a line whose warning is at 100% notifies once. */
const LIMIT_PCT = 100;

export function createBudgetAlerts(db: Database): BudgetAlerts {
  return {
    check: (userId, now) =>
      withUser(db, userId, async (tx) => {
        const { startDay, today } = await settingsIn(tx, userId, now);
        await ensureIn(tx, userId, today, startDay);
        const period = (await periodOnIn(tx, today)) as PeriodView;
        const status = await budgetStatusIn(tx, userId, period, now);
        let created = 0;
        for (const line of status.lines) {
          // A fixed cost paid exactly (`paid`, e.g. the rent) is the plan, not an alert.
          if (line.dismissed || line.limitMinor <= 0n || line.state === 'paid') continue;
          for (const pct of new Set([line.alertPct, LIMIT_PCT])) {
            if (line.spentMinor * 100n < line.limitMinor * BigInt(pct)) continue;
            const over = pct === LIMIT_PCT;
            const result = await insertNotificationIn(tx, userId, {
              type: 'budget_threshold',
              category: 'budget_bills',
              titleKey: over ? 'notification_budget_threshold_over_title' : 'notification_budget_threshold_title',
              bodyKey: 'notification_budget_threshold_body',
              params: {
                categoryId: line.categoryId,
                category: line.name,
                pct,
                // A positive limit always has a % used.
                usedPct: Math.floor((line.usedBps as number) / 100),
                spent: { amountMinor: line.spentMinor.toString(), currency: status.baseCurrency },
                limit: { amountMinor: line.limitMinor.toString(), currency: status.baseCurrency },
              },
              action: { href: '/budgets' },
              ref: `bud.${period.id as string}.${line.categoryId}.${pct}`,
            });
            if (result.created) created += 1;
          }
        }
        return { created };
      }),
  };
}
