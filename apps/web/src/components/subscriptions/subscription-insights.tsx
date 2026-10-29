// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The subscriptions page's side cards (FR-SUB2/SUB5, design `CZmJm`, `u8sjx`, `UZLdT`): "Review bulanan" — how often
 * the user uses each active subscription, rated by the user ("write.financial tidak membaca aktivitas aplikasi lain")
 * with "Pertimbangkan berhenti" once a rarely used one is found —, "Bisa dihemat" from the billing pattern (rarely
 * used, overlapping functions, price increases, untracked recurring charges), and "Per kategori" (a donut whose
 * legend filters the table).
 */
import type { CategoryView } from '@wf/db/categories';
import type { DetectedOverview, SubscriptionsOverview, SubscriptionView } from '@wf/db/schedules';
import { USAGE_RATINGS, type UsageRating } from '@wf/domain/subscriptions';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { ArrowRight, Copy, Lightbulb, ScanSearch, ShieldCheck, TrendingUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { colorProps } from '../../lib/colors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import { CATEGORY_ICONS } from '../category-icon.tsx';
import { RichMessage } from '../rich-message.tsx';
import { SubscriptionAvatar } from './subscription-avatar.tsx';
import { USAGE_LABEL } from './subscription-table.tsx';
import { overlaps, usageReview } from './subscriptions-model.ts';

const USAGE_DOT: Readonly<Record<UsageRating, string>> = { often: 'bg-green', sometimes: 'bg-amber', rarely: 'bg-red' };

const CARD = 'flex flex-col gap-4 rounded-[12px] border border-border bg-card px-5 py-5';

export interface UsageReviewCardProps {
  readonly overview: SubscriptionsOverview;
  readonly locale: Locale;
  readonly onRate: (subscription: SubscriptionView, rating: UsageRating) => void;
  readonly onCancel: (subscription: SubscriptionView) => void;
}

export function UsageReviewCard({ overview, locale, onRate, onCancel }: UsageReviewCardProps) {
  const review = usageReview(overview);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const rarely = overview.couldSave
    .flatMap((saving) => {
      const subscription = overview.subscriptions.find((candidate) => candidate.id === saving.subscriptionId);
      return subscription === undefined || dismissed.includes(saving.subscriptionId) ? [] : [{ saving, subscription }];
    })
    .at(0);
  const next = review.next;
  return (
    <section aria-labelledby="subscriptions-review" className={CARD}>
      <header className="flex items-center justify-between gap-2">
        <h2 id="subscriptions-review" className="text-[15px] font-semibold text-fg">
          {m.subscriptions_review_title()}
        </h2>
        <span className="font-mono text-[12px] text-subtle">
          {m.subscriptions_review_rated({ rated: review.rated, total: review.total })}
        </span>
      </header>
      {next === null ? (
        rarely === undefined ? (
          <p className="text-[12.5px] text-subtle">{m.subscriptions_review_done()}</p>
        ) : (
          <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-2 p-3">
            <span className="text-[13px] font-medium text-fg">{m.subscriptions_review_consider()}</span>
            <span className="text-[12px] text-muted-fg">
              <RichMessage
                message={m.subscriptions_review_consider_body}
                slots={{
                  name: rarely.subscription.name,
                  amount: (
                    <Money
                      minor={rarely.saving.yearlyMinor}
                      currency={overview.baseCurrency}
                      context="amount"
                      locale={locale}
                    />
                  ),
                }}
              />
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  onCancel(rarely.subscription);
                }}
                className="text-[12.5px] font-medium text-red-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {m.subscriptions_review_cancel()}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDismissed((current) => [...current, rarely.saving.subscriptionId]);
                }}
                className="text-[12.5px] font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {m.subscriptions_review_ask_later()}
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-[10px] border border-border p-3">
            <SubscriptionAvatar subscription={next} />
            <div className="flex min-w-0 flex-col">
              <span className="text-[13px] font-medium text-fg">
                {m.subscriptions_review_question({ name: next.name })}
              </span>
              {next.nextBill === null ? null : (
                <span className="text-[11.5px] text-subtle">
                  {m.subscriptions_review_billed({ date: formatDate(next.nextBill.dueDate, locale, 'day') })} ·{' '}
                  <Money minor={next.priceMinor} currency={next.currency} context="amount" locale={locale} />
                </span>
              )}
            </div>
          </div>
          <div
            role="group"
            aria-label={m.subscriptions_review_question({ name: next.name })}
            className="grid grid-cols-3 gap-2"
          >
            {USAGE_RATINGS.map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => {
                  onRate(next, rating);
                }}
                className="flex h-9 items-center justify-center gap-1.5 rounded-[8px] border border-border text-[12.5px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span aria-hidden="true" className={`size-1.5 rounded-full ${USAGE_DOT[rating]}`} />
                {USAGE_LABEL[rating]()}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="flex gap-2 text-[11.5px] text-subtle">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {m.subscriptions_review_privacy()}
      </p>
    </section>
  );
}

export interface SavingsCardProps {
  readonly overview: SubscriptionsOverview;
  readonly detected: DetectedOverview | null;
  readonly locale: Locale;
  readonly onCancel: (subscription: SubscriptionView) => void;
  readonly onCompare: (ids: readonly string[], label: string) => void;
  readonly onOpen: (subscription: SubscriptionView) => void;
  readonly onDetect: () => void;
}

export function SavingsCard({ overview, detected, locale, onCancel, onCompare, onOpen, onDetect }: SavingsCardProps) {
  const byId = new Map(overview.subscriptions.map((subscription) => [subscription.id, subscription]));
  const items: { key: string; icon: ReactNode; title: ReactNode; body: ReactNode; action: ReactNode }[] = [];
  for (const saving of overview.couldSave) {
    const subscription = byId.get(saving.subscriptionId);
    if (subscription === undefined) continue;
    items.push({
      key: `rarely-${saving.subscriptionId}`,
      icon: <Lightbulb aria-hidden="true" className="size-4 text-amber-fg" />,
      title: m.subscriptions_save_rarely({ name: subscription.name }),
      body: (
        <RichMessage
          message={m.subscriptions_save_rarely_body}
          slots={{
            amount: (
              <Money minor={saving.yearlyMinor} currency={overview.baseCurrency} context="amount" locale={locale} />
            ),
          }}
        />
      ),
      action: (
        <Action
          onClick={() => {
            onCancel(subscription);
          }}
        >
          {m.subscriptions_review_cancel()}
        </Action>
      ),
    });
  }
  for (const group of overlaps(overview)) {
    const label = CATEGORY_ICONS[group.icon]?.label() ?? group.icon;
    const ids = overview.subscriptions
      .filter((subscription) => subscription.effectiveStatus === 'active' && subscription.icon === group.icon)
      .map((subscription) => subscription.id);
    items.push({
      key: `overlap-${group.icon}`,
      icon: <Copy aria-hidden="true" className="size-4 text-violet" />,
      title: m.subscriptions_save_overlap({ function: label.toLowerCase() }),
      body: m.subscriptions_save_overlap_body({ names: group.names.join(', ') }),
      action: (
        <Action
          onClick={() => {
            onCompare(ids, m.subscriptions_save_overlap({ function: label.toLowerCase() }));
          }}
        >
          {m.subscriptions_save_compare()}
        </Action>
      ),
    });
  }
  for (const increase of overview.priceIncreases) {
    const subscription = byId.get(increase.subscriptionId);
    if (subscription === undefined || subscription.effectiveStatus !== 'active') continue;
    items.push({
      key: `increase-${increase.subscriptionId}`,
      icon: <TrendingUp aria-hidden="true" className="size-4 text-red-fg" />,
      title: (
        <RichMessage
          message={m.subscriptions_save_increase}
          slots={{
            name: subscription.name,
            change: <Percent value={increase.increaseBps / 10_000} locale={locale} />,
          }}
        />
      ),
      body: (
        <>
          <Money minor={increase.previousMinor} currency={overview.baseCurrency} context="amount" locale={locale} /> →{' '}
          <Money minor={increase.currentMinor} currency={overview.baseCurrency} context="amount" locale={locale} />{' '}
          {m.subscriptions_detail_since_month({
            month: new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
              new Date(`${increase.since}T00:00:00Z`),
            ),
          })}
        </>
      ),
      action: (
        <Action
          onClick={() => {
            onOpen(subscription);
          }}
        >
          {m.subscriptions_detail_price_history()}
        </Action>
      ),
    });
  }
  const candidates = detected?.candidates ?? [];
  if (candidates.length > 0) {
    items.push({
      key: 'detected',
      icon: <ScanSearch aria-hidden="true" className="size-4 text-blue-fg" />,
      title: m.subscriptions_save_untracked({ count: candidates.length }),
      body: (
        <>
          {candidates.map((candidate, index) => (
            <span key={candidate.id}>
              {index > 0 ? ', ' : ''}
              {candidate.merchant}{' '}
              <Money minor={candidate.amountMinor} currency={candidate.currency} context="amount" locale={locale} />
            </span>
          ))}
          {'. '}
          {m.subscriptions_save_untracked_times({ count: Math.min(...candidates.map((c) => c.occurrences)) })}
        </>
      ),
      action: <Action onClick={onDetect}>{m.subscriptions_sum_review()}</Action>,
    });
  }
  return (
    <section aria-labelledby="subscriptions-savings" className={CARD}>
      <header className="flex flex-col gap-0.5">
        <h2 id="subscriptions-savings" className="text-[15px] font-semibold text-fg">
          {m.subscriptions_save_title()}
        </h2>
        <p className="text-[12px] text-subtle">{m.subscriptions_save_caption()}</p>
      </header>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-subtle">{m.subscriptions_save_none()}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.key} className="flex gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-tint-06">
                {item.icon}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[13px] font-medium text-fg">{item.title}</span>
                <span className="text-[12px] text-muted-fg">{item.body}</span>
                {item.action}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Action({ onClick, children }: { readonly onClick: () => void; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1 text-[12.5px] font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3" />
    </button>
  );
}

export interface CategoryShareCardProps {
  readonly overview: SubscriptionsOverview;
  readonly categories: readonly CategoryView[];
  readonly locale: Locale;
  readonly selected: string | null | undefined;
  readonly onSelect: (categoryId: string | null) => void;
}

export function CategoryShareCard({ overview, categories, locale, selected, onSelect }: CategoryShareCardProps) {
  const categoryOf = new Map(categories.map((category) => [category.id, category]));
  // Each arc starts where the previous ones end (percent of the circle).
  const segments = overview.byCategory.map((share, index) => ({
    share,
    length: share.shareBps / 100,
    offset: overview.byCategory.slice(0, index).reduce((total, before) => total + before.shareBps / 100, 0),
  }));
  return (
    <section aria-labelledby="subscriptions-categories" className={CARD}>
      <h2 id="subscriptions-categories" className="text-[15px] font-semibold text-fg">
        {m.subscriptions_categories_title()}
      </h2>
      {segments.length === 0 ? (
        <p className="text-[12.5px] text-subtle">{m.subscriptions_categories_empty()}</p>
      ) : (
        <div className="flex items-center gap-5">
          <div className="relative size-[112px] shrink-0">
            <svg aria-hidden="true" viewBox="0 0 42 42" className="size-full -rotate-90">
              <circle cx="21" cy="21" r="15.915" fill="none" strokeWidth="6" className="stroke-tint-06" />
              {segments.map(({ share, length, offset: start }) => {
                const category = share.categoryId === null ? undefined : categoryOf.get(share.categoryId);
                return (
                  <circle
                    key={share.categoryId ?? 'none'}
                    {...colorProps(category?.color ?? 'subtle')}
                    cx="21"
                    cy="21"
                    r="15.915"
                    fill="none"
                    strokeWidth="6"
                    strokeDasharray={`${String(Math.max(length - 0.6, 0.4))} ${String(100 - Math.max(length - 0.6, 0.4))}`}
                    strokeDashoffset={String(-start)}
                    className="stroke-[var(--wf-color,var(--subtle))]"
                  />
                );
              })}
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[20px] font-semibold text-fg">{overview.counts.active}</span>
              <span className="text-[10.5px] text-subtle">{m.subscriptions_categories_services()}</span>
            </span>
          </div>
          <ul aria-label={m.subscriptions_categories_filter()} className="flex min-w-0 flex-1 flex-col gap-1">
            {overview.byCategory.map((share) => {
              const category = share.categoryId === null ? undefined : categoryOf.get(share.categoryId);
              return (
                <li key={share.categoryId ?? 'none'}>
                  <button
                    type="button"
                    aria-pressed={selected === share.categoryId}
                    onClick={() => {
                      onSelect(share.categoryId);
                    }}
                    className="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-surface-2"
                  >
                    <span
                      {...colorProps(category?.color ?? 'subtle')}
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-[2px] bg-[var(--wf-color,var(--subtle))]"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {category === undefined ? m.subscriptions_uncategorized() : categoryName(category)}
                    </span>
                    <Percent value={share.shareBps / 10_000} locale={locale} className="text-subtle" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
