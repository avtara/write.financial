// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { SetupSteps } from './setup-steps.tsx';

describe('SetupSteps', () => {
  it('lists the four steps and marks the current one', async () => {
    const { screen } = await renderApp(<SetupSteps current={2} />);
    await expect.element(screen.getByText('Langkah 2 dari 4')).toBeVisible();
    const steps = screen.getByRole('list', { name: 'Langkah penyiapan' }).getByRole('listitem');
    expect(steps.elements().map((step) => step.textContent)).toEqual([
      'Admin',
      '2Verifikasi dua langkah',
      '3Instans',
      '4Selesai',
    ]);
    expect(steps.elements().map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null, null]);
    // The finished step shows a check instead of its number.
    expect(steps.elements()[0]?.querySelector('svg')).not.toBeNull();
  });

  it('speaks English', async () => {
    const { screen } = await renderApp(<SetupSteps current={4} />, { preferences: { locale: 'en' } });
    await expect.element(screen.getByText('Step 4 of 4')).toBeVisible();
    await expect.element(screen.getByRole('listitem').nth(3)).toHaveAttribute('aria-current', 'step');
  });
});
