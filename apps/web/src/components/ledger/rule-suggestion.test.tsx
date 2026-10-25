// SPDX-License-Identifier: AGPL-3.0-only
import type { AutoRuleView } from '@wf/domain/rules';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { CATEGORIES, categoryId, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { emptyValues, type TransactionFormValues } from './transaction-draft.ts';
import { RuleSuggestion } from './rule-suggestion.tsx';

const AT = new Date('2026-10-15T02:00:00Z');
const transport = categoryId('system:transport');
const food = categoryId('system:food');

const rule = (overrides: Partial<AutoRuleView> = {}): AutoRuleView => ({
  id: 'r-1',
  name: 'Berangkat ke kantor',
  enabled: true,
  position: 0,
  conditions: [{ field: 'description', op: 'containsAny', values: ['gojek', 'krl'] }],
  actions: [
    { type: 'setCategory', categoryId: transport },
    { type: 'addTag', tag: 'kantor' },
  ],
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
});

const values = (patch: Partial<TransactionFormValues> = {}): TransactionFormValues => ({
  ...emptyValues({ accountId: 'acc-1', date: '2026-10-15' as LocalDate, time: '08:30' }),
  description: 'Gojek ke kantor',
  ...patch,
});

async function render(props: Partial<Parameters<typeof RuleSuggestion>[0]> = {}) {
  const onApply = vi.fn();
  await renderApp(
    <RuleSuggestion
      rules={[rule()]}
      categories={CATEGORIES}
      values={values()}
      subscriptionNames={[]}
      onApply={onApply}
      {...props}
    />,
  );
  return { onApply };
}

describe('RuleSuggestion', () => {
  it('suggests the matching rule’s category and tags and applies them on request', async () => {
    const { onApply } = await render();
    await expect
      .element(page.getByText(m.rules_suggest_title({ name: 'Berangkat ke kantor' })).first())
      .toBeInTheDocument();
    await expect.element(page.getByText('Kategori: Transportasi')).toBeInTheDocument();
    await expect.element(page.getByText('#kantor')).toBeInTheDocument();
    await userEvent.click(page.getByText(m.rules_suggest_reasons()));
    await expect.element(page.getByText(/Cocok: Deskripsi/)).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_suggest_apply() }));
    expect(onApply).toHaveBeenCalledWith({ categoryId: transport, tags: ['kantor'] });
  });

  it('keeps a picked category and the user’s tags, adding only the missing tag', async () => {
    const { onApply } = await render({
      values: values({ categoryId: food, tags: ['makan'] }),
    });
    await expect.element(page.getByText('Kategori: Transportasi')).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_suggest_apply() }));
    expect(onApply).toHaveBeenCalledWith({ tags: ['makan', 'kantor'] });
  });

  it('may replace the Quick Add bar’s guess', async () => {
    const { onApply } = await render({ values: values({ categoryId: food }), categoryIsGuess: true });
    await userEvent.click(page.getByRole('button', { name: m.rules_suggest_apply() }));
    expect(onApply).toHaveBeenCalledWith({ categoryId: transport, tags: ['kantor'] });
  });

  it('warns instead of dropping tags beyond five', async () => {
    const { onApply } = await render({ values: values({ tags: ['a', 'b', 'c', 'd', 'e'] }) });
    await expect.element(page.getByText(m.rules_suggest_tag_limit())).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: m.rules_suggest_apply() })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('warns about an archived category and still offers its tags', async () => {
    const archived = userCategory({
      id: 'c-archived',
      name: 'Lama',
      archivedAt: new Date('2026-09-01T00:00:00Z'),
    });
    const { onApply } = await render({
      rules: [
        rule({
          actions: [
            { type: 'setCategory', categoryId: archived.id },
            { type: 'addTag', tag: 'kantor' },
          ],
        }),
      ],
      categories: [...CATEGORIES, archived],
      values: values({ description: 'Gojek ke kantor' }),
    });
    await expect.element(page.getByText(m.rules_suggest_category_unavailable())).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_suggest_apply() }));
    expect(onApply).toHaveBeenCalledWith({ tags: ['kantor'] });
  });

  it('shows nothing without a match, for a transfer, or when the draft already matches', async () => {
    await renderApp(
      <RuleSuggestion
        rules={[rule()]}
        categories={CATEGORIES}
        values={values({ description: 'Makan siang' })}
        subscriptionNames={[]}
        onApply={vi.fn()}
      />,
    );
    await expect
      .element(page.getByText(m.rules_suggest_title({ name: 'Berangkat ke kantor' })).first())
      .not.toBeInTheDocument();

    await renderApp(
      <RuleSuggestion
        rules={[rule()]}
        categories={CATEGORIES}
        values={values({ type: 'transfer', toAccountId: 'acc-2' })}
        subscriptionNames={[]}
        onApply={vi.fn()}
      />,
    );
    await expect
      .element(page.getByText(m.rules_suggest_title({ name: 'Berangkat ke kantor' })).first())
      .not.toBeInTheDocument();

    await renderApp(
      <RuleSuggestion
        rules={[rule()]}
        categories={CATEGORIES}
        values={values({ categoryId: transport, tags: ['kantor'] })}
        subscriptionNames={[]}
        onApply={vi.fn()}
      />,
    );
    await expect
      .element(page.getByText(m.rules_suggest_title({ name: 'Berangkat ke kantor' })).first())
      .not.toBeInTheDocument();

    await renderApp(
      <RuleSuggestion rules={[]} categories={CATEGORIES} values={values()} subscriptionNames={[]} onApply={vi.fn()} />,
    );
    await expect
      .element(page.getByText(m.rules_suggest_title({ name: 'Berangkat ke kantor' })).first())
      .not.toBeInTheDocument();
  });

  it('treats an empty description and unreadable time as unknown', async () => {
    const morning = rule({
      conditions: [{ field: 'time', op: 'before', minute: 600 }],
      actions: [{ type: 'setCategory', categoryId: transport }],
    });
    await render({ rules: [morning], values: values({ description: '', time: '08:30' }) });
    await expect
      .element(page.getByText(m.rules_suggest_title({ name: 'Berangkat ke kantor' })).first())
      .toBeInTheDocument();
  });

  it('matches a registered subscription by the user’s own subscription name', async () => {
    const subscriptionRule = rule({
      conditions: [{ field: 'subscription', op: 'isRegistered' }],
      actions: [{ type: 'setCategory', categoryId: transport }],
    });
    await render({
      rules: [subscriptionRule],
      values: values({ description: 'Netflix bulanan' }),
      subscriptionNames: ['Netflix'],
    });
    await expect
      .element(page.getByText(m.rules_suggest_title({ name: 'Berangkat ke kantor' })).first())
      .toBeInTheDocument();
  });

  it('does not match a subscription rule without a registered subscription', async () => {
    const subscriptionRule = rule({
      conditions: [{ field: 'subscription', op: 'isRegistered' }],
      actions: [{ type: 'setCategory', categoryId: transport }],
    });
    await render({
      rules: [subscriptionRule],
      values: values({ description: 'Netflix bulanan' }),
      subscriptionNames: [],
    });
    await expect
      .element(page.getByText(m.rules_suggest_title({ name: 'Berangkat ke kantor' })).first())
      .not.toBeInTheDocument();
  });

  it('does not match a rule when the time cannot be read', async () => {
    const morning = rule({
      conditions: [{ field: 'time', op: 'before', minute: 600 }],
      actions: [{ type: 'setCategory', categoryId: transport }],
    });
    await render({ rules: [morning], values: values({ description: '', time: '25:00' }) });
    await expect
      .element(page.getByText(m.rules_suggest_title({ name: 'Berangkat ke kantor' })).first())
      .not.toBeInTheDocument();
  });

  it('names the category-setting winner, not an earlier tag-only rule', async () => {
    const tagOnly = rule({
      id: 'r-tag',
      name: 'Tag saja',
      position: 0,
      actions: [{ type: 'addTag', tag: 'kantor' }],
    });
    const categoryRule = rule({
      id: 'r-cat',
      name: 'Kategori saja',
      position: 1,
      actions: [{ type: 'setCategory', categoryId: transport }],
    });
    const { onApply } = await render({ rules: [tagOnly, categoryRule] });
    await expect.element(page.getByText(m.rules_suggest_title({ name: 'Kategori saja' })).first()).toBeInTheDocument();
    await userEvent.click(page.getByText(m.rules_suggest_reasons()));
    await expect.element(page.getByText(m.rules_suggest_title({ name: 'Tag saja' })).first()).toBeInTheDocument();
    await expect.element(page.getByText(m.rules_suggest_title({ name: 'Kategori saja' })).first()).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: m.rules_suggest_apply() }));
    expect(onApply).toHaveBeenCalledWith({ categoryId: transport, tags: ['kantor'] });
  });

  it('applies a category-only rule without touching tags', async () => {
    const { onApply } = await render({
      rules: [rule({ actions: [{ type: 'setCategory', categoryId: transport }] })],
      values: values({ tags: ['kopi'] }),
    });
    await userEvent.click(page.getByRole('button', { name: m.rules_suggest_apply() }));
    expect(onApply).toHaveBeenCalledWith({ categoryId: transport });
  });

  it('matches a merchant without a category action', async () => {
    const { onApply } = await render({
      rules: [rule({ actions: [{ type: 'addTag', tag: 'kantor' }] })],
      values: values({ description: 'KRL' }),
    });
    await userEvent.click(page.getByRole('button', { name: m.rules_suggest_apply() }));
    expect(onApply).toHaveBeenCalledWith({ tags: ['kantor'] });
  });
});
