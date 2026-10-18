// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { PageState } from './page-state.tsx';

describe('PageState', () => {
  it.each([
    ['loading', 'status'],
    ['error', 'alert'],
    ['offline', 'status'],
  ] as const)('announces %s as a %s region with title, description, and action', async (kind, role) => {
    const screen = await render(
      <PageState
        kind={kind}
        title="Judul"
        description="Keterangan"
        action={<button type="button">Coba lagi</button>}
      />,
    );
    const region = screen.getByRole(role);
    await expect.element(region).toBeInTheDocument();
    expect(region.element().textContent).toBe('JudulKeteranganCoba lagi');
    await expect.element(region.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
    expect(region.element().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders empty as plain content without a live region', async () => {
    const screen = await render(<PageState kind="empty" title="Belum ada transaksi" />);
    expect(screen.container.querySelector('[role]')).toBeNull();
    await expect.element(screen.getByText('Belum ada transaksi')).toBeInTheDocument();
    // Without description and action only the icon and the title render.
    expect(screen.container.querySelector('[data-kind="empty"]')?.children).toHaveLength(2);
  });

  it('renders refreshing as a compact status line next to the existing data', async () => {
    const screen = await render(<PageState kind="refreshing" title="Memperbarui…" />);
    const status = screen.getByRole('status');
    await expect.element(status).toHaveTextContent('Memperbarui…');
    expect(getComputedStyle(status.element()).display).toBe('inline-flex');
  });

  it('spins the loading indicator only when motion is allowed', async () => {
    const screen = await render(<PageState kind="loading" title="Memuat" />);
    const icon = screen.getByRole('status').element().querySelector('svg') as SVGElement;
    // Playwright's Chromium reports no reduced-motion preference by default.
    expect(getComputedStyle(icon).animationName).toBe('spin');
    expect(icon.getAttribute('class')).toContain('motion-safe:animate-spin');
  });
});
