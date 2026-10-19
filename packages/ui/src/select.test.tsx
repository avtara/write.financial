// SPDX-License-Identifier: AGPL-3.0-only
import { setNonce } from 'get-nonce';
import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Select, type SelectProps } from './select.tsx';

type Format = 'csv' | 'xlsx' | 'pdf';

const OPTIONS: SelectProps<Format>['options'] = [
  { value: 'csv', label: 'CSV', description: 'semua aplikasi' },
  { value: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  { value: 'pdf', label: 'PDF laporan', disabled: true },
];

function Harness({ onValueChange, ...props }: Partial<SelectProps<Format>>) {
  const [value, setValue] = useState<Format | null>(null);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        onValueChange?.(next);
        setValue(next);
      }}
      options={OPTIONS}
      placeholder="Pilih format"
      aria-label="Format"
      {...props}
    />
  );
}

describe('Select', () => {
  it('gives the viewport style element the CSP nonce', async () => {
    setNonce('nonce-select');
    const screen = await render(<Harness />);
    await screen.getByRole('combobox', { name: 'Format' }).click();
    await expect.element(page.getByRole('listbox')).toBeVisible();
    const style = document.querySelector('[data-radix-select-viewport]')?.parentElement?.querySelector('style');
    expect(style?.nonce).toBe('nonce-select');
    await userEvent.keyboard('{Escape}');
  });

  it('shows the placeholder, opens with the keyboard, and picks an option', async () => {
    const onValueChange = vi.fn();
    const screen = await render(<Harness onValueChange={onValueChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Format' });
    await expect.element(trigger).toHaveTextContent('Pilih format');
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const listbox = page.getByRole('listbox');
    await expect.element(listbox).toBeVisible();
    await expect.element(page.getByRole('option', { name: /CSV/ })).toHaveTextContent('CSVsemua aplikasi');
    await expect.element(page.getByRole('option', { name: 'PDF laporan' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(page.getByRole('option', { name: 'Excel' }));
    expect(onValueChange).toHaveBeenCalledWith('xlsx');
    await expect.element(trigger).toHaveTextContent('Excel');
    await expect.element(listbox).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });

  it('marks the chosen option and closes on Escape', async () => {
    const screen = await render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Format' });
    await userEvent.click(trigger);
    await userEvent.click(page.getByRole('option', { name: /CSV/ }));
    await userEvent.click(trigger);
    await expect.element(page.getByRole('option', { name: /CSV/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
  });

  it('takes field wiring, size, form name, and disabled state', async () => {
    const screen = await render(
      <form aria-label="Ekspor">
        <Harness id="format" aria-describedby="hint" aria-invalid size="sm" name="format" required disabled />
        <p id="hint">Pilih satu</p>
      </form>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Format' });
    await expect.element(trigger).toHaveAttribute('id', 'format');
    await expect.element(trigger).toHaveAccessibleDescription('Pilih satu');
    await expect.element(trigger).toHaveAttribute('aria-invalid', 'true');
    await expect.element(trigger).toBeDisabled();
    expect(trigger.element().getBoundingClientRect().height).toBe(32);
    expect(screen.container.querySelector('select[name="format"]')).not.toBeNull();
  });
});
