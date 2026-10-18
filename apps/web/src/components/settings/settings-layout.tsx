// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings as a page in the app shell (design `XN4px`): the "Pengaturan" header, the grouped section navigation on
 * the left, and the open section's heading and content. Only sections that exist are listed; "Instans" only for
 * admins.
 */
import { Link } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Viewer } from '../../server/gate.ts';

export const SETTINGS_SECTIONS = ['profile', 'security', 'instance'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

interface SectionInfo {
  readonly label: () => string;
  readonly description: () => string;
}

const SECTIONS: Readonly<Record<SettingsSection, SectionInfo>> = {
  profile: { label: m.settings_nav_profile, description: m.settings_profile_description },
  security: { label: m.settings_nav_security, description: m.settings_security_description },
  instance: { label: m.settings_nav_instance, description: m.settings_instance_description },
};

const GROUPS: readonly { readonly label: () => string; readonly sections: readonly SettingsSection[] }[] = [
  { label: m.settings_group_account, sections: ['profile'] },
  { label: m.settings_group_data, sections: ['security'] },
  { label: m.settings_group_instance, sections: ['instance'] },
];

/** Whether `viewer` may open `section` (an unknown name or "instance" for a non-admin is a 404). */
export function canOpenSection(section: string, viewer: Pick<Viewer, 'role'>): section is SettingsSection {
  return (
    (SETTINGS_SECTIONS as readonly string[]).includes(section) && (section !== 'instance' || viewer.role === 'admin')
  );
}

export function SettingsLayout({
  viewer,
  section,
  children,
}: {
  viewer: Pick<Viewer, 'role'>;
  section: SettingsSection;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-surface-3 text-fg">
          <Settings aria-hidden="true" className="size-[18px]" />
        </span>
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[16px] font-semibold text-fg">{m.settings_title()}</h1>
          <p className="text-[12.5px] text-muted-fg">{m.settings_description()}</p>
        </div>
      </header>
      <div className="flex min-h-[560px] overflow-hidden rounded-[14px] border border-border">
        <nav
          aria-label={m.settings_nav_label()}
          className="flex w-[220px] shrink-0 flex-col gap-4 border-r border-border bg-surface-sunken p-3"
        >
          {GROUPS.map((group) => {
            const sections = group.sections.filter((name) => canOpenSection(name, viewer));
            if (sections.length === 0) return null;
            return (
              <div key={group.label()} className="flex flex-col gap-0.5">
                <h2 className="px-2 pb-1 text-[10.5px] font-medium text-subtle uppercase">{group.label()}</h2>
                <ul className="flex flex-col gap-0.5">
                  {sections.map((name) => (
                    <li key={name}>
                      <Link
                        to="/settings/$section"
                        params={{ section: name }}
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
        <section aria-labelledby="settings-section-title" className="flex min-w-0 flex-1 flex-col gap-5 px-7 py-[22px]">
          <div className="flex flex-col gap-1">
            <h2 id="settings-section-title" className="text-[17px] font-semibold text-fg">
              {SECTIONS[section].label()}
            </h2>
            <p className="text-[12.5px] text-muted-fg">{SECTIONS[section].description()}</p>
          </div>
          {children}
        </section>
      </div>
    </div>
  );
}
