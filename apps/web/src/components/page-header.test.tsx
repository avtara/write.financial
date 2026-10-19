// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { flushReact, renderApp } from '../../test/render.tsx';
import { PageHeader } from './page-header.tsx';

const header = <PageHeader breadcrumb={['Keuangan', 'Ringkasan']} title="Selamat datang" />;

afterEach(() => {
  vi.useRealTimers();
});

describe('PageHeader', () => {
  it('marks the last breadcrumb as the current page', async () => {
    const { screen } = await renderApp(header);
    const crumbs = screen.getByRole('listitem').elements();
    expect(crumbs.map((crumb) => [crumb.textContent, crumb.getAttribute('aria-current')])).toEqual([
      ['Keuangan', null],
      ['Ringkasan', 'page'],
    ]);
    await expect.element(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Selamat datang');
  });

  it('shows a description and actions when given', async () => {
    const { screen } = await renderApp(
      <PageHeader
        breadcrumb={['Akun', 'Rekening']}
        title="Rekening"
        description="11 rekening"
        actions={<button type="button">Tambah</button>}
      />,
    );
    await expect.element(screen.getByText('11 rekening')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Tambah' })).toBeVisible();
  });

  it('offers no peek while amounts are visible', async () => {
    const { screen } = await renderApp(header);
    await expect.element(screen.getByRole('button', { name: /Intip saldo/ })).not.toBeInTheDocument();
  });

  it('shows page actions at the right of the header', async () => {
    const { screen } = await renderApp(
      <PageHeader
        breadcrumb={['Keuangan', 'Ringkasan']}
        title="Selamat datang"
        actions={<button type="button">Catat</button>}
      />,
    );
    await expect.element(screen.getByRole('banner').getByRole('button', { name: 'Catat' })).toBeVisible();
  });
});

describe('PeekButton', () => {
  it('shows amounts for five seconds with a countdown, then hides them again', async () => {
    const { screen } = await renderApp(header, { preferences: { balancesHidden: true } });
    // Located by role only: its accessible name changes while peeking.
    const peek = screen.getByRole('banner').getByRole('button');
    await expect.element(peek).toHaveAttribute('aria-pressed', 'false');
    await expect.element(peek).toHaveTextContent('Intip saldo⌘.');
    const element = peek.element();
    vi.useFakeTimers();
    await userEvent.click(peek);
    await flushReact();
    expect(element.textContent).toBe('Menampilkan · 5 dtk⌘.');
    expect(element.getAttribute('aria-pressed')).toBe('true');
    for (const left of [4, 3, 2, 1]) {
      await vi.advanceTimersByTimeAsync(1000);
      await flushReact();
      expect(element.textContent).toBe(`Menampilkan · ${left} dtk⌘.`);
    }
    await vi.advanceTimersByTimeAsync(1000);
    await flushReact();
    expect(element.textContent).toBe('Intip saldo⌘.');
    expect(element.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles with ⌘ . and ends a running peek early', async () => {
    const { screen } = await renderApp(header, { preferences: { balancesHidden: true } });
    // Located by role only: its accessible name changes while peeking.
    const peek = screen.getByRole('banner').getByRole('button');
    await userEvent.keyboard('{Meta>}.{/Meta}');
    await expect.poll(() => peek.element().textContent).toMatch(/^Menampilkan · 5 dtk/);
    await userEvent.keyboard('{Meta>}.{/Meta}');
    await expect.poll(() => peek.element().textContent).toMatch(/^Intip saldo/);
  });

  it('shows Ctrl in the hint on other platforms', async () => {
    const { screen } = await renderApp(header, { preferences: { balancesHidden: true, platform: 'other' } });
    await expect.element(screen.getByRole('button', { name: /Intip saldo/ })).toHaveTextContent('Intip saldoCtrl.');
  });
});
