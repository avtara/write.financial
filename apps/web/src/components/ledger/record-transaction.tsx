// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The global Record Transaction sheet (FR-T1, T9; design Section 03): opened with `N` from any signed-in page (also
 * on tablet) or through {@link useRecordTransaction}. It loads accounts, categories, and tags when it opens, saves
 * through `recordTransaction` (one `clientId` per entry, so a retried save never records twice), confirms with a
 * toast offering "Urungkan", can stay open for the next entry ("Tambah lagi setelah simpan", `⇧↵`), and asks
 * before a filled form is closed: "Buang" / "Simpan draf" / "Lanjut mengisi". Saved drafts are offered when it
 * opens again. "Ulangi" (FR-T6) makes the saved transaction the first occurrence of a recurrence; a future date
 * ("Jadwalkan") records nothing and schedules it (and its repeats) for the Review queue instead.
 */
import { useNavigate, useRouter } from '@tanstack/react-router';
import type { DraftView } from '@wf/db/drafts';
import type { GoalView } from '@wf/db/goals';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { formatDate, toLocalDate } from '@wf/ui/dates';
import { KbdHint } from '@wf/ui/kbd-hint';
import { Money } from '@wf/ui/money';
import { PageState } from '@wf/ui/page-state';
import { Sheet } from '@wf/ui/sheet';
import { toast } from '@wf/ui/toast';
import { FileClock, Split, Trash2 } from 'lucide-react';
import { createContext, use, useMemo, useState, type ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getBudgetStatus } from '../../server/fn/budget.ts';
import { listGoals, spendFromGoal } from '../../server/fn/goals.ts';
import { listAccounts, listCategories, listTags } from '../../server/fn/ledger.ts';
import { listAutoRules } from '../../server/fn/rules.ts';
import { createRecurrence, listSubscriptions } from '../../server/fn/schedules.ts';
import {
  listDrafts,
  recordTransaction,
  removeDraft,
  removeTransactions,
  saveDraft,
} from '../../server/fn/transactions-write.ts';
import { recordCardInstallment, recordCardPayment } from '../../server/fn/debts.ts';
import { INSTALLMENT_MIN_MINOR } from '@wf/domain/creditcard';
import { Button, FormError } from '../form.tsx';
import { AllocatedAccountWarning } from '../goals/allocated-account-warning.tsx';
import { GoalUseField } from '../goals/goal-use-field.tsx';
import { matchGoal } from '../goals/goals-model.ts';
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
import { DEFAULT_TERMS, parseTerms } from '../debts/installment-terms.tsx';
import {
  CardInstallmentField,
  CardPaymentPreview,
  useCardContext,
  type CardPaymentChoice,
  type InstallmentChoice,
} from './card-extras.tsx';
import { recurrenceRequest, type RepeatValues } from './recurrence-draft.ts';
import { RepeatField } from './repeat-field.tsx';
import { RuleSuggestion } from './rule-suggestion.tsx';
import { SplitBillSheet, type BillInput } from './split-bill.tsx';
import { ErrorSummary, TransactionFormFields } from './transaction-form.tsx';
import { useTransactionForm, type LedgerData } from './use-transaction-form.ts';
import { ReceiptEntry } from './receipt-entry.tsx';

/** What another screen fills in: ⌘K's typed text, the calendar's day ("Catat di tanggal ini", 12.00), a top-up. */
export interface RecordPrefill {
  readonly type?: EntryKind;
  readonly description?: string;
  readonly date?: LocalDate;
  /** `HH:mm`; with `date` (default now). */
  readonly time?: string;
  /** The expense/income account or the transfer source (default: the quick-entry account). */
  readonly accountId?: string;
  readonly toAccountId?: string;
  readonly amountMinor?: bigint;
  /** The category of the prefilled expense or income (the Assistant's "Ubah"). */
  readonly categoryId?: string;
  /** FR-G4 "Pakai dana" of a goal: the expense is paid from it ("Bayar dari tujuan" on). */
  readonly goalId?: string;
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
  | {
      readonly status: 'ready';
      readonly data: LedgerData;
      readonly drafts: readonly DraftView[];
      /** Active goals for "Bayar dari tujuan"; empty when they could not be loaded. */
      readonly goals: readonly GoalView[];
    };

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
      listAutoRules({ data: { enabledOnly: true } }).catch(() => null),
      listSubscriptions({ data: {} }).catch(() => null),
      listDrafts({ data: { kind: 'transaction' } }),
      // The budget only adds notes (FR-T2/T3): recording works without it.
      getBudgetStatus({ data: {} }).catch(() => null),
      // Goals only offer "Bayar dari tujuan": recording works without them.
      listGoals({ data: { status: 'active' } }).catch(() => null),
    ]).then(
      ([accounts, categories, tags, rules, subscriptions, drafts, budget, goals]) => {
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
              rules: rules?.ok === true ? rules.value : [],
              subscriptionNames:
                subscriptions?.ok === true
                  ? subscriptions.value.subscriptions.map((subscription) => subscription.name)
                  : [],
              ...(budget?.ok === true
                ? { budget: { lines: budget.value.lines, currency: budget.value.baseCurrency } }
                : {}),
            },
            drafts: drafts.value,
            goals: goals?.ok === true ? goals.value : [],
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
            goals={loaded.goals}
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

/** While "Pisah tagihan" is open its own buttons save. */
const NO_SHORTCUTS: readonly [] = [];

const DESCRIPTIONS: Readonly<Record<EntryKind, () => string>> = {
  expense: m.record_description_expense,
  income: m.record_description_expense,
  transfer: m.record_description_transfer,
};

function RecordSheet({
  prefill,
  data,
  drafts: initialDrafts,
  goals,
  timeZone,
  locale,
  platform,
  onClose,
}: {
  readonly prefill: RecordPrefill;
  readonly data: LedgerData;
  readonly drafts: readonly DraftView[];
  readonly goals: readonly GoalView[];
  readonly timeZone: string;
  readonly locale: Locale;
  readonly platform: 'mac' | 'other';
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const navigate = useNavigate();
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
    initial: {
      ...fresh({ type: prefill.type ?? 'expense', accountId: prefill.accountId ?? null }),
      description: prefill.description ?? '',
      ...(prefill.date === undefined ? {} : { date: prefill.date }),
      ...(prefill.time === undefined ? {} : { time: prefill.time }),
      ...(prefill.toAccountId === undefined ? {} : { toAccountId: prefill.toAccountId }),
      ...(prefill.amountMinor === undefined ? {} : { amountMinor: prefill.amountMinor }),
      ...(prefill.categoryId === undefined ? {} : { categoryId: prefill.categoryId }),
    },
    draftId: null,
  }));
  const [drafts, setDrafts] = useState(initialDrafts);
  const [savedCount, setSavedCount] = useState(0);
  const [addAnother, setAddAnother] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [repeat, setRepeat] = useState<RepeatValues | null>(null);
  // FR-G4 "Bayar dari tujuan": the goal paying (on), and the goal offered that the user declined.
  const [usingGoalId, setUsingGoalId] = useState<string | null>(prefill.goalId ?? null);
  const [plainGoalId, setPlainGoalId] = useState<string | null>(null);
  // FR-L5 "Pisah tagihan": the expense being split (its amount is the whole bill).
  const [splitting, setSplitting] = useState<BillInput | null>(null);
  const form = useTransactionForm({ initial: session.initial, data, locale });
  const { values } = form;
  const scheduled = values.date > today;
  const offeredGoal =
    values.type !== 'expense' || scheduled
      ? null
      : (goals.find((goal) => goal.id === usingGoalId) ?? matchGoal(goals, values));
  const goalOffer = offeredGoal === null || offeredGoal.id === plainGoalId ? null : offeredGoal;
  const payingGoal = goalOffer !== null && goalOffer.id === usingGoalId ? goalOffer : null;
  const account = data.accounts.find((candidate) => candidate.id === values.accountId);
  const category = data.categories.find((candidate) => candidate.id === values.categoryId);
  const currency = account?.currency ?? data.baseCurrency;
  const toAccount = data.accounts.find((candidate) => candidate.id === values.toAccountId);
  const cardId = scheduled
    ? null
    : values.type === 'expense' && account?.type === 'credit_card'
      ? account.id
      : values.type === 'transfer' && toAccount?.type === 'credit_card'
        ? toAccount.id
        : null;
  const cardContext = useCardContext(cardId);
  const [installment, setInstallment] = useState<InstallmentChoice>({ on: false, terms: DEFAULT_TERMS });
  const [cardPayment, setCardPayment] = useState<CardPaymentChoice>({ priority: null, mode: 'reduce_amount' });
  const split =
    cardId !== null &&
    values.type === 'expense' &&
    installment.on &&
    values.amountMinor !== null &&
    values.amountMinor >= INSTALLMENT_MIN_MINOR
      ? parseTerms(installment.terms)
      : null;

  const restart = (next: Omit<Session, 'key'>) => {
    setSession((current) => ({ key: current.key + 1, ...next }));
    form.reset(next.initial);
    setRepeat(null);
    setInstallment({ on: false, terms: DEFAULT_TERMS });
    setCardPayment({ priority: null, mode: 'reduce_amount' });
    setUsingGoalId(null);
    setPlainGoalId(null);
    setSplitting(null);
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

  /** The draft the saved entry continued is no longer needed. */
  const forgetDraft = () => {
    if (session.draftId !== null) {
      void removeDraft({ data: { id: session.draftId } });
      setDrafts((current) => current.filter((draft) => draft.id !== session.draftId));
    }
  };

  const submit = async (another: boolean) => {
    if (saving) return;
    const input = form.prepare({ timeZone, source: 'manual' });
    if (input === null) return;
    setSaving(true);
    setFailure(null);
    if (scheduled) {
      // "Jadwalkan": nothing is recorded now; the occurrence reaches the Review queue on its date.
      const planned = await createRecurrence({ data: recurrenceRequest(input, repeat, values.date) }).catch(() => null);
      setSaving(false);
      if (planned === null || !planned.ok) {
        setFailure(planned === null ? m.record_save_failed() : ledgerErrorMessage(planned.code, locale));
        return;
      }
      toast({
        tone: 'success',
        title: m.record_scheduled_title(),
        description: m.record_scheduled_description({ date: formatDate(values.date, locale, 'date') }),
      });
    } else {
      // Paid from a goal (FR-G4); a card expense split into installments and a payment into a card are recorded with
      // their debt changes.
      type Saved = { ok: true; value: { id: string; goal: GoalView | null } } | { ok: false; code: string };
      const pending: Promise<Saved> =
        payingGoal !== null
          ? spendFromGoal({ data: { goalId: payingGoal.id, markUsed: true, entry: input } }).then((spent) =>
              spent.ok ? { ok: true, value: { id: spent.value.transactionId, goal: spent.value.goal } } : spent,
            )
          : split !== null && input.type !== 'transfer'
            ? recordCardInstallment({ data: { transaction: { ...input, type: 'expense' }, ...split } }).then((saved) =>
                saved.ok ? { ok: true, value: { id: saved.value.transactionId, goal: null } } : saved,
              )
            : cardId !== null && input.type === 'transfer'
              ? recordCardPayment({
                  data: {
                    transaction: input,
                    mode: cardPayment.mode,
                    ...(cardPayment.priority === null ? {} : { priority: [...cardPayment.priority] }),
                  },
                }).then((saved) =>
                  saved.ok ? { ok: true, value: { id: saved.value.transactionId, goal: null } } : saved,
                )
              : recordTransaction({ data: input }).then((saved) =>
                  saved.ok ? { ok: true, value: { id: saved.value.id, goal: null } } : saved,
                );
      const result = await pending.catch(() => null);
      if (result === null || !result.ok) {
        setSaving(false);
        setFailure(result === null ? m.record_save_failed() : ledgerErrorMessage(result.code, locale));
        return;
      }
      if (repeat !== null) {
        // The transaction is saved either way; a failed repeat is reported, not retried.
        const linked = await createRecurrence({
          data: { ...recurrenceRequest(input, repeat, values.date), transactionId: result.value.id },
        }).catch(() => null);
        if (linked === null || !linked.ok) toast({ tone: 'error', title: m.record_repeat_failed() });
      }
      setSaving(false);
      const amount = input.type === 'transfer' ? input.sentMinor : input.amountMinor;
      const usedGoal = result.value.goal;
      if (usedGoal === null) {
        announceSaved({
          id: result.value.id,
          label:
            values.type === 'transfer' || category === undefined ? m.record_type_transfer() : categoryName(category),
          amountMinor: values.type === 'income' ? amount : -amount,
          currency,
          accountName: account?.displayName,
          locale,
          onChange: () => {
            void router.invalidate();
          },
        });
      } else {
        // Paid from a goal, which is now "Terpakai"; what is left can go to another goal.
        toast({
          tone: 'success',
          title: m.record_goal_saved_title({ name: usedGoal.name }),
          description: (
            <>
              <Money minor={-amount} currency={currency} context="amount" locale={locale} />
              {' · '}
              {account?.displayName}
            </>
          ),
          ...(usedGoal.savedMinor > 0n
            ? {
                action: {
                  label: m.record_goal_saved_move(),
                  onClick: () => {
                    void navigate({ to: '/goals', search: { remainder: usedGoal.id } });
                  },
                },
              }
            : {}),
        });
      }
    }
    forgetDraft();
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
  useShortcuts(splitting === null ? shortcuts : NO_SHORTCUTS);

  if (splitting !== null) {
    return (
      <SplitBillSheet
        bill={splitting}
        date={values.date}
        account={account}
        category={category}
        locale={locale}
        onBack={() => {
          setSplitting(null);
        }}
        onSaved={({ count }) => {
          toast({
            tone: 'success',
            title: m.record_split_saved_title(),
            description: m.record_split_saved({ count }),
          });
          forgetDraft();
          void router.invalidate();
          onClose();
        }}
      />
    );
  }

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
              {scheduled
                ? m.record_schedule()
                : split !== null
                  ? m.record_installment_save({ count: split.tenor })
                  : form.shortfall === null
                    ? m.record_save()
                    : m.record_save_anyway()}
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
        <ReceiptEntry timeZone={timeZone} />
        <RuleSuggestion
          rules={data.rules}
          subscriptionNames={data.subscriptionNames}
          categories={data.categories}
          values={values}
          onApply={form.update}
        />
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
          schedule={{
            repeat: (
              <RepeatField value={repeat} onChange={setRepeat} date={values.date} kind={values.type} locale={locale} />
            ),
          }}
          goalUse={
            goalOffer === null ? undefined : (
              <GoalUseField
                goal={goalOffer}
                amountMinor={values.amountMinor}
                using={payingGoal !== null}
                locale={locale}
                onUse={() => {
                  setUsingGoalId(goalOffer.id);
                  // Paid with the goal's money: from the account it is kept in.
                  const source =
                    goalOffer.sources.find((candidate) => candidate.mode === 'fixed') ?? goalOffer.sources[0];
                  if (
                    source !== undefined &&
                    !goalOffer.sources.some((other) => other.accountId === values.accountId)
                  ) {
                    form.update({ accountId: source.accountId });
                  }
                }}
                onPlain={() => {
                  setUsingGoalId(null);
                  setPlainGoalId(goalOffer.id);
                }}
              />
            )
          }
        />
        {payingGoal === null ? (
          <AllocatedAccountWarning
            goals={goals}
            accounts={data.accounts}
            accountId={values.accountId}
            expense={values.type === 'expense'}
            amountMinor={values.amountMinor}
            locale={locale}
            onSwitch={(accountId) => {
              form.update({ accountId });
            }}
          />
        ) : null}
        {cardContext === null || cardContext === 'loading' || cardContext === 'failed' ? null : values.type ===
          'expense' ? (
          <CardInstallmentField
            context={cardContext}
            amountMinor={values.amountMinor}
            date={values.date}
            value={installment}
            onChange={setInstallment}
            locale={locale}
          />
        ) : values.amountMinor === null ? null : (
          <CardPaymentPreview
            context={cardContext}
            amountMinor={values.amountMinor}
            value={cardPayment}
            onChange={setCardPayment}
            locale={locale}
          />
        )}
        {values.type === 'expense' && !scheduled && split === null && payingGoal === null ? (
          <button
            type="button"
            onClick={() => {
              const input = form.prepare({ timeZone, source: 'manual' });
              // An expense form prepares an expense.
              if (input !== null) setSplitting(input as BillInput);
            }}
            className="flex items-center gap-2.5 rounded-[10px] border border-border px-3 py-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Split aria-hidden="true" className="size-4 shrink-0 text-muted-fg" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-medium text-fg">{m.record_split_open()}</span>
              <span className="text-[11.5px] text-subtle">{m.record_split_open_note()}</span>
            </span>
          </button>
        ) : null}
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
