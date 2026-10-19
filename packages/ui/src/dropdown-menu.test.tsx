// SPDX-License-Identifier: AGPL-3.0-only
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu.tsx';

function tokenColor(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(--${token})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function Menu({ onEdit = () => {}, onDelete = () => {} }: { onEdit?: () => void; onDelete?: () => void }) {
  const [sort, setSort] = useState('newest');
  const [grouped, setGrouped] = useState(true);
  const [hidden, setHidden] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Aksi</DropdownMenuTrigger>
      <DropdownMenuContent className="w-[240px]">
        <DropdownMenuGroup>
          <DropdownMenuItem icon={Pencil} shortcut={{ keys: ['E'], platform: 'mac' }} onSelect={onEdit}>
            Ubah
          </DropdownMenuItem>
          <DropdownMenuItem icon={Trash2} variant="destructive" onSelect={onDelete}>
            Hapus
          </DropdownMenuItem>
          <DropdownMenuItem disabled>Duplikat</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Urutkan</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
            <DropdownMenuRadioItem value="newest">Terbaru dulu</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="oldest">Terlama dulu</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuCheckboxItem checked={grouped} onCheckedChange={setGrouped}>
            Kelompokkan per hari
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            indicator="switch"
            checked={hidden}
            onCheckedChange={setHidden}
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            Sembunyikan saldo
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Tanpa status</DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('DropdownMenu', () => {
  it('opens with the keyboard, moves with arrows, runs an item, and returns focus', async () => {
    const onEdit = vi.fn();
    const screen = await render(<Menu onEdit={onEdit} />);
    const trigger = screen.getByRole('button', { name: 'Aksi' });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const menu = page.getByRole('menu');
    await expect.element(menu).toBeVisible();
    await expect.element(menu).toHaveClass('w-[240px]');
    await expect.element(page.getByRole('menuitem', { name: /^Ubah/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(page.getByRole('menuitem', { name: 'Hapus' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(onEdit).toHaveBeenCalledOnce();
    await expect.element(menu).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });

  it('shows the shortcut, colors destructive items, and skips disabled ones', async () => {
    const onDelete = vi.fn();
    const screen = await render(<Menu onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aksi' }));
    const edit = page.getByRole('menuitem', { name: /^Ubah/ });
    await expect.element(edit).toHaveTextContent('UbahE');
    expect(edit.element().querySelector('kbd')).not.toBeNull();
    const remove = page.getByRole('menuitem', { name: 'Hapus' });
    expect(getComputedStyle(remove.element()).color).toBe(tokenColor('red-fg'));
    expect(getComputedStyle(edit.element()).color).toBe(tokenColor('text-secondary'));
    await expect.element(page.getByRole('menuitem', { name: 'Duplikat' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(remove);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('has radio and checkbox items, including a switch that keeps the menu open', async () => {
    const screen = await render(<Menu />);
    await userEvent.click(screen.getByRole('button', { name: 'Aksi' }));
    await expect.element(page.getByText('Urutkan')).toBeVisible();
    await expect.element(page.getByRole('menuitemradio', { name: 'Terbaru dulu' })).toBeChecked();
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Terlama dulu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aksi' }));
    await expect.element(page.getByRole('menuitemradio', { name: 'Terlama dulu' })).toBeChecked();
    await expect.element(page.getByRole('menuitemcheckbox', { name: 'Kelompokkan per hari' })).toBeChecked();
    await expect.element(page.getByRole('menuitemcheckbox', { name: 'Tanpa status' })).not.toBeChecked();
    const hide = page.getByRole('menuitemcheckbox', { name: 'Sembunyikan saldo' });
    await expect.element(hide).not.toBeChecked();
    await userEvent.click(hide);
    await expect.element(hide).toBeChecked();
    expect(hide.element().querySelector('[aria-hidden="true"]')?.className).toContain('bg-fg');
    await expect.element(page.getByRole('separator')).toBeInTheDocument();
  });
});
