// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from '@tanstack/react-router';

/** Keep old bookmarks and email links usable after removing the Reports page. */
export const Route = createFileRoute('/_app/reports')({
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true });
  },
});
