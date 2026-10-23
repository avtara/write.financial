// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './reports.tsx';

const fake = vi.hoisted(() => ({ getReportsHome: vi.fn(), ReportsPage: vi.fn(() => null) }));
vi.mock('../../server/fn/reports.ts', () => ({ getReportsHome: fake.getReportsHome }));
// The page renders the header itself, so the route is asserted by what it hands the page.
vi.mock('../../components/reports/reports-page.tsx', () => ({ ReportsPage: fake.ReportsPage }));

afterEach(() => vi.restoreAllMocks());

const VIEWER = { viewer: { timezone: 'Asia/Jakarta', locale: 'id' as const } };

describe('/reports', () => {
  it('explains a failed load and lets the user retry', async () => {
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({ home: { ok: false, code: 'INVALID_PERIOD' } });
    vi.spyOn(Route, 'useRouteContext').mockReturnValue(VIEWER);
    const Component = Route.options.component as ComponentType;
    const { screen, router } = await renderApp(<Component />);
    await expect.element(screen.getByText('Ada yang salah. Coba lagi sebentar.')).toBeVisible();
    const reload = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await screen.getByRole('button', { name: 'Coba lagi' }).click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('loads the reports home', async () => {
    const home = { ok: true as const, value: { reports: [], latestFinal: null, today: '2026-10-18' } };
    fake.getReportsHome.mockResolvedValue(home);
    const loader = Route.options.loader as unknown as () => Promise<unknown>;
    expect(await loader()).toEqual({ home });
    expect(fake.getReportsHome).toHaveBeenCalledWith({ data: {} });
    expect((Route.options.loaderDeps as unknown as () => unknown)()).toEqual({});
  });

  it('titles the page and renders the pending state', async () => {
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Laporan · write.financial');
    const Pending = Route.options.pendingComponent as ComponentType;
    const { screen } = await renderApp(<Pending />);
    await expect.element(screen.getByText('Menyusun laporan…')).toBeVisible();
  });

  it('renders the page with the loader data and the viewer’s zone and locale', async () => {
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({
      home: { ok: true, value: { reports: [], latestFinal: null, today: '2026-10-18' } },
    });
    vi.spyOn(Route, 'useRouteContext').mockReturnValue(VIEWER);
    const Component = Route.options.component as ComponentType;
    await renderApp(<Component />);
    // React 19 passes a second (ref) argument to function components; only the props matter here.
    const [props] = fake.ReportsPage.mock.calls as unknown as [Record<string, unknown>][];
    expect(props?.[0]).toEqual({
      reports: [],
      latestFinal: null,
      today: '2026-10-18',
      timeZone: 'Asia/Jakarta',
      locale: 'id',
    });
  });
});
