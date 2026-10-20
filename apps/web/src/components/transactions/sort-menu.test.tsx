// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { TransactionsSearch } from '../../lib/transactions-search.ts';
import { SortMenu } from './sort-menu.tsx';

async function renderMenu(search: TransactionsSearch) {
  const onSearchChange = vi.fn();
  const { screen } = await renderApp(
    <SortMenu search={search} onSearchChange={onSearchChange}>
      <button type="button">Jumlah</button>
    </SortMenu>,
  );
  const open = () => userEvent.click(screen.getByRole('button', { name: 'Jumlah' }));
  await open();
  return { onSearchChange, open };
}

describe('SortMenu', () => {
  it('picks a sort (newest first leaves the URL) and toggles grouping by day', async () => {
    const { onSearchChange, open } = await renderMenu({});
    await expect.element(page.getByText('Urutkan')).toBeVisible();
    await expect.element(page.getByRole('menuitemradio', { name: 'Terbaru dulu' })).toBeChecked();
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Jumlah terbesar' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ sort: 'amount_desc' });
    await open();
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Terlama dulu' }));
    await open();
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Terbaru dulu' }));
    expect(onSearchChange.mock.calls.slice(1)).toEqual([[{ sort: 'date_asc' }], [{ sort: undefined }]]);
    await open();
    const group = page.getByRole('menuitemcheckbox', { name: 'Kelompokkan per hari' });
    await expect.element(group).toBeChecked();
    await userEvent.click(group);
    expect(onSearchChange).toHaveBeenLastCalledWith({ view: 'flat' });
  });

  it('turns grouping back on from the Flat view', async () => {
    const { onSearchChange } = await renderMenu({ view: 'flat', sort: 'date_asc' });
    await expect.element(page.getByRole('menuitemradio', { name: 'Terlama dulu' })).toBeChecked();
    const group = page.getByRole('menuitemcheckbox', { name: 'Kelompokkan per hari' });
    await expect.element(group).not.toBeChecked();
    await userEvent.click(group);
    expect(onSearchChange).toHaveBeenLastCalledWith({ view: undefined });
  });

  it('disables grouping under an amount sort and says why', async () => {
    await renderMenu({ sort: 'amount_asc' });
    await expect
      .element(page.getByRole('menuitemcheckbox', { name: 'Kelompokkan per hari' }))
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(page.getByText('Urut jumlah mematikan kelompok per hari')).toBeVisible();
  });
});
