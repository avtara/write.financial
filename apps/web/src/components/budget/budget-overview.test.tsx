// SPDX-License-Identifier: AGPL-3.0-only
import type { BudgetStatus } from '@wf/db/budgets';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import {
  AUGUST,
  budgetLine,
  budgetStatus,
  FOOD,
  OCTOBER,
  periodsOverview,
  periodView,
  RENT,
  SEPTEMBER,
  SHOPPING,
} from '../../../test/budget-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { BudgetGroupsCard, BudgetHero, PeriodRange, PeriodSwitcher, TransitionBanner } from './budget-overview.tsx';

/** A transition row that was never stored (no id). */
const TRANSITION = periodView({
  id: null,
  kind: 'transition',
  start: '2026-07-10' as LocalDate,
  end: '2026-07-31' as LocalDate,
  days: 22,
  label: '2026-07' as YearMonth,
});
const PERIODS = periodsOverview({ periods: [OCTOBER, SEPTEMBER, AUGUST, TRANSITION] });

describe('PeriodRange', () => {
  it('shows the first and last day', async () => {
    const { screen } = await renderApp(
      <p data-testid="range">
        <PeriodRange period={SEPTEMBER} />
      </p>,
    );
    await expect.element(screen.getByTestId('range')).toHaveTextContent('1 Sep – 30 Sep');
  });
});

describe('PeriodSwitcher', () => {
  it('steps to the older and newer rows', async () => {
    const onChange = vi.fn();
    const { screen } = await renderApp(<PeriodSwitcher period={SEPTEMBER} periods={PERIODS} onChange={onChange} />);
    await screen.getByRole('button', { name: 'Periode sebelumnya' }).click();
    expect(onChange).toHaveBeenLastCalledWith('p-agu');
    await screen.getByRole('button', { name: 'Periode berikutnya' }).click();
    expect(onChange).toHaveBeenLastCalledWith('p-okt');
  });

  it('disables the ends and skips a row without an id', async () => {
    const onChange = vi.fn();
    const first = await renderApp(<PeriodSwitcher period={OCTOBER} periods={PERIODS} onChange={onChange} />);
    await expect.element(first.screen.getByRole('button', { name: 'Periode berikutnya' })).toBeDisabled();
    await first.screen.unmount();

    const { screen } = await renderApp(<PeriodSwitcher period={AUGUST} periods={PERIODS} onChange={onChange} />);
    await screen.getByRole('button', { name: 'Periode sebelumnya' }).click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lists every row with its state and picks one from the menu', async () => {
    const onChange = vi.fn();
    const { screen } = await renderApp(<PeriodSwitcher period={OCTOBER} periods={PERIODS} onChange={onChange} />);
    await screen.getByRole('button', { name: 'Periode Oktober 2026, pilih periode lain' }).click();
    await expect.element(screen.getByRole('menuitemradio', { name: /Oktober 2026.*Berjalan/ })).toBeChecked();
    await expect.element(screen.getByRole('menuitemradio', { name: /Agustus 2026.*Terbuka/ })).toBeVisible();
    await expect
      .element(screen.getByRole('menuitemradio', { name: /Juli 2026.*10 Jul – 31 Jul · Transisi/ }))
      .toBeVisible();
    await screen.getByRole('menuitemradio', { name: /September 2026.*1 Sep – 30 Sep · Ditutup/ }).click();
    expect(onChange).toHaveBeenCalledWith('p-sep');
  });

  it('opens on a period that has no row yet', async () => {
    const { screen } = await renderApp(
      <PeriodSwitcher period={{ ...OCTOBER, id: null }} periods={periodsOverview()} onChange={vi.fn()} />,
    );
    await expect.element(screen.getByRole('button', { name: 'Periode berikutnya' })).toBeDisabled();
    await screen.getByRole('button', { name: /pilih periode lain/ }).click();
    await expect.element(screen.getByRole('menuitemradio', { name: /Oktober 2026/ })).not.toBeChecked();
  });
});

describe('TransitionBanner', () => {
  it('announces the prorated limit of the next transition period', async () => {
    const { screen } = await renderApp(
      <TransitionBanner
        transition={{
          period: {
            kind: 'transition',
            start: '2026-11-01' as LocalDate,
            end: '2026-11-24' as LocalDate,
            days: 24,
            label: '2026-11' as YearMonth,
          },
          limitMinor: 18_750_000n,
          proratedMinor: 15_000_000n,
        }}
      />,
    );
    const banner = screen.getByRole('region', { name: 'Periode transisi berikutnya' });
    await expect
      .element(banner.getByRole('heading', { name: 'Berikutnya: periode transisi 1–24 November' }))
      .toBeVisible();
    await expect
      .element(banner)
      .toMatchTextContent(
        /Periode transisi hanya 24 hari, jadi batas anggaran diprorata 24\/30 hari: total Rp18\.750\.000 → Rp15\.000\.000\./,
      );
  });
});

const hero = async (status: BudgetStatus) => {
  const { screen } = await renderApp(<BudgetHero status={status} />);
  return screen.getByRole('region');
};

describe('BudgetHero', () => {
  it('shows the open period ahead of plan with one category over and the projection over', async () => {
    const region = await hero(budgetStatus());
    await expect.element(region.getByRole('heading', { name: 'Sisa anggaran Oktober' })).toBeVisible();
    await expect.element(region).toMatchTextContent(/Rp1\.300\.000dari Rp12\.500\.000/);
    await expect.element(region.getByText('Lebih cepat dari rencana')).toBeVisible();
    await expect.element(region.getByText('Hari ini · ideal 48,39%')).toBeVisible();
    await expect.element(region.getByText('Terpakai Rp11.200.000')).toBeVisible();
    await expect.element(region.getByText('Sisa Rp1.300.000')).toBeVisible();
    await expect.element(region.getByText('89,60% · ideal 48,39%')).toBeVisible();
    await expect.element(region.getByText('Batas aman harian')).toBeVisible();
    await expect.element(region.getByText('sisa ÷ 17 hari')).toBeVisible();
    await expect.element(region.getByText('lewat Rp10.500.000')).toHaveClass('text-red-fg-soft');
    await expect.element(region.getByText('1 kategori')).toHaveClass('text-red-fg');
    await expect.element(region.getByText('Belanja Online +Rp400.000')).toBeVisible();
    expect(region.element().querySelector('rect.fill-amber')).not.toBeNull();
  });

  it('shows an overspent period on plan with nothing over and the projection within', async () => {
    const status = budgetStatus({ lines: [FOOD, RENT] });
    const region = await hero({
      ...status,
      totals: { ...status.totals, remainingMinor: -1n, pace: 'on_track', projectedOverMinor: 0n },
    });
    await expect.element(region.getByText('Sesuai rencana')).toBeVisible();
    await expect.element(region.getByText('dalam batas', { exact: true })).toBeVisible();
    await expect.element(region.getByText('semua dalam batas')).toBeVisible();
    await expect.element(region.getByText('0 kategori')).toHaveClass('text-fg');
    expect(region.element().querySelector('rect.fill-red')).not.toBeNull();
  });

  it('shows the result of a closed period with the unbudgeted spending and several over', async () => {
    const over = budgetLine({ categoryId: 'fees', name: 'Biaya', spentMinor: 3_600_000n, state: 'over' });
    const status = budgetStatus({ period: SEPTEMBER, readOnly: true, lines: [SHOPPING, over, FOOD] });
    const region = await hero({ ...status, totals: { ...status.totals, unbudgetedSpentMinor: 700_000n } });
    await expect.element(region.getByRole('heading', { name: 'Hasil September' })).toBeVisible();
    await expect.element(region.getByText('Sesuai rencana')).toBeVisible();
    await expect.element(region.getByText('Selesai · 102,22% terpakai')).toBeVisible();
    await expect.element(region.getByText('102,22% · +Rp700.000 tanpa anggaran')).toBeVisible();
    await expect.element(region.getByText('setelah rollover')).toBeVisible();
    await expect.element(region.getByText('Batas aman harian')).not.toBeInTheDocument();
    await expect.element(region.getByText('Proyeksi akhir bulan')).not.toBeInTheDocument();
    await expect.element(region.getByText('total +Rp500.000')).toBeVisible();
  });

  it('shows only the share used for a closed period without unbudgeted spending', async () => {
    const region = await hero(budgetStatus({ period: SEPTEMBER, readOnly: true }));
    await expect.element(region.getByText('89,60%', { exact: true }).first()).toBeVisible();
    await expect.element(region.getByText(/tanpa anggaran/)).not.toBeInTheDocument();
  });
});

describe('BudgetGroupsCard', () => {
  it('shows each group against its limit, over or not, and the over count', async () => {
    const status = budgetStatus();
    const { screen } = await renderApp(
      <BudgetGroupsCard
        status={{
          ...status,
          groups: [
            ...status.groups,
            {
              group: 'wants',
              limitMinor: 1_000_000n,
              spentMinor: 1_200_000n,
              usedBps: 12_000,
              lineCount: 1,
              overCount: 1,
            },
            { group: 'financial', limitMinor: 100_000n, spentMinor: 0n, usedBps: null, lineCount: 1, overCount: 0 },
            { group: 'active', limitMinor: 100_000n, spentMinor: 50_000n, usedBps: 5000, lineCount: 1, overCount: 0 },
          ],
        }}
      />,
    );
    const card = screen.getByRole('region', { name: 'Kebutuhan & Keinginan' });
    await expect.element(card.getByText('Terpakai dari batas Oktober')).toBeVisible();
    await expect.element(card.getByText('Kebutuhan', { exact: true })).toBeVisible();
    await expect.element(card.getByText('92,63%')).toBeVisible();
    await expect.element(card.getByText('sisa Rp700.000')).toHaveClass('text-subtle');
    await expect.element(card.getByText('sisa Rp600.000')).toHaveClass('text-amber-fg');
    await expect.element(card.getByText('lewat Rp200.000')).toHaveClass('text-red-fg');
    await expect.element(card.getByText('—')).toBeVisible();
    await expect.element(card.getByText('Aktif')).toBeVisible();
    await expect.element(card.getByText('2 kategori lewat batas')).toBeVisible();
    const fills = [...card.element().querySelectorAll('svg rect:nth-child(2)')].map((rect) =>
      rect.getAttribute('class'),
    );
    expect(fills).toEqual(['fill-blue', 'fill-violet', 'fill-violet', 'fill-subtle']);
    expect(card.element().querySelector('.bg-subtle')).not.toBeNull();
    expect(card.element().querySelector('.text-red-fg.size-3\\.5')).not.toBeNull();
  });

  it('confirms that no group is over', async () => {
    const status = budgetStatus();
    const { screen } = await renderApp(
      <BudgetGroupsCard status={{ ...status, groups: status.groups.map((group) => ({ ...group, overCount: 0 })) }} />,
    );
    await expect.element(screen.getByText('0 kategori lewat batas')).toBeVisible();
    expect(screen.container.querySelector('.text-green-fg.size-3\\.5')).not.toBeNull();
  });
});
