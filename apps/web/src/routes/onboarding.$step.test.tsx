// SPDX-License-Identifier: AGPL-3.0-only
import { isRedirect } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { onboardingView } from '../../test/onboarding.ts';
import { renderApp } from '../../test/render.tsx';
import type { Gate, Viewer } from '../server/gate.ts';
import { Route } from './onboarding.$step.tsx';

const server = vi.hoisted(() => ({ getOnboarding: vi.fn() }));
vi.mock('../server/fn/onboarding.ts', () => server);

// The steps have their own tests; here each shows which it is and reports done.
vi.mock('../components/onboarding/profile-step.tsx', () => ({
  ProfileStep: ({ onSaved }: { onSaved: () => void }) => (
    <button type="button" onClick={onSaved}>
      profile step
    </button>
  ),
}));
vi.mock('../components/onboarding/period-step.tsx', () => ({ PeriodStep: () => <p>period step</p> }));
vi.mock('../components/onboarding/accounts-step.tsx', () => ({ AccountsStep: () => <p>accounts step</p> }));
vi.mock('../components/onboarding/goal-step.tsx', () => ({ GoalStep: () => <p>goal step</p> }));
vi.mock('../components/onboarding/done-step.tsx', () => ({
  DoneStep: ({ onFinished }: { onFinished: (target: string) => void }) => (
    <>
      <button
        type="button"
        onClick={() => {
          onFinished('overview');
        }}
      >
        to overview
      </button>
      <button
        type="button"
        onClick={() => {
          onFinished('password');
        }}
      >
        to password
      </button>
    </>
  ),
}));

const VIEWER: Viewer = {
  id: 'u1',
  sessionId: 's1',
  name: 'Avtara K.',
  email: 'avtara@example.test',
  image: null,
  locale: 'id',
  timezone: 'Asia/Jakarta',
  role: 'user',
  twoFactorEnabled: false,
  onboardingStep: 'accounts',
};

function beforeLoad(viewer: Viewer | null, step: string): unknown {
  const gate: Gate = {
    setup: 'complete',
    viewer,
    instanceName: 'write.financial',
    registrationMode: 'closed',
    googleEnabled: false,
  };
  try {
    return (Route.options.beforeLoad as (options: unknown) => unknown)({
      context: { gate },
      params: { step },
      location: { href: `/onboarding/${step}` },
    });
  } catch (error) {
    return error;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('/onboarding/$step', () => {
  it('opens the resume step and the ones before it', () => {
    expect(beforeLoad(VIEWER, 'accounts')).toEqual({ step: 'accounts' });
    expect(beforeLoad(VIEWER, 'profile')).toEqual({ step: 'profile' });
  });

  it('sends a later or unknown step to the resume step, and everyone else where they belong', () => {
    for (const step of ['goal', 'nope']) {
      const later = beforeLoad(VIEWER, step);
      expect(isRedirect(later)).toBe(true);
      expect(later).toMatchObject({ options: { to: '/onboarding/$step', params: { step: 'accounts' } } });
    }
    expect(beforeLoad(null, 'profile')).toMatchObject({
      options: { to: '/sign-in', search: { redirect: '/onboarding/profile' } },
    });
    expect(beforeLoad({ ...VIEWER, role: 'admin' }, 'profile')).toMatchObject({
      options: { to: '/two-factor-setup' },
    });
    expect(beforeLoad({ ...VIEWER, onboardingStep: null }, 'profile')).toMatchObject({ options: { to: '/' } });
  });

  it('loads the saved state every visit and names the page', async () => {
    server.getOnboarding.mockResolvedValue({ ok: true, value: onboardingView() });
    const loader = Route.options.loader as () => Promise<unknown>;
    expect(await loader()).toEqual({ ok: true, value: onboardingView() });
    expect(Route.options.gcTime).toBe(0);
    const head = Route.options.head as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Mulai · write.financial');
  });

  it('renders the step and moves on when it is saved', async () => {
    const navigate = vi.fn();
    vi.spyOn(Route, 'useNavigate').mockReturnValue(navigate);
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({ ok: true, value: onboardingView() });
    const Page = Route.options.component as ComponentType;
    for (const step of ['period', 'accounts', 'goal'] as const) {
      vi.spyOn(Route, 'useRouteContext').mockReturnValue({ step });
      const { screen } = await renderApp(<Page />);
      await expect.element(screen.getByText(`${step} step`)).toBeVisible();
      await screen.unmount();
    }
    vi.spyOn(Route, 'useRouteContext').mockReturnValue({ step: 'profile' });
    const { screen } = await renderApp(<Page />);
    await expect.element(screen.getByRole('navigation', { name: 'Langkah onboarding' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'profile step' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/onboarding/$step', params: { step: 'period' } });
  });

  it('leaves for the Overview or Settings › Profil once done', async () => {
    const navigate = vi.fn();
    vi.spyOn(Route, 'useNavigate').mockReturnValue(navigate);
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({ ok: true, value: onboardingView() });
    vi.spyOn(Route, 'useRouteContext').mockReturnValue({ step: 'done' });
    const Page = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'to overview' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/' });
    await userEvent.click(screen.getByRole('button', { name: 'to password' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/settings/$section', params: { section: 'profile' } });
  });

  it('explains a failed load and retries', async () => {
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({ ok: false, code: 'INTERNAL' });
    vi.spyOn(Route, 'useRouteContext').mockReturnValue({ step: 'period' });
    vi.spyOn(Route, 'useNavigate').mockReturnValue(vi.fn());
    const Page = Route.options.component as ComponentType;
    const { screen, router } = await renderApp(<Page />);
    const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await expect.element(screen.getByText('Onboarding tidak bisa dimuat')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(invalidate).toHaveBeenCalled();
  });
});
