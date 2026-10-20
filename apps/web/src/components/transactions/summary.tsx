// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Transactions page summary (FR-L1, design `t7l0Cj`; filtered `NCqkQ`/`h26Rk`): Masuk and Keluar of the rows the
 * filters select, Transfer shown but "tidak dihitung" (moving money between own accounts is neither income nor
 * spending), and the daily spending chart with its average.
 */
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import type { TransactionsView } from '../../server/fn/transactions.ts';
import { usePreferences } from '../preferences.tsx';
import { DailyChart } from './daily-chart.tsx';
import { SignedMoney } from './transaction-row.tsx';

export interface TransactionSummaryProps {
  readonly view: TransactionsView;
  readonly currency: string;
}

const CARD = 'flex min-w-0 flex-col gap-1.5 px-5 py-4';
const LABEL = 'flex items-center gap-2 text-[12.5px] text-muted-fg';

export function TransactionSummary({ view, currency }: TransactionSummaryProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const { summary } = view;
  // "rata-rata Rp1.100.000" (16.500.000 / 15): per day so far, not per day of the whole period.
  const elapsed = summary.dailySpend.filter((day) => day.date <= view.today);
  const averageMinor =
    elapsed.length === 0 ? 0n : elapsed.reduce((sum, day) => sum + day.outMinor, 0n) / BigInt(elapsed.length);
  return (
    <section
      aria-label={m.transactions_summary_label()}
      className="grid grid-cols-2 divide-border overflow-hidden rounded-[12px] border border-border bg-card lg:grid-cols-4 lg:divide-x"
    >
      <div className={CARD}>
        <h2 className={LABEL}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-green" />
          {m.transactions_summary_in()}
        </h2>
        <SignedMoney
          amountMinor={summary.inMinor}
          currency={currency}
          locale={locale}
          className="text-[20px] font-semibold"
        />
        <p className="text-[12px] text-subtle">{m.transactions_summary_count({ count: summary.inCount })}</p>
      </div>
      <div className={CARD}>
        <h2 className={LABEL}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-red" />
          {m.transactions_summary_out()}
        </h2>
        <Money
          minor={-summary.outMinor}
          currency={currency}
          context="amount"
          locale={locale}
          className="text-[20px] font-semibold text-fg"
        />
        <p className="text-[12px] text-subtle">{m.transactions_summary_count({ count: summary.outCount })}</p>
      </div>
      <div className={CARD}>
        <h2 className={LABEL}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-subtle" />
          {m.transactions_summary_transfer()}
        </h2>
        <Money
          minor={summary.transferMinor}
          currency={currency}
          context="amount"
          locale={locale}
          className="text-[20px] font-semibold text-fg"
        />
        <p className="text-[12px] text-subtle">
          {m.transactions_summary_transfer_note({ count: summary.transferCount })}
        </p>
      </div>
      <div className={`${CARD} gap-2`}>
        <h2 className="flex items-center justify-between gap-2 text-[12.5px] text-muted-fg">
          {m.transactions_summary_daily()}
          <span className="font-mono text-[11px] text-subtle">
            {m.transactions_summary_average()}{' '}
            <Money minor={averageMinor} currency={currency} context="amount" locale={locale} />
          </span>
        </h2>
        <DailyChart days={summary.dailySpend} averageMinor={averageMinor} currency={currency} today={view.today} />
      </div>
    </section>
  );
}
