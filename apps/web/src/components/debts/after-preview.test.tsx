// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { AfterPreview } from './after-preview.tsx';

describe('AfterPreview', () => {
  it('shows before → after, "tetap" when unchanged, the currency where asked, tones, and extra content', async () => {
    const { screen } = await renderApp(
      <AfterPreview
        currency="IDR"
        locale="id"
        rows={[
          { label: 'Saldo BCA Tahapan', beforeMinor: 42_810_000n, afterMinor: 42_310_000n },
          { label: 'Pengeluaran Oktober', beforeMinor: 16_500_000n, afterMinor: null },
          { label: 'Batas aman harian', beforeMinor: 140_000n, afterMinor: 155_000n, style: 'amount', tone: 'green' },
        ]}
      >
        <p>catatan</p>
      </AfterPreview>,
    );
    const region = screen.getByRole('region', { name: 'Setelah disimpan' });
    await expect
      .element(region)
      .toMatchTextContent(
        /Saldo BCA Tahapan42\.810\.00042\.310\.000Pengeluaran Oktober16\.500\.000tetapBatas aman harianRp140\.000Rp155\.000catatan/,
      );
    await expect.element(region.getByText('Rp155.000')).toHaveClass(/text-green-fg/);
  });
});
