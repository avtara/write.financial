// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only rule backfill proposals (FR-AI1): shared by the web preview/confirmation and the worker's
 * `rules-backfill` job. Nothing here writes a transaction, posting, budget, or goal — the worker only builds the
 * proposal list, and the web applies selected rows after an explicit confirmation.
 *
 * Two opaque tokens make a confirmation exact:
 * - the ordered rule set's version (sha256 of the effective rules in scope), so a rule edited, reordered, enabled, or
 *   disabled between preview and confirm cannot produce an output the user never saw;
 * - each proposal's snapshot token: the stored `updated_at::text` (PostgreSQL microseconds included) plus the approved
 *   current/proposed category and tags and the evaluation inputs (description, local date/time, account links,
 *   subscription, timezone). A timestamp alone is not a revision: two genuine edits can share one millisecond, so the
 *   confirmation is skipped whenever the re-evaluated snapshot differs at all.
 */
import { createHash } from 'node:crypto';
import type { AutoRuleView, RuleAction, RuleCondition, RulesEvaluation } from '@wf/domain/rules';
import { categoryFitsDirection, evaluateRules, minuteOfDayIn } from '@wf/domain/rules';
import type { CategoryKind } from '@wf/domain/categories';
import type { LocalDate } from '@wf/domain/period';
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import {
  autoRules,
  cardPaymentAllocations,
  categories,
  debtInstallments,
  debts,
  investmentTrades,
  periods,
  postings,
  scheduledOccurrences,
  tags,
  transactionTags,
  transactions,
  users,
} from './schema.ts';

/** Most transactions a backfill preview evaluates (newest first); older rows are reported as truncated. */
export const BACKFILL_SCAN_LIMIT = 2000;

/** Why a proposed change cannot be applied; a no-op is not blocked. */
export type RuleBackfillBlock = 'closed_period' | 'category_unavailable' | 'tag_limit' | 'managed';

/** What the backfill dialog's tiles count: matching rows, changeable ones, actual no-ops, and blocked ones. */
export interface RuleBackfillTotals {
  readonly matched: number;
  readonly changes: number;
  readonly noops: number;
  readonly blocked: number;
}

export interface RuleBackfillProposal {
  readonly transactionId: string;
  readonly localDate: LocalDate;
  readonly description: string | null;
  readonly currentCategoryId: string | null;
  readonly proposedCategoryId: string | null;
  readonly currentTags: readonly string[];
  readonly proposedTags: readonly string[];
  readonly ruleId: string;
  readonly ruleName: string;
  readonly noop: boolean;
  readonly blocked: RuleBackfillBlock | null;
  /** Opaque sha256 of the row version, approved category/tags, and the evaluation inputs this proposal used. */
  readonly version: string;
}

export interface RuleBackfillPreview {
  readonly proposals: readonly RuleBackfillProposal[];
  readonly totals: RuleBackfillTotals;
  /** The enabled rules the preview evaluated, in order (the confirmation keeps exactly this scope). */
  readonly ruleIds: readonly string[];
  /** sha256 of the effective ordered rule definitions. */
  readonly version: string;
  /** More matching transactions existed than {@link BACKFILL_SCAN_LIMIT}. */
  readonly truncated: boolean;
}

export interface RuleBackfillSkipped {
  readonly transactionId: string;
  readonly reason: 'stale' | 'noop' | 'blocked' | 'not_found';
}

export interface RuleBackfillResult {
  readonly applied: readonly string[];
  readonly skipped: readonly RuleBackfillSkipped[];
  /** The rules changed between the preview and the confirmation: every selection was skipped. */
  readonly rulesChanged: boolean;
}

/** One selected proposal, pinned to the opaque snapshot token the preview showed. */
export interface RuleBackfillSelection {
  readonly transactionId: string;
  readonly version: string;
}

/** The live category catalog a suggestion must fit. */
export interface RuleCatalog {
  readonly categories: readonly {
    readonly id: string;
    readonly kind: CategoryKind;
    readonly archived: boolean;
  }[];
  readonly byId: Map<string, { readonly id: string; readonly kind: CategoryKind; readonly archived: boolean }>;
}

export interface BackfillTransaction {
  readonly id: string;
  readonly type: 'expense' | 'income';
  readonly occurredAt: Date;
  readonly localDate: LocalDate;
  readonly description: string | null;
  readonly merchant: string | null;
  readonly source: string;
  readonly categoryId: string | null;
  readonly version: string;
}

export interface BackfillContext {
  readonly rules: readonly AutoRuleView[];
  readonly catalog: RuleCatalog;
  readonly closed: readonly { start: LocalDate; end: LocalDate }[];
  readonly managed: ReadonlySet<string>;
  readonly accounts: ReadonlyMap<string, readonly string[]>;
  readonly subscriptions: ReadonlySet<string>;
  readonly timezone: string;
}

interface RuleRow {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly position: number;
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly RuleAction[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: string;
}

/** The live catalog, loaded once per operation. */
export async function catalogIn(tx: Transaction): Promise<RuleCatalog> {
  const rows = await tx
    .select({ id: categories.id, kind: categories.kind, archivedAt: categories.archivedAt })
    .from(categories)
    .where(isNull(categories.deletedAt));
  const entries = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    archived: row.archivedAt !== null,
  }));
  return { categories: entries, byId: new Map(entries.map((entry) => [entry.id, entry])) };
}

/** The transaction's tags, keyed by transaction id. */
export async function tagsIn(tx: Transaction, ids: readonly string[]): Promise<Map<string, string[]>> {
  const byId = new Map<string, string[]>();
  if (ids.length === 0) return byId;
  const rows = await tx
    .select({ transactionId: transactionTags.transactionId, slug: tags.slug })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(inArray(transactionTags.transactionId, [...ids]))
    .orderBy(asc(tags.slug));
  for (const row of rows) {
    const current = byId.get(row.transactionId);
    if (current === undefined) byId.set(row.transactionId, [row.slug]);
    else current.push(row.slug);
  }
  return byId;
}

/** The accounts of each transaction's postings (a transfer has both sides), keyed by transaction id. */
export async function accountIdsIn(tx: Transaction, ids: readonly string[]): Promise<Map<string, string[]>> {
  const byId = new Map<string, string[]>();
  if (ids.length === 0) return byId;
  const rows = await tx
    .select({ transactionId: postings.transactionId, accountId: postings.accountId })
    .from(postings)
    .where(inArray(postings.transactionId, [...ids]))
    .orderBy(asc(postings.accountId));
  for (const row of rows) {
    const current = byId.get(row.transactionId);
    if (current === undefined) byId.set(row.transactionId, [row.accountId]);
    else if (!current.includes(row.accountId)) current.push(row.accountId);
  }
  return byId;
}

/** The transactions that are the confirmed occurrence of one of the user's registered subscriptions. */
export async function subscriptionIdsIn(tx: Transaction, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ transactionId: scheduledOccurrences.transactionId })
    .from(scheduledOccurrences)
    .where(
      and(
        inArray(scheduledOccurrences.transactionId, [...ids]),
        eq(scheduledOccurrences.sourceType, 'subscription'),
        isNotNull(scheduledOccurrences.transactionId),
      ),
    );
  // The query filters non-null transaction ids; PostgreSQL cannot narrow the column type here.
  return new Set(rows.map((row) => row.transactionId as string));
}

/** Closed period intervals, as ISO dates (string comparison is calendar order for `YYYY-MM-DD`). */
export async function closedPeriodsIn(tx: Transaction): Promise<{ start: LocalDate; end: LocalDate }[]> {
  return tx
    .select({ start: periods.startDate, end: periods.endDate })
    .from(periods)
    .where(eq(periods.status, 'closed'));
}

/**
 * The ids among `ids` that another repository manages and whose category or tags may not be edited: a receivable's
 * lending, repayments, and write-off (FR-U7), a debt installment's payment (FR-U2), a card payment's allocation
 * (FR-U4), and an investment trade's cash legs (FR-I2). One read-only query.
 */
export async function managedTransactionIdsIn(tx: Transaction, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        inArray(transactions.id, [...ids]),
        or(
          inArray(transactions.type, ['receivable_out', 'receivable_in', 'writeoff', 'investment', 'dividend']),
          exists(
            tx
              .select({ id: investmentTrades.id })
              .from(investmentTrades)
              .where(
                or(
                  eq(investmentTrades.transactionId, transactions.id),
                  eq(investmentTrades.transferTransactionId, transactions.id),
                ),
              ),
          ),
          exists(
            tx
              .select({ id: debtInstallments.id })
              .from(debtInstallments)
              .where(eq(debtInstallments.transactionId, transactions.id)),
          ),
          exists(tx.select({ id: debts.id }).from(debts).where(eq(debts.sourceTransactionId, transactions.id))),
          exists(
            tx
              .select({ id: cardPaymentAllocations.id })
              .from(cardPaymentAllocations)
              .where(eq(cardPaymentAllocations.transactionId, transactions.id)),
          ),
        ),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/** The user's IANA time zone (one read). */
export async function timezoneIn(tx: Transaction, userId: string): Promise<string> {
  return firstRow(await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)), 'users')
    .timezone;
}

export const inClosedPeriod = (date: LocalDate, closed: readonly { start: LocalDate; end: LocalDate }[]): boolean =>
  closed.some((period) => date >= period.start && date <= period.end);

/** The rule-subject description: both fields, so a merchant and a contextual description can each match. */
export function subjectDescription(description: string | null, merchant: string | null): string | null {
  const text = [description, merchant].filter((part): part is string => part !== null && part.trim() !== '').join(' ');
  return text === '' ? null : text;
}

/** The effective rules in persisted order, with the version the confirmation must match. */
export async function ruleScopeIn(
  tx: Transaction,
  ruleIds?: readonly string[],
): Promise<{ rules: AutoRuleView[]; version: string; ids: string[] }> {
  const scoped = ruleIds === undefined ? undefined : inArray(autoRules.id, [...ruleIds]);
  const rows = await tx
    .select({
      id: autoRules.id,
      name: autoRules.name,
      enabled: autoRules.enabled,
      position: autoRules.position,
      conditions: autoRules.conditions,
      actions: autoRules.actions,
      createdAt: autoRules.createdAt,
      updatedAt: autoRules.updatedAt,
      version: sql<string>`${autoRules.updatedAt}::text`,
    })
    .from(autoRules)
    .where(scoped === undefined ? eq(autoRules.enabled, true) : and(scoped, eq(autoRules.enabled, true)))
    .orderBy(asc(autoRules.position), asc(autoRules.id));
  const rowsWithVersion: RuleRow[] = rows;
  const effective = rowsWithVersion.map((row) => ({
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    position: row.position,
    conditions: row.conditions,
    actions: row.actions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  const version = createHash('sha256')
    .update(
      JSON.stringify(
        rowsWithVersion.map((row) => ({
          id: row.id,
          name: row.name,
          enabled: row.enabled,
          position: row.position,
          conditions: row.conditions,
          actions: row.actions,
          updatedAt: row.version,
        })),
      ),
    )
    .digest('hex');
  return { rules: effective, version, ids: effective.map((rule) => rule.id) };
}

/** The proposal for one transaction, or `null` when no enabled rule matches. Shared by preview and apply. */
export function proposalOf(
  transaction: BackfillTransaction,
  currentTags: readonly string[],
  context: BackfillContext,
): RuleBackfillProposal | null {
  const subject = {
    description: subjectDescription(transaction.description, transaction.merchant),
    date: transaction.localDate,
    // An imported statement row has no time: its stored 09:00 is synthetic and must not prove "before 10:00".
    minuteOfDay: transaction.source === 'import' ? null : minuteOfDayIn(transaction.occurredAt, context.timezone),
    accountIds: context.accounts.get(transaction.id) ?? [],
    direction: transaction.type,
    subscription: context.subscriptions.has(transaction.id),
  };
  const evaluation: RulesEvaluation = evaluateRules(context.rules, subject);
  const firstMatch = evaluation.rules.find((match) => match.matched);
  const matchedRule =
    evaluation.winningRule ?? (firstMatch === undefined ? null : { id: firstMatch.ruleId, name: firstMatch.name });
  if (matchedRule === null) return null;
  // A backfill deliberately changes the category of a past row, so the winning rule's category is the proposal.
  const proposedCategoryId = evaluation.categoryId ?? transaction.categoryId;
  const tagUnion = [...new Set([...currentTags, ...evaluation.tags])];
  const tagsOverflow = tagUnion.length > 5;
  // Rules never drop tags silently: an overflow leaves the current tags and blocks the row instead of truncating.
  const proposedTags = tagsOverflow ? [...currentTags] : tagUnion;
  let blocked: RuleBackfillBlock | null = null;
  if (context.managed.has(transaction.id)) blocked = 'managed';
  else if (inClosedPeriod(transaction.localDate, context.closed)) blocked = 'closed_period';
  else if (evaluation.categoryId !== null) {
    const category = context.catalog.byId.get(evaluation.categoryId);
    if (category === undefined || category.archived || !categoryFitsDirection(category.kind, transaction.type)) {
      blocked = 'category_unavailable';
    }
  }
  if (blocked === null && tagsOverflow) blocked = 'tag_limit';
  const sameCategory = proposedCategoryId === transaction.categoryId;
  const sameTags =
    proposedTags.length === currentTags.length && proposedTags.every((slug) => currentTags.includes(slug));
  const proposal: Omit<RuleBackfillProposal, 'version'> = {
    transactionId: transaction.id,
    localDate: transaction.localDate,
    description: subjectDescription(transaction.description, transaction.merchant),
    currentCategoryId: transaction.categoryId,
    proposedCategoryId,
    currentTags,
    proposedTags,
    ruleId: matchedRule.id,
    ruleName: matchedRule.name,
    noop: blocked === null && sameCategory && sameTags,
    blocked,
  };
  return { ...proposal, version: proposalTokenOf(transaction, currentTags, context, proposal) };
}

/** Every input whose change can alter the approved output or its evaluation, in a stable order. */
function proposalTokenOf(
  transaction: BackfillTransaction,
  currentTags: readonly string[],
  context: BackfillContext,
  proposal: Omit<RuleBackfillProposal, 'version'>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        transactionId: transaction.id,
        storedVersion: transaction.version,
        type: transaction.type,
        localDate: transaction.localDate,
        occurredAt: transaction.occurredAt.toISOString(),
        source: transaction.source,
        description: transaction.description,
        merchant: transaction.merchant,
        timezone: context.timezone,
        accountIds: [...(context.accounts.get(transaction.id) ?? [])].sort(),
        subscription: context.subscriptions.has(transaction.id),
        currentCategoryId: transaction.categoryId,
        currentTags: [...currentTags].sort(),
        proposedCategoryId: proposal.proposedCategoryId,
        proposedTags: [...proposal.proposedTags].sort(),
        ruleId: proposal.ruleId,
        noop: proposal.noop,
        blocked: proposal.blocked,
      }),
    )
    .digest('hex');
}

/** The proposal totals of a list. */
export function totalsOf(proposals: readonly RuleBackfillProposal[]): RuleBackfillTotals {
  return {
    matched: proposals.length,
    changes: proposals.filter((proposal) => proposal.blocked === null && !proposal.noop).length,
    noops: proposals.filter((proposal) => proposal.blocked === null && proposal.noop).length,
    blocked: proposals.filter((proposal) => proposal.blocked !== null).length,
  };
}

/** Every proposal for the user's transactions, newest first; writes nothing. */
export async function previewBackfillIn(
  tx: Transaction,
  userId: string,
  ruleIds?: readonly string[],
): Promise<RuleBackfillPreview> {
  const scope = await ruleScopeIn(tx, ruleIds);
  if (scope.rules.length === 0) {
    return {
      proposals: [],
      totals: { matched: 0, changes: 0, noops: 0, blocked: 0 },
      ruleIds: [],
      version: scope.version,
      truncated: false,
    };
  }
  const rows = await tx
    .select({
      id: transactions.id,
      type: transactions.type,
      occurredAt: transactions.occurredAt,
      localDate: transactions.localDate,
      description: transactions.description,
      merchant: transactions.merchant,
      source: transactions.source,
      categoryId: transactions.categoryId,
      version: sql<string>`${transactions.updatedAt}::text`,
    })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), inArray(transactions.type, ['expense', 'income'])))
    .orderBy(desc(transactions.localDate), desc(transactions.occurredAt))
    .limit(BACKFILL_SCAN_LIMIT + 1);
  const truncated = rows.length > BACKFILL_SCAN_LIMIT;
  const kept = rows.slice(0, BACKFILL_SCAN_LIMIT);
  const ids = kept.map((row) => row.id);
  const [catalog, tagMap, managed, closed, accounts, subscriptions, timezone] = await Promise.all([
    catalogIn(tx),
    tagsIn(tx, ids),
    managedTransactionIdsIn(tx, ids),
    closedPeriodsIn(tx),
    accountIdsIn(tx, ids),
    subscriptionIdsIn(tx, ids),
    timezoneIn(tx, userId),
  ]);
  const backfillContext: BackfillContext = {
    rules: scope.rules,
    catalog,
    closed,
    managed,
    accounts,
    subscriptions,
    timezone,
  };
  const proposals: RuleBackfillProposal[] = [];
  for (const row of kept) {
    const proposal = proposalOf(
      { ...row, source: row.source, type: row.type === 'income' ? 'income' : 'expense' },
      tagMap.get(row.id) ?? [],
      backfillContext,
    );
    if (proposal !== null) proposals.push(proposal);
  }
  return { proposals, totals: totalsOf(proposals), ruleIds: scope.ids, version: scope.version, truncated };
}

export interface RuleBackfillProposalsRepository {
  /** The worker's read-only proposal list; the job result, not a transaction, is the output. */
  preview: (userId: string, ruleIds?: readonly string[]) => Promise<RuleBackfillPreview>;
}

export function createRuleBackfillProposals(db: Database): RuleBackfillProposalsRepository {
  return {
    preview: (userId, ruleIds) => withUser(db, userId, (tx) => previewBackfillIn(tx, userId, ruleIds)),
  };
}
