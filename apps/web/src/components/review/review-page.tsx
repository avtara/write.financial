// SPDX-License-Identifier: AGPL-3.0-only
/** A searchable review table with a detail sheet; proposals only affect the ledger after confirmation. */
import { useRouter } from '@tanstack/react-router';
import type { ReviewItemView, ReviewEdits } from '@wf/db/review';
import type { TagView } from '@wf/db/tags';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { EmptyState } from '@wf/ui/empty-state';
import { Money } from '@wf/ui/money';
import { Sheet } from '@wf/ui/sheet';
import { toast } from '@wf/ui/toast';
import { Inbox } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { listTags } from '../../server/fn/ledger.ts';
import { confirmReview, confirmReviewBulk, ignoreReview, markReviewUnpaid } from '../../server/fn/review.ts';
import { Button, Field } from '../form.tsx';
import { AccountPicker, AccountTrigger } from '../ledger/account-picker.tsx';
import { CategorySelect } from '../ledger/category-picker.tsx';
import { announceSaved } from '../ledger/announce-saved.tsx';
import { Modal } from '../modal.tsx';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { CategoryRow, CloseCard, type ReviewLookup } from './review-cards.tsx';
import {
  groupReviewItems,
  pendingTotals,
  type CategoryItem,
  type CloseItem,
  type DraftItem,
  type GmailReviewItem,
} from './review-model.ts';
import { GmailReviewCard } from './gmail-review-card.tsx';
import { ReviewDraftEditor } from './review-draft-editor.tsx';
import { ReviewTable } from './review-table.tsx';

export interface ReviewPageProps {
  readonly items: readonly ReviewItemView[];
  readonly lookup: ReviewLookup;
  readonly timeZone: string;
  readonly today: LocalDate;
  /** `?item=` opens the proposal directly in its detail sheet. */
  readonly focusItem?: string | undefined;
}

interface ApplyState {
  readonly item: CloseItem;
  readonly fromAccountId: string;
  readonly toAccountId: string;
}

export function ReviewPage({ items, lookup: providedLookup, timeZone, today, focusItem }: ReviewPageProps) {
  const router = useRouter();
  const { locale } = usePreferences().preferences;
  const [tags, setTags] = useState<readonly TagView[]>([]);
  const lookup = { ...providedLookup, tags: providedLookup.tags ?? tags };
  const groups = groupReviewItems(items);
  const pending = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(focusItem ?? null);
  const [lastFocus, setLastFocus] = useState(focusItem);
  if (lastFocus !== focusItem) {
    setLastFocus(focusItem);
    setSelectedId(focusItem ?? null);
  }
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(new Set());
  const [choices, setChoices] = useState<ReadonlyMap<string, string>>(new Map());
  const [bulkCategory, setBulkCategory] = useState<string | null>(null);
  const [askBulkCategory, setAskBulkCategory] = useState<string | null>(null);
  const [askPayAll, setAskPayAll] = useState(false);
  const [apply, setApply] = useState<ApplyState | null>(null);
  const selectedItem = items.find((item) => item.id === selectedId);
  const currencyOf = (accountId: string) =>
    lookup.accounts.find((account) => account.id === accountId)?.currency ?? lookup.baseCurrency;

  useEffect(() => {
    if (providedLookup.tags !== undefined) return;
    let active = true;
    listTags({ data: {} }).then(
      (result) => {
        if (!active) return;
        if (result.ok) setTags(result.value);
        else toast({ tone: 'error', title: m.review_table_tags_failed() });
      },
      () => {
        if (active) toast({ tone: 'error', title: m.review_table_tags_failed() });
      },
    );
    return () => {
      active = false;
    };
  }, [providedLookup.tags]);

  /** Keep rows busy until both the mutation and the page refresh finish. */
  const run = async <T,>(
    ids: readonly string[],
    action: () => Promise<{ ok: true; value: T } | { ok: false; code: string }>,
    done: (value: T) => void,
  ) => {
    if (ids.some((id) => pending.current.has(id))) return;
    ids.forEach((id) => pending.current.add(id));
    setBusy(new Set(pending.current));
    try {
      const result = await action().catch(() => ({ ok: false, code: 'UNKNOWN' }) as const);
      if (!result.ok) {
        toast({ tone: 'error', title: ledgerErrorMessage(result.code, locale) });
        return;
      }
      done(result.value);
      setSelectedId(null);
      setSelectedRows((current) => new Set([...current].filter((id) => !ids.includes(id))));
      await router.invalidate().catch(() => {
        toast({ tone: 'error', title: m.review_load_failed() });
      });
    } finally {
      ids.forEach((id) => pending.current.delete(id));
      setBusy(new Set(pending.current));
    }
  };

  const confirmed = (title: string, amount: ReactNode) => {
    toast({
      tone: 'success',
      title: m.review_confirmed_title(),
      description: (
        <>
          {title}
          {amount === null ? null : <> · {amount}</>}
        </>
      ),
    });
  };

  const markUnpaid = (item: DraftItem) => {
    void run(
      [item.id],
      () => markReviewUnpaid({ data: { itemId: item.id } }),
      () => {
        toast({ tone: 'info', title: m.review_unpaid_title(), description: m.review_unpaid_description() });
      },
    );
  };

  const ignore = (ids: readonly string[]) => {
    void run(
      ids,
      () => ignoreReview({ data: { itemIds: [...ids] } }),
      ({ ignored }) => {
        toast({ tone: 'info', title: m.review_ignored({ count: ignored }) });
      },
    );
  };

  const confirmMany = (ids: readonly string[], categoryId?: string) => {
    void run(
      ids,
      () =>
        confirmReviewBulk({
          data: { itemIds: [...ids], ...(categoryId === undefined ? {} : { edits: { categoryId } }) },
        }),
      ({ confirmed: done, failed }) => {
        if (done.length > 0) toast({ tone: 'success', title: m.review_bulk_done({ count: done.length }) });
        const [first] = failed;
        if (first !== undefined) {
          toast({
            tone: 'error',
            title: m.review_bulk_failed({ count: failed.length }),
            description: ledgerErrorMessage(first.code, locale),
          });
        }
        setChoices((current) => new Map([...current].filter(([id]) => !done.includes(id))));
      },
    );
  };

  const applyProposal = (state: ApplyState) => {
    const { item } = state;
    const leftover = item.payload.kind === 'leftover' ? item.payload : null;
    const edits =
      leftover !== null && (leftover.fromAccountId === null || leftover.toAccountId === null)
        ? { fromAccountId: state.fromAccountId, toAccountId: state.toAccountId }
        : undefined;
    setApply(null);
    void run(
      [item.id],
      () => confirmReview({ data: { itemId: item.id, edits } }),
      () => {
        toast({ tone: 'success', title: m.review_applied_title() });
      },
    );
  };

  const billTotals = pendingTotals(groups.bills, currencyOf);
  const totalsOf = (totals: typeof billTotals) =>
    totals.map((total, index) => (
      <span key={total.currency}>
        {index > 0 ? ' + ' : null}
        <Money minor={total.amountMinor} currency={total.currency} context="amount" locale={locale} />
      </span>
    ));
  const bulkCategoryView = lookup.categories.find((category) => category.id === askBulkCategory);
  const categoryKinds = new Set(groups.categories.map((item) => item.subject?.type));
  const bulkKind =
    categoryKinds.size === 1 && categoryKinds.has('income')
      ? 'income'
      : categoryKinds.size === 1 && categoryKinds.has('expense')
        ? 'expense'
        : null;
  const leftoverAccountsMissing =
    apply !== null &&
    apply.item.payload.kind === 'leftover' &&
    (apply.item.payload.fromAccountId === null || apply.item.payload.toAccountId === null);

  const confirmDraft = (item: ReviewItemView, edits: ReviewEdits) => {
    void run(
      [item.id],
      () =>
        confirmReview({
          data: {
            itemId: item.id,
            edits: {
              ...edits,
              tags: edits.tags === undefined ? undefined : [...edits.tags],
              receiptItems: edits.receiptItems === undefined ? undefined : [...edits.receiptItems],
            },
          },
        }),
      ({ transactionId }) => {
        if (transactionId === null) return;
        if (item.payload.kind === 'gmail') {
          const accountId = edits.accountId ?? item.payload.extraction.accountId ?? '';
          announceSaved({
            id: transactionId,
            label: edits.description ?? '',
            amountMinor: -(edits.amountMinor ?? 0n),
            currency: currencyOf(accountId),
            accountName: lookup.accounts.find((account) => account.id === accountId)?.displayName,
            locale,
            onChange: () => {
              void router.invalidate();
            },
          });
        } else {
          confirmed(edits.description || item.label || m.review_untitled(), null);
        }
      },
    );
  };

  if (items.length === 0)
    return (
      <>
        <PageHeader breadcrumb={[m.breadcrumb_finance(), m.review_title()]} title={m.review_title()} />
        <EmptyState icon={Inbox} title={m.review_empty_title()} description={m.review_empty_description()} />
      </>
    );

  return (
    <>
      <PageHeader
        breadcrumb={[m.breadcrumb_finance(), m.review_title()]}
        title={m.review_title()}
        description={m.review_description({ count: items.length })}
      />
      {groups.categories.length < 2 || bulkKind === null ? null : (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-card p-3">
          <span className="text-[12.5px] text-muted-fg">
            {m.review_category_bulk({ count: groups.categories.length })}
          </span>
          <div className="min-w-[180px] flex-1">
            <BulkCategory
              kind={bulkKind}
              lookup={lookup}
              value={bulkCategory}
              onValueChange={setBulkCategory}
              label={m.review_category_bulk({ count: groups.categories.length })}
            />
          </div>
          <Button
            size="sm"
            disabled={bulkCategory === null || busy.size > 0}
            onClick={() => {
              setAskBulkCategory(bulkCategory);
            }}
          >
            {m.review_apply()}
          </Button>
        </div>
      )}
      <ReviewTable
        items={items}
        lookup={lookup}
        locale={locale}
        timeZone={timeZone}
        busy={busy}
        selected={selectedRows}
        onSelect={(ids, checked) => {
          setSelectedRows((current) => {
            const next = new Set(current);
            ids.forEach((id) => {
              if (checked) next.add(id);
              else next.delete(id);
            });
            return next;
          });
        }}
        onOpen={setSelectedId}
        onIgnore={ignore}
        actions={
          groups.bills.length === 0 ? null : (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy.size > 0}
              onClick={() => {
                setAskPayAll(true);
              }}
            >
              {m.review_bills_pay_all()}
            </Button>
          )
        }
      />
      <Sheet
        open={selectedItem !== undefined}
        onOpenChange={(open) => {
          if (!open && (selectedItem === undefined || !busy.has(selectedItem.id))) setSelectedId(null);
        }}
        title={m.review_table_detail_title()}
        description={m.review_table_detail_hint()}
        closeLabel={m.transactions_detail_close()}
        size="lg"
      >
        {selectedItem === undefined ? null : (
          <div key={selectedItem.id} className="flex min-w-0 flex-col gap-4">
            {selectedItem.payload.kind === 'gmail' ? (
              <GmailReviewCard
                item={selectedItem as GmailReviewItem}
                lookup={lookup}
                locale={locale}
                timeZone={timeZone}
                today={today}
                pending={busy.has(selectedItem.id)}
                onCancel={() => {
                  setSelectedId(null);
                }}
                onConfirm={(edits) => {
                  confirmDraft(selectedItem, edits);
                }}
                onIgnore={() => {
                  ignore([selectedItem.id]);
                }}
              />
            ) : selectedItem.payload.kind === 'transaction' ? (
              <ReviewDraftEditor
                item={selectedItem as DraftItem}
                lookup={lookup}
                locale={locale}
                timeZone={timeZone}
                today={today}
                pending={busy.has(selectedItem.id)}
                onCancel={() => {
                  setSelectedId(null);
                }}
                onConfirm={(edits) => {
                  confirmDraft(selectedItem, edits);
                }}
                onIgnore={() => {
                  ignore([selectedItem.id]);
                }}
                onUnpaid={
                  selectedItem.occurrence === null
                    ? undefined
                    : () => {
                        markUnpaid(selectedItem as DraftItem);
                      }
                }
              />
            ) : selectedItem.payload.kind === 'category' ? (
              <>
                <CategoryRow
                  item={selectedItem as CategoryItem}
                  lookup={lookup}
                  locale={locale}
                  timeZone={timeZone}
                  value={choices.get(selectedItem.id) ?? null}
                  onValueChange={(id) => {
                    setChoices((current) => new Map(current).set(selectedItem.id, id));
                  }}
                  onIgnore={() => {
                    ignore([selectedItem.id]);
                  }}
                />
                <Button
                  pending={busy.has(selectedItem.id)}
                  disabled={selectedItem.subject === null || !choices.has(selectedItem.id)}
                  onClick={() => {
                    const categoryId = choices.get(selectedItem.id);
                    if (categoryId !== undefined)
                      void run(
                        [selectedItem.id],
                        () => confirmReview({ data: { itemId: selectedItem.id, edits: { categoryId } } }),
                        () => toast({ tone: 'success', title: m.review_confirmed_title() }),
                      );
                  }}
                >
                  {m.review_confirm()}
                </Button>
              </>
            ) : (
              <CloseCard
                item={selectedItem as CloseItem}
                lookup={lookup}
                locale={locale}
                pending={busy.has(selectedItem.id)}
                onIgnore={() => {
                  ignore([selectedItem.id]);
                }}
                onApply={() => {
                  setApply({
                    item: selectedItem as CloseItem,
                    fromAccountId:
                      selectedItem.payload.kind === 'leftover' ? (selectedItem.payload.fromAccountId ?? '') : '',
                    toAccountId:
                      selectedItem.payload.kind === 'leftover' ? (selectedItem.payload.toAccountId ?? '') : '',
                  });
                  setSelectedId(null);
                }}
              />
            )}
          </div>
        )}
      </Sheet>
      <Modal
        open={askPayAll}
        onOpenChange={setAskPayAll}
        title={m.review_bills_pay_all_title({ count: groups.bills.length })}
        description={m.review_bills_pay_all_description()}
      >
        <p className="text-[13px] text-fg">
          {m.review_bills_total()} {totalsOf(billTotals)}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setAskPayAll(false);
            }}
          >
            {m.review_cancel()}
          </Button>
          <Button
            onClick={() => {
              setAskPayAll(false);
              confirmMany(groups.bills.map((item) => item.id));
            }}
          >
            {m.review_bills_pay_all_confirm()}
          </Button>
        </div>
      </Modal>

      <Modal
        open={askBulkCategory !== null}
        onOpenChange={() => {
          setAskBulkCategory(null);
        }}
        title={m.review_category_bulk_title({
          category: bulkCategoryView === undefined ? '' : categoryName(bulkCategoryView),
          count: groups.categories.length,
        })}
        description={m.review_category_bulk_description()}
      >
        {askBulkCategory === null ? null : (
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setAskBulkCategory(null);
              }}
            >
              {m.review_cancel()}
            </Button>
            <Button
              onClick={() => {
                setAskBulkCategory(null);
                confirmMany(
                  groups.categories.map((item) => item.id),
                  askBulkCategory,
                );
              }}
            >
              {m.review_apply()}
            </Button>
          </div>
        )}
      </Modal>

      <Modal
        open={apply !== null}
        onOpenChange={() => {
          setApply(null);
        }}
        title={m.review_apply_title()}
        description={m.review_apply_description()}
      >
        {apply === null ? null : (
          <>
            <CloseSummary item={apply.item} lookup={lookup} locale={locale} />
            {leftoverAccountsMissing ? (
              <div className="grid grid-cols-2 gap-3">
                <AccountChoice
                  label={m.review_apply_from()}
                  value={apply.fromAccountId}
                  lookup={lookup}
                  locale={locale}
                  onChange={(fromAccountId) => {
                    setApply({ ...apply, fromAccountId });
                  }}
                />
                <AccountChoice
                  label={m.review_apply_to()}
                  value={apply.toAccountId}
                  lookup={lookup}
                  locale={locale}
                  onChange={(toAccountId) => {
                    setApply({ ...apply, toAccountId });
                  }}
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setApply(null);
                }}
              >
                {m.review_cancel()}
              </Button>
              <Button
                disabled={
                  leftoverAccountsMissing &&
                  (apply.fromAccountId === '' || apply.toAccountId === '' || apply.fromAccountId === apply.toAccountId)
                }
                onClick={() => {
                  applyProposal(apply);
                }}
              >
                {m.review_confirm()}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
/** "Set kategori untuk semua": one category for every row (expense categories; the design's rows are expenses). */
function BulkCategory({
  kind,
  lookup,
  value,
  onValueChange,
  label,
}: {
  kind: 'expense' | 'income';
  lookup: ReviewLookup;
  value: string | null;
  onValueChange: (id: string) => void;
  label: string;
}) {
  return (
    <CategorySelect
      categories={lookup.categories}
      kind={kind}
      value={value}
      onValueChange={onValueChange}
      label={label}
      searchPlaceholder={m.category_picker_search()}
      placeholder={m.review_category_pick()}
      aria-label={label}
      className="h-8 flex-1 rounded-[7px] px-2.5 text-[12.5px]"
    />
  );
}

function AccountChoice({
  label,
  value,
  lookup,
  locale,
  onChange,
}: {
  label: string;
  value: string;
  lookup: ReviewLookup;
  locale: Locale;
  onChange: (id: string) => void;
}) {
  return (
    <Field label={label}>
      {({ id }) => (
        <AccountPicker
          accounts={lookup.accounts}
          value={value === '' ? null : value}
          onValueChange={onChange}
          label={label}
          searchPlaceholder={m.record_account_search()}
          locale={locale}
        >
          <AccountTrigger
            id={id}
            account={lookup.accounts.find((account) => account.id === value)}
            placeholder={m.record_account_placeholder()}
          />
        </AccountPicker>
      )}
    </Field>
  );
}

/** What "Konfirmasi" will do, in the apply dialog. */
function CloseSummary({ item, lookup, locale }: { item: CloseItem; lookup: ReviewLookup; locale: Locale }) {
  const { payload } = item;
  const account = (id: string | null) => lookup.accounts.find((candidate) => candidate.id === id);
  if (payload.kind === 'leftover') {
    const from = account(payload.fromAccountId);
    const to = account(payload.toAccountId);
    return (
      <p className="rounded-[10px] border border-border p-3 text-[13px] text-text-secondary">
        {m.review_apply_leftover({
          goal: item.label ?? '',
          from: from?.displayName ?? '…',
          to: to?.displayName ?? '…',
        })}{' '}
        <Money
          minor={payload.amountMinor}
          currency={from?.currency ?? lookup.baseCurrency}
          context="amount"
          locale={locale}
          className="text-fg"
        />
      </p>
    );
  }
  const category = lookup.categories.find((candidate) => candidate.id === payload.categoryId);
  return (
    <p className="rounded-[10px] border border-border p-3 text-[13px] text-text-secondary">
      {m.review_apply_rollover({ category: category === undefined ? '' : categoryName(category) })}{' '}
      <Money minor={payload.deltaMinor} currency={lookup.baseCurrency} context="amount" locale={locale} />
    </p>
  );
}
