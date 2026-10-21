// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './review.tsx';

const fake = vi.hoisted(() => ({
  listReviewItems: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  page: vi.fn(),
}));
vi.mock('../../server/fn/review.ts', () => ({ listReviewItems: fake.listReviewItems }));
vi.mock('../../server/fn/ledger.ts', () => ({ listAccounts: fake.listAccounts, listCategories: fake.listCategories }));
vi.mock('../../components/review/review-page.tsx', () => ({
  ReviewPage: (props: unknown) => {
    fake.page(props);
    return <p>review page</p>;
  },
}));

const ok = <T,>(value: T) => ({ ok: true, value }) as const;
const failed = { ok: false, code: 'NOT_FOUND' } as const;
const ITEM = '0192a6c4-0000-7000-8000-0000000000a1';
const LOADED = {
  review: ok({ items: [{ id: ITEM }], total: 1 }),
  accounts: ok({ baseCurrency: 'IDR', accounts: [{ id: 'bca' }] }),
  categories: ok([{ id: 'food' }]),
};

function stubRoute(data: unknown, search: { item?: string } = {}) {
  vi.spyOn(Route, 'useLoaderData').mockReturnValue(data);
  vi.spyOn(Route, 'useSearch').mockReturnValue(search);
  vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: { timezone: 'Asia/Jakarta' } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('/review', () => {
  it('loads every pending item with the accounts and categories its cards name', async () => {
    fake.listReviewItems.mockResolvedValue(LOADED.review);
    fake.listAccounts.mockResolvedValue(LOADED.accounts);
    fake.listCategories.mockResolvedValue(LOADED.categories);
    const loader = Route.options.loader as unknown as () => Promise<unknown>;
    expect(await loader()).toEqual(LOADED);
    expect(fake.listReviewItems).toHaveBeenCalledWith({ data: { limit: 200 } });
    expect(fake.listAccounts).toHaveBeenCalledWith({ data: { status: 'all' } });
    expect(fake.listCategories).toHaveBeenCalledWith({ data: { includeArchived: true } });
    const search = Route.options.validateSearch as unknown as { parse: (input: unknown) => unknown };
    expect(search.parse({ item: ITEM })).toEqual({ item: ITEM });
    expect(search.parse({ item: 'nope' })).toEqual({});
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Perlu ditinjau · write.financial');
  });

  it('renders the page with the card ⌘K opened', async () => {
    stubRoute(LOADED, { item: ITEM });
    const Page = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Page />);
    await expect.element(screen.getByText('review page')).toBeVisible();
    expect(fake.page).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ id: ITEM }],
        lookup: { baseCurrency: 'IDR', accounts: [{ id: 'bca' }], categories: [{ id: 'food' }] },
        timeZone: 'Asia/Jakarta',
        focusItem: ITEM,
      }),
    );
  });

  it('says when a part could not be loaded', async () => {
    const Page = Route.options.component as ComponentType;
    for (const broken of [
      { ...LOADED, review: failed },
      { ...LOADED, accounts: failed },
      { ...LOADED, categories: failed },
    ]) {
      stubRoute(broken);
      const { screen } = await renderApp(<Page />);
      await expect.element(screen.getByText('Perlu ditinjau tidak bisa dimuat')).toBeVisible();
      await screen.unmount();
      vi.restoreAllMocks();
    }
  });
});
