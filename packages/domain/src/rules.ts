// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auto rules (FR-AI1): conditions combined with AND, evaluated in the user's explicit order. The category comes from
 * the topmost matching rule that sets one; tags are the union of every matching rule's tags. Rules only ever produce
 * suggestions: the transaction, its category, and its tags change when the user confirms (D14).
 *
 * Everything here is pure. Callers turn a transaction or a draft into a {@link RuleSubject} in the user's local date
 * and time (never the host's time zone or UTC weekday) and pass the rules already loaded in their persisted order.
 * The evaluator reports per-condition reasons so the editor's trial and the form's suggestion can say why a rule
 * matched or did not (`bukan gojek/krl`, `hari Minggu`).
 */
import type { CategoryKind } from './categories.ts';
import { parseLocalDate, type LocalDate } from './period.ts';
import { normalizeTagSlug } from './tags.ts';
import { MAX_TAGS_PER_TRANSACTION } from './transactions.ts';

/** Maximum length of a rule name. */
export const RULE_NAME_MAX = 60;
/** Most conditions one rule may have (each field at most once). */
export const RULE_CONDITIONS_MAX = 8;
/** Most actions one rule may have (one category, at most five tags). */
export const RULE_ACTIONS_MAX = 8;
/** Most values of a "contains any of" / "one of" condition. */
export const RULE_VALUES_MAX = 10;
/** Maximum length of one description value. */
export const RULE_VALUE_MAX = 40;
/** Summary length of a correction pattern (the design's "Kopi Kenangan"). */
export const CORRECTION_LABEL_MAX = 60;
/** Identical manual category corrections before the Settings section suggests a rule (FR-AI1). */
export const MIN_RULE_SUGGESTION_CORRECTIONS = 4;

/** ISO weekdays: 1 = Monday … 7 = Sunday, independent of any locale's week start. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const RULE_DIRECTIONS = ['income', 'expense'] as const;
export type RuleDirection = (typeof RULE_DIRECTIONS)[number];

/**
 * One condition of a rule. Conditions of different fields are ANDed; the values inside one condition are ORed
 * ("contains any of", "one of").
 */
export type RuleCondition =
  /** The description/merchant contains any of `values` (case-insensitive). */
  | { readonly field: 'description'; readonly op: 'containsAny'; readonly values: readonly string[] }
  /** The user-local weekday is one of `values`. */
  | { readonly field: 'weekday'; readonly op: 'oneOf'; readonly values: readonly Weekday[] }
  /** The user-local time is before `minute` (minutes since midnight; the editor's "sebelum 10.00" is 600). */
  | { readonly field: 'time'; readonly op: 'before'; readonly minute: number }
  /** The transaction touches one of `values` (account ids; a transfer matches either side). */
  | { readonly field: 'account'; readonly op: 'oneOf'; readonly values: readonly string[] }
  /** The transaction is an income or an expense in `values`. */
  | { readonly field: 'direction'; readonly op: 'oneOf'; readonly values: readonly RuleDirection[] }
  /** The transaction is an occurrence of a registered subscription (the review queue's preparation flag). */
  | { readonly field: 'subscription'; readonly op: 'isRegistered' };

export type RuleConditionField = RuleCondition['field'];

/** What a matching rule proposes. */
export type RuleAction =
  | { readonly type: 'setCategory'; readonly categoryId: string }
  /** Adds a tag slug (never replaces the tags the user already typed). */
  | { readonly type: 'addTag'; readonly tag: string };

export type RuleActionType = RuleAction['type'];

/** The user-editable part of a rule; the persisted row adds its id, order, and timestamps. */
export interface AutoRuleDefinition {
  readonly name: string;
  readonly enabled: boolean;
  /** ANDed; each field appears at most once. */
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly RuleAction[];
}

/** A stored rule in the user's persisted order. */
export interface AutoRuleView extends AutoRuleDefinition {
  readonly id: string;
  /** 0-based explicit order; the topmost matching rule wins the category. */
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One transaction (or draft) a rule is evaluated against; dates and minutes are already user-local. */
export interface RuleSubject {
  readonly description: string | null;
  /** The local calendar date of the entry. */
  readonly date: LocalDate;
  /** Minutes since local midnight; `null` when the source has no time (an imported statement row). */
  readonly minuteOfDay: number | null;
  readonly accountIds: readonly string[];
  readonly direction: RuleDirection;
  /** Whether this entry is the occurrence of a registered subscription. */
  readonly subscription: boolean;
}

/** Why one condition matched or did not, with the values the suggestion explains. */
export type RuleConditionReason =
  | {
      readonly field: 'description';
      readonly matched: boolean;
      readonly values: readonly string[];
      /** The value that made it match; `null` when none did. */
      readonly hit: string | null;
    }
  | {
      readonly field: 'weekday';
      readonly matched: boolean;
      readonly values: readonly Weekday[];
      readonly actual: Weekday;
    }
  | {
      readonly field: 'time';
      readonly matched: boolean;
      readonly before: number;
      /** `null` when the entry has no time (a date-only import row). */
      readonly actual: number | null;
    }
  | {
      readonly field: 'account';
      readonly matched: boolean;
      readonly values: readonly string[];
      readonly actual: readonly string[];
    }
  | {
      readonly field: 'direction';
      readonly matched: boolean;
      readonly values: readonly RuleDirection[];
      readonly actual: RuleDirection;
    }
  | { readonly field: 'subscription'; readonly matched: boolean; readonly actual: boolean };

/** One rule's evaluation: every condition's reason, and whether the whole AND matched. */
export interface RuleMatch {
  readonly ruleId: string;
  readonly name: string;
  readonly position: number;
  readonly matched: boolean;
  readonly reasons: readonly RuleConditionReason[];
  /** The rule's conditions, in the same order as `reasons` (so a consumer can explain one without a rule lookup). */
  readonly conditions: readonly RuleCondition[];
}

/** The result of evaluating every rule for one subject. */
export interface RulesEvaluation {
  /** The category of the topmost matching rule that sets one; `null` when none does. */
  readonly categoryId: string | null;
  readonly winningRule: { readonly id: string; readonly name: string } | null;
  /** The union of every matching rule's tags, first seen first, without duplicates. */
  readonly tags: readonly string[];
  /** More than {@link MAX_TAGS_PER_TRANSACTION} tags would be added; a consumer must not truncate them. */
  readonly tagOverflow: boolean;
  /** Every enabled rule, in order, with its reasons (not only the matches). */
  readonly rules: readonly RuleMatch[];
}

/** A catalog entry the suggestion must fit (the pages' `CategoryView`/`TagView` subset). */
export interface RuleCategoryCatalogEntry {
  readonly id: string;
  readonly kind: CategoryKind;
  readonly archived: boolean;
}

export type RuleApplicationConflict =
  /** The rule's category is gone, archived, or of the other direction. */
  | 'category_unavailable'
  /** The user's tags plus the rule's tags exceed five; nothing is added, so no rule tag is dropped silently. */
  | 'tag_limit';

/** The suggested values after fitting them into an existing draft. */
export interface RuleApplication {
  readonly categoryId: string | null;
  readonly tags: readonly string[];
  readonly conflicts: readonly RuleApplicationConflict[];
}

/** Minutes since midnight (0–1439) of an instant on the wall clock of `timeZone`. */
export function minuteOfDayIn(instant: Date, timeZone: string): number {
  const wall = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  return parseTimeOfDay(wall);
}

/** A rule definition that passed {@link checkRuleDefinition}. */
export class InvalidRuleError extends RangeError {
  override readonly name = 'InvalidRuleError';
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minutes since midnight for `HH:MM`. */
export function parseTimeOfDay(time: string): number {
  const match = TIME_OF_DAY.exec(time);
  if (match === null) throw new RangeError(`Invalid time of day: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `HH:MM` for minutes since midnight (0–1439). */
export function formatTimeOfDay(minute: number): string {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1439) throw new RangeError(`Invalid minute: ${minute}`);
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date, independent of the host's time zone. */
export function weekdayOf(date: LocalDate): Weekday {
  const parsed = parseLocalDate(date);
  // 1970-01-01 was a Thursday: 0 = Sunday … 6 = Saturday.
  const days = Math.round((Date.parse(`${parsed}T00:00:00Z`) - Date.parse('1970-01-01T00:00:00Z')) / 86_400_000);
  const sundayFirst = (((days + 4) % 7) + 7) % 7;
  return (sundayFirst === 0 ? 7 : sundayFirst) as Weekday;
}

/** Trims and collapses whitespace; the empty string for `null`. */
function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function checkValues(field: string, values: readonly string[]): string[] {
  const cleaned = values.map((value) => clean(value)).filter((value) => value !== '');
  if (cleaned.length === 0 || cleaned.length > RULE_VALUES_MAX) {
    throw new InvalidRuleError(field, `${field} needs 1–${RULE_VALUES_MAX} values`);
  }
  if (cleaned.some((value) => value.length > RULE_VALUE_MAX)) {
    throw new InvalidRuleError(field, `${field} values have at most ${RULE_VALUE_MAX} characters`);
  }
  const seen = new Set<string>();
  return cleaned.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function checkId(field: string, value: string): string {
  if (!UUID.test(value)) throw new InvalidRuleError(field, `${field} must be an id`);
  return value;
}

function checkCondition(condition: RuleCondition): RuleCondition {
  switch (condition.field) {
    case 'description':
      return { field: 'description', op: 'containsAny', values: checkValues('description', condition.values) };
    case 'weekday': {
      const values = unique(condition.values);
      if (values.length === 0 || values.some((day) => !WEEKDAYS.includes(day))) {
        throw new InvalidRuleError('weekday', 'A weekday condition needs ISO weekdays 1–7');
      }
      return { field: 'weekday', op: 'oneOf', values: [...values].sort((a, b) => a - b) };
    }
    case 'time':
      if (!Number.isInteger(condition.minute) || condition.minute < 0 || condition.minute > 1439) {
        throw new InvalidRuleError('time', 'A time condition needs minutes between 0 and 1439');
      }
      return { field: 'time', op: 'before', minute: condition.minute };
    case 'account': {
      const values = unique(condition.values.map((value) => checkId('account', value)));
      if (values.length === 0 || values.length > RULE_VALUES_MAX) {
        throw new InvalidRuleError('account', `An account condition needs 1–${RULE_VALUES_MAX} accounts`);
      }
      return { field: 'account', op: 'oneOf', values };
    }
    case 'direction': {
      const values = unique(condition.values);
      if (values.length === 0 || values.some((value) => !RULE_DIRECTIONS.includes(value))) {
        throw new InvalidRuleError('direction', 'A direction condition needs income and/or expense');
      }
      return { field: 'direction', op: 'oneOf', values: [...values].sort() };
    }
    case 'subscription':
      return { field: 'subscription', op: 'isRegistered' };
  }
}

function checkAction(action: RuleAction): RuleAction {
  if (action.type === 'setCategory') {
    return { type: 'setCategory', categoryId: checkId('categoryId', action.categoryId) };
  }
  const tag = normalizeTagSlug(action.tag);
  if (tag === null) throw new InvalidRuleError('tag', 'A tag action needs a usable tag');
  return { type: 'addTag', tag };
}

/**
 * Validates and normalizes a rule definition (`#Dana Darurat` → `dana-darurat`, trimmed condition values, sorted
 * weekdays). Every condition field is used at most once; an AND of repeated fields cannot express anything new.
 * @throws {InvalidRuleError}
 */
export function checkRuleDefinition(input: {
  readonly name: string;
  readonly enabled: boolean;
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly RuleAction[];
}): AutoRuleDefinition {
  const name = clean(input.name);
  if (name === '' || name.length > RULE_NAME_MAX) {
    throw new InvalidRuleError('name', `A rule name has 1–${RULE_NAME_MAX} characters`);
  }
  if (input.conditions.length === 0 || input.conditions.length > RULE_CONDITIONS_MAX) {
    throw new InvalidRuleError('conditions', `A rule needs 1–${RULE_CONDITIONS_MAX} conditions`);
  }
  const fields = input.conditions.map((condition) => condition.field);
  if (new Set(fields).size !== fields.length) {
    throw new InvalidRuleError('conditions', 'Each condition field appears at most once');
  }
  if (input.actions.length === 0 || input.actions.length > RULE_ACTIONS_MAX) {
    throw new InvalidRuleError('actions', `A rule needs 1–${RULE_ACTIONS_MAX} actions`);
  }
  const actions = input.actions.map(checkAction);
  const categories = actions.filter((action) => action.type === 'setCategory');
  if (categories.length > 1) throw new InvalidRuleError('actions', 'A rule sets at most one category');
  const tags = unique(actions.filter((action) => action.type === 'addTag').map((action) => action.tag));
  if (tags.length > MAX_TAGS_PER_TRANSACTION) {
    throw new InvalidRuleError('actions', `A rule adds at most ${MAX_TAGS_PER_TRANSACTION} tags`);
  }
  const seen = new Set<string>();
  const dedupedActions = actions.filter((action) => {
    const key = action.type === 'setCategory' ? `category:${action.categoryId}` : `tag:${action.tag}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { name, enabled: input.enabled, conditions: input.conditions.map(checkCondition), actions: dedupedActions };
}

function evaluateCondition(condition: RuleCondition, subject: RuleSubject): RuleConditionReason {
  switch (condition.field) {
    case 'description': {
      const description = clean(subject.description).toLowerCase();
      const hit =
        description === ''
          ? null
          : (condition.values.find((value) => description.includes(value.toLowerCase())) ?? null);
      return { field: 'description', matched: hit !== null, values: condition.values, hit };
    }
    case 'weekday': {
      const actual = weekdayOf(subject.date);
      return { field: 'weekday', matched: condition.values.includes(actual), values: condition.values, actual };
    }
    case 'time': {
      const actual = subject.minuteOfDay;
      return {
        field: 'time',
        matched: actual !== null && actual < condition.minute,
        before: condition.minute,
        actual,
      };
    }
    case 'account': {
      const actual = unique(subject.accountIds);
      return {
        field: 'account',
        matched: condition.values.some((value) => actual.includes(value)),
        values: condition.values,
        actual,
      };
    }
    case 'direction':
      return {
        field: 'direction',
        matched: condition.values.includes(subject.direction),
        values: condition.values,
        actual: subject.direction,
      };
    case 'subscription':
      return { field: 'subscription', matched: subject.subscription, actual: subject.subscription };
  }
}

/**
 * Evaluates every enabled rule against `subject`, in persisted order. Disabled rules are left out entirely. The
 * category is the topmost matching rule's `setCategory`; the tags are the union of every matching rule's tags.
 */
export function evaluateRules(rules: readonly AutoRuleView[], subject: RuleSubject): RulesEvaluation {
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled)
    .sort((a, b) => a.rule.position - b.rule.position || a.index - b.index)
    .map(({ rule }) => rule);
  const matches: RuleMatch[] = [];
  const tags: string[] = [];
  let categoryId: string | null = null;
  let winningRule: RulesEvaluation['winningRule'] = null;
  for (const rule of ordered) {
    const reasons = rule.conditions.map((condition) => evaluateCondition(condition, subject));
    const matched = reasons.every((reason) => reason.matched);
    matches.push({
      ruleId: rule.id,
      name: rule.name,
      position: rule.position,
      matched,
      reasons,
      conditions: rule.conditions,
    });
    if (!matched) continue;
    for (const action of rule.actions) {
      if (action.type === 'addTag' && !tags.includes(action.tag)) tags.push(action.tag);
    }
    const categoryAction = rule.actions.find((action) => action.type === 'setCategory');
    if (categoryId === null && categoryAction !== undefined) {
      categoryId = categoryAction.categoryId;
      winningRule = { id: rule.id, name: rule.name };
    }
  }
  return {
    categoryId,
    winningRule,
    tags,
    tagOverflow: tags.length > MAX_TAGS_PER_TRANSACTION,
    rules: matches,
  };
}

/** Whether a category of `kind` fits the subject's direction (`fee` categories fit expenses). */
export function categoryFitsDirection(kind: CategoryKind, direction: RuleDirection): boolean {
  return direction === 'income' ? kind === 'income' : kind !== 'income';
}

/**
 * Fits an evaluation into the draft's current values: the winning category when the catalog has it live and of the
 * right direction, and the union of the draft's tags with the rules' tags. A union beyond five tags adds nothing and
 * reports `tag_limit` instead of silently dropping rule tags; an unusable category reports `category_unavailable`.
 * Explicit user choices (the draft's category and tags) are never replaced: the category is only set when the draft
 * has none, and the draft's tags always stay.
 */
export function applyRuleSuggestion(
  current: { readonly categoryId: string | null; readonly tags: readonly string[] },
  evaluation: RulesEvaluation,
  catalog: {
    readonly categories: readonly RuleCategoryCatalogEntry[];
    readonly direction: RuleDirection;
  },
): RuleApplication {
  const conflicts: RuleApplicationConflict[] = [];
  let categoryId = current.categoryId;
  if (categoryId === null && evaluation.categoryId !== null) {
    const category = catalog.categories.find((entry) => entry.id === evaluation.categoryId);
    if (category === undefined || category.archived || !categoryFitsDirection(category.kind, catalog.direction)) {
      conflicts.push('category_unavailable');
    } else {
      categoryId = category.id;
    }
  }
  const tags = unique([...current.tags, ...evaluation.tags]);
  if (tags.length > MAX_TAGS_PER_TRANSACTION) {
    conflicts.push('tag_limit');
    return { categoryId, tags: [...current.tags], conflicts };
  }
  return { categoryId, tags, conflicts };
}

/** A deterministic pattern for rule suggestions: the merchant when there is one, otherwise the description. */
export interface CorrectionPattern {
  /** Grouping key: lowercased words (`kopi kenangan`). */
  readonly pattern: string;
  /** What the suggestion quotes (`Kopi Kenangan`). */
  readonly label: string;
}

const TRAILING_AMOUNT = /[\s\-–—#*]*\b\d[\d.,]*\b\s*$/u;
const TRAILING_REFERENCE = /\s+(?:ref|trx|transaksi|invoice|inv)[\s#:.-]*[a-z0-9-]+$/iu;

/**
 * The pattern a manual category correction is counted under. The merchant wins; without one, the description with
 * trailing amounts and references removed collapses to a stable, case-insensitive phrase. `null` when there is
 * nothing usable (a description of only digits or punctuation), so such a correction never suggests a rule.
 */
export function correctionPattern(description: string | null, merchant: string | null): CorrectionPattern | null {
  const source = clean(merchant) || clean(description);
  if (source === '') return null;
  const stripped = clean(source.replace(TRAILING_REFERENCE, '').replace(TRAILING_AMOUNT, ''));
  const label = (stripped === '' ? source : stripped).slice(0, CORRECTION_LABEL_MAX).trim();
  const pattern = label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (pattern.length < 3 || !/[\p{L}]/u.test(pattern)) return null;
  return { pattern, label };
}

/** The stable key of a suggestion (`kopi kenangan|<from>|<to>`), used by dismissals and the editor's prefill. */
export function ruleSuggestionKey(pattern: string, fromCategoryId: string, toCategoryId: string): string {
  return `${pattern}|${fromCategoryId}|${toCategoryId}`;
}
