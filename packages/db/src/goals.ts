// SPDX-License-Identifier: AGPL-3.0-only
/** Savings goals, minimal for onboarding step 4 (FR-A4); M4 adds funding sources and plans. */
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { resolveTagsIn } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { accounts, goals, tags } from './schema.ts';

export interface GoalView {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly targetMinor: bigint;
  readonly currency: string;
  readonly deadlineMonth: YearMonth | null;
  /** Slug of the goal's tag. */
  readonly tag: string | null;
  /** "Simpan di": the account the goal is kept in (onboarding step 4). */
  readonly accountId: string | null;
  readonly sortOrder: number;
  readonly archivedAt: Date | null;
}

export interface GoalInput {
  /** 1–40 characters after trimming. */
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  /** > 0, in `currency`. */
  readonly targetMinor: bigint;
  readonly currency: string;
  /** `YYYY-MM`. */
  readonly deadlineMonth: YearMonth | null;
  /** Tag input (`#Dana Darurat`, `dana-darurat`); created when missing. */
  readonly tag: string | null;
  /** "Simpan di": one of the user's active accounts; default none. */
  readonly accountId?: string | null;
}

export interface GoalsRepository {
  /** Goals by their order, then creation. */
  list: (userId: string) => Promise<GoalView[]>;
  /** @throws {LedgerError} `INVALID_GOAL` (also for an unknown or archived account), `INVALID_TAG` */
  create: (userId: string, input: GoalInput) => Promise<GoalView>;
}

const NAME_MAX = 40;
const CURRENCY = /^[A-Z]{3}$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function viewsIn(tx: Transaction, where?: SQL): Promise<GoalView[]> {
  return tx
    .select({
      id: goals.id,
      name: goals.name,
      icon: goals.icon,
      color: goals.color,
      targetMinor: goals.targetMinor,
      currency: goals.currency,
      deadlineMonth: sql<YearMonth | null>`to_char(${goals.deadlineMonth}, 'YYYY-MM')`,
      tag: tags.slug,
      accountId: goals.accountId,
      sortOrder: goals.sortOrder,
      archivedAt: goals.archivedAt,
    })
    .from(goals)
    .leftJoin(tags, eq(tags.id, goals.tagId))
    .where(where)
    .orderBy(asc(goals.sortOrder), asc(goals.createdAt), asc(goals.id));
}

export function createGoals(db: Database): GoalsRepository {
  return {
    list: (userId) => withUser(db, userId, (tx) => viewsIn(tx)),

    create: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const name = input.name.trim();
        if (name.length === 0 || name.length > NAME_MAX) throw new LedgerError('INVALID_GOAL', 'Invalid goal name');
        if (input.targetMinor <= 0n) throw new LedgerError('INVALID_GOAL', 'The target must be positive');
        if (!CURRENCY.test(input.currency)) throw new LedgerError('INVALID_GOAL', 'Invalid currency code');
        if (input.deadlineMonth !== null && !YEAR_MONTH.test(input.deadlineMonth)) {
          throw new LedgerError('INVALID_GOAL', 'The deadline must be YYYY-MM');
        }
        const accountId = input.accountId ?? null;
        if (accountId !== null) {
          const [account] = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.id, accountId), eq(accounts.status, 'active')));
          if (account === undefined) throw new LedgerError('INVALID_GOAL', 'No such active account');
        }
        const [tagId = null] = input.tag === null ? [] : await resolveTagsIn(tx, userId, [input.tag]);
        const sortOrder = firstRow(
          await tx
            .select({ next: sql<number>`coalesce(max(${goals.sortOrder}) + 1, 0)::int`.mapWith(Number) })
            .from(goals),
          'goals',
        ).next;
        const { id } = firstRow(
          await tx
            .insert(goals)
            .values({
              userId,
              name,
              icon: input.icon,
              color: input.color,
              targetMinor: input.targetMinor,
              currency: input.currency,
              // Stored as the first day of the month (`goals_deadline_check`).
              deadlineMonth: input.deadlineMonth === null ? null : (`${input.deadlineMonth}-01` as LocalDate),
              tagId,
              accountId,
              sortOrder,
            })
            .returning({ id: goals.id }),
          'goals',
        );
        return firstRow(await viewsIn(tx, eq(goals.id, id)), 'goals');
      }),
  };
}
