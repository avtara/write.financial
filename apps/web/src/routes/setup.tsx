// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, notFound, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { settle } from '../components/setup/result.ts';
import { SetupWizard } from '../components/setup/setup-wizard.tsx';
import { createSetupAdmin, getSetup, saveSetup, sendSetupTestEmail } from '../server/fn/setup.ts';

interface SetupSearch {
  token?: string;
}

/**
 * The first-run setup wizard (FR-OP1), opened with `?token=` from the self-host `init` output. Without a valid token,
 * or once setup is complete, it answers like an unknown page (404). The server moves the token into an httpOnly
 * cookie, so the page takes it out of the address bar (and so out of history and screenshots).
 */
export const Route = createFileRoute('/setup')({
  validateSearch: (search: Record<string, unknown>): SetupSearch =>
    typeof search.token === 'string' ? { token: search.token } : {},
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const state = await getSetup({ data: deps });
    if (state.status === 'closed') throw notFound();
    return state;
  },
  component: SetupPage,
});

function SetupPage() {
  const { step, draft } = Route.useLoaderData();
  const { token } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  useEffect(() => {
    if (token !== undefined) void navigate({ search: {}, replace: true });
  }, [token, navigate]);

  return (
    <SetupWizard
      step={step}
      draft={draft}
      onRefresh={() => router.invalidate()}
      createAdmin={(input) => settle(() => createSetupAdmin({ data: input }))}
      sendTestEmail={(smtp) => settle(() => sendSetupTestEmail({ data: smtp }))}
      save={(input) => settle(() => saveSetup({ data: input }))}
    />
  );
}
