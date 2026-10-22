// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { canOpenSection } from '../../components/settings/settings-sections.ts';

/**
 * `/settings/profile`, `/settings/period`, `/settings/notifications`, `/settings/categories`, `/settings/tags`,
 * `/settings/security`, and (admins) `/settings/instance`: deep links to Settings, which is a dialog over the current
 * page (`?settings=<section>`, `_app`). A link opened on its own shows it over the overview.
 */
export const Route = createFileRoute('/_app/settings/$section')({
  beforeLoad: ({ params: { section }, context }) => {
    if (!canOpenSection(section, context.viewer)) throw notFound();
    throw redirect({ to: '/', search: { settings: section }, replace: true });
  },
});
