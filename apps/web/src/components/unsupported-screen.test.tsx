// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import '../styles.css';
import { UnsupportedScreen } from './unsupported-screen.tsx';

// The locale lives in a cookie that outlives this file; later browser test files expect Indonesian.
afterEach(async () => {
  await setLocale('id', { reload: false });
});

describe('UnsupportedScreen', () => {
  it('asks a phone for a wider screen, with nothing to do on it', async () => {
    await setLocale('id', { reload: false });
    await page.viewport(390, 844);
    const screen = await render(<UnsupportedScreen />);
    await expect
      .element(screen.getByRole('heading', { name: 'Untuk sementara hanya di desktop atau tablet' }))
      .toBeVisible();
    await expect
      .element(screen.getByText('write.financial dibuat untuk desktop. Versi mobile sedang disiapkan.'))
      .toBeVisible();
    expect(screen.getByRole('button').query()).toBeNull();
  });

  it('is hidden from 768 px on, in English too', async () => {
    await setLocale('en', { reload: false });
    await page.viewport(768, 800);
    const screen = await render(<UnsupportedScreen />);
    await expect
      .element(screen.getByRole('heading', { name: 'Whoops! This screen is too narrow', includeHidden: true }))
      .not.toBeVisible();
    expect(screen.container.textContent).toMatch(/your money quest is on a wider screen .*press START!$/);
  });
});
