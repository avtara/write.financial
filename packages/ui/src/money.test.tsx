// SPDX-License-Identifier: AGPL-3.0-only
import type { Locale, MoneyContext } from '@wf/domain/money';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { Money } from './money.tsx';
import { PrivacyProvider } from './privacy.tsx';

const HIDDEN_LABEL = 'nominal disembunyikan';

function renderWithPrivacy(ui: ReactNode, hidden: boolean) {
  return render(
    <PrivacyProvider hidden={hidden} onHiddenChange={() => {}} hiddenLabel={HIDDEN_LABEL}>
      {ui}
    </PrivacyProvider>,
  );
}

/** Resolves a token to the computed `rgb(…)` string the browser reports for `color`. */
function tokenColor(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(--${token})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

async function renderMoney(minor: bigint, context: MoneyContext, locale: Locale, hidden = false) {
  const screen = await renderWithPrivacy(
    <Money minor={minor} currency="IDR" context={context} locale={locale} className="extra" />,
    hidden,
  );
  return screen.container.querySelector('span.extra') as HTMLElement;
}

describe('Money', () => {
  it.each([
    ['amount', 'id', 55_023_000n, 'Rp55.023.000'],
    ['amount', 'en', 55_023_000n, 'Rp55,023,000'],
    ['amount', 'id', -2_277_000n, '−Rp2.277.000'],
    ['table', 'id', 42_810_000n, '42.810.000'],
    ['table', 'en', 42_810_000n, '42,810,000'],
    ['table', 'id', -42_810_000n, '−42.810.000'],
    ['delta', 'id', 9_500_000n, '+9.500.000'],
    ['delta', 'en', -2_277_000n, '−2,277,000'],
  ] as const)('formats %s in %s: %s → %s', async (context, locale, minor, expected) => {
    const element = await renderMoney(minor, context, locale);
    expect(element.textContent).toBe(expected);
  });

  it('uses Geist Mono tabular figures and right-aligns only in table context', async () => {
    const table = await renderMoney(42_810_000n, 'table', 'id');
    expect(getComputedStyle(table).fontFamily).toContain('Geist Mono');
    expect(getComputedStyle(table).fontVariantNumeric).toBe('tabular-nums');
    expect(getComputedStyle(table).textAlign).toBe('right');
    const amount = await renderMoney(42_810_000n, 'amount', 'id');
    expect(getComputedStyle(amount).textAlign).not.toBe('right');
  });

  it('colors deltas by sign and leaves zero, amounts, and table cells uncolored', async () => {
    expect(getComputedStyle(await renderMoney(9_500_000n, 'delta', 'id')).color).toBe(tokenColor('green-fg'));
    expect(getComputedStyle(await renderMoney(-2_277_000n, 'delta', 'id')).color).toBe(tokenColor('red-fg'));
    const neutral = tokenColor('fg');
    expect(getComputedStyle(await renderMoney(0n, 'delta', 'id')).color).toBe(neutral);
    expect(getComputedStyle(await renderMoney(-2_277_000n, 'amount', 'id')).color).toBe(neutral);
    expect(getComputedStyle(await renderMoney(-2_277_000n, 'table', 'id')).color).toBe(neutral);
  });

  it.each([
    ['amount', 'Rp••••••'],
    ['table', '••••••'],
    ['delta', '••••••'],
  ] as const)('hides the %s value in privacy mode without leaking it to the DOM', async (context, masked) => {
    const element = await renderMoney(-2_277_000n, context, 'id', true);
    const visible = element.querySelector('[aria-hidden="true"]');
    expect(visible?.textContent).toBe(masked);
    expect(element.textContent).toBe(`${masked}${HIDDEN_LABEL}`);
    expect(element.outerHTML).not.toMatch(/\d/);
    // The sign color would reveal whether the hidden delta is a gain or a loss.
    expect(getComputedStyle(element).color).toBe(tokenColor('fg'));
  });

  it('announces the hidden label instead of the dots', async () => {
    const screen = await renderWithPrivacy(<Money minor={1n} currency="IDR" context="amount" locale="en" />, true);
    const label = screen.getByText(HIDDEN_LABEL);
    await expect.element(label).toBeInTheDocument();
    // `sr-only` keeps it out of the visual layout but in the accessibility tree.
    expect(label.element().getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it('formats foreign currencies with their minor digits', async () => {
    const screen = await renderWithPrivacy(
      <Money minor={69_010n} currency="USD" context="amount" locale="id" />,
      false,
    );
    await expect.element(screen.getByText('US$690,10')).toBeInTheDocument();
  });
});
