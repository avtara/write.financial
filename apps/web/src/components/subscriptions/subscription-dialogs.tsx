// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Jeda" (FR-SUB3, design `QO7La`): 1 month / 2 months / a date, what it saves, the reminder before it resumes, and
 * what is left to pay this month; and "Batalkan" (`VtfuA`): after the next bill (it still goes to review) or now (it
 * leaves the schedule). write.financial only records: the service itself is paused or cancelled in its own app.
 */
import type { SubscriptionsOverview, SubscriptionView } from '@wf/db/schedules';
import type { LocalDate } from '@wf/domain/period';
import {
  PAUSE_REMIND_DAYS,
  pausePlan,
  type CancelMode,
  type PauseLength,
  type PausePlan,
} from '@wf/domain/subscriptions';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { formatDate } from '@wf/ui/dates';
import { DatePicker } from '@wf/ui/date-picker';
import { Money } from '@wf/ui/money';
import { Switch } from '@wf/ui/switch';
import { CircleX, Info, Pause } from 'lucide-react';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { Button } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { RichMessage } from '../rich-message.tsx';
import { SubscriptionAvatar } from './subscription-avatar.tsx';

type PauseChoice = 1 | 2 | 'until';

export interface PauseDialogProps {
  readonly subscription: SubscriptionView | null;
  readonly overview: SubscriptionsOverview;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  /** Resolves `true` once paused (the dialog then closes). */
  readonly onPause: (
    subscription: SubscriptionView,
    length: PauseLength,
    remindDaysBefore: number | null,
  ) => Promise<boolean>;
}

export function PauseDialog({ subscription, ...props }: PauseDialogProps) {
  return (
    <Modal
      open={subscription !== null}
      onOpenChange={props.onOpenChange}
      size="lg"
      title={m.subscriptions_pause_title({ name: subscription?.name ?? '' })}
      description={m.subscriptions_pause_description()}
    >
      {subscription === null ? null : <PauseBody subscription={subscription} {...props} />}
    </Modal>
  );
}

function PauseBody({
  subscription,
  overview,
  locale,
  onOpenChange,
  onPause,
}: Omit<PauseDialogProps, 'subscription'> & { readonly subscription: SubscriptionView }) {
  const { today } = overview;
  const nextBill = subscription.nextBill?.dueDate ?? subscription.nextBillingDate;
  const [choice, setChoice] = useState<PauseChoice>(1);
  const [until, setUntil] = useState<LocalDate | null>(null);
  const [remind, setRemind] = useState(true);
  const [pending, setPending] = useState(false);
  // A pause must end after the next bill (`pausePlan` refuses it otherwise).
  const plan = (length: PauseLength): PausePlan | null =>
    'until' in length && length.until <= nextBill
      ? null
      : pausePlan(nextBill, subscription.cycle, subscription.priceMinor, length, remind ? PAUSE_REMIND_DAYS : null);
  const length: PauseLength | null = choice === 'until' ? (until === null ? null : { until }) : { months: choice };
  const chosen = length === null ? null : plan(length);
  // This month's bills of this subscription that the pause skips.
  const skippedThisMonth = overview.monthSchedule
    .filter(
      (bill) =>
        bill.subscriptionId === subscription.id &&
        bill.status === 'will_charge' &&
        bill.dueDate >= today &&
        chosen !== null &&
        bill.dueDate < chosen.pausedUntil &&
        bill.currency === overview.baseCurrency,
    )
    .reduce((total, bill) => total + bill.amountMinor, 0n);
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${today}T00:00:00Z`),
  );

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (length === null || chosen === null) return;
    setPending(true);
    const done = await onPause(subscription, length, remind ? PAUSE_REMIND_DAYS : null);
    setPending(false);
    if (done) onOpenChange(false);
  };

  const option = (value: PauseChoice, title: string, detail: ReactNode, aside: ReactNode) => (
    <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-border px-3 py-2.5 has-checked:border-fg has-checked:bg-surface-2 has-focus-visible:outline-2 has-focus-visible:outline-ring">
      <input
        type="radio"
        name="pause-length"
        checked={choice === value}
        onChange={() => {
          setChoice(value);
        }}
        className="size-4 accent-[var(--fg)]"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-fg">{title}</span>
        {detail === null ? null : <span className="text-[11.5px] text-subtle">{detail}</span>}
      </span>
      {aside}
    </label>
  );
  const fixed = (months: 1 | 2) => {
    const result = pausePlan(nextBill, subscription.cycle, subscription.priceMinor, { months }, null);
    return option(
      months,
      m.subscriptions_pause_months({ months }),
      m.subscriptions_pause_resumes({ date: formatDate(result.pausedUntil, locale, 'weekday') }),
      <span className="font-mono text-[12px] text-green-fg">
        −<Money minor={result.savedMinor} currency={subscription.currency} context="amount" locale={locale} />
      </span>,
    );
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <SubscriptionAvatar subscription={subscription} size="lg" />
        <span className="text-[13px] text-muted-fg">
          <Money minor={subscription.priceMinor} currency={subscription.currency} context="amount" locale={locale} /> ·{' '}
          {formatDate(nextBill, locale, 'day')}
        </span>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1.5 text-[12.5px] font-medium text-muted-fg">{m.subscriptions_pause_until()}</legend>
        {fixed(1)}
        {fixed(2)}
        {option('until', m.subscriptions_pause_pick_date(), null, null)}
        {choice === 'until' ? (
          <DatePicker
            value={until}
            onValueChange={setUntil}
            placeholder={m.subscriptions_pause_pick_date()}
            aria-label={m.subscriptions_pause_pick_date()}
            today={today}
            locale={locale}
            labels={{
              previousMonth: m.subscriptions_form_previous_month(),
              nextMonth: m.subscriptions_form_next_month(),
            }}
          />
        ) : null}
        {choice === 'until' && until !== null && chosen === null ? (
          <span className="text-[12px] text-red-fg">
            {m.subscriptions_pause_date_invalid({ date: formatDate(nextBill, locale, 'day') })}
          </span>
        ) : null}
      </fieldset>
      <Switch
        label={m.subscriptions_pause_remind({ days: PAUSE_REMIND_DAYS })}
        description={
          chosen?.remindOn == null
            ? m.subscriptions_pause_remind_hint_plain()
            : m.subscriptions_pause_remind_hint({ date: formatDate(chosen.remindOn, locale, 'day') })
        }
        checked={remind}
        onChange={(event) => {
          setRemind(event.target.checked);
        }}
      />
      <p className="flex items-center gap-2 rounded-[8px] bg-surface-2 px-3 py-2 text-[12px] text-muted-fg">
        <Info aria-hidden="true" className="size-3.5 shrink-0" />
        {m.subscriptions_pause_only_records({ name: subscription.name })}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-[12px] text-muted-fg">
          <RichMessage
            message={m.subscriptions_pause_left}
            slots={{
              month,
              amount: (
                <Money
                  minor={overview.remainingThisMonth.totalMinor - skippedThisMonth}
                  currency={overview.baseCurrency}
                  context="amount"
                  locale={locale}
                />
              ),
            }}
          />
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {m.subscriptions_form_cancel()}
          </Button>
          <Button type="submit" pending={pending} disabled={chosen === null}>
            <Pause aria-hidden="true" className="size-3.5" />
            {choice === 'until'
              ? m.subscriptions_pause_submit_until()
              : m.subscriptions_pause_submit({ months: choice })}
          </Button>
        </div>
      </div>
    </form>
  );
}

export interface CancelDialogProps {
  readonly subscription: SubscriptionView | null;
  readonly accountName: string;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCancel: (subscription: SubscriptionView, mode: CancelMode) => Promise<boolean>;
}

export function CancelDialog({ subscription, ...props }: CancelDialogProps) {
  return (
    <Modal
      open={subscription !== null}
      onOpenChange={props.onOpenChange}
      size="lg"
      title={m.subscriptions_cancel_title({ name: subscription?.name ?? '' })}
    >
      {subscription === null ? null : <CancelBody subscription={subscription} {...props} />}
    </Modal>
  );
}

function CancelBody({
  subscription,
  accountName,
  locale,
  onOpenChange,
  onCancel,
}: Omit<CancelDialogProps, 'subscription'> & { readonly subscription: SubscriptionView }) {
  const [mode, setMode] = useState<CancelMode>('after_next_bill');
  const [cancelledInApp, setCancelledInApp] = useState(false);
  const [pending, setPending] = useState(false);
  const bill = subscription.nextBill;
  const date = bill === null ? null : formatDate(bill.dueDate, locale, 'day');
  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setPending(true);
    const done = await onCancel(subscription, bill === null ? 'now' : mode);
    setPending(false);
    if (done) onOpenChange(false);
  };
  const option = (value: CancelMode, title: string, detail: string) => (
    <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-border px-3 py-2.5 has-checked:border-fg has-checked:bg-surface-2 has-focus-visible:outline-2 has-focus-visible:outline-ring">
      <input
        type="radio"
        name="cancel-mode"
        checked={mode === value}
        onChange={() => {
          setMode(value);
        }}
        className="size-4 accent-[var(--fg)]"
      />
      <span className="flex flex-col">
        <span className="text-[13px] font-medium text-fg">{title}</span>
        <span className="text-[11.5px] text-subtle">{detail}</span>
      </span>
    </label>
  );
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <SubscriptionAvatar subscription={subscription} size="lg" />
        <span className="flex flex-col text-[12.5px] text-muted-fg">
          <span className="text-[14px] font-medium text-fg">
            <Money minor={subscription.priceMinor} currency={subscription.currency} context="amount" locale={locale} />
            {subscription.cycle === 'yearly' ? m.subscriptions_per_year_suffix() : m.subscriptions_per_month_suffix()}
          </span>
          {date === null ? null : m.subscriptions_cancel_billed({ date, account: accountName })}
        </span>
      </div>
      {date === null ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{m.subscriptions_cancel_when()}</legend>
          {option(
            'after_next_bill',
            m.subscriptions_cancel_after({ date }),
            m.subscriptions_cancel_after_hint({ date }),
          )}
          {option('now', m.subscriptions_cancel_now(), m.subscriptions_cancel_now_hint({ date }))}
        </fieldset>
      )}
      <Checkbox
        label={m.subscriptions_cancel_in_app({ name: subscription.name })}
        checked={cancelledInApp}
        onChange={(event) => {
          setCancelledInApp(event.target.checked);
        }}
      />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button
          variant="secondary"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {m.subscriptions_form_cancel()}
        </Button>
        <Button type="submit" variant="destructive" pending={pending} disabled={!cancelledInApp}>
          <CircleX aria-hidden="true" className="size-3.5" />
          {m.subscriptions_menu_cancel()}
        </Button>
      </div>
    </form>
  );
}
