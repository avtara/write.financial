// SPDX-License-Identifier: AGPL-3.0-only
import type { AssistantCard, AssistantDraft } from '@wf/domain/assistant';
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { AssistantCards, AssistantDraftCard, AssistantSources } from './assistant-cards.tsx';

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
        from: '2026-10-01' as LocalDate,
        to: '2026-10-31' as LocalDate,
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
    await expect.element(card.getByText(/91,43\s*%/)).toBeVisible();
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
        from: '2026-10-01' as LocalDate,
        to: '2026-10-15' as LocalDate,
        currency: 'IDR',
        items: [
          {
            id: 't1',
            description: 'Superindo',
            amountMinor: 642_000n,
            localDate: '2026-10-11' as LocalDate,
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
        from: '2026-10-01' as LocalDate,
        to: '2026-10-31' as LocalDate,
        currency: 'IDR',
        lines: [],
        unbudgetedSpentMinor: 0n,
      },
      { kind: 'accounts', currency: 'IDR', items: [] },
    ];
    const onNavigate = vi.fn();
    const { router } = await renderApp(<AssistantSources cards={cards} onNavigate={onNavigate} />);
    const budget = page.getByRole('link', { name: 'Lihat anggaran' });
    await expect.element(budget).toHaveAttribute('href', '/budget');
    await expect.element(page.getByRole('link', { name: 'Lihat rekening' })).toHaveAttribute('href', '/accounts');
    await budget.click();
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/budget');
    });
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
    await expect.element(card.getByText(/Makan & Dapur jadi 92,71\s*%/)).toBeVisible();
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

describe('Assistant financial boundaries', () => {
  it('ranks budget pressure without inventing a percentage for uncapped categories', async () => {
    const card: Extract<AssistantCard, { kind: 'budget' }> = {
      kind: 'budget',
      from: '2026-10-01' as LocalDate,
      to: '2026-10-31' as LocalDate,
      currency: 'IDR',
      unbudgetedSpentMinor: 0n,
      lines: [
        {
          categoryId: 'uncapped-a',
          name: 'Uncapped A',
          builtInKey: null,
          group: 'needs',
          limitMinor: 0n,
          spentMinor: 100n,
          remainingMinor: -100n,
          usedBps: null,
          count: 1,
        },
        {
          categoryId: 'uncapped-b',
          name: 'Uncapped B',
          builtInKey: null,
          group: 'needs',
          limitMinor: 0n,
          spentMinor: 200n,
          remainingMinor: -200n,
          usedBps: null,
          count: 1,
        },
        {
          categoryId: 'over',
          name: 'Over budget',
          builtInKey: null,
          group: 'needs',
          limitMinor: 100n,
          spentMinor: 120n,
          remainingMinor: -20n,
          usedBps: 12000,
          count: 1,
        },
      ],
    };
    await renderApp(<AssistantCards cards={[card]} />);
    const region = page.getByRole('region', { name: 'Anggaran periode ini' });
    const text = region.element().textContent;
    expect(text.indexOf('Over budget')).toBeLessThan(text.indexOf('Uncapped A'));
    expect(text.indexOf('Uncapped A')).toBeLessThan(text.indexOf('Uncapped B'));
    await expect.element(region.getByText(/120,00\s*%/)).toBeVisible();
    expect(region.getByText('—', { exact: true }).elements()).toHaveLength(2);
  });

  it('ranks actual spending and keeps uncategorized spending in the total', async () => {
    const card: Extract<AssistantCard, { kind: 'spending' }> = {
      kind: 'spending',
      from: '2026-10-01' as LocalDate,
      to: '2026-10-31' as LocalDate,
      currency: 'IDR',
      totalMinor: 650000n,
      categories: [
        { categoryId: 'small', name: 'Small', builtInKey: null, totalMinor: 100000n, count: 1 },
        { categoryId: 'tiny', name: 'Tiny', builtInKey: null, totalMinor: 50000n, count: 1 },
        { categoryId: 'large', name: 'Large', builtInKey: null, totalMinor: 300000n, count: 1 },
        { categoryId: null, name: null, builtInKey: null, totalMinor: 200000n, count: 1 },
      ],
    };
    await renderApp(<AssistantCards cards={[card]} />);
    const region = page.getByRole('region', { name: 'Pengeluaran per kategori' });
    const text = region.element().textContent;
    await expect.element(region.getByText(/200\.000/)).toBeVisible();
    expect(text.indexOf('Large')).toBeLessThan(text.indexOf('200.000'));
    expect(text.indexOf('200.000')).toBeLessThan(text.indexOf('Small'));
    expect(text.indexOf('Small')).toBeLessThan(text.indexOf('Tiny'));
    await expect.element(region.getByText(/650\.000/)).toBeVisible();
  });

  it('uses a date for unnamed transactions and links to the exact card range', async () => {
    const card: Extract<AssistantCard, { kind: 'transactions' }> = {
      kind: 'transactions',
      from: '2026-09-01' as LocalDate,
      to: '2026-09-30' as LocalDate,
      currency: 'IDR',
      items: [
        {
          id: 'unnamed',
          description: '',
          amountMinor: 50000n,
          localDate: '2026-09-12' as LocalDate,
          categoryName: null,
          categoryBuiltInKey: null,
        },
      ],
    };
    const { router } = await renderApp(
      <>
        <AssistantCards cards={[card]} />
        <AssistantSources cards={[card]} onNavigate={vi.fn()} />
      </>,
    );
    await expect
      .element(page.getByRole('region', { name: 'Transaksi terbesar' }).getByText('12 Sep', { exact: true }))
      .toBeVisible();
    await page.getByRole('link', { name: 'Lihat transaksi' }).click();
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/transactions');
      expect(router.state.location.search).toEqual({ range: '2026-09-01..2026-09-30', type: 'expense' });
    });
  });

  it('distinguishes a healthy balance from a low one and names an otherwise unnamed duplicate', async () => {
    await renderApp(
      <AssistantDraftCard
        draft={draft({
          categoryId: null,
          categoryName: null,
          categoryBuiltInKey: null,
          balance: { currency: 'IDR', afterMinor: 500000n, thresholdMinor: 500000n },
          duplicate: {
            transactionId: 'existing',
            description: '',
            localDate: '2026-10-15' as LocalDate,
            amountMinor: 45000n,
          },
        })}
        status="saving"
        savedTransactionId={null}
        timeZone="Asia/Jakarta"
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const card = page.getByRole('group', { name: 'Draft transaksi' });
    await expect.element(card.getByText('Tanpa kategori', { exact: true })).toBeVisible();
    await expect.element(card).toMatchTextContent('saldo GoPay Rp500.000');
    expect(card.element().textContent).not.toContain('di bawah batas');
    await expect.element(card).toMatchTextContent('Sudah tercatat: Makan siang');
    await expect.element(card.getByRole('button', { name: 'Tetap catat' })).toBeDisabled();
  });
});
