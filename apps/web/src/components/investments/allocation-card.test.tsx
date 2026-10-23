// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AllocationCard, allocationRows } from './allocation-card.tsx';

describe('AllocationCard', () => {
  it('uses actual holdings drift, not the inconsistent design label', async () => {
    const { screen } = await renderApp(
      <AllocationCard portfolio={portfolioView()} locale="id" onEditTargets={vi.fn()} />,
    );
    await expect.element(screen.getByRole('region', { name: 'Alokasi aset' })).toMatchTextContent('3,8%');
  });
  it('shows shares without inventing targets for a new portfolio', () => {
    const rows = allocationRows(portfolioView({ targets: {} }));
    expect(rows.find((row) => row.key === 'crypto')).toMatchObject({
      shareBps: 895,
      targetBps: null,
      deviationBps: null,
    });
  });

  it('shows shares without a drift, flags the class furthest below target, and edits targets', async () => {
    const onEditTargets = vi.fn();
    const { screen } = await renderApp(
      <AllocationCard portfolio={portfolioView({ targets: {} })} locale="id" onEditTargets={onEditTargets} />,
    );
    const card = screen.getByRole('region', { name: 'Alokasi aset' });
    await expect.element(card).toMatchTextContent('Porsi saat ini · ± poin dari target');
    await expect.element(card).not.toMatchTextContent('drift');
    await screen.getByRole('button', { name: 'Atur target' }).click();
    expect(onEditTargets).toHaveBeenCalledOnce();
    await screen.unmount();
    const below = await renderApp(
      <AllocationCard
        portfolio={portfolioView({
          targets: {
            us_stocks: 5450,
            international: 4000,
            indonesia: 200,
            crypto: 100,
            income: 100,
            gold: 100,
            cash: 50,
          },
        })}
        locale="id"
        onEditTargets={vi.fn()}
      />,
    );
    await expect
      .element(below.screen.getByRole('region', { name: 'Alokasi aset' }))
      .toMatchTextContent(/Internasional .* poin di bawah target/);
  });

  it('treats a zero-valued portfolio as no share at all', () => {
    const empty = portfolioView({ targets: {} });
    const rows = allocationRows({ ...empty, summary: { ...empty.summary, valueBaseMinor: 0n } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.shareBps === 0)).toBe(true);
  });

  it('says so when there is nothing to divide yet', async () => {
    const { screen } = await renderApp(
      <AllocationCard
        portfolio={portfolioView({ targets: {}, assets: [], platforms: [] })}
        locale="id"
        onEditTargets={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Belum ada nilai untuk dibagi per kelas.')).toBeVisible();
  });
});
