// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Investasi" (FR-I1–I5, FR-G2/G5/G6; design 09): the header with the price status, the IDR/USD toggle and
 * "Catat transaksi investasi", the price fallback notice, the KPI strip, growth and allocation, the holdings table,
 * the rebalancing calculator, dividends and platforms, the asset detail panel, and every dialog. Each change goes
 * through a server function and reloads the route's data; nothing on the page writes a rebalancing trade.
 */
import { useRouter } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { AssetView } from '@wf/db/investments';
import type { GoalAssetSource } from '@wf/domain/goal-assets';
import type { AssetClass } from '@wf/domain/investments';
import type { YearMonth } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { EmptyState } from '@wf/ui/empty-state';
import { Money } from '@wf/ui/money';
import { toast } from '@wf/ui/toast';
import { CandlestickChart, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import {
  adjustInvestmentHoldings,
  createInvestmentAsset,
  moveInvestmentAsset,
  recordInvestmentTrade,
  removeInvestmentAsset,
  setAllocationTargets,
  setAssetGoals,
  updateInvestmentAsset,
  type InvestmentsOverview,
} from '../../server/fn/investments.ts';
import { Button } from '../form.tsx';
import { wallTime, zonedInstant } from '../ledger/transaction-draft.ts';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { AllocationCard } from './allocation-card.tsx';
import { AdjustDialog, AssetGoalsDialog, MoveDialog, type AdjustDraft } from './asset-dialogs.tsx';
import { AssetDetail } from './asset-detail.tsx';
import { AssetForm, type AssetDraft } from './asset-form.tsx';
import { GrowthCard } from './growth-card.tsx';
import { HoldingsTable, type AssetAction } from './holdings-table.tsx';
import { DividendsCard, PlatformsCard } from './income-cards.tsx';
import { InvestmentKpis } from './investment-kpis.tsx';
import { growthPoints, isHeld, priceMinor, quoteStatus, toUsd, type DisplayCurrency } from './investments-model.ts';
import { PriceFallback, PriceStatusPill } from './price-status.tsx';
import { RebalanceCard } from './rebalance-card.tsx';
import { TargetsDialog } from './targets-dialog.tsx';
import { TradeSheet, type TradeDraft, type TradeTab } from './trade-sheet.tsx';

export interface InvestmentsPageProps {
  readonly overview: InvestmentsOverview;
  readonly accounts: readonly AccountView[];
  readonly timeZone: string;
}

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };

export function InvestmentsPage({ overview, accounts, timeZone }: InvestmentsPageProps) {
  const router = useRouter();
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const { portfolio, rates } = overview;
  const base = portfolio.baseCurrency;
  const usdRate = rates.USD ?? null;
  const [display, setDisplay] = useState<DisplayCurrency>('base');
  const [refreshing, setRefreshing] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [trade, setTrade] = useState<{ tab: TradeTab; assetId: string | null; accountId?: string } | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [goalsId, setGoalsId] = useState<string | null>(null);
  const [form, setForm] = useState<{ asset: AssetView | null } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const byId = (id: string | null) => portfolio.assets.find((asset) => asset.id === id) ?? null;
  const status = quoteStatus(portfolio.assets);
  const held = portfolio.assets.filter(isHeld);
  const points = growthPoints(overview.snapshots, {
    month: portfolio.today.slice(0, 7) as YearMonth,
    valueMinor: portfolio.summary.valueBaseMinor,
    costMinor: portfolio.summary.costBaseMinor,
  });

  const refresh = async () => {
    setRefreshing(true);
    await router.invalidate();
    setRefreshing(false);
  };

  /** Runs a change: the error's message (for the form) on failure, else `success`, a reload, and `null`. */
  const run = async <T,>(pending: Promise<Result<T>>, success: (value: T) => void): Promise<string | null> => {
    const result = await pending.catch(() => null);
    if (result === null) return m.invest_save_failed();
    if (!result.ok) return ledgerErrorMessage(result.code, locale);
    success(result.value);
    await router.invalidate();
    return null;
  };

  const occurredAt = (date: TradeDraft['date']) => zonedInstant(date, wallTime(new Date(), timeZone), timeZone);

  const recordTrade = (draft: TradeDraft) => {
    const common = { clientId: draft.clientId, occurredAt: occurredAt(draft.date) };
    const data =
      draft.kind === 'cash_topup'
        ? {
            kind: draft.kind,
            ...common,
            accountId: draft.accountId,
            fromAccountId: draft.fromAccountId,
            sentMinor: draft.sentMinor,
            receivedMinor: draft.receivedMinor,
          }
        : draft.kind === 'dividend'
          ? {
              kind: draft.kind,
              ...common,
              assetId: draft.assetId,
              amountMinor: draft.amountMinor,
              feeMinor: draft.feeMinor,
              taxMinor: draft.taxMinor,
              ...(draft.fxRate === null ? {} : { fxRate: draft.fxRate }),
              mode: draft.mode,
              ...(draft.units === null ? {} : { units: draft.units }),
              accountId: draft.accountId,
            }
          : {
              ...common,
              ...(draft.kind === 'buy'
                ? { kind: draft.kind, pending: draft.pending }
                : { kind: draft.kind, proceedsAccountId: draft.proceedsAccountId, reduceGoalId: draft.reduceGoalId }),
              assetId: draft.assetId,
              units: draft.units,
              price: draft.price,
              amountMinor: draft.amountMinor,
              feeMinor: draft.feeMinor,
              taxMinor: draft.taxMinor,
              ...(draft.fxRate === null ? {} : { fxRate: draft.fxRate }),
            };
    return run(recordInvestmentTrade({ data }), () => {
      setTrade(null);
      toast({ tone: 'success', title: m.invest_toast_trade() });
    });
  };

  const adjust = (draft: AdjustDraft) =>
    run(
      adjustInvestmentHoldings({
        data: {
          clientId: draft.clientId,
          assetId: draft.assetId,
          occurredAt: new Date(),
          units: draft.units,
          reason: draft.reason,
          ...(draft.amountMinor === null ? {} : { amountMinor: draft.amountMinor }),
          price: draft.price,
          ...(draft.fxRate === null ? {} : { fxRate: draft.fxRate }),
          reduceGoalId: draft.reduceGoalId,
        },
      }),
      () => {
        setAdjustId(null);
        toast({ tone: 'success', title: m.invest_toast_adjusted() });
      },
    );

  const saveAsset = (draft: AssetDraft) => {
    const fields = {
      symbol: draft.symbol,
      name: draft.name,
      assetClass: draft.assetClass,
      market: draft.market,
      categoryId: draft.categoryId,
      priceMode: draft.priceMode,
      manualPrice: draft.manualPrice,
      manualPriceAt: draft.manualPrice === null ? null : new Date(),
    };
    const editing = form?.asset ?? null;
    return run(
      editing === null
        ? createInvestmentAsset({ data: { accountId: draft.accountId as string, ...fields } })
        : updateInvestmentAsset({ data: { id: editing.id, patch: fields } }),
      () => {
        setForm(null);
        toast({ tone: 'success', title: m.invest_toast_asset_saved({ symbol: draft.symbol }) });
      },
    );
  };

  const onAction = (action: AssetAction, asset: AssetView) => {
    if (action === 'detail') setDetailId(asset.id);
    else if (action === 'buy' || action === 'sell' || action === 'dividend')
      setTrade({ tab: action, assetId: asset.id });
    else if (action === 'adjust') setAdjustId(asset.id);
    else if (action === 'targets') setTargetsOpen(true);
    else if (action === 'move') setMoveId(asset.id);
    else if (action === 'goals') setGoalsId(asset.id);
    else if (action === 'edit') setForm({ asset });
    else setRemoveId(asset.id);
  };

  const header = (
    <PageHeader
      breadcrumb={[m.breadcrumb_finance(), m.invest_title()]}
      title={m.invest_title()}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {m.invest_header_counts({ positions: held.length, platforms: portfolio.platforms.length })}
          {usdRate === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              {m.invest_rate_usd()}{' '}
              <Money minor={priceMinor(usdRate, base)} currency={base} context="amount" locale={locale} />
            </>
          )}
          <PriceStatusPill status={status} today={portfolio.today} timeZone={timeZone} locale={locale} />
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {usdRate === null ? null : (
            <div
              role="group"
              aria-label={m.invest_display()}
              className="flex items-center gap-0.5 rounded-[8px] border border-border p-0.5"
            >
              {(['base', 'usd'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={display === option}
                  onClick={() => {
                    setDisplay(option);
                  }}
                  className="h-7 rounded-[6px] px-2.5 font-mono text-[12px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted aria-pressed:text-fg"
                >
                  {option === 'base' ? base : 'USD'}
                </button>
              ))}
            </div>
          )}
          <Button variant="secondary" pending={refreshing} onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" className="size-3.5" />
            {m.invest_sync()}
          </Button>
          <Button
            onClick={() => {
              setTrade({ tab: 'buy', assetId: null });
            }}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {m.invest_record()}
          </Button>
        </div>
      }
    />
  );

  const dialogs = (
    <>
      <AssetForm
        open={form}
        platforms={portfolio.platforms}
        categories={portfolio.categories}
        locale={locale}
        onOpenChange={(open) => {
          if (!open) setForm(null);
        }}
        onSubmit={saveAsset}
      />
      <TradeSheet
        open={trade}
        onOpenChange={(open) => {
          if (!open) setTrade(null);
        }}
        portfolio={portfolio}
        accounts={accounts}
        rates={rates}
        today={portfolio.today}
        locale={locale}
        onSubmit={recordTrade}
      />
    </>
  );

  if (portfolio.assets.length === 0) {
    return (
      <>
        {header}
        <section className="rounded-[12px] border border-border bg-card">
          <EmptyState
            icon={CandlestickChart}
            title={m.invest_empty_title()}
            description={m.invest_empty_description()}
            actions={
              <Button
                onClick={() => {
                  setForm({ asset: null });
                }}
                disabled={portfolio.platforms.length === 0}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                {m.invest_add_asset()}
              </Button>
            }
            note={portfolio.platforms.length === 0 ? m.invest_empty_no_platform() : m.invest_empty_note()}
          />
        </section>
        {dialogs}
      </>
    );
  }

  return (
    <>
      {header}
      <PriceFallback
        status={status}
        today={portfolio.today}
        timeZone={timeZone}
        locale={locale}
        retrying={refreshing}
        onRetry={() => void refresh()}
      />
      <InvestmentKpis portfolio={portfolio} display={display} usdRate={usdRate} locale={locale} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <GrowthCard
          points={points}
          benchmarks={overview.benchmarks}
          currency={display === 'usd' && usdRate !== null ? 'USD' : base}
          convert={(minor) => (display === 'usd' && usdRate !== null ? toUsd(minor, base, usdRate) : minor)}
          locale={locale}
        />
        <AllocationCard
          portfolio={portfolio}
          locale={locale}
          onEditTargets={() => {
            setTargetsOpen(true);
          }}
        />
      </div>
      <HoldingsTable
        portfolio={portfolio}
        display={display}
        usdRate={usdRate}
        locale={locale}
        onAction={onAction}
        onTopUp={(accountId) => {
          setTrade({ tab: 'cash_topup', assetId: null, accountId });
        }}
        onAddAsset={() => {
          setForm({ asset: null });
        }}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RebalanceCard
          portfolio={portfolio}
          rates={rates}
          locale={locale}
          onEditTargets={() => {
            setTargetsOpen(true);
          }}
        />
        <DividendsCard portfolio={portfolio} locale={locale} />
        <PlatformsCard portfolio={portfolio} locale={locale} />
      </div>
      <AssetDetail
        asset={byId(detailId)}
        portfolio={portfolio}
        timeZone={timeZone}
        locale={locale}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onAction={(action, asset) => {
          setDetailId(null);
          onAction(action, asset);
        }}
      />
      {dialogs}
      <TargetsDialog
        open={targetsOpen}
        onOpenChange={setTargetsOpen}
        portfolio={portfolio}
        locale={locale}
        onSubmit={(targets: Partial<Record<AssetClass, number>>) =>
          run(setAllocationTargets({ data: { targets } }), () => {
            setTargetsOpen(false);
            toast({ tone: 'success', title: m.invest_toast_targets() });
          })
        }
      />
      <AdjustDialog
        asset={byId(adjustId)}
        rate={(() => {
          const asset = byId(adjustId);
          return asset === null ? null : (rates[asset.quoteCurrency] ?? null);
        })()}
        base={base}
        locale={locale}
        onOpenChange={(open) => {
          if (!open) setAdjustId(null);
        }}
        onSubmit={adjust}
        onSell={(asset) => {
          setAdjustId(null);
          setTrade({ tab: 'sell', assetId: asset.id });
        }}
      />
      <MoveDialog
        asset={byId(moveId)}
        categories={portfolio.categories}
        onOpenChange={(open) => {
          if (!open) setMoveId(null);
        }}
        onSubmit={(asset, categoryId) =>
          run(moveInvestmentAsset({ data: { assetId: asset.id, categoryId } }), () => {
            setMoveId(null);
            toast({ tone: 'success', title: m.invest_toast_moved({ symbol: asset.symbol }) });
          })
        }
      />
      <AssetGoalsDialog
        asset={byId(goalsId)}
        goals={overview.goals}
        base={base}
        locale={locale}
        onOpenChange={(open) => {
          if (!open) setGoalsId(null);
        }}
        onSubmit={(asset, sources: readonly GoalAssetSource[]) =>
          run(
            setAssetGoals({
              data: {
                assetId: asset.id,
                sources: sources.map((source) =>
                  source.mode === 'whole'
                    ? { goalId: source.goalId, mode: source.mode }
                    : { goalId: source.goalId, mode: source.mode, pctBps: source.bps },
                ),
              },
            }),
            () => {
              setGoalsId(null);
              toast({ tone: 'success', title: m.invest_toast_goals({ symbol: asset.symbol }) });
            },
          )
        }
      />
      <ConfirmDialog
        open={removeId !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveId(null);
        }}
        title={m.invest_remove_title({ symbol: byId(removeId)?.symbol ?? '' })}
        description={m.invest_remove_description()}
        confirmLabel={m.invest_menu_remove()}
        cancelLabel={m.invest_cancel()}
        variant="destructive"
        onConfirm={() => {
          const asset = byId(removeId);
          setRemoveId(null);
          if (asset === null) return;
          void run(removeInvestmentAsset({ data: { id: asset.id } }), () => {
            toast({ tone: 'success', title: m.invest_toast_removed({ symbol: asset.symbol }) });
          }).then((failed) => {
            if (failed !== null) toast({ tone: 'error', title: failed });
          });
        }}
      />
    </>
  );
}
