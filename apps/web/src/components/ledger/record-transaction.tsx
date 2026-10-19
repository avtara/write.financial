// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The global Record Transaction sheet (FR-T1, T9; design Section 03): opened with `N` from any signed-in page (also
 * on tablet) or through {@link useRecordTransaction}. It loads accounts, categories, and tags when it opens, saves
 * through `recordTransaction` (one `clientId` per entry, so a retried save never records twice), confirms with a
 * toast offering "Urungkan", can stay open for the next entry ("Tambah lagi setelah simpan", `⇧↵`), and asks
 * before a filled form is closed: "Buang" / "Simpan draf" / "Lanjut mengisi". Saved drafts are offered when it
 * opens again.
 */
import { useRouter } from '@tanstack/react-router';
import type { DraftView } from '@wf/db/drafts';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { toLocalDate } from '@wf/ui/dates';
import { KbdHint } from '@wf/ui/kbd-hint';
import { Money } from '@wf/ui/money';
import { PageState } from '@wf/ui/page-state';
import { Sheet } from '@wf/ui/sheet';
import { toast } from '@wf/ui/toast';
import { FileClock, Trash2 } from 'lucide-react';
import { createContext, use, useMemo, useState, type ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { listAccounts, listCategories, listTags } from '../../server/fn/ledger.ts';
import {
  listDrafts,
  recordTransaction,
  removeDraft,
  removeTransactions,
  saveDraft,
} from '../../server/fn/transactions-write.ts';
import { Button, FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { useShortcuts } from '../shortcuts.tsx';
import {
  defaultAccountId,
  emptyValues,
  fromDraftPayload,
  isFilled,
  toDraftPayload,
  wallTime,
  type EntryKind,
  type TransactionFormValues,
} from './transaction-draft.ts';
import { useReconcile } from '../accounts/reconcile.tsx';
import { ErrorSummary, TransactionFormFields } from './transaction-form.tsx';
import { useTransactionForm, type LedgerData } from './use-transaction-form.ts';

export interface RecordPrefill {
  readonly type?: EntryKind;
  readonly description?: string;
}

export interface RecordTransactionApi {
  /** Opens the sheet on `type` (default Pengeluaran), optionally with a description typed elsewhere (⌘K). */
  readonly open: (options?: RecordPrefill) => void;
}

const RecordContext = createContext<RecordTransactionApi | null>(null);

/** Thrown when `useRecordTransaction` is used outside `<RecordTransactionProvider>`. */
export class MissingRecordTransactionProviderError extends Error {
  override name = 'MissingRecordTransactionProviderError';
}

export function useRecordTransaction(): RecordTransactionApi {
  const api = use(RecordContext);
  if (api === null) throw new MissingRecordTransactionProviderError('useRecordTransaction() needs its provider');
  return api;
}

/** Says what was saved, with "Urungkan" (soft delete, FR-T9); also used by the Quick Add bar. */
export function announceSaved(saved: {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly accountName: string | undefined;
  readonly locale: Locale;
  readonly onChange: () => void;
}): void {
  toast.undo({
    title: m.record_saved_title(),
    description: (
      <>
        {saved.label}
        {' · '}
        <Money minor={saved.amountMinor} currency={saved.currency} context="amount" locale={saved.locale} />
        {' · '}
        {saved.accountName}
      </>
    ),
    undoLabel: m.record_undo(),
    onUndo: () => {
      void removeTransactions({ data: { ids: [saved.id] } }).then((result) => {
        if (result.ok) {
          toast({ tone: 'info', title: m.record_undone() });
          saved.onChange();
        } else {
          toast({ tone: 'error', title: ledgerErrorMessage(result.code, saved.locale) });
        }
      });
    },
  });
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly data: LedgerData; readonly drafts: readonly DraftView[] };

interface Session {
  /** Remounts the form for a fresh entry. */
  readonly key: number;
  readonly initial: TransactionFormValues;
  /** The draft the form continues, removed once saved. */
  readonly draftId: string | null;
}

export function RecordTransactionProvider({
  timeZone,
  children,
}: {
  readonly timeZone: string;
  readonly children: ReactNode;
}) {
  const { preferences } = usePreferences();
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<RecordPrefill>({});
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  const load = (next: RecordPrefill) => {
    setPrefill(next);
    setLoaded({ status: 'loading' });
    setOpen(true);
    void Promise.all([
      listAccounts({ data: {} }),
      listCategories({ data: {} }),
      listTags({ data: {} }),
      listDrafts({ data: { kind: 'transaction' } }),
    ]).then(
      ([accounts, categories, tags, drafts]) => {
        const fail = (code: string) => {
          setLoaded({ status: 'failed', message: ledgerErrorMessage(code, preferences.locale) });
        };
        if (!accounts.ok) fail(accounts.code);
        else if (!categories.ok) fail(categories.code);
        else if (!tags.ok) fail(tags.code);
        else if (!drafts.ok) fail(drafts.code);
        else {
          setLoaded({
            status: 'ready',
            data: {
              baseCurrency: accounts.value.baseCurrency,
              accounts: accounts.value.accounts,
              categories: categories.value,
              tags: tags.value,
            },
            drafts: drafts.value,
          });
        }
      },
      () => {
        setLoaded({ status: 'failed', message: m.record_load_failed() });
      },
    );
  };

  const api = useMemo<RecordTransactionApi>(
    () => ({
      open: (options) => {
        load(options ?? {});
      },
    }),
    // `load` only sets state and starts requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const shortcuts = useMemo(
    () => [
      {
        keys: ['N'],
        run: () => {
          api.open();
        },
      },
    ],
    [api],
  );
  useShortcuts(shortcuts);

  return (
    <RecordContext value={api}>
      {children}
      {open ? (
        loaded.status === 'ready' ? (
          <RecordSheet
            prefill={prefill}
            data={loaded.data}
            drafts={loaded.drafts}
            timeZone={timeZone}
            locale={preferences.locale}
            platform={preferences.platform}
            onClose={() => {
              setOpen(false);
            }}
          />
        ) : (
          <Sheet
            open
            onOpenChange={setOpen}
            title={m.record_title_expense()}
            description={m.record_description_expense()}
            closeLabel={m.record_close()}
          >
            {loaded.status === 'loading' ? (
              <PageState kind="loading" title={m.record_loading()} />
            ) : (
              <FormError>{loaded.message}</FormError>
            )}
          </Sheet>
        )
      ) : null}
    </RecordContext>
  );
}

const TITLES: Readonly<Record<EntryKind, () => string>> = {
  expense: m.record_title_expense,
  income: m.record_title_income,
  transfer: m.record_title_transfer,
};

const DESCRIPTIONS: Readonly<Record<EntryKind, () => string>> = {
  expense: m.record_description_expense,
  income: m.record_description_expense,
  transfer: m.record_description_transfer,
};

function RecordSheet({
  prefill,
  data,
  drafts: initialDrafts,
  timeZone,
  locale,
  platform,
  onClose,
}: {
  readonly prefill: RecordPrefill;
  readonly data: LedgerData;
  readonly drafts: readonly DraftView[];
  readonly timeZone: string;
  readonly locale: Locale;
  readonly platform: 'mac' | 'other';
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const today: LocalDate = toLocalDate(new Date(), timeZone);
  const fresh = (start: { readonly type: EntryKind; readonly accountId?: string | null }): TransactionFormValues =>
    emptyValues({
      type: start.type,
      accountId: start.accountId ?? defaultAccountId(data.accounts),
      date: today,
      time: wallTime(new Date(), timeZone),
    });
  const [session, setSession] = useState<Session>(() => ({
    key: 0,
    initial: { ...fresh({ type: prefill.type ?? 'expense' }), description: prefill.description ?? '' },
    draftId: null,
  }));
  const [drafts, setDrafts] = useState(initialDrafts);
  const [savedCount, setSavedCount] = useState(0);
  const [addAnother, setAddAnother] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const form = useTransactionForm({ initial: session.initial, data, locale });
  const { values } = form;
  const account = data.accounts.find((candidate) => candidate.id === values.accountId);
  const category = data.categories.find((candidate) => candidate.id === values.categoryId);
  const currency = account?.currency ?? data.baseCurrency;

  const restart = (next: Omit<Session, 'key'>) => {
    setSession((current) => ({ key: current.key + 1, ...next }));
    form.reset(next.initial);
    setFailure(null);
  };

  // FR-R4 "Sesuaikan saldo" opens over the sheet, which keeps what was typed.
  const { openReconcile } = useReconcile();
  const keepDraft = async (): Promise<boolean> => {
    const result = await saveDraft({
      data: {
        ...(session.draftId === null ? {} : { id: session.draftId }),
        kind: 'transaction',
        payload: toDraftPayload(values),
      },
    });
    if (!result.ok) {
      toast({ tone: 'error', title: ledgerErrorMessage(result.code, locale) });
      return false;
    }
    toast({ tone: 'info', title: m.record_draft_saved() });
    return true;
  };

  const submit = async (another: boolean) => {
    if (saving) return;
    const input = form.prepare({ timeZone, source: 'manual' });
    if (input === null) return;
    setSaving(true);
    setFailure(null);
    const result = await recordTransaction({ data: input }).catch(() => null);
    setSaving(false);
    if (result === null || !result.ok) {
      setFailure(result === null ? m.record_save_failed() : ledgerErrorMessage(result.code, locale));
      return;
    }
    if (session.draftId !== null) {
      void removeDraft({ data: { id: session.draftId } });
      setDrafts((current) => current.filter((draft) => draft.id !== session.draftId));
    }
    const amount = input.type === 'transfer' ? input.sentMinor : input.amountMinor;
    announceSaved({
      id: result.value.id,
      label: values.type === 'transfer' || category === undefined ? m.record_type_transfer() : categoryName(category),
      amountMinor: values.type === 'income' ? amount : -amount,
      currency,
      accountName: account?.displayName,
      locale,
      onChange: () => {
        void router.invalidate();
      },
    });
    void router.invalidate();
    if (another) {
      setSavedCount((count) => count + 1);
      restart({
        initial: { ...fresh({ type: values.type, accountId: values.accountId }), date: values.date },
        draftId: null,
      });
    } else {
      onClose();
    }
  };

  const shortcuts = useMemo(
    () => [
      { keys: ['mod', 'enter'], run: () => void submit(addAnother) },
      { keys: ['shift', 'enter'], run: () => void submit(true) },
    ],
    // Rebuilt every render so the bindings see the current form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, addAnother],
  );
  useShortcuts(shortcuts);

  return (
    <>
      <Sheet
        open
        onOpenChange={() => {
          // Only closing reaches here: the sheet has no trigger of its own.
          if (isFilled(values)) setConfirmClose(true);
          else onClose();
        }}
        title={TITLES[values.type]()}
        description={savedCount > 0 ? m.record_session_saved({ count: savedCount }) : DESCRIPTIONS[values.type]()}
        closeLabel={m.record_close()}
        footer={
          <>
            <ErrorSummary form={form} />
            {form.showErrors && Object.keys(form.errors).length > 0 ? null : (
              <Checkbox
                label={m.record_add_another()}
                checked={addAnother}
                onChange={(event) => {
                  setAddAnother(event.currentTarget.checked);
                }}
              />
            )}
            <span className="flex-1" />
            <Button
              variant="secondary"
              className="whitespace-nowrap"
              onClick={() => {
                if (isFilled(values)) setConfirmClose(true);
                else onClose();
              }}
            >
              {m.record_cancel()}
            </Button>
            <Button
              pending={saving}
              className="whitespace-nowrap"
              onClick={() => {
                void submit(addAnother);
              }}
            >
              {form.shortfall === null ? m.record_save() : m.record_save_anyway()}
              <KbdHint keys={['mod', 'enter']} platform={platform} className="ml-1" />
            </Button>
          </>
        }
      >
        {drafts.length === 0 || session.draftId !== null ? null : (
          <section
            aria-label={m.record_drafts_heading()}
            className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-surface-2 p-3"
          >
            <h3 className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-fg">
              <FileClock aria-hidden="true" className="size-3.5" />
              {m.record_drafts_heading()}
            </h3>
            <ul className="flex flex-col gap-1">
              {drafts.map((draft) => {
                const draftValues = fromDraftPayload(draft.payload);
                const name = draftValues?.description.trim() || m.record_draft_untitled();
                return (
                  <li key={draft.id} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {draftValues === null ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          restart({ initial: draftValues, draftId: draft.id });
                        }}
                      >
                        {m.record_draft_continue()}
                      </Button>
                    )}
                    <button
                      type="button"
                      aria-label={m.record_draft_remove({ name })}
                      onClick={() => {
                        void removeDraft({ data: { id: draft.id } }).then((result) => {
                          if (result.ok) setDrafts((current) => current.filter((other) => other.id !== draft.id));
                        });
                      }}
                      className="flex size-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <TransactionFormFields
          key={session.key}
          form={form}
          data={data}
          locale={locale}
          timeZone={timeZone}
          today={today}
          onRecordIncomeFirst={(accountId) => {
            void keepDraft().then((kept) => {
              if (kept) restart({ initial: fresh({ type: 'income', accountId }), draftId: null });
            });
          }}
          onAdjustBalance={openReconcile}
        />
        {failure === null ? null : <FormError>{failure}</FormError>}
      </Sheet>
      <Modal
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={m.record_discard_title()}
        description={m.record_discard_description()}
      >
        <div className="flex items-center gap-3 rounded-[10px] border border-border p-3 text-[13px]">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{values.description.trim() || TITLES[values.type]()}</span>
            <span className="truncate text-[12px] text-muted-fg">
              {[
                category === undefined ? null : categoryName(category),
                account?.displayName ?? null,
                values.tags.length === 0 ? null : m.record_discard_tags({ count: values.tags.length }),
              ]
                .filter((part) => part !== null)
                .join(' · ')}
            </span>
          </div>
          {values.amountMinor === null ? null : (
            <Money
              minor={values.type === 'income' ? values.amountMinor : -values.amountMinor}
              currency={currency}
              context="delta"
              locale={locale}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              void keepDraft().then((kept) => {
                if (kept) onClose();
              });
            }}
          >
            {m.record_discard_keep_draft()}
          </Button>
          <span className="flex-1" />
          <Button
            variant="secondary"
            onClick={() => {
              setConfirmClose(false);
            }}
          >
            {m.record_discard_continue()}
          </Button>
          <Button variant="destructive" onClick={onClose}>
            {m.record_discard_confirm()}
          </Button>
        </div>
      </Modal>
    </>
  );
}
