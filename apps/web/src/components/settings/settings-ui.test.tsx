// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Badge, SettingsGroup, SettingsRow } from './settings-ui.tsx';

describe('settings building blocks', () => {
  it('renders a labelled group of rows with optional descriptions, controls, and a header action', async () => {
    const { screen } = await renderApp(
      <SettingsGroup label="Akses" action={<button type="button">Semua</button>}>
        <SettingsRow title="Kata sandi" description="Diatur">
          <Badge>Aktif</Badge>
        </SettingsRow>
        <SettingsRow title="Email" />
      </SettingsGroup>,
    );
    const group = screen.getByRole('region', { name: 'Akses' });
    await expect.element(group.getByRole('heading', { name: 'Akses' })).toBeVisible();
    await expect.element(group.getByRole('button', { name: 'Semua' })).toBeVisible();
    await expect.element(group.getByText('Diatur')).toBeVisible();
    await expect.element(group.getByText('Aktif')).toBeVisible();
    expect(group.getByText('Email').element().nextElementSibling).toBeNull();
  });
});
