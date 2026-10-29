// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-G5 in the Record sheet (design 13 `BGCD8`): an expense paid from an account a goal holds wholly reduces that goal
 * ("Bank Jago seluruhnya untuk Dana Darurat · Pengeluaran ini mengurangi tujuan: Rp11.125.000 → Rp10.640.000 (21% →
 * 20%)"), with "Pakai {another account}" and "Tetap dari {account}".
 */
import type { AccountView } from '@wf/db/accounts';
import type { GoalView } from '@wf/db/goals';
import { ratioBps } from '@wf/domain/budget';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { ArrowLeftRight, PiggyBank } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../form.tsx';

export interface AllocatedAccountWarningProps {
  readonly goals: readonly GoalView[];
  readonly accounts: readonly AccountView[];
  readonly accountId: string | null;
  /** Only expenses reduce a goal. */
  readonly expense: boolean;
  readonly amountMinor: bigint | null;
  readonly locale: Locale;
  readonly onSwitch: (accountId: string) => void;
}

/** The goal holding `accountId` wholly, if any. */
function holderOf(goals: readonly GoalView[], accountId: string): GoalView | undefined {
  return goals.find(
    (goal) =>
      goal.status === 'active' &&
      goal.sources.some((source) => source.mode === 'whole' && source.accountId === accountId),
  );
}

export function AllocatedAccountWarning({
  goals,
  accounts,
  accountId,
  expense,
  amountMinor,
  locale,
  onSwitch,
}: AllocatedAccountWarningProps) {
  const [kept, setKept] = useState<string | null>(null);
  if (!expense || accountId === null || kept === accountId) return null;
  const goal = holderOf(goals, accountId);
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (goal === undefined || account === undefined) return null;
  const spent = amountMinor ?? 0n;
  const after = goal.savedMinor - (spent > goal.savedMinor ? goal.savedMinor : spent);
  const beforeBps = ratioBps(goal.savedMinor, goal.targetMinor);
  const afterBps = ratioBps(after, goal.targetMinor);
  const other = accounts.find(
    (candidate) =>
      candidate.id !== accountId &&
      candidate.status === 'active' &&
      candidate.currency === account.currency &&
      candidate.type !== 'credit_card' &&
      candidate.type !== 'investment' &&
      holderOf(goals, candidate.id) === undefined,
  );
  return (
    <section
      role="status"
      aria-label={m.record_allocated_label()}
      className="flex flex-col gap-2 rounded-[10px] border border-amber-tint-3 bg-amber-tint-1 p-3"
    >
      <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
        <PiggyBank aria-hidden="true" className="size-4 text-amber-fg" />
        {m.record_allocated_title({ account: account.displayName, goal: goal.name })}
      </p>
      <p className="text-[12.5px] text-muted-fg">
        {m.record_allocated_reduces()}{' '}
        <Money minor={goal.savedMinor} currency={goal.currency} context="amount" locale={locale} /> →{' '}
        <Money minor={after} currency={goal.currency} context="amount" locale={locale} />
        {beforeBps === null || afterBps === null ? null : (
          <>
            {' '}
            (<Percent value={beforeBps / 10_000} locale={locale} /> →{' '}
            <Percent value={afterBps / 10_000} locale={locale} />)
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {other === undefined ? null : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onSwitch(other.id);
            }}
          >
            <ArrowLeftRight aria-hidden="true" className="size-3.5" />
            {m.record_allocated_switch({ account: other.displayName })}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setKept(accountId);
          }}
        >
          {m.record_allocated_keep({ account: account.displayName })}
        </Button>
      </div>
    </section>
  );
}
