// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The budget seen from the Record Transaction sheet and the Quick Add bar: FR-T2's note beside a category in the
 * picker ("sisa Rp300.000", "lewat Rp400.000", "akan lewat Rp…" once the typed amount would exceed what is left) and
 * FR-T3's impact line ("Anggaran Transportasi jadi 73% · Rp1.460.000 / 2.000.000").
 */
import type { BudgetLineView } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import { ratioBps, willExceedBy } from '@wf/domain/budget';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { PiggyBank } from 'lucide-react';
import type { ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { RichMessage } from '../rich-message.tsx';

/** The current period's budget lines, by category, and their currency (the base currency). */
export interface BudgetLookup {
  readonly lines: readonly BudgetLineView[];
  readonly currency: string;
}

function BudgetLineNote({
  line,
  typedMinor,
  currency,
  locale,
}: {
  line: BudgetLineView;
  typedMinor: bigint;
  currency: string;
  locale: Locale;
}) {
  const exceedMinor = willExceedBy({
    limitMinor: line.limitMinor,
    spentMinor: line.spentMinor,
    typedMinor,
    scheduledMinor: 0n,
  });
  const [tone, message, valueMinor] =
    line.remainingMinor < 0n
      ? (['text-red-fg', m.budget_line_over, -line.remainingMinor] as const)
      : exceedMinor > 0n
        ? (['text-amber-fg', m.budget_line_will_exceed, exceedMinor] as const)
        : (['', m.budget_line_left, line.remainingMinor] as const);
  return (
    <span className={tone}>
      <RichMessage
        message={message}
        slots={{ amount: <Money minor={valueMinor} currency={currency} context="amount" locale={locale} /> }}
      />
    </span>
  );
}

/**
 * The picker's `budgetNote` for `budget` (FR-T2), or `undefined` without a budget. `typedMinor` is the amount being
 * entered in the base currency (`0n` when unknown).
 */
export function budgetNotes(
  budget: BudgetLookup | undefined,
  typedMinor: bigint,
  locale: Locale,
): ((category: CategoryView) => ReactNode) | undefined {
  if (budget === undefined) return undefined;
  const byId = new Map(budget.lines.map((line) => [line.categoryId, line]));
  return (category) => {
    const line = byId.get(category.id);
    return line === undefined ? null : (
      <span className="text-[11.5px] text-subtle">
        <BudgetLineNote line={line} typedMinor={typedMinor} currency={budget.currency} locale={locale} />
      </span>
    );
  };
}

/** FR-T3 "Anggaran Transportasi jadi 73% · Rp1.460.000 / 2.000.000"; nothing without a line or an amount. */
export function BudgetImpact({
  budget,
  categoryId,
  typedMinor,
  locale,
}: {
  budget: BudgetLookup | undefined;
  categoryId: string | null;
  /** In the base currency; `null` when unknown (no amount, or another currency). */
  typedMinor: bigint | null;
  locale: Locale;
}) {
  const line = budget?.lines.find((candidate) => candidate.categoryId === categoryId);
  if (budget === undefined || line === undefined || typedMinor === null || typedMinor <= 0n) return null;
  const afterMinor = line.spentMinor + typedMinor;
  const usedBps = ratioBps(afterMinor, line.limitMinor);
  const over = afterMinor > line.limitMinor;
  return (
    <p
      className={`flex items-center gap-2 rounded-[10px] border px-3 py-2.5 text-[12.5px] ${over ? 'border-red-tint-3 bg-red-tint-1 text-red-fg' : 'border-border bg-surface-2 text-text-secondary'}`}
    >
      <PiggyBank aria-hidden="true" className="size-3.5 shrink-0" />
      <span>
        <RichMessage
          message={m.record_budget_impact}
          slots={{
            name: categoryName(line),
            used: usedBps === null ? '—' : <Percent value={usedBps / 10_000} locale={locale} className="text-fg" />,
            spent: (
              <Money
                minor={afterMinor}
                currency={budget.currency}
                context="amount"
                locale={locale}
                className="text-fg"
              />
            ),
            limit: (
              <Money
                minor={line.limitMinor}
                currency={budget.currency}
                context="table"
                locale={locale}
                className="!inline"
              />
            ),
          }}
        />
      </span>
    </p>
  );
}
