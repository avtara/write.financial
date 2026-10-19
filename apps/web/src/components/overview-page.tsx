// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { toLocalDate } from '@wf/ui/dates';
import { KbdHint } from '@wf/ui/kbd-hint';
import { PageState } from '@wf/ui/page-state';
import { Plus } from 'lucide-react';
import { Button } from './form.tsx';
import { QuickAddBar } from './ledger/quick-add-bar.tsx';
import { useRecordTransaction } from './ledger/record-transaction.tsx';
import type { LedgerData } from './ledger/use-transaction-form.ts';
import { PageHeader } from './page-header.tsx';
import { usePreferences } from './preferences.tsx';

export interface OverviewPageProps {
  /** `null` when the ledger could not be loaded. */
  readonly ledger: LedgerData | null;
  readonly timeZone: string;
}

/**
 * Overview (`/`): the "Catat Transaksi" action (`N`) and the Quick Add bar (FR-T1) once an account exists; before
 * that, the empty state of design `olRpH` ("Dashboard — Kosong").
 */
export function OverviewPage({ ledger, timeZone }: OverviewPageProps) {
  const { preferences } = usePreferences();
  const record = useRecordTransaction();
  const ready = ledger !== null && ledger.accounts.some((account) => account.status === 'active');
  return (
    <>
      <PageHeader
        breadcrumb={[m.breadcrumb_finance(), m.nav_overview()]}
        title={m.overview_greeting()}
        actions={
          ready ? (
            <Button
              size="sm"
              onClick={() => {
                record.open();
              }}
            >
              <Plus aria-hidden="true" className="size-3.5" />
              {m.record_open()}
              <KbdHint keys={['N']} platform={preferences.platform} className="ml-1" />
            </Button>
          ) : null
        }
      />
      {ready ? (
        <QuickAddBar
          data={ledger}
          locale={preferences.locale}
          timeZone={timeZone}
          today={toLocalDate(new Date(), timeZone)}
        />
      ) : (
        <section className="rounded-[12px] border border-border bg-card">
          <PageState kind="empty" title={m.overview_empty_title()} description={m.overview_empty_description()} />
        </section>
      )}
    </>
  );
}
