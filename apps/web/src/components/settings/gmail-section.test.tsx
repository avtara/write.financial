// SPDX-License-Identifier: AGPL-3.0-only
import type { EmailLogView, GmailConnectionView } from '@wf/db/gmail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const reauth = vi.hoisted(() => ({ reauthenticate: vi.fn() }));
vi.mock('./reauth.tsx', () => ({
  useReauthentication: () => ({ reauthenticate: reauth.reauthenticate, dialog: null }),
}));
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
afterEach(() => {
  // OAuth returns and the fixture "redirect" only ever change the hash; leave the next test a clean URL.
  history.replaceState(null, '', `${location.pathname}${location.search}`);
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
  it('continues to the server’s consent URL after a fresh sign-in, and not after a cancelled one', async () => {
    rpc.startGmailConnect
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockResolvedValueOnce({ ok: true, value: { url: '#gmail-consent-fixture' } });
    reauth.reauthenticate.mockResolvedValueOnce(true);
    await render({ connection: null });
    await userEvent.click(page.getByRole('button', { name: 'Continue with Google' }));
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Continue with Google' }));
    await vi.waitFor(() => {
      expect(location.hash).toBe('#gmail-consent-fixture');
    });
    expect(rpc.startGmailConnect).toHaveBeenCalledTimes(2);

    history.replaceState(null, '', `${location.pathname}${location.search}`);
    rpc.startGmailConnect.mockResolvedValueOnce({ ok: false, code: 'SESSION_NOT_FRESH' });
    reauth.reauthenticate.mockResolvedValueOnce(false);
    await userEvent.click(page.getByRole('button', { name: 'Continue with Google' }).first());
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Continue with Google' }));
    await vi.waitFor(() => {
      expect(toast.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    });
    expect(rpc.startGmailConnect).toHaveBeenCalledTimes(3);
    expect(location.hash).toBe('');
  });
  it('reports an unreachable server instead of leaving for Google', async () => {
    rpc.startGmailConnect
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockRejectedValueOnce(new Error('offline'));
    reauth.reauthenticate.mockResolvedValueOnce(true);
    await render({ connection: null });
    await userEvent.click(page.getByRole('button', { name: 'Continue with Google' }));
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Continue with Google' }));
    await vi.waitFor(() => {
      expect(toast.toast).toHaveBeenCalledWith({ tone: 'error', title: 'The action failed. Try again.' });
    });
    expect(location.hash).toBe('');
    // Also when the retry after signing in again cannot reach the server.
    toast.toast.mockClear();
    await userEvent.click(page.getByRole('button', { name: 'Continue with Google' }));
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Continue with Google' }));
    await vi.waitFor(() => {
      expect(toast.toast).toHaveBeenCalledWith({ tone: 'error', title: 'The action failed. Try again.' });
    });
    expect(rpc.startGmailConnect).toHaveBeenCalledTimes(3);
    expect(location.hash).toBe('');
  });
  it.each([
    ['#gmail-connected', { tone: 'success', title: 'Connected' }],
    ['#gmail-failed', { tone: 'error', title: 'The action failed. Try again.' }],
  ])('announces the OAuth return %s', async (hash, expected) => {
    history.replaceState(null, '', hash);
    await render();
    expect(toast.toast).toHaveBeenCalledWith(expected);
  });
  it('saves the parsed sender and keyword lists, and keeps them when saving fails', async () => {
    rpc.updateFilters
      .mockResolvedValueOnce({ ok: false, code: 'GMAIL_REVOKED' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, value: connection });
    await render();
    await userEvent.fill(page.getByRole('textbox', { name: 'From senders' }), ' bank.test , ,pln.test');
    await userEvent.fill(page.getByRole('textbox', { name: 'Email contains' }), 'tagihan, payment');
    const save = page.getByRole('button', { name: 'Save changes' });
    const expected = {
      senders: ['bank.test', 'pln.test'],
      keywords: ['tagihan', 'payment'],
      ignoreKeywords: ['promo'],
    };
    await userEvent.click(save);
    await expect.element(page.getByRole('alert')).toBeVisible();
    await userEvent.click(save);
    await expect.element(page.getByRole('alert')).toHaveTextContent('The action failed. Try again.');
    await userEvent.click(save);
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
    expect(rpc.updateFilters.mock.calls).toEqual([[{ data: expected }], [{ data: expected }], [{ data: expected }]]);
    expect(toast.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Filters saved' });
  });
  it('explains each dry-run verdict, masks it in privacy mode, and reports an unreachable test', async () => {
    rpc.testFilters
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { fromAddr: 'pay@bank.test', subject: 'PLN payment', verdict: 'passed' },
          { fromAddr: 'news@shop.test', subject: 'Weekly deals', verdict: 'filtered' },
        ],
      })
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockRejectedValueOnce(new Error('offline'));
    await render({}, true);
    const run = page.getByRole('button', { name: 'Test with the last 5 emails' });
    const results = page.getByRole('region', { name: 'Test the filter' });
    await userEvent.click(run);
    await expect.element(results).toMatchTextContent('Passed');
    await expect.element(results).toMatchTextContent('No match');
    expect(results.element().textContent).not.toContain('news@shop.test');
    await userEvent.click(run);
    await expect.element(results).toMatchTextContent('No emails to test yet.');
    await userEvent.click(run);
    await expect.element(results.getByRole('alert')).toHaveTextContent('The test failed.');
  });
  it('keeps the connection when disconnecting fails', async () => {
    rpc.disconnectGmail.mockRejectedValueOnce(new Error('offline'));
    const { router } = await render();
    const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await userEvent.click(page.getByRole('button', { name: 'Disconnect', exact: true }));
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect', exact: true }));
    await vi.waitFor(() => {
      expect(toast.toast).toHaveBeenCalledWith({ tone: 'error', title: 'The action failed. Try again.' });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('hides the connected address in privacy mode', async () => {
    await render({}, true);
    await expect.element(page.getByText('Connected', { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain('fixture@gmail.com');
  });
  it('logs filtered, unread, and incomplete extractions without guessing what is unknown', async () => {
    await render({ log: [] });
    await expect.element(page.getByText('No emails processed yet.')).toBeVisible();
    await render({
      log: [
        { ...log, id: 'filtered', filterResult: 'filtered', outcome: 'filtered', confidence: null, extraction: null },
        {
          ...log,
          id: 'partial',
          errorCode: 'AI_INVALID_RESPONSE',
          extraction: {
            amountMinor: 1250n,
            currency: null,
            merchant: null,
            occurredAt: null,
            accountId: null,
            categoryId: null,
            confidence: { amount: 40, date: 0, merchant: 0, currency: 0, account: 0, category: 0 },
          },
        },
      ],
    });
    const rows = page.getByRole('table').last().getByRole('row');
    await expect.element(rows.nth(1)).toMatchTextContent('No match');
    await expect.element(rows.nth(1)).toMatchTextContent('—');
    await expect.element(rows.nth(2)).toMatchTextContent('Check every field before confirming.');
    await userEvent.click(rows.nth(2).getByText('Email evidence'));
    await expect.element(rows.nth(2)).toMatchTextContent('unknown');
    expect(rows.nth(2).element().textContent).not.toMatch(/Rp|IDR/);
  });
});
