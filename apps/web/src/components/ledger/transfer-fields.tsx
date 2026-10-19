// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The transfer part of the Record Transaction form (FR-T4, designs `qB5s3`, `TyPAn`, `CpDml`, `N1CG8`, `KynJj`,
 * `Y9v7p`, `szrvO`): source and destination with their balances before → after (the same account cannot be on
 * both sides), the exchange rate of a cross-currency transfer (reference with its source and update time, or a
 * manual rate with its deviation), the amount received with the FX difference the ledger records to "Selisih kurs",
 * and an optional fee recorded as an expense in a fee category.
 */
import type { AccountView } from '@wf/db/accounts';
import { FX_DIFFERENCE_CATEGORY } from '@wf/domain/categories';
import { formatMoney, type Locale } from '@wf/domain/money';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { usePrivacy } from '@wf/ui/privacy';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { ArrowLeftRight, ChevronsUpDown, CircleAlert, RefreshCw } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { AccountPicker, AccountSwatch } from './account-picker.tsx';
import { CategorySelect } from './category-picker.tsx';
import { balancesAfter, ratePair, unitValue, type FieldError, type RateMode } from './transaction-draft.ts';
import type { LedgerData, TransactionFormState } from './use-transaction-form.ts';

/** An inline field error (FR-T8). */
export function ErrorText({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-[12px] text-red-fg">
      <CircleAlert aria-hidden="true" className="mt-px size-[13px] shrink-0" />
      {children}
    </p>
  );
}

interface AccountCardProps extends ComponentProps<'button'> {
  readonly side: string;
  readonly account: AccountView | undefined;
  readonly afterMinor: bigint | undefined;
  readonly placeholder: string;
  readonly locale: Locale;
}

/** One side of "Dari → ke": the account, its balance now, and after saving. */
function AccountCard({ side, account, afterMinor, placeholder, locale, className = '', ...props }: AccountCardProps) {
  return (
    <button
      type="button"
      {...props}
      className={`flex min-w-0 flex-1 flex-col gap-2.5 rounded-[10px] border border-border bg-input p-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-red ${className}`}
    >
      <span className="flex w-full items-center gap-2">
        {account === undefined ? null : <AccountSwatch account={account} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-fg">
            {side}
            {account === undefined ? null : (
              <span className="rounded-[4px] border border-border px-1 font-mono text-[10px]">{account.currency}</span>
            )}
          </span>
          <span className={`truncate text-[13.5px] font-medium ${account === undefined ? 'text-subtle' : 'text-fg'}`}>
            {account?.displayName ?? placeholder}
          </span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
      </span>
      {account === undefined ? null : (
        <span className="flex flex-col border-t border-border pt-2 text-[12px]">
          <Money minor={account.balanceMinor} currency={account.currency} context="amount" locale={locale} className="text-subtle" />
          {afterMinor === undefined ? null : (
            <Money
              minor={afterMinor}
              currency={account.currency}
              context="amount"
              locale={locale}
              className={afterMinor < 0n ? 'text-amber-fg' : afterMinor > account.balanceMinor ? 'text-green-fg' : 'text-fg'}
            />
          )}
        </span>
      )}
    </button>
  );
}

/** Provider id of ExchangeRate-API's open endpoint, whose terms require an attribution next to its rates. */
const EXCHANGE_RATE_API = 'open-er-api';

export interface TransferFieldsProps {
  readonly form: TransactionFormState;
  readonly data: LedgerData;
  readonly locale: Locale;
  readonly timeZone: string;
  /** Ids for the error messages the fields point at. */
  readonly ids: { readonly toAccount: string; readonly rate: string; readonly received: string; readonly fee: string };
  readonly error: (field: 'toAccount' | 'rate' | 'received' | 'feeCategory') => FieldError | undefined;
}

export function TransferFields({ form, data, locale, timeZone, ids, error }: TransferFieldsProps) {
  const { values, update, figures, rate } = form;
  const from = data.accounts.find((account) => account.id === values.accountId);
  const to = data.accounts.find((account) => account.id === values.toAccountId);
  const after = balancesAfter(values, data.accounts, figures);
  const afterOf = (account: AccountView | undefined) => after.find((entry) => entry.account.id === account?.id)?.afterMinor;
  const toError = error('toAccount');
  const feeCategory = data.categories.find((category) => category.builtInKey === 'system:bank_fee');
  const fxCategoryShown = data.categories.some((category) => category.builtInKey === FX_DIFFERENCE_CATEGORY);
  const pair = from !== undefined && to !== undefined && from.currency !== to.currency ? { from, to } : null;
  const orientation = pair === null ? null : ratePair(pair.from.currency, pair.to.currency, data.baseCurrency);

  const { hidden } = usePrivacy();
  // An empty "Diterima" means the expected amount, shown as the placeholder (masked in privacy mode).
  const expectedText =
    figures === null || pair === null
      ? undefined
      : formatMoney(figures.difference.expectedReceivedMinor, pair.to.currency, { locale, context: 'table', privacy: hidden });
  const updatedAt = (at: Date) =>
    `${formatDate(toLocalDate(at, timeZone), locale, 'day')}, ${formatTime(at, timeZone, locale)}`;

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-medium text-muted-fg">{m.record_transfer_route()}</span>
        <div className="flex items-stretch gap-2">
          <AccountPicker
            accounts={data.accounts}
            value={values.accountId}
            onValueChange={(id) => {
              update({ accountId: id, receivedMinor: null });
            }}
            label={m.record_transfer_pick_from()}
            searchPlaceholder={m.record_transfer_search_from()}
            locale={locale}
            outflowMinor={values.amountMinor}
            disabledId={values.toAccountId}
            disabledReason={m.record_transfer_chosen_as_to()}
          >
            <AccountCard
              side={m.record_transfer_from()}
              aria-label={`${m.record_transfer_from()}: ${from?.displayName ?? m.record_account_placeholder()}`}
              account={from}
              afterMinor={afterOf(from)}
              placeholder={m.record_account_placeholder()}
              locale={locale}
            />
          </AccountPicker>
          <button
            type="button"
            aria-label={m.record_transfer_swap()}
            onClick={() => {
              update({ accountId: values.toAccountId, toAccountId: values.accountId, receivedMinor: null });
            }}
            className="flex size-8 shrink-0 items-center justify-center self-center rounded-full border border-border text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeftRight aria-hidden="true" className="size-3.5" />
          </button>
          <AccountPicker
            accounts={data.accounts}
            value={values.toAccountId}
            onValueChange={(id) => {
              update({ toAccountId: id, receivedMinor: null });
            }}
            label={m.record_transfer_pick_to()}
            searchPlaceholder={m.record_transfer_search_to()}
            locale={locale}
            disabledId={values.accountId}
            disabledReason={m.record_transfer_chosen_as_from()}
          >
            <AccountCard
              side={m.record_transfer_to()}
              aria-label={`${m.record_transfer_to()}: ${to?.displayName ?? m.record_account_placeholder()}`}
              aria-invalid={toError !== undefined}
              aria-describedby={toError === undefined ? undefined : ids.toAccount}
              account={to}
              afterMinor={afterOf(to)}
              placeholder={m.record_account_placeholder()}
              locale={locale}
            />
          </AccountPicker>
        </div>
        {toError === undefined ? null : (
          <ErrorText id={ids.toAccount}>
            {toError === 'same_account' ? m.record_error_same_account() : m.record_error_to_account()}
          </ErrorText>
        )}
      </div>

      {pair === null || orientation === null || rate === null ? null : (
        <section aria-label={m.record_rate_heading()} className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="font-medium text-muted-fg">{m.record_rate_heading()}</span>
            <span className="font-mono text-[11.5px] text-subtle">
              {pair.from.currency} → {pair.to.currency}
            </span>
          </div>
          <div className="flex flex-col rounded-[10px] border border-border">
            <div className="flex items-center gap-3 p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {values.rateMode === 'manual' ? (
                  <label className="flex items-center gap-1.5 font-mono text-[14px]">
                    {m.record_rate_one({ currency: orientation.base })}
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      aria-invalid={error('rate') !== undefined}
                      aria-describedby={ids.rate}
                      value={values.manualRate}
                      onChange={(event) => {
                        update({ manualRate: event.currentTarget.value, receivedMinor: null });
                      }}
                      className="h-8 w-[110px] rounded-[7px] border border-border-input bg-input px-2 text-fg outline-none focus-visible:outline-2 focus-visible:outline-ring aria-invalid:border-red"
                    />
                    <span className="sr-only">{orientation.quote}</span>
                  </label>
                ) : rate.reference === null ? (
                  <span className="text-[13px] text-muted-fg">
                    {rate.status === 'loading' ? m.record_rate_loading() : m.record_rate_missing()}
                  </span>
                ) : (
                  <span className="font-mono text-[14px]">
                    {m.record_rate_one({ currency: rate.reference.base })}{' '}
                    <Money minor={unitValue(rate.reference)} currency={rate.reference.quote} context="amount" locale={locale} />
                  </span>
                )}
                <span id={ids.rate} className="text-[11.5px] text-subtle">
                  {values.rateMode === 'manual' ? (
                    figures === null || figures.deviationBps === null || rate.reference === null ? (
                      m.record_rate_manual_hint()
                    ) : (
                      <>
                        {m.record_rate_manual()}
                        {' · '}
                        <Percent value={figures.deviationBps / 10_000} locale={locale} signed />{' '}
                        {m.record_rate_from_reference()}{' '}
                        <Money minor={unitValue(rate.reference)} currency={rate.reference.quote} context="amount" locale={locale} />
                      </>
                    )
                  ) : rate.reference === null ? null : rate.status === 'failed' ? (
                    <span className="text-amber-fg">{m.record_rate_failed_inline({ time: updatedAt(rate.reference.fetchedAt) })}</span>
                  ) : rate.status === 'loading' ? (
                    m.record_rate_loading()
                  ) : rate.reference.manual ? (
                    m.record_rate_saved_manual({ date: formatDate(rate.reference.asOf, locale, 'day') })
                  ) : (
                    <>
                      {m.record_rate_reference({ provider: rate.reference.provider, time: updatedAt(rate.reference.fetchedAt) })}
                      {rate.reference.provider === EXCHANGE_RATE_API ? (
                        <>
                          {' · '}
                          <a
                            href="https://www.exchangerate-api.com"
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            {m.record_rate_attribution()}
                          </a>
                        </>
                      ) : null}
                    </>
                  )}
                </span>
              </div>
              <SegmentedControl<RateMode>
                label={m.record_rate_mode()}
                value={values.rateMode}
                onValueChange={(mode) => {
                  update({ rateMode: mode, receivedMinor: null });
                }}
                options={[
                  { value: 'reference', label: m.record_rate_mode_reference() },
                  { value: 'manual', label: m.record_rate_mode_manual() },
                ]}
              />
              <button
                type="button"
                aria-label={m.record_rate_refresh()}
                onClick={rate.refresh}
                className="flex size-8 shrink-0 items-center justify-center rounded-[7px] border border-border text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <RefreshCw aria-hidden="true" className={`size-3.5 ${rate.status === 'loading' ? 'motion-safe:animate-spin' : ''}`} />
              </button>
            </div>
            <div className="flex items-center gap-3 border-t border-border p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <label htmlFor={ids.received} className="text-[12.5px] text-fg">
                  {m.record_received_at({ account: pair.to.displayName })}
                </label>
                <span className="text-[11.5px] text-subtle">
                  {figures === null ? (
                    m.record_received_waiting()
                  ) : (
                    <>
                      {m.record_received_expected()}{' '}
                      <Money minor={figures.difference.expectedReceivedMinor} currency={pair.to.currency} context="amount" locale={locale} />
                      {' · '}
                      {m.record_received_effective()}{' '}
                      <Money
                        minor={unitValue({ ...figures.rate, rate: figures.effectiveRate })}
                        currency={figures.rate.quote}
                        context="amount"
                        locale={locale}
                      />
                    </>
                  )}
                </span>
              </div>
              <div className="w-[150px] shrink-0 rounded-[8px] border border-border-input bg-input px-2.5 py-1.5">
                <AmountInput
                  id={ids.received}
                  size="inline"
                  value={values.receivedMinor}
                  {...(expectedText === undefined ? {} : { placeholder: expectedText })}
                  onValueChange={(minor) => {
                    update({ receivedMinor: minor });
                  }}
                  currency={pair.to.currency}
                  locale={locale}
                  aria-invalid={error('received') !== undefined}
                />
              </div>
            </div>
            {figures === null ? null : (
              <div
                className={`flex flex-col gap-0.5 border-t border-border p-3 ${figures.difference.differenceBaseMinor < 0n ? 'bg-red-tint-1' : ''}`}
              >
                {figures.difference.differenceBaseMinor === 0n ? (
                  <>
                    <span className="text-[13px] font-medium">{m.record_fx_none()}</span>
                    <span className="text-[11.5px] text-subtle">{m.record_fx_none_hint()}</span>
                  </>
                ) : (
                  <>
                    <span className="text-[13px] font-medium">
                      {m.record_fx_recorded()}{' '}
                      <Money
                        minor={figures.difference.differenceBaseMinor}
                        currency={data.baseCurrency}
                        context="amount"
                        locale={locale}
                        className={figures.difference.differenceBaseMinor < 0n ? 'text-red-fg' : 'text-green-fg'}
                      />
                    </span>
                    <span className="text-[11.5px] text-subtle">
                      <Money
                        minor={
                          figures.difference.shortfallReceivedMinor < 0n
                            ? -figures.difference.shortfallReceivedMinor
                            : figures.difference.shortfallReceivedMinor
                        }
                        currency={pair.to.currency}
                        context="amount"
                        locale={locale}
                      />{' '}
                      {figures.difference.shortfallReceivedMinor > 0n ? m.record_fx_less() : m.record_fx_more()}
                      {fxCategoryShown ? ` · ${m.category_builtin_fx_difference()}` : ''}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          {error('rate') === 'invalid' ? <ErrorText id={`${ids.rate}-error`}>{m.record_error_rate()}</ErrorText> : null}
          {error('received') === undefined ? null : (
            <ErrorText id={`${ids.received}-error`}>{m.record_error_received()}</ErrorText>
          )}
        </section>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.fee} className="text-[12.5px] font-medium text-muted-fg">
          {m.record_fee()}
        </label>
        <div className="rounded-[9px] border border-border-input bg-input px-3 py-2.5">
          <AmountInput
            id={ids.fee}
            size="inline"
            value={values.feeMinor}
            onValueChange={(minor) => {
              update({
                feeMinor: minor,
                ...(values.feeCategoryId === null && feeCategory !== undefined ? { feeCategoryId: feeCategory.id } : {}),
              });
            }}
            currency={from?.currency ?? data.baseCurrency}
            locale={locale}
          />
        </div>
        {values.feeMinor === null || values.feeMinor <= 0n ? null : (
          <div className="flex items-center gap-2 text-[12.5px] text-muted-fg">
            <span className="flex-1">
              {m.record_fee_recorded_prefix()}{' '}
              <Money minor={values.feeMinor} currency={from?.currency ?? data.baseCurrency} context="amount" locale={locale} />{' '}
              {m.record_fee_recorded_suffix()}
            </span>
            <CategorySelect
              categories={data.categories}
              kind="fee"
              value={values.feeCategoryId}
              onValueChange={(id) => {
                update({ feeCategoryId: id });
              }}
              label={m.record_fee_category()}
              searchPlaceholder={m.category_picker_search()}
              placeholder={m.record_fee_category()}
              aria-label={m.record_fee_category()}
              aria-invalid={error('feeCategory') !== undefined}
              className="h-8 w-[180px] rounded-[7px] px-2.5 text-[12.5px]"
            />
          </div>
        )}
      </div>
    </>
  );
}
