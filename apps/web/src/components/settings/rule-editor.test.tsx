// SPDX-License-Identifier: AGPL-3.0-only
import type { AutoRulePreview } from '@wf/db/auto-rules';
import type { AutoRuleView } from '@wf/domain/rules';
import type { AutoRuleDefinition } from '@wf/domain/rules';
import { m } from '@wf/i18n/messages';
import { toast, Toaster } from '@wf/ui/toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ACCOUNTS, CATEGORIES, TAGS, categoryId } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { RuleEditor } from './rule-editor.tsx';

const server = vi.hoisted(() => ({
  createAutoRule: vi.fn(),
  updateAutoRule: vi.fn(),
  deleteAutoRule: vi.fn(),
  previewAutoRule: vi.fn(),
}));
vi.mock('../../server/fn/rules.ts', () => server);

const AT = new Date('2026-10-15T02:00:00Z');
const screens: { unmount: () => Promise<void> }[] = [];
const food = categoryId('system:food');
const transport = categoryId('system:transport');
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = { ok: false as const, code: 'INVALID_RULE' };

const definition: AutoRuleDefinition = {
  name: 'Berangkat ke kantor',
  enabled: true,
  conditions: [
    { field: 'description', op: 'containsAny', values: ['gojek', 'krl'] },
    { field: 'weekday', op: 'oneOf', values: [1, 4] },
    { field: 'time', op: 'before', minute: 600 },
  ],
  actions: [
    { type: 'setCategory', categoryId: transport },
    { type: 'addTag', tag: 'kantor' },
  ],
};

const saved = (patch: Partial<AutoRuleView> = {}): AutoRuleView => ({
  id: 'r-1',
  ...definition,
  position: 5,
  createdAt: AT,
  updatedAt: AT,
  ...patch,
});

const preview = (patch: Partial<AutoRulePreview> = {}): AutoRulePreview => ({
  trial: {
    categoryId: transport,
    winningRule: { id: 'draft', name: 'Berangkat ke kantor' },
    tags: ['kantor'],
    tagOverflow: false,
    rules: [
      {
        ruleId: 'draft',
        name: 'Berangkat ke kantor',
        position: 0,
        matched: true,
        reasons: [
          { field: 'description', matched: true, values: ['gojek', 'krl'], hit: 'gojek' },
          { field: 'weekday', matched: true, values: [1, 4], actual: 4 },
          { field: 'time', matched: true, before: 600, actual: 540 },
        ],
        conditions: definition.conditions,
      },
    ],
  },
  period: {
    label: '2026-10',
    total: 2,
    matched: 1,
    samples: [
      {
        id: 'tx-1',
        localDate: '2026-10-05' as never,
        description: null,
        currentCategoryId: food,
        matched: true,
        reasons: [{ field: 'description', matched: true, values: ['gojek'], hit: 'gojek' }],
      },
    ],
    truncated: false,
  },
  ...patch,
});

async function renderEditor({
  initial = definition,
  rule = saved(),
  suggestionKey,
  categories = CATEGORIES,
  accounts = ACCOUNTS,
  previewValue,
}: {
  initial?: AutoRuleDefinition;
  rule?: AutoRuleView | null;
  suggestionKey?: string;
  categories?: typeof CATEGORIES;
  accounts?: typeof ACCOUNTS;
  previewValue?: unknown;
} = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onApplyPast = vi.fn();
  server.previewAutoRule.mockReturnValue(previewValue ?? ok(preview()));
  const result = await renderApp(
    <>
      <RuleEditor
        initial={initial}
        rule={rule}
        {...(suggestionKey === undefined ? {} : { suggestionKey })}
        categories={categories}
        accounts={accounts}
        tags={TAGS}
        timeZone="Asia/Jakarta"
        onClose={onClose}
        onSaved={onSaved}
        {...(rule === null ? {} : { onApplyPast })}
      />
      <Toaster label="Notifikasi" />
    </>,
  );
  screens.push(result.screen);
  return { ...result, onClose, onSaved, onApplyPast };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(async () => {
  toast.dismiss();
  await Promise.all(screens.splice(0).map((screen) => screen.unmount()));
});

describe('RuleEditor', () => {
  it('opens a saved rule, previews it, and saves changes with Undo', async () => {
    server.updateAutoRule.mockReturnValue(ok(saved({ name: 'Pagi' })));
    const { onSaved, onApplyPast } = await renderEditor();
    await expect.element(page.getByLabelText(m.rules_editor_name())).toHaveValue('Berangkat ke kantor');
    await expect.element(page.getByText(m.rules_editor_position({ position: 6 }))).toBeInTheDocument();
    await expect.element(page.getByText(/Deskripsi berisi salah satu: gojek, krl · cocok/)).toBeInTheDocument();
    await expect
      .element(page.getByText(m.rules_preview_period({ matched: 1, total: 2, label: '2026-10' })))
      .toBeInTheDocument();
    await expect.element(page.getByText(m.rules_untitled())).toBeInTheDocument();
    expect(server.previewAutoRule).toHaveBeenCalledTimes(1);

    await userEvent.click(page.getByRole('button', { name: m.rules_preview_run() }));
    expect(server.previewAutoRule).toHaveBeenCalledTimes(2);
    await userEvent.click(page.getByRole('button', { name: m.rules_apply_past() }));
    expect(onApplyPast).toHaveBeenCalledTimes(1);

    await userEvent.fill(page.getByLabelText(m.rules_editor_name()), 'Pagi');
    await expect.element(page.getByText(m.rules_editor_unsaved_hint())).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_save() }));
    expect(server.updateAutoRule).toHaveBeenCalledWith({ data: { id: 'r-1', input: { ...definition, name: 'Pagi' } } });
    expect(onSaved).toHaveBeenCalledTimes(1);
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_undo() }));
    expect(server.updateAutoRule).toHaveBeenLastCalledWith({ data: { id: 'r-1', input: definition } });
  });

  it('keeps the edits when saving fails, then retries', async () => {
    server.updateAutoRule.mockReturnValueOnce(Promise.resolve(failed));
    server.updateAutoRule.mockReturnValueOnce(ok(saved()));
    await renderEditor();
    await userEvent.fill(page.getByLabelText(m.rules_editor_name()), 'Gagal');
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_save() }));
    await expect.element(page.getByText(m.ledger_error_invalid_rule())).toBeInTheDocument();
    await expect.element(page.getByLabelText(m.rules_editor_name())).toHaveValue('Gagal');
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_retry() }));
    expect(server.updateAutoRule).toHaveBeenCalledTimes(2);
  });

  it('asks before discarding an edited rule', async () => {
    const { onClose } = await renderEditor();
    await userEvent.fill(page.getByLabelText(m.rules_editor_name()), 'Berubah');
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_back() }));
    const alert = page.getByRole('alertdialog');
    await expect.element(alert).toBeInTheDocument();
    await userEvent.click(alert.getByRole('button', { name: m.rules_editor_keep() }));
    await expect.element(alert).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.settings_cancel() }));
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: m.rules_editor_discard() }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates a rule from a suggestion with every condition and action, then undoes the save', async () => {
    server.createAutoRule.mockReturnValue(ok({ id: 'new-rule' }));
    server.deleteAutoRule.mockReturnValue(ok(null));
    const initial: AutoRuleDefinition = {
      name: 'Kopi Kenangan',
      enabled: true,
      conditions: [{ field: 'description', op: 'containsAny', values: ['Kopi Kenangan'] }],
      actions: [{ type: 'setCategory', categoryId: transport }],
    };
    const { onSaved } = await renderEditor({
      initial,
      rule: null,
      suggestionKey: 'kopi|a|b',
      previewValue: Promise.resolve(failed),
    });
    await expect.element(page.getByLabelText(m.rules_editor_name())).toHaveValue('Kopi Kenangan');

    await userEvent.click(page.getByRole('button', { name: m.rules_preview_run() }));
    await expect.element(page.getByText(m.ledger_error_invalid_rule())).toBeInTheDocument();

    // A new condition of every kind, then all of them removed again.
    const addCondition = page.getByRole('combobox', { name: m.rules_editor_add_condition() });
    for (const field of [m.rules_field_weekday(), m.rules_field_time(), m.rules_field_account()]) {
      await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_condition() }));
      await userEvent.selectOptions(addCondition, field);
    }
    const monday = page.getByRole('group', { name: m.rules_field_weekday() }).getByRole('button', { name: 'Senin' });
    await userEvent.click(monday);
    await userEvent.click(monday);
    await userEvent.click(monday);
    await userEvent.fill(page.getByLabelText(m.rules_field_time()), '');
    await userEvent.fill(page.getByLabelText(m.rules_field_time()), '09:30');
    const bca = page.getByRole('group', { name: m.rules_field_account() }).getByRole('button', { name: 'BCA Tahapan' });
    await userEvent.click(bca);
    await userEvent.click(bca);
    await userEvent.click(bca);
    // Description values stay raw while typing.
    await userEvent.fill(page.getByLabelText(m.rules_field_description()), 'gojek, krl');

    // An action with a tag, then another category action is no longer offered.
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_action() }));
    await userEvent.selectOptions(
      page.getByRole('combobox', { name: m.rules_editor_add_action() }),
      m.rules_action_add_tag(),
    );
    await userEvent.fill(page.getByLabelText(m.rules_action_tag_label()), 'pagi');
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_action() }));
    await expect
      .element(page.getByRole('combobox', { name: m.rules_editor_add_action() }))
      .not.toHaveTextContent(m.rules_action_set_category());
    await userEvent.click(page.getByRole('button', { name: m.settings_cancel() }).nth(0));

    // Remove the tag action and add a second category action after removing the first.
    const removes = page.getByRole('button', { name: /Hapus tindakan/ });
    await userEvent.click(removes.nth(0));
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_action() }));
    await userEvent.selectOptions(
      page.getByRole('combobox', { name: m.rules_editor_add_action() }),
      m.rules_action_set_category(),
    );
    await userEvent.selectOptions(page.getByLabelText(m.rules_action_category_label()), 'Transportasi');

    await userEvent.click(page.getByLabelText(m.rules_editor_active()));
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_save() }));
    const [call] = server.createAutoRule.mock.calls;
    const sent = call?.[0] as { data: { input: AutoRuleDefinition; suggestionKey?: string } } | undefined;
    expect(sent?.data.input).toMatchObject({ name: 'Kopi Kenangan', enabled: false });
    expect(sent?.data.input.actions).toEqual([
      { type: 'addTag', tag: 'pagi' },
      { type: 'setCategory', categoryId: transport },
    ]);
    expect(sent?.data.suggestionKey).toBe('kopi|a|b');
    expect(onSaved).toHaveBeenCalledTimes(1);
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_undo() }));
    expect(server.deleteAutoRule).toHaveBeenCalledWith({ data: { id: 'new-rule' } });
  });

  it('edits every trial field and previews with them', async () => {
    await renderEditor();
    await userEvent.fill(page.getByLabelText(m.rules_preview_description()), 'KRL pagi');
    await userEvent.fill(page.getByLabelText(/Tanggal/), '');
    await userEvent.fill(page.getByLabelText(/Tanggal/), '2026-10-16');
    await userEvent.fill(page.getByLabelText(m.rules_preview_time()), '07:15');
    await userEvent.selectOptions(page.getByLabelText(m.rules_preview_account()), 'BCA Tahapan');
    await userEvent.selectOptions(page.getByLabelText(m.rules_preview_direction()), 'income');
    await userEvent.click(page.getByRole('switch', { name: m.rules_preview_subscription() }));
    await userEvent.click(page.getByRole('button', { name: m.rules_preview_run() }));
    expect(server.previewAutoRule).toHaveBeenLastCalledWith({
      data: {
        input: definition,
        trial: {
          description: 'KRL pagi',
          date: '2026-10-16',
          time: '07:15',
          accountId: 'acc-bca',
          direction: 'income',
          subscription: true,
        },
      },
    });
    await userEvent.selectOptions(page.getByLabelText(m.rules_preview_account()), '');
    await userEvent.fill(page.getByLabelText(m.rules_preview_time()), '');
    await userEvent.click(page.getByRole('button', { name: m.rules_preview_run() }));
    expect(server.previewAutoRule.mock.calls.at(-1)?.[0]).toMatchObject({
      data: { trial: { accountId: null, time: null } },
    });
  });

  it('reports a rejected preview, rejected save, and failed Undo', async () => {
    await renderEditor();
    server.previewAutoRule.mockRejectedValueOnce(new TypeError('offline'));
    await userEvent.click(page.getByRole('button', { name: m.rules_preview_run() }));
    await expect.element(page.getByText(m.rules_preview_failed())).toBeInTheDocument();

    server.updateAutoRule.mockRejectedValueOnce(new TypeError('offline'));
    await userEvent.fill(page.getByLabelText(m.rules_editor_name()), 'Gagal');
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_save() }));
    await expect.element(page.getByText(m.rules_editor_failed())).toBeInTheDocument();

    server.updateAutoRule.mockReturnValueOnce(ok(saved()));
    server.updateAutoRule.mockReturnValueOnce(Promise.resolve(failed));
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_retry() }));
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_undo() }));
    await expect.element(page.getByText(m.ledger_error_invalid_rule())).toBeInTheDocument();
  });

  it('creates and then reports a failed Undo of the new rule', async () => {
    server.createAutoRule.mockReturnValue(ok({ id: 'new-rule' }));
    server.deleteAutoRule.mockReturnValueOnce(Promise.resolve(failed));
    await renderEditor({
      initial: { ...definition, name: 'Baru' },
      rule: null,
    });
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_save() }));
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_undo() }));
    await expect.element(page.getByText(m.ledger_error_invalid_rule())).toBeInTheDocument();
  });

  it('closes without a confirmation when nothing changed', async () => {
    const { onClose } = await renderEditor();
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_back() }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores empty Add selections, closes an untouched form, and previews without a description or accounts', async () => {
    const { onClose } = await renderEditor({
      initial: { name: 'Pagi', enabled: true, conditions: [{ field: 'time', op: 'before', minute: 600 }], actions: [] },
      rule: null,
      accounts: [],
    });
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_condition() }));
    await userEvent.selectOptions(page.getByRole('combobox', { name: m.rules_editor_add_condition() }), '');
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_action() }));
    await userEvent.selectOptions(page.getByRole('combobox', { name: m.rules_editor_add_action() }), '');
    await userEvent.click(page.getByRole('button', { name: m.rules_preview_run() }));
    expect(server.previewAutoRule.mock.calls.at(-1)?.[0]).toMatchObject({
      data: { trial: { description: null, accountId: null } },
    });
    await userEvent.click(page.getByRole('button', { name: m.settings_cancel() }).nth(0));
    await userEvent.click(page.getByRole('button', { name: m.settings_cancel() }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected create', async () => {
    server.createAutoRule.mockRejectedValueOnce(new TypeError('offline'));
    await renderEditor({ initial: { ...definition, name: 'Baru' }, rule: null });
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_save() }));
    await expect.element(page.getByText(m.rules_editor_failed())).toBeInTheDocument();
  });

  it('shows matched and missed period samples with the failing condition, and the truncation note', async () => {
    const period: AutoRulePreview['period'] = {
      label: '2026-10',
      total: 100,
      matched: 1,
      truncated: true,
      samples: [
        {
          id: 'tx-1',
          localDate: '2026-10-05' as never,
          description: 'Gojek ke kantor',
          currentCategoryId: food,
          matched: true,
          reasons: [{ field: 'description', matched: true, values: ['gojek', 'krl'], hit: 'gojek' }],
        },
        {
          id: 'tx-2',
          localDate: '2026-10-06' as never,
          description: 'Kopi',
          currentCategoryId: food,
          matched: false,
          reasons: [{ field: 'description', matched: false, values: ['gojek', 'krl'], hit: null }],
        },
      ],
    };
    await renderEditor({ previewValue: ok(preview({ period })) });
    await expect.element(page.getByText(m.rules_preview_sample_matched())).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          m.rules_preview_sample_missed({
            condition: m.rules_condition_description({ values: 'gojek, krl' }),
          }),
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByText(m.rules_preview_period_truncated())).toBeInTheDocument();
  });

  it('removes every condition, adds the remaining kinds, and previews a miss with no period', async () => {
    const missed = preview({
      trial: {
        categoryId: null,
        winningRule: null,
        tags: [],
        tagOverflow: false,
        rules: [
          {
            ruleId: 'draft',
            name: 'Draft',
            position: 0,
            matched: false,
            reasons: [{ field: 'description', matched: false, values: ['gojek'], hit: null }],
            conditions: [{ field: 'description', op: 'containsAny', values: ['gojek'] }],
          },
        ],
      },
      period: { label: null, total: 0, matched: 0, samples: [], truncated: false },
    });
    await renderEditor({ rule: saved(), initial: saved(), previewValue: ok(missed) });
    while (page.getByRole('button', { name: /Hapus kondisi/ }).all().length > 0) {
      await userEvent.click(page.getByRole('button', { name: /Hapus kondisi/ }).nth(0));
    }
    await expect.element(page.getByText(m.rules_editor_no_conditions())).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_condition() }));
    await userEvent.click(page.getByRole('button', { name: m.settings_cancel() }).nth(0));
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_condition() }));
    await userEvent.selectOptions(
      page.getByRole('combobox', { name: m.rules_editor_add_condition() }),
      m.rules_field_direction(),
    );
    await userEvent.click(
      page
        .getByRole('group', { name: m.rules_field_direction() })
        .getByRole('button', { name: m.rules_direction_income() }),
    );
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_condition() }));
    await userEvent.selectOptions(
      page.getByRole('combobox', { name: m.rules_editor_add_condition() }),
      m.rules_condition_subscription(),
    );
    await userEvent.click(page.getByLabelText(m.rules_editor_active()));
    await userEvent.click(page.getByRole('button', { name: m.rules_preview_run() }));
    await expect.element(page.getByText(m.rules_preview_not_matched())).toBeInTheDocument();
    await expect.element(page.getByText(m.rules_preview_period_none())).toBeInTheDocument();
    await expect.element(page.getByText(m.rules_preview_inactive_note())).toBeInTheDocument();
  });

  it('adds no category action when no category is live, and can cancel adding an action', async () => {
    await renderEditor({
      categories: [],
      rule: null,
      initial: {
        name: 'Baru',
        enabled: true,
        conditions: [{ field: 'description', op: 'containsAny', values: [] }],
        actions: [],
      },
    });
    await userEvent.click(page.getByRole('button', { name: m.rules_editor_add_action() }));
    await expect
      .element(page.getByRole('combobox', { name: m.rules_editor_add_action() }))
      .not.toHaveTextContent(m.rules_action_set_category());
    await userEvent.click(page.getByRole('button', { name: m.settings_cancel() }).nth(0));
    await expect.element(page.getByRole('combobox', { name: m.rules_editor_add_action() })).not.toBeInTheDocument();
  });
});
