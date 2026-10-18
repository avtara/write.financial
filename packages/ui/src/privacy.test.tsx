// SPDX-License-Identifier: AGPL-3.0-only
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { PrivacyProvider, usePrivacy } from './privacy.tsx';

function Toggle() {
  const { hidden, setHidden, hiddenLabel } = usePrivacy();
  return (
    <button
      type="button"
      aria-pressed={hidden}
      aria-label={hiddenLabel}
      onClick={() => {
        setHidden(!hidden);
      }}
    >
      {hidden ? 'on' : 'off'}
    </button>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error === null ? this.props.children : <output>{this.state.error.name}</output>;
  }
}

describe('PrivacyProvider', () => {
  it('exposes the caller-owned state and reports toggles back to the caller', async () => {
    const onHiddenChange = vi.fn<(hidden: boolean) => void>();
    const screen = await render(
      <PrivacyProvider hidden={false} onHiddenChange={onHiddenChange} hiddenLabel="saldo disembunyikan">
        <Toggle />
      </PrivacyProvider>,
    );
    const toggle = screen.getByRole('button', { name: 'saldo disembunyikan' });
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(onHiddenChange).toHaveBeenCalledWith(true);
    // Controlled: nothing changes until the caller passes the new value.
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
    await screen.rerender(
      <PrivacyProvider hidden onHiddenChange={onHiddenChange} hiddenLabel="saldo disembunyikan">
        <Toggle />
      </PrivacyProvider>,
    );
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('refuses to render money-aware components without a provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const screen = await render(
      <Boundary>
        <Toggle />
      </Boundary>,
    );
    await expect.element(screen.getByText('MissingPrivacyProviderError')).toBeInTheDocument();
  });
});
