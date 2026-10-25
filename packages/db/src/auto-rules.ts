// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auto rules (M7.1, FR-AI1): user-owned ordered rules with CRUD, correction-based suggestions, the editor's trial and
 * preview, and the "Terapkan ke transaksi lama" backfill. Rules and their evidence are the only rows this module
 * writes on their own; applying a backfill still only changes a transaction's category and tags, after the user
 * selected it (D14), through the same guards (open periods, managed rows, ownership) as the ledger's edit path.
 *
 * Nothing here records money in logs: proposals carry categories, tags, dates, and descriptions only.
 */
import type { AutoRuleDefinition, AutoRuleView, RuleAction, RuleCondition, RuleSubject } from '@wf/domain/rules';
import {
  checkRuleDefinition,
  correctionPattern,
  evaluateRules,
  InvalidRuleError,
  MIN_RULE_SUGGESTION_CORRECTIONS,
  minuteOfDayIn,
  parseTimeOfDay,
  ruleSuggestionKey,
  type RuleConditionReason,
  type RuleDirection,
  type RuleMatch,
  type RulesEvaluation,
} from '@wf/domain/rules';
import type { LocalDate } from '@wf/domain/period';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { logActivity } from './activity.ts';
import {
  assertOpenDatesIn,
  assertUnmanagedTransactionsIn,
  checkCategoryIn,
  localDateOf as localDateOfInstant,
  resolveTagsIn,
  setTransactionTagsIn,
  userContextIn,
} from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import {
  accountIdsIn,
  catalogIn,
  closedPeriodsIn,
  managedTransactionIdsIn,
  proposalOf,
  ruleScopeIn,
  subjectDescription,
  subscriptionIdsIn,
  tagsIn,
  timezoneIn,
  type BackfillContext,
  type RuleBackfillResult,
  type RuleBackfillSelection,
  type RuleBackfillSkipped,
} from './rule-backfill.ts';

import {
  autoRuleCorrections,
  autoRules,
  autoRuleSuggestionDismissals,
  categories,
  periods,
  transactions,
} from './schema.ts';

/** Most transactions a backfill preview evaluates (newest first); older rows are reported as truncated. */
export const BACKFILL_SCAN_LIMIT = 2000;
/** Most changes one confirmation applies. */
export const BACKFILL_APPLY_LIMIT = 500;
/** Rows the editor's current-period preview samples. */
export const PREVIEW_SAMPLE_LIMIT = 10;

/** A suggestion from repeated manual corrections: four distinct transactions changed from one category to another. */
export interface RuleSuggestion {
  /** `ruleSuggestionKey`; opaque to the UI, stable across reloads. */
  readonly key: string;
  /** Normalized pattern (`kopi kenangan`). */
  readonly pattern: string;
  /** What to quote (`Kopi Kenangan`). */
  readonly label: string;
  readonly fromCategoryId: string;
  readonly toCategoryId: string;
  /** Distinct corrected transactions (never the number of edits of one row). */
  readonly count: number;
  readonly lastCorrectedAt: Date;
}

export interface NewAutoRule {
  readonly input: AutoRuleDefinition;
  /** From a correction suggestion: dismissed in the same transaction, so it does not come back. */
  readonly suggestionKey?: string;
}

/** The editor's trial evaluation and the current period's matching rows (no amounts: previews stay privacy-safe). */
export interface AutoRulePreview {
  readonly trial: RulesEvaluation;
  readonly period: {
    readonly label: string | null;
    readonly total: number;
    readonly matched: number;
    readonly samples: readonly AutoRulePreviewSample[];
    /** The month has more transactions than the preview scanned. */
    readonly truncated: boolean;
  };
}

/** One matching transaction in the editor's current-period preview (no amounts). */
export interface AutoRulePreviewSample {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly description: string | null;
  readonly currentCategoryId: string | null;
  /** Whether the draft rule matches this real transaction. */
  readonly matched: boolean;
  /** Every condition's reason for this sample, so a non-match explains itself (`bukan gojek`, `hari Minggu`). */
  readonly reasons: readonly RuleConditionReason[];
}

export interface RuleTrial {
  readonly description: string | null;
  readonly date: LocalDate;
  /** `HH:mm`, or `null` for a date-only source. */
  readonly time: string | null;
  readonly accountId: string | null;
  readonly direction: RuleDirection;
  readonly subscription: boolean;
}

export interface AutoRulesRepository {
  list: (userId: string, options?: { readonly enabledOnly?: boolean }) => Promise<AutoRuleView[]>;
  /** @throws {LedgerError} `INVALID_RULE` */
  create: (userId: string, input: NewAutoRule) => Promise<AutoRuleView>;
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_RULE` */
  update: (userId: string, id: string, input: AutoRuleDefinition) => Promise<AutoRuleView>;
  /** @throws {LedgerError} `NOT_FOUND` */
  remove: (userId: string, id: string) => Promise<void>;
  /** @throws {LedgerError} `NOT_FOUND` */
  setEnabled: (userId: string, id: string, enabled: boolean) => Promise<AutoRuleView>;
  /** The full order, every rule exactly once. @throws {LedgerError} `INVALID_RULE` */
  reorder: (userId: string, ids: readonly string[]) => Promise<void>;
  /** Correction patterns at the threshold, minus durable dismissals and rules already saved for them. */
  suggestions: (userId: string) => Promise<RuleSuggestion[]>;
  /** @throws {LedgerError} `NOT_FOUND` when the key is not a current suggestion */
  dismissSuggestion: (userId: string, key: string) => Promise<void>;
  /** The editor's trial reasons and the current period's matches for an unsaved definition. @throws {LedgerError} */
  preview: (userId: string, definition: AutoRuleDefinition, trial: RuleTrial) => Promise<AutoRulePreview>;
  /**
   * Applies selected proposals after confirmation, pinned to the previewed rule version and transaction versions.
   * A changed rule set, a changed row, or a transfer/forged selection is skipped, never overwritten.
   */
  applyBackfill: (
    userId: string,
    input: {
      readonly ruleIds?: readonly string[];
      readonly version: string;
      readonly items: readonly RuleBackfillSelection[];
    },
  ) => Promise<RuleBackfillResult>;
}

/** Keeps `InvalidRuleError` from the domain inside the app's expected codes. */
function checked(definition: AutoRuleDefinition): AutoRuleDefinition {
  try {
    return checkRuleDefinition(definition);
  } catch (error) {
    if (error instanceof InvalidRuleError) throw new LedgerError('INVALID_RULE', error.message);
    throw error;
  }
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
}

function toView(row: RuleRow): AutoRuleView {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    position: row.position,
    conditions: row.conditions,
    actions: row.actions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A live category the rule may target; the direction fit is checked when a subject is evaluated. */
async function assertLiveCategoryIn(tx: Transaction, categoryId: string): Promise<void> {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)));
  if (row === undefined) throw new LedgerError('INVALID_RULE', 'The rule’s category does not exist');
}

/** Rejects tags the actions cannot name and validates every category action. */
async function checkActionsIn(tx: Transaction, actions: readonly RuleAction[]): Promise<void> {
  for (const action of actions) {
    if (action.type === 'setCategory') await assertLiveCategoryIn(tx, action.categoryId);
  }
}

/** The live suggestions of the user in the current transaction (also used by the dismissal check). */
async function suggestionsIn(tx: Transaction): Promise<RuleSuggestion[]> {
  const rows = await tx
    .select({
      pattern: autoRuleCorrections.pattern,
      label: sql<string>`max(${autoRuleCorrections.label})`,
      fromCategoryId: autoRuleCorrections.fromCategoryId,
      toCategoryId: autoRuleCorrections.toCategoryId,
      count: sql<number>`count(distinct ${autoRuleCorrections.transactionId})::int`.mapWith(Number),
      lastCorrectedAt: sql<Date>`max(${autoRuleCorrections.recordedAt})`,
    })
    .from(autoRuleCorrections)
    .groupBy(autoRuleCorrections.pattern, autoRuleCorrections.fromCategoryId, autoRuleCorrections.toCategoryId)
    .having(sql`count(distinct ${autoRuleCorrections.transactionId}) >= ${MIN_RULE_SUGGESTION_CORRECTIONS}`)
    .orderBy(desc(sql`max(${autoRuleCorrections.recordedAt})`));
  if (rows.length === 0) return [];
  const [dismissals, rules] = await Promise.all([
    tx.select({ key: autoRuleSuggestionDismissals.key }).from(autoRuleSuggestionDismissals),
    tx.select({ conditions: autoRules.conditions, actions: autoRules.actions }).from(autoRules),
  ]);
  const dismissed = new Set(dismissals.map((row) => row.key));
  const saved = (pattern: string, toCategoryId: string): boolean =>
    rules.some(
      (rule) =>
        rule.actions.some((action) => action.type === 'setCategory' && action.categoryId === toCategoryId) &&
        rule.conditions.some(
          (condition) =>
            condition.field === 'description' &&
            condition.values.some(
              (value) => pattern.includes(value.toLowerCase()) || value.toLowerCase().includes(pattern),
            ),
        ),
    );
  return rows
    .map((row) => ({
      key: ruleSuggestionKey(row.pattern, row.fromCategoryId, row.toCategoryId),
      pattern: row.pattern,
      label: row.label,
      fromCategoryId: row.fromCategoryId,
      toCategoryId: row.toCategoryId,
      count: row.count,
      lastCorrectedAt: row.lastCorrectedAt,
    }))
    .filter((suggestion) => !dismissed.has(suggestion.key) && !saved(suggestion.pattern, suggestion.toCategoryId));
}

export function createAutoRules(db: Database, options: { readonly now?: () => Date } = {}): AutoRulesRepository {
  const now = options.now ?? (() => new Date());

  return {
    list: (userId, { enabledOnly = false } = {}) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(autoRules)
          .where(enabledOnly ? eq(autoRules.enabled, true) : undefined)
          .orderBy(asc(autoRules.position), asc(autoRules.id));
        return rows.map(toView);
      }),

    create: (userId, { input, suggestionKey }) =>
      withUser(db, userId, async (tx) => {
        const definition = checked(input);
        await checkActionsIn(tx, definition.actions);
        const position = firstRow(
          await tx
            .select({ next: sql<number>`coalesce(max(${autoRules.position}) + 1, 0)::int`.mapWith(Number) })
            .from(autoRules),
          'auto_rules',
        ).next;
        const rows = await tx
          .insert(autoRules)
          .values({ userId, ...definition, position })
          .returning();
        if (suggestionKey !== undefined) {
          await tx.insert(autoRuleSuggestionDismissals).values({ userId, key: suggestionKey }).onConflictDoNothing();
        }
        return toView(firstRow(rows, 'auto_rules'));
      }),

    update: (userId, id, input) =>
      withUser(db, userId, async (tx) => {
        const definition = checked(input);
        await checkActionsIn(tx, definition.actions);
        const rows = await tx
          .update(autoRules)
          .set({ ...definition, updatedAt: now() })
          .where(eq(autoRules.id, id))
          .returning();
        if (rows.length === 0) throw new LedgerError('NOT_FOUND', 'No such rule');
        return toView(rows[0] as RuleRow);
      }),

    remove: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx.delete(autoRules).where(eq(autoRules.id, id)).returning({ id: autoRules.id });
        if (rows.length === 0) throw new LedgerError('NOT_FOUND', 'No such rule');
      }),

    setEnabled: (userId, id, enabled) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .update(autoRules)
          .set({ enabled, updatedAt: now() })
          .where(eq(autoRules.id, id))
          .returning();
        if (rows.length === 0) throw new LedgerError('NOT_FOUND', 'No such rule');
        return toView(rows[0] as RuleRow);
      }),

    reorder: (userId, ids) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx.select({ id: autoRules.id }).from(autoRules);
        const known = new Set(rows.map((row) => row.id));
        if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
          throw new LedgerError('INVALID_RULE', 'Reorder every rule exactly once');
        }
        for (const [position, id] of ids.entries()) {
          await tx.update(autoRules).set({ position }).where(eq(autoRules.id, id));
        }
      }),

    suggestions: (userId) => withUser(db, userId, (tx) => suggestionsIn(tx)),

    dismissSuggestion: (userId, key) =>
      withUser(db, userId, async (tx) => {
        const live = await suggestionsIn(tx);
        if (!live.some((suggestion) => suggestion.key === key)) {
          throw new LedgerError('NOT_FOUND', 'No such suggestion');
        }
        await tx.insert(autoRuleSuggestionDismissals).values({ userId, key }).onConflictDoNothing();
      }),

    preview: (userId, definition, trial) =>
      withUser(db, userId, async (tx) => {
        const checkedDefinition = checked(definition);
        const rule: AutoRuleView = {
          id: 'draft',
          ...checkedDefinition,
          // The trial explains the conditions even while the rule is switched off; the editor says so separately.
          enabled: true,
          position: 0,
          createdAt: now(),
          updatedAt: now(),
        };
        const trialSubject: RuleSubject = {
          description: trial.description,
          date: trial.date,
          minuteOfDay: trial.time === null ? null : parseTimeOfDay(trial.time),
          accountIds: trial.accountId === null ? [] : [trial.accountId],
          direction: trial.direction,
          subscription: trial.subscription,
        };
        const { timezone } = await userContextIn(tx, userId);
        const today = localDateOfInstant(now(), timezone);
        const [period] = await tx
          .select({ label: periods.label, start: periods.startDate, end: periods.endDate })
          .from(periods)
          .where(and(lte(periods.startDate, today), gte(periods.endDate, today)))
          .limit(1);
        let total: number;
        let matched = 0;
        const samples: AutoRulePreviewSample[] = [];
        if (period !== undefined) {
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
            })
            .from(transactions)
            .where(
              and(
                isNull(transactions.deletedAt),
                inArray(transactions.type, ['expense', 'income']),
                gte(transactions.localDate, period.start),
                lte(transactions.localDate, period.end),
              ),
            )
            .orderBy(desc(transactions.occurredAt))
            .limit(BACKFILL_SCAN_LIMIT + 1);
          const truncated = rows.length > BACKFILL_SCAN_LIMIT;
          const scanned = rows.slice(0, BACKFILL_SCAN_LIMIT);
          total = scanned.length;
          const [accountsByTransaction, subscriptions] = await Promise.all([
            accountIdsIn(
              tx,
              scanned.map((row) => row.id),
            ),
            subscriptionIdsIn(
              tx,
              scanned.map((row) => row.id),
            ),
          ]);
          for (const row of scanned) {
            const result = evaluateRules([rule], {
              description: subjectDescription(row.description, row.merchant),
              date: row.localDate,
              // An imported statement row's 09:00 is synthetic; a time condition cannot use it.
              minuteOfDay: row.source === 'import' ? null : minuteOfDayIn(row.occurredAt, timezone),
              accountIds: accountsByTransaction.get(row.id) ?? [],
              direction: row.type === 'income' ? 'income' : 'expense',
              subscription: subscriptions.has(row.id),
            });
            // One condition set and one draft rule: the evaluator always reports this rule.
            const match = result.rules[0] as RuleMatch;
            if (match.matched) matched += 1;
            if (samples.length < PREVIEW_SAMPLE_LIMIT) {
              samples.push({
                id: row.id,
                localDate: row.localDate,
                description: subjectDescription(row.description, row.merchant),
                currentCategoryId: row.categoryId,
                matched: match.matched,
                reasons: match.reasons,
              });
            }
          }
          return {
            trial: evaluateRules([rule], trialSubject),
            period: { label: period.label, total, matched, samples, truncated },
          };
        }
        return {
          trial: evaluateRules([rule], trialSubject),
          period: { label: null, total: 0, matched: 0, samples: [], truncated: false },
        };
      }),

    applyBackfill: (userId, { ruleIds, version, items }) =>
      withUser(db, userId, async (tx) => {
        if (items.length > BACKFILL_APPLY_LIMIT) {
          throw new LedgerError('INVALID_RULE', `Select at most ${BACKFILL_APPLY_LIMIT} transactions`);
        }
        const scope = await ruleScopeIn(tx, ruleIds);
        if (scope.version !== version) {
          return {
            applied: [],
            skipped: items.map((item) => ({ transactionId: item.transactionId, reason: 'stale' as const })),
            rulesChanged: true,
          };
        }
        const timezone = await timezoneIn(tx, userId);
        const applied: string[] = [];
        const skipped: RuleBackfillSkipped[] = [];
        for (const item of items) {
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
            .where(and(eq(transactions.id, item.transactionId), isNull(transactions.deletedAt)))
            .limit(1)
            .for('update');
          const row = rows[0];
          if (row === undefined) {
            skipped.push({ transactionId: item.transactionId, reason: 'not_found' });
            continue;
          }
          // Forged selections of a transfer, investment, adjustment, or a row from another scope never apply.
          if (row.type !== 'expense' && row.type !== 'income') {
            skipped.push({ transactionId: item.transactionId, reason: 'blocked' });
            continue;
          }
          if (row.version !== item.version) {
            skipped.push({ transactionId: item.transactionId, reason: 'stale' });
            continue;
          }
          const currentTags = (await tagsIn(tx, [row.id])).get(row.id) ?? [];
          const context: BackfillContext = {
            rules: scope.rules,
            catalog: await catalogIn(tx),
            closed: await closedPeriodsIn(tx),
            managed: await managedTransactionIdsIn(tx, [row.id]),
            accounts: await accountIdsIn(tx, [row.id]),
            subscriptions: await subscriptionIdsIn(tx, [row.id]),
            timezone,
          };
          const proposal = proposalOf({ ...row, type: row.type }, currentTags, context);
          if (proposal === null || proposal.noop) {
            skipped.push({ transactionId: item.transactionId, reason: 'noop' });
            continue;
          }
          if (proposal.blocked !== null) {
            skipped.push({ transactionId: item.transactionId, reason: 'blocked' });
            continue;
          }
          await assertOpenDatesIn(tx, [row.localDate]);
          await assertUnmanagedTransactionsIn(tx, [row.id]);
          const direction: RuleDirection = row.type;
          if (proposal.proposedCategoryId !== null && proposal.proposedCategoryId !== row.categoryId) {
            await checkCategoryIn(tx, proposal.proposedCategoryId, direction);
          }
          const tagsChanged =
            proposal.proposedTags.length !== currentTags.length ||
            proposal.proposedTags.some((slug) => !currentTags.includes(slug));
          const proposedTagIds = tagsChanged ? await resolveTagsIn(tx, userId, proposal.proposedTags) : [];
          const at = now();
          // The row is locked and its exact version matched above, so this cannot miss; the version predicate stays as
          // defence in depth without adding an unreachable branch.
          await tx
            .update(transactions)
            .set({ categoryId: proposal.proposedCategoryId, updatedAt: at })
            .where(
              and(
                eq(transactions.id, row.id),
                isNull(transactions.deletedAt),
                sql`${transactions.updatedAt}::text = ${item.version}`,
              ),
            );
          if (tagsChanged) await setTransactionTagsIn(tx, userId, row.id, proposedTagIds);
          await logActivity(tx, userId, 'transaction', [row.id], 'updated', {
            fields: tagsChanged ? ['categoryId', 'tags'] : ['categoryId'],
            rule: proposal.ruleId,
          });
          applied.push(row.id);
        }
        return { applied, skipped, rulesChanged: false };
      }),
  };
}

/**
 * Records one manual category correction (called by the ledger's edit path inside its own transaction). Four
 * distinct corrected transactions of a pattern suggest a rule. Rule backfill and seed creation never call this, so
 * automated changes are never learned from. A repeated identical correction on one row is stored once.
 */
export async function recordCategoryCorrectionIn(
  tx: Transaction,
  userId: string,
  input: {
    readonly transactionId: string;
    readonly description: string | null;
    readonly merchant: string | null;
    readonly fromCategoryId: string | null;
    readonly toCategoryId: string | null;
  },
): Promise<void> {
  if (input.fromCategoryId === null || input.toCategoryId === null) return;
  if (input.fromCategoryId === input.toCategoryId) return;
  const pattern = correctionPattern(input.description, input.merchant);
  if (pattern === null) return;
  await tx
    .insert(autoRuleCorrections)
    .values({
      userId,
      transactionId: input.transactionId,
      pattern: pattern.pattern,
      label: pattern.label,
      fromCategoryId: input.fromCategoryId,
      toCategoryId: input.toCategoryId,
    })
    .onConflictDoNothing();
}
