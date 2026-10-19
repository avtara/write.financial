// SPDX-License-Identifier: AGPL-3.0-only
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render.tsx';
import { useMediaQuery } from './use-media-query.ts';

function Probe() {
  return <p>{useMediaQuery('(min-width: 1280px)', true) ? 'wide' : 'narrow'}</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMediaQuery', () => {
  it('follows the media query and stops listening on unmount', async () => {
    const query = Object.assign(new EventTarget(), { matches: false });
    const remove = vi.spyOn(query, 'removeEventListener');
    vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
    const { screen } = await renderApp(<Probe />);
    await expect.element(screen.getByText('narrow')).toBeVisible();
    query.matches = true;
    query.dispatchEvent(new Event('change'));
    await expect.element(screen.getByText('wide')).toBeVisible();
    await screen.unmount();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('renders the server value on the server', () => {
    expect(renderToString(<Probe />)).toContain('wide');
  });
});
