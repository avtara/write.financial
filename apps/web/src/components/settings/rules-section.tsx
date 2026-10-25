// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Aturan otomatis (FR-AI1, design HXDL7/RjTTZ/h7hnWe): the real list with active/inactive counts, the
 * explicit order (up/down, keyboard friendly), enable/disable, edit/delete, "Aturan baru", the suggestions from manual
 * corrections with "Buat aturan" / "Abaikan", and "Terapkan ke transaksi lama" (a confirmed backfill). Counts are the
 * user's actual rows, never the design's example numbers. The editor replaces this list inside the Settings dialog.
 */
import type { AccountView } from '@wf/db/accounts';
import type { RuleSuggestion } from '@wf/db/auto-rules';
import type { AutoRuleView } from '@wf/domain/rules';
import type { CategoryView } from '@wf/db/categories';
import type { TagView } from '@wf/db/tags';
import type { AutoRuleDefinition } from '@wf/domain/rules';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { Switch } from '@wf/ui/switch';
import { toast } from '@wf/ui/toast';
import { ArrowDown, ArrowUp, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { deleteAutoRule, dismissRuleSuggestion, reorderAutoRules, setAutoRuleEnabled } from '../../server/fn/rules.ts';
import { Button } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { RuleBackfillDialog } from './backfill-dialog.tsx';
import { RuleEditor } from './rule-editor.tsx';
import { actionsSummary, conditionsSummary, ruleCategoryName, type RuleLookup } from './rules-format.ts';
import { Badge, SettingsGroup, SettingsRow } from './settings-ui.tsx';

export interface RulesSectionProps {
  readonly rules: readonly AutoRuleView[];
  readonly categories: readonly CategoryView[];
  readonly tags: readonly TagView[];
  readonly suggestions: readonly RuleSuggestion[];
  readonly accounts: readonly AccountView[];
  readonly timeZone: string;
}

interface Editing {
  readonly initial: AutoRuleDefinition;
  readonly rule: AutoRuleView | null;
  readonly suggestionKey?: string;
}

const blank = (): AutoRuleDefinition => ({
  name: '',
  enabled: true,
  conditions: [{ field: 'description', op: 'containsAny', values: [] }],
  actions: [],
});

export function RulesSection({ rules, categories, tags, suggestions, accounts, timeZone }: RulesSectionProps) {
  const router = useRouter();
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<AutoRuleView | null>(null);
  const [backfill, setBackfill] = useState<readonly string[] | null | undefined>(undefined);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const lookup: RuleLookup = { categories, accounts, locale };
  const active = rules.filter((rule) => rule.enabled).length;
  const inactive = rules.length - active;
  const enabled = rules.filter((rule) => rule.enabled);

  const invalidate = () => {
    void router.invalidate();
  };

  const run = async (
    key: string,
    call: () => Promise<{ ok: true; value: unknown } | { ok: false; code: string }>,
    done?: () => void,
  ): Promise<boolean> => {
    setBusy((current) => new Set([...current, key]));
    const result = await call().catch(() => null);
    setBusy((current) => new Set([...current].filter((entry) => entry !== key)));
    if (result === null || !result.ok) {
      toast({
        tone: 'error',
        title: m.rules_action_failed(),
        description: result === null ? undefined : ledgerErrorMessage(result.code, locale),
      });
      return false;
    }
    done?.();
    invalidate();
    return true;
  };

  const move = (index: number, offset: number) => {
    // The buttons exist only for rows with a neighbour on that side.
    const next = [...rules];
    const target = next[index] as AutoRuleView;
    const swap = next[index + offset] as AutoRuleView;
    next[index] = swap;
    next[index + offset] = target;
    void run(
      'reorder',
      () => reorderAutoRules({ data: { ids: next.map((rule) => rule.id) } }),
      () => undefined,
    );
  };

  const backfillDialog = (
    <RuleBackfillDialog
      open={backfill !== undefined}
      // The dialog has no trigger of its own: every change request closes it.
      onOpenChange={() => {
        setBackfill(undefined);
      }}
      {...(backfill === null || backfill === undefined ? {} : { ruleIds: backfill })}
      categories={categories}
      accounts={accounts}
    />
  );

  const editor = (() => {
    if (editing === null) return null;
    const ruleId = editing.rule?.id;
    const applyPast =
      ruleId === undefined
        ? undefined
        : () => {
            setBackfill([ruleId]);
          };
    return (
      <RuleEditor
        initial={editing.initial}
        rule={editing.rule}
        {...(editing.suggestionKey === undefined ? {} : { suggestionKey: editing.suggestionKey })}
        categories={categories}
        accounts={accounts}
        tags={tags}
        timeZone={timeZone}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
        {...(applyPast === undefined ? {} : { onApplyPast: applyPast })}
      />
    );
  })();

  if (editor !== null)
    return (
      <>
        {editor}
        {backfillDialog}
      </>
    );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] text-muted-fg">{m.rules_list_description()}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Badge>{m.rules_active_count({ count: active })}</Badge>
        <span className="inline-flex h-5 items-center rounded-full bg-surface-3 px-2 text-[11px] font-medium text-muted-fg">
          {m.rules_inactive_count({ count: inactive })}
        </span>
        <span className="min-w-2 flex-1" />
        <Button
          variant="secondary"
          size="sm"
          disabled={enabled.length === 0}
          onClick={() => {
            setBackfill(null);
          }}
        >
          {m.rules_apply_past()}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setEditing({ initial: blank(), rule: null });
          }}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {m.rules_new()}
        </Button>
      </div>

      {suggestions.length === 0 ? null : (
        <SettingsGroup label={m.rules_suggestions_title()}>
          {suggestions.map((suggestion) => (
            <SettingsRow
              key={suggestion.key}
              title={
                <span className="flex items-center gap-1.5">
                  <Sparkles aria-hidden="true" className="size-3.5 text-amber-fg" />
                  {suggestion.label}
                </span>
              }
              description={m.rules_suggestion_text({
                count: suggestion.count,
                label: suggestion.label,
                from: ruleCategoryName(lookup, suggestion.fromCategoryId),
                to: ruleCategoryName(lookup, suggestion.toCategoryId),
              })}
            >
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  pending={busy.has(`suggest-${suggestion.key}`)}
                  onClick={() => {
                    setEditing({
                      initial: {
                        name: suggestion.label,
                        enabled: true,
                        conditions: [{ field: 'description', op: 'containsAny', values: [suggestion.label] }],
                        actions: [{ type: 'setCategory', categoryId: suggestion.toCategoryId }],
                      },
                      rule: null,
                      suggestionKey: suggestion.key,
                    });
                  }}
                >
                  {m.rules_suggestion_create()}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  pending={busy.has(`ignore-${suggestion.key}`)}
                  onClick={() => {
                    void run(
                      `ignore-${suggestion.key}`,
                      () => dismissRuleSuggestion({ data: { key: suggestion.key } }),
                      () => toast({ tone: 'info', title: m.rules_suggestion_ignored() }),
                    );
                  }}
                >
                  {m.rules_suggestion_ignore()}
                </Button>
              </div>
            </SettingsRow>
          ))}
        </SettingsGroup>
      )}

      {rules.length === 0 ? (
        <p className="rounded-[10px] border border-border bg-surface-sunken px-3.5 py-4 text-[12.5px] text-muted-fg">
          {m.rules_empty()}
        </p>
      ) : (
        <SettingsGroup label={m.rules_list_title()}>
          {rules.map((rule, index) => (
            <div key={rule.id} className="flex items-start gap-3 px-3.5 py-[11px]" data-rule={rule.id}>
              <span className="mt-0.5 inline-flex h-6 w-7 shrink-0 items-center justify-center rounded-[6px] bg-surface-3 text-[11px] font-medium text-muted-fg">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-fg">{rule.name}</span>
                  <span
                    className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium ${
                      rule.enabled ? 'bg-green-tint-2 text-green-fg' : 'bg-surface-3 text-muted-fg'
                    }`}
                  >
                    {rule.enabled ? m.rules_enabled() : m.rules_disabled()}
                  </span>
                </div>
                <p className="text-[12px] text-subtle">{conditionsSummary(rule.conditions, lookup)}</p>
                <p className="text-[12px] text-subtle">{actionsSummary(rule.actions, lookup)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={m.rules_move_up({ name: rule.name })}
                  disabled={index === 0 || busy.has('reorder')}
                  onClick={() => {
                    move(index, -1);
                  }}
                  className="flex size-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                >
                  <ArrowUp aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={m.rules_move_down({ name: rule.name })}
                  disabled={index === rules.length - 1 || busy.has('reorder')}
                  onClick={() => {
                    move(index, 1);
                  }}
                  className="flex size-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                >
                  <ArrowDown aria-hidden="true" className="size-3.5" />
                </button>
                <Switch
                  label={<span className="sr-only">{m.rules_toggle({ name: rule.name })}</span>}
                  checked={rule.enabled}
                  disabled={busy.has(`toggle-${rule.id}`)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    void run(`toggle-${rule.id}`, () =>
                      setAutoRuleEnabled({ data: { id: rule.id, enabled: checked } }),
                    );
                  }}
                />
                <button
                  type="button"
                  aria-label={m.rules_edit({ name: rule.name })}
                  onClick={() => {
                    setEditing({
                      initial: {
                        name: rule.name,
                        enabled: rule.enabled,
                        conditions: rule.conditions,
                        actions: rule.actions,
                      },
                      rule,
                    });
                  }}
                  className="flex size-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Pencil aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={m.rules_delete({ name: rule.name })}
                  onClick={() => {
                    setDeleting(rule);
                  }}
                  className="flex size-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-red-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </SettingsGroup>
      )}

      <ConfirmDialog
        open={deleting !== null}
        // AlertDialog only reports closing here (Escape, Cancel, a click outside).
        onOpenChange={() => {
          setDeleting(null);
        }}
        title={m.rules_delete_title()}
        description={m.rules_delete_body({ name: deleting?.name ?? '' })}
        confirmLabel={m.rules_delete_confirm()}
        cancelLabel={m.settings_cancel()}
        variant="destructive"
        onConfirm={() => {
          // The dialog only opens with a rule.
          const target = deleting as AutoRuleView;
          setDeleting(null);
          void run(`delete-${target.id}`, () => deleteAutoRule({ data: { id: target.id } }));
        }}
      />

      {backfillDialog}
    </div>
  );
}
