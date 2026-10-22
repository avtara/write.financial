// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How ⌘K shows and opens each search group (FR-S4). One entry per {@link SearchKind}; a module that adds a kind to
 * `lib/search.ts` adds its entry here and the palette lists it without further changes.
 */
import type { NavigateFn } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/i18n/locale';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Hash, Inbox, Receipt, Repeat, Shapes, Wallet, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { accountTypeLabel, categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import type { RecentEntityKind, SearchHits, SearchKind } from '../../lib/search.ts';
import { openSettings } from '../settings/settings-sections.ts';

/** What a result row shows. */
export interface ResultView {
  readonly title: string;
  readonly detail: string;
  readonly aside?: ReactNode;
}

export interface ResultGroup<H> {
  readonly heading: () => string;
  readonly icon: LucideIcon;
  /** The `recent_items` kind an opened hit is remembered under. */
  readonly recentKind: RecentEntityKind;
  readonly view: (hit: H, locale: Locale) => ResultView;
  /** Goes to the hit's page. */
  readonly open: (hit: H, navigate: NavigateFn) => Promise<void>;
}

/** What a pending item without a name is ("Usulan penutupan periode"). */
const REVIEW_REASON: Readonly<Record<SearchHits['review']['reason'], () => string>> = {
  ai_suggestion: m.cmdk_review_ai,
  import_row: m.cmdk_review_ai,
  category_deleted: m.review_category_heading,
  due_occurrence: m.cmdk_review_due,
  period_close_proposal: m.review_close_heading,
};

const withArchived = (text: string, archived: boolean) => (archived ? `${text} · ${m.cmdk_archived()}` : text);

export const RESULT_GROUPS: { readonly [K in SearchKind]: ResultGroup<SearchHits[K]> } = {
  transactions: {
    heading: m.cmdk_group_transactions,
    icon: Receipt,
    recentKind: 'transaction',
    view: (hit, locale) => {
      const where =
        hit.type === 'transfer'
          ? [`${hit.accountName} → ${hit.toAccountName ?? ''}`]
          : [hit.category === null ? m.cmdk_uncategorized() : categoryName(hit.category), hit.accountName];
      return {
        title: hit.title ?? (hit.type === 'transfer' ? m.cmdk_transfer() : m.cmdk_untitled()),
        detail: [formatDate(hit.localDate, locale, 'day'), ...where].join(' · '),
        aside: <Money minor={hit.amountMinor} currency={hit.currency} context="amount" locale={locale} />,
      };
    },
    // Until the Transactions page exists: the account the transaction moved money on.
    open: (hit, navigate) => navigate({ to: '/accounts', search: { account: hit.accountId } }),
  },
  review: {
    heading: m.review_title,
    icon: Inbox,
    recentKind: 'review',
    view: (hit, locale) => ({
      title: hit.title ?? REVIEW_REASON[hit.reason](),
      detail: [REVIEW_REASON[hit.reason](), hit.dueDate === null ? null : formatDate(hit.dueDate, locale, 'day')]
        .filter((part) => part !== null)
        .join(' · '),
      aside: <Money minor={hit.amountMinor} currency={hit.currency} context="amount" locale={locale} />,
    }),
    open: (hit, navigate) => navigate({ to: '/review', search: { item: hit.id } }),
  },
  accounts: {
    heading: m.cmdk_group_accounts,
    icon: Wallet,
    recentKind: 'account',
    view: (hit, locale) => ({
      title: hit.displayName,
      detail: withArchived(`${hit.providerName} · ${accountTypeLabel(hit.type)}`, hit.archived),
      aside: <Money minor={hit.balanceMinor} currency={hit.currency} context="amount" locale={locale} />,
    }),
    open: (hit, navigate) => navigate({ to: '/accounts', search: { account: hit.id } }),
  },
  subscriptions: {
    heading: m.cmdk_group_subscriptions,
    icon: Repeat,
    recentKind: 'subscription',
    view: (hit, locale) => ({
      title: hit.name,
      detail: [
        hit.plan,
        hit.status === 'paused'
          ? m.cmdk_subscription_paused()
          : hit.status === 'cancelled'
            ? m.cmdk_subscription_cancelled()
            : m.cmdk_subscription_next({ date: formatDate(hit.nextBillingDate, locale, 'day') }),
      ]
        .filter((part) => part !== null)
        .join(' · '),
      aside: <Money minor={hit.priceMinor} currency={hit.currency} context="amount" locale={locale} />,
    }),
    open: (hit, navigate) => navigate({ to: '/subscriptions', search: { subscription: hit.id } }),
  },
  categories: {
    heading: m.cmdk_group_categories,
    icon: Shapes,
    recentKind: 'category',
    view: (hit) => ({ title: categoryName(hit), detail: withArchived(categoryGroupLabel(hit.group), hit.archived) }),
    open: (_hit, navigate) => navigate(openSettings('categories')),
  },
  tags: {
    heading: m.cmdk_group_tags,
    icon: Hash,
    recentKind: 'tag',
    view: (hit) => ({ title: `#${hit.slug}`, detail: m.cmdk_tag_usage({ count: hit.usageCount }) }),
    open: (_hit, navigate) => navigate(openSettings('tags')),
  },
};
