// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Record sheet's "Bayar dari tujuan …" (FR-G4, design 13 `itVPf`): offered on an expense that looks paid for a
 * goal (its tag, or its name in the description) or opened from the goal ("Pakai dana"). "Pakai dana tujuan" pays it
 * with the goal's money: the goal becomes "Terpakai" instead of counting down, and what is left can be moved to another
 * goal once saved; "Catat sebagai pengeluaran biasa" records a plain expense.
 */
import type { GoalView } from '@wf/db/goals';
import { payFromGoal } from '@wf/domain/goals';
import { ratioBps } from '@wf/domain/budget';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { Check, PiggyBank } from 'lucide-react';
import { RichMessage } from '../rich-message.tsx';

export interface GoalUseFieldProps {
  readonly goal: GoalView;
  /** The typed expense amount, in the goal's currency; `null` while empty. */
  readonly amountMinor: bigint | null;
  /** "Pakai dana tujuan" is on. */
  readonly using: boolean;
  readonly locale: Locale;
  readonly onUse: () => void;
  /** "Catat sebagai pengeluaran biasa". */
  readonly onPlain: () => void;
}

export function GoalUseField({ goal, amountMinor, using, locale, onUse, onPlain }: GoalUseFieldProps) {
  const progress = ratioBps(goal.savedMinor, goal.targetMinor);
  const payment = amountMinor === null || amountMinor <= 0n ? null : payFromGoal(goal.savedMinor, amountMinor);
  return (
    <section
      aria-label={m.record_goal_title({ name: goal.name })}
      className={`flex flex-col gap-2.5 rounded-[10px] border p-3 ${using ? 'border-violet bg-violet-tint-1' : 'border-border'}`}
    >
      <h3 className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-fg">
        <PiggyBank aria-hidden="true" className="size-4 text-violet" />
        {m.record_goal_title({ name: goal.name })}
        <span className="rounded-[5px] bg-violet-tint-2 px-1.5 py-px text-[11px] font-normal text-violet">
          {progress === null ? null : <Percent value={progress / 10_000} locale={locale} />}
          {' · '}
          <Money minor={goal.savedMinor} currency={goal.currency} context="amount" locale={locale} />
        </span>
      </h3>
      <p className="text-[12.5px] text-text-secondary">
        {m.record_goal_description()}
        {payment === null ? null : payment.fromFreeMinor > 0n ? (
          <>
            {' '}
            <RichMessage
              message={m.record_goal_beyond}
              slots={{
                amount: (
                  <Money minor={payment.fromFreeMinor} currency={goal.currency} context="amount" locale={locale} />
                ),
              }}
            />
          </>
        ) : payment.leftoverMinor > 0n ? (
          <>
            {' '}
            <RichMessage
              message={m.record_goal_leftover}
              slots={{
                amount: (
                  <Money minor={payment.leftoverMinor} currency={goal.currency} context="amount" locale={locale} />
                ),
              }}
            />
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={using}
          onClick={onUse}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-3 text-[12.5px] font-medium text-fg hover:bg-muted aria-pressed:border-violet aria-pressed:bg-violet-tint-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {using ? <Check aria-hidden="true" className="size-3.5" /> : null}
          {m.record_goal_use()}
        </button>
        <button
          type="button"
          aria-pressed={!using}
          onClick={onPlain}
          className="inline-flex h-8 items-center rounded-[8px] px-3 text-[12.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          {m.record_goal_plain()}
        </button>
      </div>
    </section>
  );
}
