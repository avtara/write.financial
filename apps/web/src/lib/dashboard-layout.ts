// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Atur dashboard" (FR-D3, design `iBCvF`, `e1r8q`, `GcXr5`, `R1aqQ`): the Overview's cards below the Quick Add bar
 * and the KPIs (which stay on top), in the user's order, each shown or hidden and ⅓, ⅔, or full width. Saved in
 * `user_preferences.dashboard_layout`; whatever is stored there is read leniently ({@link dashboardLayoutOf}), so a
 * card added later appears in its default place and unknown ids are dropped.
 */
import * as z from 'zod';

export const DASHBOARD_CARDS = [
  'accounts',
  'flow',
  'categories',
  'cashflow',
  'budget',
  'calendar',
  'subscriptions',
  'investments',
  'goals',
  'bills',
] as const;
export type DashboardCard = (typeof DASHBOARD_CARDS)[number];

/** "Kartu lain yang bisa ditambahkan": off until added; hiding one puts it back there. */
export const ADDABLE_CARDS: readonly DashboardCard[] = ['investments', 'goals', 'bills'];

export const CARD_WIDTHS = ['third', 'twoThirds', 'full'] as const;
export type CardWidth = (typeof CARD_WIDTHS)[number];

export const DASHBOARD_LAYOUT = z.object({
  cards: z
    .array(z.object({ id: z.enum(DASHBOARD_CARDS), visible: z.boolean(), width: z.enum(CARD_WIDTHS) }))
    .max(DASHBOARD_CARDS.length)
    .refine((cards) => new Set(cards.map((card) => card.id)).size === cards.length, 'Duplicate card'),
});
export type DashboardLayout = z.infer<typeof DASHBOARD_LAYOUT>;
export type DashboardCardPrefs = DashboardLayout['cards'][number];

const DEFAULT_WIDTH: Readonly<Record<DashboardCard, CardWidth>> = {
  accounts: 'full',
  flow: 'full',
  categories: 'full',
  cashflow: 'twoThirds',
  budget: 'third',
  calendar: 'twoThirds',
  subscriptions: 'third',
  investments: 'third',
  goals: 'third',
  bills: 'third',
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  cards: DASHBOARD_CARDS.map((id) => ({ id, visible: !ADDABLE_CARDS.includes(id), width: DEFAULT_WIDTH[id] })),
};

/** What may be stored: card ids and widths of older or newer versions are tolerated here. */
const STORED_LAYOUT = z.object({
  cards: z.array(z.object({ id: z.string(), visible: z.boolean(), width: z.string() })),
});

/**
 * The layout stored under `dashboard_layout`, completed: unknown and repeated cards are dropped, an unknown width is
 * the card's default, missing cards are inserted after their default predecessor with their default visibility and
 * width, and anything unreadable (an account that never saved a layout) gives the defaults.
 */
export function dashboardLayoutOf(stored: unknown): DashboardLayout {
  const parsed = STORED_LAYOUT.safeParse(stored);
  if (!parsed.success) return DEFAULT_DASHBOARD_LAYOUT;
  const cards: DashboardCardPrefs[] = [];
  for (const card of parsed.data.cards) {
    const id = DASHBOARD_CARDS.find((known) => known === card.id);
    if (id === undefined || cards.some((kept) => kept.id === id)) continue;
    const width = CARD_WIDTHS.find((known) => known === card.width) ?? DEFAULT_WIDTH[id];
    cards.push({ id, visible: card.visible, width });
  }
  for (const [index, fallback] of DEFAULT_DASHBOARD_LAYOUT.cards.entries()) {
    if (cards.some((card) => card.id === fallback.id)) continue;
    const before = DEFAULT_DASHBOARD_LAYOUT.cards[index - 1]?.id;
    const at = before === undefined ? 0 : cards.findIndex((card) => card.id === before) + 1;
    cards.splice(at, 0, fallback);
  }
  return { cards };
}

/** Whether two layouts show the same cards in the same order and widths ("Simpan tata letak" is off otherwise). */
export function sameLayout(a: DashboardLayout, b: DashboardLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `id` set to `patch`; the order is unchanged. */
export function updateCard(
  layout: DashboardLayout,
  id: DashboardCard,
  patch: Partial<Omit<DashboardCardPrefs, 'id'>>,
): DashboardLayout {
  return { cards: layout.cards.map((card) => (card.id === id ? { ...card, ...patch } : card)) };
}

/**
 * `id` moved to where `over` is (dnd-kit's drop target); the same layout when nothing moves: dropped on itself, on
 * nothing, or either card unknown.
 */
export function moveCard(
  layout: DashboardLayout,
  id: DashboardCard,
  over: { readonly id: string | number } | null,
): DashboardLayout {
  const from = layout.cards.findIndex((card) => card.id === id);
  const to = layout.cards.findIndex((card) => card.id === over?.id);
  if (from === -1 || to === -1 || from === to) return layout;
  const cards = [...layout.cards];
  const [moved] = cards.splice(from, 1) as [DashboardCardPrefs];
  cards.splice(to, 0, moved);
  return { cards };
}
