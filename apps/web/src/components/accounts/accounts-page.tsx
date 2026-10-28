// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Rekening & dompet" (`/accounts`, FR-R1–R6, design `ycP7T`): the available balance and other totals, the card
 * strip, all accounts grouped by type (Aktif / Diarsipkan tabs), and the selected account's detail panel, which
 * becomes a Sheet below 1280 px (FR-TB3). Dialogs: add/edit (`AccountForm`), archive, bulk reconciliation, delete
 * permanently; single reconciliation goes through `useReconcile()`.
 */
import { useRouter } from '@tanstack/react-router';
import type { AccountsOverview, AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { AccountType } from '@wf/domain/ledger';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { toLocalDate } from '@wf/ui/dates';
import { EmptyState } from '@wf/ui/empty-state';
import { Money } from '@wf/ui/money';
import { Sheet } from '@wf/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wf/ui/tabs';
import { toast } from '@wf/ui/toast';
import { Archive, Building2, Landmark, Lock, Plus, Scale, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { accountTotals, byCheckAge, MAX_CARDS, STALE_AFTER_DAYS } from '../../lib/accounts.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { useMediaQuery } from '../../lib/use-media-query.ts';
import { deleteAccount, reorderAccounts, restoreAccount, updateAccount } from '../../server/fn/accounts.ts';
import { Button } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { AccountCards } from './account-cards.tsx';
import { AccountDetailPanel, type AccountFlag } from './account-detail.tsx';
import { AccountForm } from './account-form.tsx';
import { AccountList, ArchivedList } from './account-list.tsx';
import { ArchiveDialog } from './archive-dialog.tsx';
import { BulkReconcileDialog } from './bulk-reconcile.tsx';
import { useReconcile } from './reconcile.tsx';

export interface AccountsPageProps {
  /** Every account (`status: 'all'`). */
  readonly overview: AccountsOverview;
  readonly categories: readonly CategoryView[];
  readonly timeZone: string;
  /** From `?account=`: the account to select first. */
  readonly initialAccountId?: string;
  /** From `?new=`: open "Tambah rekening" with this type. */
  readonly initialNewType?: AccountType;
  /** Drops the search params above once they took effect, so a reload does not reopen the dialog. */
  readonly onConsumeSearch: () => void;
}

type Dialog =
  | { readonly kind: 'add'; readonly type: AccountType }
  | { readonly kind: 'edit' | 'archive' | 'delete'; readonly account: AccountView }
  | { readonly kind: 'bulk' };

/** Detail panel inline from this width (FR-TB1–TB3); a Sheet below. */
const WIDE = '(min-width: 1280px)';

export function AccountsPage({
  overview,
  categories,
  timeZone,
  initialAccountId,
  initialNewType,
  onConsumeSearch,
}: AccountsPageProps) {
  const router = useRouter();
  const { openReconcile } = useReconcile();
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const wide = useMediaQuery(WIDE, true);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [order, setOrder] = useState<readonly string[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialAccountId ?? null);
  const [sheetOpen, setSheetOpen] = useState(initialAccountId !== undefined);
  const [dialog, setDialog] = useState<Dialog | null>(
    initialNewType === undefined ? null : { kind: 'add', type: initialNewType },
  );
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current || (initialAccountId === undefined && initialNewType === undefined)) return;
    consumed.current = true;
    onConsumeSearch();
  }, [initialAccountId, initialNewType, onConsumeSearch]);
  const list = useRef<HTMLDivElement>(null);
  const today = toLocalDate(new Date(), timeZone);
  const { baseCurrency } = overview;

  const savedActive = overview.accounts.filter((account) => account.status === 'active');
  const active =
    order === null ? savedActive : [...savedActive].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const archived = overview.accounts.filter((account) => account.status === 'archived');
  const shown = tab === 'active' ? active : archived;
  const selected =
    shown.find((account) => account.id === selectedId) ?? (tab === 'active' ? active[0] : undefined) ?? null;
  const totals = accountTotals(active, baseCurrency);
  const stale = byCheckAge(active, today, timeZone).filter(({ days }) => days > STALE_AFTER_DAYS);
  const cardHolders = (except?: AccountView) =>
    active.filter((account) => account.showAsCard && account.id !== except?.id).map((account) => account.displayName);
  const cardsFull = cardHolders().length >= MAX_CARDS;

  const refresh = () => router.invalidate();
  const close = () => {
    setDialog(null);
  };
  const select = (account: AccountView) => {
    setSelectedId(account.id);
    setSheetOpen(true);
  };
  const toggle = async (account: AccountView, flag: AccountFlag, value: boolean) => {
    const result = await updateAccount({ data: { id: account.id, patch: { [flag]: value } } });
    if (!result.ok) toast({ title: ledgerErrorMessage(result.code, locale), tone: 'error' });
    await refresh();
  };
  const reorder = async (ids: string[]) => {
    setOrder(ids);
    const result = await reorderAccounts({ data: { ids } });
    if (!result.ok) toast({ title: ledgerErrorMessage(result.code, locale), tone: 'error' });
    await refresh();
    setOrder(null);
  };
  const restore = async (account: AccountView) => {
    const result = await restoreAccount({ data: { id: account.id } });
    if (result.ok) toast({ title: m.accounts_restore_done({ name: account.displayName }) });
    else toast({ title: ledgerErrorMessage(result.code, locale), tone: 'error' });
    await refresh();
  };
  const remove = async (account: AccountView) => {
    const result = await deleteAccount({ data: { id: account.id } });
    if (result.ok) {
      toast({
        title: m.accounts_delete_done({ name: account.displayName }),
        description: m.accounts_transaction_count({ count: result.value.deletedTransactions }),
      });
      setSelectedId(null);
    } else toast({ title: ledgerErrorMessage(result.code, locale), tone: 'error' });
    await refresh();
  };
  const saved = (account: AccountView) => {
    setDialog(null);
    setSelectedId(account.id);
    toast({ title: m.accounts_saved({ name: account.displayName }) });
    void refresh();
  };

  const header = (
    <PageHeader
      breadcrumb={[m.nav_group_account(), m.accounts_title()]}
      title={m.accounts_title()}
      description={
        active.length === 0
          ? undefined
          : m.accounts_summary({
              count: active.length,
              spending: totals.spendingCount,
              platforms: totals.investmentCount,
            })
      }
      secondaryActions={
        active.length === 0
          ? []
          : [
              {
                label: m.accounts_adjust(),
                icon: Scale,
                onSelect: () => {
                  setDialog({ kind: 'bulk' });
                },
              },
            ]
      }
      actions={
        <Button
          size="sm"
          onClick={() => {
            setDialog({ kind: 'add', type: 'bank' });
          }}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {m.accounts_add()}
        </Button>
      }
    />
  );

  const detail =
    selected === null ? null : (
      <AccountDetailPanel
        account={selected}
        accounts={overview.accounts}
        timeZone={timeZone}
        cardsFull={cardHolders(selected).length >= MAX_CARDS}
        onReconcile={() => {
          openReconcile(selected.id);
        }}
        onEdit={() => {
          setDialog({ kind: 'edit', account: selected });
        }}
        onArchive={() => {
          setDialog({ kind: 'archive', account: selected });
        }}
        onToggle={(flag, value) => void toggle(selected, flag, value)}
      />
    );

  const dialogs = (
    <>
      {dialog?.kind === 'add' || dialog?.kind === 'edit' ? (
        <Modal
          open
          size="xl"
          onOpenChange={close}
          title={dialog.kind === 'add' ? m.accounts_add_title() : m.accounts_edit_title()}
          description={
            dialog.kind === 'add'
              ? m.accounts_add_description()
              : m.accounts_edit_description({
                  name: dialog.account.displayName,
                  count: dialog.account.transactionCount,
                })
          }
        >
          <AccountForm
            {...(dialog.kind === 'add' ? { defaultType: dialog.type } : { account: dialog.account })}
            baseCurrency={baseCurrency}
            today={today}
            cardHolders={cardHolders(dialog.kind === 'edit' ? dialog.account : undefined)}
            submitLabel={dialog.kind === 'add' ? m.accounts_add() : m.accounts_save()}
            footerNote={
              <span className="flex items-center gap-1.5">
                <Lock aria-hidden="true" className="size-3" />
                {m.accounts_no_bank_login()}
              </span>
            }
            onSaved={saved}
            onCancel={close}
          />
        </Modal>
      ) : null}
      {dialog?.kind === 'archive' ? (
        <ArchiveDialog
          account={dialog.account}
          accounts={overview.accounts}
          onOpenChange={close}
          onDone={() => {
            setDialog(null);
            setSelectedId(null);
            void refresh();
          }}
        />
      ) : null}
      {dialog?.kind === 'bulk' ? (
        <BulkReconcileDialog
          accounts={active}
          categories={categories}
          baseCurrency={baseCurrency}
          timeZone={timeZone}
          onOpenChange={close}
          onDone={() => {
            setDialog(null);
            void refresh();
          }}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          open
          onOpenChange={close}
          variant="destructive"
          title={m.accounts_delete_title({ name: dialog.account.displayName })}
          description={m.accounts_delete_description()}
          impact={m.accounts_delete_impact({ count: dialog.account.transactionCount })}
          confirmLabel={m.accounts_delete()}
          cancelLabel={m.accounts_cancel()}
          onConfirm={() => void remove(dialog.account)}
        />
      ) : null}
    </>
  );

  if (overview.accounts.length === 0) {
    return (
      <>
        {header}
        <section className="rounded-[12px] border border-border bg-card">
          <EmptyState
            icon={Wallet}
            title={m.accounts_empty_title()}
            description={m.accounts_empty_description()}
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    setDialog({ kind: 'add', type: 'bank' });
                  }}
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  {m.accounts_add()}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDialog({ kind: 'add', type: 'cash' });
                  }}
                >
                  {m.accounts_empty_add_cash()}
                </Button>
              </>
            }
            note={m.accounts_empty_note()}
          />
        </section>
        {dialogs}
      </>
    );
  }

  const approx = totals.foreignCurrencies.length > 0 ? '≈ ' : '';
  return (
    <>
      {header}
      <section
        aria-label={m.accounts_kpis()}
        className="grid grid-cols-2 divide-border rounded-[12px] border border-border bg-card xl:grid-cols-4 xl:divide-x [&>*]:border-border max-xl:[&>*:nth-child(-n+2)]:border-b max-xl:[&>*:nth-child(odd)]:border-r"
      >
        <Kpi icon={Wallet} label={m.accounts_kpi_available()}>
          <Money minor={overview.availableMinor} currency={baseCurrency} context="amount" locale={locale} />
          <span className="text-[12px] font-normal text-subtle">
            {m.accounts_kpi_available_note({ count: totals.spendingCount })}
          </span>
        </Kpi>
        <Kpi icon={TrendingUp} label={m.accounts_kpi_investments()}>
          <span>
            {totals.investmentCount > 0 && approx}
            <Money minor={totals.investmentsMinor} currency={baseCurrency} context="amount" locale={locale} />
          </span>
          <span className="text-[12px] font-normal text-subtle">
            {m.accounts_kpi_investments_note({ count: totals.investmentCount })}
            {totals.foreignCurrencies.length === 0
              ? null
              : ` · ${m.accounts_kpi_foreign({ currencies: totals.foreignCurrencies.join(', ') })}`}
          </span>
        </Kpi>
        <Kpi icon={Landmark} label={m.accounts_kpi_total()}>
          <span>
            {approx}
            <Money minor={totals.totalMinor} currency={baseCurrency} context="amount" locale={locale} />
          </span>
          <span className="text-[12px] font-normal text-subtle">{m.accounts_kpi_total_note()}</span>
        </Kpi>
        <Kpi icon={Scale} label={m.accounts_kpi_stale()}>
          <button
            type="button"
            className={`text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring ${stale.length > 0 ? 'text-amber-fg' : ''}`}
            onClick={() => {
              setDialog({ kind: 'bulk' });
            }}
          >
            {m.accounts_count({ count: stale.length })}
          </button>
          <span className="text-[12px] font-normal text-subtle">
            {stale.length === 0
              ? m.accounts_kpi_stale_none()
              : stale
                  .slice(0, 3)
                  .map(({ account, days }) => m.accounts_kpi_stale_item({ name: account.displayName, days }))
                  .join(' · ')}
          </span>
        </Kpi>
      </section>

      {tab === 'active' ? (
        <div className="overflow-x-auto">
          <AccountCards
            accounts={active}
            baseCurrency={baseCurrency}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onShowOthers={() => {
              list.current?.focus();
            }}
          />
        </div>
      ) : null}

      <div className="flex items-start gap-4">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as 'active' | 'archived');
            setSelectedId(null);
          }}
          className="flex min-w-0 flex-1 flex-col rounded-[12px] border border-border bg-card"
        >
          <div ref={list} tabIndex={-1} className="flex items-center justify-between gap-3 px-4 py-3.5 outline-none">
            <div className="flex flex-col">
              <h2 className="text-[14px] font-semibold text-fg">
                {tab === 'active' ? m.accounts_list_title() : m.accounts_archived_title()}
              </h2>
              <p className="text-[12px] text-subtle">
                {tab === 'active' ? m.accounts_list_description() : m.accounts_archived_description()}
              </p>
            </div>
            <TabsList label={m.accounts_tabs()}>
              <TabsTrigger value="active" icon={Building2}>
                {m.accounts_tab_active({ count: active.length })}
              </TabsTrigger>
              <TabsTrigger value="archived" icon={Archive}>
                {m.accounts_tab_archived({ count: archived.length })}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="active" className="pb-2">
            <AccountList
              accounts={active}
              baseCurrency={baseCurrency}
              selectedId={selected?.id ?? null}
              cardsFull={cardsFull}
              onReorder={(ids) => void reorder(ids)}
              onSelect={select}
              onEdit={(account) => {
                setDialog({ kind: 'edit', account });
              }}
              onReconcile={(account) => {
                openReconcile(account.id);
              }}
              onArchive={(account) => {
                setDialog({ kind: 'archive', account });
              }}
              onToggle={(account, flag, value) => void toggle(account, flag, value)}
            />
          </TabsContent>
          <TabsContent value="archived">
            <ArchivedList
              accounts={archived}
              timeZone={timeZone}
              selectedId={selected?.id ?? null}
              onSelect={select}
              onRestore={(account) => void restore(account)}
              onDelete={(account) => {
                setDialog({ kind: 'delete', account });
              }}
            />
          </TabsContent>
        </Tabs>

        {wide ? (
          <aside
            aria-label={m.accounts_detail_label()}
            className="sticky top-6 w-[380px] shrink-0 overflow-hidden rounded-[12px] border border-border bg-card"
          >
            {detail ?? (
              <EmptyState
                icon={Archive}
                title={m.accounts_archived_pick()}
                description={m.accounts_archived_pick_hint()}
              />
            )}
          </aside>
        ) : null}
      </div>

      {!wide && selected !== null ? (
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={selected.displayName}
          closeLabel={m.accounts_close()}
        >
          {detail}
        </Sheet>
      ) : null}
      {dialogs}
    </>
  );
}

function Kpi({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 p-5">
      <span className="flex items-center gap-2 text-[12.5px] text-muted-fg">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </span>
      <div className="flex flex-col gap-1 text-[22px] font-semibold text-fg">{children}</div>
    </div>
  );
}
