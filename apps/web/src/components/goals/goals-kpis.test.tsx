// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { goalsOverview } from '../../../test/goal-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { GoalsKpis } from './goals-kpis.tsx';

describe('GoalsKpis', () => {
  it('golden: Rp17.325.000 in 6 goals, October Rp3.500.000 of Rp4.650.000 with the 25th to come, 0,5 months', async () => {
    const { screen } = await renderApp(<GoalsKpis overview={goalsOverview()} locale="id" />);
    const kpis = screen.getByRole('region', { name: 'Ringkasan tabungan' });
    await expect.element(kpis).toMatchTextContent(/Total terkumpulRp17\.325\.000di 6 tujuan/);
    await expect
      .element(kpis)
      .toMatchTextContent(/Setoran OktoberRp3\.500\.000dari rencana Rp4\.650\.000 · sisa tgl 25/);
    await expect.element(kpis).toMatchTextContent(/Dana darurat0,5 bulantarget 3 bulan pengeluaran/);
  });

  it('shows zeros and dashes without goals, in English too', async () => {
    const { screen } = await renderApp(
      <GoalsKpis overview={goalsOverview({ goals: [], movements: [] })} locale="en" />,
      { preferences: { locale: 'en' } },
    );
    const kpis = screen.getByRole('region', { name: 'Savings summary' });
    await expect.element(kpis).toMatchTextContent(/Total savedRp0no goals yet/);
    await expect.element(kpis).toMatchTextContent(/October contributionsRp0no recurring contributions yet/);
    await expect.element(kpis).toMatchTextContent(/Emergency fund—target 3 months of spending/);
  });

  it('leaves out the pending days once every contribution of the month is recorded', async () => {
    const overview = goalsOverview();
    const { screen } = await renderApp(
      <GoalsKpis overview={{ ...overview, movements: overview.movements.slice(0, 2) }} locale="id" />,
    );
    await expect.element(screen.getByText('dari rencana Rp4.650.000', { exact: true })).toBeVisible();
  });
});
