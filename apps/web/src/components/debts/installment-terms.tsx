// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The terms of a card installment (FR-U2, design `PxFzg`/`EVtxs` and `nYruD`): the tenor (3/6/12/24 bulan), the
 * monthly interest, the admin fee, and the resulting schedule ("1/3 · tagihan 20 Nov · 1.000.000"). Shared by "Ubah
 * jadi cicilan" and the Record sheet's "Pecah jadi cicilan".
 */
import { INSTALLMENT_TENORS, type InstallmentTenor } from '@wf/domain/creditcard';
import type { Installment } from '@wf/domain/debt';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { parseRateBps, type CardInstallmentTerms } from '../../lib/debts.ts';
import { Field, INPUT_FRAME } from '../form.tsx';

/** The terms as typed. */
export interface InstallmentTermsValue {
  readonly tenor: InstallmentTenor;
  /** "Bunga … % per bulan" as typed (`1,75`). */
  readonly rate: string;
  readonly adminFeeMinor: bigint | null;
}

export const DEFAULT_TERMS: InstallmentTermsValue = { tenor: 3, rate: '0', adminFeeMinor: 0n };

/** The terms the server takes, or `null` while the interest is not a number. */
export function parseTerms(value: InstallmentTermsValue): CardInstallmentTerms | null {
  const monthlyRateBps = parseRateBps(value.rate);
  return monthlyRateBps === null
    ? null
    : { tenor: value.tenor, monthlyRateBps, adminFeeMinor: value.adminFeeMinor ?? 0n };
}

/** Schedule rows shown before "+N lagi". */
const SHOWN_ROWS = 3;

export interface InstallmentTermsProps {
  readonly value: InstallmentTermsValue;
  readonly onChange: (value: InstallmentTermsValue) => void;
  /** The schedule of these terms; `null` hides it. */
  readonly schedule: readonly Installment[] | null;
  readonly currency: string;
  readonly locale: Locale;
  readonly disabled?: boolean;
}

export function InstallmentTerms({
  value,
  onChange,
  schedule,
  currency,
  locale,
  disabled = false,
}: InstallmentTermsProps) {
  const set = (patch: Partial<InstallmentTermsValue>) => {
    onChange({ ...value, ...patch });
  };
  const rateInvalid = parseRateBps(value.rate) === null;
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        label={m.debts_terms_tenor()}
        fill
        value={String(value.tenor)}
        onValueChange={(tenor) => {
          set({ tenor: Number(tenor) as InstallmentTenor });
        }}
        options={INSTALLMENT_TENORS.map((tenor) => ({
          value: String(tenor),
          label: m.debts_terms_months({ count: tenor }),
          disabled,
        }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.debts_terms_interest()} error={rateInvalid ? m.debts_terms_interest_invalid() : null}>
          {({ id, describedBy, invalid }) => (
            <span className={`${INPUT_FRAME.lg} flex items-center gap-2`}>
              <input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                inputMode="decimal"
                disabled={disabled}
                value={value.rate}
                onChange={(event) => {
                  set({ rate: event.target.value });
                }}
                className="w-full min-w-0 bg-transparent font-mono text-[14px] text-fg outline-none disabled:text-text-disabled"
              />
              <span className="shrink-0 text-[12.5px] text-subtle">{m.debts_terms_per_month()}</span>
            </span>
          )}
        </Field>
        <Field label={m.debts_terms_admin_fee()}>
          {({ id, describedBy }) => (
            <span className={`${INPUT_FRAME.lg} flex items-center gap-2`}>
              <AmountInput
                id={id}
                aria-describedby={describedBy}
                size="inline"
                disabled={disabled}
                value={value.adminFeeMinor}
                onValueChange={(adminFeeMinor) => {
                  set({ adminFeeMinor });
                }}
                currency={currency}
                locale={locale}
              />
            </span>
          )}
        </Field>
      </div>
      {schedule === null ? null : (
        <ol aria-label={m.debts_terms_schedule()} className="grid grid-cols-3 gap-2">
          {schedule.slice(0, SHOWN_ROWS).map((row) => (
            <li
              key={row.number}
              className="flex flex-col gap-0.5 rounded-[8px] border border-border bg-surface-2 px-2.5 py-2"
            >
              <span className="text-[11.5px] text-subtle">
                {m.debts_terms_row({
                  number: row.number,
                  count: schedule.length,
                  date: formatDate(row.dueOn, locale, 'day'),
                })}
              </span>
              <Money
                minor={row.totalMinor}
                currency={currency}
                context="table"
                locale={locale}
                className="text-left! text-[13px] text-fg"
              />
            </li>
          ))}
          {schedule.length > SHOWN_ROWS ? (
            <li className="col-span-3 text-[11.5px] text-subtle">
              {m.debts_terms_more({ count: schedule.length - SHOWN_ROWS })}
            </li>
          ) : null}
        </ol>
      )}
    </div>
  );
}
