// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ACCOUNTS, CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { detectedOverview } from '../../../test/subscription-fixtures.ts';
import { DetectionPanel, type DetectionPanelProps } from './detection-panel.tsx';

function Harness(props: Omit<DetectionPanelProps, 'open' | 'onOpenChange'>) {
  const [open, setOpen] = useState(false);
  return <DetectionPanel {...props} open={open} onOpenChange={setOpen} />;
}

describe('DetectionPanel', () => {
  it('golden: Vidio and Google One, added one by one or all, with the total impact', async () => {
    const adding = Promise.withResolvers<undefined>();
    const onAdd = vi.fn(() => adding.promise);
    const onDismiss = vi.fn(() => Promise.resolve());
    const { screen } = await renderApp(
      <Harness
        detected={detectedOverview()}
        baseCurrency="IDR"
        accounts={ACCOUNTS}
        categories={CATEGORIES}
        locale="id"
        onAdd={onAdd}
        onDismiss={onDismiss}
      />,
    );
    await screen.getByRole('button', { name: 'Deteksi dari transaksi 2 baru' }).click();
    const panel = page.getByRole('dialog');
    await expect.element(panel.getByRole('heading', { name: '2 tagihan berulang terdeteksi' })).toBeVisible();
    const items = panel.getByRole('listitem');
    await expect
      .element(items.nth(0))
      .toMatchTextContent(
        /^VVidiotiap ±tgl 12 · terakhir 12 OktRp39\.000AguSepOktOVO · HiburanTambahkanBukan langganan$/,
      );
    await expect.element(items.nth(1)).toMatchTextContent(/^GGoogle Onetiap ±tgl 5 · terakhir 5 OktRp26\.900AguSepOkt/);
    await expect.element(panel.getByText('Jika ditambahkan: Rp970.800/bulan (+Rp65.900)')).toBeVisible();
    await items.nth(0).getByRole('button', { name: 'Tambahkan' }).click();
    expect(onAdd).toHaveBeenCalledWith(['det-vidio']);
    await expect.element(items.nth(0).getByRole('button', { name: 'Tambahkan' })).toHaveAttribute('aria-busy', 'true');
    adding.resolve(undefined);
    await expect
      .element(items.nth(0).getByRole('button', { name: 'Tambahkan' }))
      .not.toHaveAttribute('aria-busy', 'true');
    await items.nth(1).getByRole('button', { name: 'Bukan langganan' }).click();
    expect(onDismiss).toHaveBeenCalledWith(['det-google']);
    await panel.getByRole('button', { name: 'Tambah semua' }).click();
    expect(onAdd).toHaveBeenLastCalledWith(['det-vidio', 'det-google']);
  });

  it('explains detection when nothing is found', async () => {
    for (const detected of [null, detectedOverview({ candidates: [] })]) {
      const { screen } = await renderApp(
        <Harness
          detected={detected}
          baseCurrency="IDR"
          accounts={ACCOUNTS}
          categories={CATEGORIES}
          locale="id"
          onAdd={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      await screen.getByRole('button', { name: 'Deteksi dari transaksi' }).click();
      await expect.element(page.getByRole('heading', { name: 'Belum ada tagihan berulang terdeteksi' })).toBeVisible();
      await expect.element(page.getByText(/Deteksi otomatis aktif setelah 2 bulan transaksi tercatat/)).toBeVisible();
      await expect.element(page.getByRole('button', { name: 'Tambah semua' })).not.toBeInTheDocument();
      await screen.unmount();
    }
  });
});
