// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Langganan" on the Overview (FR-D2, design `iUqiN`): the active subscriptions ("7 aktif · 3 tagihan dalam 7 hari"),
 * the monthly and yearly totals (Rp904.900 / ≈ Rp11.520.000), each one's share of the month as a stacked bar, the next
 * bills with "3 hari lagi" (this month's paid ones "Lunas"), the savings tip of a rarely used one (FR-SUB5), and
 * "Tambah" (the subscriptions page's form).
 */
import { Link } from '@tanstack/react-router';
import type { SubscriptionsOverview, SubscriptionView } from '@wf/db/schedules';
import { addDays, countDays } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Check, Lightbulb, Plus } from 'lucide-react';
import { COLOR_TOKENS } from '../../lib/colors.ts';
import { RichMessage } from '../rich-message.tsx';

export interface SubscriptionsCardProps {
  readonly overview: SubscriptionsOverview;
  readonly locale: Locale;
}

/** Rows shown; the rest are on the subscriptions page (M3). */
const MAX_ROWS = 6;
/** The avatar colours cycle through the palette (subscriptions have no colour of their own). */
const PALETTE = COLOR_TOKENS.filter((token) => token !== 'subtle');

export function SubscriptionsCard({ overview, locale }: SubscriptionsCardProps) {
  const { today, totals, baseCurrency } = overview;
  const active = overview.subscriptions
    .filter((subscription) => subscription.effectiveStatus === 'active')
    .toSorted((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate));
  const colorOf = new Map(active.map((subscription, index) => [subscription.id, PALETTE[index % PALETTE.length]]));
  const weekAhead = addDays(today, 7);
  const due = active.filter((s) => s.nextBillingDate >= today && s.nextBillingDate <= weekAhead).length;
  const billOf = new Map(overview.monthSchedule.map((bill) => [bill.subscriptionId, bill]));
  const tip = overview.couldSave[0];
  const tipSubscription = tip === undefined ? undefined : active.find((s) => s.id === tip.subscriptionId);
  // Each subscription's share of the month in the 0–1000 bar (base-currency monthly cycles).
  const monthly = active.filter((s) => s.monthlyMinor > 0n && s.currency === baseCurrency);
  const monthlyTotal = monthly.reduce((total, subscription) => total + subscription.monthlyMinor, 0n);
  const segments: { id: string; x: number; width: number }[] = [];
  let offset = 0;
  for (const subscription of monthly) {
    const length = (Number(subscription.monthlyMinor) / Number(monthlyTotal)) * 1000;
    segments.push({ id: subscription.id, x: offset, width: Math.max(length - 4, 2) });
    offset += length;
  }

  const badge = (subscription: SubscriptionView) => {
    const bill = billOf.get(subscription.id);
    if (bill?.status === 'paid' && subscription.nextBillingDate > bill.dueDate) {
      return (
        <span className="inline-flex items-center gap-1 rounded-[4px] bg-green-tint-2 px-1.5 text-[11px] text-green-fg">
          <Check aria-hidden="true" className="size-3" />
          {m.overview_subs_paid()}
        </span>
      );
    }
    if (bill?.status === 'unconfirmed') {
      return (
        <span className="rounded-[4px] bg-amber-tint-2 px-1.5 text-[11px] text-amber-fg">
          {m.overview_subs_unconfirmed()}
        </span>
      );
    }
    const days = countDays(today, subscription.nextBillingDate) - 1;
    return (
      <span
        className={`rounded-[4px] px-1.5 text-[11px] ${days <= 3 ? 'bg-amber-tint-2 text-amber-fg' : 'bg-tint-06 text-muted-fg'}`}
      >
        {days <= 0 ? m.overview_subs_due_today() : m.overview_subs_due_in({ days })}
      </span>
    );
  };

  return (
    <section
      aria-labelledby="overview-subscriptions"
      className="flex flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="overview-subscriptions" className="text-[15px] font-semibold text-fg">
            {m.overview_subs_title()}
          </h2>
          <p className="text-[12.5px] text-muted-fg">{m.overview_subs_caption({ active: active.length, due })}</p>
        </div>
        <Link
          to="/subscriptions"
          search={{ new: true }}
          aria-label={m.subscriptions_add()}
          className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-border px-2 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {m.overview_subs_add()}
        </Link>
      </div>
      {active.length === 0 ? (
        <p className="text-[13px] text-subtle">{m.overview_subs_empty()}</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px] text-subtle">{m.overview_subs_monthly()}</span>
              <Money
                minor={totals.monthlyMinor}
                currency={baseCurrency}
                context="amount"
                locale={locale}
                className="text-[24px] leading-tight font-medium text-fg"
              />
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[11.5px] text-subtle">{m.overview_subs_yearly()}</span>
              <span className="flex items-baseline gap-1 text-[13px] text-muted-fg">
                <span aria-hidden="true">{m.overview_accounts_approx()}</span>
                <Money minor={totals.approxYearlyMinor} currency={baseCurrency} context="amount" locale={locale} />
              </span>
            </div>
          </div>
          <svg aria-hidden="true" viewBox="0 0 1000 6" preserveAspectRatio="none" className="block h-1.5 w-full">
            {segments.map((segment) => (
              <rect
                key={segment.id}
                data-color={colorOf.get(segment.id)}
                x={segment.x}
                width={segment.width}
                height="6"
                rx="3"
                className="fill-[var(--wf-color,var(--subtle))]"
              />
            ))}
          </svg>
          <ul aria-label={m.overview_subs_list()} className="flex flex-col">
            {active.slice(0, MAX_ROWS).map((subscription) => (
              <li
                key={subscription.id}
                className="flex items-center gap-3 border-b border-border py-3 last:border-b-0 last:pb-0"
              >
                <span
                  data-color={colorOf.get(subscription.id)}
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_srgb,var(--wf-color,var(--subtle))_16%,transparent)] text-[13px] font-semibold text-[var(--wf-color,var(--subtle))]"
                >
                  {subscription.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-fg">{subscription.name}</span>
                  <span className="truncate text-[11.5px] text-subtle">
                    {[subscription.plan, formatDate(subscription.nextBillingDate, locale, 'day')]
                      .filter((part) => part !== null && part !== '')
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Money
                    minor={subscription.priceMinor}
                    currency={subscription.currency}
                    context="amount"
                    locale={locale}
                    className="text-[13px] text-fg"
                  />
                  {badge(subscription)}
                </span>
              </li>
            ))}
          </ul>
          {tip === undefined || tipSubscription === undefined ? null : (
            <p className="flex gap-2.5 rounded-[10px] border border-border bg-surface-2 p-3 text-[12px] text-muted-fg">
              <Lightbulb aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-amber-fg" />
              <span>
                <span className="font-medium text-fg">
                  <RichMessage
                    message={m.overview_subs_save}
                    slots={{
                      amount: (
                        <Money minor={tip.yearlyMinor} currency={baseCurrency} context="amount" locale={locale} />
                      ),
                    }}
                  />
                </span>{' '}
                {m.overview_subs_save_body({ name: tipSubscription.name })}
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
