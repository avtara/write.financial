// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { appUrl } from './urls.ts';

describe('appUrl', () => {
  it('resolves app paths under the public URL, with or without its own path', () => {
    expect(appUrl('https://uang.example/', 'sign-up?invitation=abc')).toBe(
      'https://uang.example/sign-up?invitation=abc',
    );
    expect(appUrl('https://host.example/finance', '/settings/security')).toBe(
      'https://host.example/finance/settings/security',
    );
    expect(appUrl('https://host.example/finance/', 'settings/security')).toBe(
      'https://host.example/finance/settings/security',
    );
  });
});
