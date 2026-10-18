// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, notFound } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { FormError } from '../../components/form.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { InstanceSection } from '../../components/settings/instance-section.tsx';
import { ProfileSection } from '../../components/settings/profile-section.tsx';
import { SecuritySection } from '../../components/settings/security-section.tsx';
import { canOpenSection, SettingsLayout } from '../../components/settings/settings-layout.tsx';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { getProfile, getSecurity } from '../../server/fn/account.ts';

/**
 * `/settings/profile`, `/settings/security`, and (admins) `/settings/instance`. Profile also loads the security
 * overview for its sign-in methods (Google linked, password set); the instance section loads its own data.
 */
export const Route = createFileRoute('/_app/settings/$section')({
  loader: async ({ params, context }) => {
    const { section } = params;
    if (!canOpenSection(section, context.viewer)) throw notFound();
    if (section === 'profile') {
      const [profile, security] = await Promise.all([getProfile(), getSecurity()]);
      return { section, profile, security };
    }
    if (section === 'security') return { section, security: await getSecurity() };
    return { section };
  },
  head: () => ({ meta: [{ title: `${m.settings_title()} · ${m.app_name()}` }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const data = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  const { preferences } = usePreferences();

  let content;
  if (data.section === 'instance') {
    content = <InstanceSection />;
  } else if (!data.security.ok) {
    content = <FormError>{authErrorMessage({ code: data.security.code }, preferences.locale)}</FormError>;
  } else if (data.section === 'security') {
    content = <SecuritySection viewer={viewer} overview={data.security.value} />;
  } else if (!data.profile.ok) {
    content = <FormError>{authErrorMessage({ code: data.profile.code }, preferences.locale)}</FormError>;
  } else {
    content = <ProfileSection viewer={viewer} profile={data.profile.value} methods={data.security.value} />;
  }

  return (
    <SettingsLayout viewer={viewer} section={data.section}>
      {content}
    </SettingsLayout>
  );
}
