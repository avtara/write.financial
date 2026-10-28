// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate, useRouter } from '@tanstack/react-router';
import type { ReceiptView } from '@wf/db/receipts';
import type { ReceiptItem } from '@wf/domain/receipt';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { toLocalDate, formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Sheet } from '@wf/ui/sheet';
import { toast } from '@wf/ui/toast';
import { Paperclip } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { aiErrorMessage } from '../../lib/ai-errors.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import { getBudgetStatus } from '../../server/fn/budget.ts';
import { listAccounts, listCategories, listTags } from '../../server/fn/ledger.ts';
import { cancelReceipt, getReceipt, prepareManualReceipt, uploadReceipt } from '../../server/fn/receipts.ts';
import { confirmReview } from '../../server/fn/review.ts';
import { removeTransactions } from '../../server/fn/transactions-write.ts';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { announceSaved } from './announce-saved.tsx';
import { defaultAccountId, emptyValues, wallTime, type TransactionFormValues } from './transaction-draft.ts';
import { ErrorSummary, TransactionFormFields } from './transaction-form.tsx';
import { useTransactionForm, type LedgerData } from './use-transaction-form.ts';

/** One receipt request at a time: a reply can never land on a receipt the user has since replaced or cancelled. */
type Working = 'upload' | 'cancel' | 'undo' | 'save';
/** A shown receipt keeps its file: reading it again needs the bytes. */
type ReceiptRead = ReceiptView & { readonly file: File };

/** Shared by Record and Assistant. The receipt has its own form: a late OCR result cannot overwrite manual work. */
export function ReceiptEntry({ timeZone }: { readonly timeZone: string }) {
  const { locale } = usePreferences().preferences;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ReceiptRead | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  /** `retry` is the failed upload: retrying reuses its id, so a lost reply cannot stage the receipt twice. */
  const [failure, setFailure] = useState<{
    readonly message: string;
    readonly retry: { readonly id: string; readonly file: File } | null;
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [manual, setManual] = useState(false);
  const [data, setData] = useState<LedgerData | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const router = useRouter();
  const navigate = useNavigate();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.all([
      listAccounts({ data: {} }),
      listCategories({ data: {} }),
      listTags({ data: {} }),
      getBudgetStatus({ data: {} }).catch(() => null),
    ])
      .then(([accounts, categories, tags, budget]) => {
        if (!live) return;
        if (!accounts.ok || !categories.ok || !tags.ok) {
          setLoadFailed(true);
          return;
        }
        setLoadFailed(false);
        setData({
          baseCurrency: accounts.value.baseCurrency,
          accounts: accounts.value.accounts,
          categories: categories.value,
          tags: tags.value,
          rules: [],
          subscriptionNames: [],
          ...(budget?.ok === true
            ? { budget: { lines: budget.value.lines, currency: budget.value.baseCurrency } }
            : {}),
        });
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open, dataRevision]);
  const pending = view?.status === 'queued' || view?.status === 'reading';
  const receiptId = view?.id;
  useEffect(() => {
    if (!pending || receiptId === undefined) return;
    let live = true;
    let timer: number | undefined;
    const poll = async () => {
      const result = await getReceipt({ data: { id: receiptId } }).catch(() => null);
      if (!live) return;
      if (result?.ok === true) {
        setView((current) => (current?.id === receiptId ? { ...result.value, file: current.file } : current));
        if (result.value.status !== 'queued' && result.value.status !== 'reading') return;
      }
      timer = window.setTimeout(() => {
        void poll();
      }, 1500);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pending, receiptId]);

  const upload = async (file: File, id: string = crypto.randomUUID()) => {
    setOpen(true);
    if (working !== null || pending) return;
    if (
      !['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) ||
      file.size === 0 ||
      file.size > 2 * 1024 * 1024
    ) {
      setFailure({ message: m.receipt_invalid(), retry: null });
      return;
    }
    setWorking('upload');
    setFailure(null);
    const form = new FormData();
    form.set('id', id);
    form.set('file', file);
    const result = await uploadReceipt({ data: form }).catch(() => null);
    setWorking(null);
    if (result?.ok !== true) {
      setFailure({
        message:
          result === null
            ? m.receipt_failed()
            : result.code === 'IMAGE_REJECTED'
              ? m.receipt_invalid()
              : aiErrorMessage(result.code, locale),
        retry: { id, file },
      });
      return;
    }
    setManual(false);
    setData(null);
    setDataRevision((revision) => revision + 1);
    setSavedId(result.value.transactionId);
    setUndoId(null);
    setView({ ...result.value, file });
  };
  /** The file input and both drop targets: exactly one file, or nothing is sent. */
  const choose = (files: FileList | null) => {
    const file = files?.[0];
    if (files?.length !== 1 || file === undefined) {
      setOpen(true);
      setFailure({ message: m.receipt_invalid(), retry: null });
      return;
    }
    void upload(file);
  };
  const cancel = async (id: string) => {
    setWorking('cancel');
    const result = await cancelReceipt({ data: { id } }).catch(() => null);
    setWorking(null);
    if (result?.ok !== true) {
      setFailure({ message: m.receipt_failed(), retry: null });
      return;
    }
    setView(null);
    setManual(false);
    setOpen(false);
  };
  const undo = async (id: string) => {
    setWorking('undo');
    const result = await removeTransactions({ data: { ids: [id] } }).catch(() => null);
    setWorking(null);
    if (result?.ok !== true) {
      setFailure({
        message: result === null ? m.record_save_failed() : ledgerErrorMessage(result.code, locale),
        retry: null,
      });
      return;
    }
    setSavedId(null);
    setUndoId(null);
    setView(null);
    setFailure(null);
    setDataRevision((revision) => revision + 1);
    void router.invalidate();
    toast({ tone: 'info', title: m.record_undone() });
  };
  const retry = failure?.retry ?? null;
  return (
    <>
      <div
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          choose(event.dataTransfer.files);
        }}
        className="flex flex-col gap-1"
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          <Paperclip aria-hidden="true" className="size-3.5" />
          {m.receipt_read()}
        </Button>
      </div>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={m.receipt_read()}
        description={m.assistant_footer()}
        closeLabel={m.record_cancel()}
        size="md"
      >
        <div className="flex flex-col gap-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              choose(event.dataTransfer.files);
            }}
            className="rounded-[10px] border border-dashed border-border p-4"
          >
            <label htmlFor={inputId} className="block cursor-pointer text-[13px] font-medium text-fg">
              {m.receipt_choose()}
            </label>
            <p className="mb-2 text-[12px] text-subtle">{m.receipt_format()}</p>
            <input
              ref={input}
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              disabled={working !== null || pending}
              onChange={(event) => {
                choose(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
              className="max-w-full text-[12px] text-muted-fg"
            />
          </div>
          {loadFailed ? <FormError>{m.record_load_failed()}</FormError> : null}
          {failure === null ? null : (
            <div role="alert" className="flex flex-col items-start gap-2">
              <FormError>{failure.message}</FormError>
              {retry === null ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={working !== null}
                  onClick={() => {
                    void upload(retry.file, retry.id);
                  }}
                >
                  {m.assistant_retry()}
                </Button>
              )}
            </div>
          )}
          {working === 'upload' || pending ? (
            <p role="status" className="text-[13px] text-muted-fg">
              {m.receipt_reading()}
            </p>
          ) : null}
          {view === null ? null : <p className="truncate text-[12px] text-muted-fg">{view.name}</p>}
          {savedId !== null ? (
            <div className="flex flex-col items-start gap-2">
              <p role="status">{m.receipt_attached()}</p>
              <Button
                onClick={() => {
                  setOpen(false);
                  void navigate({ to: '/transactions', search: { tx: savedId } });
                }}
              >
                {m.assistant_draft_open()}
              </Button>
              {undoId === null ? null : (
                <Button
                  variant="secondary"
                  disabled={working !== null}
                  pending={working === 'undo'}
                  onClick={() => {
                    void undo(undoId);
                  }}
                >
                  {m.record_undo()}
                </Button>
              )}
            </div>
          ) : view?.status === 'failed' && !manual ? (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-[13px]">
                {m.receipt_failed()}
              </p>
              <Button
                disabled={working !== null}
                onClick={() => {
                  void upload(view.file);
                }}
              >
                {m.assistant_retry()}
              </Button>
              <Button
                onClick={() => {
                  input.current?.click();
                }}
              >
                {m.receipt_choose()}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setManual(true);
                }}
              >
                {m.receipt_manual()}
              </Button>
            </div>
          ) : view !== null && data !== null && (view.status === 'ready' || manual) ? (
            <ReceiptEditor
              key={view.id}
              view={view}
              data={data}
              timeZone={timeZone}
              working={working}
              onWorking={setWorking}
              onCancel={() => {
                void cancel(view.id);
              }}
              onSaved={(id, canUndo) => {
                setSavedId(id);
                setUndoId(canUndo ? id : null);
                setView({ ...view, status: 'attached', transactionId: id });
                setDataRevision((revision) => revision + 1);
                void router.invalidate();
              }}
              onLedgerChanged={(id) => {
                setUndoId((current) => (current === id ? null : current));
                setSavedId((current) => (current === id ? null : current));
                setView((current) => (current?.transactionId === id ? null : current));
                setDataRevision((revision) => revision + 1);
                void router.invalidate();
              }}
            />
          ) : null}
          {view !== null && savedId === null && !manual && view.status !== 'ready' ? (
            <Button
              variant="secondary"
              pending={working === 'cancel'}
              disabled={working !== null}
              onClick={() => {
                void cancel(view.id);
              }}
            >
              {m.record_cancel()}
            </Button>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
function ReceiptEditor({
  view,
  data,
  timeZone,
  working,
  onWorking,
  onCancel,
  onSaved,
  onLedgerChanged,
}: {
  view: ReceiptView;
  data: LedgerData;
  timeZone: string;
  working: Working | null;
  onWorking: (working: Working | null) => void;
  onCancel: () => void;
  onSaved: (id: string, canUndo: boolean) => void;
  onLedgerChanged: (id: string) => void;
}) {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const today = toLocalDate(new Date(), timeZone);
  const draft = view.draft?.type === 'expense' ? view.draft : null;
  // A read receipt can only be recorded to an account in its own currency.
  const formData =
    view.extraction === null
      ? data
      : { ...data, accounts: data.accounts.filter((entry) => entry.currency === view.extraction?.currency) };
  const [initial] = useState<TransactionFormValues>(() => ({
    ...emptyValues({
      accountId: draft?.accountId ?? defaultAccountId(formData.accounts),
      date: view.extraction?.date ?? today,
      time: view.extraction?.time ?? wallTime(new Date(), timeZone),
    }),
    ...(draft === null
      ? {}
      : {
          amountMinor: draft.amountMinor,
          categoryId: draft.categoryId,
          description: draft.description ?? '',
          tags: draft.tags ?? [],
        }),
  }));
  const form = useTransactionForm({ initial, data: formData, locale });
  const [items, setItems] = useState<readonly ReceiptItem[]>(view.extraction?.items ?? []);
  const [merchant, setMerchant] = useState(draft?.merchant ?? view.extraction?.merchant ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const reviewItemId = view.reviewItemId;
  const account = formData.accounts.find((entry) => entry.id === form.values.accountId);
  const currency = account?.currency ?? view.extraction?.currency ?? data.baseCurrency;
  /** Clears the request; the recorded or attached transaction's id, or `null` once the failure is shown. */
  const settle = (result: Awaited<ReturnType<typeof confirmReview>> | null): string | null => {
    onWorking(null);
    if (result?.ok !== true || result.value.transactionId === null) {
      setFailure(result === null || result.ok ? m.record_save_failed() : ledgerErrorMessage(result.code, locale));
      return null;
    }
    return result.value.transactionId;
  };
  const save = async () => {
    // The Ctrl/⌘+Enter shortcut stays live while a request runs.
    if (working !== null) return;
    const input = form.prepare({ timeZone, source: 'manual' });
    if (input === null || input.type !== 'expense') return;
    onWorking('save');
    setFailure(null);
    let itemId = reviewItemId;
    if (itemId === null) {
      // Idempotent per receipt: a retry after a lost reply gets the same review item.
      const manual = await prepareManualReceipt({
        data: {
          id: view.id,
          accountId: input.accountId,
          amountMinor: input.amountMinor,
          categoryId: input.categoryId,
          occurredAt: input.occurredAt,
          description: input.description ?? '',
          note: input.note ?? '',
          tags: [...form.values.tags],
        },
      }).catch(() => null);
      if (manual?.ok !== true) {
        onWorking(null);
        setFailure(m.record_save_failed());
        return;
      }
      itemId = manual.value.reviewItemId;
    }
    const id = settle(
      await confirmReview({
        data: {
          itemId,
          edits: {
            amountMinor: input.amountMinor,
            occurredAt: input.occurredAt,
            accountId: input.accountId,
            categoryId: input.categoryId,
            description: input.description,
            merchant: merchant.trim() || null,
            note: input.note,
            tags: input.tags,
            receiptItems: [...items],
          },
        },
      }).catch(() => null),
    );
    if (id === null) return;
    announceSaved({
      id,
      label: input.description ?? view.name,
      amountMinor: -input.amountMinor,
      currency,
      accountName: account?.displayName,
      locale,
      onChange: () => {
        onLedgerChanged(id);
      },
    });
    onSaved(id, true);
  };
  const attach = async (itemId: string, duplicateId: string) => {
    onWorking('save');
    setFailure(null);
    const id = settle(
      await confirmReview({ data: { itemId, edits: { receiptDuplicateId: duplicateId } } }).catch(() => null),
    );
    if (id === null) return;
    toast({ tone: 'success', title: m.receipt_attached() });
    onSaved(id, false);
  };
  const uncertain = view.extraction?.uncertain ?? [];
  const fieldLabels: Record<string, string> = {
    amount: m.record_amount(),
    date: m.record_date(),
    time: m.assistant_draft_time(),
    merchant: m.receipt_merchant(),
    account: m.assistant_draft_account(),
    category: m.assistant_draft_category(),
  };
  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          void save();
        }
      }}
    >
      {view.extraction === null ? null : (
        <>
          <span className="self-start rounded-full bg-blue-tint-1 px-2 py-1 text-[11px] text-blue-fg">
            {m.receipt_badge()}
          </span>
          {uncertain.length === 0 ? null : (
            <p role="status" className="text-[12px] text-amber-fg">
              {m.receipt_uncertain({
                fields: Object.entries(fieldLabels)
                  .filter(([field]) => uncertain.includes(field))
                  .map(([, label]) => label)
                  .join(', '),
              })}
            </p>
          )}
          {items.length === 0 ? null : (
            <section aria-label={m.receipt_items()} className="flex flex-col gap-2">
              {items.map((item, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_150px] items-start gap-2 rounded-[8px] border border-border p-2 text-[12px]"
                >
                  <span>
                    {item.quantity} × {item.name}
                    {item.uncertain ? <span className="block text-amber-fg">{m.receipt_item_uncertain()}</span> : null}
                  </span>
                  <AmountInput
                    size="inline"
                    aria-label={item.name}
                    value={item.amountMinor}
                    currency={currency}
                    locale={locale}
                    onValueChange={(amountMinor) => {
                      setItems((current) =>
                        current.map((entry, at) =>
                          at === index ? { ...entry, amountMinor, uncertain: amountMinor === null } : entry,
                        ),
                      );
                    }}
                  />
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {view.duplicates.length === 0 || reviewItemId === null ? null : (
        <section
          aria-label={m.receipt_duplicate()}
          className="flex flex-col gap-2 rounded-[10px] border border-amber p-3"
        >
          <h4 className="text-[13px] font-medium">{m.receipt_duplicate()}</h4>
          {view.duplicates.map((entry) => (
            <div key={entry.id} className="flex flex-col items-start gap-1 text-[12px]">
              <span>
                {entry.merchant ?? entry.description} ·{' '}
                {formatDate(toLocalDate(entry.occurredAt, timeZone), locale, 'date')} ·{' '}
                {wallTime(entry.occurredAt, timeZone)}
              </span>
              <span>
                {data.accounts.find((account) => account.id === entry.accountId)?.displayName} ·{' '}
                {(() => {
                  const category = data.categories.find((category) => category.id === entry.categoryId);
                  return category === undefined ? m.transactions_table_uncategorized() : categoryName(category);
                })()}
              </span>
              <Money minor={entry.amountMinor} currency={currency} context="table" locale={locale} />
              <Button
                disabled={working !== null}
                size="sm"
                variant="secondary"
                onClick={() => {
                  void attach(reviewItemId, entry.id);
                }}
              >
                {m.receipt_attach()}
              </Button>
            </div>
          ))}
        </section>
      )}
      <Field label={m.receipt_merchant()}>
        {({ id }) => (
          <TextInput
            id={id}
            size="sm"
            value={merchant}
            maxLength={200}
            onChange={(event) => {
              setMerchant(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      <TransactionFormFields form={form} data={formData} locale={locale} timeZone={timeZone} today={today} hideKind />
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center justify-end gap-2">
        <ErrorSummary form={form} />
        <Button variant="secondary" disabled={working !== null} onClick={onCancel}>
          {m.record_cancel()}
        </Button>
        <Button
          disabled={working !== null}
          pending={working === 'save'}
          onClick={() => {
            void save();
          }}
        >
          {view.duplicates.length === 0 ? m.record_save() : m.receipt_record_new()}
        </Button>
      </div>
    </div>
  );
}
