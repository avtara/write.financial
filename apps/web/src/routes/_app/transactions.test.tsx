// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { LEDGER } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionsView } from '../../../test/transaction-fixtures.ts';
import type { TransactionsPageProps } from '../../components/transactions/transactions-page.tsx';
import { Route } from './transactions.tsx';

const fake = vi.hoisted(() => ({
  getTransactionsView: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  listAutoRules: vi.fn(),
  listSubscriptions: vi.fn(),
  page: vi.fn(),
}));
vi.mock('../../server/fn/transactions.ts', () => ({ getTransactionsView: fake.getTransactionsView }));
vi.mock('../../server/fn/ledger.ts', () => ({
  listAccounts: fake.listAccounts,
  listCategories: fake.listCategories,
  listTags: fake.listTags,
}));
vi.mock('../../server/fn/rules.ts', () => ({ listAutoRules: fake.listAutoRules }));
vi.mock('../../server/fn/schedules.ts', () => ({ listSubscriptions: fake.listSubscriptions }));
vi.mock('../../components/transactions/transactions-page.tsx', () => ({
  TransactionsPage: (props: TransactionsPageProps) => {
    fake.page(props);
    return (
      <button
        type="button"
        onClick={() => {
          props.onSearchChange({ type: 'expense', tx: undefined });
        }}
      >
        transactions page
      </button>
    );
  },
}));

const VIEW = transactionsView([]);
const OVERVIEW = { baseCurrency: 'IDR', accounts: LEDGER.accounts, availableMinor: 48_146_000n, missingRates: [] };
const OK = {
  view: { ok: true, value: VIEW },
  accounts: { ok: true, value: OVERVIEW },
  categories: { ok: true, value: LEDGER.categories },
  tags: { ok: true, value: LEDGER.tags },
  rules: { ok: true, value: [] },
  subscriptionNames: [],
};
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

describe('/transactions', () => {
  it('titles the page and keeps only valid search params', () => {
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Transaksi · write.financial');
    const validate = Route.options.validateSearch as unknown as { parse: (value: unknown) => unknown };
    expect(validate.parse({ tx: ID, view: 'flat' })).toEqual({ tx: ID, view: 'flat' });
    expect(validate.parse({ tx: 'x', view: 'grid' })).toEqual({});
  });

  it('keeps the existing period when a view interaction changes the filters', async () => {
    const navigate = stubRoute(OK, { tx: ID });
    const Component = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Component />);
    await userEvent.click(screen.getByRole('button', { name: 'transactions page' }));
    const [{ search }] = navigate.mock.lastCall as [{ search: (previous: object) => object }];
    expect(search({ tx: ID, period: '2026-10' })).toEqual({ tx: undefined, period: '2026-10', type: 'expense' });
  });

  it('explains a failed load and retries', async () => {
    const Component = Route.options.component as ComponentType;
    const failures = [
      { ...OK, view: { ok: false, code: 'NOT_FOUND' } },
      { ...OK, accounts: { ok: false, code: 'NOT_FOUND' } },
      { ...OK, categories: { ok: false, code: 'NOT_FOUND' } },
      { ...OK, tags: { ok: false, code: 'NOT_FOUND' } },
    ];
    for (const data of failures) {
      stubRoute(data);
      const { screen, router } = await renderApp(<Component />);
      await expect.element(screen.getByRole('heading', { name: 'Transaksi', level: 1 })).toBeVisible();
      await expect.element(screen.getByText('Transaksi gagal dimuat')).toBeVisible();
      await expect.element(screen.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
      const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
      await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
      expect(invalidate).toHaveBeenCalledOnce();
      await screen.unmount();
    }
    expect(fake.page).not.toHaveBeenCalled();
  });
});
