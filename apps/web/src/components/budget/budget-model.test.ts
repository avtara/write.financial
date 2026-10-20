// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { barLength, BUDGET_SORTS, lineTone, sortLines } from './budget-model.ts';

describe('lineTone', () => {
  it('is red over the limit, amber at the warning or paid, idle unused, green else', () => {
    expect(lineTone({ state: 'over' })).toBe('over');
    expect(lineTone({ state: 'warning' })).toBe('warning');
    expect(lineTone({ state: 'paid' })).toBe('warning');
    expect(lineTone({ state: 'unused' })).toBe('idle');
    expect(lineTone({ state: 'ok' })).toBe('ok');
  });
});

describe('barLength', () => {
  it('maps basis points to the 0–1000 bar, clamped, and no limit to 0', () => {
    expect(barLength(null)).toBe(0);
    expect(barLength(-5)).toBe(0);
    expect(barLength(4839)).toBe(483.9);
    expect(barLength(12_000)).toBe(1000);
  });
});

describe('sortLines', () => {
  const a = { id: 'a', name: 'Makan', state: 'ok', usedBps: 5000, remainingMinor: 300n } as const;
  const b = { id: 'b', name: 'Belanja', state: 'over', usedBps: 12_000, remainingMinor: -400n } as const;
  const c = { id: 'c', name: 'Zakat', state: 'unused', usedBps: null, remainingMinor: 300n } as const;
  const d = { id: 'd', name: 'Ébook', state: 'warning', usedBps: 9000, remainingMinor: 900n } as const;
  const lines = [a, b, c, d];
  const ids = (sort: (typeof BUDGET_SORTS)[number]) =>
    sortLines(lines, sort, (line) => line.name, 'id').map((line) => line.id);

  it('orders by every "Urutkan" option without touching the input', () => {
    expect(BUDGET_SORTS).toEqual(['used', 'over_first', 'remaining', 'name', 'custom']);
    expect(ids('custom')).toEqual(['a', 'b', 'c', 'd']);
    expect(ids('used')).toEqual(['b', 'd', 'a', 'c']);
    expect(ids('over_first')).toEqual(['b', 'd', 'a', 'c']);
    expect(ids('remaining')).toEqual(['d', 'a', 'c', 'b']);
    expect(ids('name')).toEqual(['b', 'd', 'a', 'c']);
    expect(lines.map((line) => line.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts an over line first even when another one is used more', () => {
    const over = { ...b, usedBps: 10_100 };
    const high = { ...d, usedBps: 20_000, state: 'ok' } as const;
    expect(sortLines([high, over], 'over_first', (line) => line.name, 'id')).toEqual([over, high]);
  });

  it('puts lines without a limit last whichever side they are compared on', () => {
    expect(sortLines([c, a], 'used', (line) => line.name, 'id')).toEqual([a, c]);
    expect(sortLines([a, c], 'used', (line) => line.name, 'id')).toEqual([a, c]);
  });
});
