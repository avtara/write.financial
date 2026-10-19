// SPDX-License-Identifier: AGPL-3.0-only
import { Bus, Utensils } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import {
  Combobox,
  type ComboboxGroup,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from './command.tsx';

describe('Command', () => {
  it('filters as you type, shows the empty state, and picks with the keyboard', async () => {
    const onSelect = vi.fn();
    const screen = await render(
      <Command label="Perintah" className="w-[400px]">
        <CommandInput placeholder="Cari…" hint={<kbd>Esc</kbd>} />
        <CommandList label="Hasil">
          <CommandEmpty>Tidak ada hasil</CommandEmpty>
          <CommandGroup heading="Halaman">
            <CommandItem icon={Utensils} aside="G R" onSelect={onSelect}>
              Ringkasan
            </CommandItem>
            <CommandItem onSelect={onSelect}>Transaksi</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup>
            <CommandItem disabled>Tanya Asisten</CommandItem>
          </CommandGroup>
        </CommandList>
        <CommandFooter>
          <button type="button">Buat</button>
        </CommandFooter>
      </Command>,
    );
    const input = screen.getByRole('combobox');
    await expect.element(screen.getByText('Esc')).toBeVisible();
    await expect.element(screen.getByText('Halaman')).toBeVisible();
    await expect.element(screen.getByRole('option', { name: /Ringkasan/ })).toHaveTextContent('RingkasanG R');
    await userEvent.click(input);
    await userEvent.keyboard('trans');
    await expect.element(screen.getByRole('option', { name: /Ringkasan/ })).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('Transaksi');
    await userEvent.fill(input, 'zzz');
    await expect.element(screen.getByText('Tidak ada hasil')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Buat' })).toBeVisible();
  });
});

describe('CommandDialog', () => {
  function Palette() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          ⌘K
        </button>
        <CommandDialog open={open} onOpenChange={setOpen} label="Cari atau jalankan perintah">
          <CommandInput placeholder="Cari…" />
          <CommandList label="Hasil">
            <CommandItem>Ringkasan</CommandItem>
          </CommandList>
        </CommandDialog>
      </>
    );
  }

  it('opens a named modal palette with focus in the search, and Escape returns focus', async () => {
    const screen = await render(<Palette />);
    const opener = screen.getByRole('button', { name: '⌘K' });
    await userEvent.click(opener);
    const dialog = page.getByRole('dialog', { name: 'Cari atau jalankan perintah' });
    await expect.element(dialog).toBeVisible();
    await expect.element(page.getByRole('combobox')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(opener).toHaveFocus();
  });
});

describe('Combobox', () => {
  const GROUPS: ComboboxGroup[] = [
    {
      heading: 'Kebutuhan',
      options: [
        { value: 'cat-1', label: 'Makan & Dapur', keywords: ['groceries'], icon: Utensils, aside: 'sisa Rp300.000' },
        { value: 'cat-2', label: 'Transportasi', icon: Bus },
      ],
    },
    { options: [{ value: 'cat-3', label: 'Hobi', disabled: true }] },
  ];

  interface PickerProps {
    initial?: string | null;
    onValueChange?: (value: string) => void;
    withFooter?: boolean;
  }

  function Picker({ initial = null, onValueChange, withFooter = true }: PickerProps) {
    const [value, setValue] = useState<string | null>(initial);
    return (
      <Combobox
        value={value}
        onValueChange={(next) => {
          onValueChange?.(next);
          setValue(next);
        }}
        groups={GROUPS}
        label="Pilih kategori"
        searchPlaceholder="Cari kategori…"
        emptyLabel="Kategori tidak ditemukan"
        {...(withFooter
          ? {
              footer: (close: () => void) => (
                <button type="button" onClick={close}>
                  Buat kategori
                </button>
              ),
            }
          : {})}
      >
        <button type="button">Kategori</button>
      </Combobox>
    );
  }

  it('searches labels and keywords, never values, and picks with the keyboard', async () => {
    const onValueChange = vi.fn();
    const screen = await render(<Picker onValueChange={onValueChange} />);
    const trigger = screen.getByRole('button', { name: 'Kategori' });
    await userEvent.click(trigger);
    const input = page.getByRole('combobox');
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveAttribute('placeholder', 'Cari kategori…');
    await expect.element(page.getByText('Kebutuhan')).toBeVisible();
    await expect.element(page.getByRole('option', { name: /Makan/ })).toHaveTextContent('Makan & Dapursisa Rp300.000');
    await expect.element(page.getByRole('option', { name: 'Hobi' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('cat');
    await expect.element(page.getByText('Kategori tidak ditemukan')).toBeVisible();
    await userEvent.fill(input, 'groceries');
    await expect.element(page.getByRole('option', { name: /Makan/ })).toBeVisible();
    expect(page.getByRole('option', { name: 'Transportasi' }).query()).toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('cat-1');
    await expect.element(input).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });

  it('marks and highlights the current value, and closes from the footer', async () => {
    const screen = await render(<Picker initial="cat-2" />);
    await userEvent.click(screen.getByRole('button', { name: 'Kategori' }));
    const current = page.getByRole('option', { name: 'Transportasi' });
    await expect.element(current).toHaveAttribute('aria-selected', 'true');
    expect(current.element().querySelectorAll('svg')).toHaveLength(2);
    await userEvent.click(page.getByRole('button', { name: 'Buat kategori' }));
    await expect.element(page.getByRole('combobox')).not.toBeInTheDocument();
  });

  it('has no footer unless given one', async () => {
    const screen = await render(<Picker withFooter={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kategori' }));
    await expect.element(page.getByRole('combobox')).toBeVisible();
    expect(page.getByRole('button', { name: 'Buat kategori' }).query()).toBeNull();
  });
});
