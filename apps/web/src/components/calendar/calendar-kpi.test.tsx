// SPDX-License-Identifier: AGPL-3.0-only
import { Flame } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Kpi, KpiStrip } from './calendar-kpi.tsx';

describe('KpiStrip', () => {
  it('shows each figure with its label, icon, tone and note', async () => {
    const { screen } = await renderApp(
      <>
        <KpiStrip columns={4}>
          <Kpi label="Hari termahal" value="Rp3.380.000" icon={Flame} tone="red" note="Minggu, 11 Okt" />
          <Kpi label="Rata-rata harian" value="—" />
        </KpiStrip>
        <KpiStrip columns={5}>
          <Kpi label="Masuk" value="+Rp6.200.000" tone="green" />
        </KpiStrip>
      </>,
    );
    const strips = screen.getByRole('region', { name: 'Ringkasan kalender' });
    expect(strips.elements()).toHaveLength(2);
    await expect
      .element(strips.first())
      .toMatchTextContent(/^Hari termahalRp3\.380\.000Minggu, 11 OktRata-rata harian—$/);
    await expect.element(strips.first()).toHaveClass('lg:grid-cols-4');
    await expect.element(strips.last()).toHaveClass('lg:grid-cols-5');
    await expect.element(screen.getByText('Rp3.380.000')).toHaveClass('text-red-fg');
    await expect.element(screen.getByText('+Rp6.200.000')).toHaveClass('text-green-fg');
    await expect.element(screen.getByText('—')).toHaveClass('text-fg');
    expect(strips.first().element().querySelectorAll('svg')).toHaveLength(1);
  });
});
