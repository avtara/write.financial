// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { Percent, type PercentProps } from './percent.tsx';

async function text(props: PercentProps) {
  const screen = await render(<Percent {...props} />);
  return screen.container.textContent;
}

describe('Percent', () => {
  it.each([
    [0.365, 'id', '36,50%'],
    [0.365, 'en', '36.50%'],
    [1_300_000 / 1_500_000, 'id', '86,67%'],
    [0.87, 'en', '87.00%'],
    [0.48, 'id', '48,00%'],
    [0.13949, 'id', '13,95%'],
    [12.345, 'id', '1.234,50%'],
    [12.345, 'en', '1,234.50%'],
    [-0.031, 'id', '\u22123,10%'],
    [0, 'en', '0.00%'],
  ] as const)('formats %d in %s as %s', async (value, locale, expected) => {
    expect(await text({ value, locale })).toBe(expected);
  });

  it('always carries two decimals, whatever the ratio', async () => {
    expect(await text({ value: 0.0051, locale: 'id' })).toBe('0,51%');
    expect(await text({ value: 11_125_000 / 54_000_000, locale: 'en' })).toBe('20.60%');
  });

  it.each([
    [0.041, 'id', '+4,10%'],
    [-0.098, 'id', '\u22129,80%'],
    [-0.098, 'en', '\u22129.80%'],
    [0, 'id', '0,00%'],
  ] as const)('signs changes: %d in %s as %s', async (value, locale, expected) => {
    expect(await text({ value, locale, signed: true })).toBe(expected);
  });

  it('uses tabular Geist Mono figures', async () => {
    const screen = await render(<Percent value={0.5} locale="id" className="extra" />);
    const element = screen.container.querySelector('span.extra') as HTMLElement;
    expect(getComputedStyle(element).fontFamily).toContain('Geist Mono');
    expect(getComputedStyle(element).fontVariantNumeric).toBe('tabular-nums');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects %d instead of printing it', (value) => {
    expect(() => Percent({ value, locale: 'id' })).toThrow(RangeError);
  });
});
