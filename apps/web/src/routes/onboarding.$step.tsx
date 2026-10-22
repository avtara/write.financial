// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { isReachable, nextStep, ONBOARDING_STEPS } from '@wf/domain/onboarding';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import { AccountsStep } from '../components/onboarding/accounts-step.tsx';
import { DoneStep } from '../components/onboarding/done-step.tsx';
import { GoalStep } from '../components/onboarding/goal-step.tsx';
import { OnboardingLayout } from '../components/onboarding/onboarding-layout.tsx';
import { PeriodStep } from '../components/onboarding/period-step.tsx';
import { ProfileStep } from '../components/onboarding/profile-step.tsx';
import { Button } from '../components/form.tsx';
import { usePreferences } from '../components/preferences.tsx';
import { ledgerErrorMessage } from '../lib/ledger-errors.ts';
import { getOnboarding } from '../server/fn/onboarding.ts';

/**
 * `/onboarding/$step` (FR-A4, plan §7): the five steps for a signed-in user who has not completed them (`_app` sends
 * them here). The step the user is to resume at and the ones before it open; a later or unknown step leads to the
 * resume step, and a completed onboarding to the Overview. Admins enroll in two-step verification first (FR-A9).
 * Every visit loads the saved state afresh (`gcTime: 0`), so "Kembali" shows what the later steps saved.
 */
export const Route = createFileRoute('/onboarding/$step')({
  beforeLoad: ({ context, params, location }) => {
    const { viewer } = context.gate;
    if (viewer === null) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    if (viewer.role === 'admin' && !viewer.twoFactorEnabled) throw redirect({ to: '/two-factor-setup' });
    const resume = viewer.onboardingStep;
    if (resume === null) throw redirect({ to: '/' });
    const step = ONBOARDING_STEPS.find((candidate) => candidate === params.step);
    if (step === undefined || !isReachable(step, resume)) {
      throw redirect({ to: '/onboarding/$step', params: { step: resume } });
    }
    return { step };
  },
  loader: () => getOnboarding(),
  staleTime: 0,
  gcTime: 0,
  head: () => ({ meta: [{ title: `${m.onboarding_title()} · ${m.app_name()}` }] }),
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const { step } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { preferences } = usePreferences();
  if (!result.ok) {
    return (
      <OnboardingLayout step={step} resume={step}>
        <PageState
          kind="error"
          title={m.onboarding_load_failed()}
          description={ledgerErrorMessage(result.code, preferences.locale)}
          action={
            <Button variant="secondary" size="sm" onClick={() => void router.invalidate()}>
              {m.onboarding_retry()}
            </Button>
          }
        />
      </OnboardingLayout>
    );
  }
  const view = result.value;
  const onSaved = () => {
    void navigate({ to: '/onboarding/$step', params: { step: nextStep(step) } });
  };
  return (
    <OnboardingLayout step={step} resume={view.progress.step}>
      {step === 'profile' ? <ProfileStep view={view} onSaved={onSaved} /> : null}
      {step === 'period' ? <PeriodStep view={view} onSaved={onSaved} /> : null}
      {step === 'accounts' ? <AccountsStep view={view} onSaved={onSaved} /> : null}
      {step === 'goal' ? <GoalStep view={view} onSaved={onSaved} /> : null}
      {step === 'done' ? (
        <DoneStep
          view={view}
          onFinished={(target) => {
            void navigate(target === 'overview' ? { to: '/' } : { to: '/', search: { settings: 'profile' } });
          }}
        />
      ) : null}
    </OnboardingLayout>
  );
}
