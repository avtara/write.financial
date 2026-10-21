// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { rangeOf } from './notifications-search.ts';

const today = '2026-10-17' as LocalDate;

describe('rangeOf', () => {
  it('is the last 30 days unless the search names its dates', () => {
    expect(rangeOf({}, today)).toEqual({ start: '2026-09-18', end: '2026-10-17' });
    expect(rangeOf({ to: '2026-10-10' as LocalDate }, today)).toEqual({ start: '2026-09-11', end: '2026-10-10' });
    expect(rangeOf({ from: '2026-10-01' as LocalDate, to: '2026-10-05' as LocalDate }, today)).toEqual({
      start: '2026-10-01',
      end: '2026-10-05',
    });
  });
});
