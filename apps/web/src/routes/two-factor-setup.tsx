// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { useAuthActions } from '../components/auth-actions.tsx';
import { AuthHeading, AuthLayout } from '../components/auth-layout.tsx';
import { TotpEnrollment } from '../components/totp-enrollment.tsx';
import { hardNavigate } from '../lib/navigation.ts';

/**
 * Forced two-step verification enrollment: admins cannot use the app until it is on (PRD §9.1, FR-A9); `_app`
 * sends them here. Signed-out visitors sign in first; anyone who already has it goes home.
 */
export const Route = createFileRoute('/two-factor-setup')({
  beforeLoad: ({ context }) => {
    const { viewer } = context.gate;
    if (viewer === null) throw redirect({ to: '/sign-in' });
    if (viewer.twoFactorEnabled) throw redirect({ to: '/' });
  },
  component: TwoFactorSetupPage,
});

function TwoFactorSetupPage() {
  const actions = useAuthActions();
  return (
    <AuthLayout>
      <AuthHeading title={m.enroll_title()} description={m.enroll_description()} />
      <TotpEnrollment
        needsPassword
        onDone={() => {
          hardNavigate('/');
        }}
      />
      <button
        type="button"
        onClick={() => {
          void actions.signOut().then(() => {
            hardNavigate('/sign-in');
          });
        }}
        className="self-center text-[13px] font-medium text-muted-fg hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {m.enroll_sign_out()}
      </button>
    </AuthLayout>
  );
}
