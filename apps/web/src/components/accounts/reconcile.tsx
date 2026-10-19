// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Sesuaikan saldo" (FR-R4, design `lAmFr`): the user enters the balance their bank app shows, sees the difference,
 * and records it as (a) a categorized expense/income or (c) a correction kept out of reports. (b) "Ada transaksi
 * yang terlewat" needs the Transactions page, which does not exist yet.
 *
 * Any screen opens it through `useReconcile().openReconcile(accountId)` (e.g. Quick Add's insufficient-balance
 * warning); `<ReconcileProvider>` is mounted once in the `_app` layout, loads the account and categories on open, and
 * refreshes the route data after saving.
 */
import { useRouter } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { DateLabel } from '@wf/ui/date-label';
import { DatePicker } from '@wf/ui/date-picker';
import { toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Select } from '@wf/ui/select';
import { toast } from '@wf/ui/toast';
import { ArrowDownRight, ArrowUpRight, Check, History } from 'lucide-react';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_SHORTFALL_CATEGORY, differenceCategories } from '../../lib/accounts.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import { reconcileAccount } from '../../server/fn/accounts.ts';
import { listAccounts, listCategories } from '../../server/fn/ledger.ts';
import { Button, Field, FormError, INPUT_FRAME } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';

/** When the difference is recorded: now for today, else midday UTC of the picked date (the same date everywhere). */
export function occurredAtFor(date: LocalDate, today: LocalDate, now: Date): Date {
  return date === today ? now : new Date(`${date}T12:00:00Z`);
}

export interface ReconcileDialogProps {
  readonly account: AccountView;
  readonly categories: readonly CategoryView[];
  readonly timeZone: string;
  readonly onOpenChange: (open: boolean) => void;
  /** After a successful save. */
  readonly onDone: () => void;
}

type Mode = 'transaction' | 'correction';

export function ReconcileDialog({ account, categories, timeZone, onOpenChange, onDone }: ReconcileDialogProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [today] = useState(() => toLocalDate(new Date(), timeZone));
  const [clientId] = useState(() => crypto.randomUUID());
  const [actual, setActual] = useState<bigint | null>(null);
  const [mode, setMode] = useState<Mode>('transaction');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState<LocalDate>(today);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const difference = actual === null ? null : actual - account.balanceMinor;
  const options = difference === null ? [] : differenceCategories(categories, difference);
  const fallback =
    difference !== null && difference < 0n
      ? (options.find((category) => category.builtInKey === DEFAULT_SHORTFALL_CATEGORY)?.id ?? null)
      : null;
  const chosen = options.some((category) => category.id === categoryId) ? categoryId : fallback;
  const needsCategory = difference !== null && difference !== 0n && mode === 'transaction' && chosen === null;

  const submit = async () => {
    if (actual === null || difference === null || needsCategory) return;
    setPending(true);
    setFailure(null);
    const result = await reconcileAccount({
      data:
        mode === 'transaction' && difference !== 0n
          ? {
              id: account.id,
              mode,
              actualBalanceMinor: actual,
              categoryId: chosen,
              clientId,
              occurredAt: occurredAtFor(date, today, new Date()),
            }
          : { id: account.id, mode: 'correction', actualBalanceMinor: actual },
    });
    setPending(false);
    if (!result.ok) {
      setFailure(ledgerErrorMessage(result.code, locale));
      return;
    }
    toast({ title: m.accounts_reconcile_done({ name: account.displayName }) });
    onDone();
  };

  const radio = (value: Mode, title: string, description: string, aside?: ReactNode) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border p-3 has-checked:border-border-strong has-checked:bg-tint-04 has-focus-visible:outline-2 has-focus-visible:outline-ring">
      <input
        type="radio"
        name="reconcile-mode"
        value={value}
        checked={mode === value}
        onChange={() => {
          setMode(value);
        }}
        className="mt-0.5 size-4 accent-fg"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-fg">{title}</span>
        <span className="text-[11.5px] text-subtle">{description}</span>
      </span>
      {aside}
    </label>
  );

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      size="xl"
      title={m.accounts_reconcile_title()}
      description={m.accounts_reconcile_description({ name: account.displayName })}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-muted-fg">{m.accounts_reconcile_recorded()}</span>
            <span className="flex h-[42px] items-center rounded-[9px] border border-border bg-surface-sunken px-3 text-[14px] text-muted-fg">
              <Money minor={account.balanceMinor} currency={account.currency} context="amount" locale={locale} />
            </span>
          </div>
          <Field label={m.accounts_reconcile_actual()}>
            {({ id }) => (
              <div className={INPUT_FRAME.lg}>
                <AmountInput
                  id={id}
                  autoFocus
                  size="inline"
                  value={actual}
                  onValueChange={setActual}
                  currency={account.currency}
                  locale={locale}
                />
              </div>
            )}
          </Field>
        </div>

        {difference === null ? null : difference === 0n ? (
          <p className="flex items-center gap-2 rounded-[10px] bg-green-tint-2 px-3 py-2.5 text-[12.5px] text-green-fg">
            <Check aria-hidden="true" className="size-4" />
            {m.accounts_reconcile_matched()}
          </p>
        ) : (
          <div
            role="status"
            className={`flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${difference < 0n ? 'border-red-tint-2 bg-red-tint-1 text-red-fg' : 'border-green-tint-2 bg-green-tint-1 text-green-fg'}`}
          >
            {difference < 0n ? (
              <ArrowDownRight aria-hidden="true" className="mt-0.5 size-4" />
            ) : (
              <ArrowUpRight aria-hidden="true" className="mt-0.5 size-4" />
            )}
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold">
                {m.accounts_reconcile_difference()}{' '}
                <Money minor={difference} currency={account.currency} context="amount" locale={locale} />
              </span>
              <span className="text-[12px] text-muted-fg">
                {difference < 0n ? m.accounts_reconcile_more_before() : m.accounts_reconcile_less_before()}{' '}
                <Money
                  minor={difference < 0n ? -difference : difference}
                  currency={account.currency}
                  context="amount"
                  locale={locale}
                />{' '}
                {difference < 0n ? m.accounts_reconcile_more_after() : m.accounts_reconcile_less_after()}
              </span>
            </span>
          </div>
        )}

        {difference === null || difference === 0n ? null : (
          <fieldset className="flex flex-col gap-2">
            <legend className="pb-2 text-[12.5px] font-medium text-muted-fg">{m.accounts_reconcile_record_as()}</legend>
            {radio(
              'transaction',
              difference < 0n ? m.accounts_reconcile_expense() : m.accounts_reconcile_income(),
              difference < 0n ? m.accounts_reconcile_expense_hint() : m.accounts_reconcile_income_hint(),
              <Money
                minor={difference}
                currency={account.currency}
                context="delta"
                locale={locale}
                className="text-[12px]"
              />,
            )}
            {mode === 'transaction' ? (
              <div className="grid grid-cols-[1fr_auto] gap-3 pl-7">
                <Select
                  aria-label={m.accounts_reconcile_category()}
                  value={chosen}
                  onValueChange={setCategoryId}
                  placeholder={m.accounts_reconcile_category()}
                  size="sm"
                  options={options.map((category) => ({ value: category.id, label: categoryName(category) }))}
                />
                <DatePicker
                  aria-label={m.accounts_reconcile_date()}
                  size="sm"
                  value={date}
                  onValueChange={setDate}
                  placeholder={m.accounts_reconcile_date()}
                  today={today}
                  locale={locale}
                  disableFuture
                  labels={{ previousMonth: m.accounts_previous_month(), nextMonth: m.accounts_next_month() }}
                />
              </div>
            ) : null}
            {radio('correction', m.accounts_reconcile_correction(), m.accounts_reconcile_correction_hint())}
          </fieldset>
        )}

        {failure === null ? null : <FormError>{failure}</FormError>}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <span className="flex items-center gap-1.5 text-[12px] text-subtle">
            {account.lastReconciledAt === null ? null : (
              <>
                <History aria-hidden="true" className="size-3.5" />
                {m.accounts_reconcile_last()}{' '}
                <DateLabel instant={account.lastReconciledAt} timeZone={timeZone} locale={locale} format="day" />
              </>
            )}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {m.accounts_cancel()}
            </Button>
            <Button type="submit" size="sm" pending={pending} disabled={actual === null || needsCategory}>
              <Check aria-hidden="true" className="size-3.5" />
              {m.accounts_reconcile_submit()}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export interface Reconcile {
  /** Opens "Sesuaikan saldo" for one of the user's active accounts. */
  readonly openReconcile: (accountId: string) => void;
}

/** Thrown when `useReconcile` is used outside `<ReconcileProvider>`. */
export class MissingReconcileProviderError extends Error {
  override name = 'MissingReconcileProviderError';
}

const ReconcileContext = createContext<Reconcile | null>(null);

interface Loaded {
  readonly account: AccountView;
  readonly categories: CategoryView[];
}

/** Hosts the reconciliation dialog for the whole signed-in app. */
export function ReconcileProvider({ timeZone, children }: { timeZone: string; children: ReactNode }) {
  const router = useRouter();
  const { preferences } = usePreferences();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const openReconcile = useCallback(
    (accountId: string) => {
      void Promise.all([listAccounts({ data: { status: 'active' } }), listCategories({ data: {} })]).then(
        ([accounts, categories]) => {
          const account = accounts.ok
            ? accounts.value.accounts.find((candidate) => candidate.id === accountId)
            : undefined;
          if (account === undefined || !categories.ok) {
            const code = !accounts.ok ? accounts.code : !categories.ok ? categories.code : 'NOT_FOUND';
            toast({ title: ledgerErrorMessage(code, preferences.locale), tone: 'error' });
            return;
          }
          setLoaded({ account, categories: categories.value });
        },
      );
    },
    [preferences.locale],
  );
  const value = useMemo(() => ({ openReconcile }), [openReconcile]);

  return (
    <ReconcileContext value={value}>
      {children}
      {loaded === null ? null : (
        <ReconcileDialog
          key={loaded.account.id}
          account={loaded.account}
          categories={loaded.categories}
          timeZone={timeZone}
          onOpenChange={() => {
            // The dialog only ever asks to close.
            setLoaded(null);
          }}
          onDone={() => {
            setLoaded(null);
            void router.invalidate();
          }}
        />
      )}
    </ReconcileContext>
  );
}

export function useReconcile(): Reconcile {
  const value = use(ReconcileContext);
  if (value === null) throw new MissingReconcileProviderError('useReconcile needs a <ReconcileProvider>');
  return value;
}
