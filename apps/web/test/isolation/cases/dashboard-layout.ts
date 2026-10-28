// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for `src/server/fn/dashboard-layout.ts` (FR-D3): the layout is the caller's own
 * `user_preferences.dashboard_layout`; saving one never touches another user's row, and reading never returns it.
 */
import { expect } from 'vitest';
import { DEFAULT_DASHBOARD_LAYOUT, type DashboardLayout } from '../../../src/lib/dashboard-layout.ts';
import type { Result } from '../../../src/server/access.ts';
import { aId, as, bId, type Case, ok, superuser, UNAUTHENTICATED } from '../harness.ts';

const layoutRow = async (userId: string) =>
  (
    await superuser<
      { layout: unknown }[]
    >`SELECT dashboard_layout AS layout FROM user_preferences WHERE user_id = ${userId}`
  )[0]?.layout;

export const cases = {
  getDashboardLayout: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // B has saved nothing (the save case runs after this one): the defaults, whatever A stored.
      expect(await as<Result<DashboardLayout>>('B', 'getDashboardLayout')).toEqual(ok(DEFAULT_DASHBOARD_LAYOUT));
    },
  },
  saveDashboardLayout: {
    input: () => ({ cards: [{ id: 'goals', visible: true, width: 'full' }] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofA = await layoutRow(aId);
      const saved = await as<Result<DashboardLayout>>('B', 'saveDashboardLayout', input);
      expect(saved.ok && saved.value.cards.find((card) => card.id === 'goals')).toEqual({
        id: 'goals',
        visible: true,
        width: 'full',
      });
      // Stored on B's own row, completed with every card; A's row and A's answer are unchanged.
      expect(await layoutRow(bId)).toEqual(saved.ok ? { cards: saved.value.cards } : null);
      expect(await layoutRow(aId)).toEqual(ofA);
      expect(await as<Result<DashboardLayout>>('A', 'getDashboardLayout')).not.toEqual(saved);
    },
  },
} satisfies Partial<Record<'getDashboardLayout' | 'saveDashboardLayout', Case>>;
