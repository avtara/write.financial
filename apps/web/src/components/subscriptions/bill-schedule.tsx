// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Jadwal tagihan Oktober" (FR-SUB2, design `CZmJm`, tooltip `OWkue`): this month's bills on a day axis — will be
 * charged, paid, unconfirmed — with today's marker, a tooltip per bill (account, balance after, reminder, status),
 * and the month's sums. Above it the FR-SUB6 warnings: a bill due tomorrow (`C861Ys`, "Mau dijeda dulu?"), bills
 * past their date nobody confirmed (`Lu10H`, "Ya, catat" / "Belum ditagih"), and paying accounts that cannot cover
 * their bills (`IFaSb`, "Top-up" / "Ganti rekening").
 */
import type { AccountView } from '@wf/db/accounts';
import type { MonthBill, MonthBillStatus, SubscriptionsOverview, SubscriptionView } from '@wf/db/schedules';
import { addDays, type LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Tooltip } from '@wf/ui/tooltip';
import { ArrowRight, BellRing, CircleHelp, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../form.tsx';
import { SubscriptionAvatar } from './subscription-avatar.tsx';
import {
  balanceCheck,
  billClusters,
  daysFrom,
  dueTomorrow,
  overdueBills,
  type Shortfall,
} from './subscriptions-model.ts';

/** One literal class per day column (Tailwind only generates classes it finds in the source). */
const COLUMN_START = [
  'col-start-1',
  'col-start-2',
  'col-start-3',
  'col-start-4',
  'col-start-5',
  'col-start-6',
  'col-start-7',
  'col-start-8',
  'col-start-9',
  'col-start-10',
  'col-start-11',
  'col-start-12',
  'col-start-13',
  'col-start-14',
  'col-start-15',
  'col-start-16',
  'col-start-17',
  'col-start-18',
  'col-start-19',
  'col-start-20',
  'col-start-21',
  'col-start-22',
  'col-start-23',
  'col-start-24',
  'col-start-25',
  'col-start-26',
  'col-start-27',
  'col-start-28',
  'col-start-29',
  'col-start-30',
  'col-start-31',
] as const;

const MONTH_COLUMNS: Readonly<Record<number, string>> = {
  28: 'grid-cols-[repeat(28,minmax(0,1fr))]',
  29: 'grid-cols-[repeat(29,minmax(0,1fr))]',
  30: 'grid-cols-[repeat(30,minmax(0,1fr))]',
  31: 'grid-cols-[repeat(31,minmax(0,1fr))]',
};

const STATUS_DOT: Readonly<Record<MonthBillStatus, string>> = {
  will_charge: 'bg-fg',
  paid: 'bg-subtle',
  unconfirmed: 'bg-amber',
};

const STATUS_LABEL: Readonly<Record<MonthBillStatus, () => string>> = {
  will_charge: m.subscriptions_schedule_will_charge,
  paid: m.subscriptions_schedule_paid,
  unconfirmed: m.subscriptions_schedule_unconfirmed,
};

/** The axis ticks (design: 1 · 8 · 15 · 22 · 29). */
const TICKS = [1, 8, 15, 22, 29];

export interface BillScheduleProps {
  readonly overview: SubscriptionsOverview;
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
  /** Occurrences the user said were not charged yet: no warning for them during this visit. */
  readonly snoozed?: readonly string[];
  /** "Ya, catat": the bill was charged; confirmed through the Review queue. */
  readonly onConfirm: (subscription: SubscriptionView, occurrenceId: string) => void;
  /** "Belum ditagih": it stays waiting in the Review queue. */
  readonly onNotCharged: (subscription: SubscriptionView, occurrenceId: string) => void;
  readonly onPause: (subscription: SubscriptionView) => void;
  readonly onOpen: (subscription: SubscriptionView) => void;
  readonly onTopUp: (shortfall: Shortfall) => void;
  readonly onChangeAccount: (subscription: SubscriptionView) => void;
}

export function BillSchedule({
  overview,
  accounts,
  locale,
  snoozed = [],
  onConfirm,
  onNotCharged,
  onPause,
  onOpen,
  onTopUp,
  onChangeAccount,
}: BillScheduleProps) {
  const { today, baseCurrency, monthSchedule } = overview;
  const monthStart = `${today.slice(0, 7)}-01` as LocalDate;
  // Day 0 of the next month is this month's last day.
  const monthDays = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${monthStart}T00:00:00Z`),
  );
  const subscriptionOf = new Map(overview.subscriptions.map((subscription) => [subscription.id, subscription]));
  const accountOf = new Map(accounts.map((account) => [account.id, account]));
  const overdue = overdueBills(overview).filter((due) => !snoozed.includes(due.occurrenceId));
  const tomorrow = dueTomorrow(overview);
  const { short, covered } = balanceCheck(overview, accounts);

  const status = (() => {
    if (overdue.length > 0) {
      return <span className="text-amber-fg">{m.subscriptions_schedule_overdue({ count: overdue.length })}</span>;
    }
    const [first] = short;
    if (first !== undefined) {
      return (
        <span className="text-red-fg">
          {m.subscriptions_schedule_short({ account: first.account.displayName, count: first.bills.length })}
        </span>
      );
    }
    if (covered.length > 0) {
      return m.subscriptions_schedule_covered({ accounts: covered.map((account) => account.displayName).join(', ') });
    }
    return m.subscriptions_schedule_nothing_left();
  })();

  const sum = (bills: readonly MonthBill[]) =>
    bills.filter((bill) => bill.currency === baseCurrency).reduce((total, bill) => total + bill.amountMinor, 0n);
  const paid = monthSchedule.filter((bill) => bill.status === 'paid');
  const unconfirmed = monthSchedule.filter((bill) => bill.status === 'unconfirmed');
  const [firstUnconfirmed] = unconfirmed;
  const left = monthSchedule.filter((bill) => bill.status === 'will_charge' && bill.dueDate >= today);
  const largest = left
    .filter((bill) => bill.currency === baseCurrency)
    .toSorted((a, b) => Number(b.amountMinor - a.amountMinor))[0];
  const clusters = billClusters(monthSchedule);
  const todayIndex = Number(today.slice(8)) - 1;

  const billTip = (bill: MonthBill) => {
    const subscription = subscriptionOf.get(bill.subscriptionId);
    const account = subscription === undefined ? undefined : accountOf.get(subscription.payFromAccountId);
    const remind = subscription?.remindDaysBefore ?? null;
    const sameCurrency = account !== undefined && account.currency === bill.currency;
    const rows: [string, ReactNode][] = [[m.subscriptions_tip_from(), account?.displayName ?? '—']];
    if (bill.status === 'will_charge' && sameCurrency) {
      rows.push([
        m.subscriptions_tip_balance_after(),
        <Money
          minor={account.balanceMinor - bill.amountMinor}
          currency={bill.currency}
          context="amount"
          locale={locale}
        />,
      ]);
    }
    if (bill.status === 'will_charge' && remind !== null) {
      rows.push([
        m.subscriptions_tip_reminder(),
        m.subscriptions_tip_reminder_value({
          days: remind,
          date: formatDate(addDays(bill.dueDate, -remind), locale, 'day'),
        }),
      ]);
    }
    rows.push([
      m.subscriptions_tip_status(),
      bill.status !== 'will_charge'
        ? STATUS_LABEL[bill.status]()
        : !sameCurrency || account.type === 'credit_card'
          ? m.subscriptions_schedule_will_charge()
          : account.balanceMinor >= bill.amountMinor
            ? m.subscriptions_tip_enough()
            : m.subscriptions_tip_short(),
    ]);
    const until = daysFrom(today, bill.dueDate);
    return {
      heading: bill.name,
      content: (
        <span className="flex min-w-[200px] flex-col gap-1.5">
          <span className="text-subtle">
            {formatDate(bill.dueDate, locale, 'weekday')}
            {bill.dueDate >= today
              ? ` · ${until === 0 ? m.subscriptions_due_today() : m.subscriptions_due_in({ days: until })}`
              : ''}
          </span>
          {rows.map(([label, value]) => (
            <span key={label} className="flex justify-between gap-4">
              <span className="text-subtle">{label}</span>
              <span>{value}</span>
            </span>
          ))}
        </span>
      ),
    };
  };

  return (
    <section
      aria-labelledby="subscriptions-schedule"
      className="flex flex-col gap-5 rounded-[12px] border border-border bg-card px-5 py-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="subscriptions-schedule" className="text-[15px] font-semibold text-fg">
            {m.subscriptions_schedule_title({ month: monthName })}
          </h2>
          <p className="text-[12.5px] text-muted-fg">{status}</p>
        </div>
        <ul aria-label={m.subscriptions_schedule_legend()} className="flex flex-wrap gap-3 text-[11.5px] text-muted-fg">
          {(['will_charge', 'paid', 'unconfirmed'] as const).map((key) => (
            <li key={key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-2 rounded-[2px] ${STATUS_DOT[key]}`} />
              {STATUS_LABEL[key]()}
            </li>
          ))}
        </ul>
      </header>

      {tomorrow.map((subscription) => {
        const account = accountOf.get(subscription.payFromAccountId);
        const date = formatDate(subscription.nextBillingDate, locale, 'weekday');
        return (
          <Banner
            key={`tomorrow-${subscription.id}`}
            tone="info"
            icon={<BellRing aria-hidden="true" className="size-4" />}
            title={
              <>
                {m.subscriptions_tomorrow_title({ name: subscription.name })}{' '}
                <Money
                  minor={subscription.priceMinor}
                  currency={subscription.currency}
                  context="amount"
                  locale={locale}
                />
              </>
            }
            body={
              account === undefined || account.currency !== subscription.currency
                ? m.subscriptions_tomorrow_body_plain({ date, account: account?.displayName ?? '—' })
                : m.subscriptions_tomorrow_body({
                    date,
                    account: account.displayName,
                    balance:
                      account.balanceMinor >= subscription.priceMinor
                        ? m.subscriptions_tip_enough()
                        : m.subscriptions_tip_short(),
                  })
            }
            actions={
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onPause(subscription);
                  }}
                >
                  {m.subscriptions_action_pause()}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onOpen(subscription);
                  }}
                >
                  {m.subscriptions_action_view()}
                </Button>
              </>
            }
          />
        );
      })}

      {overdue.map(({ subscription, occurrenceId, dueDate }) => {
        const account = accountOf.get(subscription.payFromAccountId);
        return (
          <Banner
            key={`overdue-${subscription.id}`}
            tone="warning"
            icon={<CircleHelp aria-hidden="true" className="size-4" />}
            title={
              <>
                {subscription.name}{' '}
                <Money
                  minor={subscription.priceMinor}
                  currency={subscription.currency}
                  context="amount"
                  locale={locale}
                />{' '}
                {m.subscriptions_overdue_body({
                  date: formatDate(dueDate, locale, 'day'),
                  account: account?.displayName ?? '—',
                })}
              </>
            }
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    onConfirm(subscription, occurrenceId);
                  }}
                >
                  {m.subscriptions_overdue_yes()}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onNotCharged(subscription, occurrenceId);
                  }}
                >
                  {m.subscriptions_overdue_not_yet()}
                </Button>
              </>
            }
          />
        );
      })}

      {short.map((shortfall) => {
        const { first } = shortfall;
        return (
          <Banner
            key={`short-${shortfall.account.id}`}
            tone="danger"
            icon={<Wallet aria-hidden="true" className="size-4" />}
            title={
              <>
                {shortfall.bills.map(({ subscription }) => subscription.name).join(', ')}{' '}
                <Money
                  minor={shortfall.totalMinor}
                  currency={shortfall.account.currency}
                  context="amount"
                  locale={locale}
                />{' '}
                ·{' '}
                {m.subscriptions_short_when({
                  date: formatDate(first.bill.dueDate, locale, 'weekday'),
                  account: shortfall.account.displayName,
                })}
              </>
            }
            body={
              <>
                {m.subscriptions_short_balance({ account: shortfall.account.displayName })}{' '}
                <Money
                  minor={shortfall.account.balanceMinor}
                  currency={shortfall.account.currency}
                  context="amount"
                  locale={locale}
                />{' '}
                — {m.subscriptions_short_lacks()}{' '}
                <Money
                  minor={shortfall.shortMinor}
                  currency={shortfall.account.currency}
                  context="amount"
                  locale={locale}
                />
              </>
            }
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    onTopUp(shortfall);
                  }}
                >
                  {m.subscriptions_short_top_up()}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onChangeAccount(first.subscription);
                  }}
                >
                  {m.subscriptions_action_change_account()}
                </Button>
              </>
            }
          />
        );
      })}

      {monthSchedule.length === 0 ? (
        <p className="text-[13px] text-subtle">{m.subscriptions_schedule_empty({ month: monthName })}</p>
      ) : (
        <div className="overflow-x-auto">
          <ol
            aria-label={m.subscriptions_schedule_title({ month: monthName })}
            className={`relative grid min-w-[560px] ${MONTH_COLUMNS[monthDays] as string} gap-y-1 pt-1`}
          >
            <li
              aria-hidden="true"
              className={`${COLUMN_START[todayIndex] as string} row-span-3 row-start-1 flex justify-center`}
            >
              <span className="flex h-full flex-col items-center">
                <span className="rounded-[4px] bg-blue px-1.5 text-[10.5px] font-medium whitespace-nowrap text-on-accent">
                  {m.subscriptions_schedule_today()}
                </span>
                <span className="w-px flex-1 bg-blue" />
              </span>
            </li>
            {clusters.map((cluster) => {
              const [first] = cluster as [MonthBill, ...MonthBill[]];
              return (
                // Bills a few days apart stack at the first one's day, each label right above its own icon; the
                // stack's last icon sits on the axis.
                <li
                  key={first.dueDate}
                  className={`${COLUMN_START[Number(first.dueDate.slice(8)) - 1] as string} row-start-2 flex flex-col items-center gap-2 self-end`}
                >
                  {cluster.map((bill) => {
                    const subscription = subscriptionOf.get(bill.subscriptionId);
                    const tip = billTip(bill);
                    return (
                      <span key={bill.occurrenceId} className="flex flex-col items-center gap-1">
                        <span className="flex flex-col items-center font-mono text-[10.5px] whitespace-nowrap text-muted-fg">
                          <span>{formatDate(bill.dueDate, locale, 'day')}</span>
                          <Money
                            minor={bill.amountMinor}
                            currency={bill.currency}
                            context="amount"
                            locale={locale}
                            className="text-fg"
                          />
                        </span>
                        <Tooltip heading={tip.heading} content={tip.content}>
                          <button
                            type="button"
                            aria-label={m.subscriptions_schedule_bill_label({
                              name: bill.name,
                              date: formatDate(bill.dueDate, locale, 'day'),
                              status: STATUS_LABEL[bill.status](),
                            })}
                            onClick={() => {
                              if (subscription !== undefined) onOpen(subscription);
                            }}
                            data-status={bill.status}
                            className="relative rounded-[8px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring data-[status=paid]:opacity-50"
                          >
                            <SubscriptionAvatar
                              subscription={{
                                id: bill.subscriptionId,
                                name: bill.name,
                                icon: bill.icon,
                                logoKey: subscription?.logoKey ?? null,
                                catalogId: subscription?.catalogId ?? null,
                              }}
                              size="sm"
                            />
                            {bill.status === 'unconfirmed' ? (
                              <span
                                aria-hidden="true"
                                className="absolute -top-1 -right-1 size-2 rounded-full border border-card bg-amber"
                              />
                            ) : null}
                          </button>
                        </Tooltip>
                      </span>
                    );
                  })}
                </li>
              );
            })}
            <li aria-hidden="true" className="col-span-full row-start-3 border-t border-border-strong pt-1" />
            {TICKS.filter((tick) => tick <= monthDays).map((tick) => (
              <li
                key={tick}
                aria-hidden="true"
                className={`${COLUMN_START[tick - 1] as string} row-start-4 text-center font-mono text-[10.5px] text-subtle`}
              >
                {tick}
              </li>
            ))}
          </ol>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 md:grid-cols-4">
        <Sum
          label={m.subscriptions_sum_paid()}
          value=<Money minor={sum(paid)} currency={baseCurrency} context="amount" locale={locale} />
        >
          {paid.map((bill) => bill.name).join(', ')}
        </Sum>
        <Sum
          label={m.subscriptions_sum_unconfirmed()}
          value=<Money minor={sum(unconfirmed)} currency={baseCurrency} context="amount" locale={locale} />
          tone="warning"
        >
          {unconfirmed.map((bill) => `${bill.name} · ${formatDate(bill.dueDate, locale, 'day')}`).join(', ')}
          {firstUnconfirmed === undefined ? null : (
            <button
              type="button"
              onClick={() => {
                const subscription = subscriptionOf.get(firstUnconfirmed.subscriptionId);
                if (subscription !== undefined) onOpen(subscription);
              }}
              className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {m.subscriptions_sum_review()}
              <ArrowRight aria-hidden="true" className="size-3" />
            </button>
          )}
        </Sum>
        <Sum
          label={m.subscriptions_sum_left()}
          value=<Money minor={sum(left)} currency={baseCurrency} context="amount" locale={locale} />
        >
          {m.subscriptions_sum_bills({ count: left.length })}
        </Sum>
        <Sum
          label={m.subscriptions_sum_largest()}
          value={
            largest === undefined ? (
              '—'
            ) : (
              <Money minor={largest.amountMinor} currency={baseCurrency} context="amount" locale={locale} />
            )
          }
        >
          {largest === undefined ? null : `${largest.name} · ${formatDate(largest.dueDate, locale, 'day')}`}
        </Sum>
      </dl>
    </section>
  );
}

const BANNER_TONE = {
  info: 'border-border bg-surface-2 text-fg',
  warning: 'border-amber/40 bg-amber-tint-2 text-amber-fg',
  danger: 'border-red/40 bg-red-tint-2 text-red-fg',
} as const;

function Banner({
  tone,
  icon,
  title,
  body,
  actions,
}: {
  readonly tone: keyof typeof BANNER_TONE;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly body?: ReactNode;
  readonly actions: ReactNode;
}) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-3 rounded-[10px] border px-4 py-3 ${BANNER_TONE[tone]}`}
    >
      <span className="shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12.5px]">
        <span>{title}</span>
        {body === undefined ? null : <span className="text-muted-fg">{body}</span>}
      </div>
      <div className="flex shrink-0 gap-2">{actions}</div>
    </div>
  );
}

function Sum({
  label,
  value,
  tone,
  children,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: 'warning';
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className={`text-[12px] ${tone === 'warning' ? 'text-amber-fg' : 'text-subtle'}`}>{label}</dt>
      <dd className="text-[15px] font-medium text-fg">{value}</dd>
      <dd className="text-[11.5px] text-subtle">{children}</dd>
    </div>
  );
}
