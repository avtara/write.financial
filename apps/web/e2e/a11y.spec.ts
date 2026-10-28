// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The M8 accessibility audit (PRD §8 M8 exit: "axe 0 serious violations") as its own invited user with the design
 * persona: axe-core (WCAG 2.1 A/AA rules) on every main page, the Settings sections, the Record Transaction sheet, and
 * the ⌘K palette, at 1440, 1024, and 768 px in the dark theme and at 1440 in the light one. A serious or critical
 * violation fails with its rule, help text, and the elements it hit; minor and moderate ones are not part of the gate.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openUserMenu, projectUser, setUpProjectUser, test } from './support.ts';

const user = projectUser('a11y');
// In order on one worker (the light-theme test switches the theme back at its end), but not serial: one page's
// violations must not skip the other widths.
test.describe.configure({ mode: 'default' });
test.use({ storageState: user.state });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
});

const PAGES = [
  '/',
  '/transactions',
  '/accounts',
  '/budget',
  '/calendar',
  '/subscriptions',
  '/review',
  '/goals',
  '/debts',
  '/investments',
  '/reports',
  '/notifications',
] as const;

const SETTINGS = [
  'profile',
  'period',
  'notifications',
  'categories',
  'tags',
  'rules',
  'data',
  'security',
  'ai',
  'market',
];

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
] as const;

/** axe on what is on screen now; fails with every serious or critical violation, described. */
async function expectAccessible(page: Page, where: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes
        .slice(0, 8)
        .map((node) => `${node.target.join(' ')} ${node.html.slice(0, 160)} — ${node.failureSummary ?? ''}`),
    }));
  // Soft: one run lists every page's violations instead of stopping at the first.
  expect.soft(serious, `${where}: serious axe violations`).toEqual([]);
}

/** `path`, loaded and hydrated (no request in flight), with the page heading shown. */
async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

for (const viewport of WIDTHS) {
  test(`every main page at ${String(viewport.width)} px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const path of PAGES) {
      await visit(page, path);
      await expectAccessible(page, `${path} @${String(viewport.width)}`);
    }
  });
}

test('the Settings sections, the Record Transaction sheet, and the ⌘K palette at 1440 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const section of SETTINGS) {
    await page.goto(`/?settings=${section}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('dialog', { name: 'Pengaturan' })).toBeVisible();
    await expectAccessible(page, `Settings › ${section}`);
  }
  await visit(page, '/');
  await page.getByRole('button', { name: /^Catat Transaksi/ }).click();
  await expect(page.getByRole('dialog', { name: /^Catat/ })).toBeVisible();
  await expectAccessible(page, 'Record Transaction sheet');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Cari/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Cari atau jalankan perintah' })).toBeVisible();
  await expectAccessible(page, '⌘K palette');
});

test('every main page in the light theme at 1440 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, '/');
  await openUserMenu(page);
  await page.getByRole('menuitemradio', { name: 'Terang' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  try {
    for (const path of PAGES) {
      await visit(page, path);
      await expectAccessible(page, `${path} (light)`);
    }
  } finally {
    await visit(page, '/');
    await openUserMenu(page);
    await page.getByRole('menuitemradio', { name: 'Gelap' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  }
});
