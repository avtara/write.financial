// SPDX-License-Identifier: AGPL-3.0-only
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { SecretInput, type SecretInputProps } from './secret-input.tsx';

const labels = { label: 'Kunci API', showLabel: 'Tampilkan kunci', hideLabel: 'Sembunyikan kunci' };

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error === null ? this.props.children : <output>{this.state.error.message}</output>;
  }
}

async function renderSecret(props: Partial<SecretInputProps> = {}) {
  const onChange = vi.fn<(value: string) => void>();
  const screen = await render(<SecretInput {...labels} onChange={onChange} {...props} />);
  return { screen, onChange, input: screen.getByLabelText('Kunci API') };
}

describe('SecretInput', () => {
  it('starts empty as a password field and shows only the last 4 characters as a hint', async () => {
    const { input } = await renderSecret({ last4: 'x9Qa', name: 'apiKey' });
    await expect.element(input).toHaveValue('');
    await expect.element(input).toHaveAttribute('type', 'password');
    await expect.element(input).toHaveAttribute('placeholder', '•••• x9Qa');
    await expect.element(input).toHaveAttribute('name', 'apiKey');
    await expect.element(input).toHaveAttribute('autocomplete', 'off');
    await expect.element(input).toHaveAttribute('spellcheck', 'false');
  });

  it('has no placeholder when nothing is stored yet', async () => {
    const { input } = await renderSecret();
    await expect.element(input).not.toHaveAttribute('placeholder');
  });

  it('reports the new value as it is typed', async () => {
    const { input, onChange } = await renderSecret();
    await userEvent.type(input, 'sk-new');
    expect(onChange).toHaveBeenLastCalledWith('sk-new');
    await expect.element(input).toHaveValue('sk-new');
  });

  it('toggles between hidden and shown with an accessible button', async () => {
    const { screen, input } = await renderSecret();
    const show = screen.getByRole('button', { name: 'Tampilkan kunci' });
    await expect.element(show).toHaveAttribute('aria-controls', input.element().id);
    await userEvent.click(show);
    await expect.element(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan kunci' }));
    await expect.element(input).toHaveAttribute('type', 'password');
  });

  it('can be disabled', async () => {
    const { screen, input } = await renderSecret({ disabled: true });
    await expect.element(input).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'Tampilkan kunci' })).toBeDisabled();
  });

  it('refuses anything longer than the last 4 characters of a stored secret', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const screen = await render(
      <Boundary>
        <SecretInput {...labels} onChange={() => {}} last4="sk-full-secret" />
      </Boundary>,
    );
    await expect
      .element(screen.getByText('SecretInput only accepts the last 4 characters of a stored secret'))
      .toBeInTheDocument();
    expect(screen.container.innerHTML).not.toContain('sk-full-secret');
  });

  it('counts characters, not UTF-16 units, for the last 4', async () => {
    const { input } = await renderSecret({ last4: '😀😀😀😀' });
    await expect.element(input).toHaveAttribute('placeholder', '•••• 😀😀😀😀');
  });
});
