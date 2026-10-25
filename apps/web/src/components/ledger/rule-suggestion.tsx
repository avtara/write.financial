// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inline rule suggestion in the Quick Add bar and the Record sheet (FR-AI1): the matching rules' category and
 * tags, why they matched, and one "Terapkan" that fills only what the draft does not already have. It never replaces
 * the category the user picked and never drops their tags; more than five tags is a warning instead of a truncation.
 * Nothing is saved here — the user still confirms the transaction.
 */
import type { CategoryView } from '@wf/db/categories';
import type { AutoRuleView } from '@wf/domain/rules';
import {
  applyRuleSuggestion,
  evaluateRules,
  parseTimeOfDay,
  type RuleApplication,
  type RuleCondition,
} from '@wf/domain/rules';
import { m } from '@wf/i18n/messages';
import { Sparkles } from 'lucide-react';
import { ruleCategoryName, reasonText, type RuleLookup } from '../settings/rules-format.ts';
import { Button } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import type { TransactionFormValues } from './transaction-draft.ts';

export interface RuleSuggestionProps {
  readonly rules: readonly AutoRuleView[];
  /** Names of the user's registered subscriptions (from the server), for the subscription condition. */
  readonly subscriptionNames: readonly string[];
  readonly categories: readonly CategoryView[];
  readonly values: TransactionFormValues;
  /** The Quick Add bar's category came from its own guess, so a rule may replace it; a picked one stays. */
  readonly categoryIsGuess?: boolean;
  /** Fills the category and/or tags the user accepted. */
  readonly onApply: (values: Partial<TransactionFormValues>) => void;
}

const sameTags = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((tag) => right.includes(tag));

/** The suggestion for the current draft, or `null` when no enabled rule matches or nothing would change. */
export function RuleSuggestion({
  rules,
  categories,
  values,
  subscriptionNames,
  categoryIsGuess = false,
  onApply,
}: RuleSuggestionProps) {
  const { preferences } = usePreferences();
  if (values.type === 'transfer' || rules.length === 0) return null;
  const direction = values.type;
  const description = values.description.trim().toLowerCase();
  const subscription =
    description !== '' && subscriptionNames.some((name) => description.includes(name.trim().toLowerCase()));
  const evaluation = evaluateRules(rules, {
    description: values.description === '' ? null : values.description,
    date: values.date,
    minuteOfDay: /^([01]\d|2[0-3]):[0-5]\d$/.test(values.time) ? parseTimeOfDay(values.time) : null,
    accountIds: [values.accountId, values.toAccountId].filter((id): id is string => id !== null),
    direction,
    subscription,
  });
  const firstMatch = evaluation.rules.find((entry) => entry.matched);
  const winner =
    evaluation.winningRule === null
      ? undefined
      : evaluation.rules.find((entry) => entry.ruleId === evaluation.winningRule?.id);
  // The heading names the rule that set the category; a tag-only rule earlier in the order is not the winner.
  const match = winner ?? firstMatch;
  if (match === undefined) return null;
  const matchedRules = evaluation.rules.filter((entry) => entry.matched);
  const application: RuleApplication = applyRuleSuggestion(
    { categoryId: categoryIsGuess ? null : values.categoryId, tags: values.tags },
    evaluation,
    {
      categories: categories.map((category) => ({
        id: category.id,
        kind: category.kind,
        archived: category.archivedAt !== null,
      })),
      direction,
    },
  );
  const categoryChanged = application.categoryId !== values.categoryId;
  const tagsChanged = !sameTags(application.tags, values.tags);
  const tagLimit = application.conflicts.includes('tag_limit');
  const categoryUnavailable = application.conflicts.includes('category_unavailable');
  if (!categoryChanged && !tagsChanged && !tagLimit && !categoryUnavailable) return null;
  const lookup: RuleLookup = { categories, accounts: [], locale: preferences.locale };
  const tags = tagLimit ? [] : application.tags.filter((tag) => !values.tags.includes(tag));
  return (
    <section
      aria-label={m.rules_suggest_title({ name: match.name })}
      className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-sunken px-3 py-2.5 text-[12.5px]"
    >
      <div className="flex items-start gap-2">
        <Sparkles aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-amber-fg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="font-medium text-fg">{m.rules_suggest_title({ name: match.name })}</p>
          {categoryUnavailable ? (
            <p role="alert" className="text-amber-fg">
              {m.rules_suggest_category_unavailable()}
            </p>
          ) : null}
          {tagLimit ? (
            <p role="alert" className="text-amber-fg">
              {m.rules_suggest_tag_limit()}
            </p>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-fg">
            {categoryChanged ? (
              <span>{m.rules_suggest_category({ category: ruleCategoryName(lookup, application.categoryId) })}</span>
            ) : null}
            {tags.map((tag) => (
              <span key={tag} className="font-mono text-[11.5px] text-muted-fg">
                #{tag}
              </span>
            ))}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={tagLimit}
          onClick={() => {
            onApply({
              ...(categoryChanged ? { categoryId: application.categoryId } : {}),
              ...(tagsChanged && !tagLimit ? { tags: [...application.tags] } : {}),
            });
          }}
        >
          {m.rules_suggest_apply()}
        </Button>
      </div>
      <details className="text-[11.5px] text-subtle">
        <summary className="cursor-pointer select-none">{m.rules_suggest_reasons()}</summary>
        <ul className="mt-1 flex flex-col gap-1">
          {matchedRules.map((rule) => (
            <li key={rule.ruleId}>
              <p className="font-medium text-muted-fg">{m.rules_suggest_title({ name: rule.name })}</p>
              <ul className="flex flex-col gap-0.5">
                {rule.reasons.map((reason, index) => {
                  // `reasons` is built one-per-condition by the evaluator, so the index is always in range.
                  const condition = rule.conditions[index] as RuleCondition;
                  return <li key={`${reason.field}-${String(index)}`}>{reasonText(condition, reason, lookup)}</li>;
                })}
              </ul>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
