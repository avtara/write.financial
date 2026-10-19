// SPDX-License-Identifier: AGPL-3.0-only
import { ArrowUpRight } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.tsx';

function Example({ fill, onValueChange }: { fill?: boolean; onValueChange?: (value: string) => void }) {
  return (
    <Tabs defaultValue="out" {...(onValueChange === undefined ? {} : { onValueChange })}>
      <TabsList label="Jenis transaksi" {...(fill === undefined ? {} : { fill })} className="w-[400px]">
        <TabsTrigger value="out" icon={ArrowUpRight} iconClassName="group-data-[state=active]:text-red">
          Pengeluaran
        </TabsTrigger>
        <TabsTrigger value="in">Pemasukan</TabsTrigger>
        <TabsTrigger value="transfer">Transfer</TabsTrigger>
      </TabsList>
      <TabsContent value="out">Form keluar</TabsContent>
      <TabsContent value="in">Form masuk</TabsContent>
      <TabsContent value="transfer">Form transfer</TabsContent>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('is a named tab list whose arrows move and activate tabs', async () => {
    const onValueChange = vi.fn();
    const screen = await render(<Example onValueChange={onValueChange} />);
    await expect.element(screen.getByRole('tablist', { name: 'Jenis transaksi' })).toBeVisible();
    await expect.element(screen.getByRole('tab', { name: 'Pengeluaran' })).toHaveAttribute('aria-selected', 'true');
    await expect.element(screen.getByRole('tabpanel')).toHaveTextContent('Form keluar');
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(screen.getByRole('tab', { name: 'Pemasukan' })).toHaveFocus();
    expect(onValueChange).toHaveBeenLastCalledWith('in');
    await expect.element(screen.getByRole('tabpanel')).toHaveTextContent('Form masuk');
    await userEvent.keyboard('{End}');
    await expect.element(screen.getByRole('tab', { name: 'Transfer' })).toHaveAttribute('aria-selected', 'true');
  });

  it('colors the active icon and shares the width when filling', async () => {
    const screen = await render(<Example fill />);
    const out = screen.getByRole('tab', { name: 'Pengeluaran' });
    const icon = out.element().querySelector('svg') as SVGElement;
    const red = getComputedStyle(icon).color;
    await userEvent.click(screen.getByRole('tab', { name: 'Transfer' }));
    expect(getComputedStyle(icon).color).not.toBe(red);
    const widths = screen
      .getByRole('tab')
      .elements()
      .map((tab) => Math.round(tab.getBoundingClientRect().width));
    expect(new Set(widths).size).toBe(1);
  });

  it('sizes to its tabs by default', async () => {
    await render(<Example />);
    const tabs = page.getByRole('tab').elements();
    const total = tabs.reduce((sum, tab) => sum + tab.getBoundingClientRect().width, 0);
    expect(total).toBeLessThan(380);
  });
});
