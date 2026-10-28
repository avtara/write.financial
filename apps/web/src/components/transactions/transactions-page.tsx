// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Transactions page (FR-L1–L6, design `t7l0Cj`): header with the count and dates, the summary, the account
 * strip, the table with its filters, and the detail of `?tx=` — beside the table from 1280 px, in a Sheet below
 * (FR-TB3). Writes from the table, the detail, and their dialogs go through {@link TransactionActionsProvider} and
 * reload the route. A user without any transaction gets the first-run empty state (`v7E8YI`).
 */
import { useRouterState } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { formatDateRange } from '@wf/ui/dates';
import { EmptyState } from '@wf/ui/empty-state';
import { KbdHint } from '@wf/ui/kbd-hint';
import { PageState } from '@wf/ui/page-state';
import { Sheet } from '@wf/ui/sheet';
import { FileUp, Plus, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { listValues, type TransactionsSearch } from '../../lib/transactions-search.ts';
import { useMediaQuery } from '../../lib/use-media-query.ts';
import type { TransactionsView } from '../../server/fn/transactions.ts';
import { ImportDialog } from '../import/import-dialog.tsx';
import { PageHeader, type HeaderAction } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { AccountStrip } from './account-strip.tsx';
import { TransactionSummary } from './summary.tsx';
import { TransactionActionsProvider } from './transaction-actions.tsx';
import { TransactionDetailPanel } from './transaction-detail.tsx';
import { TransactionFilters } from './transaction-filters.tsx';
import { TransactionsTable } from './transactions-table.tsx';

export interface TransactionsPageProps {
  readonly view: TransactionsView;
  readonly search: TransactionsSearch;
  readonly ledger: LedgerData;
  /** "Saldo tersedia". */
  readonly available: bigint;
  readonly timeZone: string;
  /** Merges `patch` into the URL's search params (`undefined` removes a key). */
  readonly onSearchChange: (patch: Partial<TransactionsSearch>) => void;
}

const WIDE = '(min-width: 1280px)';

export function TransactionsPage({ view, search, ledger, available, timeZone, onSearchChange }: TransactionsPageProps) {
  const { preferences } = usePreferences();
  const wide = useMediaQuery(WIDE, true);
  const record = useRecordTransaction();
  const refreshing = useRouterState({ select: (state) => state.isLoading });
  const [importing, setImporting] = useState(false);
  const header = <Header view={view} search={search} ledger={ledger} />;
  const secondaryActions: readonly HeaderAction[] = [
    {
      label: m.import_open(),
      icon: FileUp,
      onSelect: () => {
        setImporting(true);
      },
    },
  ];
  const importDialog = (
    <ImportDialog
      open={importing}
      onOpenChange={setImporting}
      accounts={ledger.accounts}
      categories={ledger.categories}
      rules={ledger.rules}
      subscriptionNames={ledger.subscriptionNames}
    />
  );
  const actions = (
    <button
      type="button"
      onClick={() => {
        record.open();
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-fg px-3 text-[13px] font-medium text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Plus aria-hidden="true" className="size-3.5" />
      {m.transactions_page_record()}
      <KbdHint keys={['N']} platform={preferences.platform} />
    </button>
  );

  if (!view.hasTransactions) {
    return (
      <>
        <PageHeader
          breadcrumb={[m.transactions_page_breadcrumb(), m.transactions_page_title()]}
          title={m.transactions_page_title()}
          actions={actions}
          secondaryActions={secondaryActions}
        />
        {importDialog}
        <EmptyState
          icon={ReceiptText}
          title={m.transactions_page_empty_title()}
          description={m.transactions_page_empty_description()}
          actions={
            <button
              type="button"
              onClick={() => {
                record.open();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-fg px-3 text-[13px] font-medium text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              {m.transactions_page_empty_action()}
            </button>
          }
          note={m.transactions_page_empty_note()}
        />
      </>
    );
  }

  const close = () => {
    onSearchChange({ tx: undefined });
  };
  const detail =
    search.tx === undefined ? null : (
      <TransactionDetailPanel
        key={search.tx}
        id={search.tx}
        ledger={ledger}
        timeZone={timeZone}
        today={view.today}
        variant={wide ? 'aside' : 'sheet'}
        onClose={close}
      />
    );

  return (
    <>
      <PageHeader
        breadcrumb={[m.transactions_page_breadcrumb(), m.transactions_page_title()]}
        title={m.transactions_page_title()}
        description={header}
        actions={actions}
        secondaryActions={secondaryActions}
      />
      {importDialog}
      <TransactionSummary view={view} currency={ledger.baseCurrency} />
      <AccountStrip
        accounts={ledger.accounts}
        baseCurrency={ledger.baseCurrency}
        availableMinor={available}
        view={view}
        selected={search.account}
        onSelect={(account) => {
          onSearchChange({ account });
        }}
      />
      <TransactionActionsProvider
        ledger={ledger}
        timeZone={timeZone}
        onRemoved={(ids) => {
          if (search.tx !== undefined && ids.includes(search.tx)) close();
        }}
        onOpen={(id) => {
          onSearchChange({ tx: id });
        }}
      >
        <div className="flex items-start gap-4">
          <div className="relative min-w-0 flex-1">
            {/* A slot over the table's top edge: the busy note takes no space, so nothing below it moves. */}
            <div className="pointer-events-none absolute inset-x-0 -top-3 z-10 flex justify-center">
              {refreshing ? (
                <div className="rounded-full border border-border-strong bg-popover px-2.5 py-1 shadow-[0_4px_12px_var(--shadow)]">
                  <PageState kind="refreshing" title={m.transactions_page_refreshing()} />
                </div>
              ) : null}
            </div>
            <TransactionsTable
              view={view}
              search={search}
              ledger={ledger}
              timeZone={timeZone}
              busy={refreshing}
              {...(search.tx === undefined ? {} : { selectedId: search.tx })}
              onOpen={(id) => {
                onSearchChange({ tx: id });
              }}
              onSearchChange={onSearchChange}
              filters={
                <TransactionFilters view={view} search={search} ledger={ledger} onSearchChange={onSearchChange} />
              }
            />
          </div>
          {wide && detail !== null ? (
            <aside aria-label={m.transactions_detail_title()} className="sticky top-6 w-[380px] shrink-0">
              {detail}
            </aside>
          ) : null}
        </div>
        {wide ? null : (
          <Sheet
            open={search.tx !== undefined}
            // Opened only through `?tx=`, so a change can only be a close.
            onOpenChange={close}
            title={m.transactions_detail_title()}
            closeLabel={m.transactions_detail_close()}
          >
            {detail}
          </Sheet>
        )}
      </TransactionActionsProvider>
    </>
  );
}

/** "128 transaksi di 7 rekening · 1–15 Oktober 2026", or "Difilter: BCA Tahapan · 49 transaksi · …". */
function Header({ view, search, ledger }: { view: TransactionsView; search: TransactionsSearch; ledger: LedgerData }) {
  const { preferences } = usePreferences();
  const end = view.period !== null && view.today < view.to && view.today >= view.from ? view.today : view.to;
  const dates = formatDateRange({ start: view.from, end }, preferences.locale, view.today);
  const accountIds = listValues(search.account);
  if (accountIds.length > 0) {
    const names = accountIds
      .map((id) => ledger.accounts.find((account) => account.id === id)?.displayName)
      .filter((name) => name !== undefined);
    return m.transactions_page_filtered({ accounts: names.join(', '), count: view.page.total, dates });
  }
  return m.transactions_page_description({ count: view.page.total, accounts: view.accounts.length, dates });
}
