// SPDX-License-Identifier: AGPL-3.0-only
/** The app shell, signed in as the user the `m0` project invited (no 2FA needed for users). */
import type { Page } from '@playwright/test';
import { expect, test, USER_STATE } from './support.ts';

test.use({ storageState: USER_STATE });

async function openUserMenu(page: Page) {
  await page.getByRole('button', { name: /^(Menu pengguna|User menu)$/ }).click();
}

test.describe('layout', () => {
  test('desktop 1440 shows the full sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const sidebar = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(sidebar).toHaveCount(1);
    await expect(sidebar.getByRole('link', { name: 'Ringkasan' })).toHaveAttribute('data-status', 'active');
    await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
    await expect(page.getByText('Belum ada data')).toBeVisible();
  });

  test('tablet 1024 shows the icon rail with tooltips', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    const rail = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(rail).toHaveCount(1);
    const overview = rail.getByRole('link', { name: 'Ringkasan' });
    await expect(overview).toBeVisible();
    await expect(overview).toHaveText('');
    await overview.hover();
    await expect(page.getByRole('tooltip', { name: 'Ringkasan' })).toBeVisible();
  });

  test('phones below 768 get the use-a-tablet page', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Gunakan tablet atau desktop' })).toBeVisible();
    await expect(page.getByRole('main')).toBeHidden();
  });
});

test('locale switch changes the text and <html lang> without a reload, and persists', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await openUserMenu(page);
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByText('No data yet')).toBeVisible();

  await openUserMenu(page);
  await page.getByRole('menuitemradio', { name: 'Bahasa Indonesia' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
});

test('theme and privacy mode persist across a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await openUserMenu(page);
  await page.getByRole('menuitemradio', { name: 'Terang' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');

  await openUserMenu(page);
  const hide = page.getByRole('menuitemcheckbox', { name: 'Sembunyikan saldo' });
  await hide.click();
  await expect(hide).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  const peek = page.getByRole('button', { name: /Intip saldo/ });
  await expect(peek).toBeVisible();

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(peek).toBeVisible();
  // The server picks ⌘ or Ctrl from the request's platform; press what the hint shows.
  const modifier = (await peek.locator('kbd kbd').first().textContent()) === '⌘' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+Period`);
  await expect(page.getByRole('button', { name: /Menampilkan · 5 dtk/ })).toBeVisible();

  await openUserMenu(page);
  await page.getByRole('menuitemradio', { name: 'Sistem' }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('pages carry a nonce-based CSP and the other security headers', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};
  const nonce = /'nonce-([^']+)'/.exec(headers['content-security-policy'] ?? '')?.[1];
  expect(nonce).toBeTruthy();
  expect(headers['content-security-policy']).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).not.toContain('unsafe-inline');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  await expect(page.locator('meta[property="csp-nonce"]')).toHaveAttribute('content', nonce ?? '');
  // Hydration ran under the policy: the shell is interactive.
  await openUserMenu(page);
  await expect(page.getByRole('menu')).toBeVisible();
});

test('/healthz answers ok', async ({ request }) => {
  const response = await request.get('/healthz');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
