// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { Modal, type ModalProps } from './modal.tsx';

function Opener(props: Partial<ModalProps>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        open
      </button>
      <Modal open={open} onOpenChange={setOpen} title="Ubah kata sandi" {...props}>
        <input aria-label="inside" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('shows its title and description, closes on Escape, and returns focus to the opener', async () => {
    const { screen } = await renderApp(<Opener description="Minimal 10 karakter." />);
    const opener = screen.getByRole('button', { name: 'open' });
    await userEvent.click(opener);
    const dialog = page.getByRole('dialog', { name: 'Ubah kata sandi' });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog).toHaveAccessibleDescription('Minimal 10 karakter.');
    await expect.element(dialog.getByRole('heading', { name: 'Ubah kata sandi' })).toBeVisible();
    await expect.element(dialog).toHaveClass(/w-\[420px\]/);
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(opener).toHaveFocus();
  });

  it('can keep the title for screen readers only, and be wider', async () => {
    const { screen } = await renderApp(<Opener hideTitle size="lg" />);
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    const dialog = page.getByRole('dialog', { name: 'Ubah kata sandi' });
    await expect.element(dialog).toHaveClass(/w-\[460px\]/);
    await expect.element(dialog).not.toHaveAttribute('aria-describedby');
    expect(dialog.getByRole('heading').element().parentElement?.className).toBe('sr-only');
  });

  it('has an extra-wide size for the account dialogs', async () => {
    const { screen } = await renderApp(<Opener size="xl" />);
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await expect.element(page.getByRole('dialog', { name: 'Ubah kata sandi' })).toHaveClass(/w-\[560px\]/);
  });
});
