// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { BBCA, portfolioView, SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AdjustDialog, AssetGoalsDialog, MoveDialog } from './asset-dialogs.tsx';

describe('AdjustDialog', () => {
  it('carries a missing position value into the sale instead of silently discarding it', async () => {
    const sell = vi.fn();
    const submit = vi.fn();
    const { screen } = await renderApp(
      <AdjustDialog
        asset={SPY}
        rate="16350"
        base="IDR"
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={submit}
        onSell={sell}
      />,
    );
    await screen.getByRole('textbox', { name: 'Di aplikasi Gotrade' }).fill('1,15');
    await screen.getByRole('radio', { name: /Catat sebagai penjualan/ }).click();
    await screen.getByRole('button', { name: 'Lanjut ke Catat jual' }).click();
    expect(sell).toHaveBeenCalledWith(SPY, expect.any(BigInt));
    expect(sell.mock.calls[0]?.[1]).toBeGreaterThan(0n);
    expect(submit).not.toHaveBeenCalled();
  });

  it('saves an unrecorded buy or a correction with the chosen goal, and reports a refusal', async () => {
    const submit = vi.fn().mockResolvedValueOnce('Tidak tersimpan.');
    const onOpenChange = vi.fn();
    const { screen } = await renderApp(
      <AdjustDialog
        asset={SPY}
        rate="16350"
        base="IDR"
        locale="id"
        onOpenChange={onOpenChange}
        onSubmit={submit}
        onSell={vi.fn()}
      />,
    );
    const units = screen.getByRole('textbox', { name: 'Di aplikasi Gotrade' });
    await units.fill('0,047');
    await screen.getByRole('radio', { name: /Koreksi salah input/ }).click();
    // A correction across two goals needs the reduced one first.
    await screen.getByRole('button', { name: 'Simpan penyesuaian' }).click();
    expect(submit).not.toHaveBeenCalled();
    await screen.getByRole('radio', { name: 'Kurangi dari DP Rumah' }).click();
    await screen.getByRole('button', { name: 'Simpan penyesuaian' }).click();
    await expect.element(screen.getByText('Tidak tersimpan.')).toBeVisible();
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'correction', amountMinor: null, reduceGoalId: 'goal-rumah' }),
    );
    await screen.unmount();
  });

  it('records more units as a buy or a DRIP, and disables without a price or rate', async () => {
    const submit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <AdjustDialog
        asset={SPY}
        rate="16350"
        base="IDR"
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={submit}
        onSell={vi.fn()}
      />,
    );
    await screen.getByRole('textbox', { name: 'Di aplikasi Gotrade' }).fill('1,215');
    await expect.element(screen.getByRole('radio', { name: /Pembelian yang belum dicatat/ })).toBeChecked();
    await screen.getByRole('radio', { name: /Dividen diinvestasikan ulang/ }).click();
    await screen.getByRole('button', { name: 'Simpan penyesuaian' }).click();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ reason: 'drip', fxRate: '16350', price: '690.10' }));
    await screen.unmount();
    const noPrice = await renderApp(
      <AdjustDialog
        asset={{ ...SPY, quote: null }}
        rate="16350"
        base="IDR"
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        onSell={vi.fn()}
      />,
    );
    await expect
      .element(noPrice.screen.getByText('Aset ini belum punya harga; selisihnya belum bisa dinilai.'))
      .toBeVisible();
    await expect.element(noPrice.screen.getByRole('button', { name: 'Simpan penyesuaian' })).toBeDisabled();
    await noPrice.screen.unmount();
    const noRate = await renderApp(
      <AdjustDialog
        asset={SPY}
        rate={null}
        base="IDR"
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        onSell={vi.fn()}
      />,
    );
    await noRate.screen.getByRole('textbox', { name: 'Di aplikasi Gotrade' }).fill('1,215');
    await expect.element(noRate.screen.getByRole('button', { name: 'Simpan penyesuaian' })).toBeDisabled();
    await noRate.screen.unmount();
    const domestic = await renderApp(
      <AdjustDialog
        asset={BBCA}
        rate={null}
        base="IDR"
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={submit}
        onSell={vi.fn()}
      />,
    );
    await domestic.screen
      .getByRole('textbox', { name: 'Di aplikasi Stockbit' })
      .fill(String(Number(BBCA.holding.units) + 1));
    await domestic.screen.getByRole('button', { name: 'Simpan penyesuaian' }).click();
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ fxRate: null }));
  });

  it('moves an asset between categories and reports a refusal', async () => {
    const categories = portfolioView().categories;
    const onOpenChange = vi.fn();
    const submit = vi.fn().mockResolvedValueOnce('Tidak bisa dipindah.');
    const { screen } = await renderApp(
      <MoveDialog asset={SPY} categories={categories} onOpenChange={onOpenChange} onSubmit={submit} />,
    );
    await screen.getByRole('radio', { name: categories[0]?.name as string }).click();
    await screen.getByRole('button', { name: 'Pindahkan' }).click();
    await expect.element(screen.getByText('Tidak bisa dipindah.')).toBeVisible();
    expect(submit).toHaveBeenCalledWith(SPY, categories[0]?.id);
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await screen.unmount();
    const closed = await renderApp(
      <MoveDialog asset={null} categories={[]} onOpenChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    await expect.element(closed.screen.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('splits an asset between goals, rejects an excess, and saves the chosen shares', async () => {
    const goals = [
      { id: 'goal-rumah', name: 'DP Rumah' },
      { id: 'goal-pensiun', name: 'Dana Pensiun' },
    ];
    const onOpenChange = vi.fn();
    const submit = vi.fn().mockResolvedValueOnce('Tidak tersimpan.').mockResolvedValueOnce(null);
    const { screen } = await renderApp(
      <AssetGoalsDialog
        asset={SPY}
        goals={goals}
        base="IDR"
        locale="id"
        onOpenChange={onOpenChange}
        onSubmit={submit}
      />,
    );
    await expect.element(screen.getByText('Bebas dialokasikan 0%')).toBeVisible();
    await screen.getByRole('combobox', { name: 'Alokasi ke DP Rumah' }).selectOptions('whole');
    await expect.element(screen.getByText('Melebihi 100% — total alokasi per aset maksimal 100%.')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Simpan alokasi' })).toBeDisabled();
    await screen.getByRole('combobox', { name: 'Alokasi ke Dana Pensiun' }).selectOptions('none');
    await screen.getByRole('button', { name: 'Simpan alokasi' }).click();
    await expect.element(screen.getByText('Tidak tersimpan.')).toBeVisible();
    await screen.getByRole('button', { name: 'Simpan alokasi' }).click();
    expect(submit).toHaveBeenLastCalledWith(SPY, [{ goalId: 'goal-rumah', mode: 'whole', bps: 10_000 }]);
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await screen.unmount();
    const empty = await renderApp(
      <AssetGoalsDialog asset={SPY} goals={[]} base="IDR" locale="id" onOpenChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    await expect
      .element(empty.screen.getByText('Belum ada tujuan tabungan aktif dalam mata uang utama.'))
      .toBeVisible();
  });

  it('ignores an invalid unit entry and a zero difference', async () => {
    const submit = vi.fn();
    const onOpenChange = vi.fn();
    const { screen } = await renderApp(
      <AdjustDialog
        asset={SPY}
        rate="16350"
        base="IDR"
        locale="id"
        onOpenChange={onOpenChange}
        onSubmit={submit}
        onSell={vi.fn()}
      />,
    );
    const units = screen.getByRole('textbox', { name: 'Di aplikasi Gotrade' });
    await units.fill('abc');
    const form = screen.getByRole('button', { name: 'Batal' }).element().closest('form') as HTMLFormElement;
    form.requestSubmit();
    expect(submit).not.toHaveBeenCalled();
    await units.fill('0');
    await expect.element(screen.getByRole('button', { name: 'Lanjut ke Catat jual' })).toBeEnabled();
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await screen.unmount();
    const closed = await renderApp(
      <AdjustDialog
        asset={null}
        rate={null}
        base="IDR"
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        onSell={vi.fn()}
      />,
    );
    await expect.element(closed.screen.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows no goals, an empty percentage, and a missing value in the goals dialog', async () => {
    const goals = [
      { id: 'goal-rumah', name: 'DP Rumah' },
      { id: 'goal-pensiun', name: 'Dana Pensiun' },
      { id: 'goal-baru', name: 'Tujuan Baru' },
    ];
    const { screen } = await renderApp(
      <AssetGoalsDialog
        asset={{ ...SPY, value: null }}
        goals={goals}
        base="IDR"
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await expect.element(screen.getByRole('combobox', { name: 'Alokasi ke Tujuan Baru' })).toHaveValue('none');
    await screen.getByRole('combobox', { name: 'Alokasi ke Tujuan Baru' }).selectOptions('percent');
    await expect.element(screen.getByText('Isi persentase 0,01–100% untuk tiap tujuan.')).toBeVisible();
    const form = screen.getByRole('button', { name: 'Batal' }).element().closest('form') as HTMLFormElement;
    form.requestSubmit();
    await screen.getByRole('combobox', { name: 'Alokasi ke Tujuan Baru' }).selectOptions('whole');
    await screen.getByRole('combobox', { name: 'Alokasi ke DP Rumah' }).selectOptions('none');
    await screen.getByRole('combobox', { name: 'Alokasi ke Dana Pensiun' }).selectOptions('none');
    await expect.element(screen.getByRole('button', { name: 'Simpan alokasi' })).toBeEnabled();
    await screen.unmount();
    const closed = await renderApp(
      <AssetGoalsDialog asset={null} goals={[]} base="IDR" locale="id" onOpenChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    await expect.element(closed.screen.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('prices an adjustment of an asset whose value is unknown and types a goal percentage', async () => {
    const adjust = await renderApp(
      <AdjustDialog
        asset={{ ...SPY, value: null }}
        rate="16350"
        base="IDR"
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        onSell={vi.fn()}
      />,
    );
    await adjust.screen.getByRole('textbox', { name: 'Di aplikasi Gotrade' }).fill('1,215');
    await expect.element(adjust.screen.getByText(/Selisih .* unit/)).toBeVisible();
    await adjust.screen.unmount();
    const goals = [
      { id: 'goal-rumah', name: 'DP Rumah' },
      { id: 'goal-pensiun', name: 'Dana Pensiun' },
    ];
    const asset = {
      ...SPY,
      goals: [
        { ...(SPY.goals[0] as NonNullable<(typeof SPY.goals)[0]>), mode: 'whole' as const },
        { ...(SPY.goals[1] as NonNullable<(typeof SPY.goals)[1]>), mode: 'percent' as const, bps: 4000 },
      ],
    };
    const mixed = await renderApp(
      <AssetGoalsDialog asset={asset} goals={goals} base="IDR" locale="id" onOpenChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    await expect.element(mixed.screen.getByRole('combobox', { name: 'Alokasi ke DP Rumah' })).toHaveValue('whole');
    await expect
      .element(mixed.screen.getByRole('combobox', { name: 'Alokasi ke Dana Pensiun' }))
      .toHaveValue('percent');
    await expect.element(mixed.screen.getByRole('alert')).toBeVisible();
    await mixed.screen.unmount();
    const { screen } = await renderApp(
      <AssetGoalsDialog asset={SPY} goals={goals} base="IDR" locale="id" onOpenChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    const percent = screen.getByRole('textbox', { name: 'Persentase untuk Dana Pensiun' });
    await expect.element(percent).toHaveValue('40');
    await percent.fill('30');
    await expect.element(screen.getByText('Bebas dialokasikan 10%')).toBeVisible();
    await percent.fill('0');
    await expect.element(screen.getByRole('alert')).toBeVisible();
    await screen.unmount();
    const english = await renderApp(
      <AssetGoalsDialog asset={SPY} goals={goals} base="IDR" locale="en" onOpenChange={vi.fn()} onSubmit={vi.fn()} />,
      { preferences: { locale: 'en' } },
    );
    await expect.element(english.screen.getByText('Free to allocate 0%')).toBeVisible();
  });
});
