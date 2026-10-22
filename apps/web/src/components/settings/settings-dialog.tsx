// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings as a large modal dialog over the current page (the `XN4px` layout in a popup): the "Pengaturan" header with
 * its × button, the grouped section navigation on the left, and the open section's heading and content. The open
 * section is `?settings=<section>` (see `settings-sections.ts`); the `_app` loader loads its data with
 * {@link loadSettingsSection}, so the section forms refresh with `router.invalidate()` as before. Switching sections
 * replaces the history entry; Escape, the ×, and a click on the scrim close the dialog: back to the page it was
 * opened over, or (opened by a link from elsewhere) the same page without it. Only sections that exist are listed;
 * "Instans" only for admins. Radix traps the focus and hides the page from assistive technology.
 */
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import type { CategoryView } from '@wf/db/categories';
import type { NotificationSettings } from '@wf/db/notification-settings';
import type { Payday, PeriodsOverview } from '@wf/db/periods';
import type { Profile } from '@wf/db/profiles';
import type { TagPair, TagView } from '@wf/db/tags';
import { m } from '@wf/i18n/messages';
import { Settings, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useRef } from 'react';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import type { Result } from '../../server/access.ts';
import type { SecurityOverview } from '../../server/account.ts';
import { getProfile, getSecurity } from '../../server/fn/account.ts';
import { getPeriodSettings } from '../../server/fn/budget.ts';
import { listCategories, listTags } from '../../server/fn/ledger.ts';
import { getNotificationSettings } from '../../server/fn/notifications.ts';
import { listSimilarTags } from '../../server/fn/tags.ts';
import type { Viewer } from '../../server/gate.ts';
import { FormError } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { CategoriesSection } from './categories-section.tsx';
import { InstanceSection } from './instance-section.tsx';
import { NotificationsSection } from './notifications-section.tsx';
import { PeriodSection } from './period-section.tsx';
import { ProfileSection } from './profile-section.tsx';
import { SecuritySection } from './security-section.tsx';
import { canOpenSection, OPENED_OVER_PAGE, type SettingsSection } from './settings-sections.ts';
import { TagsSection } from './tags-section.tsx';

interface SectionInfo {
  readonly label: () => string;
  readonly description: () => string;
}

const SECTIONS: Readonly<Record<SettingsSection, SectionInfo>> = {
  profile: { label: m.settings_nav_profile, description: m.settings_profile_description },
  period: { label: m.settings_nav_period, description: m.settings_period_description },
  notifications: { label: m.settings_nav_notifications, description: m.settings_notifications_description },
  categories: { label: m.settings_nav_categories, description: m.settings_categories_description },
  tags: { label: m.settings_nav_tags, description: m.settings_tags_description },
  security: { label: m.settings_nav_security, description: m.settings_security_description },
  instance: { label: m.settings_nav_instance, description: m.settings_instance_description },
};

const GROUPS: readonly { readonly label: () => string; readonly sections: readonly SettingsSection[] }[] = [
  { label: m.settings_group_account, sections: ['profile'] },
  { label: m.settings_group_preferences, sections: ['period', 'notifications', 'categories', 'tags'] },
  { label: m.settings_group_data, sections: ['security'] },
  { label: m.settings_group_instance, sections: ['instance'] },
];

/** The open section's data (the `_app` loader), each part as its server function answered. */
export type SettingsData =
  | { section: 'profile'; profile: Result<Profile>; security: Result<SecurityOverview> }
  | { section: 'security'; security: Result<SecurityOverview> }
  | { section: 'period'; period: Result<{ overview: PeriodsOverview; payday: Payday }> }
  | { section: 'notifications'; notifications: Result<NotificationSettings> }
  | { section: 'categories'; categories: Result<CategoryView[]> }
  | { section: 'tags'; tags: Result<TagView[]>; similar: Result<TagPair[]> }
  | { section: 'instance' };

/**
 * The data of `section`: Profile also loads the security overview for its sign-in methods (Google linked, password
 * set); the period section loads the periods and the payday the salary suggests; categories include archived ones;
 * tags come with the similar-tag pairs; the instance section loads its own data.
 */
export async function loadSettingsSection(section: SettingsSection): Promise<SettingsData> {
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
}

/** The open section of `data`, or why it could not be loaded. */
function SectionContent({ data, viewer }: { data: SettingsData; viewer: Viewer }) {
  const { locale } = usePreferences().preferences;
  if (data.section === 'instance') return <InstanceSection />;
  if (data.section === 'period') {
    return data.period.ok ? (
      <PeriodSection {...data.period.value} />
    ) : (
      <FormError>{ledgerErrorMessage(data.period.code, locale)}</FormError>
    );
  }
  if (data.section === 'notifications') {
    return data.notifications.ok ? (
      <NotificationsSection settings={data.notifications.value} email={viewer.email} />
    ) : (
      <FormError>{ledgerErrorMessage(data.notifications.code, locale)}</FormError>
    );
  }
  if (data.section === 'categories') {
    return data.categories.ok ? (
      <CategoriesSection categories={data.categories.value} />
    ) : (
      <FormError>{ledgerErrorMessage(data.categories.code, locale)}</FormError>
    );
  }
  if (data.section === 'tags') {
    if (!data.tags.ok) return <FormError>{ledgerErrorMessage(data.tags.code, locale)}</FormError>;
    if (!data.similar.ok) return <FormError>{ledgerErrorMessage(data.similar.code, locale)}</FormError>;
    return <TagsSection tags={data.tags.value} similar={data.similar.value} />;
  }
  if (!data.security.ok) return <FormError>{authErrorMessage({ code: data.security.code }, locale)}</FormError>;
  if (data.section === 'security') return <SecuritySection viewer={viewer} overview={data.security.value} />;
  if (!data.profile.ok) return <FormError>{authErrorMessage({ code: data.profile.code }, locale)}</FormError>;
  return <ProfileSection viewer={viewer} profile={data.profile.value} methods={data.security.value} />;
}

/** Settings over the current page while `data` (the `_app` loader's open section) is set; closed when `null`. */
export function SettingsDialog({ viewer, data }: { viewer: Viewer; data: SettingsData | null }) {
  const router = useRouter();
  const navigate = useNavigate();
  const opener = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);

  const close = () => {
    if (OPENED_OVER_PAGE in router.state.location.state) {
      router.history.back();
    } else {
      void navigate({ to: '.', search: (previous: object) => ({ ...previous, settings: undefined }), replace: true });
    }
  };

  return (
    // Without a trigger, Radix only asks to close (Escape, ×, a click on the scrim).
    <Dialog.Root open={data !== null} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim motion-safe:animate-[wf-fade-in_150ms_ease-out]" />
        <Dialog.Content
          ref={content}
          onOpenAutoFocus={(event) => {
            // Radix restores focus only to a `Dialog.Trigger`; Settings is opened by a URL. Start on the open section.
            opener.current = document.activeElement as HTMLElement | null;
            event.preventDefault();
            content.current?.querySelector<HTMLElement>('nav a[aria-current="page"]')?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(780px,calc(100dvh-48px))] w-[min(1040px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-clip rounded-[14px] border border-border-dialog bg-dialog text-fg shadow-[0_16px_48px_var(--shadow)]"
        >
          {data === null ? null : (
            <>
              <header className="flex items-center gap-3 border-b border-border py-4 pr-4 pl-6">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-surface-3 text-fg">
                  <Settings aria-hidden="true" className="size-[18px]" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Dialog.Title className="text-[16px] font-semibold text-fg">{m.settings_title()}</Dialog.Title>
                  <Dialog.Description className="text-[12.5px] text-muted-fg">
                    {m.settings_description()}
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  aria-label={m.settings_close()}
                  className="flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-border text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X aria-hidden="true" className="size-[13px]" />
                </Dialog.Close>
              </header>
              <div className="flex min-h-0 flex-1">
                <nav
                  aria-label={m.settings_nav_label()}
                  className="flex w-[188px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface-sunken p-3 lg:w-[220px]"
                >
                  {GROUPS.map((group) => {
                    const sections = group.sections.filter((name) => canOpenSection(name, viewer));
                    if (sections.length === 0) return null;
                    return (
                      <div key={group.label()} className="flex flex-col gap-0.5">
                        <h3 className="px-2 pb-1 text-[10.5px] font-medium text-subtle uppercase">{group.label()}</h3>
                        <ul className="flex flex-col gap-0.5">
                          {sections.map((name) => (
                            <li key={name}>
                              <Link
                                to="."
                                search={(previous: object) => ({ ...previous, settings: name })}
                                state
                                replace
                                className="flex h-8 items-center rounded-[6px] px-2 text-[13px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-muted data-[status=active]:font-medium data-[status=active]:text-fg"
                              >
                                {SECTIONS[name].label()}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </nav>
                {/* The scroll container, so a section's sticky footer sticks to the dialog's bottom edge. */}
                <section
                  aria-labelledby="settings-section-title"
                  className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-7 py-[22px]"
                >
                  <div className="flex flex-col gap-1">
                    <h3 id="settings-section-title" className="text-[17px] font-semibold text-fg">
                      {SECTIONS[data.section].label()}
                    </h3>
                    <p className="text-[12.5px] text-muted-fg">{SECTIONS[data.section].description()}</p>
                  </div>
                  <SectionContent data={data} viewer={viewer} />
                </section>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
