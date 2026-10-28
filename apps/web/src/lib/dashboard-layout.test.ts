// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  ADDABLE_CARDS,
  DASHBOARD_CARDS,
  DEFAULT_DASHBOARD_LAYOUT,
  dashboardLayoutOf,
  moveCard,
  sameLayout,
  updateCard,
} from './dashboard-layout.ts';

const ids = (layout: { cards: readonly { id: string }[] }) => layout.cards.map((card) => card.id);

describe('DEFAULT_DASHBOARD_LAYOUT', () => {
  it('shows every card in the design order except the addable ones, at the design widths', () => {
    expect(ids(DEFAULT_DASHBOARD_LAYOUT)).toEqual([...DASHBOARD_CARDS]);
    expect(DEFAULT_DASHBOARD_LAYOUT.cards.filter((card) => !card.visible).map((card) => card.id)).toEqual([
      ...ADDABLE_CARDS,
    ]);
    // The old fixed rows: income vs spending ⅔ beside the budget ⅓, the calendar ⅔ beside subscriptions ⅓.
    expect(Object.fromEntries(DEFAULT_DASHBOARD_LAYOUT.cards.map((card) => [card.id, card.width]))).toMatchObject({
      accounts: 'full',
      cashflow: 'twoThirds',
      budget: 'third',
      calendar: 'twoThirds',
    });
  });
});

describe('dashboardLayoutOf', () => {
  it('gives the defaults for anything unreadable, e.g. an account that never saved a layout', () => {
    for (const stored of [undefined, null, {}, { cards: 'x' }, { cards: [{ id: 'flow' }] }, 3]) {
      expect(dashboardLayoutOf(stored)).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    }
  });

  it("keeps the user's order, visibility, and widths", () => {
    const cards = [...DEFAULT_DASHBOARD_LAYOUT.cards]
      .reverse()
      .map((card) => ({ ...card, visible: !card.visible, width: 'full' as const }));
    expect(dashboardLayoutOf({ cards })).toEqual({ cards });
  });

  it('drops unknown and repeated cards and replaces an unknown width with the default', () => {
    const layout = dashboardLayoutOf({
      cards: [
        { id: 'budget', visible: false, width: 'quarter' },
        { id: 'retired-card', visible: true, width: 'full' },
        { id: 'budget', visible: true, width: 'full' },
      ],
    });
    expect(layout.cards.find((card) => card.id === 'budget')).toEqual({ id: 'budget', visible: false, width: 'third' });
    expect(ids(layout).filter((id) => id === 'budget')).toHaveLength(1);
    expect(ids(layout)).not.toContain('retired-card');
  });

  it('inserts a card a later release added after its default predecessor, with its default settings', () => {
    // Stored before "bills" and "accounts" existed, in a custom order.
    const stored = DEFAULT_DASHBOARD_LAYOUT.cards.filter((card) => card.id !== 'bills' && card.id !== 'accounts');
    const swapped = [stored[1], stored[0], ...stored.slice(2)];
    const layout = dashboardLayoutOf({ cards: swapped });
    // The first default card goes first; "bills" follows its predecessor "goals".
    expect(ids(layout)[0]).toBe('accounts');
    expect(ids(layout).slice(-2)).toEqual(['goals', 'bills']);
    expect(layout.cards.find((card) => card.id === 'bills')).toEqual({ id: 'bills', visible: false, width: 'third' });
    expect(ids(layout).slice(1, 3)).toEqual([swapped[0]?.id, swapped[1]?.id]);
  });
});

describe('editing', () => {
  it('updates one card in place', () => {
    const layout = updateCard(DEFAULT_DASHBOARD_LAYOUT, 'flow', { visible: false, width: 'third' });
    expect(layout.cards[1]).toEqual({ id: 'flow', visible: false, width: 'third' });
    expect(ids(layout)).toEqual(ids(DEFAULT_DASHBOARD_LAYOUT));
    expect(sameLayout(layout, DEFAULT_DASHBOARD_LAYOUT)).toBe(false);
    expect(sameLayout(updateCard(layout, 'flow', { visible: true, width: 'full' }), DEFAULT_DASHBOARD_LAYOUT)).toBe(
      true,
    );
  });

  it('moves a card to its drop target, forwards and backwards', () => {
    expect(ids(moveCard(DEFAULT_DASHBOARD_LAYOUT, 'subscriptions', { id: 'calendar' })).slice(5, 7)).toEqual([
      'subscriptions',
      'calendar',
    ]);
    expect(ids(moveCard(DEFAULT_DASHBOARD_LAYOUT, 'accounts', { id: 'flow' })).slice(0, 2)).toEqual([
      'flow',
      'accounts',
    ]);
  });

  it('keeps the same layout when dropped on itself, on nothing, or with an unknown card', () => {
    expect(moveCard(DEFAULT_DASHBOARD_LAYOUT, 'flow', { id: 'flow' })).toBe(DEFAULT_DASHBOARD_LAYOUT);
    expect(moveCard(DEFAULT_DASHBOARD_LAYOUT, 'flow', null)).toBe(DEFAULT_DASHBOARD_LAYOUT);
    const partial = { cards: DEFAULT_DASHBOARD_LAYOUT.cards.slice(0, 2) };
    expect(moveCard(partial, 'bills', { id: 'flow' })).toBe(partial);
    expect(moveCard(partial, 'flow', { id: 'bills' })).toBe(partial);
  });
});
