// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import '../styles.css';
import { UnsupportedScreen } from './unsupported-screen.tsx';

const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('./ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => ({ open: record.open }) }));

// The locale lives in a cookie that outlives this file; later browser test files expect Indonesian.
afterEach(async () => {
  await setLocale('id', { reload: false });
});

describe('UnsupportedScreen', () => {
  it('asks for a tablet or desktop below 768 px', async () => {
    await setLocale('id', { reload: false });
    await page.viewport(600, 800);
    const screen = await render(<UnsupportedScreen />);
    await expect.element(screen.getByRole('heading', { name: 'Gunakan tablet atau desktop' })).toBeVisible();
    await expect.element(screen.getByText(/dirancang untuk layar selebar 768 piksel/)).toBeVisible();
  });

  it('still lets a phone record a transaction', async () => {
    await setLocale('id', { reload: false });
    await page.viewport(390, 844);
    const screen = await render(<UnsupportedScreen />);
    const button = screen.getByRole('button', { name: 'Catat Transaksi' });
    expect(button.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    await userEvent.click(button);
    expect(record.open).toHaveBeenCalledOnce();
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
