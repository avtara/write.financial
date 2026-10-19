// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { ColorPicker } from './color-picker.tsx';

function Harness({ initial }: { initial: string }) {
  const [color, setColor] = useState(initial);
  return (
    <>
      <ColorPicker label="Warna" value={color} onValueChange={setColor} />
      <output>{color}</output>
    </>
  );
}

describe('ColorPicker', () => {
  it('chooses a palette color with the mouse or arrow keys', async () => {
    const { screen } = await renderApp(<Harness initial="cyan" />);
    const group = screen.getByRole('group', { name: 'Warna' });
    await expect.element(group.getByRole('radio', { name: 'Sian' })).toBeChecked();
    await group.getByRole('radio', { name: 'Ungu' }).click();
    await expect.element(screen.getByText('violet')).toBeVisible();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(group.getByRole('button', { name: 'Warna lain' })).toHaveAttribute('aria-pressed', 'false');
    await group.getByRole('button', { name: 'Warna lain' }).click();
    await expect.element(screen.getByLabelText('Kode warna hex')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByLabelText('Kode warna hex')).not.toBeInTheDocument();
    await expect.element(screen.getByText('rose')).toBeVisible();
    await expect.element(group.getByRole('button', { name: 'Warna lain' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies a typed hex color, refuses an invalid one, and cancels without a change', async () => {
    const { screen } = await renderApp(<Harness initial="cyan" />);
    await screen.getByRole('button', { name: 'Warna lain' }).click();
    const hex = screen.getByLabelText('Kode warna hex');
    await expect.element(hex).toHaveValue('14B8A6');
    await hex.fill('#12');
    await expect.element(hex).toHaveAttribute('aria-invalid', 'true');
    await expect.element(screen.getByRole('button', { name: 'Pakai warna' })).toBeDisabled();
    await expect.element(screen.getByLabelText('Pilih dari palet sistem')).toHaveValue('#000000');
    await hex.fill('ff8800');
    await screen.getByRole('button', { name: 'Pakai warna' }).click();
    await expect.element(screen.getByText('#ff8800')).toBeVisible();

    const custom = screen.getByRole('button', { name: 'Warna lain: #FF8800' });
    await expect.element(custom).toHaveAttribute('aria-pressed', 'true');
    await custom.click();
    await expect.element(screen.getByLabelText('Kode warna hex')).toHaveValue('FF8800');
    await screen.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByLabelText('Kode warna hex')).not.toBeInTheDocument();
    await expect.element(screen.getByText('#ff8800')).toBeVisible();
  });

  it('takes a color from the system picker', async () => {
    const { screen } = await renderApp(<Harness initial="#14b8a6" />);
    await screen.getByRole('button', { name: 'Warna lain: #14B8A6' }).click();
    const system = screen.getByLabelText('Pilih dari palet sistem');
    await expect.element(system).toHaveValue('#14b8a6');
    await system.fill('#3366cc');
    await expect.element(screen.getByLabelText('Kode warna hex')).toHaveValue('3366CC');
    await screen.getByRole('button', { name: 'Pakai warna' }).click();
    await expect.element(screen.getByText('#3366cc')).toBeVisible();
  });
});
