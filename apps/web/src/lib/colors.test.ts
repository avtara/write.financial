// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { colorProps, isColor, isColorToken, PALETTE_COLORS } from './colors.ts';

function fakeNode() {
  const properties = new Map<string, string>();
  return {
    properties,
    node: {
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
      },
    } as unknown as HTMLElement,
  };
}

describe('colors', () => {
  it('accepts tokens and #rrggbb only', () => {
    expect(PALETTE_COLORS.every(isColorToken)).toBe(true);
    expect(isColor('orange')).toBe(true);
    expect(isColor('#14B8A6')).toBe(true);
    expect(isColor('#14b8a')).toBe(false);
    expect(isColor('purple')).toBe(false);
    expect(isColor('url(x)')).toBe(false);
  });

  it('marks tokens with data-color and clears a leftover custom property', () => {
    const props = colorProps('orange');
    expect(props['data-color']).toBe('orange');
    const { node, properties } = fakeNode();
    properties.set('--wf-color', '#000000');
    props.ref(node);
    expect(properties.has('--wf-color')).toBe(false);
    props.ref(null);
  });

  it('sets hex colors through the CSSOM', () => {
    const props = colorProps('#14b8a6');
    expect(props['data-color']).toBeUndefined();
    const { node, properties } = fakeNode();
    props.ref(node);
    expect(properties.get('--wf-color')).toBe('#14b8a6');
  });

  it('leaves unknown values to the fallback', () => {
    const props = colorProps('chartreuse');
    expect(props).not.toHaveProperty('data-color');
    const { node, properties } = fakeNode();
    props.ref(node);
    expect(properties.size).toBe(0);
  });
});
