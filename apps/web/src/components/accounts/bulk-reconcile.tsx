// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Sesuaikan beberapa rekening" (FR-R4 bulk, design `F6sIL`): every active account, the longest unchecked first, with
 * an "actual balance" field per row. Rows left empty are skipped; each filled row's difference is recorded as a
 * transaction today in the row's category (uncategorized when none is picked).
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { DateLabel } from '@wf/ui/date-label';
import { toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Select } from '@wf/ui/select';
import { toast } from '@wf/ui/toast';
import { useState } from 'react';
import { byCheckAge, DEFAULT_SHORTFALL_CATEGORY, differenceCategories, STALE_AFTER_DAYS } from '../../lib/accounts.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import { reconcileAccounts } from '../../server/fn/accounts.ts';
import { Button, FormError, INPUT_FRAME } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { AccountLogo } from './account-logo.tsx';

export interface BulkReconcileDialogProps {
  /** The user's active accounts. */
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
  readonly baseCurrency: string;
  readonly timeZone: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDone: () => void;
}

interface Row {
  readonly actual: bigint | null;
  readonly categoryId: string | null;
  /** Makes a retried save idempotent. */
  readonly clientId: string;
}

export function BulkReconcileDialog({
  accounts,
  categories,
  baseCurrency,
  timeZone,
  onOpenChange,
  onDone,
}: BulkReconcileDialogProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [today] = useState(() => toLocalDate(new Date(), timeZone));
  const [rows, setRows] = useState<Readonly<Record<string, Row>>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ordered = byCheckAge(accounts, today, timeZone);

  const filled = ordered.flatMap(({ account }) => {
    const row = rows[account.id];
    if (row?.actual == null) return [];
    const difference = row.actual - account.balanceMinor;
    const options = differenceCategories(categories, difference);
    const fallback =
      difference < 0n ? (options.find((c) => c.builtInKey === DEFAULT_SHORTFALL_CATEGORY)?.id ?? null) : null;
    const categoryId = options.some((c) => c.id === row.categoryId) ? row.categoryId : fallback;
    return [{ account, actual: row.actual, difference, options, categoryId, clientId: row.clientId }];
  });
  const byId = new Map(filled.map((row) => [row.account.id, row]));
  // The total is only meaningful within one currency: the base currency rows.
  const total = filled
    .filter((row) => row.account.currency === baseCurrency)
    .reduce((sum, row) => sum + row.difference, 0n);

  const update = (id: string, patch: Partial<Row>) => {
    setRows((current) => ({
      ...current,
      [id]: { actual: null, categoryId: null, clientId: crypto.randomUUID(), ...current[id], ...patch },
    }));
  };

  const submit = async () => {
    setPending(true);
    setFailure(null);
    const result = await reconcileAccounts({
      data: {
        occurredAt: new Date(),
        items: filled.map((row) => ({
          id: row.account.id,
          actualBalanceMinor: row.actual,
          categoryId: row.categoryId,
          clientId: row.clientId,
        })),
      },
    });
    setPending(false);
    if (!result.ok) {
      setFailure(ledgerErrorMessage(result.code, locale));
      return;
    }
    toast({ title: m.accounts_bulk_done({ count: filled.length }) });
    onDone();
  };

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      size="xl"
      title={filled.length === 0 ? m.accounts_bulk_title_empty() : m.accounts_bulk_title({ count: filled.length })}
      description={m.accounts_bulk_description()}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-[1fr_110px_140px] gap-3 px-1 text-[11.5px] text-subtle">
          <span />
          <span className="text-right">{m.accounts_bulk_recorded()}</span>
          <span>{m.accounts_bulk_actual()}</span>
        </div>
        <ul className="flex max-h-[50dvh] flex-col divide-y divide-border overflow-y-auto rounded-[10px] border border-border">
          {ordered.map(({ account, days }) => {
            const row = byId.get(account.id);
            return (
              <li key={account.id} className="flex flex-col gap-2 px-3 py-2.5">
                <div className="grid grid-cols-[1fr_110px_140px] items-center gap-3">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <AccountLogo account={account} size="sm" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] text-fg">{account.displayName}</span>
                      <span className={`text-[11px] ${days > STALE_AFTER_DAYS ? 'text-amber-fg' : 'text-subtle'}`}>
                        {m.accounts_checked_days_ago({ days })}
                      </span>
                    </span>
                  </span>
                  <Money
                    minor={account.balanceMinor}
                    currency={account.currency}
                    context="table"
                    locale={locale}
                    className="text-[12.5px] text-muted-fg"
                  />
                  <div className={INPUT_FRAME.sm}>
                    <AmountInput
                      aria-label={m.accounts_bulk_actual_for({ name: account.displayName })}
                      size="inline"
                      value={rows[account.id]?.actual ?? null}
                      onValueChange={(actual) => {
                        update(account.id, { actual });
                      }}
                      currency={account.currency}
                      locale={locale}
                    />
                  </div>
                </div>
                {row === undefined || row.difference === 0n ? null : (
                  <div className="grid grid-cols-[1fr_250px] items-center gap-3 pl-8">
                    <Money
                      minor={row.difference}
                      currency={account.currency}
                      context="delta"
                      locale={locale}
                      className="text-[12px]"
                    />
                    <Select
                      aria-label={m.accounts_bulk_category_for({ name: account.displayName })}
                      size="sm"
                      value={row.categoryId}
                      onValueChange={(categoryId) => {
                        update(account.id, { categoryId });
                      }}
                      placeholder={m.accounts_bulk_uncategorized()}
                      options={row.options.map((category) => ({ value: category.id, label: categoryName(category) }))}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {failure === null ? null : <FormError>{failure}</FormError>}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <span className="flex flex-col text-[12px] text-subtle">
            <span>
              {m.accounts_bulk_footer()} <DateLabel date={today} locale={locale} format="day" />
            </span>
            {filled.length === 0 ? null : (
              <span>
                {m.accounts_bulk_total()}{' '}
                <Money minor={total} currency={baseCurrency} context="amount" locale={locale} />
              </span>
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
            <Button type="submit" size="sm" pending={pending} disabled={filled.length === 0}>
              {m.accounts_reconcile_submit()}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
