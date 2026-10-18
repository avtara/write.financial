// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog.tsx';

type HarnessProps = Partial<Omit<ConfirmDialogProps, 'open'>>;

/** Owns `open` like a real caller and opens the dialog from a button, so focus can return to it. */
function Harness({ onOpenChange, onConfirm = () => {}, ...props }: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Keluar
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next);
          setOpen(next);
        }}
        title="Keluar dari write.financial?"
        description="Kamu perlu masuk lagi untuk melihat data keuangan."
        confirmLabel="Keluar"
        cancelLabel="Batal"
        onConfirm={onConfirm}
        {...props}
      />
    </>
  );
}

function tokenColor(token: string): string {
  const probe = document.createElement('span');
  probe.style.backgroundColor = `var(--${token})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

async function openDialog(props: HarnessProps = {}) {
  const screen = await render(<Harness {...props} />);
  const opener = screen.getByRole('button', { name: 'Keluar' });
  await userEvent.click(opener);
  const dialog = page.getByRole('alertdialog', { name: 'Keluar dari write.financial?' });
  await expect.element(dialog).toBeInTheDocument();
  return {
    opener,
    dialog,
    cancel: dialog.getByRole('button', { name: 'Batal' }),
    confirm: dialog.getByRole('button', { name: 'Keluar' }),
  };
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', async () => {
    await render(<Harness />);
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('describes the action and its impact, and starts focus on Cancel', async () => {
    const { dialog, cancel } = await openDialog({ impact: 'Aktif di 2 perangkat lain · iPhone, MacBook' });
    await expect
      .element(dialog)
      .toHaveAccessibleDescription(/^Kamu perlu masuk lagi untuk melihat data keuangan\.\s*Aktif di 2 perangkat lain/);
    await expect.element(cancel).toHaveFocus();
  });

  it('omits the impact note when there is none', async () => {
    const { dialog } = await openDialog();
    await expect.element(dialog).toHaveAccessibleDescription('Kamu perlu masuk lagi untuk melihat data keuangan.');
  });

  it('traps focus inside the dialog', async () => {
    const { cancel, confirm } = await openDialog();
    await userEvent.keyboard('{Tab}');
    await expect.element(confirm).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    await expect.element(cancel).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect.element(confirm).toHaveFocus();
  });

  it('closes on Escape without confirming and returns focus to the opener', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const { dialog, opener } = await openDialog({ onConfirm, onOpenChange });
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
    await expect.element(opener).toHaveFocus();
  });

  it('closes on Cancel without confirming', async () => {
    const onConfirm = vi.fn();
    const { dialog, cancel } = await openDialog({ onConfirm });
    await userEvent.click(cancel);
    await expect.element(dialog).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with the keyboard and closes', async () => {
    const onConfirm = vi.fn();
    const { dialog } = await openDialog({ onConfirm });
    await userEvent.keyboard('{Tab}{Enter}');
    expect(onConfirm).toHaveBeenCalledOnce();
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it.each([
    ['default', 'fg', 'amber-tint-2'],
    ['destructive', 'red', 'red-tint-2'],
  ] as const)('styles the %s variant', async (variant, confirmColor, impactColor) => {
    const { confirm } = await openDialog({ variant, impact: 'Dampak' });
    expect(getComputedStyle(confirm.element()).backgroundColor).toBe(tokenColor(confirmColor));
    expect(getComputedStyle(page.getByText('Dampak').element()).backgroundColor).toBe(tokenColor(impactColor));
  });
});
