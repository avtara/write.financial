// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './accounts.tsx';

const fake = vi.hoisted(() => ({ listAccounts: vi.fn(), listCategories: vi.fn(), page: vi.fn() }));
vi.mock('../../server/fn/ledger.ts', () => ({ listAccounts: fake.listAccounts, listCategories: fake.listCategories }));
vi.mock('../../components/accounts/accounts-page.tsx', () => ({
  AccountsPage: (props: { initialAccountId?: string; initialNewType?: string; onConsumeSearch: () => void }) => {
    fake.page(props);
    return (
      <button type="button" onClick={props.onConsumeSearch}>
        accounts page
      </button>
    );
  },
}));

const OVERVIEW = { baseCurrency: 'IDR', accounts: [], availableMinor: 0n, missingRates: [] };
const ID = '0192a6c4-0000-7000-8000-0000000000b1';

function stubRoute(data: unknown, search: object = {}) {
  const navigate = vi.fn();
  vi.spyOn(Route, 'useLoaderData').mockReturnValue(data);
  vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: { timezone: 'Asia/Jakarta' } });
  vi.spyOn(Route, 'useSearch').mockReturnValue(search);
  vi.spyOn(Route, 'useNavigate').mockReturnValue(navigate as never);
  return navigate;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('/accounts', () => {
  it('loads every account and the categories', async () => {
    fake.listAccounts.mockResolvedValue({ ok: true, value: OVERVIEW });
    fake.listCategories.mockResolvedValue({ ok: true, value: [] });
    const loader = Route.options.loader as unknown as () => Promise<unknown>;
    expect(await loader()).toEqual({ accounts: { ok: true, value: OVERVIEW }, categories: { ok: true, value: [] } });
    expect(fake.listAccounts).toHaveBeenCalledWith({ data: { status: 'all' } });
    expect(fake.listCategories).toHaveBeenCalledWith({ data: {} });
  });

  it('titles the page and keeps only valid search params', () => {
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Rekening & dompet · write.financial');
    const validate = Route.options.validateSearch as unknown as { parse: (value: unknown) => unknown };
    expect(validate.parse({ account: ID, new: 'cash' })).toEqual({ account: ID, new: 'cash' });
    expect(validate.parse({ account: 'x', new: 'loan' })).toEqual({});
  });

  it('renders the page with the search params and drops them afterwards', async () => {
    const navigate = stubRoute(
      { accounts: { ok: true, value: OVERVIEW }, categories: { ok: true, value: [] } },
      { account: ID, new: 'bank' },
    );
    const Component = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Component />);
    await screen.getByRole('button', { name: 'accounts page' }).click();
    expect(fake.page).toHaveBeenCalledWith(
      expect.objectContaining({ timeZone: 'Asia/Jakarta', initialAccountId: ID, initialNewType: 'bank' }),
    );
    expect(navigate).toHaveBeenCalledWith({ search: {}, replace: true });
    await screen.unmount();

    stubRoute({ accounts: { ok: true, value: OVERVIEW }, categories: { ok: true, value: [] } });
    await renderApp(<Component />);
    expect(fake.page.mock.lastCall?.[0]).not.toHaveProperty('initialAccountId');
  });

  it('explains a failed load', async () => {
    const Component = Route.options.component as ComponentType;
    stubRoute({ accounts: { ok: false, code: 'UNAUTHENTICATED' }, categories: { ok: true, value: [] } });
    const first = await renderApp(<Component />);
    await expect.element(first.screen.getByText('Rekening gagal dimuat')).toBeVisible();
    await first.screen.unmount();
    stubRoute({ accounts: { ok: true, value: OVERVIEW }, categories: { ok: false, code: 'NOT_FOUND' } });
    const second = await renderApp(<Component />);
    await expect.element(second.screen.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
  });
});
