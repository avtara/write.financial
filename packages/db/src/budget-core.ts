// SPDX-License-Identifier: AGPL-3.0-only
/** The budget version in force for a period label, shared by the period, budget, and dashboard repositories. */
import type { AlertPct } from '@wf/domain/budget';
import type { YearMonth } from '@wf/domain/period';
import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm';
import type { Transaction } from './db.ts';
import { budgetLines, budgetVersions, categories } from './schema.ts';

export interface BudgetLineRow {
  readonly categoryId: string;
  readonly limitMinor: bigint;
  readonly rollover: boolean;
  readonly isFixed: boolean;
  readonly alertPct: AlertPct;
  readonly sortOrder: number;
  readonly updatedAt: Date;
}

export interface VersionInForce {
  readonly id: string;
  readonly effectiveFrom: YearMonth;
  readonly expectedIncomeMinor: bigint | null;
  /** By sort order; lines of deleted categories are left out. */
  readonly lines: BudgetLineRow[];
}

export const LINE = {
  categoryId: budgetLines.categoryId,
  limitMinor: budgetLines.limitMinor,
  rollover: budgetLines.rollover,
  isFixed: budgetLines.isFixed,
  alertPct: budgetLines.alertPct,
  sortOrder: budgetLines.sortOrder,
  updatedAt: budgetLines.updatedAt,
};

/** The lines of version `versionId`. */
export function linesIn(tx: Transaction, versionId: string): Promise<BudgetLineRow[]> {
  return tx
    .select(LINE)
    .from(budgetLines)
    .innerJoin(categories, eq(categories.id, budgetLines.categoryId))
    .where(and(eq(budgetLines.versionId, versionId), isNull(categories.deletedAt)))
    .orderBy(asc(budgetLines.sortOrder), asc(budgetLines.createdAt));
}

/** FR-B1: the latest version effective from `label` or earlier, or `null` before the first one. */
export async function versionInForceIn(tx: Transaction, label: YearMonth): Promise<VersionInForce | null> {
  const [version] = await tx
    .select({
      id: budgetVersions.id,
      effectiveFrom: budgetVersions.effectiveFrom,
      expectedIncomeMinor: budgetVersions.expectedIncomeMinor,
    })
    .from(budgetVersions)
    .where(lte(budgetVersions.effectiveFrom, label))
    .orderBy(desc(budgetVersions.effectiveFrom))
    .limit(1);
  return version === undefined ? null : { ...version, lines: await linesIn(tx, version.id) };
}
