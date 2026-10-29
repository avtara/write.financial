// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Langganan baru" / "Edit langganan" (FR-SUB1, design `sN6Eh`, `yuefQ`, `JZBFF`): the service (local reference
 * search or manual text, uploaded logo or icon), plan, price and currency, cycle, next bill, paying account — "Dikonversi saat
 * ditagih" with an estimate when its currency differs —, category, description, the reminder (default 3 days before)
 * and, for a new one, a free trial (7/14 days, 1 month, or until a date; the first bill follows it). Editing shows a
 * price increase since the last bill.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { SubscriptionView } from '@wf/db/schedules';
import { getCatalogRecord } from '@wf/domain/catalog';
import { convert, type FxRate } from '@wf/domain/fx';
import type { LocalDate } from '@wf/domain/period';
import { trialFirstBill, type SubscriptionCycle, type TrialLength } from '@wf/domain/subscriptions';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { formatDate } from '@wf/ui/dates';
import { DatePicker } from '@wf/ui/date-picker';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { Switch } from '@wf/ui/switch';
import { ClipboardList, ImagePlus, Repeat, TrendingUp, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getReferenceRate } from '../../server/fn/ledger.ts';
import {
  createSubscription,
  removeSubscriptionLogo,
  setSubscriptionLogo,
  updateSubscription,
} from '../../server/fn/schedules.ts';
import { Button, Field, FormError, INPUT_FRAME, Select, TextInput } from '../form.tsx';
import { CatalogInput } from '../catalog-input.tsx';
import { IconPicker } from '../icon-picker.tsx';
import { AccountPicker, AccountTrigger } from '../ledger/account-picker.tsx';
import { CategorySelect } from '../ledger/category-picker.tsx';
import { unitValue } from '../ledger/transaction-draft.ts';
import { Modal } from '../modal.tsx';
import { RichMessage } from '../rich-message.tsx';
import { SubscriptionAvatar } from './subscription-avatar.tsx';
import { avatarColor } from './subscriptions-model.ts';

const REMIND_DAYS = [1, 2, 3, 5, 7] as const;
const DEFAULT_REMIND_DAYS = 3;
const TRIALS = ['7d', '14d', '1m', 'until'] as const;
type TrialChoice = (typeof TRIALS)[number];

const TRIAL_LABEL: Readonly<Record<TrialChoice, () => string>> = {
  '7d': () => m.subscriptions_form_trial_days({ days: 7 }),
  '14d': () => m.subscriptions_form_trial_days({ days: 14 }),
  '1m': m.subscriptions_form_trial_month,
  until: m.subscriptions_form_trial_until,
};

export interface SubscriptionDraft {
  readonly name: string;
  readonly catalogId: string | null;
  readonly plan: string;
  readonly icon: string | null;
  readonly description: string;
  readonly currency: string;
  readonly priceMinor: bigint | null;
  readonly cycle: SubscriptionCycle;
  readonly nextBillingDate: LocalDate;
  readonly payFromAccountId: string | null;
  readonly categoryId: string | null;
  readonly remind: boolean;
  readonly remindDays: number;
  readonly trial: TrialChoice | null;
  readonly trialUntil: LocalDate | null;
}

export type DraftErrors = Partial<Record<'name' | 'price' | 'account' | 'trial', string>>;

/** A new subscription's draft, or `subscription`'s. */
export function draftOf(
  subscription: SubscriptionView | undefined,
  defaults: { readonly today: LocalDate; readonly currency: string; readonly accountId: string | null },
  prefill: Partial<SubscriptionDraft> = {},
): SubscriptionDraft {
  return {
    name: subscription?.name ?? '',
    catalogId: subscription?.catalogId ?? null,
    plan: subscription?.plan ?? '',
    icon: subscription?.icon ?? null,
    description: subscription?.description ?? '',
    currency: subscription?.currency ?? defaults.currency,
    priceMinor: subscription?.priceMinor ?? null,
    cycle: subscription?.cycle ?? 'monthly',
    nextBillingDate: subscription?.nextBillingDate ?? defaults.today,
    payFromAccountId: subscription?.payFromAccountId ?? defaults.accountId,
    categoryId: subscription?.categoryId ?? null,
    remind: subscription === undefined ? true : subscription.remindDaysBefore !== null,
    remindDays: subscription?.remindDaysBefore ?? DEFAULT_REMIND_DAYS,
    trial: null,
    trialUntil: null,
    ...prefill,
  };
}

function trialLength(draft: SubscriptionDraft): TrialLength | null {
  if (draft.trial === '7d') return { days: 7 };
  if (draft.trial === '14d') return { days: 14 };
  if (draft.trial === '1m') return { months: 1 };
  if (draft.trial === 'until' && draft.trialUntil !== null) return { until: draft.trialUntil };
  return null;
}

/** Client-side checks with the server's limits. */
export function validateDraft(draft: SubscriptionDraft, today: LocalDate): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.name.trim() === '') errors.name = m.subscriptions_form_name_required();
  if (draft.priceMinor === null || draft.priceMinor <= 0n) errors.price = m.subscriptions_form_price_required();
  if (draft.payFromAccountId === null) errors.account = m.subscriptions_form_account_required();
  if (draft.trial === 'until' && (draft.trialUntil === null || draft.trialUntil < today)) {
    errors.trial = m.subscriptions_form_trial_invalid();
  }
  return errors;
}

/** The pending logo change: a picked file (with a `data:` preview), or dropping the uploaded one. */
type LogoChange = { readonly file: File; readonly preview: string } | 'remove' | null;

export interface SubscriptionFormProps {
  readonly open: boolean;
  /** Edit this one; a new subscription without it. */
  readonly subscription?: SubscriptionView | undefined;
  /** Fields of a new one taken from elsewhere (a detected candidate). */
  readonly prefill?: Partial<SubscriptionDraft>;
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
  readonly baseCurrency: string;
  readonly today: LocalDate;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (subscription: SubscriptionView, created: boolean) => void;
}

export function SubscriptionForm({ open, onOpenChange, subscription, ...props }: SubscriptionFormProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={subscription === undefined ? m.subscriptions_form_new_title() : m.subscriptions_form_edit_title()}
      description={
        subscription === undefined
          ? m.subscriptions_form_new_description()
          : m.subscriptions_form_edit_description({
              count: subscription.paidCount,
              since: new Intl.DateTimeFormat(props.locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
                new Date(`${subscription.startedOn}T00:00:00Z`),
              ),
            })
      }
    >
      <FormBody
        {...props}
        subscription={subscription}
        onCancel={() => {
          onOpenChange(false);
        }}
      />
    </Modal>
  );
}

function FormBody({
  subscription,
  prefill,
  accounts,
  categories,
  baseCurrency,
  today,
  locale,
  onSaved,
  onCancel,
}: Omit<SubscriptionFormProps, 'open' | 'onOpenChange'> & { readonly onCancel: () => void }) {
  const activeAccounts = accounts.filter((account) => account.status === 'active');
  const [draft, setDraft] = useState(() =>
    draftOf(
      subscription,
      {
        today,
        currency: baseCurrency,
        accountId: (activeAccounts.find((account) => account.isDefaultQuickEntry) ?? activeAccounts[0])?.id ?? null,
      },
      prefill,
    ),
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [logo, setLogo] = useState<LogoChange>(null);
  const [iconGrid, setIconGrid] = useState(false);
  const [rate, setRate] = useState<FxRate | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<SubscriptionDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const account = activeAccounts.find((candidate) => candidate.id === draft.payFromAccountId);
  const converted = account !== undefined && account.currency !== draft.currency;
  const currencies = [...new Set([baseCurrency, draft.currency, ...activeAccounts.map((a) => a.currency), 'USD'])];
  const trial = trialLength(draft);
  const firstBill = trial === null ? null : trialFirstBill(today, trial).firstBillOn;
  const calendarLabels = {
    previousMonth: m.subscriptions_form_previous_month(),
    nextMonth: m.subscriptions_form_next_month(),
  };

  useEffect(() => {
    if (!converted) return;
    let current = true;
    void getReferenceRate({ data: { base: draft.currency, quote: account.currency } }).then((result) => {
      if (current) setRate(result.ok ? result.value : null);
    });
    return () => {
      current = false;
    };
  }, [converted, draft.currency, account?.currency]);

  const pickLogo = (file: File | undefined) => {
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      // `readAsDataURL` always yields a string.
      setLogo({ file, preview: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    const checked = validateDraft(draft, today);
    setErrors(checked);
    if (Object.keys(checked).length > 0) return;
    setPending(true);
    setFailure(null);
    const fields = {
      name: draft.name.trim(),
      catalogId: draft.catalogId,
      plan: draft.plan.trim() === '' ? null : draft.plan.trim(),
      icon: draft.icon,
      description: draft.description.trim() === '' ? null : draft.description.trim(),
      priceMinor: draft.priceMinor as bigint,
      currency: draft.currency,
      cycle: draft.cycle,
      nextBillingDate: draft.nextBillingDate,
      payFromAccountId: draft.payFromAccountId as string,
      categoryId: draft.categoryId,
      remindDaysBefore: draft.remind ? draft.remindDays : null,
    };
    const saved =
      subscription === undefined
        ? await createSubscription({ data: { ...fields, startedOn: today, trial } })
        : await updateSubscription({ data: { id: subscription.id, patch: fields } });
    if (!saved.ok) {
      setPending(false);
      setFailure(ledgerErrorMessage(saved.code, locale));
      return;
    }
    let result = saved.value;
    if (logo === 'remove') {
      const removed = await removeSubscriptionLogo({ data: { id: result.id } });
      if (removed.ok) result = removed.value;
    } else if (logo !== null) {
      const form = new FormData();
      form.set('id', result.id);
      form.set('file', logo.file);
      const uploaded = await setSubscriptionLogo({ data: form });
      if (!uploaded.ok) {
        // The subscription is saved; only the logo failed.
        setPending(false);
        setFailure(m.subscriptions_form_logo_failed());
        return;
      }
      result = uploaded.value;
    }
    setPending(false);
    onSaved(result, subscription === undefined);
  };

  const preview = {
    id: subscription?.id ?? 'new',
    name: draft.name === '' ? '?' : draft.name,
    icon: draft.icon,
    catalogId: draft.catalogId,
    logoKey: logo === null ? (subscription?.logoKey ?? null) : null,
  };
  const hasLogo = logo !== null ? logo !== 'remove' : subscription?.logoKey != null;
  const catalogLogo = getCatalogRecord(draft.catalogId)?.logoPath;
  const increase = subscription?.priceIncrease ?? null;

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <Field
        label={m.subscriptions_form_service()}
        aside={<span className="text-[12px] text-subtle">{m.subscriptions_form_free_text()}</span>}
        error={errors.name ?? null}
        hint={
          <span className="flex flex-wrap items-center gap-x-3">
            <span className="flex-1">
              {hasLogo
                ? m.subscriptions_form_logo_set()
                : catalogLogo == null
                  ? m.subscriptions_form_logo_none()
                  : m.catalog_logo()}
            </span>
            <button
              type="button"
              className="font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => fileInput.current?.click()}
            >
              <Upload aria-hidden="true" className="mr-1 inline size-3" />
              {m.subscriptions_form_logo_upload()}
            </button>
            <button
              type="button"
              aria-expanded={iconGrid}
              className="font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                setIconGrid((shown) => !shown);
                if (hasLogo) setLogo(subscription?.logoKey == null ? null : 'remove');
                set({ catalogId: null });
              }}
            >
              {m.subscriptions_form_use_icon()}
            </button>
          </span>
        }
      >
        {({ id, describedBy, invalid }) => (
          <div className="flex items-center gap-2.5">
            {logo !== null && logo !== 'remove' ? (
              <img
                src={logo.preview}
                alt=""
                className="size-10 shrink-0 rounded-[10px] border border-border bg-white object-contain"
              />
            ) : draft.name === '' && draft.icon === null && preview.logoKey === null ? (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border text-subtle">
                <ImagePlus aria-hidden="true" className="size-4" />
              </span>
            ) : (
              <SubscriptionAvatar subscription={preview} size="lg" />
            )}
            <CatalogInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={draft.name}
              maxLength={40}
              kind="service"
              placeholder={m.subscriptions_form_name_placeholder()}
              onValueChange={(name) => {
                set({ name, catalogId: null });
              }}
              onSelect={(record) => {
                set({ name: record.name, catalogId: record.id });
              }}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              data-testid="subscription-logo-file"
              onChange={(event) => {
                pickLogo(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
        )}
      </Field>
      {iconGrid ? (
        <IconPicker
          label={m.subscriptions_form_icon()}
          value={draft.icon ?? ''}
          color={avatarColor(preview.id)}
          onValueChange={(icon) => {
            set({ icon, catalogId: null });
          }}
        />
      ) : null}

      <Field
        label={m.subscriptions_form_plan()}
        aside={<span className="text-[12px] text-subtle">{m.subscriptions_form_optional()}</span>}
      >
        {({ id }) => (
          <TextInput
            id={id}
            value={draft.plan}
            maxLength={40}
            autoComplete="off"
            placeholder={m.subscriptions_form_plan_placeholder()}
            onChange={(event) => {
              set({ plan: event.target.value });
            }}
          />
        )}
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={m.subscriptions_form_price()} error={errors.price ?? null}>
          {({ id, describedBy, invalid }) => (
            <div className={`${INPUT_FRAME.lg} flex items-center gap-2`}>
              <select
                aria-label={m.subscriptions_form_currency()}
                value={draft.currency}
                onChange={(event) => {
                  set({ currency: event.target.value });
                }}
                className="bg-transparent font-mono text-[13px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-ring"
              >
                {currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
              <AmountInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                size="inline"
                value={draft.priceMinor}
                onValueChange={(priceMinor) => {
                  set({ priceMinor });
                }}
                currency={draft.currency}
                locale={locale}
              />
            </div>
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span aria-hidden="true" className="text-[12.5px] font-medium text-muted-fg">
            {m.subscriptions_form_cycle()}
          </span>
          <SegmentedControl
            label={m.subscriptions_form_cycle()}
            fill
            value={draft.cycle}
            onValueChange={(cycle) => {
              set({ cycle });
            }}
            options={[
              { value: 'monthly', label: m.subscriptions_cycle_monthly() },
              { value: 'yearly', label: m.subscriptions_cycle_yearly() },
              { value: 'weekly', label: m.subscriptions_cycle_weekly() },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {firstBill === null ? (
          <Field label={m.subscriptions_form_next_bill()}>
            {({ id }) => (
              <DatePicker
                id={id}
                value={draft.nextBillingDate}
                onValueChange={(nextBillingDate) => {
                  set({ nextBillingDate });
                }}
                placeholder={m.subscriptions_form_next_bill()}
                today={today}
                locale={locale}
                labels={calendarLabels}
              />
            )}
          </Field>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-muted-fg">{m.subscriptions_form_first_bill()}</span>
            <span className={`${INPUT_FRAME.lg} flex items-center text-[14px] text-fg`}>
              {formatDate(firstBill, locale, 'weekday')}
            </span>
          </div>
        )}
        <Field label={m.subscriptions_form_pay_from()} error={errors.account ?? null}>
          {({ id, describedBy, invalid }) => (
            <AccountPicker
              accounts={activeAccounts}
              value={draft.payFromAccountId}
              onValueChange={(payFromAccountId) => {
                set({ payFromAccountId });
              }}
              label={m.subscriptions_form_pay_from()}
              searchPlaceholder={m.subscriptions_form_account_search()}
              locale={locale}
              outflowMinor={converted ? null : draft.priceMinor}
            >
              <AccountTrigger
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                account={account}
                placeholder={m.subscriptions_form_account_placeholder()}
              />
            </AccountPicker>
          )}
        </Field>
      </div>
      {converted ? (
        <p className="-mt-2 rounded-[8px] border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted-fg">
          <span className="font-medium text-fg">{m.subscriptions_form_converted()}</span>
          {rate === null || draft.priceMinor === null ? null : (
            <>
              {' · '}
              <RichMessage
                message={m.subscriptions_form_estimate}
                slots={{
                  amount: (
                    <Money
                      minor={convert({ minor: draft.priceMinor, currency: draft.currency }, account.currency, rate)}
                      currency={account.currency}
                      context="amount"
                      locale={locale}
                    />
                  ),
                  rate: <Money minor={unitValue(rate)} currency={account.currency} context="amount" locale={locale} />,
                }}
              />
            </>
          )}
          <br />
          {m.subscriptions_form_converted_note({ currency: account.currency })}
        </p>
      ) : null}

      <Field label={m.subscriptions_form_category()}>
        {({ id }) => (
          <CategorySelect
            id={id}
            categories={categories}
            kind="expense"
            value={draft.categoryId}
            onValueChange={(categoryId) => {
              set({ categoryId });
            }}
            label={m.subscriptions_form_category()}
            searchPlaceholder={m.subscriptions_form_category_search()}
            placeholder={m.subscriptions_form_category_placeholder()}
            className="h-[42px] w-full rounded-[9px] px-3 text-[14px]"
          />
        )}
      </Field>

      <Field
        label={m.subscriptions_form_description()}
        aside={<span className="text-[12px] text-subtle">{m.subscriptions_form_optional()}</span>}
      >
        {({ id }) => (
          <textarea
            id={id}
            value={draft.description}
            maxLength={200}
            rows={2}
            placeholder={m.subscriptions_form_description_placeholder()}
            onChange={(event) => {
              set({ description: event.target.value });
            }}
            className="w-full resize-none rounded-[9px] border border-border-input bg-input px-3 py-2 text-[14px] text-fg outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        )}
      </Field>

      <div className="flex flex-col rounded-[10px] border border-border">
        <div className="flex flex-col gap-2 px-4 py-3">
          <Switch
            label={m.subscriptions_form_remind()}
            description={
              draft.remind
                ? m.subscriptions_form_remind_hint({ days: draft.remindDays })
                : m.subscriptions_form_remind_off()
            }
            checked={draft.remind}
            onChange={(event) => {
              set({ remind: event.target.checked });
            }}
          />
          {draft.remind ? (
            <Select
              size="sm"
              aria-label={m.subscriptions_form_remind_days()}
              value={draft.remindDays}
              onChange={(event) => {
                set({ remindDays: Number(event.target.value) });
              }}
              className="w-[200px]"
            >
              {REMIND_DAYS.map((days) => (
                <option key={days} value={days}>
                  {m.subscriptions_form_remind_option({ days })}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        {subscription === undefined ? (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
            <Switch
              label={m.subscriptions_form_trial()}
              description={m.subscriptions_form_trial_hint()}
              checked={draft.trial !== null}
              onChange={(event) => {
                set({ trial: event.target.checked ? '7d' : null });
              }}
            />
            {draft.trial === null ? null : (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">{m.subscriptions_form_trial_length()}</legend>
                <div className="flex flex-wrap gap-2">
                  {TRIALS.map((choice) => (
                    <label
                      key={choice}
                      className="flex cursor-pointer items-center gap-1.5 rounded-[7px] border border-border px-2.5 py-1 text-[12.5px] text-fg has-checked:border-fg has-focus-visible:outline-2 has-focus-visible:outline-ring"
                    >
                      <input
                        type="radio"
                        name="trial"
                        value={choice}
                        checked={draft.trial === choice}
                        onChange={() => {
                          set({ trial: choice });
                        }}
                        className="accent-[var(--fg)]"
                      />
                      {TRIAL_LABEL[choice]()}
                    </label>
                  ))}
                </div>
                {draft.trial === 'until' ? (
                  <DatePicker
                    value={draft.trialUntil}
                    onValueChange={(trialUntil) => {
                      set({ trialUntil });
                    }}
                    placeholder={m.subscriptions_form_trial_until_placeholder()}
                    aria-label={m.subscriptions_form_trial_until_placeholder()}
                    aria-invalid={errors.trial !== undefined}
                    today={today}
                    locale={locale}
                    labels={calendarLabels}
                    size="sm"
                  />
                ) : null}
                {errors.trial === undefined ? null : <span className="text-[12px] text-red-fg">{errors.trial}</span>}
              </fieldset>
            )}
          </div>
        ) : null}
      </div>

      {increase === null ? null : (
        <p className="flex items-start gap-2.5 rounded-[10px] border border-red/30 bg-red-tint-1 px-3 py-2.5 text-[12.5px] text-fg">
          <TrendingUp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-fg" />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{m.subscriptions_form_increase()}</span>
            <span className="text-muted-fg">
              <Money minor={increase.previousMinor} currency={draft.currency} context="amount" locale={locale} />
              {' → '}
              <Money minor={increase.currentMinor} currency={draft.currency} context="amount" locale={locale} />
              {' · +'}
              <Money minor={increase.increaseMinor} currency={draft.currency} context="amount" locale={locale} />
              {' · '}
              <Percent value={increase.increaseBps / 10_000} signed locale={locale} />
            </span>
          </span>
        </p>
      )}

      <p className="flex items-start gap-2.5 rounded-[10px] border border-amber/30 bg-amber-tint-1 px-3 py-2.5 text-[12px] text-fg">
        <ClipboardList aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-fg" />
        {m.subscriptions_form_review_note()}
      </p>

      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onCancel}>
          {m.subscriptions_form_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          <Repeat aria-hidden="true" className="size-3.5" />
          {subscription === undefined ? m.subscriptions_form_save_new() : m.subscriptions_form_save_edit()}
        </Button>
      </div>
    </form>
  );
}
