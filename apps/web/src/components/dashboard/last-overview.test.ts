// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { OverviewData } from '../overview-page.tsx';
import { lastOverview, rememberOverview } from './last-overview.ts';

describe('last overview', () => {
  it('keeps the data last shown', () => {
    expect(lastOverview()).toBeNull();
    const data = { loadedAt: new Date('2026-10-15T09:40:00Z') } as OverviewData;
    rememberOverview(data);
    expect(lastOverview()).toBe(data);
  });
});
