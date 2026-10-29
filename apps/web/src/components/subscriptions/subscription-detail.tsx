// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One subscription's panel (FR-SUB3/SUB5, design `UONDi`): price per month and year, next bill, paying account (with
 * "Ganti rekening" and its balance check), total paid, "Riwayat harga" with a price increase, "Seberapa sering
 * dipakai?", and "Tagihan terakhir" (the billing history); Edit, Tandai sudah dibayar, Jeda, Batalkan or Aktifkan lagi.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { BillingHistory, SubscriptionView } from '@wf/db/schedules';
import type { LocalDate } from '@wf/domain/period';
import { approxMinor, USAGE_RATINGS, type UsageRating } from '@wf/domain/subscriptions';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { PageState } from '@wf/ui/page-state';
import { Percent } from '@wf/ui/percent';
import { Sheet } from '@wf/ui/sheet';
import { Check, CircleCheck, CirclePause, CirclePlay, CircleX, Pencil } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import { getSubscriptionBilling } from '../../server/fn/schedules.ts';
import { Button, FormError } from '../form.tsx';
import { AccountPicker } from '../ledger/account-picker.tsx';
import { SubscriptionAvatar } from './subscription-avatar.tsx';
import { USAGE_LABEL } from './subscription-table.tsx';
import { daysFrom } from './subscriptions-model.ts';

/** Bars in "Riwayat harga". */
const PRICE_BARS = 6;

export interface SubscriptionDetailProps {
  readonly subscription: SubscriptionView | null;
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
  readonly today: LocalDate;
  readonly timeZone: string;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onEdit: (subscription: SubscriptionView) => void;
  readonly onMarkPaid: (subscription: SubscriptionView, occurrenceId: string) => void;
  readonly onPause: (subscription: SubscriptionView) => void;
  readonly onCancel: (subscription: SubscriptionView) => void;
  readonly onReactivate: (subscription: SubscriptionView) => void;
  readonly onRate: (subscription: SubscriptionView, rating: UsageRating) => void;
  readonly onChangeAccount: (subscription: SubscriptionView, account: AccountView) => void;
}

type Billing =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly history: BillingHistory };

export function SubscriptionDetail({ subscription, onOpenChange, ...props }: SubscriptionDetailProps) {
  const occurrenceId = subscription?.nextBill?.occurrenceId ?? null;
  const footer =
    subscription === null ? null : (
      <div className="flex flex-wrap gap-2">
        {subscription.effectiveStatus === 'cancelled' ? null : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              props.onEdit(subscription);
            }}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
            {m.subscriptions_menu_edit()}
          </Button>
        )}
        {subscription.effectiveStatus === 'active' ? (
          <>
            {occurrenceId === null ? null : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  props.onMarkPaid(subscription, occurrenceId);
                }}
              >
                <CircleCheck aria-hidden="true" className="size-3.5" />
                {m.subscriptions_menu_mark_paid()}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                props.onPause(subscription);
              }}
            >
              <CirclePause aria-hidden="true" className="size-3.5" />
              {m.subscriptions_action_pause()}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              props.onReactivate(subscription);
            }}
          >
            <CirclePlay aria-hidden="true" className="size-3.5" />
            {m.subscriptions_menu_reactivate()}
          </Button>
        )}
        {subscription.effectiveStatus === 'cancelled' ? null : (
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto"
            onClick={() => {
              props.onCancel(subscription);
            }}
          >
            <CircleX aria-hidden="true" className="size-3.5" />
            {m.subscriptions_detail_cancel()}
          </Button>
        )}
      </div>
    );
  return (
    <Sheet
      open={subscription !== null}
      onOpenChange={onOpenChange}
      title={subscription?.name ?? ''}
      closeLabel={m.subscriptions_detail_close()}
      size="lg"
      footer={footer}
    >
      {subscription === null ? null : <DetailBody key={subscription.id} subscription={subscription} {...props} />}
    </Sheet>
  );
}

function DetailBody({
  subscription,
  accounts,
  categories,
  today,
  timeZone,
  locale,
  onRate,
  onChangeAccount,
}: Omit<SubscriptionDetailProps, 'subscription' | 'onOpenChange'> & { readonly subscription: SubscriptionView }) {
  const [billing, setBilling] = useState<Billing>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    void getSubscriptionBilling({ data: { id: subscription.id } }).then((result) => {
      if (!current) return;
      setBilling(
        result.ok
          ? { status: 'ready', history: result.value }
          : { status: 'failed', message: ledgerErrorMessage(result.code, locale) },
      );
    });
    return () => {
      current = false;
    };
  }, [subscription.id, subscription.paidCount, locale]);

  const category = categories.find((candidate) => candidate.id === subscription.categoryId);
  const account = accounts.find((candidate) => candidate.id === subscription.payFromAccountId);
  const bill = subscription.nextBill;
  const monthYear = (date: LocalDate, month: 'short' | 'long' = 'short') =>
    new Intl.DateTimeFormat(locale, { month, year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  const enough =
    account === undefined || account.currency !== subscription.currency || account.type === 'credit_card'
      ? null
      : account.balanceMinor >= subscription.priceMinor;
  const increase = subscription.priceIncrease;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <SubscriptionAvatar subscription={subscription} size="lg" />
        <div className="flex flex-col">
          {subscription.plan === null ? null : <span className="text-[13px] text-fg">{subscription.plan}</span>}
          <span className="text-[12px] text-subtle">
            {category === undefined ? m.subscriptions_uncategorized() : categoryName(category)} ·{' '}
            {m.subscriptions_detail_since({ date: monthYear(subscription.startedOn) })}
          </span>
        </div>
      </div>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="text-[26px] font-medium text-fg">
          <Money minor={subscription.priceMinor} currency={subscription.currency} context="amount" locale={locale} />
        </span>
        <span className="text-[12.5px] text-subtle">
          {subscription.cycle === 'yearly' ? m.subscriptions_per_year_suffix() : m.subscriptions_per_month_suffix()}
          {' · '}
          <Money
            minor={approxMinor(subscription.yearlyMinor)}
            currency={subscription.currency}
            context="amount"
            locale={locale}
          />
          {m.subscriptions_per_year_suffix()}
        </span>
      </p>
      {subscription.description === null ? null : (
        <p className="text-[12.5px] text-muted-fg">{subscription.description}</p>
      )}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label={m.subscriptions_detail_next()}>
          {bill === null ? (
            <dd className="text-[13px] text-subtle">—</dd>
          ) : (
            <>
              <dd className="text-[13px] font-medium text-fg">{formatDate(bill.dueDate, locale, 'weekday')}</dd>
              <dd className="text-[11.5px] text-subtle">
                {bill.dueDate < today
                  ? m.subscriptions_next_unconfirmed()
                  : daysFrom(today, bill.dueDate) === 0
                    ? m.subscriptions_due_today()
                    : m.subscriptions_due_in({ days: daysFrom(today, bill.dueDate) })}
              </dd>
            </>
          )}
        </Stat>
        <Stat label={m.subscriptions_tip_from()}>
          <dd className="flex items-center justify-between gap-2 text-[13px] font-medium text-fg">
            <span className="truncate">{account?.displayName ?? '—'}</span>
            {subscription.effectiveStatus === 'cancelled' ? null : (
              <AccountPicker
                accounts={accounts}
                value={subscription.payFromAccountId}
                onValueChange={(accountId) => {
                  const chosen = accounts.find((candidate) => candidate.id === accountId);
                  if (chosen !== undefined && chosen.id !== subscription.payFromAccountId) {
                    onChangeAccount(subscription, chosen);
                  }
                }}
                label={m.subscriptions_action_change_account()}
                searchPlaceholder={m.subscriptions_form_account_search()}
                locale={locale}
                outflowMinor={subscription.priceMinor}
              >
                <button
                  type="button"
                  className="shrink-0 text-[11.5px] font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {m.subscriptions_detail_change()}
                </button>
              </AccountPicker>
            )}
          </dd>
          {enough === null ? null : (
            <dd className={`text-[11.5px] ${enough ? 'text-subtle' : 'text-red-fg'}`}>
              {enough ? m.subscriptions_tip_enough() : m.subscriptions_tip_short()}
            </dd>
          )}
        </Stat>
        <Stat label={m.subscriptions_detail_total_paid()}>
          <dd className="text-[13px] font-medium text-fg">
            <Money
              minor={subscription.totalPaidMinor}
              currency={account?.currency ?? subscription.currency}
              context="amount"
              locale={locale}
            />
          </dd>
          <dd className="text-[11.5px] text-subtle">{m.subscriptions_sum_bills({ count: subscription.paidCount })}</dd>
        </Stat>
      </dl>

      <Section
        title={m.subscriptions_detail_price_history()}
        aside={
          increase === null ? null : (
            <span className="rounded-[4px] bg-red-tint-2 px-1.5 font-mono text-[11px] text-red-fg">
              <Percent value={increase.increaseBps / 10_000} signed locale={locale} />{' '}
              {m.subscriptions_detail_since_month({
                month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
                  new Date(`${increase.since}T00:00:00Z`),
                ),
              })}
            </span>
          )
        }
      >
        {billing.status === 'ready' && billing.history.charges.length > 0 ? (
          <PriceBars history={billing.history} locale={locale} currency={account?.currency ?? subscription.currency} />
        ) : null}
        {increase === null ? null : (
          <p className="text-[12px] text-muted-fg">
            <Money minor={increase.previousMinor} currency={subscription.currency} context="amount" locale={locale} /> →{' '}
            <Money minor={increase.currentMinor} currency={subscription.currency} context="amount" locale={locale} /> ·{' '}
            {m.subscriptions_detail_increase_since({ date: monthYear(increase.since, 'long') })}
          </p>
        )}
      </Section>

      {subscription.effectiveStatus === 'active' ? (
        <Section title={m.subscriptions_detail_usage()}>
          <div role="group" aria-label={m.subscriptions_detail_usage()} className="grid grid-cols-3 gap-2">
            {USAGE_RATINGS.map((rating) => (
              <button
                key={rating}
                type="button"
                aria-pressed={subscription.usageRating === rating}
                onClick={() => {
                  onRate(subscription, rating);
                }}
                className="flex h-9 items-center justify-center gap-1.5 rounded-[8px] border border-border text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-fg aria-pressed:bg-surface-2"
              >
                {subscription.usageRating === rating ? <Check aria-hidden="true" className="size-3.5" /> : null}
                {USAGE_LABEL[rating]()}
              </button>
            ))}
          </div>
          {subscription.ratedAt === null || subscription.nextReviewOn === null ? null : (
            <p className="text-[11.5px] text-subtle">
              {m.subscriptions_detail_rated({
                date: formatDate(toLocalDate(subscription.ratedAt, timeZone), locale, 'day'),
                next: formatDate(subscription.nextReviewOn, locale, 'day'),
              })}
            </p>
          )}
        </Section>
      ) : null}

      <Section title={m.subscriptions_detail_last_bills()}>
        {billing.status === 'loading' ? (
          <PageState kind="loading" title={m.subscriptions_detail_loading()} />
        ) : billing.status === 'ready' ? (
          billing.history.charges.length === 0 ? (
            <p className="text-[12.5px] text-subtle">{m.subscriptions_detail_no_charges()}</p>
          ) : (
            <ul className="flex flex-col">
              {billing.history.charges.map((charge) => {
                const paidFrom = accounts.find((candidate) => candidate.id === charge.accountId);
                return (
                  <li
                    key={charge.occurrenceId}
                    className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-green-tint-2 text-green-fg">
                      <Check aria-hidden="true" className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13px] text-fg">{formatDate(charge.dueDate, locale, 'date')}</span>
                      <span className="text-[11.5px] text-subtle">
                        {paidFrom?.displayName ?? '—'} ·{' '}
                        {m.subscriptions_detail_confirmed({ date: formatDate(charge.localDate, locale, 'day') })}
                      </span>
                    </span>
                    <span className="text-[13px] text-fg">
                      −
                      <Money
                        minor={charge.amountMinor}
                        currency={paidFrom?.currency ?? subscription.currency}
                        context="amount"
                        locale={locale}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <FormError>{billing.message}</FormError>
        )}
      </Section>
    </div>
  );
}

function PriceBars({
  history,
  currency,
  locale,
}: {
  readonly history: BillingHistory;
  readonly currency: string;
  readonly locale: Locale;
}) {
  const charges = history.charges.slice(0, PRICE_BARS).toReversed();
  const highest = charges.reduce((max, charge) => (charge.amountMinor > max ? charge.amountMinor : max), 1n);
  const since = history.priceIncrease?.since ?? null;
  const heights = charges.map((charge) => Math.max(2, (Number(charge.amountMinor) / Number(highest)) * 40));
  return (
    <ol className="grid grid-cols-6 items-end gap-2">
      {charges.map((charge, index) => {
        const height = heights[index] as number;
        return (
          <li key={charge.occurrenceId} className="flex flex-col items-center gap-1">
            <svg aria-hidden="true" viewBox="0 0 10 40" preserveAspectRatio="none" className="block h-10 w-full">
              <rect
                x="0"
                y={40 - height}
                width="10"
                height={height}
                className={since !== null && charge.dueDate >= since ? 'fill-green' : 'fill-green/40'}
              />
            </svg>
            <span className="text-[10.5px] text-subtle">
              {new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
                new Date(`${charge.dueDate}T00:00:00Z`),
              )}
            </span>
            <span className="sr-only">
              <Money minor={charge.amountMinor} currency={currency} context="amount" locale={locale} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Stat({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-border px-3 py-2.5">
      <dt className="text-[11.5px] text-subtle">{label}</dt>
      {children}
    </div>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}
