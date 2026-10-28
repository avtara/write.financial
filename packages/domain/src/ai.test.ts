// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { AiError, calculateAiCost, canReserveAiCost, normalizeAiPricing, parseAiUsd, resolveAiBaseUrl } from './ai.ts';

const pricing = { inputUsdPerMillion: '0.15', outputUsdPerMillion: '0.60', requestUsd: '0.0001', imageUsd: '0.02' };

describe('exact AI accounting', () => {
  it('combines subcent input, output, request and image fees without binary-float drift', () => {
    expect(calculateAiCost(pricing, { inputTokens: 1234, outputTokens: 567, images: 2 })).toBe('0.0406253');
    expect(normalizeAiPricing({ ...pricing, outputUsdPerMillion: '0.6000' }).outputUsdPerMillion).toBe('0.6');
    expect(
      calculateAiCost(
        {
          ...pricing,
          inputUsdPerMillion: '0.000000000000000001',
          outputUsdPerMillion: '0',
          requestUsd: '0',
          imageUsd: '0',
        },
        { inputTokens: 1, outputTokens: 0, images: 0 },
      ),
    ).toBe('0.000000000000000001');
    expect(
      calculateAiCost(
        { inputUsdPerMillion: '0', outputUsdPerMillion: '0', requestUsd: '0', imageUsd: '0' },
        { inputTokens: 20, outputTokens: 10, images: 1 },
      ),
    ).toBe('0');
  });

  it('includes in-flight requests at the exact cap and does not treat a zero cap as unlimited', () => {
    const values = { spentUsd: '0.1', reservedUsd: '0.2', nextUsd: '0.7', limitUsd: '1' };
    expect(canReserveAiCost(values)).toBe(true);
    expect(canReserveAiCost({ ...values, nextUsd: '0.700000000000000001' })).toBe(false);
    expect(canReserveAiCost({ spentUsd: '0', reservedUsd: '0', nextUsd: '0', limitUsd: '0' })).toBe(true);
    expect(canReserveAiCost({ spentUsd: '0', reservedUsd: '0', nextUsd: '0.000000000000000001', limitUsd: '0' })).toBe(
      false,
    );
  });

  it('rejects negative/invalid costs and unsafe counts without repeating untrusted text in errors', () => {
    for (const value of ['-1', 'NaN', '1e3', 'sensitive-provider-key', '0.0000000000000000001']) {
      expect(() => parseAiUsd(value)).toThrow(AiError);
      try {
        parseAiUsd(value);
      } catch (error) {
        expect(String(error)).not.toContain(value);
      }
    }
    for (const inputTokens of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => calculateAiCost(pricing, { inputTokens, outputTokens: 1, images: 0 })).toThrow(AiError);
    }
  });
});

describe('operator-authorized custom endpoints', () => {
  it('permits the exact configured API path and canonicalizes its trailing slash', () => {
    expect(resolveAiBaseUrl('custom', 'http://127.0.0.1:11434/v1/', ['http://127.0.0.1:11434/v1'])).toBe(
      'http://127.0.0.1:11434/v1',
    );
    expect(resolveAiBaseUrl('openrouter', 'https://attacker.example', [])).toBe('https://openrouter.ai/api/v1');
    expect(resolveAiBaseUrl('zenmux', undefined, [])).toBe('https://zenmux.ai/api/v1');
  });

  it('rejects unapproved origins, sibling paths, embedded credentials, query keys, fragments and non-HTTP URLs', () => {
    for (const value of [
      'http://127.0.0.1:11434/admin',
      'https://other.example/v1',
      'https://user:key@api.example/v1',
      'https://api.example/v1?key=secret',
      'https://api.example/v1#secret',
      'file:///etc/passwd',
      'not a URL',
    ]) {
      expect(() => resolveAiBaseUrl('custom', value, ['https://api.example/v1'])).toThrow(AiError);
    }
    expect(() => resolveAiBaseUrl('custom', undefined, ['https://api.example/v1'])).toThrow(AiError);
  });
});
