// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { createTag, deleteTag, listSimilarTags, mergeTags, renameTag } from './tags.ts';

const fake = vi.hoisted(() => {
  const tag = (slug: string, usageCount = 1) => ({ id: slug, slug, usageCount, aliases: [] as string[] });
  return {
    tag,
    ledgerError: (code: string) => Object.assign(new Error(code), { code }),
    tags: {
      create: vi.fn(() => Promise.resolve(tag('dana-darurat'))),
      rename: vi.fn(() => Promise.resolve(tag('darurat'))),
      merge: vi.fn<(...args: string[]) => Promise<ReturnType<typeof tag>>>(() => Promise.resolve(tag('reimburse', 15))),
      remove: vi.fn(() => Promise.resolve()),
      similar: vi.fn(() => Promise.resolve([{ a: 'kopi', b: 'kopi-susu' }])),
    },
  };
});

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ tags: fake.tags, now: () => new Date('2026-10-18T09:00:00Z') }),
}));

const USER_ID = fakeSession().user.id;
const A = '0b4f4bd4-5d0e-4b8e-9d55-6b8f0f1a2b3c';
const B = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const C = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const signedIn = () => requestContext(fakeSession());

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tag writes', () => {
  it('pass the session user and the raw input to the repository', async () => {
    expect(await call(createTag, { context: signedIn(), data: { input: '#Dana Darurat' } })).toEqual({
      ok: true,
      value: fake.tag('dana-darurat'),
    });
    expect(fake.tags.create).toHaveBeenCalledWith(USER_ID, '#Dana Darurat');

    await call(renameTag, { context: signedIn(), data: { id: A, input: 'darurat' } });
    expect(fake.tags.rename).toHaveBeenCalledWith(USER_ID, A, 'darurat');

    expect(await call(deleteTag, { context: signedIn(), data: { id: A } })).toEqual({ ok: true, value: null });
    expect(fake.tags.remove).toHaveBeenCalledWith(USER_ID, A);

    expect(await call(listSimilarTags, { context: signedIn(), data: {} })).toEqual({
      ok: true,
      value: [{ a: 'kopi', b: 'kopi-susu' }],
    });
    expect(fake.tags.similar).toHaveBeenCalledWith(USER_ID);
  });

  it('merges every source into the target in order and returns the target', async () => {
    expect(await call(mergeTags, { context: signedIn(), data: { sourceIds: [B, C], targetId: A } })).toEqual({
      ok: true,
      value: fake.tag('reimburse', 15),
    });
    expect(fake.tags.merge.mock.calls).toEqual([
      [USER_ID, B, A],
      [USER_ID, C, A],
    ]);
  });

  it('stops at the first refused merge', async () => {
    fake.tags.merge.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(mergeTags, { context: signedIn(), data: { sourceIds: [B, C], targetId: A } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(fake.tags.merge).toHaveBeenCalledTimes(1);
  });

  it('refuse signed-out requests', async () => {
    const context = requestContext(null);
    const cases: [unknown, unknown][] = [
      [createTag, { input: 'kopi' }],
      [renameTag, { id: A, input: 'kopi' }],
      [mergeTags, { sourceIds: [B], targetId: A }],
      [deleteTag, { id: A }],
      [listSimilarTags, {}],
    ];
    for (const [fn, data] of cases) {
      expect(await call(fn, { context, data })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    }
    expect(Object.values(fake.tags).some((method) => method.mock.calls.length > 0)).toBe(false);
  });

  it('validate input with Zod schemas', () => {
    expect(validatorOf(createTag).safeParse({ input: '' }).success).toBe(false);
    expect(validatorOf(createTag).safeParse({ input: 'x'.repeat(65) }).success).toBe(false);
    expect(validatorOf(renameTag).safeParse({ id: 'nope', input: 'kopi' }).success).toBe(false);
    const merge = validatorOf(mergeTags);
    expect(merge.safeParse({ sourceIds: [B, C], targetId: A }).success).toBe(true);
    expect(merge.safeParse({ sourceIds: [], targetId: A }).success).toBe(false);
    expect(merge.safeParse({ sourceIds: [A], targetId: A }).success).toBe(false);
    expect(merge.safeParse({ sourceIds: [B, B], targetId: A }).success).toBe(false);
    expect(validatorOf(deleteTag).safeParse({ id: 'nope' }).success).toBe(false);
    expect(validatorOf(listSimilarTags).safeParse({}).success).toBe(true);
  });
});
