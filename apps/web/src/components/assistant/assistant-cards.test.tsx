// SPDX-License-Identifier: AGPL-3.0-only
import type { AssistantCard, AssistantDraft } from '@wf/domain/assistant';
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { AssistantCards, AssistantDraftCard, AssistantSources } from './assistant-cards.tsx';

const localDate = (value: string) => value as never;

const draft = (overrides: Partial<AssistantDraft> = {}): AssistantDraft => ({
  type: 'expense',
  description: 'Makan siang',
  amountMinor: 45_000n,
  currency: 'IDR',
  accountId: 'a1',
  accountName: 'GoPay',
  categoryId: 'c1',
  categoryName: 'Makan & Dapur',
  categoryBuiltInKey: 'system:food',
  occurredAt: new Date('2026-10-15T05:10:00Z'),
  tags: [],
  budget: null,
  balance: null,
  duplicate: null,
  ...overrides,
});

describe('AssistantCards', () => {
  it('renders a budget card with the localized categories and their share', async () => {
    const cards: AssistantCard[] = [
      {
        kind: 'budget',
        from: localDate('2026-10-01'),
        to: localDate('2026-10-31'),
        currency: 'IDR',
        unbudgetedSpentMinor: 700_000n,
        lines: [
          {
            categoryId: 'c1',
            name: 'system:food',
            builtInKey: 'system:food',
            group: 'needs',
            limitMinor: 3_500_000n,
            spentMinor: 3_200_000n,
            remainingMinor: 300_000n,
            usedBps: 9143,
            count: 18,
          },
        ],
      },
    ];
    await renderApp(<AssistantCards cards={cards} />, { preferences: { locale: 'id' } });
    const card = page.getByRole('region', { name: 'Anggaran periode ini' });
    await expect.element(card.getByText('Makan & Dapur')).toBeVisible();
    await expect.element(card.getByText(/3\.200\.000/)).toBeVisible();
    await expect.element(card.getByText(/91\s*%/)).toBeVisible();
    await expect.element(card.getByText(/1–31 Okt 2026/)).toBeVisible();
  });

  it('renders balances and the largest transactions', async () => {
    const cards: AssistantCard[] = [
      {
        kind: 'accounts',
        currency: 'IDR',
        items: [{ id: 'a1', name: 'GoPay', currency: 'IDR', balanceMinor: 412_000n }],
      },
      {
        kind: 'transactions',
        from: localDate('2026-10-01'),
        to: localDate('2026-10-15'),
        currency: 'IDR',
        items: [
          {
            id: 't1',
            description: 'Superindo',
            amountMinor: 642_000n,
            localDate: localDate('2026-10-11'),
            categoryName: null,
            categoryBuiltInKey: null,
          },
        ],
      },
    ];
    await renderApp(<AssistantCards cards={cards} />);
    await expect.element(page.getByRole('region', { name: 'Saldo rekening' }).getByText(/412\.000/)).toBeVisible();
    await expect.element(page.getByRole('region', { name: 'Transaksi terbesar' }).getByText('Superindo')).toBeVisible();
  });
});

describe('AssistantSources', () => {
  it('links each card to the page holding the same numbers', async () => {
    const cards: AssistantCard[] = [
      {
        kind: 'budget',
        from: localDate('2026-10-01'),
        to: localDate('2026-10-31'),
        currency: 'IDR',
        lines: [],
        unbudgetedSpentMinor: 0n,
      },
      { kind: 'accounts', currency: 'IDR', items: [] },
    ];
    const onNavigate = vi.fn();
    await renderApp(<AssistantSources cards={cards} onNavigate={onNavigate} />);
    const budget = page.getByRole('link', { name: 'Lihat anggaran' });
    await expect.element(budget).toHaveAttribute('href', '/budget');
    await expect.element(page.getByRole('link', { name: 'Lihat rekening' })).toHaveAttribute('href', '/accounts');
    await budget.click();
    expect(onNavigate).toHaveBeenCalled();
  });
});

describe('AssistantDraftCard', () => {
  it('shows the unsaved proposal with its actions and the saved state after confirmation', async () => {
    await renderApp(
      <AssistantDraftCard
        draft={draft({ budget: { limitMinor: 3_500_000n, spentAfterMinor: 3_245_000n, usedBps: 9271 } })}
        status="unsaved"
        savedTransactionId={null}
        timeZone="Asia/Jakarta"
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onOpen={vi.fn()}
      />,
      { preferences: { locale: 'id' } },
    );
    const card = page.getByRole('group', { name: 'Draft transaksi' });
    await expect.element(card.getByText('belum disimpan')).toBeVisible();
    await expect.element(card.getByText(/Makan & Dapur jadi 93\s*%/)).toBeVisible();
    await expect.element(card.getByRole('button', { name: 'Simpan' })).toBeVisible();

    await renderApp(
      <AssistantDraftCard
        draft={draft()}
        status="saved"
        savedTransactionId="t1"
        timeZone="Asia/Jakarta"
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onOpen={vi.fn()}
      />,
      { preferences: { locale: 'id' } },
    );
    const saved = page.getByRole('group', { name: 'Draft transaksi' });
    await expect.element(saved.getByText('Tersimpan · dikonfirmasi olehmu')).toBeVisible();
    await expect.element(saved.getByRole('button', { name: 'Buka di Transaksi' })).toBeEnabled();
  });
});
