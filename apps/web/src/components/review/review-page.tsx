// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/review` "Perlu ditinjau" (FR-L7, design `N4J73r`, `Ju8vG`, `dIS46`, `yNnG3`): every pending proposal in the
 * design's panels — AI results with their confidence, transactions whose category was deleted (one category for all
 * or per row), subscription bills ("Belum" / "Sudah dibayar", "Tandai semua dibayar"), recurring schedules ("Ubah
 * nominal", "Sudah ditransfer"), and period-close proposals ("Terapkan" / "Abaikan"). Nothing changes balances or
 * budgets until the user confirms; every bulk confirmation and every proposal asks once more in a dialog.
 */
import { useRouter } from '@tanstack/react-router';
import type { ReviewItemView } from '@wf/db/review';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { formatMonth } from '@wf/ui/dates';
import { EmptyState } from '@wf/ui/empty-state';
import { Money } from '@wf/ui/money';
import { toast } from '@wf/ui/toast';
import { CalendarClock, Inbox, Info, Repeat, Sparkles, Tag, Undo2, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { confirmReview, confirmReviewBulk, ignoreReview, markReviewUnpaid } from '../../server/fn/review.ts';
import { Button, Select } from '../form.tsx';
import { announceSaved } from '../ledger/announce-saved.tsx';
import { Modal } from '../modal.tsx';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { AiCard, BillCard, CategoryRow, CloseCard, type ReviewLookup } from './review-cards.tsx';
import { draftAmount, groupReviewItems, pendingTotals, type CloseItem, type DraftItem } from './review-model.ts';
import { GmailReviewCard } from './gmail-review-card.tsx';

export interface ReviewPageProps {
  readonly items: readonly ReviewItemView[];
  readonly lookup: ReviewLookup;
  readonly timeZone: string;
  readonly today: LocalDate;
  /** `?item=`: the card ⌘K opened, scrolled into view with its first action focused. */
  readonly focusItem?: string | undefined;
}

/** One of the design's panels: icon, "title · count", subtitle, an optional info banner, cards, and a footer. */
function Panel({
  icon: Icon,
  title,
  count,
  subtitle,
  banner,
  footer,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  subtitle: string;
  banner?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id} ${id}-sub`} className="flex flex-col rounded-[12px] border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-[8px] bg-amber-tint-1 text-amber-fg"
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 id={id} className="text-[14px] font-semibold text-fg">
            {title} · {count}
          </h2>
          <p id={`${id}-sub`} className="text-[12.5px] text-muted-fg">
            {subtitle}
          </p>
        </div>
      </header>
      {banner === undefined ? null : (
        <p className="flex items-start gap-2 border-b border-border px-4 py-2.5 text-[12.5px] text-text-secondary">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-fg" />
          {banner}
        </p>
      )}
      <div className="flex flex-col gap-3 p-4">{children}</div>
      {footer === undefined ? null : (
        <footer className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 text-[12.5px] text-muted-fg">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** "Terapkan" on a period-close proposal: what it does, and the accounts when the proposal has none. */
interface ApplyState {
  readonly item: CloseItem;
  readonly fromAccountId: string;
  readonly toAccountId: string;
}

export function ReviewPage({ items, lookup, timeZone, today, focusItem }: ReviewPageProps) {
  const router = useRouter();
  const { locale } = usePreferences().preferences;
  const groups = groupReviewItems(items);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [choices, setChoices] = useState<ReadonlyMap<string, string>>(new Map());
  const [bulkCategory, setBulkCategory] = useState<string | null>(null);
  /** "Terapkan" of "Set kategori untuk semua": the category the dialog asks about. */
  const [askBulkCategory, setAskBulkCategory] = useState<string | null>(null);
  const [askPayAll, setAskPayAll] = useState(false);
  const [apply, setApply] = useState<ApplyState | null>(null);
  const currencyOf = (accountId: string) =>
    lookup.accounts.find((account) => account.id === accountId)?.currency ?? lookup.baseCurrency;

  useEffect(() => {
    if (focusItem === undefined) return;
    const card = document.querySelector(`[data-review-item="${CSS.escape(focusItem)}"]`);
    card?.scrollIntoView({ block: 'center' });
    card?.querySelector<HTMLElement>('button')?.focus();
  }, [focusItem]);

  /** Runs one change for `ids`, marking them busy; refreshes the page (and the nav badge) after it. */
  const run = async <T,>(
    ids: readonly string[],
    action: () => Promise<{ ok: true; value: T } | { ok: false; code: string }>,
    done: (value: T) => void,
  ) => {
    setBusy((current) => new Set([...current, ...ids]));
    const result = await action().catch(() => ({ ok: false, code: 'UNKNOWN' }) as const);
    setBusy((current) => new Set([...current].filter((id) => !ids.includes(id))));
    if (!result.ok) {
      toast({ tone: 'error', title: ledgerErrorMessage(result.code, locale) });
      return;
    }
    done(result.value);
    await router.invalidate();
  };

  const confirmed = (title: string, amount: ReactNode) => {
    toast({
      tone: 'success',
      title: m.review_confirmed_title(),
      description: (
        <>
          {title} · {amount}
        </>
      ),
    });
  };

  const payBill = (item: DraftItem, amountMinor: bigint | null) => {
    const { accountId, amountMinor: proposed } = draftAmount(item.payload.draft);
    const outgoing = item.payload.draft.type !== 'income';
    const amount = amountMinor ?? proposed;
    void run(
      [item.id],
      () => confirmReview({ data: { itemId: item.id, edits: amountMinor === null ? undefined : { amountMinor } } }),
      () => {
        confirmed(
          item.label ?? '',
          <Money
            minor={outgoing ? -amount : amount}
            currency={currencyOf(accountId)}
            context="amount"
            locale={locale}
          />,
        );
      },
    );
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

  /** "Simpan": every row given a category, each confirmed with its own. */
  const saveCategories = () => {
    const chosen = [...choices].filter(([id]) => groups.categories.some((item) => item.id === id));
    void run(
      chosen.map(([id]) => id),
      async () => {
        const results = await Promise.all(
          chosen.map(([itemId, categoryId]) => confirmReview({ data: { itemId, edits: { categoryId } } })),
        );
        const failed = results.find((result) => !result.ok);
        return failed ?? { ok: true as const, value: results.length };
      },
      (count) => {
        toast({ tone: 'success', title: m.review_bulk_done({ count }) });
        setChoices(new Map());
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

  if (items.length === 0) {
    return (
      <>
        <PageHeader breadcrumb={[m.breadcrumb_finance(), m.review_title()]} title={m.review_title()} />
        <EmptyState icon={Inbox} title={m.review_empty_title()} description={m.review_empty_description()} />
      </>
    );
  }

  const billTotals = pendingTotals(groups.bills, currencyOf);
  const recurringTotals = pendingTotals(groups.recurring, currencyOf);
  const totalsOf = (totals: typeof billTotals) =>
    totals.map((total, index) => (
      <span key={total.currency}>
        {index > 0 ? ' + ' : null}
        <Money minor={total.amountMinor} currency={total.currency} context="amount" locale={locale} />
      </span>
    ));
  const previousNames = [...new Set(groups.categories.map((item) => item.payload.previousCategoryName))];
  const [previousName] = previousNames;
  const chosenCount = groups.categories.filter((item) => choices.has(item.id)).length;
  const bulkCategoryView = lookup.categories.find((category) => category.id === askBulkCategory);
  const periods = [...new Set(groups.closing.flatMap((item) => (item.periodLabel === null ? [] : [item.periodLabel])))];
  const leftoverAccountsMissing =
    apply !== null &&
    apply.item.payload.kind === 'leftover' &&
    (apply.item.payload.fromAccountId === null || apply.item.payload.toAccountId === null);

  return (
    <>
      <PageHeader
        breadcrumb={[m.breadcrumb_finance(), m.review_title()]}
        title={m.review_title()}
        description={m.review_description({ count: items.length })}
      />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {groups.gmail.length === 0 ? null : (
          <Panel
            icon={Sparkles}
            title={m.review_source_gmail()}
            count={groups.gmail.length}
            subtitle={m.review_ai_subtitle()}
            footer={<span>{m.review_ai_footer()}</span>}
          >
            {groups.gmail.map((item) => (
              <GmailReviewCard
                key={item.id}
                item={item}
                lookup={lookup}
                locale={locale}
                timeZone={timeZone}
                pending={busy.has(item.id)}
                onConfirm={(edits) => {
                  void run(
                    [item.id],
                    () => confirmReview({ data: { itemId: item.id, edits } }),
                    ({ transactionId }) => {
                      if (transactionId === null) return;
                      announceSaved({
                        id: transactionId,
                        label: edits.merchant ?? item.payload.subject,
                        amountMinor: -edits.amountMinor,
                        currency: currencyOf(edits.accountId),
                        accountName: lookup.accounts.find((account) => account.id === edits.accountId)?.displayName,
                        locale,
                        onChange: () => {
                          void router.invalidate();
                        },
                      });
                    },
                  );
                }}
                onIgnore={() => {
                  ignore([item.id]);
                }}
              />
            ))}
          </Panel>
        )}
        {groups.ai.length === 0 ? null : (
          <Panel
            icon={Sparkles}
            title={m.review_title()}
            count={groups.ai.length}
            subtitle={m.review_ai_subtitle()}
            footer={<span>{m.review_ai_footer()}</span>}
          >
            {groups.ai.map((item) => (
              <AiCard
                key={item.id}
                item={item}
                lookup={lookup}
                locale={locale}
                timeZone={timeZone}
                pending={busy.has(item.id)}
                onRecord={() => {
                  const { accountId, amountMinor } = draftAmount(item.payload.draft);
                  void run(
                    [item.id],
                    () => confirmReview({ data: { itemId: item.id } }),
                    () => {
                      confirmed(
                        item.label ?? '',
                        <Money minor={amountMinor} currency={currencyOf(accountId)} context="amount" locale={locale} />,
                      );
                    },
                  );
                }}
                onIgnore={() => {
                  ignore([item.id]);
                }}
              />
            ))}
          </Panel>
        )}

        {groups.categories.length === 0 ? null : (
          <Panel
            icon={Tag}
            title={m.review_category_heading()}
            count={groups.categories.length}
            subtitle={
              previousNames.length === 1 && previousName !== undefined
                ? m.review_category_subtitle({ category: previousName })
                : m.review_category_subtitle_many()
            }
            footer={
              <>
                <span className="flex-1">
                  {m.review_category_progress({ done: chosenCount, count: groups.categories.length })}
                </span>
                <Button size="sm" disabled={chosenCount === 0} onClick={saveCategories}>
                  {m.review_save()}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
              <span className="text-[12.5px] font-medium text-muted-fg">
                {m.review_category_bulk({ count: groups.categories.length })}
              </span>
              <div className="flex gap-2">
                <BulkCategory
                  lookup={lookup}
                  value={bulkCategory}
                  onValueChange={setBulkCategory}
                  label={m.review_category_bulk({ count: groups.categories.length })}
                />
                <Button
                  size="sm"
                  disabled={bulkCategory === null}
                  onClick={() => {
                    setAskBulkCategory(bulkCategory);
                  }}
                >
                  {m.review_apply()}
                </Button>
              </div>
            </div>
            {groups.categories.map((item) => (
              <CategoryRow
                key={item.id}
                item={item}
                lookup={lookup}
                locale={locale}
                timeZone={timeZone}
                value={choices.get(item.id) ?? null}
                onValueChange={(categoryId) => {
                  setChoices((current) => new Map(current).set(item.id, categoryId));
                }}
                onIgnore={() => {
                  ignore([item.id]);
                }}
              />
            ))}
          </Panel>
        )}

        {groups.bills.length === 0 ? null : (
          <Panel
            icon={CalendarClock}
            title={m.review_title()}
            count={groups.bills.length}
            subtitle={m.review_bills_subtitle()}
            banner={m.review_bills_banner()}
            footer={
              <>
                <span className="flex-1">
                  {m.review_bills_total()} {totalsOf(billTotals)}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setAskPayAll(true);
                  }}
                >
                  {m.review_bills_pay_all()}
                </Button>
              </>
            }
          >
            {groups.bills.map((item) => (
              <BillCard
                key={item.id}
                item={item}
                lookup={lookup}
                locale={locale}
                today={today}
                editableAmount={false}
                pending={busy.has(item.id)}
                onPaid={(amountMinor) => {
                  payBill(item, amountMinor);
                }}
                onUnpaid={() => {
                  markUnpaid(item);
                }}
              />
            ))}
          </Panel>
        )}

        {groups.recurring.length === 0 ? null : (
          <Panel
            icon={Repeat}
            title={m.review_title()}
            count={groups.recurring.length}
            subtitle={m.review_recurring_subtitle()}
            banner={m.review_recurring_banner()}
            footer={
              <span>
                {totalsOf(recurringTotals)} {m.review_recurring_waiting()}
              </span>
            }
          >
            {groups.recurring.map((item) => (
              <BillCard
                key={item.id}
                item={item}
                lookup={lookup}
                locale={locale}
                today={today}
                editableAmount
                pending={busy.has(item.id)}
                onPaid={(amountMinor) => {
                  payBill(item, amountMinor);
                }}
                onUnpaid={() => {
                  markUnpaid(item);
                }}
              />
            ))}
          </Panel>
        )}

        {groups.closing.length === 0 ? null : (
          <Panel
            icon={Undo2}
            title={m.review_close_heading()}
            count={groups.closing.length}
            subtitle={
              periods.length === 1 && periods[0] !== undefined
                ? m.review_close_subtitle({ period: formatMonth(`${periods[0]}-01` as LocalDate, locale) })
                : m.review_close_subtitle_many()
            }
            banner={m.review_close_banner()}
          >
            {groups.closing.map((item) => (
              <CloseCard
                key={item.id}
                item={item}
                lookup={lookup}
                locale={locale}
                pending={busy.has(item.id)}
                onApply={() => {
                  const payload = item.payload;
                  const [first] = lookup.accounts.filter((account) => account.archivedAt === null);
                  setApply({
                    item,
                    fromAccountId: payload.kind === 'leftover' ? (payload.fromAccountId ?? first?.id ?? '') : '',
                    toAccountId: payload.kind === 'leftover' ? (payload.toAccountId ?? first?.id ?? '') : '',
                  });
                }}
                onIgnore={() => {
                  ignore([item.id]);
                }}
              />
            ))}
          </Panel>
        )}
      </div>

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
                  onChange={(fromAccountId) => {
                    setApply({ ...apply, fromAccountId });
                  }}
                />
                <AccountChoice
                  label={m.review_apply_to()}
                  value={apply.toAccountId}
                  lookup={lookup}
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
                disabled={leftoverAccountsMissing && apply.fromAccountId === apply.toAccountId}
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
  lookup,
  value,
  onValueChange,
  label,
}: {
  lookup: ReviewLookup;
  value: string | null;
  onValueChange: (id: string) => void;
  label: string;
}) {
  const options = lookup.categories.filter((category) => category.kind === 'expense' && category.archivedAt === null);
  return (
    <Select
      size="sm"
      aria-label={label}
      value={value ?? ''}
      onChange={(event) => {
        onValueChange(event.currentTarget.value);
      }}
      className="flex-1"
    >
      <option value="" disabled>
        {m.review_category_pick()}
      </option>
      {options.map((category) => (
        <option key={category.id} value={category.id}>
          {categoryName(category)}
        </option>
      ))}
    </Select>
  );
}

function AccountChoice({
  label,
  value,
  lookup,
  onChange,
}: {
  label: string;
  value: string;
  lookup: ReviewLookup;
  onChange: (id: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted-fg">
        {label}
      </label>
      <Select
        id={id}
        size="sm"
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      >
        {lookup.accounts
          .filter((account) => account.archivedAt === null)
          .map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName}
            </option>
          ))}
      </Select>
    </div>
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
