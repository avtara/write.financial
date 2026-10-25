// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of an auto rule (FR-AI1): its conditions and actions as the list and editor show them, and one
 * condition's match/no-match reason with the actual value ("hari Minggu", "bukan gojek/krl"). Category names go
 * through the ledger labels (built-ins are translated), weekday names through the locale.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { RuleAction, RuleCondition, RuleConditionReason } from '@wf/domain/rules';
import { formatTimeOfDay } from '@wf/domain/rules';
import type { Locale } from '@wf/domain/money';
import { m } from '@wf/i18n/messages';
import { weekdayName } from '@wf/ui/dates';
import { categoryName } from '../../lib/ledger-labels.ts';

export interface RuleLookup {
  readonly categories: readonly CategoryView[];
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
}

const categoryOf = (lookup: RuleLookup, id: string) => lookup.categories.find((entry) => entry.id === id);
const accountOf = (lookup: RuleLookup, id: string) => lookup.accounts.find((entry) => entry.id === id);

/** The display name of a category id, or a neutral fallback when it no longer exists. */
export function ruleCategoryName(lookup: RuleLookup, id: string | null): string {
  if (id === null) return m.rules_no_category();
  const category = categoryOf(lookup, id);
  return category === undefined ? m.rules_unknown_category() : categoryName(category);
}

const directionsText = (values: readonly string[]): string =>
  values.map((value) => (value === 'income' ? m.rules_direction_income() : m.rules_direction_expense())).join(', ');

/** One condition as "Deskripsi berisi salah satu gojek, krl" or "Jam sebelum 10:00". */
export function conditionText(condition: RuleCondition, lookup: RuleLookup): string {
  switch (condition.field) {
    case 'description':
      return m.rules_condition_description({ values: condition.values.join(', ') });
    case 'weekday':
      return m.rules_condition_weekday({
        days: condition.values.map((day) => weekdayName(day, lookup.locale)).join(', '),
      });
    case 'time':
      return m.rules_condition_time({ time: formatTimeOfDay(condition.minute) });
    case 'account':
      return m.rules_condition_account({
        accounts: condition.values
          .map((id) => accountOf(lookup, id)?.displayName ?? m.rules_unknown_account())
          .join(', '),
      });
    case 'direction':
      return m.rules_condition_direction({ directions: directionsText(condition.values) });
    case 'subscription':
      return m.rules_condition_subscription();
  }
}

/** One action as "Kategori: Transportasi" or "Tag: #kantor". */
export function ruleActionText(action: RuleAction, lookup: RuleLookup): string {
  if (action.type === 'setCategory') {
    return m.rules_action_category({ category: ruleCategoryName(lookup, action.categoryId) });
  }
  return m.rules_action_tag({ tag: `#${action.tag}` });
}

/** The actual value of a failed or matching condition, for "bukan gojek/krl". */
function actualText(reason: RuleConditionReason, lookup: RuleLookup): string {
  switch (reason.field) {
    case 'description':
      return reason.hit ?? m.rules_reason_none();
    case 'weekday':
      return weekdayName(reason.actual, lookup.locale);
    case 'time':
      return reason.actual === null ? m.rules_reason_no_time() : formatTimeOfDay(reason.actual);
    case 'account':
      return reason.actual.length === 0
        ? m.rules_reason_none()
        : reason.actual.map((id) => accountOf(lookup, id)?.displayName ?? m.rules_unknown_account()).join(', ');
    case 'direction':
      return directionsText([reason.actual]);
    case 'subscription':
      return reason.actual ? m.rules_reason_registered() : m.rules_reason_not_registered();
  }
}

/** A condition's reason: "Cocok: …" or "Tidak cocok: … (…)". */
export function reasonText(condition: RuleCondition, reason: RuleConditionReason, lookup: RuleLookup): string {
  const text = conditionText(condition, lookup);
  return reason.matched
    ? m.rules_reason_matched({ condition: text, actual: actualText(reason, lookup) })
    : m.rules_reason_not_matched({ condition: text, actual: actualText(reason, lookup) });
}

/** The conditions of a list row, joined for one compact line. */
export function conditionsSummary(conditions: readonly RuleCondition[], lookup: RuleLookup): string {
  return conditions.map((condition) => conditionText(condition, lookup)).join(' · ');
}

/** The actions of a list row, joined for one compact line. */
export function actionsSummary(actions: readonly RuleAction[], lookup: RuleLookup): string {
  return actions.map((action) => ruleActionText(action, lookup)).join(' · ');
}
