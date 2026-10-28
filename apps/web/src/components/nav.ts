// SPDX-License-Identifier: AGPL-3.0-only
/**
 * App navigation (PRD FR-S1). Only routes that exist are listed; each milestone adds its entries here,
 * and both the sidebar and the tablet rail render from this list. `to` must be a registered route path.
 */
import { m } from '@wf/i18n/messages';
import type { KbdKey } from '@wf/ui/kbd-hint';
import {
  ArrowLeftRight,
  CalendarDays,
  ChartPie,
  CandlestickChart,
  FileBarChart,
  HandCoins,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  PiggyBank,
  Repeat,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { FileRouteTypes } from '../generated/routeTree.gen.ts';

export interface NavItem {
  readonly to: FileRouteTypes['to'];
  readonly label: () => string;
  /** Sidebar icon (16 px). */
  readonly icon: LucideIcon;
  /** Tablet rail icon (17 px); the design uses a different glyph for some entries. */
  readonly railIcon: LucideIcon;
  /** `G` + letter navigation (design "Pintasan keyboard", NAVIGASI); pages the design gives no letter have none. */
  readonly shortcut?: readonly KbdKey[];
  /** Count shown next to the entry ("Transaksi 128"), from the `_app` loader's {@link NavCounts}. */
  readonly badge?: keyof NavCounts;
}

/** Counts the `_app` loader provides for nav badges; `null` when they could not be loaded. */
export interface NavCounts {
  /** Live transactions in the current period. */
  readonly transactions: number;
  /** Active subscriptions ("Langganan 7"). */
  readonly subscriptions: number;
  /** Pending Review queue items ("Perlu ditinjau"). */
  readonly review: number;
  /** Unread notifications (the bell, FR-S5). */
  readonly notifications: number;
}

export interface NavGroup {
  readonly label: () => string;
  readonly items: readonly NavItem[];
}

/**
 * Three short groups instead of one long list: the daily pages (Utama), what is planned ahead (Rencana), and what
 * the user owns and owes (Aset & utang). The rail draws a divider between them.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: m.nav_group_main,
    items: [
      { to: '/', label: m.nav_overview, icon: LayoutDashboard, railIcon: LayoutGrid, shortcut: ['G', 'R'] },
      {
        to: '/transactions',
        label: m.nav_transactions,
        icon: ArrowLeftRight,
        railIcon: ArrowLeftRight,
        shortcut: ['G', 'T'],
        badge: 'transactions',
      },
      { to: '/review', label: m.review_title, icon: Inbox, railIcon: Inbox, badge: 'review' },
      { to: '/reports', label: m.reports_title, icon: FileBarChart, railIcon: FileBarChart },
    ],
  },
  {
    label: m.nav_group_plan,
    items: [
      // A pie for how the money is shared out; the piggy bank stays Tabungan's, so the two read apart.
      { to: '/budget', label: m.nav_budget, icon: ChartPie, railIcon: ChartPie, shortcut: ['G', 'A'] },
      {
        to: '/subscriptions',
        label: m.nav_subscriptions,
        icon: Repeat,
        railIcon: Repeat,
        shortcut: ['G', 'L'],
        badge: 'subscriptions',
      },
      { to: '/calendar', label: m.nav_calendar, icon: CalendarDays, railIcon: CalendarDays },
    ],
  },
  {
    label: m.nav_group_assets,
    items: [
      { to: '/accounts', label: m.accounts_title, icon: Wallet, railIcon: Wallet },
      { to: '/goals', label: m.nav_goals, icon: PiggyBank, railIcon: PiggyBank },
      { to: '/investments', label: m.invest_title, icon: CandlestickChart, railIcon: CandlestickChart },
      { to: '/debts', label: m.debts_title, icon: HandCoins, railIcon: HandCoins },
    ],
  },
];
