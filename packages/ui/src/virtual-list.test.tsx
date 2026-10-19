// SPDX-License-Identifier: AGPL-3.0-only
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { VirtualList } from './virtual-list.tsx';

function List({ count = 10_000 }: { count?: number }) {
  return (
    <VirtualList
      label="Transaksi Oktober"
      className="h-[320px]"
      count={count}
      // Every tenth row is a 24 px day header; the rest are 32 px.
      estimateSize={(index) => (index % 10 === 0 ? 24 : 32)}
      getItemKey={(index) => `row-${index}`}
      renderItem={(index) => (
        <div className={index % 10 === 0 ? 'h-6' : 'h-8'}>
          {index % 10 === 0 ? `Hari ${index / 10}` : `Baris ${index}`}
        </div>
      )}
      overscan={2}
    />
  );
}

describe('VirtualList', () => {
  it('renders only the visible rows of a long list, with the real count and positions', async () => {
    const screen = await render(<List />);
    const list = screen.getByRole('list', { name: 'Transaksi Oktober' });
    await expect.element(list).toBeInTheDocument();
    const items = screen.getByRole('listitem').elements();
    expect(items.length).toBeGreaterThan(5);
    expect(items.length).toBeLessThan(20);
    expect(items[0]?.getAttribute('aria-setsize')).toBe('10000');
    expect(items[1]?.getAttribute('aria-posinset')).toBe('2');
    // Sized for all rows: 1000 headers of 24 px and 9000 rows of 32 px.
    expect(list.element().getBoundingClientRect().height).toBe(1000 * 24 + 9000 * 32);
  });

  it('renders the rows scrolled into view', async () => {
    const screen = await render(<List />);
    const scroller = screen.getByRole('list').element().parentElement as HTMLElement;
    // Row 99 starts after 10 headers (24 px) and 89 rows (32 px): 3088 px.
    scroller.scrollTop = 3000;
    scroller.dispatchEvent(new Event('scroll'));
    await expect.element(page.getByText('Baris 99', { exact: true })).toBeVisible();
    expect(page.getByText('Baris 1', { exact: true }).query()).toBeNull();
  });

  it('uses the index as key by default', async () => {
    const screen = await render(
      <VirtualList
        label="Pendek"
        className="h-[100px]"
        count={3}
        estimateSize={() => 20}
        renderItem={(index) => <span>Item {index}</span>}
      />,
    );
    expect(screen.getByRole('listitem').elements()).toHaveLength(3);
  });

  it('renders no rows on the server, so its HTML carries no inline styles', () => {
    const html = renderToString(<List count={3} />);
    expect(html).not.toContain('style=');
    expect(html).not.toContain('Baris');
  });
});
