// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { CATEGORIES, categoryId } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import {
  S_CHATGPT,
  S_GYM,
  S_NETFLIX,
  S_YOUTUBE,
  detectedOverview,
  seedOverview,
} from '../../../test/subscription-fixtures.ts';
import { CategoryShareCard, SavingsCard, UsageReviewCard } from './subscription-insights.tsx';

describe('UsageReviewCard', () => {
  it('golden: asks how often YouTube Premium is used, 6 / 7 rated', async () => {
    const onRate = vi.fn();
    const { screen } = await renderApp(
      <UsageReviewCard overview={seedOverview()} locale="id" onRate={onRate} onCancel={vi.fn()} />,
    );
    const card = screen.getByRole('region', { name: 'Review bulanan' });
    await expect.element(card.getByText('6 / 7 dinilai')).toBeVisible();
    await expect.element(card.getByText('Seberapa sering kamu pakai YouTube Premium?')).toBeVisible();
    await expect.element(card).toMatchTextContent(/Ditagih 22 Okt · Rp59\.000/);
    await card.getByRole('button', { name: 'Jarang' }).click();
    expect(onRate).toHaveBeenCalledWith(S_YOUTUBE, 'rarely');
    await expect
      .element(card.getByText('Kamu yang menilai. write.financial tidak membaca aktivitas aplikasi lain.'))
      .toBeVisible();
  });

  it('suggests stopping a rarely used one once all are rated, until asked later', async () => {
    const onCancel = vi.fn();
    const rated = seedOverview({
      subscriptions: seedOverview().subscriptions.filter((view) => view.id !== 'youtube'),
    });
    const { screen } = await renderApp(
      <UsageReviewCard overview={rated} locale="id" onRate={vi.fn()} onCancel={onCancel} />,
    );
    await expect.element(screen.getByText('Pertimbangkan berhenti')).toBeVisible();
    await expect.element(screen.getByText('Fit Hub jarang dipakai, Rp2.388.000/tahun.')).toBeVisible();
    await screen.getByRole('button', { name: 'Batalkan…' }).click();
    expect(onCancel).toHaveBeenCalledWith(S_GYM);
    await screen.getByRole('button', { name: 'Tanya lagi bulan depan' }).click();
    await expect.element(screen.getByText('Semua langganan aktif sudah dinilai bulan ini.')).toBeVisible();
    await screen.unmount();

    const gone = await renderApp(
      <UsageReviewCard
        overview={{ ...rated, couldSave: [{ subscriptionId: 'gone', yearlyMinor: 1n }] }}
        locale="id"
        onRate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await expect.element(gone.screen.getByText('Semua langganan aktif sudah dinilai bulan ini.')).toBeVisible();
  });

  it('asks about a subscription without a scheduled bill', async () => {
    const { screen } = await renderApp(
      <UsageReviewCard
        overview={seedOverview({ subscriptions: [{ ...S_YOUTUBE, nextBill: null }] })}
        locale="id"
        onRate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Seberapa sering kamu pakai YouTube Premium?')).toBeVisible();
    await expect.element(screen.getByText(/Ditagih/)).not.toBeInTheDocument();
  });
});

describe('SavingsCard', () => {
  it('lists rarely used, overlapping, more expensive, and untracked subscriptions with their actions', async () => {
    const handlers = { onCancel: vi.fn(), onCompare: vi.fn(), onOpen: vi.fn(), onDetect: vi.fn() };
    const { screen } = await renderApp(
      <SavingsCard overview={seedOverview()} detected={detectedOverview()} locale="id" {...handlers} />,
    );
    const card = screen.getByRole('region', { name: 'Bisa dihemat' });
    await expect.element(card.getByText('Dari pola tagihan, bukan dari pemakaian')).toBeVisible();
    const items = card.getByRole('listitem');
    expect(items.elements()).toHaveLength(4);
    await expect
      .element(items.nth(0))
      .toMatchTextContent(/^Fit Hub jarang dipakaiHemat hingga Rp2\.388\.000\/tahun kalau berhenti\.Batalkan…$/);
    await expect
      .element(items.nth(1))
      .toMatchTextContent(/^Fungsi dobel: musikSpotify, YouTube Premium punya fungsi yang sama\.Bandingkan$/);
    await expect
      .element(items.nth(2))
      .toMatchTextContent(/^ChatGPT naik 10%Rp299\.000 → Rp329\.000 sejak SeptemberRiwayat harga$/);
    await expect
      .element(items.nth(3))
      .toMatchTextContent(
        /^2 tagihan berulang belum dilacakVidio Rp39\.000, Google One Rp26\.900\. masing-masing 3× ditagih\.Tinjau$/,
      );
    await items.nth(0).getByRole('button').click();
    expect(handlers.onCancel).toHaveBeenCalledWith(S_GYM);
    await items.nth(1).getByRole('button').click();
    expect(handlers.onCompare).toHaveBeenCalledWith(['spotify', 'youtube'], 'Fungsi dobel: musik');
    await items.nth(2).getByRole('button').click();
    expect(handlers.onOpen).toHaveBeenCalledWith(S_CHATGPT);
    await items.nth(3).getByRole('button').click();
    expect(handlers.onDetect).toHaveBeenCalled();
  });

  it('skips unknown and inactive subscriptions and says when there is nothing to save', async () => {
    const overview = seedOverview({
      subscriptions: [S_NETFLIX, { ...S_CHATGPT, effectiveStatus: 'paused' }, { ...S_YOUTUBE, icon: 'mystery' }],
      couldSave: [{ subscriptionId: 'gone', yearlyMinor: 1n }],
      priceIncreases: [
        { subscriptionId: 'chatgpt', ...(S_CHATGPT.priceIncrease as NonNullable<typeof S_CHATGPT.priceIncrease>) },
        { subscriptionId: 'gone', ...(S_CHATGPT.priceIncrease as NonNullable<typeof S_CHATGPT.priceIncrease>) },
      ],
    });
    const handlers = { onCancel: vi.fn(), onCompare: vi.fn(), onOpen: vi.fn(), onDetect: vi.fn() };
    const { screen } = await renderApp(
      <SavingsCard overview={overview} detected={detectedOverview({ candidates: [] })} locale="id" {...handlers} />,
    );
    await expect.element(screen.getByText('Belum ada yang bisa dihemat.')).toBeVisible();
    await screen.unmount();

    const mystery = seedOverview({
      subscriptions: [
        { ...S_NETFLIX, icon: 'mystery' },
        { ...S_YOUTUBE, icon: 'mystery' },
      ],
      couldSave: [],
      priceIncreases: [],
    });
    const second = await renderApp(<SavingsCard overview={mystery} detected={null} locale="id" {...handlers} />);
    await expect.element(second.screen.getByText('Fungsi dobel: mystery')).toBeVisible();
  });
});

describe('CategoryShareCard', () => {
  it('draws the shares and filters the table by a category', async () => {
    const onSelect = vi.fn();
    const { screen } = await renderApp(
      <CategoryShareCard
        overview={seedOverview()}
        categories={CATEGORIES}
        locale="id"
        selected={categoryId('system:entertainment')}
        onSelect={onSelect}
      />,
    );
    const card = screen.getByRole('region', { name: 'Per kategori' });
    await expect.element(card).toMatchTextContent(/7layanan/);
    const legend = card.getByRole('list', { name: 'Saring tabel per kategori' });
    await expect
      .element(legend.getByRole('button', { name: 'Tanpa kategori 65%' }))
      .toHaveAttribute('aria-pressed', 'false');
    await expect.element(legend.getByRole('button', { name: 'Hiburan 35%' })).toHaveAttribute('aria-pressed', 'true');
    expect(card.element().querySelectorAll('circle')).toHaveLength(3);
    await legend.getByRole('button', { name: 'Tanpa kategori 65%' }).click();
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('says when there are no active subscriptions, and names unknown categories uncategorized', async () => {
    const { screen } = await renderApp(
      <CategoryShareCard
        overview={seedOverview({ byCategory: [] })}
        categories={CATEGORIES}
        locale="id"
        selected={undefined}
        onSelect={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Belum ada langganan aktif.')).toBeVisible();
    await screen.unmount();
    const unknown = await renderApp(
      <CategoryShareCard
        overview={seedOverview({
          byCategory: [{ categoryId: 'gone', count: 1, monthlyMinor: 1n, yearlyMinor: 12n, shareBps: 10_000 }],
        })}
        categories={CATEGORIES}
        locale="id"
        selected={undefined}
        onSelect={vi.fn()}
      />,
    );
    await expect.element(unknown.screen.getByRole('button', { name: 'Tanpa kategori 100%' })).toBeVisible();
  });
});
