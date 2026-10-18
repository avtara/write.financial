// SPDX-License-Identifier: AGPL-3.0-only
import { getLocale } from '@wf/i18n/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { AuthHeading, AuthLayout } from './auth-layout.tsx';

beforeEach(async () => {
  await page.viewport(1440, 900);
});

describe('AuthLayout', () => {
  it('shows the brand panel beside the form column', async () => {
    const { screen } = await renderApp(
      <AuthLayout>
        <AuthHeading title="Judul" description="Deskripsi" />
      </AuthLayout>,
    );
    await expect.element(screen.getByRole('complementary')).toBeVisible();
    await expect.element(screen.getByText('Dicatat manual, tanpa login ke bank.', { exact: false })).toBeVisible();
    await expect.element(screen.getByText('36,5%')).toBeInTheDocument();
    const main = screen.getByRole('main');
    await expect.element(main.getByRole('heading', { level: 1, name: 'Judul' })).toBeVisible();
    await expect.element(main.getByText('Deskripsi')).toBeVisible();
  });

  it('hides the brand panel on phones', async () => {
    await page.viewport(390, 844);
    const { screen } = await renderApp(
      <AuthLayout>
        <AuthHeading title="Judul" />
      </AuthLayout>,
    );
    await expect.element(screen.getByRole('heading', { name: 'Judul' })).toBeVisible();
    expect(screen.container.querySelector('aside')).not.toBeNull();
    await expect.element(screen.getByText('write.financial', { exact: true })).not.toBeVisible();
  });

  it('switches the language at once', async () => {
    const { screen } = await renderApp(<AuthLayout>{null}</AuthLayout>);
    const switcher = screen.getByRole('combobox', { name: 'Bahasa' });
    await expect.element(switcher).toHaveValue('id');
    await userEvent.selectOptions(switcher, 'en');
    await expect.element(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
    expect(getLocale()).toBe('en');
  });

  it('ignores a value that is not a language', async () => {
    const { screen } = await renderApp(<AuthLayout>{null}</AuthLayout>);
    const switcher = screen.getByRole('combobox', { name: 'Bahasa' }).element() as HTMLSelectElement;
    switcher.value = 'xx';
    switcher.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getLocale()).toBe('id');
    await expect.element(screen.getByRole('combobox', { name: 'Bahasa' })).toBeVisible();
  });
});
