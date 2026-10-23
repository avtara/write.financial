// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { FINAL_VIEW, PROVISIONAL_VIEW } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { GoalsSection } from './reports-goals.tsx';

describe('GoalsSection', () => {
  it('shows each goal as saved/target with its progress', async () => {
    const { screen } = await renderApp(<GoalsSection view={FINAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Posisi tujuan per 30 Sep' });
    await expect.element(section).toMatchTextContent('Dana Darurat');
    await expect.element(section).toMatchTextContent('Rp7.625.000');
    await expect.element(section).toMatchTextContent('/');
    await expect.element(section).toMatchTextContent('Rp54.000.000');
    await expect.element(section).toMatchTextContent('14,1%');
  });

  it('reads an honest "—" for a goal without an observation', async () => {
    const { screen } = await renderApp(<GoalsSection view={FINAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Posisi tujuan per 30 Sep' });
    await expect.element(section).toMatchTextContent('Porto Saham');
    await expect.element(section).toMatchTextContent('—');
  });

  it('says so when no historical observation exists for the range', async () => {
    const { screen } = await renderApp(<GoalsSection view={PROVISIONAL_VIEW} locale="id" />);
    await expect.element(screen.getByText('Riwayat posisi tujuan belum tersedia untuk rentang ini.')).toBeVisible();
  });

  it('uses the English copy', async () => {
    const { screen } = await renderApp(<GoalsSection view={FINAL_VIEW} locale="en" />, {
      preferences: { locale: 'en' },
    });
    await expect
      .element(screen.getByRole('region', { name: 'Goal positions as of Sep 30' }))
      .toMatchTextContent('Rp7,625,000');
  });
});
