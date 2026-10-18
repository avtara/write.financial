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
    [0.365, 'id', '36,5%'],
    [0.365, 'en', '36.5%'],
    [1_300_000 / 1_500_000, 'id', '86,7%'],
    [0.87, 'en', '87%'],
    [0.48, 'id', '48%'],
    [0.13949, 'id', '13,9%'],
    [12.345, 'id', '1.234,5%'],
    [12.345, 'en', '1,234.5%'],
    [-0.031, 'id', '\u22123,1%'],
    [0, 'en', '0%'],
  ] as const)('formats %d in %s as %s', async (value, locale, expected) => {
    expect(await text({ value, locale })).toBe(expected);
  });

  it.each([
    [1_300_000 / 1_500_000, 0, '87%'],
    [11_125_000 / 54_000_000, 0, '21%'],
    [0.0051, 2, '0,51%'],
    [0.0051, 1, '0,5%'],
  ] as const)('rounds %d to at most %d decimals: %s', async (value, decimals, expected) => {
    expect(await text({ value, locale: 'id', decimals })).toBe(expected);
  });

  it.each([
    [0.041, 'id', '+4,1%'],
    [-0.098, 'id', '\u22129,8%'],
    [-0.098, 'en', '\u22129.8%'],
    [0, 'id', '0%'],
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
