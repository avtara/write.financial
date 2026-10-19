// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Sheet, type SheetProps } from './sheet.tsx';

type HarnessProps = Partial<Omit<SheetProps, 'open'>> & { keepOpen?: boolean };

/** Opens the sheet from a button like a real caller; `keepOpen` ignores close requests (a filled form). */
function Harness({ onOpenChange, keepOpen = false, children, ...props }: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Catat
      </button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next);
          if (!keepOpen) setOpen(next);
        }}
        title="Catat Transaksi"
        closeLabel="Tutup"
        {...props}
      >
        {children ?? <input aria-label="Jumlah" />}
      </Sheet>
    </>
  );
}

beforeEach(async () => {
  await page.viewport(1440, 900);
});

async function openSheet(props: HarnessProps = {}) {
  const screen = await render(<Harness {...props} />);
  const opener = screen.getByRole('button', { name: 'Catat' });
  await userEvent.click(opener);
  const dialog = page.getByRole('dialog', { name: 'Catat Transaksi' });
  await expect.element(dialog).toBeVisible();
  return { opener, dialog };
}

describe('Sheet', () => {
  it('is a modal panel on the right that focuses its first field, not the close button', async () => {
    const { dialog } = await openSheet({ description: 'Langsung tersimpan ke ringkasan.' });
    await expect.element(dialog).toHaveAccessibleDescription('Langsung tersimpan ke ringkasan.');
    // Modal: the page behind is hidden from assistive technology.
    await expect.element(page.getByRole('button', { name: 'Catat' })).not.toBeInTheDocument();
    // After the slide-in: flush with the right edge, full height.
    await expect.poll(() => dialog.element().getBoundingClientRect().right).toBe(1440);
    const box = dialog.element().getBoundingClientRect();
    expect(box.width).toBe(460);
    expect(box.height).toBe(900);
    await expect.element(page.getByRole('textbox', { name: 'Jumlah' })).toHaveFocus();
  });

  it('traps focus and closes on Escape, returning focus to the opener', async () => {
    const onOpenChange = vi.fn();
    const { dialog, opener } = await openSheet({ onOpenChange, footer: <button type="button">Simpan</button> });
    await userEvent.tab();
    await expect.element(page.getByRole('button', { name: 'Simpan' })).toHaveFocus();
    await userEvent.tab();
    await expect.element(page.getByRole('button', { name: 'Tutup' })).toHaveFocus();
    await userEvent.tab();
    await expect.element(page.getByRole('textbox', { name: 'Jumlah' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(opener).toHaveFocus();
  });

  it('closes from the × button', async () => {
    const { dialog } = await openSheet({ size: 'lg' });
    expect(dialog.element().getBoundingClientRect().width).toBe(560);
    await userEvent.click(page.getByRole('button', { name: 'Tutup' }));
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it('stays open while the caller keeps it open (a filled form asks first)', async () => {
    const onOpenChange = vi.fn();
    const { dialog } = await openSheet({ onOpenChange, keepOpen: true });
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await expect.element(dialog).toBeVisible();
  });

  it('scrolls a long body between the pinned header and footer', async () => {
    await page.viewport(1024, 400);
    const { dialog } = await openSheet({
      children: <div className="h-[2000px]">panjang</div>,
      footer: <button type="button">Simpan</button>,
    });
    await expect.element(page.getByRole('button', { name: 'Simpan' })).toBeInViewport();
    await expect.element(dialog).not.toHaveAccessibleDescription();
  });
});
