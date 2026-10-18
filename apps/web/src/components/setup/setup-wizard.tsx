// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-run setup wizard (FR-OP1): 1 the admin account, 2 its mandatory two-step verification, 3 the instance
 * settings, 4 done (with the KEK backup reminder). The server decides the step from what exists (`getSetup`); after
 * each step the page reloads that state (`onRefresh`). Only "done" is local: once saved, the wizard is closed.
 */
import { m } from '@wf/i18n/messages';
import { useState, type ReactNode } from 'react';
import type { Result } from '../../server/access.ts';
import type { InstanceDraft, InstanceInput, SetupStep, SmtpInput } from '../../server/setup.ts';
import { AuthHeading, AuthLayout } from '../auth-layout.tsx';
import { InstanceForm } from '../instance-form.tsx';
import { TotpEnrollment } from '../totp-enrollment.tsx';
import { AdminStep, type AdminInput } from './admin-step.tsx';
import { DoneStep } from './done-step.tsx';
import { SetupSteps, type SetupStepNumber } from './setup-steps.tsx';

type View = SetupStep | 'done';

const NUMBER: Readonly<Record<View, SetupStepNumber>> = {
  admin: 1,
  'sign-in': 1,
  'two-factor': 2,
  instance: 3,
  done: 4,
};

const HEADING: Readonly<Record<View, { title: () => string; description: () => string }>> = {
  admin: { title: m.setup_admin_title, description: m.setup_admin_description },
  'sign-in': { title: m.setup_sign_in_title, description: m.setup_sign_in_description },
  'two-factor': { title: m.setup_two_factor_title, description: m.setup_two_factor_description },
  instance: { title: m.setup_instance_title, description: m.setup_instance_description },
  done: { title: m.setup_done_title, description: m.setup_done_description },
};

/** The sign-in page brings the admin back here afterwards. */
const SIGN_IN_HREF = '/sign-in?redirect=/setup';

export interface SetupWizardProps {
  step: SetupStep;
  draft: InstanceDraft;
  /** Reloads the wizard's state from the server (the next step). */
  onRefresh: () => Promise<void>;
  createAdmin: (input: AdminInput) => Promise<Result<null>>;
  sendTestEmail: (smtp: SmtpInput) => Promise<Result<null>>;
  save: (input: InstanceInput) => Promise<Result<null>>;
}

export function SetupWizard({ step, draft, onRefresh, createAdmin, sendTestEmail, save }: SetupWizardProps) {
  // The admin's password, kept from step 1 so enrollment does not ask for it again; dropped once 2FA is on.
  const [password, setPassword] = useState<string>();
  const [done, setDone] = useState(false);
  const view: View = done ? 'done' : step;
  const heading = HEADING[view];

  const content: Readonly<Record<View, () => ReactNode>> = {
    admin: () => (
      <AdminStep
        onCreate={createAdmin}
        onDone={async (signedInWith) => {
          setPassword(signedInWith);
          await onRefresh();
        }}
      />
    ),
    'sign-in': () => (
      <a
        href={SIGN_IN_HREF}
        className="inline-flex h-[42px] w-full items-center justify-center rounded-[9px] bg-fg px-4 text-[14px] font-semibold text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {m.setup_sign_in_action()}
      </a>
    ),
    'two-factor': () => (
      <TotpEnrollment
        needsPassword
        {...(password === undefined ? {} : { initialPassword: password })}
        onDone={() => {
          setPassword(undefined);
          void onRefresh();
        }}
      />
    ),
    instance: () => (
      <InstanceForm
        draft={draft}
        submitLabel={m.setup_instance_submit()}
        onTestEmail={sendTestEmail}
        onSave={async (input) => {
          const result = await save(input);
          if (result.ok) setDone(true);
          return result;
        }}
      />
    ),
    done: () => <DoneStep />,
  };

  return (
    <AuthLayout>
      <SetupSteps current={NUMBER[view]} />
      <AuthHeading title={heading.title()} description={heading.description()} />
      {content[view]()}
    </AuthLayout>
  );
}
