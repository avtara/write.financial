// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './investments.tsx';

afterEach(() => vi.restoreAllMocks());

describe('/investments', () => {
  it.each(['portfolio', 'accounts'])('explains a failed %s load and lets the user retry', async (failure) => {
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({
      overview: failure === 'portfolio' ? { ok: false, code: 'NOT_FOUND' } : { ok: true, value: null },
      accounts: failure === 'accounts' ? { ok: false, code: 'NOT_FOUND' } : { ok: true, value: null },
    } as never);
    vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: { timezone: 'Asia/Jakarta' } });
    const Component = Route.options.component as ComponentType;
    const { screen, router } = await renderApp(<Component />);
    await expect.element(screen.getByText('Portofolio gagal dimuat')).toBeVisible();
    const reload = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await screen.getByRole('button', { name: 'Coba lagi' }).click();
    expect(reload).toHaveBeenCalledOnce();
  });
});
