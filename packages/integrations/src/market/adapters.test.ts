// SPDX-License-Identifier: AGPL-3.0-only
import { BYOK_PROVIDERS } from '@wf/domain/market';
import { describe, expect, it } from 'vitest';
import { createMarketAdapters } from './adapters.ts';

describe('createMarketAdapters', () => {
  it('has an adapter for every BYOK provider and the built-in quote sources, each under its own name', () => {
    const adapters = createMarketAdapters();
    expect(Object.keys(adapters).sort()).toEqual([...BYOK_PROVIDERS, 'fawazahmed0'].sort());
    for (const [provider, adapter] of Object.entries(adapters)) expect(adapter.provider).toBe(provider);
  });
});
