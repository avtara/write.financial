// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Terapkan ke transaksi lama" (FR-AI1): rules-backfill builds the list of proposed category/tag changes, shows the
 * original and proposed values, marks no-ops and blocked rows (closed period, unavailable category, too many tags,
 * managed rows), and changes nothing until the user selects rows and confirms. Every selected row carries the version
 * the preview showed, so a row changed meanwhile is skipped instead of overwritten, and a repeated confirmation
 * changes nothing. Amounts, postings, balances, and stored reports are untouched.
 */
import type { AccountView } from '@wf/db/accounts';
import type { RuleBackfillProposal, RuleBackfillResult } from '@wf/db/rule-backfill';
import type { CategoryView } from '@wf/db/categories';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { toast } from '@wf/ui/toast';
import { useEffect, useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { applyRuleBackfill, getRuleBackfillResult, requestRuleBackfill } from '../../server/fn/rules.ts';
import { Button, FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { pollRuleBackfill } from './backfill-poll.ts';
import { ruleCategoryName } from './rules-format.ts';

export interface RuleBackfillDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Only these rules (the editor's button); omitted = every enabled rule. */
  readonly ruleIds?: readonly string[];
  readonly categories: readonly CategoryView[];
  readonly accounts: readonly AccountView[];
}

const BLOCK_LABEL: Readonly<Record<NonNullable<RuleBackfillProposal['blocked']>, () => string>> = {
  closed_period: m.rules_block_closed,
  category_unavailable: m.rules_block_category,
  tag_limit: m.rules_block_tag_limit,
  managed: m.rules_block_managed,
};

/** The selectable rows: matched, changeable, not blocked. */
const changeable = (proposal: RuleBackfillProposal): boolean => proposal.blocked === null && !proposal.noop;

/** One poll interval of the worker job (the dialog stays on its preparing state meanwhile). */
async function waitForJob(): Promise<null> {
  const { promise, resolve } = Promise.withResolvers<null>();
  setTimeout(() => {
    resolve(null);
  }, 200);
  return promise;
}

export function RuleBackfillDialog({ open, onOpenChange, ruleIds, categories, accounts }: RuleBackfillDialogProps) {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const [items, setItems] = useState<readonly RuleBackfillProposal[] | null>(null);
  const [totals, setTotals] = useState<{
    matched: number;
    changes: number;
    noops: number;
    blocked: number;
  } | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [scope, setScope] = useState<readonly string[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<RuleBackfillResult | null>(null);

  const load = async (reset = false) => {
    if (reset) {
      setItems(null);
      setTotals(null);
      setScope([]);
      setVersion(null);
      setSelected(new Set());
      setApplied(null);
    }
    setError(null);
    const requested = await requestRuleBackfill({
      data: ruleIds === undefined ? {} : { ruleIds: [...ruleIds] },
    }).catch(() => null);
    if (requested === null || !requested.ok) {
      setError(requested === null ? m.rules_backfill_failed() : ledgerErrorMessage(requested.code, locale));
      return;
    }
    const outcome = await pollRuleBackfill(requested.value.jobId, {
      get: async (jobId) => {
        const polled = await getRuleBackfillResult({ data: { jobId } }).catch(() => null);
        if (polled === null) return { ok: false };
        if (!polled.ok) return { ok: false, code: polled.code };
        return polled.value.status === 'completed'
          ? { ok: true, value: { status: 'completed', preview: polled.value.preview } }
          : { ok: true, value: { status: polled.value.status } };
      },
      wait: waitForJob,
    });
    if (outcome.status !== 'completed') {
      setError(
        outcome.status === 'error' && outcome.code !== undefined
          ? ledgerErrorMessage(outcome.code, locale)
          : m.rules_backfill_failed(),
      );
      return;
    }
    const preview = outcome.preview;
    setItems(preview.proposals);
    setTotals(preview.totals);
    setTruncated(preview.truncated);
    setScope(preview.ruleIds);
    setVersion(preview.version);
    setSelected(new Set(preview.proposals.filter(changeable).map((proposal) => proposal.transactionId)));
  };

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      void load(true);
    });
    // `load` only starts a request and sets state; it re-runs when the dialog opens or its rules change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ruleIds?.join(','), locale]);

  const selectedItems = (items ?? []).filter(
    (proposal) => selected.has(proposal.transactionId) && changeable(proposal),
  );
  const lookup = { categories, accounts, locale };
  const allChangeable = (items ?? []).filter(changeable);
  const allSelected =
    allChangeable.length > 0 && allChangeable.every((proposal) => selected.has(proposal.transactionId));

  const apply = async () => {
    setConfirming(false);
    // The apply button only renders after a preview, which sets the version with the proposals.
    const expected = version as string;
    setApplying(true);
    const result = await applyRuleBackfill({
      data: {
        ruleIds: [...scope],
        version: expected,
        items: selectedItems.map((proposal) => ({
          transactionId: proposal.transactionId,
          version: proposal.version,
        })),
      },
    }).catch(() => null);
    setApplying(false);
    if (result === null || !result.ok) {
      toast({
        tone: 'error',
        title: m.rules_backfill_apply_failed(),
        description: result === null ? undefined : ledgerErrorMessage(result.code, locale),
      });
      return;
    }
    setApplied(result.value);
    toast({
      tone: 'success',
      title: m.rules_backfill_applied({ count: result.value.applied.length }),
      description:
        result.value.skipped.length === 0
          ? undefined
          : m.rules_backfill_skipped({ count: result.value.skipped.length }),
    });
    await load();
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={m.rules_backfill_title()}
      description={m.rules_backfill_description()}
    >
      {error !== null ? (
        <div className="flex flex-col gap-3">
          <FormError>{error}</FormError>
          <Button
            variant="secondary"
            onClick={() => {
              void load();
            }}
          >
            {m.rules_backfill_retry()}
          </Button>
        </div>
      ) : items === null || totals === null ? (
        <p role="status" className="text-[13px] text-muted-fg">
          {m.rules_backfill_loading()}
        </p>
      ) : (
        <div className="flex min-h-0 flex-col gap-3">
          <dl className="grid grid-cols-4 gap-2 text-center">
            {[
              [m.rules_backfill_total_matched(), totals.matched],
              [m.rules_backfill_total_changes(), totals.changes],
              [m.rules_backfill_total_noops(), totals.noops],
              [m.rules_backfill_total_blocked(), totals.blocked],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[8px] border border-border bg-surface-sunken px-2 py-1.5">
                <dd className="text-[16px] font-semibold text-fg">{value}</dd>
                <dt className="text-[11px] text-subtle">{label}</dt>
              </div>
            ))}
          </dl>
          {truncated ? (
            <p role="status" className="text-[12px] text-amber-fg">
              {m.rules_backfill_truncated()}
            </p>
          ) : null}
          {applied !== null ? (
            <p
              role="status"
              className={`rounded-[8px] px-3 py-2 text-[12.5px] ${
                applied.rulesChanged ? 'bg-amber-tint-1 text-amber-fg' : 'bg-green-tint-1 text-green-fg'
              }`}
            >
              {applied.rulesChanged
                ? m.rules_backfill_rules_changed()
                : m.rules_backfill_result({
                    applied: applied.applied.length,
                    skipped: applied.skipped.length,
                  })}
            </p>
          ) : null}
          {items.length === 0 ? (
            <>
              <p className="rounded-[8px] border border-border bg-surface-sunken px-3 py-4 text-[13px] text-muted-fg">
                {m.rules_backfill_empty()}
              </p>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    onOpenChange(false);
                  }}
                >
                  {m.rules_backfill_done()}
                </Button>
              </div>
            </>
          ) : (
            <>
              <label className="flex items-center gap-2 text-[12.5px] text-fg">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={allChangeable.length === 0}
                  onChange={(event) => {
                    setSelected(
                      event.currentTarget.checked
                        ? new Set(allChangeable.map((proposal) => proposal.transactionId))
                        : new Set(),
                    );
                  }}
                />
                {m.rules_backfill_select_all()}
              </label>
              <ul aria-label={m.rules_backfill_list()} className="flex max-h-[340px] flex-col overflow-y-auto">
                {items.map((proposal) => {
                  const blocked = proposal.blocked === null ? null : BLOCK_LABEL[proposal.blocked]();
                  const status = blocked ?? (proposal.noop ? m.rules_backfill_noop() : null);
                  return (
                    <li
                      key={proposal.transactionId}
                      className="flex items-start gap-2 border-b border-border py-2 text-[12.5px]"
                    >
                      <input
                        type="checkbox"
                        aria-label={proposal.description ?? m.rules_backfill_list()}
                        checked={selected.has(proposal.transactionId) && changeable(proposal)}
                        disabled={!changeable(proposal)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(proposal.transactionId);
                            else next.delete(proposal.transactionId);
                            return next;
                          });
                        }}
                        className="mt-1"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-fg">
                          <span className="min-w-0 truncate">{proposal.description ?? m.rules_untitled()}</span>
                          <span className="text-[11px] text-subtle">
                            {formatDate(proposal.localDate, locale, 'day')}
                          </span>
                          <span className="text-[11px] text-subtle">{proposal.ruleName}</span>
                        </p>
                        <p className="flex flex-wrap items-baseline gap-x-1.5 text-muted-fg">
                          <span className="text-[11px] uppercase">{m.rules_backfill_current()}</span>
                          <span>{ruleCategoryName(lookup, proposal.currentCategoryId)}</span>
                          {proposal.currentTags.map((tag) => (
                            <span key={tag} className="font-mono text-[11px]">
                              #{tag}
                            </span>
                          ))}
                          <span aria-hidden="true">→</span>
                          <span className="text-[11px] uppercase">{m.rules_backfill_proposed()}</span>
                          <span>{ruleCategoryName(lookup, proposal.proposedCategoryId)}</span>
                          {proposal.proposedTags.map((tag) => (
                            <span key={tag} className="font-mono text-[11px]">
                              #{tag}
                            </span>
                          ))}
                        </p>
                        {status === null ? null : (
                          <p className={blocked === null ? 'text-[11px] text-subtle' : 'text-[11px] text-amber-fg'}>
                            {status}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    onOpenChange(false);
                  }}
                >
                  {m.rules_backfill_done()}
                </Button>
                <Button
                  pending={applying}
                  disabled={selectedItems.length === 0}
                  onClick={() => {
                    setConfirming(true);
                  }}
                >
                  {m.rules_backfill_apply({ count: selectedItems.length })}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={m.rules_backfill_confirm_title()}
        description={m.rules_backfill_confirm_body({ count: selectedItems.length })}
        confirmLabel={m.rules_backfill_apply({ count: selectedItems.length })}
        cancelLabel={m.settings_cancel()}
        onConfirm={() => {
          void apply();
        }}
      />
    </Modal>
  );
}
