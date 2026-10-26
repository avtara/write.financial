// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatUsd } from './ai-usd.ts';

describe('formatUsd', () => {
  it('keeps sub-cent digits instead of showing a paid request as free', () => {
    expect(formatUsd('1.24', 'id')).toBe('$1,24');
    expect(formatUsd('1.24', 'en')).toBe('$1.24');
    expect(formatUsd('0.0002', 'id')).toBe('$0,0002');
    expect(formatUsd('0.000000000000123456', 'en')).toBe('$0.000000000000123456');
  });

  it('groups thousands and pads to cents', () => {
    expect(formatUsd('1234.5', 'id')).toBe('$1.234,50');
    expect(formatUsd('1234.5', 'en')).toBe('$1,234.50');
    expect(formatUsd('0', 'id')).toBe('$0,00');
  });

  it('hides the amount in privacy mode and never renders a malformed or negative value', () => {
    expect(formatUsd('1.24', 'id', true)).toBe('••••••');
    expect(formatUsd('not-a-number', 'id')).not.toContain('$');
    expect(formatUsd('-1', 'id')).not.toContain('$');
  });
});
