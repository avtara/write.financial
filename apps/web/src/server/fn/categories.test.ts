// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import {
  archiveCategory,
  createCategory,
  deleteCategory,
  mergeCategories,
  moveCategory,
  reorderCategories,
  unarchiveCategory,
  updateCategory,
} from './categories.ts';

const fake = vi.hoisted(() => {
  const view = { id: 'c1', name: 'Pendidikan' };
  return {
    view,
    ledgerError: (code: string) => Object.assign(new Error(code), { code }),
    categories: {
      create: vi.fn(() => Promise.resolve(view)),
      update: vi.fn(() => Promise.resolve(view)),
      move: vi.fn(() => Promise.resolve(view)),
      merge: vi.fn(() => Promise.resolve({ moved: 3 })),
      archive: vi.fn(() => Promise.resolve(view)),
      unarchive: vi.fn(() => Promise.resolve(view)),
      remove: vi.fn(() => Promise.resolve({ uncategorized: 12 })),
      reorder: vi.fn(() => Promise.resolve()),
    },
  };
});

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ categories: fake.categories, now: () => new Date('2026-10-18T09:00:00Z') }),
}));

const USER_ID = fakeSession().user.id;
const ID = '0b4f4bd4-5d0e-4b8e-9d55-6b8f0f1a2b3c';
const OTHER = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const signedIn = () => requestContext(fakeSession());
const NEW = { kind: 'expense', group: 'needs', name: 'Pendidikan', icon: 'graduation-cap', color: '#14b8a6' } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('category writes', () => {
  it('pass the session user and the input to the repository', async () => {
    expect(await call(createCategory, { context: signedIn(), data: NEW })).toEqual({ ok: true, value: fake.view });
    expect(fake.categories.create).toHaveBeenCalledWith(USER_ID, NEW);

    await call(updateCategory, { context: signedIn(), data: { id: ID, icon: 'book-open', isFixed: true } });
    expect(fake.categories.update).toHaveBeenCalledWith(USER_ID, ID, { icon: 'book-open', isFixed: true });
    await call(updateCategory, { context: signedIn(), data: { id: ID, name: 'Kursus', color: 'blue' } });
    expect(fake.categories.update).toHaveBeenLastCalledWith(USER_ID, ID, { name: 'Kursus', color: 'blue' });

    await call(moveCategory, { context: signedIn(), data: { id: ID, group: 'wants' } });
    expect(fake.categories.move).toHaveBeenCalledWith(USER_ID, ID, 'wants');

    expect(await call(mergeCategories, { context: signedIn(), data: { sourceId: ID, targetId: OTHER } })).toEqual({
      ok: true,
      value: { moved: 3 },
    });
    expect(fake.categories.merge).toHaveBeenCalledWith(USER_ID, ID, OTHER);

    await call(archiveCategory, { context: signedIn(), data: { id: ID } });
    expect(fake.categories.archive).toHaveBeenCalledWith(USER_ID, ID);
    await call(unarchiveCategory, { context: signedIn(), data: { id: ID } });
    expect(fake.categories.unarchive).toHaveBeenCalledWith(USER_ID, ID);

    expect(await call(deleteCategory, { context: signedIn(), data: { id: ID } })).toEqual({
      ok: true,
      value: { uncategorized: 12 },
    });
    expect(fake.categories.remove).toHaveBeenCalledWith(USER_ID, ID);

    expect(await call(reorderCategories, { context: signedIn(), data: { ids: [OTHER, ID] } })).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.categories.reorder).toHaveBeenCalledWith(USER_ID, [OTHER, ID]);
  });

  it('turn ledger refusals into expected results', async () => {
    fake.categories.remove.mockRejectedValueOnce(fake.ledgerError('CATEGORY_SYSTEM'));
    expect(await call(deleteCategory, { context: signedIn(), data: { id: ID } })).toEqual({
      ok: false,
      code: 'CATEGORY_SYSTEM',
    });
  });

  it('refuse signed-out requests', async () => {
    const context = requestContext(null);
    const cases: [unknown, unknown][] = [
      [createCategory, NEW],
      [updateCategory, { id: ID }],
      [moveCategory, { id: ID, group: 'wants' }],
      [mergeCategories, { sourceId: ID, targetId: OTHER }],
      [archiveCategory, { id: ID }],
      [unarchiveCategory, { id: ID }],
      [deleteCategory, { id: ID }],
      [reorderCategories, { ids: [ID] }],
    ];
    for (const [fn, data] of cases) {
      expect(await call(fn, { context, data })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    }
    expect(Object.values(fake.categories).some((method) => method.mock.calls.length > 0)).toBe(false);
  });

  it('validate input with Zod schemas', () => {
    const create = validatorOf(createCategory);
    expect(create.parse(NEW)).toEqual({ ...NEW, isFixed: false });
    expect(create.safeParse({ ...NEW, color: 'teal' }).success).toBe(false);
    expect(create.safeParse({ ...NEW, kind: 'fee', group: 'financial' }).success).toBe(false);
    expect(create.safeParse({ ...NEW, name: 'x'.repeat(25) }).success).toBe(false);
    expect(create.safeParse({ ...NEW, name: '   ' }).success).toBe(false);
    expect(create.safeParse({ ...NEW, icon: 'Graduation Cap' }).success).toBe(false);
    expect(validatorOf(updateCategory).safeParse({ id: 'nope' }).success).toBe(false);
    expect(validatorOf(moveCategory).safeParse({ id: ID, group: 'savings' }).success).toBe(false);
    expect(validatorOf(reorderCategories).safeParse({ ids: [] }).success).toBe(false);
    expect(validatorOf(mergeCategories).safeParse({ sourceId: ID }).success).toBe(false);
  });
});
