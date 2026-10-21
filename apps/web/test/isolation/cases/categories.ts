// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/categories.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import type { CategoryView } from '@wf/db/categories';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import {
  A_LEDGER,
  aId,
  aLedgerRows,
  as,
  bId,
  type Case,
  categoryId,
  type Name,
  NOT_FOUND,
  ok,
  SOME_ID,
  superuser,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  createCategory: {
    input: () => ({ kind: 'expense', group: 'needs', name: 'Pendidikan B', icon: 'graduation-cap', color: '#14b8a6' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aLedgerRows();
      const created = await as<Result<CategoryView>>('B', 'createCategory', input);
      expect(created.ok && created.value).toMatchObject({ name: 'Pendidikan B', group: 'needs', color: '#14b8a6' });
      expect(await categoryId(bId, 'Pendidikan B')).toBe(created.ok && created.value.id);
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  updateCategory: {
    input: () => ({ id: SOME_ID, icon: 'gift' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'updateCategory', { id: await categoryId(aId, A_LEDGER.category), icon: 'gift' })).toEqual(
        NOT_FOUND,
      );
      expect(
        await as('B', 'updateCategory', { id: await categoryId(bId, 'Kategori B'), icon: 'gift', isFixed: true }),
      ).toMatchObject(ok({ name: 'Kategori B', icon: 'gift', isFixed: true }));
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  moveCategory: {
    input: () => ({ id: SOME_ID, group: 'needs' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'moveCategory', { id: await categoryId(aId, A_LEDGER.category), group: 'needs' })).toEqual(
        NOT_FOUND,
      );
      expect(await as('B', 'moveCategory', { id: await categoryId(bId, 'Kategori B'), group: 'needs' })).toMatchObject(
        ok({ group: 'needs' }),
      );
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  archiveCategory: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'archiveCategory', { id: await categoryId(aId, A_LEDGER.category) })).toEqual(NOT_FOUND);
      const archived = await as<Result<CategoryView>>('B', 'archiveCategory', {
        id: await categoryId(bId, 'Kategori B'),
      });
      expect(archived.ok && archived.value.archivedAt).toBeInstanceOf(Date);
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  unarchiveCategory: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'unarchiveCategory', { id: await categoryId(aId, A_LEDGER.category) })).toEqual(NOT_FOUND);
      expect(await as('B', 'unarchiveCategory', { id: await categoryId(bId, 'Kategori B') })).toMatchObject(
        ok({ archivedAt: null }),
      );
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  reorderCategories: {
    input: () => ({ ids: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      const ofA = await categoryId(aId, A_LEDGER.category);
      const needsOfB = (
        await superuser<{ id: string }[]>`
          SELECT id::text FROM categories
          WHERE user_id = ${bId} AND "group" = 'needs' AND deleted_at IS NULL ORDER BY sort_order DESC`
      ).map((row) => row.id);
      expect(await as('B', 'reorderCategories', { ids: [ofA] })).toEqual(NOT_FOUND);
      expect(await as('B', 'reorderCategories', { ids: [...needsOfB, ofA] })).toEqual(NOT_FOUND);
      expect(await as('B', 'reorderCategories', { ids: needsOfB })).toEqual(ok(null));
      expect(
        (
          await superuser<{ id: string }[]>`
            SELECT id::text FROM categories
            WHERE user_id = ${bId} AND "group" = 'needs' AND deleted_at IS NULL ORDER BY sort_order`
        ).map((row) => row.id),
      ).toEqual(needsOfB);
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  mergeCategories: {
    input: () => ({ sourceId: SOME_ID, targetId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      const ofA = await categoryId(aId, A_LEDGER.category);
      const source = await categoryId(bId, 'Pendidikan B');
      const target = await categoryId(bId, 'Kategori B');
      expect(await as('B', 'mergeCategories', { sourceId: source, targetId: ofA })).toEqual(NOT_FOUND);
      expect(await as('B', 'mergeCategories', { sourceId: ofA, targetId: target })).toEqual(NOT_FOUND);
      expect(await as('B', 'mergeCategories', { sourceId: source, targetId: target })).toEqual(ok({ moved: 0 }));
      expect(await categoryId(bId, 'Pendidikan B')).toBe('');
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  deleteCategory: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'deleteCategory', { id: await categoryId(aId, A_LEDGER.category) })).toEqual(NOT_FOUND);
      expect(await as('B', 'deleteCategory', { id: await categoryId(bId, 'Kategori B') })).toEqual(
        ok({ uncategorized: 0, reviewItems: 0 }),
      );
      expect(await categoryId(bId, 'Kategori B')).toBe('');
      expect(await aLedgerRows()).toEqual(a);
    },
  },
} satisfies Partial<Record<Name, Case>>;
