// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { aiErrorMessage } from './ai-errors.ts';

describe('aiErrorMessage', () => {
  it('treats unknown provider text and inherited property names as opaque refusals', () => {
    const secret = 'test-key';
    const fallback = aiErrorMessage(`provider failed: ${secret}`, 'id');
    expect(aiErrorMessage('constructor', 'id')).toBe(fallback);
    expect(fallback).not.toContain(secret);
    expect(fallback).not.toContain('provider failed:');
  });
});
