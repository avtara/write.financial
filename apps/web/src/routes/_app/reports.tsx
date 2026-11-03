// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from '@tanstack/react-router';
import type { Result } from '../../server/access.ts';
import type { ReportsHome } from '../../server/fn/reports.ts';

/** Keep old bookmarks and email links usable after removing the Reports page. */
export const Route = createFileRoute('/_app/reports')({
  loader: (): { home: Result<ReportsHome> } => {
    throw redirect({ to: '/', replace: true });
  },
});
