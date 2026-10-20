// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { defined, localDate } from './inputs.ts';

describe('localDate', () => {
  it('accepts real calendar dates only', () => {
    expect(localDate.safeParse('2026-10-15')).toEqual({ success: true, data: '2026-10-15' });
    expect(localDate.safeParse('2026-02-30').success).toBe(false);
    expect(localDate.safeParse('15/10/2026').success).toBe(false);
  });
});

describe('defined', () => {
  it('drops the properties that are undefined, keeping null', () => {
    const value = defined({ name: undefined, note: null, limit: 0 });
    expect(value).toEqual({ note: null, limit: 0 });
    expect(Object.keys(value)).toEqual(['note', 'limit']);
  });
});
