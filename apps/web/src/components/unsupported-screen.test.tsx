// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import '../styles.css';
import { UnsupportedScreen } from './unsupported-screen.tsx';

describe('UnsupportedScreen', () => {
  it('asks for a tablet or desktop below 768 px', async () => {
    await setLocale('id', { reload: false });
    await page.viewport(600, 800);
    const screen = await render(<UnsupportedScreen />);
    await expect.element(screen.getByRole('heading', { name: 'Gunakan tablet atau desktop' })).toBeVisible();
    await expect.element(screen.getByText(/dirancang untuk layar selebar 768 piksel/)).toBeVisible();
  });

  it('is hidden from 768 px on, in English too', async () => {
    await setLocale('en', { reload: false });
    await page.viewport(768, 800);
    const screen = await render(<UnsupportedScreen />);
    await expect
      .element(screen.getByRole('heading', { name: 'Use a tablet or desktop', includeHidden: true }))
      .not.toBeVisible();
  });
});
