// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { CatalogInput, type CatalogInputProps } from './catalog-input.tsx';
import { Modal } from './modal.tsx';

function Input({ onSelect = vi.fn(), ...props }: Partial<CatalogInputProps>) {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="catalog">Provider</label>
      <CatalogInput
        id="catalog"
        value={value}
        kind="provider"
        {...(props.kind === 'instrument' ? {} : { accountType: 'bank' as const })}
        onValueChange={setValue}
        onSelect={(record) => {
          setValue(record.name);
          onSelect(record);
        }}
        {...props}
      />
      <button type="button">Elsewhere</button>
    </>
  );
}

function ModalInput() {
  const [open, setOpen] = useState(true);
  return (
    <Modal open={open} onOpenChange={setOpen} title="Catalog form" description="Find a provider">
      <Input />
    </Modal>
  );
}

describe('CatalogInput', () => {
  it('keeps a saved value closed on focus until the user searches or explicitly opens suggestions', async () => {
    const { screen } = await renderApp(<Input value="BCA" />);
    const input = screen.getByRole('combobox', { name: 'Provider' });
    await input.click();
    await expect.element(input).toHaveAttribute('aria-expanded', 'false');
    await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(screen.getByRole('option', { name: 'BCA', exact: true })).toBeVisible();
  });

  it('keeps blank and unlisted text manual, with no initial directory and an accessible hint', async () => {
    const selected = vi.fn();
    const { screen } = await renderApp(<Input onSelect={selected} />);
    const input = screen.getByRole('combobox', { name: 'Provider' });
    await input.click();
    await expect.element(input).toHaveAttribute('aria-expanded', 'false');
    await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument();
    await input.fill('My small local bank');
    await expect.element(input).toHaveValue('My small local bank');
    await expect.element(screen.getByRole('option')).not.toBeInTheDocument();
    await expect.element(screen.getByText(/Tidak cocok\?/)).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(selected).not.toHaveBeenCalled();
    await screen.getByRole('button', { name: 'Elsewhere' }).click();
    await expect.element(input).toHaveAttribute('aria-expanded', 'false');
    await expect.element(input).toHaveAccessibleDescription(/Cari katalog pilihan terbatas/);
  });

  it('searches aliases, bounds results, navigates and wraps both directions, selects, and dismisses with Escape', async () => {
    const selected = vi.fn();
    const { screen } = await renderApp(<Input onSelect={selected} />);
    const input = screen.getByRole('combobox', { name: 'Provider' });
    await input.fill('a');
    expect(screen.getByRole('listbox').element().querySelectorAll('[role="option"]')).toHaveLength(6);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowDown}{ArrowDown}');
    await expect.element(screen.getByRole('option', { selected: true })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(input).toHaveAttribute('aria-expanded', 'true');
    await input.fill('bank central asia');
    await expect.element(screen.getByRole('option', { name: 'BCA', exact: true })).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider:bca' }));
    await expect.element(input).toHaveValue('BCA');
    await expect.element(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Escape}{Enter}');
    expect(selected).toHaveBeenCalledOnce();
    await screen.getByRole('button', { name: 'Elsewhere' }).click();
  });

  it('shows venue/currency, restricts instrument results, and permits clicking a result without losing input focus', async () => {
    const selected = vi.fn();
    const { screen } = await renderApp(<Input kind="instrument" currency="IDR" onSelect={selected} />);
    const input = screen.getByRole('combobox', { name: 'Provider' });
    await input.fill('Apple');
    await expect.element(screen.getByRole('option')).not.toBeInTheDocument();
    await input.fill('Telkom');
    await screen.getByRole('option', { name: /TLKM · Telkom Indonesia/ }).click();
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 'stock:xidx:tlkm' }));
    await expect.element(input).toHaveFocus();
  });
});

describe('catalog suggestions inside a modal', () => {
  it('keeps input focus and dismisses suggestions before dismissing the form', async () => {
    const { screen } = await renderApp(<ModalInput />);
    const input = screen.getByRole('combobox', { name: 'Provider' });
    await input.fill('BCA');
    await expect.element(screen.getByRole('option', { name: 'BCA', exact: true })).toBeVisible();
    await input.click();
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByRole('dialog', { name: 'Catalog form' })).toBeVisible();
    await expect.element(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByRole('dialog', { name: 'Catalog form' })).not.toBeInTheDocument();
  });
});
