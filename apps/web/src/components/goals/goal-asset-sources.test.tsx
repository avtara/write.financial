// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DP_RUMAH, goalSummary } from '../../../test/goal-fixtures.ts';
import { BBCA, goalAssetOptions, SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import {
  accountsOnly,
  AssetSourceRows,
  assetDraftsOf,
  draftBps,
  draftProblem,
  GoalAssetNotices,
  type AssetSourceDraft,
} from './goal-asset-sources.tsx';

describe('goal asset sources', () => {
  it('enforces the share left by other goals, including whole-asset mode', () => {
    const draft = { key: 0, assetId: SPY.id, mode: 'percent' as const, percent: '60' };
    const assets = goalAssetOptions([SPY]);
    expect(draftProblem(draft, assets, DP_RUMAH.id, 'id')).toBeNull();
    expect(draftProblem({ ...draft, percent: '70' }, assets, DP_RUMAH.id, 'id')).toContain('Maks. 60%');
    expect(draftProblem({ ...draft, mode: 'whole' }, assets, DP_RUMAH.id, 'id')).toContain('Melebihi 100%');
    expect(draftBps({ ...draft, percent: '0' })).toBeNull();
    expect(draftBps({ ...draft, percent: '0,01' })).toBe(1);
  });
  it('account-only valuation removes asset amounts but preserves account funding', () => {
    const funded = goalSummary({
      id: 'goal-funded',
      name: 'DP Rumah',
      sources: DP_RUMAH.sources,
      savedMinor: 14_100_000n,
      assetSources: [
        {
          id: 'src-spy',
          assetId: SPY.id,
          symbol: 'SPY',
          assetName: 'SPDR S&P 500 ETF',
          mode: 'percent',
          valuation: 'market',
          bps: 6000,
          units: '0.718',
          valueMinor: 9_100_000n,
          sortOrder: 1,
        },
      ],
    });
    const [goal] = accountsOnly([funded]);
    expect(goal?.savedMinor).toBe(5_000_000n);
    expect(goal?.assetSources).toEqual([]);
    expect(funded.savedMinor).toBe(14_100_000n);
  });
  it('offers account-only mode when a held asset has no price', async () => {
    const toggle = vi.fn();
    const { screen } = await renderApp(
      <GoalAssetNotices
        goals={[
          goalSummary({
            id: 'goal-funded',
            name: 'DP Rumah',
            assetSources: [
              {
                id: 'src-spy',
                assetId: SPY.id,
                symbol: 'SPY',
                assetName: 'SPDR S&P 500 ETF',
                mode: 'percent',
                valuation: 'market',
                bps: 6000,
                units: '0.718',
                valueMinor: 9_100_000n,
                sortOrder: 1,
              },
            ],
          }),
        ]}
        assets={goalAssetOptions([{ ...SPY, quote: null }])}
        accountsOnly={false}
        currency="IDR"
        locale="id"
        onAccountsOnly={toggle}
        onRetry={vi.fn()}
      />,
    );
    await screen.getByRole('button', { name: 'Lihat saldo rekening saja' }).click();
    expect(toggle).toHaveBeenCalledWith(true);
  });

  it('edits a share, a whole asset, removes and adds rows', async () => {
    const Harness = ({ initial }: { readonly initial: AssetSourceDraft[] }) => {
      const [drafts, setDrafts] = useState(initial);
      return (
        <AssetSourceRows
          drafts={drafts}
          onChange={setDrafts}
          assets={goalAssetOptions([SPY, BBCA])}
          goalId="goal-rumah"
          currency="IDR"
          locale="id"
          showErrors
        />
      );
    };
    expect(goalAssetOptions([SPY])[0]?.goals.some((goal) => goal.goalId === 'goal-rumah')).toBe(true);
    const { screen } = await renderApp(
      <Harness initial={[{ key: 0, assetId: SPY.id, mode: 'percent', percent: '10' }]} />,
    );
    await expect.element(screen.getByText(/Tujuan lain memakai 40% · sisa bebas 60%/)).toBeVisible();
    await expect.element(screen.getByText(/Rp1\.350\.000/)).toBeVisible();
    await screen.getByRole('combobox', { name: 'Pilih aset' }).click();
    await screen.getByRole('option', { name: /^BBCA · / }).click();
    await screen.getByRole('combobox', { name: 'Cara alokasi' }).click();
    await screen.getByRole('option', { name: 'Seluruh aset' }).click();
    await expect.element(screen.getByText(/Tidak dipakai tujuan lain/)).toBeVisible();
    await expect.element(screen.getByText(/= Rp/)).toBeVisible();
    expect(screen.getByRole('textbox').query()).toBeNull();
    await screen.getByRole('button', { name: 'Hapus sumber BBCA' }).click();
    expect(screen.getByRole('textbox').query()).toBeNull();
    await screen.getByRole('button', { name: 'Tambah aset' }).click();
    await screen.getByRole('combobox', { name: 'Pilih aset' }).click();
    await screen.getByRole('option', { name: /^BBCA · / }).click();
    await expect.element(screen.getByRole('combobox', { name: 'Pilih aset' })).toMatchTextContent('BBCA');
  });

  it('explains a missing asset, a bad percentage, and another goal’s share', async () => {
    const assets = goalAssetOptions([SPY]);
    const { screen } = await renderApp(
      <AssetSourceRows
        drafts={[
          { key: 0, assetId: null, mode: 'percent', percent: '' },
          { key: 1, assetId: SPY.id, mode: 'percent', percent: '' },
          { key: 2, assetId: SPY.id, mode: 'percent', percent: '70' },
        ]}
        onChange={vi.fn()}
        assets={assets}
        goalId="goal-rumah"
        currency="IDR"
        locale="id"
        showErrors
      />,
    );
    await expect.element(screen.getByRole('alert').first()).toBeVisible();
    await expect.element(screen.getByText(/Isi persentase 0,01–100%/).first()).toBeVisible();
    await expect.element(screen.getByText(/Melebihi 100% — Dana Pensiun sudah memakai 40%/)).toBeVisible();
    // Two rows cannot pick the same asset.
    await screen.getByRole('combobox', { name: 'Pilih aset' }).first().click();
    await expect.element(screen.getByRole('option', { name: /^SPY · / })).not.toBeInTheDocument();
  });

  it('omits the value of an asset without a price and starts rows from an existing goal', async () => {
    const { screen } = await renderApp(
      <AssetSourceRows
        drafts={[{ key: 0, assetId: SPY.id, mode: 'percent', percent: '10' }]}
        onChange={vi.fn()}
        assets={goalAssetOptions([{ ...SPY, value: null }])}
        goalId="goal-rumah"
        currency="IDR"
        locale="id"
        showErrors={false}
      />,
    );
    await expect.element(screen.getByText(/Tujuan lain memakai 40% · sisa bebas 60%/)).toBeVisible();
    expect(screen.getByText('= Rp1.350.000', { exact: false }).query()).toBeNull();
    const goal = goalSummary({
      id: 'g1',
      name: 'DP',
      assetSources: [
        {
          id: 's1',
          assetId: SPY.id,
          symbol: 'SPY',
          assetName: SPY.name,
          mode: 'whole',
          valuation: 'market',
          bps: 10_000,
          units: '1',
          valueMinor: 1n,
          sortOrder: 0,
        },
        {
          id: 's2',
          assetId: BBCA.id,
          symbol: 'BBCA',
          assetName: BBCA.name,
          mode: 'percent',
          valuation: 'market',
          bps: 6050,
          units: '1',
          valueMinor: 1n,
          sortOrder: 1,
        },
      ],
    });
    expect(assetDraftsOf(goal, 'id')).toEqual([
      { key: 0, assetId: SPY.id, mode: 'whole', percent: '' },
      { key: 1, assetId: BBCA.id, mode: 'percent', percent: '60,5' },
    ]);
    expect(assetDraftsOf(undefined, 'id')).toEqual([]);
  });

  it('explains today’s drop per goal and retries or switches to accounts only', async () => {
    const retry = vi.fn();
    const toggle = vi.fn();
    const goal = goalSummary({
      id: 'g1',
      name: 'DP Rumah',
      assetSources: [
        {
          id: 's1',
          assetId: SPY.id,
          symbol: 'SPY',
          assetName: SPY.name,
          mode: 'percent',
          valuation: 'market',
          bps: 6000,
          units: '0.718',
          valueMinor: 5_400_000n,
          sortOrder: 0,
        },
        {
          id: 's2',
          assetId: BBCA.id,
          symbol: 'BBCA',
          assetName: BBCA.name,
          mode: 'whole',
          valuation: 'market',
          bps: 10_000,
          units: '100',
          valueMinor: 1n,
          sortOrder: 1,
        },
      ],
    });
    const assets = goalAssetOptions([
      {
        ...SPY,
        value: {
          ...(SPY.value as NonNullable<typeof SPY.value>),
          valueBaseMinor: 1_000_000n,
          todayBaseMinor: -100_000n,
        },
      },
      { ...BBCA, quote: null, value: null },
    ]);
    const { screen } = await renderApp(
      <GoalAssetNotices
        goals={[goal]}
        assets={assets}
        accountsOnly={false}
        currency="IDR"
        locale="id"
        onAccountsOnly={toggle}
        onRetry={retry}
      />,
    );
    const drop = screen.getByRole('status', { name: 'Harga SPY turun' });
    await expect.element(drop).toMatchTextContent('SPY hari ini');
    await expect.element(drop).toMatchTextContent('Tujuan berbasis investasi ikut nilai pasar:');
    await expect.element(drop).toMatchTextContent('Tidak perlu tindakan.');
    await screen.getByRole('button', { name: 'Coba lagi' }).click();
    expect(retry).toHaveBeenCalledOnce();
    await screen.getByRole('button', { name: 'Lihat saldo rekening saja' }).click();
    expect(toggle).toHaveBeenCalledWith(true);
  });

  it('edits one of several rows and counts a whole-asset goal as fully used', async () => {
    const Harness = ({ initial }: { readonly initial: AssetSourceDraft[] }) => {
      const [drafts, setDrafts] = useState(initial);
      return (
        <AssetSourceRows
          drafts={drafts}
          onChange={setDrafts}
          assets={goalAssetOptions([
            { ...SPY, goals: [{ ...(SPY.goals[0] as NonNullable<(typeof SPY.goals)[0]>), mode: 'whole' }] },
            BBCA,
          ])}
          goalId="other"
          currency="IDR"
          locale="id"
          showErrors
        />
      );
    };
    const { screen } = await renderApp(
      <Harness
        initial={[
          { key: 0, assetId: SPY.id, mode: 'percent', percent: '10' },
          { key: 1, assetId: BBCA.id, mode: 'whole', percent: '' },
        ]}
      />,
    );
    await expect.element(screen.getByText(/Tujuan lain memakai 100%/)).toBeVisible();
    await screen.getByRole('textbox', { name: 'Persentase SPY' }).fill('20');
    await expect.element(screen.getByRole('textbox', { name: 'Persentase SPY' })).toHaveValue('20');
    await screen.getByRole('button', { name: 'Tambah aset' }).click();
    expect(screen.getByRole('combobox', { name: 'Pilih aset' }).first().query()).not.toBeNull();
  });

  it('shows no notice for priced assets, and the account-only wording when on', async () => {
    const goal = goalSummary({
      id: 'g1',
      name: 'DP Rumah',
      assetSources: [
        {
          id: 's1',
          assetId: SPY.id,
          symbol: 'SPY',
          assetName: SPY.name,
          mode: 'percent',
          valuation: 'market',
          bps: 6000,
          units: '0.718',
          valueMinor: 5_400_000n,
          sortOrder: 0,
        },
      ],
    });
    const assets = goalAssetOptions([SPY]);
    const priced = await renderApp(
      <GoalAssetNotices
        goals={[goal]}
        assets={assets}
        accountsOnly={false}
        currency="IDR"
        locale="id"
        onAccountsOnly={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(priced.screen.getByRole('status').query()).toBeNull();
    await priced.screen.unmount();
    const only = await renderApp(
      <GoalAssetNotices
        goals={[goal]}
        assets={assets}
        accountsOnly
        currency="IDR"
        locale="id"
        onAccountsOnly={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    await expect.element(only.screen.getByRole('status')).toMatchTextContent('Menampilkan saldo rekening saja');
    await expect.element(only.screen.getByRole('button', { name: 'Hitung lagi dengan investasi' })).toBeVisible();
  });

  it('shows a drop without a percentage when the holding equals today’s move', async () => {
    const goal = goalSummary({
      id: 'g1',
      name: 'DP Rumah',
      assetSources: [
        {
          id: 's1',
          assetId: SPY.id,
          symbol: 'SPY',
          assetName: SPY.name,
          mode: 'percent',
          valuation: 'market',
          bps: 6000,
          units: '1',
          valueMinor: 1n,
          sortOrder: 0,
        },
      ],
    });
    const assets = goalAssetOptions([
      {
        ...SPY,
        value: {
          ...(SPY.value as NonNullable<typeof SPY.value>),
          valueBaseMinor: -100_000n,
          todayBaseMinor: -100_000n,
        },
      },
    ]);
    const { screen } = await renderApp(
      <GoalAssetNotices
        goals={[goal]}
        assets={assets}
        accountsOnly
        currency="IDR"
        locale="id"
        onAccountsOnly={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    await expect.element(screen.getByRole('status', { name: 'Harga SPY turun' })).toMatchTextContent('SPY hari ini');
  });
});
