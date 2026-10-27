// SPDX-License-Identifier: AGPL-3.0-only
import type { EmailLogView, GmailConnectionView } from '@wf/db/gmail';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { GmailSettings } from '../../server/fn/gmail.ts';
import { GmailSection } from './gmail-section.tsx';
const rpc = vi.hoisted(() => ({
  disconnectGmail: vi.fn(),
  startGmailConnect: vi.fn(),
  testFilters: vi.fn(),
  updateFilters: vi.fn(),
}));
vi.mock('../../server/fn/gmail.ts', () => rpc);
vi.mock('../../server/fn/account.ts', () => ({ revokeDevice: vi.fn() }));
const toast = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toast);
const now = new Date('2026-10-18T02:00:00Z');
const filters = { senders: ['bank.test'], keywords: ['payment'], ignoreKeywords: ['promo'] };
const connection: GmailConnectionView = {
  email: 'fixture@gmail.com',
  grantId: 'grant',
  status: 'connected',
  filters,
  historyId: '501',
  watchRenewedAt: now,
  watchExpiresAt: now,
  createdAt: now,
  updatedAt: now,
};
const log: EmailLogView = {
  id: 'log',
  messageId: 'mail',
  fromAddr: 'pay@bank.test',
  subject: 'PLN payment',
  filterResult: 'passed',
  outcome: 'pending',
  processing: 'done',
  errorCode: null,
  confidence: 97,
  extraction: {
    amountMinor: 350000n,
    occurredAt: now,
    merchant: 'PLN',
    currency: 'IDR',
    accountId: null,
    categoryId: null,
    confidence: { amount: 97, date: 95, merchant: 90, currency: 97, account: 0, category: 0 },
  },
  receivedAt: now,
  createdAt: now,
  reviewItemId: 'review',
};
const settings: GmailSettings = {
  configured: true,
  connection,
  stats: { received: 2, passed: 1, pending: 1, confirmed: 0, ignored: 0, duplicate: 1, filtered: 1 },
  log: [log],
};
const render = (overrides: Partial<GmailSettings> = {}, hidden = false) =>
  renderApp(
    <GmailSection
      settings={{ ...settings, ...overrides }}
      timeZone="Asia/Jakarta"
      viewer={{ email: 'fixture@example.test', sessionId: 'session' }}
    />,
    { preferences: { locale: 'en', balancesHidden: hidden } },
  );
beforeEach(() => {
  vi.resetAllMocks();
  rpc.updateFilters.mockResolvedValue({ ok: true, value: connection });
  rpc.testFilters.mockResolvedValue({
    ok: true,
    value: [{ fromAddr: 'pay@bank.test', subject: 'PLN payment', verdict: 'ignored_keyword' }],
  });
  rpc.disconnectGmail.mockResolvedValue({ ok: true, value: { ...connection, status: 'revoked' } });
  rpc.startGmailConnect.mockResolvedValue({ ok: false, code: 'TWO_FACTOR_REQUIRED' });
});
describe('Gmail settings interaction', () => {
  it('requires explicit consent before starting OAuth and explains current-2FA refusal', async () => {
    await render({ connection: null });
    await userEvent.click(page.getByRole('button', { name: 'Continue with Google' }));
    expect(rpc.startGmailConnect).not.toHaveBeenCalled();
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Continue with Google' }));
    expect(rpc.startGmailConnect).toHaveBeenCalledWith({ data: { consent: true } });
    expect(toast.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
  });
  it('does not allow connect/reconnect when the operator disabled restricted Gmail access', async () => {
    await render({ configured: false, connection: null });
    await expect.element(page.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    expect(rpc.startGmailConnect).not.toHaveBeenCalled();
  });
  it('locks confirmation, tests UNSAVED filters without saving, then saves exactly the user edits', async () => {
    await render();
    await expect
      .element(page.getByRole('checkbox', { name: 'Always ask for confirmation before saving' }))
      .toBeChecked();
    await expect
      .element(page.getByRole('checkbox', { name: 'Always ask for confirmation before saving' }))
      .toBeDisabled();
    await userEvent.fill(page.getByRole('textbox', { name: 'Ignore if it contains' }), 'promo, PLN');
    await userEvent.click(page.getByRole('button', { name: 'Test with the last 5 emails' }));
    expect(rpc.testFilters).toHaveBeenCalledWith({ data: { ...filters, ignoreKeywords: ['promo', 'PLN'] } });
    expect(rpc.updateFilters).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole('button', { name: 'Save changes' }));
    expect(rpc.updateFilters).toHaveBeenCalledWith({ data: { ...filters, ignoreKeywords: ['promo', 'PLN'] } });
    await expect.element(page.getByRole('link', { name: 'Download CSV' })).toHaveAttribute('href', '/api/gmail/log');
  });
  it('shows per-field extraction confidence and requires a disconnect confirmation', async () => {
    await render();
    await userEvent.click(page.getByRole('table').getByText('Email evidence'));
    await expect.element(page.getByRole('table').getByText('PLN', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('table').getByText('Amount · 97%')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Disconnect', exact: true }));
    expect(rpc.disconnectGmail).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect', exact: true }));
    expect(rpc.disconnectGmail).toHaveBeenCalledWith({ data: {} });
  });
  it('hides financial email text in privacy mode and offers a real reconnect after revocation', async () => {
    await render({ connection: { ...connection, status: 'revoked' } }, true);
    await expect.element(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
    await expect.element(page.getByText('PLN payment', { exact: true })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Reconnect' }));
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }));
    expect(rpc.startGmailConnect).not.toHaveBeenCalled();
  });
  it('exposes dry-run errors without overwriting saved state', async () => {
    rpc.testFilters.mockResolvedValue({ ok: false, code: 'GMAIL_REVOKED' });
    await render();
    await userEvent.click(page.getByRole('button', { name: 'Test with the last 5 emails' }));
    await expect.element(page.getByRole('alert')).toBeVisible();
    expect(rpc.updateFilters).not.toHaveBeenCalled();
  });
});
