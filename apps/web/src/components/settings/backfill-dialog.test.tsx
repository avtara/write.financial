// SPDX-License-Identifier: AGPL-3.0-only
import type { RuleBackfillPreview, RuleBackfillProposal } from '@wf/db/rule-backfill';
import type { LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { m } from '@wf/i18n/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ACCOUNTS, CATEGORIES, categoryId } from '../../../test/ledger-fixtures.ts';
import { toast, Toaster } from '@wf/ui/toast';
import { renderApp } from '../../../test/render.tsx';
import { RuleBackfillDialog } from './backfill-dialog.tsx';

const server = vi.hoisted(() => ({
  requestRuleBackfill: vi.fn(),
  getRuleBackfillResult: vi.fn(),
  applyRuleBackfill: vi.fn(),
}));
vi.mock('../../server/fn/rules.ts', () => server);

const food = categoryId('system:food');
const transport = categoryId('system:transport');

const proposal = (overrides: Partial<RuleBackfillProposal> = {}): RuleBackfillProposal => ({
  transactionId: 'tx-1',
  localDate: '2026-10-05' as LocalDate,
  description: 'Gojek ke kantor',
  currentCategoryId: food,
  proposedCategoryId: transport,
  currentTags: [],
  proposedTags: ['kantor'],
  ruleId: 'r-1',
  ruleName: 'Berangkat ke kantor',
  noop: false,
  blocked: null,
  version: 'tx-v1',
  ...overrides,
});

const preview = (proposals: RuleBackfillProposal[], patch: Partial<RuleBackfillPreview> = {}): RuleBackfillPreview => ({
  proposals,
  totals: {
    matched: proposals.length,
    changes: proposals.filter((entry) => entry.blocked === null && !entry.noop).length,
    noops: proposals.filter((entry) => entry.blocked === null && entry.noop).length,
    blocked: proposals.filter((entry) => entry.blocked !== null).length,
  },
  ruleIds: ['r-1'],
  version: 'rules-v1',
  truncated: false,
  ...patch,
});

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = { ok: false as const, code: 'NOT_FOUND' };

/** One queued proposal build: the request returns its job id and the next poll completes with `value`. */
const queuePreview = (value: RuleBackfillPreview) => {
  server.requestRuleBackfill.mockReturnValueOnce(ok({ jobId: 'job' }));
  server.getRuleBackfillResult.mockReturnValueOnce(ok({ status: 'completed', preview: value }));
};

const dialog = () => page.getByRole('dialog', { name: m.rules_backfill_title() });
const screens: { unmount: () => Promise<void> }[] = [];

async function render(open = true, ruleIds?: readonly string[]) {
  const onOpenChange = vi.fn();
  const result = await renderApp(
    <>
      <RuleBackfillDialog
        open={open}
        onOpenChange={onOpenChange}
        {...(ruleIds === undefined ? {} : { ruleIds })}
        categories={CATEGORIES}
        accounts={ACCOUNTS}
      />
      <Toaster label="Notifikasi" />
    </>,
  );
  screens.push(result.screen);
  return { ...result, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  toast.dismiss();
  await Promise.all(screens.splice(0).map((screen) => screen.unmount()));
});

describe('RuleBackfillDialog', () => {
  it('lists changed, no-op, and every blocked kind, then applies the selection after confirmation', async () => {
    const noop = proposal({
      transactionId: 'tx-2',
      description: 'Kopi',
      proposedCategoryId: food,
      proposedTags: [],
      noop: true,
    });
    const blocked = [
      proposal({ transactionId: 'tx-3', description: 'Tutup', blocked: 'closed_period' }),
      proposal({ transactionId: 'tx-4', description: 'Arsip', blocked: 'category_unavailable' }),
      proposal({ transactionId: 'tx-5', description: 'Tag', blocked: 'tag_limit' }),
      proposal({ transactionId: 'tx-6', description: 'Kelola', blocked: 'managed' }),
    ];
    queuePreview(preview([proposal(), noop, ...blocked], { truncated: true }));
    server.applyRuleBackfill.mockReturnValueOnce(
      ok({ applied: ['tx-1'], skipped: [{ transactionId: 'tx-2', reason: 'noop' }], rulesChanged: false }),
    );
    queuePreview(preview([noop, ...blocked]));
    const { onOpenChange } = await render();

    await expect.element(dialog()).toBeInTheDocument();
    await expect.element(page.getByText('Gojek ke kantor')).toBeInTheDocument();
    await expect.element(page.getByText(m.rules_backfill_truncated())).toBeInTheDocument();
    await expect.element(page.getByText(m.rules_backfill_noop())).toBeInTheDocument();
    for (const label of [
      m.rules_block_closed(),
      m.rules_block_category(),
      m.rules_block_tag_limit(),
      m.rules_block_managed(),
    ]) {
      await expect.element(page.getByText(label)).toBeInTheDocument();
    }
    await expect.element(page.getByRole('checkbox', { name: 'Gojek ke kantor' })).toBeChecked();

    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }));
    const alert = page.getByRole('alertdialog');
    await expect.element(alert).toBeInTheDocument();
    await userEvent.click(alert.getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }));
    expect(server.applyRuleBackfill).toHaveBeenCalledWith({
      data: {
        ruleIds: ['r-1'],
        version: 'rules-v1',
        items: [{ transactionId: 'tx-1', version: 'tx-v1' }],
      },
    });
    await expect.element(page.getByText(m.rules_backfill_result({ applied: 1, skipped: 1 }))).toBeInTheDocument();
    expect(server.requestRuleBackfill).toHaveBeenCalledTimes(2);
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_done() }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('selects all and none; rows that cannot change stay disabled', async () => {
    queuePreview(preview([proposal(), proposal({ transactionId: 'tx-2', description: 'Kopi', noop: true })]));
    await render();
    const all = page.getByRole('checkbox', { name: m.rules_backfill_select_all() });
    await expect.element(all).toBeChecked();
    await userEvent.click(all);
    await expect.element(page.getByRole('button', { name: m.rules_backfill_apply({ count: 0 }) })).toBeDisabled();
    await expect.element(page.getByRole('checkbox', { name: 'Kopi' })).toBeDisabled();
    await userEvent.click(page.getByRole('checkbox', { name: 'Gojek ke kantor' }));
    await expect.element(page.getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) })).toBeEnabled();
    await userEvent.click(page.getByRole('checkbox', { name: 'Gojek ke kantor' }));
    await userEvent.click(all);
    await expect.element(page.getByRole('checkbox', { name: 'Gojek ke kantor' })).toBeChecked();
    await userEvent.click(page.getByRole('checkbox', { name: 'Gojek ke kantor' }));
    await expect.element(page.getByRole('button', { name: m.rules_backfill_apply({ count: 0 }) })).toBeDisabled();
  });

  it('shows an empty list and closes with Done', async () => {
    queuePreview(preview([]));
    const { onOpenChange } = await render();
    await expect.element(page.getByText(m.rules_backfill_empty())).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_done() }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports a failed job, then a pending job until it completes', async () => {
    server.requestRuleBackfill.mockReturnValue(ok({ jobId: 'job' }));
    server.getRuleBackfillResult
      .mockReturnValueOnce(ok({ status: 'failed' }))
      .mockReturnValueOnce(ok({ status: 'pending' }))
      .mockReturnValueOnce(ok({ status: 'completed', preview: preview([proposal()]) }));
    await render();
    await expect.element(page.getByText(m.rules_backfill_failed())).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_retry() }));
    await expect.element(page.getByText('Gojek ke kantor')).toBeInTheDocument();
  });

  it('reports a rejected job result and a rejected result body', async () => {
    server.requestRuleBackfill.mockReturnValue(ok({ jobId: 'job' }));
    server.getRuleBackfillResult.mockRejectedValueOnce(new TypeError('offline'));
    await render();
    await expect.element(page.getByText(m.rules_backfill_failed())).toBeInTheDocument();
    server.getRuleBackfillResult.mockReturnValueOnce(Promise.resolve(failed));
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_retry() }));
    await expect.element(page.getByRole('alert')).toBeInTheDocument();
  });

  it('reports an unreachable preview server', async () => {
    server.requestRuleBackfill.mockRejectedValueOnce(new TypeError('offline'));
    await render();
    await expect.element(page.getByText(m.rules_backfill_failed())).toBeInTheDocument();
  });

  it('retries a failed load and reports a failed apply', async () => {
    server.requestRuleBackfill.mockReturnValueOnce(Promise.resolve(failed));
    queuePreview(preview([proposal()]));
    await render();
    await expect.element(page.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_retry() }));
    await expect.element(page.getByText('Gojek ke kantor')).toBeInTheDocument();

    server.applyRuleBackfill.mockReturnValueOnce(Promise.resolve(failed));
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }));
    await userEvent.click(
      page.getByRole('alertdialog').getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }),
    );
    await expect.element(page.getByText(m.rules_backfill_apply_failed())).toBeInTheDocument();
  });

  it('shows an untitled row with its tags and a zero-skip result', async () => {
    queuePreview(
      preview([
        proposal({
          description: null,
          currentTags: ['lama'],
          proposedTags: ['lama', 'baru'],
        }),
      ]),
    );
    server.applyRuleBackfill.mockReturnValueOnce(ok({ applied: ['tx-1'], skipped: [], rulesChanged: false }));
    queuePreview(preview([]));
    await render();
    await expect.element(page.getByText(m.rules_untitled())).toBeInTheDocument();
    await expect.element(page.getByText('#lama').nth(0)).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }));
    await userEvent.click(
      page.getByRole('alertdialog').getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }),
    );
    await expect.element(page.getByText(m.rules_backfill_result({ applied: 1, skipped: 0 }))).toBeInTheDocument();
  });

  it('warns when the rules changed since the preview', async () => {
    queuePreview(preview([proposal()]));
    server.applyRuleBackfill.mockReturnValueOnce(
      ok({ applied: [], skipped: [{ transactionId: 'tx-1', reason: 'stale' }], rulesChanged: true }),
    );
    queuePreview(preview([proposal()]));
    await render();
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }));
    await userEvent.click(
      page.getByRole('alertdialog').getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }),
    );
    await expect.element(page.getByText(m.rules_backfill_rules_changed())).toBeInTheDocument();
  });

  it('reports a rejected apply without leaking an error', async () => {
    queuePreview(preview([proposal()]));
    server.applyRuleBackfill.mockRejectedValueOnce(new TypeError('offline'));
    await render();
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }));
    await userEvent.click(
      page.getByRole('alertdialog').getByRole('button', { name: m.rules_backfill_apply({ count: 1 }) }),
    );
    await expect.element(page.getByText(m.rules_backfill_apply_failed())).toBeInTheDocument();
  });

  it('stops polling when unmounted', async () => {
    const pending = Promise.withResolvers<unknown>();
    server.requestRuleBackfill.mockReturnValueOnce(ok({ jobId: 'job' }));
    server.getRuleBackfillResult.mockReturnValueOnce(pending.promise);
    const result = await render();
    await vi.waitFor(() => {
      expect(server.getRuleBackfillResult).toHaveBeenCalledTimes(1);
    });
    await result.screen.unmount();
    pending.resolve(ok({ status: 'pending' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.getRuleBackfillResult).toHaveBeenCalledTimes(1);
  });

  it('ignores a superseded request when the rule scope changes', async () => {
    const oldRequest = Promise.withResolvers<unknown>();
    server.requestRuleBackfill.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(ok({ jobId: 'new' }));
    server.getRuleBackfillResult.mockReturnValueOnce(
      ok({ status: 'completed', preview: preview([proposal({ description: 'Baru' })]) }),
    );
    function Scoped() {
      const [scope, setScope] = useState<readonly string[]>(['r-1']);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setScope(['r-2']);
            }}
          >
            Ganti cakupan
          </button>
          <RuleBackfillDialog open onOpenChange={vi.fn()} ruleIds={scope} categories={CATEGORIES} accounts={ACCOUNTS} />
        </>
      );
    }
    const screen = await renderApp(<Scoped />);
    screens.push(screen.screen);
    // The modal makes the page behind it inert; this harness control is clicked directly.
    const scopeSwitch = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Ganti cakupan',
    );
    if (scopeSwitch === undefined) throw new Error('no scope switch');
    scopeSwitch.click();
    await expect.element(page.getByText('Baru')).toBeInTheDocument();
    oldRequest.resolve(ok({ jobId: 'old' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.getRuleBackfillResult).toHaveBeenCalledTimes(1);
    expect(server.getRuleBackfillResult).toHaveBeenCalledWith({ data: { jobId: 'new' } });
  });

  it('loads only while open and passes the editor’s rule ids', async () => {
    queuePreview(preview([]));
    const closed = await render(false, ['r-1']);
    expect(server.requestRuleBackfill).not.toHaveBeenCalled();
    await closed.screen.unmount();
    await render(true, ['r-1']);
    expect(server.requestRuleBackfill).toHaveBeenLastCalledWith({ data: { ruleIds: ['r-1'] } });
    await expect.element(page.getByText(m.rules_backfill_empty())).toBeInTheDocument();
  });
});
