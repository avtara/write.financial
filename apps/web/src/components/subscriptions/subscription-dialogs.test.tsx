// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { S_HOSTING, S_NETFLIX, S_YOUTUBE, seedOverview } from '../../../test/subscription-fixtures.ts';
import { CancelDialog, PauseDialog } from './subscription-dialogs.tsx';

describe('PauseDialog', () => {
  it('golden: pausing Netflix 1 month resumes 18 Nov, saves Rp186.000, leaves Rp474.900 for October', async () => {
    const onPause = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onOpenChange = vi.fn();
    const { screen } = await renderApp(
      <PauseDialog
        subscription={S_NETFLIX}
        overview={seedOverview()}
        locale="id"
        onOpenChange={onOpenChange}
        onPause={onPause}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Jeda Netflix' });
    await expect
      .element(dialog.getByText('Tagihan berhenti sementara, tidak muncul di kalender & proyeksi.'))
      .toBeVisible();
    await expect.element(dialog.getByRole('radio', { name: /^1 bulan/ })).toBeChecked();
    await expect.element(dialog.getByText('aktif lagi Rabu, 18 Nov')).toBeVisible();
    await expect.element(dialog.getByText('aktif lagi Jumat, 18 Des')).toBeVisible();
    await expect.element(dialog.getByText('−Rp372.000')).toBeVisible();
    await expect.element(dialog.getByText('15 Nov · supaya sempat batalkan kalau tidak perlu')).toBeVisible();
    await expect.element(dialog.getByText('Sisa tagihan Okt jadi Rp474.900')).toBeVisible();
    await expect
      .element(dialog.getByText('Jeda juga di aplikasi Netflix — write.financial hanya mencatat.'))
      .toBeVisible();
    await dialog.getByRole('button', { name: 'Jeda 1 bulan' }).click();
    expect(onPause).toHaveBeenLastCalledWith(S_NETFLIX, { months: 1 }, 3);
    expect(onOpenChange).not.toHaveBeenCalled();

    await dialog.getByRole('radio', { name: /^2 bulan/ }).click();
    await dialog.getByRole('switch', { name: /Ingatkan 3 hari sebelum aktif lagi/ }).click();
    await expect.element(dialog.getByText('Supaya sempat batalkan kalau tidak perlu')).toBeVisible();
    await dialog.getByRole('button', { name: 'Jeda 2 bulan' }).click();
    expect(onPause).toHaveBeenLastCalledWith(S_NETFLIX, { months: 2 }, null);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('pauses until a picked date after the next bill', async () => {
    const onPause = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const onOpenChange = vi.fn();
    const { screen } = await renderApp(
      <PauseDialog
        subscription={{ ...S_NETFLIX, nextBill: null }}
        overview={seedOverview()}
        locale="id"
        onOpenChange={onOpenChange}
        onPause={onPause}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Jeda Netflix' });
    await dialog.getByRole('radio', { name: 'Pilih tanggal…' }).click();
    const submit = dialog.getByRole('button', { name: 'Jeda sampai tanggal itu' });
    await expect.element(submit).toBeDisabled();
    (dialog.element().querySelector('form') as HTMLFormElement).requestSubmit();
    expect(onPause).not.toHaveBeenCalled();
    await dialog.getByRole('button', { name: 'Pilih tanggal…' }).click();
    await screen.getByRole('button', { name: 'Kamis, 15 Oktober 2026' }).click();
    await expect.element(dialog.getByText('Pilih tanggal setelah tagihan 18 Okt.')).toBeVisible();
    await expect.element(submit).toBeDisabled();
    await dialog.getByRole('button', { name: 'Pilih tanggal…' }).click();
    await screen.getByRole('button', { name: 'Bulan berikutnya' }).click();
    await screen.getByRole('button', { name: 'Bulan berikutnya' }).click();
    await screen.getByRole('button', { name: 'Selasa, 1 Desember 2026' }).click();
    await expect.element(dialog.getByText(/^28 Nov · supaya/)).toBeVisible();
    await expect.element(dialog.getByText('Sisa tagihan Okt jadi Rp474.900')).toBeVisible();
    await submit.click();
    expect(onPause).toHaveBeenCalledWith(expect.objectContaining({ id: 'netflix' }), { until: '2026-12-01' }, 3);
    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('is closed without a subscription', async () => {
    const { screen } = await renderApp(
      <PauseDialog
        subscription={null}
        overview={seedOverview()}
        locale="id"
        onOpenChange={vi.fn()}
        onPause={vi.fn()}
      />,
    );
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('CancelDialog', () => {
  it('golden: cancels YouTube Premium after its 22 Okt bill or now, once cancelled in the app too', async () => {
    const onCancel = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onOpenChange = vi.fn();
    const { screen } = await renderApp(
      <CancelDialog
        subscription={S_YOUTUBE}
        accountName="BCA Tahapan"
        locale="id"
        onOpenChange={onOpenChange}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Batalkan YouTube Premium?' });
    await expect.element(dialog).toMatchTextContent(/Rp59\.000\/bulanditagih 22 Okt dari BCA Tahapan/);
    await expect.element(dialog.getByRole('radio', { name: /Berhenti setelah tagihan 22 Okt/ })).toBeChecked();
    await expect.element(dialog.getByText('tagihan 22 Okt tetap masuk Perlu ditinjau')).toBeVisible();
    await expect.element(dialog.getByText('tagihan 22 Okt dihapus dari jadwal')).toBeVisible();
    const submit = dialog.getByRole('button', { name: 'Batalkan langganan' });
    await expect.element(submit).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Sudah dibatalkan di aplikasi YouTube Premium' }).click();
    await submit.click();
    expect(onCancel).toHaveBeenLastCalledWith(S_YOUTUBE, 'after_next_bill');
    expect(onOpenChange).not.toHaveBeenCalled();
    await dialog.getByRole('radio', { name: /Berhenti sekarang/ }).click();
    await submit.click();
    expect(onCancel).toHaveBeenLastCalledWith(S_YOUTUBE, 'now');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stops a yearly one without a scheduled bill now, and closes on Batal', async () => {
    const onCancel = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const onOpenChange = vi.fn();
    const { screen } = await renderApp(
      <CancelDialog
        subscription={S_HOSTING}
        accountName="BCA Tahapan"
        locale="id"
        onOpenChange={onOpenChange}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Batalkan Niagahoster?' });
    await expect.element(dialog).toMatchTextContent(/Rp660\.900\/tahun/);
    await expect.element(dialog.getByRole('radio')).not.toBeInTheDocument();
    await dialog.getByRole('checkbox').click();
    await dialog.getByRole('button', { name: 'Batalkan langganan' }).click();
    expect(onCancel).toHaveBeenCalledWith(S_HOSTING, 'now');
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('is closed without a subscription', async () => {
    const { screen } = await renderApp(
      <CancelDialog subscription={null} accountName="" locale="id" onOpenChange={vi.fn()} onCancel={vi.fn()} />,
    );
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});
