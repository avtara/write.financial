// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The account form (FR-R1–R3, design `C016z`/`BSYfj`/`rmT6r`/`RcdFp`/`FkWkq` add, `a7r2RK` edit): type-specific
 * fields, provider and display name, currency, opening balance and date, color, the FR-R2 flags, an optional
 * uploaded logo, and a live card preview. It saves through the server functions itself and reports the saved
 * account, so the add/edit dialogs and onboarding share it. Editing an account with transactions keeps the
 * currency and opening balance locked (FR-R3; the server enforces it too).
 */
import type { AccountView } from '@wf/db/accounts';
import { getCatalogRecord } from '@wf/domain/catalog';
import type { AccountType } from '@wf/domain/ledger';
import { ACCOUNT_TYPES } from '@wf/domain/ledger';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Combobox } from '@wf/ui/command';
import { DatePicker } from '@wf/ui/date-picker';
import { Money } from '@wf/ui/money';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { Switch } from '@wf/ui/switch';
import { ChevronsUpDown, Lock, Upload } from 'lucide-react';
import { useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import { maskPhone } from '../../lib/accounts.ts';
import { colorProps, HEX_COLOR, isColorToken, PALETTE_COLORS } from '../../lib/colors.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { accountTypeLabel } from '../../lib/ledger-labels.ts';
import {
  createAccount,
  removeAccountLogo,
  setAccountLogo,
  updateAccount,
  type AccountFields,
} from '../../server/fn/accounts.ts';
import { Button, Field, FormError, INPUT_FRAME, Select, TextInput } from '../form.tsx';
import { CatalogInput } from '../catalog-input.tsx';
import { usePreferences } from '../preferences.tsx';
import { ACCOUNT_TYPE_ICONS, AccountLogo } from './account-logo.tsx';

/** What the provider field is called per type ("Nama bank / penyedia", "Penerbit", …); cash has none. */
const PROVIDER_LABEL: Readonly<Record<Exclude<AccountType, 'cash'>, () => string>> = {
  bank: m.accounts_form_provider_bank,
  ewallet: m.accounts_form_provider_ewallet,
  investment: m.accounts_form_provider_investment,
  credit_card: m.accounts_form_provider_credit_card,
};

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** The editable state of the form. Amounts are `null` while the input is empty or unreadable. */
export interface AccountDraft {
  readonly type: AccountType;
  readonly providerName: string;
  readonly catalogId: string | null;
  readonly displayName: string;
  readonly last4: string;
  /** A newly typed phone number; empty keeps the stored masked one. */
  readonly phone: string;
  readonly currency: string;
  /** For credit cards: the current bill (stored negated). */
  readonly openingMinor: bigint | null;
  readonly openingDate: LocalDate;
  readonly color: string;
  readonly includeInAvailable: boolean;
  readonly lowBalanceMinor: bigint | null;
  readonly ccLimitMinor: bigint | null;
  readonly ccStatementDay: number | null;
  readonly ccDueDay: number | null;
}

export function draftOf(account: AccountView | undefined, type: AccountType, today: LocalDate, currency: string) {
  if (account === undefined) {
    return {
      type,
      providerName: '',
      catalogId: null,
      displayName: '',
      last4: '',
      phone: '',
      currency,
      openingMinor: null,
      openingDate: today,
      color: 'blue',
      includeInAvailable: type !== 'investment',
      lowBalanceMinor: null,
      ccLimitMinor: null,
      ccStatementDay: null,
      ccDueDay: null,
    } satisfies AccountDraft;
  }
  return {
    type: account.type,
    providerName: account.providerName,
    catalogId: account.catalogId,
    displayName: account.displayName,
    last4: account.last4 ?? '',
    phone: '',
    currency: account.currency,
    openingMinor: account.type === 'credit_card' ? -account.openingBalanceMinor : account.openingBalanceMinor,
    openingDate: account.openingDate,
    color: account.color,
    includeInAvailable: account.includeInAvailable,
    lowBalanceMinor: account.lowBalanceThresholdMinor,
    ccLimitMinor: account.ccLimitMinor,
    ccStatementDay: account.ccStatementDay,
    ccDueDay: account.ccDueDay,
  } satisfies AccountDraft;
}

export type DraftErrors = Partial<Record<'providerName' | 'displayName' | 'last4' | 'phone' | 'opening', string>>;

/** Client-side checks with the server's limits; `input` is set when there are no errors. */
export function validateDraft(draft: AccountDraft): { errors: DraftErrors; input: AccountFields | null } {
  const errors: DraftErrors = {};
  const displayName = draft.displayName.trim();
  const providerName = draft.type === 'cash' ? displayName : draft.providerName.trim();
  if (displayName === '') errors.displayName = m.accounts_form_error_required();
  if (draft.type !== 'cash' && providerName === '') errors.providerName = m.accounts_form_error_required();
  const usesLast4 = draft.type === 'bank' || draft.type === 'credit_card';
  if (usesLast4 && draft.last4 !== '' && !/^[0-9]{4}$/.test(draft.last4)) errors.last4 = m.accounts_form_error_last4();
  const phoneMasked = draft.type === 'ewallet' && draft.phone !== '' ? maskPhone(draft.phone) : null;
  if (draft.type === 'ewallet' && draft.phone !== '' && phoneMasked === null)
    errors.phone = m.accounts_form_error_phone();
  if (draft.openingMinor === null) errors.opening = m.accounts_form_error_amount();
  if (Object.keys(errors).length > 0 || draft.openingMinor === null) return { errors, input: null };
  const card = draft.type === 'credit_card';
  return {
    errors,
    input: {
      type: draft.type,
      providerName,
      catalogId: draft.type === 'cash' ? null : draft.catalogId,
      displayName,
      currency: draft.currency,
      openingBalanceMinor: card ? -draft.openingMinor : draft.openingMinor,
      openingDate: draft.openingDate,
      color: draft.color,
      last4: usesLast4 && draft.last4 !== '' ? draft.last4 : null,
      ...(draft.type !== 'ewallet' ? { phoneMasked: null } : phoneMasked === null ? {} : { phoneMasked }),
      includeInAvailable: draft.includeInAvailable,
      lowBalanceThresholdMinor: card ? null : draft.lowBalanceMinor,
      ccLimitMinor: card ? draft.ccLimitMinor : null,
      ccStatementDay: card ? draft.ccStatementDay : null,
      ccDueDay: card ? draft.ccDueDay : null,
    },
  };
}

/** The pending logo change: a picked file (with a `data:` preview, allowed by the CSP), or removing the stored one. */
type LogoChange = { readonly file: File; readonly preview: string } | 'remove' | null;

export interface AccountFormProps {
  /** Editing this account; omitted to add one. */
  readonly account?: AccountView;
  /** The type a new account starts with. */
  readonly defaultType?: AccountType;
  /** Values that replace the starting ones (onboarding's quick rows open "Detail" with what was typed). */
  readonly initial?: Partial<Pick<AccountDraft, 'type' | 'providerName' | 'displayName' | 'openingMinor' | 'color'>>;
  /** The user's base currency, the default for a new account. */
  readonly baseCurrency: string;
  readonly today: LocalDate;
  /** Names of the other accounts that already show as cards (FR-R2 limit). */
  readonly submitLabel: string;
  /** Left of the buttons (e.g. "Tidak perlu login bank"). */
  readonly footerNote?: ReactNode;
  readonly onSaved: (account: AccountView) => void;
  readonly onCancel: () => void;
}

export function AccountForm({
  account,
  defaultType = 'bank',
  initial,
  baseCurrency,
  today,
  submitLabel,
  footerNote,
  onSaved,
  onCancel,
}: AccountFormProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [draft, setDraft] = useState<AccountDraft>(() => ({
    ...draftOf(account, initial?.type ?? defaultType, today, baseCurrency),
    ...initial,
  }));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [logo, setLogo] = useState<LogoChange>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const catalogLogo = getCatalogRecord(draft.catalogId)?.logoPath;
  const locked = account?.locked === true;
  const set = (patch: Partial<AccountDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const card = draft.type === 'credit_card';
  const names = new Intl.DisplayNames([locale], { type: 'currency' });

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    const checked = validateDraft(draft);
    setErrors(checked.errors);
    if (checked.input === null) return;
    setPending(true);
    setFailure(null);
    const { currency, openingBalanceMinor, openingDate, ...unlocked } = checked.input;
    const saved =
      account === undefined
        ? await createAccount({ data: checked.input })
        : await updateAccount({
            data: {
              id: account.id,
              patch: locked ? unlocked : { ...unlocked, currency, openingBalanceMinor, openingDate },
            },
          });
    if (!saved.ok) {
      setPending(false);
      setFailure(ledgerErrorMessage(saved.code, locale));
      return;
    }
    let result = saved.value;
    if (logo === 'remove') {
      const removed = await removeAccountLogo({ data: { id: result.id } });
      if (removed.ok) result = removed.value;
    } else if (logo !== null) {
      const form = new FormData();
      form.set('id', result.id);
      form.set('file', logo.file);
      const uploaded = await setAccountLogo({ data: form });
      if (uploaded.ok) result = uploaded.value;
      else {
        // The account is saved; only the logo failed. Keep the dialog open on the saved account's state.
        setPending(false);
        setFailure(m.accounts_form_logo_failed());
        return;
      }
    }
    setPending(false);
    onSaved(result);
  };

  const pickLogo = (file: File | undefined) => {
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      // `readAsDataURL` always yields a string.
      const preview = reader.result as string;
      setLogo({ file, preview });
    };
    reader.readAsDataURL(file);
  };

  const previewAccount = {
    id: account?.id ?? 'new',
    type: draft.type,
    color: draft.color,
    catalogId: draft.catalogId,
    logoKey: logo === null ? (account?.logoKey ?? null) : null,
  };

  // Short under each locked field; the reason on hover.
  const lockedHint = locked ? (
    <span title={m.ledger_error_account_locked()} className="flex items-center gap-1 text-amber-fg">
      <Lock aria-hidden="true" className="size-3" />
      {m.accounts_form_locked()}
    </span>
  ) : undefined;

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className="text-[12.5px] font-medium text-muted-fg">
          {m.accounts_form_type()}
        </span>
        <SegmentedControl
          label={m.accounts_form_type()}
          fill
          value={draft.type}
          onValueChange={(type) => {
            const reference = getCatalogRecord(draft.catalogId);
            set({
              type,
              includeInAvailable: type !== 'investment',
              catalogId: reference?.accountTypes.includes(type) === true ? draft.catalogId : null,
            });
          }}
          options={ACCOUNT_TYPES.map((type) => ({
            value: type,
            label: accountTypeLabel(type),
            icon: ACCOUNT_TYPE_ICONS[type],
          }))}
        />
      </div>

      {draft.type === 'cash' ? null : (
        <Field
          label={PROVIDER_LABEL[draft.type]()}
          aside={<span className="text-[12px] text-subtle">{m.accounts_form_free_text()}</span>}
          error={errors.providerName ?? null}
          hint={
            <span className="flex flex-wrap items-center gap-x-2">
              <span>{m.accounts_form_logo_hint()}</span>
              <button
                type="button"
                className="font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => fileInput.current?.click()}
              >
                <Upload aria-hidden="true" className="mr-1 inline size-3" />
                {m.accounts_form_logo_upload()}
              </button>
              {logo !== null && logo !== 'remove' ? <span>{logo.file.name}</span> : null}
              {(account?.logoKey != null && logo !== 'remove') ||
              (logo !== null && logo !== 'remove') ||
              catalogLogo != null ? (
                <button
                  type="button"
                  className="font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    setLogo(account?.logoKey == null ? null : 'remove');
                    set({ catalogId: null });
                  }}
                >
                  {m.accounts_form_logo_icon()}
                </button>
              ) : null}
            </span>
          }
        >
          {({ id, describedBy, invalid }) => (
            <div className="flex items-center gap-2.5">
              {logo !== null && logo !== 'remove' ? (
                <img
                  src={logo.preview}
                  alt=""
                  className="size-[42px] shrink-0 rounded-[9px] border border-border bg-white object-contain"
                />
              ) : (
                <AccountLogo account={previewAccount} size="lg" />
              )}
              <CatalogInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={draft.providerName}
                maxLength={80}
                kind="provider"
                accountType={draft.type}
                onValueChange={(providerName) => {
                  set({ providerName, catalogId: null });
                }}
                onSelect={(record) => {
                  set({
                    providerName: record.name,
                    catalogId: record.id,
                    ...(draft.displayName.trim() === '' ? { displayName: record.name.slice(0, 40) } : {}),
                  });
                }}
              />
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  pickLogo(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </div>
          )}
        </Field>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field
          label={card ? m.accounts_form_card_name() : m.accounts_form_display_name()}
          error={errors.displayName ?? null}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={draft.displayName}
              maxLength={40}
              autoComplete="off"
              onChange={(event) => {
                set({ displayName: event.target.value });
              }}
            />
          )}
        </Field>
        {draft.type === 'bank' || card ? (
          <Field label={m.accounts_form_last4()} error={errors.last4 ?? null}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="w-[130px] font-mono"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={draft.last4}
                onChange={(event) => {
                  set({ last4: event.target.value.replace(/\D/g, '') });
                }}
              />
            )}
          </Field>
        ) : null}
        {draft.type === 'ewallet' ? (
          <Field label={m.accounts_form_phone()} error={errors.phone ?? null} hint={m.accounts_form_phone_hint()}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="w-[180px] font-mono"
                inputMode="tel"
                autoComplete="off"
                placeholder={account?.phoneMasked ?? '0812 3456 7818'}
                value={draft.phone}
                onChange={(event) => {
                  set({ phone: event.target.value });
                }}
              />
            )}
          </Field>
        ) : null}
      </div>

      {card ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label={m.accounts_form_cc_limit()} hint={m.accounts_form_cc_limit_hint()}>
            {({ id, describedBy }) => (
              <div className={INPUT_FRAME.lg}>
                <AmountInput
                  id={id}
                  aria-describedby={describedBy}
                  size="inline"
                  value={draft.ccLimitMinor}
                  onValueChange={(ccLimitMinor) => {
                    set({ ccLimitMinor });
                  }}
                  currency={draft.currency}
                  locale={locale}
                />
              </div>
            )}
          </Field>
          <Field label={m.accounts_form_cc_statement_day()}>
            {({ id }) => (
              <Select
                id={id}
                value={draft.ccStatementDay ?? ''}
                onChange={(event) => {
                  set({ ccStatementDay: event.target.value === '' ? null : Number(event.target.value) });
                }}
              >
                <option value="">{m.accounts_form_day_none()}</option>
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {m.accounts_form_day({ day })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={m.accounts_form_cc_due_day()}>
            {({ id }) => (
              <Select
                id={id}
                value={draft.ccDueDay ?? ''}
                onChange={(event) => {
                  set({ ccDueDay: event.target.value === '' ? null : Number(event.target.value) });
                }}
              >
                <option value="">{m.accounts_form_day_none()}</option>
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {m.accounts_form_day({ day })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}

      <div className="grid grid-cols-[112px_1fr_150px] gap-3">
        <Field label={m.accounts_form_currency()} hint={lockedHint}>
          {({ id, describedBy }) =>
            locked ? (
              <TextInput id={id} aria-describedby={describedBy} value={draft.currency} disabled readOnly />
            ) : (
              <Combobox
                value={draft.currency}
                onValueChange={(currency) => {
                  set({ currency });
                }}
                label={m.accounts_form_currency()}
                searchPlaceholder={m.accounts_form_currency_search()}
                emptyLabel={m.accounts_form_currency_empty()}
                contentClassName="w-[300px]"
                groups={[
                  {
                    options: Intl.supportedValuesOf('currency').map((code) => {
                      // Every supported code has a display name.
                      const name = String(names.of(code));
                      return { value: code, label: code, keywords: [name], aside: name };
                    }),
                  },
                ]}
              >
                <button
                  id={id}
                  type="button"
                  aria-describedby={describedBy}
                  className="flex h-[42px] w-full items-center justify-between rounded-[9px] border border-border-input bg-input px-3 font-mono text-[14px] text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {draft.currency}
                  <ChevronsUpDown aria-hidden="true" className="size-3.5 text-subtle" />
                </button>
              </Combobox>
            )
          }
        </Field>
        <Field
          label={
            card
              ? m.accounts_form_cc_bill()
              : draft.type === 'investment'
                ? m.accounts_form_current_value()
                : m.accounts_form_opening()
          }
          error={errors.opening ?? null}
        >
          {({ id, describedBy, invalid }) => (
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                size="inline"
                value={draft.openingMinor}
                onValueChange={(openingMinor) => {
                  set({ openingMinor });
                }}
                currency={draft.currency}
                locale={locale}
                disabled={locked}
              />
            </div>
          )}
        </Field>
        <Field label={account === undefined ? m.accounts_form_as_of() : m.accounts_form_since()}>
          {({ id }) => (
            <DatePicker
              id={id}
              value={draft.openingDate}
              onValueChange={(openingDate) => {
                if (!locked) set({ openingDate });
              }}
              placeholder={m.accounts_form_as_of()}
              today={today}
              locale={locale}
              disableFuture
              labels={{ previousMonth: m.accounts_previous_month(), nextMonth: m.accounts_next_month() }}
            />
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1.5 text-[12.5px] font-medium text-muted-fg">{m.accounts_form_color()}</legend>
        <div role="radiogroup" aria-label={m.accounts_form_color()} className="flex flex-wrap items-center gap-2">
          {PALETTE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={draft.color === color}
              aria-label={color}
              {...colorProps(color)}
              onClick={() => {
                set({ color });
              }}
              className="size-6 rounded-full bg-[var(--wf-color,var(--subtle))] ring-offset-2 ring-offset-dialog aria-checked:ring-2 aria-checked:ring-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            />
          ))}
          <label className="relative flex size-6 cursor-pointer items-center justify-center rounded-full bg-[conic-gradient(var(--red),var(--yellow),var(--green),var(--cyan),var(--blue),var(--violet),var(--red))] has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-ring">
            <span className="sr-only">{m.accounts_form_custom_color()}</span>
            <input
              type="color"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={HEX_COLOR.test(draft.color) ? draft.color : '#14b8a6'}
              onChange={(event) => {
                set({ color: event.target.value });
              }}
            />
          </label>
          {isColorToken(draft.color) ? null : (
            <span className="font-mono text-[12px] text-muted-fg">{draft.color}</span>
          )}
        </div>
      </fieldset>

      <div className="flex flex-col divide-y divide-border rounded-[10px] border border-border">
        <Switch
          className="px-3.5 py-3"
          label={card ? m.accounts_form_cc_available() : m.accounts_form_available()}
          description={
            card
              ? m.accounts_form_cc_available_hint()
              : draft.type === 'investment'
                ? m.accounts_form_available_investment_hint()
                : m.accounts_form_available_hint()
          }
          checked={draft.includeInAvailable}
          onChange={(event) => {
            set({ includeInAvailable: event.target.checked });
          }}
        />
        {card ? null : (
          <div className="px-3.5 py-3">
            <Field label={m.accounts_form_low_balance()} hint={m.accounts_form_low_balance_hint()}>
              {({ id, describedBy }) => (
                <div className={INPUT_FRAME.lg}>
                  <AmountInput
                    id={id}
                    aria-describedby={describedBy}
                    size="inline"
                    value={draft.lowBalanceMinor}
                    onValueChange={(lowBalanceMinor) => {
                      set({ lowBalanceMinor });
                    }}
                    currency={draft.currency}
                    locale={locale}
                  />
                </div>
              )}
            </Field>
          </div>
        )}
      </div>

      <section
        aria-label={m.accounts_form_preview()}
        className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface-sunken p-3.5"
      >
        <div className="flex justify-between text-[12px] text-subtle">
          <span>{m.accounts_form_preview()}</span>
          <span>{m.accounts_form_preview_note()}</span>
        </div>
        <div className="mx-auto flex w-[200px] flex-col gap-2 rounded-[10px] border border-border bg-card p-3.5">
          <div className="flex items-start justify-between">
            {logo !== null && logo !== 'remove' ? (
              <img src={logo.preview} alt="" className="size-[22px] rounded-[6px] bg-white object-contain" />
            ) : (
              <AccountLogo account={previewAccount} size="sm" />
            )}
            <span className="rounded-[4px] border border-border px-1.5 text-[10.5px] text-subtle">
              {accountTypeLabel(draft.type)} · {draft.currency}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="truncate text-[13px] font-medium text-fg">
              {draft.displayName.trim() === '' ? accountTypeLabel(draft.type) : draft.displayName}
            </span>
            <span className="font-mono text-[11px] text-subtle">
              {draft.type === 'ewallet'
                ? (maskPhone(draft.phone) ?? account?.phoneMasked ?? '')
                : draft.last4 === ''
                  ? ''
                  : `•• ${draft.last4}`}
            </span>
          </div>
          <Money
            minor={card ? -(draft.openingMinor ?? 0n) : (draft.openingMinor ?? 0n)}
            currency={draft.currency}
            context="amount"
            locale={locale}
            className="text-[16px] font-semibold text-fg"
          />
        </div>
      </section>

      {failure === null ? null : <FormError>{failure}</FormError>}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-[12px] text-subtle">{footerNote}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {m.accounts_cancel()}
          </Button>
          <Button type="submit" size="sm" pending={pending}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
