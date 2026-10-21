// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Semua langganan" (FR-SUB2/SUB3, design `CZmJm`, `k1FvrG`, `W9vmme`, `WaS25`, `x5B5f`, `UZLdT`): the Aktif /
 * Dijeda / Dibatalkan tabs, one row per subscription (next bill, paying account, usage, price per month and year,
 * a price-increase badge), each with its ⋮ menu — Edit, Tandai sudah dibayar, Ganti rekening ▸ (balances, "kurang …
 * untuk 28 Okt", "Berlaku mulai tagihan 28 Okt"), Riwayat tagihan, Jeda, Batalkan; Aktifkan lagi and Hapus for paused
 * and cancelled ones — and a footer total. A category chosen in "Per kategori" narrows the rows.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { SubscriptionsOverview, SubscriptionView } from '@wf/db/schedules';
import type { SubscriptionStatus, UsageRating } from '@wf/domain/subscriptions';
import { approxMinor } from '@wf/domain/subscriptions';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wf/ui/tabs';
import {
  CircleCheck,
  CirclePause,
  CirclePlay,
  CircleX,
  EllipsisVertical,
  History,
  Pencil,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { RichMessage } from '../rich-message.tsx';
import { SubscriptionAvatar } from './subscription-avatar.tsx';
import { daysFrom, monthsBetween, savedSoFar } from './subscriptions-model.ts';

export const USAGE_LABEL: Readonly<Record<UsageRating, () => string>> = {
  often: m.subscriptions_usage_often,
  sometimes: m.subscriptions_usage_sometimes,
  rarely: m.subscriptions_usage_rarely,
};

export const USAGE_TONE: Readonly<Record<UsageRating, string>> = {
  often: 'bg-green-tint-2 text-green-fg',
  sometimes: 'bg-amber-tint-2 text-amber-fg',
  rarely: 'bg-red-tint-2 text-red-fg',
};

const USAGE_DOT: Readonly<Record<UsageRating, string>> = { often: 'bg-green', sometimes: 'bg-amber', rarely: 'bg-red' };

export interface SubscriptionActions {
  readonly open: (subscription: SubscriptionView) => void;
  readonly edit: (subscription: SubscriptionView) => void;
  readonly markPaid: (subscription: SubscriptionView, occurrenceId: string) => void;
  readonly changeAccount: (subscription: SubscriptionView, account: AccountView) => void;
  readonly pause: (subscription: SubscriptionView) => void;
  readonly cancel: (subscription: SubscriptionView) => void;
  readonly reactivate: (subscription: SubscriptionView) => void;
  readonly remove: (subscription: SubscriptionView) => void;
}

export type TableFilter =
  { readonly categoryId: string | null } | { readonly ids: readonly string[]; readonly label: string };

export interface SubscriptionTableProps {
  readonly overview: SubscriptionsOverview;
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
  readonly locale: Locale;
  readonly tab: SubscriptionStatus;
  readonly onTabChange: (tab: SubscriptionStatus) => void;
  /** Narrows the rows: a "Per kategori" category (`null` = uncategorized), or "Bandingkan" subscriptions. */
  readonly filter: TableFilter | null;
  readonly onClearFilter: () => void;
  readonly actions: SubscriptionActions;
}

/** "Harga / bulan" of one subscription: yearly ones spread over twelve months (Niagahoster 660.900 → 55.075). */
function perMonth(subscription: SubscriptionView): bigint {
  return subscription.cycle === 'yearly' ? (subscription.priceMinor * 2n + 12n) / 24n : subscription.monthlyMinor;
}

export function SubscriptionTable({
  overview,
  accounts,
  categories,
  locale,
  tab,
  onTabChange,
  filter,
  onClearFilter,
  actions,
}: SubscriptionTableProps) {
  const { today, baseCurrency } = overview;
  const accountOf = new Map(accounts.map((account) => [account.id, account]));
  const categoryOf = new Map(categories.map((category) => [category.id, category]));
  const paidThisMonth = new Map(
    overview.monthSchedule.filter((bill) => bill.status === 'paid').map((bill) => [bill.subscriptionId, bill]),
  );
  const filtered = overview.subscriptions.filter(
    (subscription) =>
      filter === null ||
      ('ids' in filter ? filter.ids.includes(subscription.id) : subscription.categoryId === filter.categoryId),
  );
  const rows = (status: SubscriptionStatus) =>
    filtered.filter((subscription) => subscription.effectiveStatus === status);
  const categoryLabel = (subscription: SubscriptionView) => {
    const category = subscription.categoryId === null ? undefined : categoryOf.get(subscription.categoryId);
    return category === undefined ? m.subscriptions_uncategorized() : categoryName(category);
  };
  const share =
    filter === null || 'ids' in filter
      ? undefined
      : overview.byCategory.find((candidate) => candidate.categoryId === filter.categoryId);

  const service = (subscription: SubscriptionView) => (
    <div className="flex min-w-0 items-center gap-3">
      <SubscriptionAvatar subscription={subscription} />
      <div className="flex min-w-0 flex-col">
        <button
          type="button"
          onClick={() => {
            actions.open(subscription);
          }}
          className="truncate text-left text-[13px] font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {subscription.name}
        </button>
        <span className="truncate text-[11.5px] text-subtle">
          {[
            subscription.plan,
            subscription.cycle === 'yearly' ? m.subscriptions_cycle_yearly_short() : null,
            categoryLabel(subscription),
          ]
            .filter((part) => part !== null && part !== '')
            .join(' · ')}
        </span>
      </div>
    </div>
  );

  const nextBillCell = (subscription: SubscriptionView) => {
    // Beyond the scheduled horizon (a yearly bill) the next bill is only a date.
    const bill = subscription.nextBill ?? { dueDate: subscription.nextBillingDate, status: 'scheduled' };
    const paid = paidThisMonth.get(subscription.id);
    let note: ReactNode;
    if (bill.dueDate < today && bill.status !== 'scheduled') {
      note = <span className="text-amber-fg">{m.subscriptions_next_unconfirmed()}</span>;
    } else if (paid !== undefined && bill.dueDate > paid.dueDate) {
      note = (
        <span className="text-green-fg">
          {subscription.cycle === 'yearly'
            ? m.subscriptions_next_paid_on({ date: formatDate(paid.dueDate, locale, 'day') })
            : m.subscriptions_next_paid_month()}
        </span>
      );
    } else {
      const days = daysFrom(today, bill.dueDate);
      note = (
        <span className={days <= 3 ? 'text-amber-fg' : 'text-subtle'}>
          {days === 0 ? m.subscriptions_due_today() : m.subscriptions_due_in({ days })}
        </span>
      );
    }
    return (
      <div className="flex flex-col text-[13px] text-fg">
        {formatDate(bill.dueDate, locale, 'date')}
        <span className="text-[11.5px]">{note}</span>
      </div>
    );
  };

  const priceCell = (subscription: SubscriptionView, note?: ReactNode) => (
    <div className="flex flex-col items-end gap-0.5">
      <span className="flex items-center gap-1.5">
        {subscription.priceIncrease === null ? null : (
          <span className="inline-flex items-center gap-0.5 rounded-[4px] bg-red-tint-2 px-1 font-mono text-[10.5px] text-red-fg">
            <TrendingUp aria-hidden="true" className="size-3" />
            <Percent value={subscription.priceIncrease.increaseBps / 10_000} decimals={0} signed locale={locale} />
          </span>
        )}
        <span className="text-[13px] font-medium text-fg">
          <Money minor={perMonth(subscription)} currency={subscription.currency} context="amount" locale={locale} />
        </span>
      </span>
      <span className="text-[11.5px] text-subtle">
        {note ?? (
          <RichMessage
            message={m.subscriptions_per_year}
            slots={{
              amount: (
                <Money
                  minor={approxMinor(subscription.yearlyMinor)}
                  currency={subscription.currency}
                  context="amount"
                  locale={locale}
                />
              ),
            }}
          />
        )}
      </span>
    </div>
  );

  const menu = (subscription: SubscriptionView) => {
    const status = subscription.effectiveStatus;
    const bill = subscription.nextBill;
    const occurrenceId = bill?.occurrenceId ?? null;
    // "Ganti rekening": accounts that can pay it, and what each lacks for the next bill.
    const payers = accounts
      .filter((account) => account.status === 'active' && account.type !== 'investment')
      .map((account) => ({
        account,
        short:
          bill !== null &&
          account.type !== 'credit_card' &&
          account.currency === subscription.currency &&
          account.balanceMinor < subscription.priceMinor
            ? subscription.priceMinor - account.balanceMinor
            : null,
      }));
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={m.subscriptions_menu_open({ name: subscription.name })}
          className="flex size-7 items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted"
        >
          <EllipsisVertical aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[240px]">
          <DropdownMenuGroup>
            {status === 'active' ? null : (
              <DropdownMenuItem
                icon={CirclePlay}
                onSelect={() => {
                  actions.reactivate(subscription);
                }}
              >
                {m.subscriptions_menu_reactivate()}
              </DropdownMenuItem>
            )}
            {status === 'cancelled' ? null : (
              <DropdownMenuItem
                icon={Pencil}
                onSelect={() => {
                  actions.edit(subscription);
                }}
              >
                {m.subscriptions_menu_edit()}
              </DropdownMenuItem>
            )}
            {status === 'active' ? (
              <DropdownMenuItem
                icon={CircleCheck}
                disabled={occurrenceId === null}
                {...(occurrenceId === null
                  ? {}
                  : {
                      onSelect: () => {
                        actions.markPaid(subscription, occurrenceId);
                      },
                    })}
              >
                <span className="flex items-center justify-between gap-2">
                  {m.subscriptions_menu_mark_paid()}
                  {bill === null ? null : (
                    <span className="font-mono text-[11px] text-subtle">{formatDate(bill.dueDate, locale, 'day')}</span>
                  )}
                </span>
              </DropdownMenuItem>
            ) : null}
            {status === 'cancelled' ? null : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={Wallet}>{m.subscriptions_action_change_account()}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-[300px]">
                  <DropdownMenuLabel>{m.subscriptions_form_pay_from()}</DropdownMenuLabel>
                  {payers.map(({ account, short }) => {
                    return (
                      <DropdownMenuItem
                        key={account.id}
                        className="min-h-11"
                        onSelect={() => {
                          actions.changeAccount(subscription, account);
                        }}
                        aria-current={account.id === subscription.payFromAccountId ? 'true' : undefined}
                      >
                        <span className="flex items-center gap-2">
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{account.displayName}</span>
                            {short === null || bill === null ? null : (
                              <span className="text-[11px] text-red-fg">
                                {m.subscriptions_menu_short({ date: formatDate(bill.dueDate, locale, 'day') })}{' '}
                                <Money minor={short} currency={account.currency} context="amount" locale={locale} />
                              </span>
                            )}
                          </span>
                          <span className={`font-mono text-[11.5px] ${short === null ? 'text-subtle' : 'text-red-fg'}`}>
                            <Money
                              minor={account.balanceMinor}
                              currency={account.currency}
                              context="amount"
                              locale={locale}
                            />
                          </span>
                          {account.id === subscription.payFromAccountId ? (
                            <CircleCheck aria-hidden="true" className="size-3.5 text-fg" />
                          ) : null}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                  {bill === null ? null : (
                    <>
                      <DropdownMenuSeparator />
                      <p className="px-3 py-1.5 text-[11.5px] text-subtle">
                        {m.subscriptions_menu_effective({ date: formatDate(bill.dueDate, locale, 'day') })}
                      </p>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem
              icon={History}
              onSelect={() => {
                actions.open(subscription);
              }}
            >
              {m.subscriptions_menu_history()}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {status === 'active' ? (
              <DropdownMenuItem
                icon={CirclePause}
                onSelect={() => {
                  actions.pause(subscription);
                }}
              >
                {m.subscriptions_action_pause()}
              </DropdownMenuItem>
            ) : null}
            {status === 'cancelled' ? (
              <DropdownMenuItem
                icon={Trash2}
                variant="destructive"
                onSelect={() => {
                  actions.remove(subscription);
                }}
              >
                {m.subscriptions_menu_delete()}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                icon={CircleX}
                variant="destructive"
                onSelect={() => {
                  actions.cancel(subscription);
                }}
              >
                {m.subscriptions_menu_cancel()}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const active = rows('active');
  const paused = rows('paused');
  const cancelled = rows('cancelled');
  const yearlyOnly = active
    .filter((subscription) => subscription.cycle === 'yearly' && subscription.currency === baseCurrency)
    .reduce((total, subscription) => total + subscription.priceMinor, 0n);
  const pausedMonthly = paused
    .filter((subscription) => subscription.currency === baseCurrency)
    .reduce((total, subscription) => total + subscription.monthlyMinor, 0n);
  const headers = {
    active: [
      m.subscriptions_col_service(),
      m.subscriptions_col_next(),
      m.subscriptions_col_account(),
      m.subscriptions_col_usage(),
      m.subscriptions_col_price(),
    ],
    paused: [
      m.subscriptions_col_service(),
      m.subscriptions_col_resumes(),
      m.subscriptions_col_account(),
      m.subscriptions_col_status(),
      m.subscriptions_col_price(),
    ],
    cancelled: [
      m.subscriptions_col_service(),
      m.subscriptions_col_ended(),
      m.subscriptions_col_account(),
      m.subscriptions_col_status(),
      m.subscriptions_col_old_price(),
    ],
  } as const;

  const table = (status: SubscriptionStatus, list: readonly SubscriptionView[], footer: ReactNode) => (
    <TabsContent value={status} className="flex flex-col">
      {list.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-subtle">{m.subscriptions_table_empty()}</p>
      ) : (
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="border-b border-border text-[11.5px] text-subtle">
              {headers[status].map((header, index) => (
                <th
                  key={header}
                  scope="col"
                  className={`px-3 py-2.5 font-normal first:pl-5 ${index === 0 ? 'w-[34%]' : ''} ${index === 2 || index === 3 ? 'hidden lg:table-cell' : ''} ${index === 4 ? 'text-right' : ''}`}
                >
                  {header}
                </th>
              ))}
              <th scope="col" className="w-12 pr-4">
                <span className="sr-only">{m.subscriptions_col_actions()}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((subscription) => {
              const saved = savedSoFar(subscription, today);
              const account = accountOf.get(subscription.payFromAccountId);
              const overdue =
                subscription.nextBill !== null &&
                subscription.nextBill.dueDate < today &&
                subscription.nextBill.status !== 'scheduled';
              return (
                <tr
                  key={subscription.id}
                  data-overdue={overdue ? 'true' : undefined}
                  className="border-b border-border last:border-b-0 data-[overdue=true]:bg-amber-tint-1"
                >
                  <td className="py-3 pr-3 pl-5">{service(subscription)}</td>
                  <td className="px-3 py-3">
                    {status === 'active' ? (
                      nextBillCell(subscription)
                    ) : status === 'paused' ? (
                      <div className="flex flex-col text-[13px] text-fg">
                        {subscription.pausedUntil === null
                          ? '—'
                          : m.subscriptions_resumes_on({ date: formatDate(subscription.pausedUntil, locale, 'date') })}
                        {subscription.pausedOn === null ? null : (
                          <span className="text-[11.5px] text-subtle">
                            {m.subscriptions_paused_since({ date: formatDate(subscription.pausedOn, locale, 'day') })}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col text-[13px] text-fg">
                        {subscription.endsOn === null
                          ? '—'
                          : m.subscriptions_ended_on({ date: formatDate(subscription.endsOn, locale, 'date') })}
                        {subscription.endsOn === null ? null : (
                          <span className="text-[11.5px] text-subtle">
                            {m.subscriptions_months_ago({ months: monthsBetween(subscription.endsOn, today) })}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 text-[13px] text-muted-fg lg:table-cell">
                    {account?.displayName ?? '—'}
                  </td>
                  <td className="hidden px-3 py-3 lg:table-cell">
                    {status === 'active' ? (
                      subscription.usageRating === null ? (
                        <span className="inline-flex rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] text-subtle">
                          {m.subscriptions_usage_unrated()}
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] ${USAGE_TONE[subscription.usageRating]}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`size-1.5 rounded-full ${USAGE_DOT[subscription.usageRating]}`}
                          />
                          {USAGE_LABEL[subscription.usageRating]()}
                        </span>
                      )
                    ) : (
                      <span className="inline-flex rounded-[5px] bg-tint-06 px-1.5 py-0.5 text-[11px] text-muted-fg">
                        {status === 'paused' ? m.subscriptions_status_paused() : m.subscriptions_status_cancelled()}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {status === 'active'
                      ? priceCell(subscription)
                      : priceCell(
                          subscription,
                          <span className="text-green-fg">
                            <RichMessage
                              message={m.subscriptions_saved}
                              slots={{
                                amount: (
                                  <Money
                                    minor={saved.savedMinor}
                                    currency={subscription.currency}
                                    context="amount"
                                    locale={locale}
                                  />
                                ),
                              }}
                            />
                          </span>,
                        )}
                  </td>
                  <td className="pr-4 text-right">{menu(subscription)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="border-t border-border px-5 py-3 text-[12px] text-subtle">{footer}</p>
    </TabsContent>
  );

  return (
    <section aria-labelledby="subscriptions-all" className="flex flex-col rounded-[12px] border border-border bg-card">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          onTabChange(value as SubscriptionStatus);
        }}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <h2 id="subscriptions-all" className="text-[15px] font-semibold text-fg">
            {m.subscriptions_table_title()}
          </h2>
          <TabsList label={m.subscriptions_tabs_label()}>
            <TabsTrigger value="active">{m.subscriptions_tab_active({ count: overview.counts.active })}</TabsTrigger>
            <TabsTrigger value="paused">{m.subscriptions_tab_paused({ count: overview.counts.paused })}</TabsTrigger>
            <TabsTrigger value="cancelled">
              {m.subscriptions_tab_cancelled({ count: overview.counts.cancelled })}
            </TabsTrigger>
          </TabsList>
        </header>
        {filter === null ? null : (
          <div className="mx-5 mb-3 flex items-center gap-2 rounded-[8px] border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-muted-fg">
            <span className="flex-1">
              {'ids' in filter
                ? filter.label
                : m.subscriptions_filter_summary({
                    count: active.length,
                    category:
                      filter.categoryId === null
                        ? m.subscriptions_uncategorized()
                        : categoryName(categoryOf.get(filter.categoryId) ?? { name: '', builtInKey: null }),
                  })}
              {share === undefined ? null : (
                <>
                  {' · '}
                  <RichMessage
                    message={m.subscriptions_filter_share}
                    slots={{ share: <Percent value={share.shareBps / 10_000} decimals={0} locale={locale} /> }}
                  />
                  {' · '}
                  <Money minor={share.monthlyMinor} currency={baseCurrency} context="amount" locale={locale} />
                  {m.subscriptions_per_month_suffix()}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={onClearFilter}
              aria-label={m.subscriptions_filter_clear()}
              className="flex size-6 items-center justify-center rounded-[6px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )}
        <div className="border-t border-border">
          {table(
            'active',
            active,
            <>
              {m.subscriptions_footer_active({ count: active.length })} ·{' '}
              <Money minor={overview.totals.monthlyMinor} currency={baseCurrency} context="amount" locale={locale} />
              {m.subscriptions_per_month_suffix()}
              {yearlyOnly === 0n ? null : (
                <>
                  {' + '}
                  <Money minor={yearlyOnly} currency={baseCurrency} context="amount" locale={locale} />
                  {m.subscriptions_per_year_suffix()}
                </>
              )}
            </>,
          )}
          {table(
            'paused',
            paused,
            <>
              {m.subscriptions_footer_paused({ count: paused.length })} · {m.subscriptions_saves()}{' '}
              <Money minor={pausedMonthly} currency={baseCurrency} context="amount" locale={locale} />
              {m.subscriptions_per_month_suffix()}
            </>,
          )}
          {table(
            'cancelled',
            cancelled,
            <>
              {m.subscriptions_footer_cancelled({ count: cancelled.length })} · {m.subscriptions_saved_total()}{' '}
              <Money minor={overview.cancelledSavedMinor} currency={baseCurrency} context="amount" locale={locale} />
            </>,
          )}
        </div>
      </Tabs>
    </section>
  );
}
