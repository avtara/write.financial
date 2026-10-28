// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { Plus } from 'lucide-react';
import { useRecordTransaction } from './ledger/record-transaction.tsx';
import { LogoTile } from './logo-mark.tsx';

/**
 * Below 768 px (PRD §2 non-goals, FR-TB1): phones are not supported in v1, but recording a transaction still works
 * (the Record sheet opens over this page).
 */
export function UnsupportedScreen() {
  const record = useRecordTransaction();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center md:hidden">
      <LogoTile variant="rail" />
      <h1 className="text-[20px] font-semibold text-fg">{m.unsupported_title()}</h1>
      <p className="max-w-[360px] text-[13.5px] text-muted-fg">{m.unsupported_description()}</p>
      <button
        type="button"
        onClick={() => {
          record.open();
        }}
        className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-fg px-4 text-[13.5px] font-medium text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Plus aria-hidden="true" className="size-4" />
        {m.transactions_page_record()}
      </button>
    </div>
  );
}
