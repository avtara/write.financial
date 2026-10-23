// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Kalkulator rebalancing" (FR-I3, design 09 `bgmSP`): the buys and sells per asset class that bring every class to
 * its target, optionally investing "Dana tambahan", in rupiah with the dollar reference for classes held in USD
 * ("≈ Rp1.860.000 · +US$113,76"). Suggestions only: nothing here records a transaction.
 */
import type { PortfolioView } from '@wf/db/investments';
import type { AssetClass } from '@wf/domain/investments';
import { rebalance, type RebalanceTrade } from '@wf/domain/valuation';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Money } from '@wf/ui/money';
import { useState } from 'react';
import { Button, Field, INPUT_FRAME } from '../form.tsx';
import { CLASS_TONE, classLabel, priceMinor, rebalanceItems } from './investments-model.ts';

export interface RebalanceCardProps {
  readonly portfolio: PortfolioView;
  readonly rates: Readonly<Record<string, string>>;
  readonly locale: Locale;
  readonly onEditTargets: () => void;
}

export function RebalanceCard({ portfolio, rates, locale, onEditTargets }: RebalanceCardProps) {
  const [extra, setExtra] = useState<bigint | null>(null);
  const base = portfolio.baseCurrency;
  const items = rebalanceItems(portfolio, rates);
  const result =
    items.length === 0 ? null : rebalance(items, portfolio.targets, base, extra !== null && extra > 0n ? extra : 0n);
  const usd = rates.USD;
  const row = (trade: RebalanceTrade) => {
    const item = items.find((candidate) => candidate.key === trade.key);
    return (
      <li key={trade.key} className="flex items-center gap-2 py-1.5 text-[12.5px]">
        <span aria-hidden="true" className={`size-2 rounded-full ${CLASS_TONE[trade.key as AssetClass].dot}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-fg">{classLabel(trade.key as AssetClass)}</span>
        {trade.quoteMinor === null || item?.quote == null ? (
          <Money minor={trade.amountMinor} currency={base} context="delta" locale={locale} />
        ) : (
          <>
            <span className="text-[11.5px] text-subtle">
              {m.invest_approx()}{' '}
              <Money
                minor={trade.amountMinor < 0n ? -trade.amountMinor : trade.amountMinor}
                currency={base}
                context="amount"
                locale={locale}
              />
            </span>
            <Money minor={trade.quoteMinor} currency={item.quote.currency} context="delta" locale={locale} />
          </>
        )}
      </li>
    );
  };
  const buys = result?.trades.filter((trade) => trade.amountMinor > 0n) ?? [];
  const sells = result?.trades.filter((trade) => trade.amountMinor < 0n) ?? [];
  return (
    <section
      aria-labelledby="invest-rebalance"
      className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-border bg-card px-5 py-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="invest-rebalance" className="text-[15px] font-semibold text-fg">
          {m.invest_rebalance_title()}
        </h2>
        <p className="text-[12.5px] text-muted-fg">
          {m.invest_rebalance_subtitle()}
          {usd === undefined ? null : (
            <>
              {' · '}
              {m.invest_rate_usd()}{' '}
              <Money minor={priceMinor(usd, base)} currency={base} context="amount" locale={locale} />
            </>
          )}
        </p>
      </div>
      {result === null ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[12.5px] text-muted-fg">{m.invest_rebalance_no_targets()}</p>
          <Button size="sm" variant="secondary" onClick={onEditTargets}>
            {m.invest_allocation_edit()}
          </Button>
        </div>
      ) : (
        <>
          <Field label={m.invest_rebalance_extra()} aside={m.invest_optional()}>
            {({ id }) => (
              <div className={INPUT_FRAME.sm}>
                <AmountInput
                  id={id}
                  value={extra}
                  onValueChange={setExtra}
                  currency={base}
                  locale={locale}
                  size="inline"
                />
              </div>
            )}
          </Field>
          {result.trades.length === 0 ? (
            <p className="text-[12.5px] text-muted-fg">{m.invest_rebalance_balanced()}</p>
          ) : (
            <>
              {/* `rebalance` returns trades only for classes that move: with no negative extra money, any
                  non-empty result has at least one buy. */}
              <div>
                <h3 className="text-[11px] font-medium tracking-[0.04em] text-subtle uppercase">
                  {m.invest_rebalance_buy()}
                </h3>
                <ul>{buys.map(row)}</ul>
              </div>
              {sells.length === 0 ? null : (
                <div>
                  <h3 className="text-[11px] font-medium tracking-[0.04em] text-subtle uppercase">
                    {m.invest_rebalance_sell()}
                  </h3>
                  <ul>{sells.map(row)}</ul>
                </div>
              )}
            </>
          )}
          <div className="mt-auto flex flex-col gap-0.5 rounded-[10px] border border-border px-3 py-2.5">
            <span className="text-[12.5px] text-fg">
              {m.invest_rebalance_total_buy()}{' '}
              <Money minor={result.buyMinor} currency={base} context="amount" locale={locale} /> ·{' '}
              {m.invest_rebalance_total_sell()}{' '}
              <Money minor={result.sellMinor} currency={base} context="amount" locale={locale} />
            </span>
            <span className="text-[11.5px] text-subtle">{m.invest_rebalance_note()}</span>
          </div>
        </>
      )}
    </section>
  );
}
