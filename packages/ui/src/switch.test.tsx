// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Switch } from './switch.tsx';

function tokenColor(token: string): string {
  const probe = document.createElement('span');
  probe.style.backgroundColor = `var(--${token})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

describe('Switch', () => {
  it('is a named switch that toggles by label and with Space', async () => {
    const onChange = vi.fn();
    const screen = await render(
      <Switch
        label="Hitung dalam total saldo"
        description="Masuk ke kekayaan bersih dan laporan"
        onChange={onChange}
        className="extra"
      />,
    );
    const toggle = screen.getByRole('switch', { name: /Hitung dalam total saldo/ });
    await expect.element(toggle).not.toBeChecked();
    expect(getComputedStyle(toggle.element()).backgroundColor).toBe(tokenColor('surface-5'));
    await userEvent.click(screen.getByText('Hitung dalam total saldo'));
    await expect.element(toggle).toBeChecked();
    expect(getComputedStyle(toggle.element()).backgroundColor).toBe(tokenColor('fg'));
    await userEvent.keyboard(' ');
    await expect.element(toggle).not.toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(2);
    await expect.element(screen.getByText('Masuk ke kekayaan bersih dan laporan')).toBeVisible();
    expect(toggle.element().closest('label')?.className).toContain('extra');
  });

  it('can be disabled and works without a description', async () => {
    const screen = await render(<Switch label="Sertakan lampiran" disabled defaultChecked />);
    const toggle = screen.getByRole('switch', { name: 'Sertakan lampiran' });
    await expect.element(toggle).toBeDisabled();
    await expect.element(toggle).toBeChecked();
  });
});
