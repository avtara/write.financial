// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { Delta } from './delta.tsx';
import { PrivacyProvider } from './privacy.tsx';

async function renderDelta(minor: bigint, hidden = false) {
  const screen = await render(
    <PrivacyProvider hidden={hidden} onHiddenChange={() => {}} hiddenLabel="hidden amount">
      <Delta minor={minor} currency="IDR" locale="id" />
    </PrivacyProvider>,
  );
  return screen.container.textContent;
}

describe('Delta', () => {
  it('is always signed with the U+2212 minus', async () => {
    expect(await renderDelta(9_500_000n)).toBe('+9.500.000');
    expect(await renderDelta(-2_277_000n)).toBe('\u22122.277.000');
  });

  it('hides the sign and the value in privacy mode', async () => {
    expect(await renderDelta(-2_277_000n, true)).toBe('••••••hidden amount');
  });
});
