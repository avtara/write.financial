// SPDX-License-Identifier: AGPL-3.0-only
import type { RuleSuggestion } from '@wf/db/auto-rules';
import type { AutoRuleView } from '@wf/domain/rules';
import { m } from '@wf/i18n/messages';
import { toast, Toaster } from '@wf/ui/toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ACCOUNTS, CATEGORIES, TAGS, categoryId } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { RulesSection } from './rules-section.tsx';

const server = vi.hoisted(() => ({
  createAutoRule: vi.fn(),
  updateAutoRule: vi.fn(),
  deleteAutoRule: vi.fn(),
  setAutoRuleEnabled: vi.fn(),
  reorderAutoRules: vi.fn(),
  dismissRuleSuggestion: vi.fn(),
  previewAutoRule: vi.fn(),
  requestRuleBackfill: vi.fn(),
  getRuleBackfillResult: vi.fn(),
  applyRuleBackfill: vi.fn(),
}));
vi.mock('../../server/fn/rules.ts', () => server);

const AT = new Date('2026-10-15T02:00:00Z');
const screens: { unmount: () => Promise<void> }[] = [];
const food = categoryId('system:food');
const transport = categoryId('system:transport');
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = { ok: false as const, code: 'NOT_FOUND' };

const rule = (patch: Partial<AutoRuleView> = {}): AutoRuleView => ({
  id: 'r-1',
  name: 'Berangkat ke kantor',
  enabled: true,
  position: 0,
  conditions: [{ field: 'description', op: 'containsAny', values: ['gojek'] }],
  actions: [{ type: 'setCategory', categoryId: transport }],
  createdAt: AT,
  updatedAt: AT,
  ...patch,
});

const suggestion: RuleSuggestion = {
  key: 'kopi kenangan|food|transport',
  pattern: 'kopi kenangan',
  label: 'Kopi Kenangan',
  fromCategoryId: food,
  toCategoryId: transport,
  count: 4,
  lastCorrectedAt: AT,
};

const preview = {
  proposals: [],
  totals: { matched: 0, changes: 0, noops: 0, blocked: 0 },
  ruleIds: ['r-1'],
  version: 'rules-version',
  truncated: false,
};

async function render({
  rules = [rule(), rule({ id: 'r-2', name: 'Kopi', position: 1, enabled: false })],
  suggestions = [suggestion],
}: { rules?: readonly AutoRuleView[]; suggestions?: readonly RuleSuggestion[] } = {}) {
  const result = await renderApp(
    <>
      <RulesSection
        rules={rules}
        categories={CATEGORIES}
        tags={TAGS}
        suggestions={suggestions}
        accounts={ACCOUNTS}
        timeZone="Asia/Jakarta"
      />
      <Toaster label="Notifikasi" />
    </>,
  );
  screens.push(result.screen);
  return result;
}

afterEach(async () => {
  toast.dismiss();
  await Promise.all(screens.splice(0).map((screen) => screen.unmount()));
});

beforeEach(() => {
  vi.resetAllMocks();
  server.previewAutoRule.mockReturnValue(
    ok({
      trial: { categoryId: null, winningRule: null, tags: [], tagOverflow: false, rules: [] },
      period: { label: null, total: 0, matched: 0, samples: [] },
    }),
  );
  server.requestRuleBackfill.mockReturnValue(ok({ jobId: 'job' }));
  server.getRuleBackfillResult.mockReturnValue(ok({ status: 'completed', preview }));
});

describe('RulesSection', () => {
  it('shows the real counts, order, summaries, and suggestions', async () => {
    await render();
    await expect.element(page.getByText(m.rules_active_count({ count: 1 }))).toBeInTheDocument();
    await expect.element(page.getByText(m.rules_inactive_count({ count: 1 }))).toBeInTheDocument();
    await expect.element(page.getByText(m.rules_editor_no_conditions())).not.toBeInTheDocument();
    await expect.element(page.getByText('Deskripsi berisi salah satu: gojek').nth(0)).toBeInTheDocument();
    await expect.element(page.getByText('Kategori: Transportasi').nth(0)).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          m.rules_suggestion_text({
            count: 4,
            label: 'Kopi Kenangan',
            from: 'Makan & Dapur',
            to: 'Transportasi',
          }),
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: m.rules_apply_past() })).toBeEnabled();
  });

  it('creates a rule from a suggestion only after Save, with its dismissal key', async () => {
    server.createAutoRule.mockReturnValue(ok(rule({ id: 'new', name: 'Kopi Kenangan' })));
    await render();
    await userEvent.click(page.getByRole('button', { name: m.rules_suggestion_create() }));
    await expect.element(page.getByLabelText(m.rules_editor_name())).toHaveValue('Kopi Kenangan');
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_save() }));
    expect(server.createAutoRule).toHaveBeenCalledWith({
      data: {
        input: {
          name: 'Kopi Kenangan',
          enabled: true,
          conditions: [{ field: 'description', op: 'containsAny', values: ['Kopi Kenangan'] }],
          actions: [{ type: 'setCategory', categoryId: transport }],
        },
        suggestionKey: suggestion.key,
      },
    });
  });

  it('ignores a suggestion durably and reports a failed change', async () => {
    server.dismissRuleSuggestion.mockReturnValueOnce(ok(null));
    server.setAutoRuleEnabled.mockReturnValueOnce(Promise.resolve(failed));
    await render();
    await userEvent.click(page.getByRole('button', { name: m.rules_suggestion_ignore() }));
    expect(server.dismissRuleSuggestion).toHaveBeenCalledWith({ data: { key: suggestion.key } });
    await expect.element(page.getByText(m.rules_suggestion_ignored())).toBeInTheDocument();
    await userEvent.click(page.getByRole('switch', { name: m.rules_toggle({ name: 'Berangkat ke kantor' }) }));
    expect(server.setAutoRuleEnabled).toHaveBeenCalledWith({ data: { id: 'r-1', enabled: false } });
    await expect.element(page.getByText(m.rules_action_failed())).toBeInTheDocument();
  });

  it('reorders, edits, deletes, and opens the backfill for all rules', async () => {
    server.reorderAutoRules.mockReturnValue(ok(null));
    server.updateAutoRule.mockReturnValue(ok(rule()));
    server.deleteAutoRule.mockReturnValue(ok(null));
    await render();
    await userEvent.click(page.getByRole('button', { name: m.rules_move_down({ name: 'Berangkat ke kantor' }) }));
    expect(server.reorderAutoRules).toHaveBeenCalledWith({ data: { ids: ['r-2', 'r-1'] } });
    await userEvent.click(page.getByRole('button', { name: m.rules_move_up({ name: 'Kopi' }) }));
    expect(server.reorderAutoRules).toHaveBeenLastCalledWith({ data: { ids: ['r-2', 'r-1'] } });

    await userEvent.click(page.getByRole('button', { name: m.rules_edit({ name: 'Berangkat ke kantor' }) }));
    await expect.element(page.getByText(m.rules_editor_position({ position: 1 }))).toBeInTheDocument();
    await userEvent.fill(page.getByLabelText(m.rules_editor_name()), 'Pagi');
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_save() }));
    const [call] = server.updateAutoRule.mock.calls;
    const sent = call?.[0] as { data: { id: string; input: { name: string } } } | undefined;
    expect(sent?.data).toMatchObject({ id: 'r-1', input: { name: 'Pagi' } });

    await userEvent.click(page.getByRole('button', { name: m.rules_delete({ name: 'Berangkat ke kantor' }) }));
    const alert = page.getByRole('alertdialog');
    await userEvent.keyboard('{Escape}');
    await expect.element(alert).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_delete({ name: 'Berangkat ke kantor' }) }));
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: m.settings_cancel() }));
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_delete({ name: 'Berangkat ke kantor' }) }));
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: m.rules_delete_confirm() }));
    expect(server.deleteAutoRule).toHaveBeenCalledWith({ data: { id: 'r-1' } });

    await userEvent.click(page.getByRole('button', { name: m.rules_apply_past() }));
    expect(server.requestRuleBackfill).toHaveBeenCalledWith({ data: {} });
    await expect.element(page.getByRole('dialog', { name: m.rules_backfill_title() })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog', { name: m.rules_backfill_title() })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_apply_past() }));
    await userEvent.click(page.getByRole('button', { name: m.rules_backfill_done() }));
  });

  it('opens a blank rule, and its saved-rule backfill from the editor', async () => {
    await render();
    await userEvent.click(page.getByRole('button', { name: m.rules_new() }));
    await expect.element(page.getByLabelText(m.rules_editor_name())).toHaveValue('');
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_back() }));
    await userEvent.click(page.getByRole('button', { name: m.rules_edit({ name: 'Berangkat ke kantor' }) }));
    await userEvent.click(page.getByRole('button', { name: m.rules_apply_past() }));
    expect(server.requestRuleBackfill).toHaveBeenLastCalledWith({ data: { ruleIds: ['r-1'] } });
  });

  it('enables an inactive rule and reports a rejected change', async () => {
    server.setAutoRuleEnabled.mockReturnValueOnce(ok(rule({ enabled: true })));
    await render({ rules: [rule({ enabled: false })], suggestions: [] });
    await userEvent.click(page.getByRole('switch', { name: m.rules_toggle({ name: 'Berangkat ke kantor' }) }));
    expect(server.setAutoRuleEnabled).toHaveBeenCalledWith({ data: { id: 'r-1', enabled: true } });

    server.setAutoRuleEnabled.mockRejectedValueOnce(new TypeError('offline'));
    await userEvent.click(page.getByRole('switch', { name: m.rules_toggle({ name: 'Berangkat ke kantor' }) }));
    await expect.element(page.getByText(m.rules_action_failed())).toBeInTheDocument();
  });

  it('explains an empty list and has nothing to apply past', async () => {
    await render({ rules: [], suggestions: [] });
    await expect.element(page.getByText(m.rules_empty())).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: m.rules_apply_past() })).toBeDisabled();
  });
});
