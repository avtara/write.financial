// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Settings sections and how to open them. Settings is a dialog over the current page, opened by
 * `?settings=<section>` on any signed-in page (`/settings/<section>` redirects there over the overview).
 */
import type { HistoryState } from '@tanstack/react-router';
import type { Viewer } from '../../server/gate.ts';

export const SETTINGS_SECTIONS = [
  'profile',
  'period',
  'notifications',
  'categories',
  'tags',
  'rules',
  'data',
  'security',
  'market',
  'instance',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Whether `viewer` may open `section` (an unknown name or "instance" for a non-admin is a 404). */
export function canOpenSection(section: string, viewer: Pick<Viewer, 'role'>): section is SettingsSection {
  return (
    (SETTINGS_SECTIONS as readonly string[]).includes(section) && (section !== 'instance' || viewer.role === 'admin')
  );
}

/** History-state key of an entry that opened Settings over the page before it: closing goes back there. */
export const OPENED_OVER_PAGE = 'settingsOverPage';

/**
 * Navigation options (`navigate(openSettings('tags'))`) that open Settings on `section` over the current page, keeping
 * its search; closing the dialog (Escape, ×, or the browser's back) returns to that page.
 */
export function openSettings(section: SettingsSection) {
  return {
    to: '.',
    search: (previous: object) => ({ ...previous, settings: section }),
    state: (previous: HistoryState) => ({ ...previous, [OPENED_OVER_PAGE]: true }),
  } as const;
}
