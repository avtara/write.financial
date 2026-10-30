// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Transactions page summary (FR-L1, design `t7l0Cj`; filtered `NCqkQ`/`h26Rk`): Masuk and Keluar of the rows the
 * filters select, Transfer shown but "tidak dihitung" (moving money between own accounts is neither income nor
 * spending; filtered to accounts, split into what came into and went out of them), and the daily spending chart with
 * its average.
 */
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
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
      className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-border bg-card md:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,2fr)]"
    >
      <div className={`${CARD} border-border md:border-r`}>
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
      <div className={`${CARD} border-border md:border-r`}>
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
      <div className={`${CARD} border-border xl:border-r`}>
        <h2 className={LABEL}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-subtle" />
          {m.transactions_summary_transfer()}
        </h2>
        {summary.transferInMinor === null || summary.transferOutMinor === null ? (
          <Money
            minor={summary.transferMinor}
            currency={currency}
            context="amount"
            locale={locale}
            className="text-[20px] font-semibold text-fg"
          />
        ) : (
          // Filtered to accounts: what came into them and what went out, neither counted as In or Out.
          <dl className="flex flex-col gap-0.5 text-[13px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="flex items-center gap-1 text-muted-fg">
                <ArrowDownLeft aria-hidden="true" className="size-3.5" />
                {m.transactions_summary_transfer_in()}
              </dt>
              <dd className="font-mono text-[15px] font-semibold text-fg">
                {'+'}
                <Money minor={summary.transferInMinor} currency={currency} context="amount" locale={locale} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="flex items-center gap-1 text-muted-fg">
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
                {m.transactions_summary_transfer_out()}
              </dt>
              <dd className="font-mono text-[15px] font-semibold text-fg">
                <Money minor={-summary.transferOutMinor} currency={currency} context="amount" locale={locale} />
              </dd>
            </div>
          </dl>
        )}
        <p className="text-[12px] text-subtle">
          {m.transactions_summary_transfer_note({ count: summary.transferCount })}
        </p>
      </div>
      {/* Portrait tablets keep the three totals only (FR-TB3). */}
      <div
        className={`${CARD} col-span-2 gap-2 border-t border-border max-lg:hidden md:col-span-3 xl:col-span-1 xl:border-t-0`}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[12.5px] text-muted-fg">{m.transactions_summary_daily()}</h2>
          {/* The legend of the dashed average line in the chart. */}
          <p className="flex items-center gap-1.5 font-mono text-[11.5px] whitespace-nowrap text-subtle">
            <svg aria-hidden="true" viewBox="0 0 12 2" className="h-0.5 w-3 shrink-0">
              <line x1={0} x2={12} y1={1} y2={1} strokeDasharray="3 2" strokeWidth={1} className="stroke-muted-fg" />
            </svg>
            <span>
              {m.transactions_summary_average()}{' '}
              <Money minor={averageMinor} currency={currency} context="amount" locale={locale} />
            </span>
          </p>
        </div>
        <DailyChart days={summary.dailySpend} averageMinor={averageMinor} currency={currency} today={view.today} />
      </div>
    </section>
  );
}
