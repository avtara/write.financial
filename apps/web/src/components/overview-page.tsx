// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import { PageHeader } from './page-header.tsx';

/** Overview (`/`, design `olRpH` "Dashboard — Kosong"): no accounts or transactions exist yet. */
export function OverviewPage() {
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.nav_overview()]} title={m.overview_greeting()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState kind="empty" title={m.overview_empty_title()} description={m.overview_empty_description()} />
      </section>
    </>
  );
}
