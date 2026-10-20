// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import {
  OnboardingBack,
  OnboardingFooter,
  OnboardingHeading,
  OnboardingLayout,
  OnboardingStepper,
} from './onboarding-layout.tsx';

describe('OnboardingStepper', () => {
  it('marks done steps as links, the current one, and keeps later steps plain', async () => {
    const { screen } = await renderApp(<OnboardingStepper current="period" resume="goal" />);
    const steps = screen.getByRole('navigation', { name: 'Langkah onboarding' });
    await expect
      .element(steps.getByRole('link', { name: 'Profil (selesai)' }))
      .toHaveAttribute('href', '/onboarding/profile');
    // Reached but not current: a link back to it.
    await expect.element(steps.getByRole('link', { name: 'Rekening (selesai)' })).toBeVisible();
    await expect.element(steps.getByRole('link', { name: 'Tujuan' })).toHaveAttribute('href', '/onboarding/goal');
    expect(steps.getByRole('listitem').nth(1).element().getAttribute('aria-current')).toBe('step');
    expect(steps.getByRole('link', { name: /Periode/ }).query()).toBeNull();
    expect(steps.getByRole('link', { name: /Selesai/ }).query()).toBeNull();
  });
});

describe('OnboardingLayout', () => {
  it('frames the step with the brand, the language switch, and the stepper', async () => {
    const { screen } = await renderApp(
      <OnboardingLayout step="profile" resume="profile">
        <OnboardingHeading title="Halo, Avtara!" description="Cek dan sesuaikan." />
        <OnboardingFooter step="profile">
          <button type="button">Lanjut</button>
        </OnboardingFooter>
      </OnboardingLayout>,
    );
    await expect.element(screen.getByRole('main')).toBeVisible();
    await expect.element(screen.getByText('write.financial')).toBeVisible();
    await expect.element(screen.getByRole('combobox', { name: 'Bahasa' })).toBeVisible();
    // The heading takes the focus when the step opens.
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Halo, Avtara!' })).toHaveFocus();
    await expect.element(screen.getByText('Langkah 1 dari 5')).toBeVisible();
  });

  it('puts the step own left action in place of the progress, and links back', async () => {
    const { screen } = await renderApp(
      <OnboardingFooter step="accounts" start={<OnboardingBack to="period" />}>
        <span>Lanjut</span>
      </OnboardingFooter>,
    );
    await expect.element(screen.getByRole('link', { name: 'Kembali' })).toHaveAttribute('href', '/onboarding/period');
    expect(screen.getByText('Langkah 3 dari 5').query()).toBeNull();
  });
});
