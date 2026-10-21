// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/tags.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import type { TagView } from '@wf/db/tags';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import {
  A_LEDGER,
  aId,
  aLedgerRows,
  as,
  bId,
  type Case,
  type Name,
  NOT_FOUND,
  ok,
  services,
  SOME_ID,
  tagId,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  createTag: {
    input: () => ({ input: '#Kopi Susu' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aLedgerRows();
      const created = await as<Result<TagView>>('B', 'createTag', input);
      expect(created.ok && created.value).toMatchObject({ slug: 'kopi-susu', usageCount: 0, aliases: [] });
      expect(await tagId(bId, 'kopi-susu')).toBe(created.ok && created.value.id);
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  renameTag: {
    input: () => ({ id: SOME_ID, input: 'tag-b2' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'renameTag', { id: await tagId(aId, A_LEDGER.tag), input: 'tag-b2' })).toEqual(NOT_FOUND);
      expect(await as('B', 'renameTag', { id: await tagId(bId, 'tag-b'), input: '#Tag B2' })).toMatchObject(
        ok({ slug: 'tag-b2' }),
      );
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  listSimilarTags: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // Each user gets a likely duplicate of their own; neither sees the other's pair.
      await services.tags.create(bId, 'kopi');
      await services.tags.create(aId, `${A_LEDGER.tag}b`);
      expect(await as('B', 'listSimilarTags', input)).toEqual(ok([{ a: 'kopi', b: 'kopi-susu' }]));
      expect(await as('A', 'listSimilarTags', input)).toEqual(ok([{ a: A_LEDGER.tag, b: `${A_LEDGER.tag}b` }]));
    },
  },
  mergeTags: {
    input: () => ({ sourceIds: [SOME_ID], targetId: '0192a6c4-0000-7000-8000-000000000001' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      const ofA = await tagId(aId, A_LEDGER.tag);
      const kopi = await tagId(bId, 'kopi');
      const target = await tagId(bId, 'kopi-susu');
      expect(await as('B', 'mergeTags', { sourceIds: [kopi], targetId: ofA })).toEqual(NOT_FOUND);
      expect(await as('B', 'mergeTags', { sourceIds: [ofA], targetId: target })).toEqual(NOT_FOUND);
      expect(await as('B', 'mergeTags', { sourceIds: [kopi], targetId: target })).toEqual(
        ok({ id: target, slug: 'kopi-susu', usageCount: 0, aliases: ['kopi'] }),
      );
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  deleteTag: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'deleteTag', { id: await tagId(aId, A_LEDGER.tag) })).toEqual(NOT_FOUND);
      expect(await as('B', 'deleteTag', { id: await tagId(bId, 'kopi-susu') })).toEqual(ok(null));
      expect(await tagId(bId, 'kopi-susu')).toBe('');
      expect(await aLedgerRows()).toEqual(a);
    },
  },
} satisfies Partial<Record<Name, Case>>;
