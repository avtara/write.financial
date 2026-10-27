// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { GMAIL_ITEM } from '../../../test/review-fixtures.ts';
import { ACCOUNTS, CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { GmailReviewItem } from './review-model.ts';
import { GmailReviewCard } from './gmail-review-card.tsx';
const account = ACCOUNTS.find((entry) => entry.currency === 'IDR');
const category = CATEGORIES.find((entry) => entry.kind === 'expense');
if (account === undefined || category === undefined) throw new Error('Missing financial fixtures');
const item: GmailReviewItem = {
  ...GMAIL_ITEM,
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
        pending={false}
        onConfirm={onConfirm}
        onIgnore={onIgnore}
      />,
      { preferences: { locale: 'en' } },
    );
    expect(onConfirm).not.toHaveBeenCalled();
    await expect.element(page.getByLabelText(/Date and time/)).toHaveValue('2026-10-18T09:00');
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
        pending={false}
        onConfirm={onConfirm}
        onIgnore={vi.fn()}
      />,
      { preferences: { locale: 'en' } },
    );
    const record = page.getByRole('button', { name: 'Record', exact: true });
    await expect.element(record).toBeDisabled();
    await userEvent.fill(page.getByLabelText('Amount · 97%'), '350000');
    await userEvent.fill(page.getByLabelText(/Date and time/), '2026-10-18T09:30');
    await userEvent.fill(page.getByLabelText('Merchant · 97%'), 'PLN');
    await userEvent.selectOptions(page.getByLabelText('Account · 97%'), account.id);
    await userEvent.selectOptions(page.getByLabelText('Category · 97%'), category.id);
    await expect.element(record).toBeEnabled();
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(record);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0]?.[0].occurredAt).toEqual(new Date('2026-10-18T02:30:00Z'));
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
});
