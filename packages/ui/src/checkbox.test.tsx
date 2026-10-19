// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Checkbox } from './checkbox.tsx';

describe('Checkbox', () => {
  it('toggles by its label and shows an optional description', async () => {
    const onChange = vi.fn();
    const screen = await render(
      <>
        <Checkbox label="Ingat saya" description="30 hari" onChange={onChange} />
        <Checkbox label="Tanpa deskripsi" className="extra" />
      </>,
    );
    await userEvent.click(screen.getByText('Ingat saya'));
    expect(onChange).toHaveBeenCalledTimes(1);
    await expect.element(screen.getByRole('checkbox', { name: /Ingat saya/ })).toBeChecked();
    await expect.element(screen.getByText('30 hari')).toBeVisible();
    const plain = screen.getByRole('checkbox', { name: 'Tanpa deskripsi' });
    await expect.element(plain).not.toBeChecked();
    expect(plain.element().closest('label')?.className).toContain('extra');
  });

  it('toggles with Space, draws the check only when checked, and submits with a form', async () => {
    const screen = await render(
      <form aria-label="Ekspor">
        <Checkbox label="Tag" name="columns" value="tag" />
      </form>,
    );
    const box = screen.getByRole('checkbox', { name: 'Tag' });
    const check = box.element().nextElementSibling as SVGElement;
    expect(getComputedStyle(check).opacity).toBe('0');
    await userEvent.tab();
    await userEvent.keyboard(' ');
    await expect.element(box).toBeChecked();
    expect(getComputedStyle(check).opacity).toBe('1');
    const form = screen.getByRole('form').element() as HTMLFormElement;
    expect(new FormData(form).getAll('columns')).toEqual(['tag']);
  });

  it('can be disabled', async () => {
    const screen = await render(<Checkbox label="ID transaksi" disabled />);
    await expect.element(screen.getByRole('checkbox', { name: 'ID transaksi' })).toBeDisabled();
  });
});
