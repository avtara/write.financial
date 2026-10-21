// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/ledger.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import type { AccountsOverview } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { TagView } from '@wf/db/tags';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import { A_LEDGER, as, bId, type Case, ledgerIds, type Name, ok, UNAUTHENTICATED } from '../harness.ts';

export const cases = {
  listAccounts: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<AccountsOverview>>('B', 'listAccounts', input);
      expect(ofB.ok && ofB.value.accounts.map((a) => a.displayName)).toEqual(['Rekening B']);
      expect(ofB.ok && ofB.value.availableMinor).toBe(1_000_000n);
      const ofA = await as<Result<AccountsOverview>>('A', 'listAccounts', input);
      expect(ofA.ok && ofA.value.accounts.map((a) => a.displayName)).toEqual([A_LEDGER.account]);
    },
  },
  listCategories: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<CategoryView[]>>('B', 'listCategories', input);
      const ids = await ledgerIds(bId);
      expect(ofB.ok && ofB.value.length).toBeGreaterThan(1);
      expect(ofB.ok && ofB.value.filter((c) => !ids.includes(c.id))).toEqual([]);
      expect(ofB.ok && ofB.value.map((c) => c.name)).toContain('Kategori B');
    },
  },
  listTags: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<TagView[]>>('B', 'listTags', input);
      expect(ofB.ok && ofB.value.map((t) => t.slug)).toEqual(['tag-b']);
      const ofA = await as<Result<TagView[]>>('A', 'listTags', { query: 'rahasia' });
      expect(ofA.ok && ofA.value.map((t) => t.slug)).toEqual([A_LEDGER.tag]);
    },
  },
  getReferenceRate: {
    input: () => ({ base: 'USD', quote: 'IDR' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // A's manual rate is A's alone; B has none and no built-in rate exists yet.
      expect(await as('B', 'getReferenceRate', input)).toEqual(ok(null));
      expect(await as('A', 'getReferenceRate', input)).toMatchObject(ok({ rate: '16474', manual: true }));
    },
  },
} satisfies Partial<Record<Name, Case>>;
