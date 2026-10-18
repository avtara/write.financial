// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';

/** Unknown pages, and pages that must not admit they exist (the setup wizard without its token). */
export function NotFoundPage() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
      <p className="font-mono text-[13px] text-subtle">404</p>
      <h1 className="text-[20px] font-semibold text-fg">{m.not_found_title()}</h1>
      <p className="max-w-[360px] text-[13px] text-muted-fg">{m.not_found_description()}</p>
      <Link
        to="/"
        className="mt-2 inline-flex h-8 items-center rounded-[8px] border border-border px-3 text-[12.5px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {m.not_found_home()}
      </Link>
    </main>
  );
}
