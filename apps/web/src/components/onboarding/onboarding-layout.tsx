// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The onboarding frame (design Section 16 `vSYBL`, 1440 × 1024): the brand above a 640 px card with the five-step
 * stepper (done steps green with a check, the current one filled, later ones muted; steps reached so far are links,
 * so "Kembali" works from the keyboard too), the step's heading, its content, and the footer with "Langkah N dari 5".
 * The heading takes the focus when a step opens, so keyboard and screen-reader users start at the top of each step.
 */
import { Link } from '@tanstack/react-router';
import { isReachable, ONBOARDING_STEPS, stepNumber, type OnboardingStep } from '@wf/domain/onboarding';
import { m } from '@wf/i18n/messages';
import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { LocaleSwitcher } from '../auth-layout.tsx';
import { LogoTile } from '../logo-mark.tsx';

const STEP_LABEL: Readonly<Record<OnboardingStep, () => string>> = {
  profile: m.onboarding_step_profile,
  period: m.onboarding_step_period,
  accounts: m.onboarding_step_accounts,
  goal: m.onboarding_step_goal,
  done: m.onboarding_step_done,
};

export function OnboardingStepper({ current, resume }: { current: OnboardingStep; resume: OnboardingStep }) {
  return (
    <nav aria-label={m.onboarding_steps_label()}>
      <ol className="flex items-center gap-2.5">
        {ONBOARDING_STEPS.map((step, index) => {
          const active = step === current;
          const done = !active && stepNumber(step) < stepNumber(resume);
          const label = STEP_LABEL[step]();
          const content = (
            <>
              <span
                aria-hidden="true"
                className={`flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done ? 'bg-green text-on-accent' : active ? 'bg-fg text-primary-fg' : 'bg-muted text-subtle'
                }`}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : stepNumber(step)}
              </span>
              <span
                className={`whitespace-nowrap ${active ? 'font-semibold text-fg' : done ? 'text-fg' : 'text-subtle'}`}
              >
                {label}
              </span>
              {done ? <span className="sr-only">{m.onboarding_step_completed()}</span> : null}
            </>
          );
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              className="flex min-w-0 flex-1 items-center gap-2.5 last:flex-none"
            >
              {!active && isReachable(step, resume) ? (
                <Link
                  to="/onboarding/$step"
                  params={{ step }}
                  className="flex items-center gap-2 rounded-[6px] text-[12.5px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {content}
                </Link>
              ) : (
                <span className="flex items-center gap-2 text-[12.5px]">{content}</span>
              )}
              {index < ONBOARDING_STEPS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={`h-px min-w-3 flex-1 ${stepNumber(step) < stepNumber(resume) ? 'bg-green' : 'bg-border'}`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface OnboardingLayoutProps {
  readonly step: OnboardingStep;
  /** The step the user is to resume at (the furthest reached). */
  readonly resume: OnboardingStep;
  readonly children: ReactNode;
}

export function OnboardingLayout({ step, resume, children }: OnboardingLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-10 text-fg">
      <header className="flex w-full max-w-[640px] items-center justify-between gap-3 pb-6">
        <span className="flex items-center gap-2.5">
          <LogoTile variant="sidebar" />
          <span className="text-[15px] font-semibold">{m.app_name()}</span>
        </span>
        <LocaleSwitcher />
      </header>
      <main
        id="main"
        className="flex w-full max-w-[640px] flex-col gap-6 rounded-[16px] border border-border bg-card p-8 max-sm:p-5"
      >
        <OnboardingStepper current={step} resume={resume} />
        {children}
      </main>
    </div>
  );
}

/** The step's title (24 px) and description; focused when the step opens. */
export function OnboardingHeading({ title, description }: { title: string; description: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-1.5">
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-[24px] leading-tight font-semibold tracking-[-0.01em] outline-none"
      >
        {title}
      </h1>
      <p className="text-[14px] text-muted-fg">{description}</p>
    </div>
  );
}

/** "Langkah N dari 5" (or the step's own left action) and the step's buttons. */
export function OnboardingFooter({
  step,
  start,
  children,
}: {
  step: OnboardingStep;
  /** Replaces "Langkah N dari 5" on the left ("Kembali", "Lewati"). */
  start?: ReactNode;
  children: ReactNode;
}) {
  return (
    <footer className="flex items-center justify-between gap-3 pt-2">
      {start ?? (
        <span className="text-[12.5px] text-subtle">
          {m.setup_step_progress({ current: stepNumber(step), total: ONBOARDING_STEPS.length })}
        </span>
      )}
      <div className="flex items-center gap-2">{children}</div>
    </footer>
  );
}

/** "Kembali": the previous step (a link, so it needs no saving). */
export function OnboardingBack({ to }: { to: OnboardingStep }) {
  return (
    <Link
      to="/onboarding/$step"
      params={{ step: to }}
      className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] border border-border px-3 text-[12.5px] font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      {m.onboarding_back()}
    </Link>
  );
}
