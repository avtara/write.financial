// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pisah transaksi" (FR-L5, design `GJppz`): an expense or income becomes parts with their own category, description,
 * and amount; they must add up to the total ("Sisa Rp0 · pas"). Tags and attachments go with every part. For an
 * expense in the current period the dialog previews each budget the split changes ("Hobi Rp400.000 → Rp465.000 /
 * Rp500.000"). Splitting can be undone from the toast.
 */
import type { BudgetStatus } from '@wf/db/budgets';
import type { TransactionDetail } from '@wf/db/transactions';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Info, Plus, Split, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import { getBudgetStatus } from '../../server/fn/budget.ts';
import { MAX_SPLIT_PARTS } from '../../lib/transaction-limits.ts';
import { splitTransaction } from '../../server/fn/transactions.ts';
import { Button, FormError, INPUT_FRAME, TextInput } from '../form.tsx';
import { CategorySelect } from '../ledger/category-picker.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { actionRowOf } from './action-row.ts';

export interface SplitPartDraft {
  readonly key: number;
  readonly categoryId: string | null;
  readonly description: string;
  readonly amountMinor: bigint | null;
}

/** The parts with `total` shared equally, the remainder on the first part ("Bagi rata"). */
export function evenParts(total: bigint, parts: readonly SplitPartDraft[]): SplitPartDraft[] {
  const share = total / BigInt(parts.length);
  return parts.map((part, index) => ({
    ...part,
    amountMinor: index === 0 ? total - share * BigInt(parts.length - 1) : share,
  }));
}

/**
 * Budget lines the split changes: per category, the spending now and after (the original category loses the total,
 * every part's category gains its amount). Only categories with a budget line whose spending changes.
 */
export function budgetImpact(
  status: BudgetStatus,
  original: { readonly categoryId: string | null; readonly amountMinor: bigint },
  parts: readonly SplitPartDraft[],
): { categoryId: string; limitMinor: bigint; beforeMinor: bigint; afterMinor: bigint }[] {
  const delta = new Map<string, bigint>();
  if (original.categoryId !== null) delta.set(original.categoryId, -original.amountMinor);
  for (const part of parts) {
    if (part.categoryId === null || part.amountMinor === null) continue;
    delta.set(part.categoryId, (delta.get(part.categoryId) ?? 0n) + part.amountMinor);
  }
  return status.lines.flatMap((line) => {
    const change = delta.get(line.categoryId) ?? 0n;
    return change === 0n
      ? []
      : [
          {
            categoryId: line.categoryId,
            limitMinor: line.limitMinor,
            beforeMinor: line.spentMinor,
            afterMinor: line.spentMinor + change,
          },
        ];
  });
}

export interface SplitDialogProps {
  readonly detail: TransactionDetail;
  readonly ledger: LedgerData;
  readonly onClose: () => void;
  /** After splitting, with the number of parts. */
  readonly onSplit: (parts: number) => Promise<void>;
}

export function SplitDialog({ detail, ledger, onClose, onSplit }: SplitDialogProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const row = actionRowOf(detail);
  const total = row.amountMinor < 0n ? -row.amountMinor : row.amountMinor;
  const kind = detail.type === 'income' ? 'income' : 'expense';
  const account = ledger.accounts.find((candidate) => candidate.id === row.accountId);
  const [parts, setParts] = useState<SplitPartDraft[]>(() => [
    { key: 0, categoryId: detail.categoryId, description: detail.description ?? '', amountMinor: total },
    { key: 1, categoryId: null, description: '', amountMinor: null },
  ]);
  const [nextKey, setNextKey] = useState(2);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [clientId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (kind !== 'expense') return;
    let live = true;
    void getBudgetStatus({ data: {} }).then((result) => {
      if (
        live &&
        result.ok &&
        result.value.period.start <= detail.localDate &&
        detail.localDate <= result.value.period.end
      ) {
        setBudget(result.value);
      }
    });
    return () => {
      live = false;
    };
  }, [kind, detail.localDate]);

  const assigned = parts.reduce((sum, part) => sum + (part.amountMinor ?? 0n), 0n);
  const remaining = total - assigned;
  // The parts as the server takes them, once each has an amount above zero and a category.
  const ready = parts.flatMap((part) =>
    part.amountMinor !== null && part.amountMinor > 0n && part.categoryId !== null
      ? [
          {
            amountMinor: part.amountMinor,
            categoryId: part.categoryId,
            description: part.description.trim() === '' ? null : part.description.trim(),
          },
        ]
      : [],
  );
  const complete = remaining === 0n && ready.length === parts.length;
  const update = (key: number, patch: Partial<SplitPartDraft>) => {
    setParts((current) => current.map((part) => (part.key === key ? { ...part, ...patch } : part)));
  };
  const impact =
    budget === null ? [] : budgetImpact(budget, { categoryId: detail.categoryId, amountMinor: total }, parts);

  // Only reachable through the submit button, which is disabled until `complete` and while pending.
  const submit = async () => {
    setPending(true);
    setFailure(null);
    const result = await splitTransaction({ data: { id: detail.id, clientId, parts: ready } });
    setPending(false);
    if (!result.ok) {
      setFailure(ledgerErrorMessage(result.code, locale));
      return;
    }
    await onSplit(parts.length);
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={m.transactions_split_title()}
      description={[
        [detail.merchant, detail.description].filter((text) => text !== null && text !== '').join(' — '),
        formatDate(detail.localDate, locale, 'weekday'),
        account?.displayName,
      ]
        .filter((text) => text !== undefined && text !== '')
        .join(' · ')}
      size="xl"
    >
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[12px] text-muted-fg">{m.transactions_split_total()}</span>
          <Money
            minor={row.amountMinor}
            currency={row.currency}
            context="amount"
            locale={locale}
            className="text-[20px] font-semibold text-fg"
          />
        </div>
        <span
          role="status"
          className={`rounded-[6px] px-2 py-1 font-mono text-[11.5px] ${remaining === 0n ? 'bg-green-tint-2 text-green-fg' : 'bg-amber-tint-2 text-amber-fg'}`}
        >
          {remaining === 0n ? (
            m.transactions_split_exact()
          ) : remaining > 0n ? (
            <>
              {m.transactions_split_left()}{' '}
              <Money minor={remaining} currency={row.currency} context="amount" locale={locale} />
            </>
          ) : (
            <>
              {m.transactions_split_over()}{' '}
              <Money minor={-remaining} currency={row.currency} context="amount" locale={locale} />
            </>
          )}
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {parts.map((part, index) => (
          <li key={part.key} className="flex items-center gap-2">
            <span className="w-4 text-right font-mono text-[11.5px] text-subtle">{index + 1}</span>
            <CategorySelect
              categories={ledger.categories}
              kind={kind}
              value={part.categoryId}
              onValueChange={(categoryId) => {
                update(part.key, { categoryId });
              }}
              label={m.transactions_split_category({ index: index + 1 })}
              aria-label={m.transactions_split_category({ index: index + 1 })}
              searchPlaceholder={m.category_picker_search()}
              placeholder={m.transactions_split_category_placeholder()}
              className="h-9 w-[170px] shrink-0 rounded-[8px] px-2.5 text-[13px]"
            />
            <div className="min-w-0 flex-1">
              <TextInput
                size="sm"
                value={part.description}
                maxLength={200}
                aria-label={m.transactions_split_description({ index: index + 1 })}
                placeholder={m.transactions_split_description_placeholder()}
                onChange={(event) => {
                  update(part.key, { description: event.currentTarget.value });
                }}
                className="h-9"
              />
            </div>
            <div className="w-[130px] shrink-0">
              <div className={`${INPUT_FRAME.sm} h-9`}>
                <AmountInput
                  size="inline"
                  value={part.amountMinor}
                  onValueChange={(amountMinor) => {
                    update(part.key, { amountMinor });
                  }}
                  currency={row.currency}
                  locale={locale}
                  aria-label={m.transactions_split_amount({ index: index + 1 })}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={parts.length <= 2}
              aria-label={m.transactions_split_remove({ index: index + 1 })}
              onClick={() => {
                setParts((current) => current.filter((candidate) => candidate.key !== part.key));
              }}
              className="flex size-7 items-center justify-center rounded-[6px] text-subtle hover:bg-tint-06 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={parts.length >= MAX_SPLIT_PARTS}
          onClick={() => {
            setParts((current) => [
              ...current,
              { key: nextKey, categoryId: null, description: '', amountMinor: remaining > 0n ? remaining : null },
            ]);
            setNextKey(nextKey + 1);
          }}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {m.transactions_split_add()}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setParts((current) => evenParts(total, current));
          }}
        >
          {m.transactions_split_even()}
        </Button>
      </div>
      <p className="flex items-start gap-2 rounded-[8px] bg-tint-06 px-3 py-2 text-[12px] text-muted-fg">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {detail.attachments.length > 0 ? m.transactions_split_note_attachments() : m.transactions_split_note()}
      </p>
      {impact.length === 0 ? null : (
        <section aria-label={m.transactions_split_impact()} className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium text-subtle uppercase">{m.transactions_split_impact()}</h3>
          <ul className="flex flex-col gap-1">
            {impact.map((line) => {
              const category = ledger.categories.find((candidate) => candidate.id === line.categoryId);
              return (
                <li key={line.categoryId} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="text-muted-fg">{category === undefined ? null : categoryName(category)}</span>
                  <span className="flex items-center gap-1.5 text-fg">
                    <Money minor={line.beforeMinor} currency={row.currency} context="amount" locale={locale} />
                    <span aria-hidden="true">→</span>
                    <Money
                      minor={line.afterMinor}
                      currency={row.currency}
                      context="amount"
                      locale={locale}
                      className={line.afterMinor > line.limitMinor ? 'font-semibold text-red-fg' : 'font-semibold'}
                    />
                    <span className="text-subtle">
                      / <Money minor={line.limitMinor} currency={row.currency} context="amount" locale={locale} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
          {m.record_cancel()}
        </Button>
        <Button
          size="sm"
          disabled={!complete}
          pending={pending}
          onClick={() => {
            void submit();
          }}
        >
          <Split aria-hidden="true" className="size-3.5" />
          {m.transactions_split_submit({ count: parts.length })}
        </Button>
      </div>
    </Modal>
  );
}
