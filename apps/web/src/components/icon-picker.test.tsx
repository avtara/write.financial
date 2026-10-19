// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { CATEGORY_ICONS } from './category-icon.tsx';
import { IconPicker } from './icon-picker.tsx';

function Harness() {
  const [icon, setIcon] = useState('utensils');
  return (
    <>
      <IconPicker label="Ikon" value={icon} color="orange" onValueChange={setIcon} />
      <output>{icon}</output>
    </>
  );
}

describe('IconPicker', () => {
  it('offers every category glyph as a named radio and chooses with the mouse or arrow keys', async () => {
    const { screen } = await renderApp(<Harness />);
    const group = screen.getByRole('group', { name: 'Ikon' });
    expect(group.getByRole('radio').elements()).toHaveLength(Object.keys(CATEGORY_ICONS).length);
    await expect.element(group.getByRole('radio', { name: 'Makan' })).toBeChecked();

    await group.getByRole('radio', { name: 'Pendidikan' }).click();
    await expect.element(screen.getByText('graduation-cap')).toBeVisible();

    await userEvent.keyboard('{ArrowRight}');
    await expect.element(screen.getByText('book-open')).toBeVisible();
    await expect.element(group.getByRole('radio', { name: 'Buku' })).toHaveFocus();
  });
});
