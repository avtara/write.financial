// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The auto-rule editor (design evJtJ/h7hnWe): name and active switch, the ANDed conditions (`JIKA`) with every
 * specified field, the actions (`MAKA`: a category and/or tags), and a preview (`PRATINJAU`) with the trial's
 * per-condition reasons plus the current period's matches. Save/cancel with a dirty state; a failed save keeps the
 * edits for a retry ("Coba lagi"); a saved rule offers "Urungkan". A new rule can be prefilled from a correction
 * suggestion but is only created when the user saves it.
 */
import type { AccountView } from '@wf/db/accounts';
import type { AutoRulePreview } from '@wf/db/auto-rules';
import type { AutoRuleView } from '@wf/domain/rules';
import type { CategoryView } from '@wf/db/categories';
import type { TagView } from '@wf/db/tags';
import type { LocalDate } from '@wf/domain/period';
import {
  formatTimeOfDay,
  parseTimeOfDay,
  WEEKDAYS,
  type AutoRuleDefinition,
  type RuleAction,
  type RuleCondition,
  type RuleDirection,
} from '@wf/domain/rules';
import { m } from '@wf/i18n/messages';
import { formatDate, toLocalDate, weekdayName } from '@wf/ui/dates';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { Switch } from '@wf/ui/switch';
import { toast } from '@wf/ui/toast';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import { createAutoRule, deleteAutoRule, previewAutoRule, updateAutoRule } from '../../server/fn/rules.ts';
import { Button, FormError, Select, TextInput } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { wallTime } from '../ledger/transaction-draft.ts';
import { conditionText, ruleActionText, ruleCategoryName, type RuleLookup } from './rules-format.ts';

export interface RuleEditorProps {
  /** The starting values (a saved rule, a suggestion's prefill, or the blank new rule). */
  readonly initial: AutoRuleDefinition;
  /** The saved rule being edited; `null` for a new one. */
  readonly rule: AutoRuleView | null;
  /** From a correction suggestion: dismissed when the rule is created. */
  readonly suggestionKey?: string;
  readonly categories: readonly CategoryView[];
  readonly accounts: readonly AccountView[];
  readonly tags: readonly TagView[];
  readonly timeZone: string;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  /** "Terapkan ke transaksi lama" for this saved rule; absent for a new rule. */
  readonly onApplyPast?: () => void;
}

interface Trial {
  readonly description: string;
  readonly date: LocalDate;
  readonly time: string;
  readonly accountId: string | null;
  readonly direction: RuleDirection;
  readonly subscription: boolean;
}

const DEFAULT_CONDITION: Readonly<Record<RuleCondition['field'], RuleCondition>> = {
  description: { field: 'description', op: 'containsAny', values: [] },
  weekday: { field: 'weekday', op: 'oneOf', values: [] },
  time: { field: 'time', op: 'before', minute: 600 },
  account: { field: 'account', op: 'oneOf', values: [] },
  direction: { field: 'direction', op: 'oneOf', values: ['expense'] },
  subscription: { field: 'subscription', op: 'isRegistered' },
};

const FIELD_LABEL: Readonly<Record<RuleCondition['field'], () => string>> = {
  description: m.rules_field_description,
  weekday: m.rules_field_weekday,
  time: m.rules_field_time,
  account: m.rules_field_account,
  direction: m.rules_field_direction,
  subscription: m.rules_condition_subscription,
};

const CHIP =
  'inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const CHIP_ON = 'border-fg bg-fg font-medium text-primary-fg';
const CHIP_OFF = 'border-border-input text-muted-fg hover:bg-muted';

/** A description's values stay raw while typing (a comma or a trailing space must not jump the cursor). */
function DescriptionValues({
  values,
  onChange,
  label,
}: {
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly label: string;
}) {
  const [raw, setRaw] = useState(values.join(', '));
  return (
    <TextInput
      size="sm"
      aria-label={label}
      value={raw}
      placeholder={m.rules_description_placeholder()}
      autoComplete="off"
      onChange={(event) => {
        const text = event.currentTarget.value;
        setRaw(text);
        onChange(text.split(',').map((value) => value.trim()));
      }}
    />
  );
}

/** One condition row: its field, its values, and Remove. */
function ConditionRow({
  condition,
  index,
  lookup,
  accounts,
  onChange,
  onRemove,
}: {
  readonly condition: RuleCondition;
  readonly index: number;
  readonly lookup: RuleLookup;
  readonly accounts: readonly AccountView[];
  readonly onChange: (condition: RuleCondition) => void;
  readonly onRemove: () => void;
}) {
  const label = conditionText(condition, lookup);
  const remove = (
    <button
      type="button"
      aria-label={m.rules_remove_condition({ condition: label })}
      onClick={onRemove}
      className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Trash2 aria-hidden="true" className="size-3.5" />
    </button>
  );
  const toggle = <T,>(current: readonly T[], value: T): T[] =>
    current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
  const field = (
    <span className="inline-flex h-7 shrink-0 items-center rounded-[6px] border border-border bg-surface-sunken px-2 text-[12px] font-medium text-fg">
      {FIELD_LABEL[condition.field]()}
    </span>
  );
  switch (condition.field) {
    case 'description':
      return (
        <li className="flex items-center gap-2">
          {field}
          <span className="shrink-0 text-[12px] text-muted-fg">{m.rules_op_contains_any()}</span>
          <div className="min-w-0 flex-1">
            <DescriptionValues
              key={`description-${String(index)}`}
              label={m.rules_field_description()}
              values={condition.values}
              onChange={(values) => {
                onChange({ ...condition, values });
              }}
            />
          </div>
          {remove}
        </li>
      );
    case 'weekday':
      return (
        <li className="flex flex-wrap items-center gap-2">
          {field}
          <span className="shrink-0 text-[12px] text-muted-fg">{m.rules_op_one_of()}</span>
          <div role="group" aria-label={m.rules_field_weekday()} className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={condition.values.includes(day)}
                onClick={() => {
                  onChange({ ...condition, values: toggle(condition.values, day) });
                }}
                className={`${CHIP} ${condition.values.includes(day) ? CHIP_ON : CHIP_OFF}`}
              >
                {weekdayName(day, lookup.locale)}
              </button>
            ))}
          </div>
          {remove}
        </li>
      );
    case 'time':
      return (
        <li className="flex items-center gap-2">
          {field}
          <span className="shrink-0 text-[12px] text-muted-fg">{m.rules_op_before()}</span>
          <input
            type="time"
            aria-label={m.rules_field_time()}
            value={formatTimeOfDay(condition.minute)}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) onChange({ ...condition, minute: parseTimeOfDay(value) });
            }}
            className="h-8 rounded-[7px] border border-border-input bg-input px-2.5 text-[12.5px] text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          {remove}
        </li>
      );
    case 'account':
      return (
        <li className="flex flex-wrap items-center gap-2">
          {field}
          <span className="shrink-0 text-[12px] text-muted-fg">{m.rules_op_one_of()}</span>
          <div role="group" aria-label={m.rules_field_account()} className="flex flex-wrap gap-1">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                aria-pressed={condition.values.includes(account.id)}
                onClick={() => {
                  onChange({ ...condition, values: toggle(condition.values, account.id) });
                }}
                className={`${CHIP} ${condition.values.includes(account.id) ? CHIP_ON : CHIP_OFF}`}
              >
                {account.displayName}
              </button>
            ))}
          </div>
          {remove}
        </li>
      );
    case 'direction':
      return (
        <li className="flex flex-wrap items-center gap-2">
          {field}
          <span className="shrink-0 text-[12px] text-muted-fg">{m.rules_op_one_of()}</span>
          <div role="group" aria-label={m.rules_field_direction()} className="flex flex-wrap gap-1">
            {(['expense', 'income'] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                aria-pressed={condition.values.includes(direction)}
                onClick={() => {
                  onChange({ ...condition, values: toggle(condition.values, direction) });
                }}
                className={`${CHIP} ${condition.values.includes(direction) ? CHIP_ON : CHIP_OFF}`}
              >
                {direction === 'income' ? m.rules_direction_income() : m.rules_direction_expense()}
              </button>
            ))}
          </div>
          {remove}
        </li>
      );
    case 'subscription':
      return (
        <li className="flex items-center gap-2">
          {field}
          <span className="min-w-0 flex-1 text-[12px] text-muted-fg">{m.rules_condition_subscription()}</span>
          {remove}
        </li>
      );
  }
}

/** One action row: a category select or a tag input. */
function ActionRow({
  action,
  index,
  lookup,
  categories,
  tags,
  onChange,
  onRemove,
}: {
  readonly action: RuleAction;
  readonly index: number;
  readonly lookup: RuleLookup;
  readonly categories: readonly CategoryView[];
  readonly tags: readonly TagView[];
  readonly onChange: (action: RuleAction) => void;
  readonly onRemove: () => void;
}) {
  const label = ruleActionText(action, lookup);
  const remove = (
    <button
      type="button"
      aria-label={m.rules_remove_action({ action: label })}
      onClick={onRemove}
      className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Trash2 aria-hidden="true" className="size-3.5" />
    </button>
  );
  if (action.type === 'setCategory') {
    const live = categories.filter((category) => category.archivedAt === null);
    return (
      <li className="flex items-center gap-2">
        <span className="inline-flex h-7 shrink-0 items-center rounded-[6px] border border-border bg-surface-sunken px-2 text-[12px] font-medium text-fg">
          {m.rules_action_set_category()}
        </span>
        <Select
          size="sm"
          aria-label={m.rules_action_category_label()}
          value={action.categoryId}
          onChange={(event) => {
            onChange({ type: 'setCategory', categoryId: event.currentTarget.value });
          }}
          className="min-w-0 flex-1"
        >
          {live.map((category) => (
            <option key={category.id} value={category.id}>
              {categoryName(category)}
            </option>
          ))}
        </Select>
        {remove}
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2">
      <span className="inline-flex h-7 shrink-0 items-center rounded-[6px] border border-border bg-surface-sunken px-2 text-[12px] font-medium text-fg">
        {m.rules_action_add_tag()}
      </span>
      <div className="relative min-w-0 flex-1">
        <span aria-hidden="true" className="absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-subtle">
          #
        </span>
        <TextInput
          size="sm"
          aria-label={m.rules_action_tag_label()}
          list={`rules-tags-${String(index)}`}
          value={action.tag}
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          onChange={(event) => {
            onChange({ type: 'addTag', tag: event.currentTarget.value });
          }}
          className="pl-6 font-mono"
        />
        <datalist id={`rules-tags-${String(index)}`}>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.slug} />
          ))}
        </datalist>
      </div>
      {remove}
    </li>
  );
}

export function RuleEditor({
  initial,
  rule,
  suggestionKey,
  categories,
  accounts,
  tags,
  timeZone,
  onClose,
  onSaved,
  onApplyPast,
}: RuleEditorProps) {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const [draft, setDraft] = useState<AutoRuleDefinition>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AutoRulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [adding, setAdding] = useState<'condition' | 'action' | null>(null);
  const [trial, setTrial] = useState<Trial>(() => ({
    description:
      initial.conditions.find((condition) => condition.field === 'description')?.field === 'description'
        ? (initial.conditions.find((condition) => condition.field === 'description')?.values[0] ?? '')
        : '',
    date: toLocalDate(new Date(), timeZone),
    time: wallTime(new Date(), timeZone),
    accountId: accounts.find((account) => account.status === 'active')?.id ?? null,
    direction: 'expense',
    subscription: false,
  }));
  const started = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const lookup: RuleLookup = { categories, accounts, locale };
  const usedFields = new Set(draft.conditions.map((condition) => condition.field));
  const freeFields = (Object.keys(DEFAULT_CONDITION) as RuleCondition['field'][]).filter(
    (field) => !usedFields.has(field),
  );
  const hasCategoryAction = draft.actions.some((action) => action.type === 'setCategory');
  const liveCategories = categories.filter((category) => category.archivedAt === null);

  const updateCondition = (index: number, condition: RuleCondition) => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((entry, at) => (at === index ? condition : entry)),
    }));
    setPreview(null);
  };

  const updateAction = (index: number, action: RuleAction) => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((entry, at) => (at === index ? action : entry)),
    }));
    setPreview(null);
  };

  const requestPreview = async (definition: AutoRuleDefinition, sample: Trial) => {
    setPreviewing(true);
    setPreviewError(null);
    const result = await previewAutoRule({
      data: {
        input: definition,
        trial: {
          description: sample.description.trim() === '' ? null : sample.description,
          date: sample.date,
          time: sample.time === '' ? null : sample.time,
          accountId: sample.accountId,
          direction: sample.direction,
          subscription: sample.subscription,
        },
      },
    }).catch(() => null);
    setPreviewing(false);
    if (result === null || !result.ok) {
      setPreviewError(result === null ? m.rules_preview_failed() : ledgerErrorMessage(result.code, locale));
      return;
    }
    setPreview(result.value);
  };

  useEffect(() => {
    if (started.current || rule === null) return;
    started.current = true;
    void requestPreview(initial, trial);
    // Once, with the rule the editor opened; later runs are the user's "Uji".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result =
      rule === null
        ? await createAutoRule({
            data: { input: draft, ...(suggestionKey === undefined ? {} : { suggestionKey }) },
          }).catch(() => null)
        : await updateAutoRule({ data: { id: rule.id, input: draft } }).catch(() => null);
    setSaving(false);
    if (result === null || !result.ok) {
      setError(result === null ? m.rules_editor_failed() : ledgerErrorMessage(result.code, locale));
      return;
    }
    if (rule === null) {
      toast.undo({
        title: m.rules_editor_saved(),
        undoLabel: m.rules_editor_undo(),
        onUndo: () => {
          void deleteAutoRule({ data: { id: result.value.id } }).then((undone) => {
            if (undone.ok) onSaved();
            else toast({ tone: 'error', title: ledgerErrorMessage(undone.code, locale) });
          });
        },
      });
    } else {
      toast.undo({
        title: m.rules_editor_saved(),
        undoLabel: m.rules_editor_undo(),
        onUndo: () => {
          void updateAutoRule({ data: { id: rule.id, input: initial } }).then((undone) => {
            if (undone.ok) onSaved();
            else toast({ tone: 'error', title: ledgerErrorMessage(undone.code, locale) });
          });
        },
      });
    }
    onSaved();
  };

  const matched = preview?.trial.rules[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (dirty) setDiscarding(true);
            else onClose();
          }}
          className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {m.rules_editor_back()}
        </button>
        {rule === null ? null : (
          <span className="text-[12px] text-subtle">{m.rules_editor_position({ position: rule.position + 1 })}</span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="rule-name" className="text-[12.5px] font-medium text-muted-fg">
              {m.rules_editor_name()}
            </label>
            <TextInput
              id="rule-name"
              size="sm"
              value={draft.name}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => {
                const name = event.currentTarget.value;
                setDraft((current) => ({ ...current, name }));
                setPreview(null);
              }}
            />
          </div>
          <Switch
            label={m.rules_editor_active()}
            checked={draft.enabled}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setDraft((current) => ({ ...current, enabled }));
              setPreview(null);
            }}
          />
        </div>

        <section className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-sunken p-3">
          <header className="flex flex-wrap items-baseline gap-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{m.rules_editor_if()}</h4>
            <span className="text-[12px] text-muted-fg">{m.rules_editor_all_must_match()}</span>
          </header>
          {draft.conditions.length === 0 ? (
            <p className="text-[12px] text-subtle">{m.rules_editor_no_conditions()}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {draft.conditions.map((condition, index) => (
                <ConditionRow
                  key={`${condition.field}-${String(index)}`}
                  condition={condition}
                  index={index}
                  lookup={lookup}
                  accounts={accounts}
                  onChange={(next) => {
                    updateCondition(index, next);
                  }}
                  onRemove={() => {
                    setDraft((current) => ({
                      ...current,
                      conditions: current.conditions.filter((_, at) => at !== index),
                    }));
                    setPreview(null);
                  }}
                />
              ))}
            </ul>
          )}
          {adding === 'condition' ? (
            <div className="flex items-center gap-2">
              <Select
                size="sm"
                aria-label={m.rules_editor_add_condition()}
                autoFocus
                defaultValue=""
                onChange={(event) => {
                  const field = event.currentTarget.value as RuleCondition['field'];
                  if (!(field in DEFAULT_CONDITION) || usedFields.has(field)) return;
                  setDraft((current) => ({
                    ...current,
                    conditions: [...current.conditions, DEFAULT_CONDITION[field]],
                  }));
                  setAdding(null);
                  setPreview(null);
                }}
              >
                <option value="">{m.rules_editor_add_condition()}</option>
                {freeFields.map((field) => (
                  <option key={field} value={field}>
                    {FIELD_LABEL[field]()}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(null);
                }}
              >
                {m.settings_cancel()}
              </Button>
            </div>
          ) : (
            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={freeFields.length === 0}
                onClick={() => {
                  setAdding('condition');
                }}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                {m.rules_editor_add_condition()}
              </Button>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-sunken p-3">
          <h4 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{m.rules_editor_then()}</h4>
          {draft.actions.length === 0 ? (
            <p className="text-[12px] text-subtle">{m.rules_editor_no_actions()}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {draft.actions.map((action, index) => (
                <ActionRow
                  key={`${action.type}-${String(index)}`}
                  action={action}
                  index={index}
                  lookup={lookup}
                  categories={categories}
                  tags={tags}
                  onChange={(next) => {
                    updateAction(index, next);
                  }}
                  onRemove={() => {
                    setDraft((current) => ({
                      ...current,
                      actions: current.actions.filter((_, at) => at !== index),
                    }));
                    setPreview(null);
                  }}
                />
              ))}
            </ul>
          )}
          {adding === 'action' ? (
            <div className="flex items-center gap-2">
              <Select
                size="sm"
                aria-label={m.rules_editor_add_action()}
                autoFocus
                defaultValue=""
                onChange={(event) => {
                  const type = event.currentTarget.value;
                  if (type === 'setCategory') {
                    // The option is only offered while a live category exists.
                    const first = liveCategories[0] as CategoryView;
                    setDraft((current) => ({
                      ...current,
                      actions: [...current.actions, { type: 'setCategory', categoryId: first.id }],
                    }));
                  } else if (type === 'addTag') {
                    setDraft((current) => ({
                      ...current,
                      actions: [...current.actions, { type: 'addTag', tag: '' }],
                    }));
                  } else {
                    return;
                  }
                  setAdding(null);
                  setPreview(null);
                }}
              >
                <option value="">{m.rules_editor_add_action()}</option>
                {hasCategoryAction || liveCategories.length === 0 ? null : (
                  <option value="setCategory">{m.rules_action_set_category()}</option>
                )}
                <option value="addTag">{m.rules_action_add_tag()}</option>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(null);
                }}
              >
                {m.settings_cancel()}
              </Button>
            </div>
          ) : (
            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={hasCategoryAction && liveCategories.length === 0}
                onClick={() => {
                  setAdding('action');
                }}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                {m.rules_editor_add_action()}
              </Button>
            </div>
          )}
        </section>

        <section
          aria-label={m.rules_preview_title()}
          className="flex flex-col gap-2 rounded-[10px] border border-border bg-card p-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{m.rules_preview_title()}</h4>
            <div className="flex items-center gap-2">
              {onApplyPast === undefined ? null : (
                <Button variant="ghost" size="sm" onClick={onApplyPast}>
                  {m.rules_apply_past()}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                pending={previewing}
                onClick={() => {
                  void requestPreview(draft, trial);
                }}
              >
                {m.rules_preview_run()}
              </Button>
            </div>
          </div>
          {draft.enabled ? null : <p className="text-[11.5px] text-amber-fg">{m.rules_preview_inactive_note()}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="trial-description" className="text-[11.5px] text-muted-fg">
                {m.rules_preview_description()}
              </label>
              <TextInput
                id="trial-description"
                size="sm"
                value={trial.description}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => {
                  const description = event.currentTarget.value;
                  setTrial((current) => ({ ...current, description }));
                  setPreview(null);
                }}
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="trial-date" className="text-[11.5px] text-muted-fg">
                  {m.rules_preview_date({ date: formatDate(trial.date, locale, 'date') })}
                </label>
                <input
                  id="trial-date"
                  type="date"
                  value={trial.date}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                      setTrial((current) => ({ ...current, date: value as LocalDate }));
                      setPreview(null);
                    }
                  }}
                  className="h-8 rounded-[7px] border border-border-input bg-input px-2.5 text-[12.5px] text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
              </div>
              <div className="flex w-[110px] flex-col gap-1">
                <label htmlFor="trial-time" className="text-[11.5px] text-muted-fg">
                  {m.rules_preview_time()}
                </label>
                <input
                  id="trial-time"
                  type="time"
                  value={trial.time}
                  onChange={(event) => {
                    const time = event.currentTarget.value;
                    setTrial((current) => ({ ...current, time }));
                    setPreview(null);
                  }}
                  className="h-8 rounded-[7px] border border-border-input bg-input px-2.5 text-[12.5px] text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="trial-account" className="text-[11.5px] text-muted-fg">
                {m.rules_preview_account()}
              </label>
              <Select
                id="trial-account"
                size="sm"
                value={trial.accountId ?? ''}
                onChange={(event) => {
                  const accountId = event.currentTarget.value === '' ? null : event.currentTarget.value;
                  setTrial((current) => ({ ...current, accountId }));
                  setPreview(null);
                }}
              >
                <option value="">{m.rules_preview_no_account()}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="trial-direction" className="text-[11.5px] text-muted-fg">
                  {m.rules_preview_direction()}
                </label>
                <Select
                  id="trial-direction"
                  size="sm"
                  value={trial.direction}
                  onChange={(event) => {
                    const direction = event.currentTarget.value as RuleDirection;
                    setTrial((current) => ({ ...current, direction }));
                    setPreview(null);
                  }}
                >
                  <option value="expense">{m.rules_direction_expense()}</option>
                  <option value="income">{m.rules_direction_income()}</option>
                </Select>
              </div>
              <Switch
                label={m.rules_preview_subscription()}
                checked={trial.subscription}
                onChange={(event) => {
                  const subscription = event.currentTarget.checked;
                  setTrial((current) => ({ ...current, subscription }));
                  setPreview(null);
                }}
              />
            </div>
          </div>
          {previewError === null ? null : <FormError>{previewError}</FormError>}
          {preview === null ? (
            <p className="text-[12px] text-subtle">{m.rules_preview_idle()}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] font-medium text-fg">
                {matched?.matched === true ? m.rules_preview_matched() : m.rules_preview_not_matched()}
              </p>
              <ul className="flex flex-col gap-0.5 text-[12px]">
                {draft.conditions.map((condition, index) => {
                  const reason = matched?.reasons[index];
                  const style = reason?.matched === true ? 'text-green-fg' : 'text-red-fg';
                  return (
                    <li key={`${condition.field}-${String(index)}`} className={style}>
                      {reason === undefined
                        ? conditionText(condition, lookup)
                        : m.rules_preview_reason({
                            condition: conditionText(condition, lookup),
                            result: reason.matched ? m.rules_preview_reason_match() : m.rules_preview_reason_miss(),
                          })}
                    </li>
                  );
                })}
              </ul>
              <p className="text-[12px] text-muted-fg">
                {m.rules_preview_result({
                  category: ruleCategoryName(lookup, preview.trial.categoryId),
                  tags:
                    preview.trial.tags.length === 0
                      ? m.rules_preview_no_tags()
                      : preview.trial.tags.map((tag) => `#${tag}`).join(' '),
                })}
              </p>
              <div className="border-t border-border pt-2">
                <p className="text-[12px] font-medium text-fg">
                  {preview.period.label === null
                    ? m.rules_preview_period_none()
                    : m.rules_preview_period({
                        matched: preview.period.matched,
                        total: preview.period.total,
                        label: preview.period.label,
                      })}
                </p>
                {preview.period.truncated ? (
                  <p className="text-[11px] text-amber-fg">{m.rules_preview_period_truncated()}</p>
                ) : null}
                {preview.period.samples.length === 0 ? null : (
                  <ul className="mt-1 flex flex-col gap-0.5 text-[11.5px] text-muted-fg">
                    {preview.period.samples.map((sample) => {
                      const failing = sample.reasons.findIndex((reason) => !reason.matched);
                      // Reasons are one per condition in order; a matched sample uses the first only as a placeholder.
                      const condition = draft.conditions[failing < 0 ? 0 : failing] as RuleCondition;
                      return (
                        <li key={sample.id} className="flex gap-2">
                          <span className="w-[64px] shrink-0">{formatDate(sample.localDate, locale, 'day')}</span>
                          <span className="min-w-0 flex-1 truncate">{sample.description ?? m.rules_untitled()}</span>
                          <span className={sample.matched ? 'shrink-0 text-green-fg' : 'shrink-0 text-red-fg'}>
                            {sample.matched
                              ? m.rules_preview_sample_matched()
                              : m.rules_preview_sample_missed({ condition: conditionText(condition, lookup) })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        {error === null ? null : <FormError>{error}</FormError>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11.5px] text-subtle">{dirty ? m.rules_editor_unsaved_hint() : null}</p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (dirty) setDiscarding(true);
                else onClose();
              }}
            >
              {m.settings_cancel()}
            </Button>
            <Button pending={saving} disabled={!dirty && rule !== null} onClick={() => void save()}>
              {error === null ? m.rules_editor_save() : m.rules_editor_retry()}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={m.rules_editor_discard_title()}
        description={m.rules_editor_discard_body()}
        confirmLabel={m.rules_editor_discard()}
        cancelLabel={m.rules_editor_keep()}
        variant="destructive"
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
      />
    </div>
  );
}
