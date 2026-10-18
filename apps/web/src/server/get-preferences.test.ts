// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../lib/preferences.ts';

// Outside the Start runtime a server function cannot run; keep only its handler.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: <T>(handler: T) => handler }),
}));

const { getPreferences } = await import('./get-preferences.ts');

describe('getPreferences', () => {
  it('returns the preferences the request middleware resolved', () => {
    const preferences: Preferences = { locale: 'en', theme: 'light', balancesHidden: true, platform: 'mac' };
    const handler = getPreferences as unknown as (options: { context: { preferences: Preferences } }) => Preferences;
    expect(handler({ context: { preferences } })).toBe(preferences);
  });
});
