// SPDX-License-Identifier: AGPL-3.0-only
import { formatMoney } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { GMAIL_ITEM } from '../../../test/review-fixtures.ts';
import { ACCOUNTS, CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { categoryName } from '../../lib/ledger-labels.ts';
import type { GmailReviewItem } from './review-model.ts';
import { GmailReviewCard } from './gmail-review-card.tsx';

const server = vi.hoisted(() => ({ listTransactionDays: vi.fn().mockResolvedValue({ ok: true, value: [] }) }));
vi.mock('../../server/fn/transactions-write.ts', () => server);

const TODAY = '2026-10-20' as LocalDate;
const account = ACCOUNTS.find((entry) => entry.currency === 'IDR');
const category = CATEGORIES.find((entry) => entry.kind === 'expense');
if (account === undefined || category === undefined) throw new Error('Missing financial fixtures');
const item: GmailReviewItem = {
  ...GMAIL_ITEM,
  label: 'PLN',
  payload: {
    kind: 'gmail',
    logId: 'log',
    messageId: 'mail-id',
    from: 'pay@bank.test',
    subject: 'PLN payment',
    excerpt: 'Private payment evidence 350000 IDR',
    tags: [],
    errorCode: null,
    extraction: {
      amountMinor: 350000n,
      occurredAt: new Date('2026-10-18T02:00:00Z'),
      merchant: 'PLN',
      currency: 'IDR',
      accountId: account.id,
      categoryId: category.id,
      confidence: { amount: 97, date: 97, merchant: 97, currency: 97, account: 97, category: 97 },
    },
  },
};
const lookup = { accounts: ACCOUNTS, categories: CATEGORIES, baseCurrency: 'IDR' };

/** The picker triggers are named by their field label. */
const trigger = (label: string) => page.getByRole('button', { name: label, exact: true });

/** Sets the time in the date picker, then "2 days ago" (18 Oct, two days before `TODAY`). */
async function pickTwoDaysAgoAt(time: string) {
  await userEvent.click(trigger('Date and time'));
  await userEvent.fill(page.getByLabelText('Time', { exact: true }), time);
  await userEvent.click(page.getByRole('button', { name: /^2 days ago/ }));
}

async function pickAccount(displayName: string) {
  await userEvent.click(trigger('Account'));
  await userEvent.click(page.getByRole('option', { name: new RegExp(`^${displayName}`) }));
}

describe('Gmail correction and explicit review', () => {
  it('never records a 97% result merely by rendering; exposes minimal source evidence and confirms only on click', async () => {
    const onConfirm = vi.fn();
    const onIgnore = vi.fn();
    await renderApp(
      <GmailReviewCard
        item={item}
        lookup={lookup}
        locale="en"
        timeZone="Asia/Jakarta"
        today={TODAY}
        pending={false}
        onConfirm={onConfirm}
        onIgnore={onIgnore}
      />,
      { preferences: { locale: 'en' } },
    );
    expect(onConfirm).not.toHaveBeenCalled();
    await expect.element(trigger('Date and time')).toHaveTextContent('Oct 18, 2026, 09:00');
    await expect.element(page.getByLabelText('Title', { exact: true })).toHaveValue('PLN');
    await expect.element(trigger('Account')).toHaveTextContent(account.displayName);
    await userEvent.click(page.getByText('Email evidence'));
    await expect.element(page.getByText('Private payment evidence 350000 IDR')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Open in Gmail' }))
      .toHaveAttribute('href', 'https://mail.google.com/mail/u/0/#all/mail-id');
    await userEvent.click(page.getByRole('button', { name: 'Record', exact: true }));
    expect(onConfirm).toHaveBeenCalledWith({
      amountMinor: 350000n,
      accountId: account.id,
      categoryId: category.id,
      merchant: 'PLN',
      occurredAt: new Date('2026-10-18T02:00:00Z'),
    });
    expect(onIgnore).not.toHaveBeenCalled();
  });
  it('shows the AI confidence beside each field and flags an unsure one', async () => {
    const unsure: GmailReviewItem = {
      ...item,
      payload: {
        ...item.payload,
        extraction: {
          ...item.payload.extraction,
          confidence: { ...item.payload.extraction.confidence, date: 62 },
        },
      },
    };
    await renderApp(
      <GmailReviewCard
        item={unsure}
        lookup={lookup}
        locale="en"
        timeZone="Asia/Jakarta"
        today={TODAY}
        pending={false}
        onConfirm={vi.fn()}
        onIgnore={vi.fn()}
      />,
      { preferences: { locale: 'en' } },
    );
    await expect.element(page.getByText('62%', { exact: true })).toHaveClass('text-amber-fg');
    const sure = page.getByText('97%', { exact: true });
    await expect.element(sure.first()).toHaveClass('text-subtle');
    expect(sure.elements()).toHaveLength(4);
  });
  it('keeps missing amount/date/account/category/merchant unknown and disables confirmation until corrected', async () => {
    const onConfirm = vi.fn<Parameters<typeof GmailReviewCard>[0]['onConfirm']>();
    const missing: GmailReviewItem = {
      ...item,
      payload: {
        ...item.payload,
        extraction: {
          ...item.payload.extraction,
          amountMinor: null,
          occurredAt: null,
          currency: 'USD',
          accountId: null,
          categoryId: null,
          merchant: null,
        },
      },
    };
    await renderApp(
      <GmailReviewCard
        item={missing}
        lookup={lookup}
        locale="en"
        timeZone="Asia/Jakarta"
        today={TODAY}
        pending={false}
        onConfirm={onConfirm}
        onIgnore={vi.fn()}
      />,
      { preferences: { locale: 'en' } },
    );
    const record = page.getByRole('button', { name: 'Record', exact: true });
    await expect.element(record).toBeDisabled();
    await expect.element(trigger('Date and time')).toHaveTextContent('unknown');
    await expect.element(trigger('Account')).toHaveTextContent('Pick an account');
    await expect.element(trigger('Category')).toHaveTextContent('Choose a category');
    await userEvent.fill(page.getByLabelText('Amount', { exact: true }), '350000');
    await pickTwoDaysAgoAt('09:30');
    await expect.element(trigger('Date and time')).toHaveTextContent('Oct 18, 2026, 09:30');
    await userEvent.fill(page.getByLabelText('Title', { exact: true }), 'PLN');
    await pickAccount(account.displayName);
    await expect.element(trigger('Account')).toHaveTextContent(account.displayName);
    await userEvent.click(trigger('Category'));
    await userEvent.click(page.getByRole('option', { name: categoryName(category), exact: true }));
    await expect.element(trigger('Category')).toHaveTextContent(categoryName(category));
    await expect.element(record).toBeEnabled();
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(record);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0]?.[0]).toEqual({
      amountMinor: 350000n,
      accountId: account.id,
      categoryId: category.id,
      merchant: 'PLN',
      occurredAt: new Date('2026-10-18T02:30:00Z'),
    });
  });
  it('ignores without financial edits and hides source text in privacy mode', async () => {
    const onIgnore = vi.fn();
    const onConfirm = vi.fn();
    await renderApp(
      <GmailReviewCard
        item={item}
        lookup={lookup}
        locale="en"
        timeZone="Asia/Jakarta"
        today={TODAY}
        pending={false}
        onConfirm={onConfirm}
        onIgnore={onIgnore}
      />,
      {
        preferences: { locale: 'en', balancesHidden: true },
      },
    );
    await userEvent.click(page.getByText('Email evidence'));
    await expect.element(page.getByText('Private payment evidence 350000 IDR')).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Ignore', exact: true }));
    expect(onIgnore).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('refuses an AI-suggested account in another currency than the email until the user picks one', async () => {
    const onConfirm = vi.fn<Parameters<typeof GmailReviewCard>[0]['onConfirm']>();
    const usdEmail: GmailReviewItem = {
      ...item,
      payload: { ...item.payload, extraction: { ...item.payload.extraction, amountMinor: 1250n, currency: 'USD' } },
    };
    await renderApp(
      <GmailReviewCard
        item={usdEmail}
        lookup={lookup}
        locale="en"
        timeZone="Asia/Jakarta"
        today={TODAY}
        pending={false}
        onConfirm={onConfirm}
        onIgnore={vi.fn()}
      />,
      { preferences: { locale: 'en' } },
    );
    const record = page.getByRole('button', { name: 'Record', exact: true });
    await expect.element(page.getByRole('status')).toHaveTextContent('Check the account details.');
    await expect.element(record).toBeDisabled();
    const other = ACCOUNTS.find((entry) => entry.status === 'active' && entry.id !== account.id);
    if (other === undefined) throw new Error('Missing second account');
    await pickAccount(other.displayName);
    await expect.element(page.getByRole('status')).not.toBeInTheDocument();
    await userEvent.click(record);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ accountId: other.id, amountMinor: 1250n }));
  });
  it('confirms with Enter from a field once every value is known, and never without a date', async () => {
    const onConfirm = vi.fn();
    const undated: GmailReviewItem = {
      ...item,
      payload: { ...item.payload, extraction: { ...item.payload.extraction, occurredAt: null } },
    };
    await renderApp(
      <GmailReviewCard
        item={undated}
        lookup={lookup}
        locale="en"
        timeZone="Asia/Jakarta"
        today={TODAY}
        pending={false}
        onConfirm={onConfirm}
        onIgnore={vi.fn()}
      />,
      { preferences: { locale: 'en' } },
    );
    const title = page.getByLabelText('Title', { exact: true });
    await userEvent.type(title, '{Enter}');
    await expect.element(page.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
    await pickTwoDaysAgoAt('09:30');
    await userEvent.type(title, '{Enter}');
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ occurredAt: new Date('2026-10-18T02:30:00Z') }));
  });
  it('flags an incomplete extraction in privacy mode without revealing or recording it', async () => {
    const onConfirm = vi.fn();
    const incomplete: GmailReviewItem = {
      ...item,
      payload: {
        ...item.payload,
        errorCode: 'AI_INVALID_RESPONSE',
        extraction: { ...item.payload.extraction, amountMinor: null },
      },
    };
    await renderApp(
      <GmailReviewCard
        item={incomplete}
        lookup={lookup}
        locale="en"
        timeZone="Asia/Jakarta"
        today={TODAY}
        pending={false}
        onConfirm={onConfirm}
        onIgnore={vi.fn()}
      />,
      { preferences: { locale: 'en', balancesHidden: true } },
    );
    await expect.element(page.getByRole('status')).toHaveTextContent('Check every field before confirming.');
    await expect.element(page.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
    expect(document.body.textContent).not.toContain('PLN payment');
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('reads an amount without a known currency or account in the base currency until an account is chosen', async () => {
    const unknown: GmailReviewItem = {
      ...item,
      payload: { ...item.payload, extraction: { ...item.payload.extraction, currency: null, accountId: null } },
    };
    await renderApp(
      <GmailReviewCard
        item={unknown}
        lookup={{ ...lookup, baseCurrency: 'USD' }}
        locale="en"
        timeZone="Asia/Jakarta"
        today={TODAY}
        pending={false}
        onConfirm={vi.fn()}
        onIgnore={vi.fn()}
      />,
      { preferences: { locale: 'en' } },
    );
    await expect
      .element(page.getByText(formatMoney(350000n, 'USD', { locale: 'en', context: 'amount' })))
      .toBeVisible();
    await expect
      .element(page.getByLabelText('Amount', { exact: true }))
      .toHaveValue(formatMoney(350000n, 'USD', { locale: 'en', context: 'table' }));
    await expect.element(page.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
    await pickAccount(account.displayName);
    await expect
      .element(page.getByText(formatMoney(350000n, 'IDR', { locale: 'en', context: 'amount' })))
      .toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
  });
});
