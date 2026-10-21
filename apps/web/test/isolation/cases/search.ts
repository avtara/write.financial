// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/search.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { expect } from 'vitest';
import { type RecentEntry, SEARCH_KINDS, type SearchResults } from '../../../src/lib/search.ts';
import type { Result } from '../../../src/server/access.ts';
import { aAccountId, aId, as, bAccountId, bId, type Case, count, type Name, ok, UNAUTHENTICATED } from '../harness.ts';

export const cases = {
  searchEverything: {
    input: () => ({ query: 'rekening' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<SearchResults>>('B', 'searchEverything', input);
      expect(ofB.ok && ofB.value.accounts.hits.map((hit) => hit.displayName)).toEqual(['Rekening B']);
      const rahasia = await as<Result<SearchResults>>('B', 'searchEverything', { query: 'rahasia' });
      expect(rahasia.ok && SEARCH_KINDS.map((kind) => rahasia.value[kind].total)).toEqual([0, 0, 0, 0, 0, 0]);
      // A's own: the transaction "Belanja Rahasia A", its two pending review items ("Langganan Rahasia A", "Kos Rahasia
      // A"), the account, the subscription "Langganan Rahasia A", "Rahasia A" and the budgeted "Anggaran rahasia-a", and
      // the tag.
      const ofA = await as<Result<SearchResults>>('A', 'searchEverything', { query: 'rahasia' });
      expect(ofA.ok && SEARCH_KINDS.map((kind) => ofA.value[kind].total)).toEqual([1, 2, 1, 1, 2, 1]);
    },
  },
  touchRecent: {
    // B remembers A's account id: stored for B alone, and never resolved for B (below).
    input: () => ({ kind: 'account', ref: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'touchRecent', input)).toEqual(ok(null));
      expect(await count('recent_items', `user_id = '${bId}'`)).toBe(1);
      expect(await count('recent_items', `user_id = '${aId}'`)).toBe(0);
    },
  },
  listRecent: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'touchRecent', { kind: 'account', ref: bAccountId })).toEqual(ok(null));
      const ofB = await as<Result<RecentEntry[]>>('B', 'listRecent', input);
      expect(ofB.ok && ofB.value.map((entry) => entry.kind !== 'page' && entry.hit.id)).toEqual([bAccountId]);
      expect(await as('A', 'listRecent', input)).toEqual(ok([]));
    },
  },
} satisfies Partial<Record<Name, Case>>;
