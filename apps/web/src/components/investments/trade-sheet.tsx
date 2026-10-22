// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Catat transaksi investasi" (FR-I2, design 09 `KDF13` / `JejMv`, goal choice `LcuPZ`): Beli (by amount or units,
 * paid from the platform's cash, fee, tax, rate), Jual (by value or a share of the position, proceeds kept as cash
 * or withdrawn to an account, realized gain; an asset held by two or more goals asks which goal is reduced, FR-G5),
 * Dividen (reinvested, kept as cash, or paid into an account), and Top-up kas. Price and rate start from the last
 * known quote; every figure previews through `@wf/domain/investments`.
 */
import type { AccountView } from '@wf/db/accounts';
import type { AssetView, PortfolioView } from '@wf/db/investments';
import { needsGoalChoice, sellAllocation, splitUnits } from '@wf/domain/goal-assets';
import { buyPreview, sellPreview, type BuyPreview, type DividendMode, type SellPreview } from '@wf/domain/investments';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { DatePicker } from '@wf/ui/date-picker';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { Select } from '@wf/ui/select';
import { Sheet } from '@wf/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wf/ui/tabs';
import { GitFork } from 'lucide-react';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { Button, Field, FormError, INPUT_FRAME, TextInput } from '../form.tsx';
import { assetSources, decimalInput, decimalText, formatUnits, isHeld } from './investments-model.ts';

export type TradeTab = 'buy' | 'sell' | 'dividend' | 'cash_topup';

interface DraftCommon {
  readonly clientId: string;
  readonly date: LocalDate;
}

/** What the form asks to record; the page adds the time of day. */
export type TradeDraft =
  | (DraftCommon & {
      readonly kind: 'buy';
      readonly assetId: string;
      readonly units: string;
      readonly price: string;
      readonly amountMinor: bigint;
      readonly feeMinor: bigint;
      readonly taxMinor: bigint;
      readonly fxRate: string | null;
      readonly pending: boolean;
    })
  | (DraftCommon & {
      readonly kind: 'sell';
      readonly assetId: string;
      readonly units: string;
      readonly price: string;
      readonly amountMinor: bigint;
      readonly feeMinor: bigint;
      readonly taxMinor: bigint;
      readonly fxRate: string | null;
      readonly proceedsAccountId: string | null;
      readonly reduceGoalId: string | null;
    })
  | (DraftCommon & {
      readonly kind: 'dividend';
      readonly assetId: string;
      readonly amountMinor: bigint;
      readonly feeMinor: bigint;
      readonly taxMinor: bigint;
      readonly fxRate: string | null;
      readonly mode: DividendMode;
      readonly units: string | null;
      readonly accountId: string | null;
    })
  | (DraftCommon & {
      readonly kind: 'cash_topup';
      readonly accountId: string;
      readonly fromAccountId: string;
      readonly sentMinor: bigint;
      readonly receivedMinor: bigint;
    });

export interface TradeSheetProps {
  /** `null`: closed. */
  readonly open: { readonly tab: TradeTab; readonly assetId: string | null; readonly accountId?: string } | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly portfolio: PortfolioView;
  readonly accounts: readonly AccountView[];
  readonly rates: Readonly<Record<string, string>>;
  readonly today: LocalDate;
  readonly locale: Locale;
  /** Records; answers an error message, or `null` once saved. */
  readonly onSubmit: (draft: TradeDraft) => Promise<string | null>;
}

export function TradeSheet({ open, onOpenChange, ...props }: TradeSheetProps) {
  return (
    <Sheet
      open={open !== null}
      onOpenChange={onOpenChange}
      title={m.invest_trade_title()}
      description={m.invest_trade_description()}
      closeLabel={m.invest_close()}
      size="lg"
    >
      {open === null ? null : (
        <TradeTabs
          key={`${open.tab}:${open.assetId ?? ''}:${open.accountId ?? ''}`}
          initial={open}
          onCancel={() => onOpenChange(false)}
          {...props}
        />
      )}
    </Sheet>
  );
}

type FormProps = Omit<TradeSheetProps, 'open' | 'onOpenChange'> & {
  readonly onCancel: () => void;
};

function TradeTabs({ initial, ...props }: FormProps & { readonly initial: NonNullable<TradeSheetProps['open']> }) {
  const [tab, setTab] = useState<TradeTab>(initial.tab);
  const held = props.portfolio.assets.filter(isHeld);
  const assetId = initial.assetId ?? held[0]?.id ?? props.portfolio.assets[0]?.id ?? null;
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value as TradeTab);
      }}
      className="flex flex-col gap-4"
    >
      <TabsList label={m.invest_trade_kind()} fill>
        <TabsTrigger value="buy">{m.invest_trade_kind_buy()}</TabsTrigger>
        <TabsTrigger value="sell">{m.invest_trade_kind_sell()}</TabsTrigger>
        <TabsTrigger value="dividend">{m.invest_trade_kind_dividend()}</TabsTrigger>
        <TabsTrigger value="cash_topup">{m.invest_trade_kind_topup()}</TabsTrigger>
      </TabsList>
      <TabsContent value="buy">
        <BuyForm assetId={assetId} {...props} />
      </TabsContent>
      <TabsContent value="sell">
        <SellForm assetId={assetId} {...props} />
      </TabsContent>
      <TabsContent value="dividend">
        <DividendForm assetId={assetId} {...props} />
      </TabsContent>
      <TabsContent value="cash_topup">
        <TopUpForm accountId={initial.accountId ?? null} {...props} />
      </TabsContent>
    </Tabs>
  );
}

/** Selected asset, its price text, fee, tax, rate, and date — shared by buy and sell. */
function useMarketFields(props: FormProps, assetId: string | null): MarketFields {
  const [selected, setSelected] = useState(assetId);
  const asset = props.portfolio.assets.find((candidate) => candidate.id === selected) ?? null;
  const startPrice = asset?.quote?.price ?? asset?.averagePrice ?? null;
  const [priceText, setPriceText] = useState(startPrice === null ? '' : decimalText(startPrice, props.locale));
  const [fee, setFee] = useState<bigint | null>(null);
  const [tax, setTax] = useState<bigint | null>(null);
  const foreign = asset !== null && asset.quoteCurrency !== props.portfolio.baseCurrency;
  const startRate = asset === null ? undefined : props.rates[asset.quoteCurrency];
  const [rateText, setRateText] = useState(startRate === undefined ? '' : decimalText(startRate, props.locale));
  const [date, setDate] = useState(props.today);
  const [clientId] = useState(() => crypto.randomUUID());
  const price = decimalInput(priceText, props.locale);
  const typedRate = decimalInput(rateText, props.locale);
  const rate = foreign ? (typedRate !== null && /^\d+(\.\d{1,8})?$/.test(typedRate) ? typedRate : null) : '1';
  const pick = (id: string) => {
    setSelected(id);
    const next = props.portfolio.assets.find((candidate) => candidate.id === id);
    const nextPrice = next?.quote?.price ?? next?.averagePrice ?? null;
    setPriceText(nextPrice === null ? '' : decimalText(nextPrice, props.locale));
    const nextRate = next === undefined ? undefined : props.rates[next.quoteCurrency];
    setRateText(nextRate === undefined ? '' : decimalText(nextRate, props.locale));
  };
  return { asset, pick, priceText, setPriceText, price, fee, setFee, tax, setTax, foreign, rateText, setRateText, rate, date, setDate, clientId };
}

interface MarketFields {
  readonly asset: AssetView | null;
  readonly pick: (id: string) => void;
  readonly priceText: string;
  readonly setPriceText: (text: string) => void;
  readonly price: string | null;
  readonly fee: bigint | null;
  readonly setFee: (value: bigint | null) => void;
  readonly tax: bigint | null;
  readonly setTax: (value: bigint | null) => void;
  readonly foreign: boolean;
  readonly rateText: string;
  readonly setRateText: (text: string) => void;
  readonly rate: string | null;
  readonly date: LocalDate;
  readonly setDate: (date: LocalDate) => void;
  readonly clientId: string;
}

function AssetField({ fields, assets }: { readonly fields: MarketFields; readonly assets: readonly AssetView[] }) {
  return (
    <Field label={m.invest_trade_asset()}>
      {({ id }) => (
        <Select
          id={id}
          value={fields.asset?.id ?? null}
          onValueChange={fields.pick}
          placeholder={m.invest_trade_asset_pick()}
          options={assets.map((asset) => ({
            value: asset.id,
            label: `${asset.symbol} · ${asset.name}`,
            description: asset.platformName,
          }))}
        />
      )}
    </Field>
  );
}

function CostFields({ fields, currency, locale }: { readonly fields: MarketFields; readonly currency: string; readonly locale: Locale }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Field label={m.invest_trade_fee()}>
        {({ id }) => (
          <div className={INPUT_FRAME.lg}>
            <AmountInput id={id} value={fields.fee} onValueChange={fields.setFee} currency={currency} locale={locale} size="inline" />
          </div>
        )}
      </Field>
      <Field label={m.invest_trade_tax()}>
        {({ id }) => (
          <div className={INPUT_FRAME.lg}>
            <AmountInput id={id} value={fields.tax} onValueChange={fields.setTax} currency={currency} locale={locale} size="inline" />
          </div>
        )}
      </Field>
      {fields.foreign ? (
        <Field label={m.invest_trade_rate({ currency })} error={fields.rate === null ? m.invest_trade_error_rate() : null}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={fields.rateText}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                fields.setRateText(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}

function DateField({ value, onChange, today, locale }: { readonly value: LocalDate; readonly onChange: (date: LocalDate) => void; readonly today: LocalDate; readonly locale: Locale }) {
  return (
    <Field label={m.invest_trade_date()}>
      {({ id }) => (
        <DatePicker
          id={id}
          value={value}
          onValueChange={onChange}
          placeholder={m.invest_trade_date()}
          today={today}
          locale={locale}
          disableFuture
          labels={{ previousMonth: m.calendar_previous_month(), nextMonth: m.calendar_next_month() }}
        />
      )}
    </Field>
  );
}

function Summary({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-surface-2 p-3">
      <h3 className="text-[11px] font-medium tracking-[0.04em] text-subtle uppercase">{title}</h3>
      <dl className="flex flex-col gap-1 text-[12.5px]">{children}</dl>
    </div>
  );
}

function Line({ label, children, strong = false }: { readonly label: ReactNode; readonly children: ReactNode; readonly strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${strong ? 'border-t border-border pt-1.5 font-medium text-fg' : 'text-muted-fg'}`}>
      <dt>{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Footer({ pending, failure, label, onCancel }: { readonly pending: boolean; readonly failure: string | null; readonly label: string; readonly onCancel: () => void }) {
  return (
    <>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {m.invest_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          {label}
        </Button>
      </div>
    </>
  );
}

/** Runs a draft through `onSubmit` with the pending flag and the failure message. */
function useSubmit(onSubmit: TradeSheetProps['onSubmit']) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const run = async (draft: TradeDraft) => {
    setPending(true);
    setFailure(await onSubmit(draft));
    setPending(false);
  };
  return { pending, failure, run };
}

function BuyForm({ assetId, ...props }: FormProps & { readonly assetId: string | null }) {
  const { locale, portfolio } = props;
  const fields = useMarketFields(props, assetId);
  const { asset, price, rate } = fields;
  const [by, setBy] = useState<'amount' | 'units'>('amount');
  const [amount, setAmount] = useState<bigint | null>(null);
  const [unitsText, setUnitsText] = useState('');
  const [pendingBuy, setPendingBuy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const { pending, failure, run } = useSubmit(props.onSubmit);
  const currency = asset?.quoteCurrency ?? portfolio.baseCurrency;
  const units = decimalInput(unitsText, locale);
  const platform = portfolio.platforms.find((candidate) => candidate.accountId === asset?.accountId);
  let preview: BuyPreview | null = null;
  try {
    if (price !== null && rate !== null && (by === 'amount' ? amount !== null && amount > 0n : units !== null)) {
      preview = buyPreview(
        by === 'amount' ? { by, amountMinor: amount as bigint } : { by, units: units as string },
        { price, feeMinor: fields.fee ?? 0n, taxMinor: fields.tax ?? 0n, fxRate: rate },
        { quote: currency, base: portfolio.baseCurrency },
      );
    }
  } catch {
    preview = null;
  }
  const split = asset === null || preview === null || asset.goals.length === 0 ? null : splitUnits(preview.units, assetSources(asset));

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (asset === null || preview === null || price === null || rate === null) return;
    await run({
      kind: 'buy',
      clientId: fields.clientId,
      date: fields.date,
      assetId: asset.id,
      units: preview.units,
      price,
      amountMinor: preview.amountMinor,
      feeMinor: fields.fee ?? 0n,
      taxMinor: fields.tax ?? 0n,
      fxRate: fields.foreign ? rate : null,
      pending: pendingBuy,
    });
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <AssetField fields={fields} assets={portfolio.assets} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.invest_trade_price({ currency })} error={showErrors && price === null ? m.invest_trade_error_price() : null}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={fields.priceText}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                fields.setPriceText(event.currentTarget.value);
              }}
            />
          )}
        </Field>
        <DateField value={fields.date} onChange={fields.setDate} today={props.today} locale={locale} />
      </div>
      <SegmentedControl
        label={m.invest_trade_buy_by()}
        value={by}
        onValueChange={setBy}
        options={[
          { value: 'amount', label: m.invest_trade_by_amount() },
          { value: 'units', label: m.invest_trade_by_units() },
        ]}
        fill
      />
      {by === 'amount' ? (
        <Field label={m.invest_trade_amount({ currency })} error={showErrors && preview === null ? m.invest_trade_error_amount() : null}>
          {({ id, describedBy, invalid }) => (
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                value={amount}
                onValueChange={setAmount}
                currency={currency}
                locale={locale}
                size="inline"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
          )}
        </Field>
      ) : (
        <Field label={m.invest_trade_units()} error={showErrors && preview === null ? m.invest_trade_error_units() : null}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={unitsText}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                setUnitsText(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      )}
      <CostFields fields={fields} currency={currency} locale={locale} />
      <label className="flex items-center gap-2 text-[12.5px] text-muted-fg">
        <input
          type="checkbox"
          checked={pendingBuy}
          onChange={(event) => {
            setPendingBuy(event.currentTarget.checked);
          }}
          className="size-4 accent-fg"
        />
        {m.invest_trade_pending()}
      </label>
      {platform === undefined ? null : (
        <p className="text-[12px] text-subtle">
          {m.invest_trade_paid_from({ platform: platform.name })}{' '}
          <Money minor={platform.cashMinor} currency={platform.currency} context="amount" locale={locale} />
        </p>
      )}
      {preview === null ? null : (
        <Summary title={m.invest_trade_summary()}>
          <Line label={m.invest_trade_units()}>
            <span className="font-mono">{formatUnits(preview.units, locale)}</span>
          </Line>
          <Line label={m.invest_trade_kind_buy()}>
            <Money minor={preview.amountMinor} currency={currency} context="amount" locale={locale} />
          </Line>
          <Line label={m.invest_trade_total()} strong>
            <Money minor={preview.totalMinor} currency={currency} context="amount" locale={locale} />
            {currency === portfolio.baseCurrency ? null : (
              <span className="text-subtle">
                {' ≈ '}
                <Money minor={preview.totalBaseMinor} currency={portfolio.baseCurrency} context="amount" locale={locale} />
              </span>
            )}
          </Line>
          {platform === undefined || platform.currency !== currency ? null : (
            <Line label={m.invest_trade_cash_after()}>
              <Money minor={platform.cashMinor - preview.totalMinor} currency={currency} context="amount" locale={locale} />
            </Line>
          )}
          {split === null ? null : (
            <Line label={m.invest_trade_split()}>
              {split.goals
                .map((part) => {
                  const goal = asset?.goals.find((candidate) => candidate.goalId === part.goalId);
                  return `${goal?.goalName ?? ''} ${formatUnits(part.value, locale)}`;
                })
                .join(' · ')}
            </Line>
          )}
        </Summary>
      )}
      <Footer pending={pending} failure={failure} label={m.invest_trade_save_buy()} onCancel={props.onCancel} />
    </form>
  );
}

const QUICK_SHARES = [2500, 5000, 10_000] as const;

function SellForm({ assetId, ...props }: FormProps & { readonly assetId: string | null }) {
  const { locale, portfolio, accounts } = props;
  const held = portfolio.assets.filter((asset) => asset.holding.units !== '0');
  const fields = useMarketFields(props, held.some((asset) => asset.id === assetId) ? assetId : (held[0]?.id ?? null));
  const { asset, price, rate } = fields;
  const [value, setValue] = useState<bigint | null>(null);
  const [shareBps, setShareBps] = useState<number | null>(null);
  const [toAccount, setToAccount] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [reduceGoalId, setReduceGoalId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const { pending, failure, run } = useSubmit(props.onSubmit);
  const currency = asset?.quoteCurrency ?? portfolio.baseCurrency;
  const platform = portfolio.platforms.find((candidate) => candidate.accountId === asset?.accountId);
  const targets = accounts.filter(
    (account) => account.status === 'active' && account.currency === currency && account.id !== asset?.accountId,
  );
  let preview: SellPreview | null = null;
  try {
    if (asset !== null && price !== null && rate !== null && (shareBps !== null || (value !== null && value > 0n))) {
      preview = sellPreview(
        asset.holding,
        shareBps === null ? { by: 'value', amountMinor: value as bigint } : { by: 'percent', bps: shareBps },
        { price, feeMinor: fields.fee ?? 0n, taxMinor: fields.tax ?? 0n, fxRate: rate },
        { quote: currency, base: portfolio.baseCurrency },
      );
    }
  } catch {
    preview = null;
  }
  const sources = asset === null ? [] : assetSources(asset);
  const choose = asset !== null && preview !== null && needsGoalChoice(asset.holding.units, sources, preview.units);
  const after =
    asset === null || preview === null || (choose && reduceGoalId === null) || sources.length === 0
      ? null
      : sellAllocation({ units: asset.holding.units, sources, soldUnits: preview.units, reduceGoalId: choose ? reduceGoalId : null });

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (asset === null || preview === null || price === null || rate === null) return;
    if (choose && reduceGoalId === null) return;
    if (toAccount && accountId === null) return;
    await run({
      kind: 'sell',
      clientId: fields.clientId,
      date: fields.date,
      assetId: asset.id,
      units: preview.units,
      price,
      amountMinor: preview.grossMinor,
      feeMinor: fields.fee ?? 0n,
      taxMinor: fields.tax ?? 0n,
      fxRate: fields.foreign ? rate : null,
      proceedsAccountId: toAccount ? accountId : null,
      reduceGoalId: choose ? reduceGoalId : null,
    });
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <AssetField fields={fields} assets={held} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.invest_trade_price({ currency })} error={showErrors && price === null ? m.invest_trade_error_price() : null}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={fields.priceText}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                fields.setPriceText(event.currentTarget.value);
              }}
            />
          )}
        </Field>
        <DateField value={fields.date} onChange={fields.setDate} today={props.today} locale={locale} />
      </div>
      <Field
        label={m.invest_trade_sell_value({ currency })}
        aside={preview === null ? undefined : m.invest_trade_position_share({ share: `${String(Math.round(preview.positionBps / 10) / 10).replace('.', locale === 'id' ? ',' : '.')}%` })}
        error={showErrors && preview === null ? m.invest_trade_error_amount() : null}
      >
        {({ id, describedBy, invalid }) => (
          <div className="flex flex-col gap-2">
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                value={shareBps === null ? value : (preview?.grossMinor ?? null)}
                onValueChange={(next) => {
                  setShareBps(null);
                  setValue(next);
                }}
                currency={currency}
                locale={locale}
                size="inline"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-subtle">{m.invest_trade_quick()}</span>
              {QUICK_SHARES.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  aria-pressed={shareBps === bps}
                  onClick={() => {
                    setShareBps(bps);
                  }}
                  className="rounded-[6px] border border-border px-2 py-1 font-mono text-[12px] text-muted-fg hover:bg-muted aria-pressed:border-fg aria-pressed:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {bps === 10_000 ? m.invest_trade_all() : <Percent value={bps / 10_000} locale={locale} />}
                </button>
              ))}
            </div>
          </div>
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12.5px] font-medium text-fg">{m.invest_trade_proceeds()}</legend>
        <label className="flex items-center gap-2 text-[12.5px] text-muted-fg">
          <input
            type="radio"
            name="proceeds"
            checked={!toAccount}
            onChange={() => {
              setToAccount(false);
            }}
            className="size-4 accent-fg"
          />
          {m.invest_trade_proceeds_cash({ platform: platform?.name ?? '—', currency })}
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-muted-fg">
          <input
            type="radio"
            name="proceeds"
            checked={toAccount}
            disabled={targets.length === 0}
            onChange={() => {
              setToAccount(true);
              setAccountId((current) => current ?? targets[0]?.id ?? null);
            }}
            className="size-4 accent-fg"
          />
          {m.invest_trade_proceeds_account()}
        </label>
        {toAccount ? (
          <Select
            aria-label={m.invest_trade_proceeds_account()}
            value={accountId}
            onValueChange={setAccountId}
            placeholder={m.invest_trade_account_pick()}
            options={targets.map((account) => ({ value: account.id, label: account.displayName }))}
          />
        ) : null}
      </fieldset>
      <CostFields fields={fields} currency={currency} locale={locale} />
      {choose && asset !== null ? (
        <fieldset className="flex flex-col gap-2 rounded-[10px] border border-amber-tint-3 p-3">
          <legend className="flex items-center gap-1.5 px-1 text-[12.5px] font-medium text-fg">
            <GitFork aria-hidden="true" className="size-3.5 text-amber-fg" />
            {m.invest_trade_goal_choice({ symbol: asset.symbol, count: asset.goals.length })}
          </legend>
          {asset.goals.map((goal) => (
            <label key={goal.goalId} className="flex items-center gap-2 text-[12.5px] text-muted-fg">
              <input
                type="radio"
                name="reduce-goal"
                checked={reduceGoalId === goal.goalId}
                onChange={() => {
                  setReduceGoalId(goal.goalId);
                }}
                className="size-4 accent-fg"
              />
              {m.invest_trade_goal_reduce({ name: goal.goalName })}
            </label>
          ))}
          {showErrors && reduceGoalId === null ? (
            <p role="alert" className="text-[12px] text-red-fg">
              {m.invest_trade_error_goal()}
            </p>
          ) : null}
        </fieldset>
      ) : null}
      {preview === null ? null : (
        <Summary title={m.invest_trade_summary()}>
          <Line label={m.invest_trade_units()}>
            <span className="font-mono">{formatUnits(preview.units, locale)}</span>
          </Line>
          <Line label={m.invest_trade_received()} strong>
            <Money minor={preview.netMinor} currency={currency} context="amount" locale={locale} />
          </Line>
          <Line label={m.invest_trade_realized()}>
            <Money minor={preview.realizedBaseMinor} currency={portfolio.baseCurrency} context="delta" locale={locale} />
          </Line>
          {after === null || asset === null
            ? null
            : after.unitsByGoal.map((part) => {
                const goal = asset.goals.find((candidate) => candidate.goalId === part.goalId);
                return (
                  <Line key={part.goalId} label={goal?.goalName}>
                    <span className="font-mono">
                      {formatUnits(goal?.units ?? '0', locale, 3)} → {formatUnits(part.value, locale, 3)}
                    </span>
                  </Line>
                );
              })}
        </Summary>
      )}
      <Footer pending={pending} failure={failure} label={m.invest_trade_save_sell()} onCancel={props.onCancel} />
    </form>
  );
}

function DividendForm({ assetId, ...props }: FormProps & { readonly assetId: string | null }) {
  const { locale, portfolio, accounts } = props;
  const held = portfolio.assets.filter((asset) => asset.holding.units !== '0');
  const fields = useMarketFields(props, held.some((asset) => asset.id === assetId) ? assetId : (held[0]?.id ?? null));
  const { asset, rate } = fields;
  const [amount, setAmount] = useState<bigint | null>(null);
  const [mode, setMode] = useState<DividendMode>('cash');
  const [unitsText, setUnitsText] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const { pending, failure, run } = useSubmit(props.onSubmit);
  const currency = asset?.quoteCurrency ?? portfolio.baseCurrency;
  const units = decimalInput(unitsText, locale);
  const targets = accounts.filter(
    (account) => account.status === 'active' && account.currency === currency && account.id !== asset?.accountId,
  );
  const net = amount === null ? null : amount - (fields.fee ?? 0n) - (fields.tax ?? 0n);
  const errors = {
    amount: amount === null || amount <= 0n || net === null || net < 0n ? m.invest_trade_error_amount() : null,
    units: mode === 'reinvest' && units === null ? m.invest_trade_error_units() : null,
    account: mode === 'account' && accountId === null ? m.invest_trade_error_account() : null,
  };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (asset === null || rate === null || Object.values(errors).some((error) => error !== null)) return;
    await run({
      kind: 'dividend',
      clientId: fields.clientId,
      date: fields.date,
      assetId: asset.id,
      amountMinor: amount as bigint,
      feeMinor: fields.fee ?? 0n,
      taxMinor: fields.tax ?? 0n,
      fxRate: fields.foreign ? rate : null,
      mode,
      units: mode === 'reinvest' ? units : null,
      accountId: mode === 'account' ? accountId : null,
    });
  };

  const modes: readonly { readonly value: DividendMode; readonly label: string }[] = [
    { value: 'reinvest', label: m.invest_dividend_reinvest() },
    { value: 'cash', label: m.invest_dividend_cash() },
    { value: 'account', label: m.invest_dividend_account() },
  ];
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <AssetField fields={fields} assets={held} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.invest_dividend_gross({ currency })} error={showErrors ? errors.amount : null}>
          {({ id, describedBy, invalid }) => (
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                value={amount}
                onValueChange={setAmount}
                currency={currency}
                locale={locale}
                size="inline"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
          )}
        </Field>
        <DateField value={fields.date} onChange={fields.setDate} today={props.today} locale={locale} />
      </div>
      <CostFields fields={fields} currency={currency} locale={locale} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12.5px] font-medium text-fg">{m.invest_dividend_mode()}</legend>
        {modes.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-[12.5px] text-muted-fg">
            <input
              type="radio"
              name="dividend-mode"
              checked={mode === option.value}
              disabled={option.value === 'account' && targets.length === 0}
              onChange={() => {
                setMode(option.value);
                if (option.value === 'account') setAccountId((current) => current ?? targets[0]?.id ?? null);
              }}
              className="size-4 accent-fg"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {mode === 'reinvest' ? (
        <Field label={m.invest_dividend_units()} hint={m.invest_dividend_units_hint()} error={showErrors ? errors.units : null}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={unitsText}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                setUnitsText(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      ) : null}
      {mode === 'account' ? (
        <Field label={m.invest_dividend_account()} error={showErrors ? errors.account : null}>
          {({ id }) => (
            <Select
              id={id}
              value={accountId}
              onValueChange={setAccountId}
              placeholder={m.invest_trade_account_pick()}
              options={targets.map((account) => ({ value: account.id, label: account.displayName }))}
            />
          )}
        </Field>
      ) : null}
      {net === null || net < 0n ? null : (
        <Summary title={m.invest_trade_summary()}>
          <Line label={m.invest_dividend_net()} strong>
            <Money minor={net} currency={currency} context="amount" locale={locale} />
          </Line>
        </Summary>
      )}
      <Footer pending={pending} failure={failure} label={m.invest_trade_save_dividend()} onCancel={props.onCancel} />
    </form>
  );
}

function TopUpForm({ accountId, ...props }: FormProps & { readonly accountId: string | null }) {
  const { locale, portfolio, accounts } = props;
  const [platformId, setPlatformId] = useState<string | null>(accountId ?? portfolio.platforms[0]?.accountId ?? null);
  const platform = portfolio.platforms.find((candidate) => candidate.accountId === platformId);
  const sources = accounts.filter((account) => account.status === 'active' && account.type !== 'investment');
  const [fromId, setFromId] = useState<string | null>(
    sources.find((account) => account.currency === platform?.currency)?.id ?? sources[0]?.id ?? null,
  );
  const from = sources.find((account) => account.id === fromId);
  const [sent, setSent] = useState<bigint | null>(null);
  const [received, setReceived] = useState<bigint | null>(null);
  const [date, setDate] = useState(props.today);
  const [clientId] = useState(() => crypto.randomUUID());
  const [showErrors, setShowErrors] = useState(false);
  const { pending, failure, run } = useSubmit(props.onSubmit);
  const crossing = platform !== undefined && from !== undefined && platform.currency !== from.currency;
  const errors = {
    platform: platform === undefined ? m.invest_topup_error_platform() : null,
    from: from === undefined ? m.invest_topup_error_from() : null,
    sent: sent === null || sent <= 0n ? m.invest_trade_error_amount() : null,
    received: crossing && (received === null || received <= 0n) ? m.invest_trade_error_amount() : null,
  };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.values(errors).some((error) => error !== null) || platform === undefined || from === undefined) return;
    await run({
      kind: 'cash_topup',
      clientId,
      date,
      accountId: platform.accountId,
      fromAccountId: from.id,
      sentMinor: sent as bigint,
      receivedMinor: crossing ? (received as bigint) : (sent as bigint),
    });
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.invest_topup_platform()} error={showErrors ? errors.platform : null}>
          {({ id }) => (
            <Select
              id={id}
              value={platformId}
              onValueChange={setPlatformId}
              placeholder={m.invest_trade_account_pick()}
              options={portfolio.platforms.map((candidate) => ({ value: candidate.accountId, label: candidate.name }))}
            />
          )}
        </Field>
        <Field label={m.invest_topup_from()} error={showErrors ? errors.from : null}>
          {({ id }) => (
            <Select
              id={id}
              value={fromId}
              onValueChange={setFromId}
              placeholder={m.invest_trade_account_pick()}
              options={sources.map((account) => ({ value: account.id, label: account.displayName }))}
            />
          )}
        </Field>
        <Field label={m.invest_topup_sent({ currency: from?.currency ?? '' })} error={showErrors ? errors.sent : null}>
          {({ id, describedBy, invalid }) => (
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                value={sent}
                onValueChange={setSent}
                currency={from?.currency ?? portfolio.baseCurrency}
                locale={locale}
                size="inline"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
          )}
        </Field>
        {crossing ? (
          <Field label={m.invest_topup_received({ currency: platform.currency })} error={showErrors ? errors.received : null}>
            {({ id, describedBy, invalid }) => (
              <div className={INPUT_FRAME.lg}>
                <AmountInput
                  id={id}
                  value={received}
                  onValueChange={setReceived}
                  currency={platform.currency}
                  locale={locale}
                  size="inline"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                />
              </div>
            )}
          </Field>
        ) : null}
        <DateField value={date} onChange={setDate} today={props.today} locale={locale} />
      </div>
      <p className="text-[12px] text-subtle">{m.invest_topup_note()}</p>
      <Footer pending={pending} failure={failure} label={m.invest_trade_save_topup()} onCancel={props.onCancel} />
    </form>
  );
}
