// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { MIN_PASSWORD_LENGTH, PasswordInput, passwordStrength } from './password-field.tsx';

beforeEach(async () => {
  await setLocale('id', { reload: false });
});

describe('passwordStrength', () => {
  it('is 0 below the minimum and grows with variety and length', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(passwordStrength('Ab1!Ab1!A')).toBe(0);
    expect(passwordStrength('abcdefghij')).toBe(1);
    expect(passwordStrength('abcdefghiJ')).toBe(2);
    expect(passwordStrength('abcdefgh1J')).toBe(3);
    expect(passwordStrength('abcdefg!1J')).toBe(4);
    expect(passwordStrength('abcdefghijklmN')).toBe(3);
    expect(passwordStrength('abcdefghijk!1N')).toBe(4);
    // Counted like the server's minimum (UTF-16 units): four emoji are too short, five are enough.
    expect(passwordStrength('😀'.repeat(4))).toBe(0);
    expect(passwordStrength('😀'.repeat(5))).toBe(1);
  });
});

function Controlled(props: { autoComplete: 'new-password' | 'current-password'; error?: string; disabled?: boolean }) {
  const [value, setValue] = useState('');
  return <PasswordInput label="Kata sandi" value={value} onChange={setValue} name="password" {...props} />;
}

describe('PasswordInput', () => {
  it('shows the strength of a new password as it is typed', async () => {
    const screen = await render(<Controlled autoComplete="new-password" />);
    const input = screen.getByLabelText('Kata sandi', { exact: true });
    await expect.element(input).toHaveAttribute('autocomplete', 'new-password');
    await expect.element(input).toHaveAccessibleDescription('Min. 10 karakter');
    await userEvent.fill(input, 'short');
    await expect.element(input).toHaveAccessibleDescription('Min. 10 karakter · terlalu pendek');
    await userEvent.fill(input, 'abcdefghij');
    await expect.element(input).toHaveAccessibleDescription('Min. 10 karakter · lemah');
    await userEvent.fill(input, 'abcdefghiJ');
    await expect.element(input).toHaveAccessibleDescription('Min. 10 karakter · cukup');
    await userEvent.fill(input, 'abcdefgh1J');
    await expect.element(input).toHaveAccessibleDescription('Min. 10 karakter · kuat');
    await userEvent.fill(input, 'abcdefg!1J');
    await expect.element(input).toHaveAccessibleDescription('Min. 10 karakter · sangat kuat');
  });

  it('shows and hides the password', async () => {
    const screen = await render(<Controlled autoComplete="current-password" />);
    const input = screen.getByLabelText('Kata sandi', { exact: true });
    await expect.element(input).toHaveAttribute('type', 'password');
    await expect.element(input).not.toHaveAttribute('aria-describedby');
    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan kata sandi' }));
    await expect.element(input).toHaveAttribute('type', 'text');
    const hide = screen.getByRole('button', { name: 'Sembunyikan kata sandi' });
    await expect.element(hide).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(hide);
    await expect.element(input).toHaveAttribute('type', 'password');
  });

  it('shows an error and can be disabled', async () => {
    const screen = await render(<Controlled autoComplete="current-password" error="Kata sandi salah" disabled />);
    const input = screen.getByLabelText('Kata sandi', { exact: true });
    await expect.element(input).toHaveAccessibleDescription('Kata sandi salah');
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');
    await expect.element(input).toBeDisabled();
  });
});
