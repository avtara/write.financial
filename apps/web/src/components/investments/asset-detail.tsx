// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An asset's detail panel (FR-I4, design 09 `CtiSh` / `DZkbW`): value, units, current and average price with the
 * price's source and time, cost and gain, its class against the target, the goals it funds ("DP Rumah · 60% · 0,718
 * unit · ikut DCA") with today's price impact on them (FR-G5), the buy / DCA history, and the dividends.
 */
import type { AssetView, PortfolioView, TradeView } from '@wf/db/investments';
import { ratioBps } from '@wf/domain/budget';
import { goalImpact } from '@wf/domain/goal-assets';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { PageState } from '@wf/ui/page-state';
import { Percent } from '@wf/ui/percent';
import { Sheet } from '@wf/ui/sheet';
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Scale, TrendingDown } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getAssetTrades } from '../../server/fn/investments.ts';
import { Button } from '../form.tsx';
import type { AssetAction } from './holdings-table.tsx';
import { ChangeChip } from './investment-kpis.tsx';
import { assetSources, CLASS_TONE, classLabel, formatUnits, priceMinor, quoteLabel } from './investments-model.ts';
import { quoteTime } from './price-status.tsx';

type Trades =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly trades: readonly TradeView[] };

export interface AssetDetailProps {
  /** `null`: closed. */
  readonly asset: AssetView | null;
  readonly portfolio: PortfolioView;
  readonly timeZone: string;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAction: (action: AssetAction, asset: AssetView) => void;
}

export function AssetDetail({ asset, portfolio, timeZone, locale, onOpenChange, onAction }: AssetDetailProps) {
  return (
    <Sheet
      open={asset !== null}
      onOpenChange={onOpenChange}
      title={asset === null ? '' : `${asset.symbol} · ${asset.name}`}
      description={asset === null ? undefined : `${asset.platformName} · ${asset.quoteCurrency}`}
      closeLabel={m.invest_close()}
      size="lg"
      footer={
        asset === null ? undefined : (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                onAction('buy', asset);
              }}
            >
              <ArrowDownToLine aria-hidden="true" className="size-3.5" />
              {m.invest_menu_buy()}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={asset.holding.units === '0'}
              onClick={() => {
                onAction('sell', asset);
              }}
            >
              <ArrowUpFromLine aria-hidden="true" className="size-3.5" />
              {m.invest_menu_sell()}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onAction('adjust', asset);
              }}
            >
              <Scale aria-hidden="true" className="size-3.5" />
              {m.invest_menu_adjust()}
            </Button>
          </div>
        )
      }
    >
      {asset === null ? null : (
        <DetailBody asset={asset} portfolio={portfolio} timeZone={timeZone} locale={locale} onAction={onAction} />
      )}
    </Sheet>
  );
}

function Section({ title, aside, children }: { readonly title: string; readonly aside?: ReactNode; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium tracking-[0.04em] text-subtle uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-border p-2.5">
      <dt className="text-[11.5px] text-subtle">{label}</dt>
      <dd className="flex flex-col text-[13px] font-medium text-fg">{children}</dd>
    </div>
  );
}

function DetailBody({
  asset,
  portfolio,
  timeZone,
  locale,
  onAction,
}: Omit<AssetDetailProps, 'asset' | 'onOpenChange'> & { readonly asset: AssetView }) {
  const key = `${asset.id}:${asset.holding.units}:${String(asset.holding.dividendMinor)}`;
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly trades: Trades } | null>(null);
  const trades: Trades = loaded?.key === key ? loaded.trades : { status: 'loading' };
  const base = portfolio.baseCurrency;
  const { value, quote } = asset;
  const money = (minor: bigint, currency = base, context: 'amount' | 'delta' = 'amount', className = '') => (
    <Money minor={minor} currency={currency} context={context} locale={locale} className={className} />
  );
  const classRow = portfolio.allocation?.rows.find((row) => row.key === asset.assetClass);
  const before = value === null || value.todayBaseMinor === null ? null : value.valueBaseMinor - value.todayBaseMinor;
  const dayBps = before === null || value === null ? null : ratioBps(value.todayBaseMinor ?? 0n, before);
  const impact =
    before === null || value === null || asset.goals.length === 0 || (value.todayBaseMinor ?? 0n) >= 0n
      ? []
      : goalImpact(before, value.valueBaseMinor, assetSources(asset));

  useEffect(() => {
    let current = true;
    void getAssetTrades({ data: { assetId: asset.id } }).then(
      (result) => {
        if (!current) return;
        setLoaded({
          key,
          trades: result.ok
            ? { status: 'ready', trades: result.value }
            : { status: 'failed', message: ledgerErrorMessage(result.code, locale) },
        });
      },
      () => {
        if (current) setLoaded({ key, trades: { status: 'failed', message: m.invest_trades_failed() } });
      },
    );
    return () => {
      current = false;
    };
  }, [key, asset.id, locale]);

  const buys = trades.status === 'ready' ? trades.trades.filter((trade) => trade.kind === 'buy').reverse() : [];
  const dividends = trades.status === 'ready' ? trades.trades.filter((trade) => trade.kind === 'dividend').reverse() : [];
  const others =
    trades.status === 'ready'
      ? trades.trades.filter((trade) => trade.kind === 'sell' || trade.kind === 'adjust').reverse()
      : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[12px] text-muted-fg">
          <span aria-hidden="true" className={`size-1.5 rounded-full ${CLASS_TONE[asset.assetClass].dot}`} />
          {classLabel(asset.assetClass)}
        </span>
        {value === null ? (
          <span className="text-[13px] text-amber-fg">{m.invest_detail_no_rate({ currency: asset.quoteCurrency })}</span>
        ) : (
          <div className="flex flex-wrap items-baseline gap-2">
            {money(value.valueBaseMinor, base, 'amount', 'text-[26px] font-medium tracking-[-0.5px] text-fg')}
            {asset.quoteCurrency === base ? null : (
              <span className="text-[13px] text-subtle">{money(value.valueMinor, asset.quoteCurrency)}</span>
            )}
            {ratioBps(value.valueBaseMinor, portfolio.summary.valueBaseMinor) === null ? null : (
              <Percent
                value={(ratioBps(value.valueBaseMinor, portfolio.summary.valueBaseMinor) as number) / 10_000}
                locale={locale}
                className="text-[13px] text-subtle"
              />
            )}
          </div>
        )}
        {asset.pendingMinor > 0n ? (
          <span className="text-[12px] text-blue-fg">
            {m.invest_detail_pending()} {money(asset.pendingMinor, asset.quoteCurrency)}
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={m.invest_detail_units()}>
          <span className="font-mono">{formatUnits(asset.holding.units, locale)}</span>
        </Stat>
        <Stat label={m.invest_detail_price()}>
          {quote === null ? (
            <span className="text-amber-fg">{m.invest_at_cost()}</span>
          ) : (
            <>
              {money(priceMinor(quote.price, asset.quoteCurrency), asset.quoteCurrency)}
              <span className="text-[11px] font-normal text-subtle">
                {quoteLabel(quote.label)} · {quoteTime(quote, portfolio.today, timeZone, locale)}
              </span>
            </>
          )}
        </Stat>
        <Stat label={m.invest_detail_average()}>
          {asset.averagePrice === null ? '—' : money(priceMinor(asset.averagePrice, asset.quoteCurrency), asset.quoteCurrency)}
        </Stat>
        <Stat label={m.invest_detail_cost()}>{money(asset.holding.costBaseMinor)}</Stat>
        <Stat label={m.invest_detail_gain()}>
          {value === null ? (
            '—'
          ) : (
            <>
              {money(value.gainBaseMinor, base, 'delta')}
              {value.gainBps === null ? null : (
                <Percent value={value.gainBps / 10_000} signed locale={locale} className="text-[11px] font-normal text-subtle" />
              )}
            </>
          )}
        </Stat>
        <Stat label={m.invest_detail_today()}>
          {dayBps === null ? <span className="text-subtle">—</span> : <ChangeChip bps={dayBps} locale={locale} />}
        </Stat>
      </dl>

      <p className="text-[12px] text-subtle">
        {quote === null
          ? m.invest_detail_source_none()
          : m.invest_detail_source({
              source: quote.provider ?? quoteLabel(quote.label),
              time: quoteTime(quote, portfolio.today, timeZone, locale),
            })}
      </p>

      {classRow === undefined ? null : (
        <Section title={m.invest_detail_class_vs_target()}>
          <p className="flex items-center justify-between text-[12.5px] text-muted-fg">
            <span>
              {classLabel(asset.assetClass)} <Percent value={classRow.shareBps / 10_000} locale={locale} className="text-fg" />
            </span>
            <span>
              {m.invest_holdings_target()} <Percent value={classRow.targetBps / 10_000} locale={locale} />
            </span>
          </p>
          <svg aria-hidden="true" viewBox="0 0 100 6" preserveAspectRatio="none" className="block h-1.5 w-full">
            <rect width="100" height="6" rx="3" className="fill-surface-3" />
            <rect width={Math.min(classRow.shareBps / 100, 100)} height="6" rx="3" className={CLASS_TONE[asset.assetClass].fill} />
            <rect x={Math.min(classRow.targetBps / 100, 99)} width="1" height="6" className="fill-fg" />
          </svg>
        </Section>
      )}

      <Section
        title={m.invest_detail_goals()}
        aside={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onAction('goals', asset);
            }}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
            {m.invest_detail_goals_edit()}
          </Button>
        }
      >
        {asset.goals.length === 0 ? (
          <p className="text-[12.5px] text-muted-fg">{m.invest_detail_goals_empty()}</p>
        ) : (
          <ul className="flex flex-col rounded-[10px] border border-border">
            {asset.goals.map((goal) => (
              <li key={goal.sourceId} className="flex items-center gap-3 border-b border-border p-3 last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-fg">{goal.goalName}</span>
                  <span className="text-[11.5px] text-subtle">
                    {goal.mode === 'whole' ? m.invest_detail_goal_whole() : <Percent value={goal.bps / 10_000} locale={locale} />} ·{' '}
                    {m.invest_detail_goal_units({ units: formatUnits(goal.units, locale, 3) })} · {m.invest_detail_goal_dca()}
                  </span>
                </span>
                {money(goal.valueBaseMinor, base, 'amount', 'text-[13px] text-fg')}
              </li>
            ))}
            <li className="flex items-center gap-3 p-3">
              <span className="flex-1 text-[12.5px] text-muted-fg">
                {m.invest_detail_goal_free()} <Percent value={asset.freeBps / 10_000} locale={locale} />
              </span>
              {money(
                (value?.valueBaseMinor ?? 0n) + asset.pendingBaseMinor - asset.goals.reduce((sum, goal) => sum + goal.valueBaseMinor, 0n),
                base,
                'amount',
                'text-[13px] text-subtle',
              )}
            </li>
          </ul>
        )}
        {impact.length === 0 || dayBps === null ? null : (
          <p className="flex items-start gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12px] text-muted-fg">
            <TrendingDown aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-red-fg" />
            <span>
              {m.invest_detail_drop({ symbol: asset.symbol })} <Percent value={dayBps / 10_000} signed locale={locale} />{' '}
              ·{' '}
              {impact.map((entry, index) => (
                <span key={entry.goalId}>
                  {index === 0 ? null : ', '}
                  {asset.goals.find((goal) => goal.goalId === entry.goalId)?.goalName} {money(entry.deltaMinor, base, 'delta')}
                </span>
              ))}
            </span>
          </p>
        )}
      </Section>

      <Section title={m.invest_detail_buys()}>
        {trades.status === 'loading' ? (
          <PageState kind="loading" title={m.invest_trades_loading()} />
        ) : trades.status === 'failed' ? (
          <p role="alert" className="text-[12.5px] text-red-fg">
            {trades.message}
          </p>
        ) : buys.length === 0 ? (
          <p className="text-[12.5px] text-muted-fg">{m.invest_detail_buys_empty()}</p>
        ) : (
          <TradeList trades={buys} asset={asset} base={base} locale={locale} />
        )}
      </Section>

      {others.length === 0 ? null : (
        <Section title={m.invest_detail_other_trades()}>
          <TradeList trades={others} asset={asset} base={base} locale={locale} />
        </Section>
      )}

      <Section title={m.invest_detail_dividends()}>
        {asset.holding.dividendBaseMinor === 0n && dividends.length === 0 ? (
          <p className="text-[12.5px] text-muted-fg">{m.invest_detail_dividends_empty()}</p>
        ) : (
          <>
            <p className="text-[12.5px] text-muted-fg">
              {m.invest_detail_dividends_total()} {money(asset.holding.dividendBaseMinor, base, 'amount', 'text-fg')}
            </p>
            <TradeList trades={dividends} asset={asset} base={base} locale={locale} />
          </>
        )}
      </Section>
    </div>
  );
}

const KIND_LABELS = {
  buy: m.invest_trade_kind_buy,
  sell: m.invest_trade_kind_sell,
  dividend: m.invest_trade_kind_dividend,
  cash_topup: m.invest_trade_kind_topup,
  adjust: m.invest_trade_kind_adjust,
} as const;

function TradeList({
  trades,
  asset,
  base,
  locale,
}: {
  readonly trades: readonly TradeView[];
  readonly asset: AssetView;
  readonly base: string;
  readonly locale: Locale;
}) {
  return (
    <ul className="flex flex-col rounded-[10px] border border-border">
      {trades.map((trade) => (
        <li key={trade.id} className="flex items-center gap-3 border-b border-border p-3 last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2 text-[13px] text-fg">
              {formatDate(trade.localDate, locale, 'date')}
              <span className="rounded-[5px] border border-border px-1.5 py-px text-[10.5px] text-subtle">
                {trade.status === 'pending'
                  ? m.invest_pending()
                  : trade.kind === 'buy' && trade.localDate.endsWith('-01')
                    ? m.invest_trade_dca()
                    : KIND_LABELS[trade.kind]()}
              </span>
            </span>
            <span className="text-[11.5px] text-subtle">
              {trade.kind === 'dividend' ? (
                <>
                  {m.invest_trade_tax()} <Money minor={trade.taxMinor} currency={asset.quoteCurrency} context="amount" locale={locale} />
                </>
              ) : (
                <>
                  {m.invest_detail_goal_units({ units: formatUnits(trade.units, locale, 3) })}
                  {trade.price === null ? null : (
                    <>
                      {' @ '}
                      <Money minor={priceMinor(trade.price, asset.quoteCurrency)} currency={asset.quoteCurrency} context="amount" locale={locale} />
                    </>
                  )}
                </>
              )}
            </span>
          </span>
          <span className="flex flex-col items-end">
            <Money
              minor={trade.kind === 'dividend' ? trade.dividendMinor : trade.amountMinor}
              currency={asset.quoteCurrency}
              context="amount"
              locale={locale}
              className="text-[13px] text-fg"
            />
            {trade.kind === 'sell' && trade.realizedBaseMinor !== 0n ? (
              <Money minor={trade.realizedBaseMinor} currency={base} context="delta" locale={locale} className="text-[11px]" />
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
