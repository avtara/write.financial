// SPDX-License-Identifier: AGPL-3.0-only
/**
 * App navigation (PRD FR-S1). Only routes that exist are listed; each milestone adds its entries here,
 * and both the sidebar and the tablet rail render from this list. `to` must be a registered route path.
 */
import { m } from '@wf/i18n/messages';
import type { KbdKey } from '@wf/ui/kbd-hint';
import { LayoutDashboard, LayoutGrid, type LucideIcon } from 'lucide-react';
import type { FileRouteTypes } from '../generated/routeTree.gen.ts';

export interface NavItem {
  readonly to: FileRouteTypes['to'];
  readonly label: () => string;
  /** Sidebar icon (16 px). */
  readonly icon: LucideIcon;
  /** Tablet rail icon (17 px); the design uses a different glyph for some entries. */
  readonly railIcon: LucideIcon;
  /** `G` + letter navigation (design "Pintasan keyboard", NAVIGASI). */
  readonly shortcut: readonly KbdKey[];
}

export interface NavGroup {
  readonly label: () => string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: m.nav_menu,
    items: [{ to: '/', label: m.nav_overview, icon: LayoutDashboard, railIcon: LayoutGrid, shortcut: ['G', 'R'] }],
  },
];
