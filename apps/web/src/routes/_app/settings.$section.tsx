// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, notFound } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { FormError } from '../../components/form.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { CategoriesSection } from '../../components/settings/categories-section.tsx';
import { InstanceSection } from '../../components/settings/instance-section.tsx';
import { NotificationsSection } from '../../components/settings/notifications-section.tsx';
import { PeriodSection } from '../../components/settings/period-section.tsx';
import { ProfileSection } from '../../components/settings/profile-section.tsx';
import { SecuritySection } from '../../components/settings/security-section.tsx';
import { canOpenSection, SettingsLayout } from '../../components/settings/settings-layout.tsx';
import { TagsSection } from '../../components/settings/tags-section.tsx';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getProfile, getSecurity } from '../../server/fn/account.ts';
import { getPeriodSettings } from '../../server/fn/budget.ts';
import { listCategories, listTags } from '../../server/fn/ledger.ts';
import { getNotificationSettings } from '../../server/fn/notifications.ts';
import { listSimilarTags } from '../../server/fn/tags.ts';

/**
 * `/settings/profile`, `/settings/period`, `/settings/categories`, `/settings/tags`, `/settings/security`, and
 * (admins) `/settings/instance`. Profile also loads the security overview for its sign-in methods (Google linked,
 * password set); the period section loads the periods and the payday the salary suggests; categories include archived
 * ones; tags come with the similar-tag pairs; the instance section loads its own data.
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
    if (section === 'period') return { section, period: await getPeriodSettings() };
    if (section === 'notifications') return { section, notifications: await getNotificationSettings() };
    if (section === 'categories')
      return { section, categories: await listCategories({ data: { includeArchived: true } }) };
    if (section === 'tags') {
      const [tags, similar] = await Promise.all([listTags({ data: {} }), listSimilarTags({ data: {} })]);
      return { section, tags, similar };
    }
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
  } else if (data.section === 'period') {
    content = data.period.ok ? (
      <PeriodSection {...data.period.value} />
    ) : (
      <FormError>{ledgerErrorMessage(data.period.code, preferences.locale)}</FormError>
    );
  } else if (data.section === 'notifications') {
    content = data.notifications.ok ? (
      <NotificationsSection settings={data.notifications.value} email={viewer.email} />
    ) : (
      <FormError>{ledgerErrorMessage(data.notifications.code, preferences.locale)}</FormError>
    );
  } else if (data.section === 'categories') {
    content = data.categories.ok ? (
      <CategoriesSection categories={data.categories.value} />
    ) : (
      <FormError>{ledgerErrorMessage(data.categories.code, preferences.locale)}</FormError>
    );
  } else if (data.section === 'tags') {
    if (!data.tags.ok) content = <FormError>{ledgerErrorMessage(data.tags.code, preferences.locale)}</FormError>;
    else if (!data.similar.ok)
      content = <FormError>{ledgerErrorMessage(data.similar.code, preferences.locale)}</FormError>;
    else content = <TagsSection tags={data.tags.value} similar={data.similar.value} />;
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
