// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger } from './popover.tsx';

function Example({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverAnchor asChild>
        <span>anchor</span>
      </PopoverAnchor>
      <PopoverTrigger>Filter</PopoverTrigger>
      <PopoverContent aria-label="Filter tanggal" {...(className === undefined ? {} : { className })}>
        <input aria-label="Cari" />
        <PopoverClose>Tutup</PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

describe('Popover', () => {
  it('opens from its trigger, moves focus inside, and closes on Escape back to the trigger', async () => {
    const screen = await render(<Example className="w-[300px]" />);
    const trigger = screen.getByRole('button', { name: 'Filter' });
    await userEvent.click(trigger);
    const dialog = page.getByRole('dialog', { name: 'Filter tanggal' });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog).toHaveClass('bg-popover', 'w-[300px]');
    await expect.element(page.getByRole('textbox', { name: 'Cari' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });

  it('closes from a close button', async () => {
    const screen = await render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await userEvent.click(page.getByRole('button', { name: 'Tutup' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });
});
