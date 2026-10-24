// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { DataSettings } from '../../server/fn/data.ts';
import { DataSection } from './data-section.tsx';

const server = vi.hoisted(() => ({
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletion: vi.fn(),
}));
vi.mock('../../server/fn/data.ts', () => ({
  requestAccountDeletion: server.requestAccountDeletion,
  cancelAccountDeletion: server.cancelAccountDeletion,
}));

const IDLE: DataSettings = { deletionRequestedAt: null, deleteAfter: null };
const REQUESTED_AT = new Date('2026-10-16T09:00:00Z');
const PENDING: DataSettings = {
  deletionRequestedAt: REQUESTED_AT.toISOString(),
  deleteAfter: new Date('2026-10-23T09:00:00Z').toISOString(),
};
const EMAIL = 'avtara@example.test';

const renderSection = (settings: DataSettings = IDLE) =>
  renderApp(<DataSection email={EMAIL} settings={settings} timeZone="Asia/Jakarta" />);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DataSection', () => {
  it('links the JSON and CSV downloads and offers deletion with a typed consent', async () => {
    const { screen } = await renderSection();
    await expect.element(screen.getByRole('region', { name: 'Ekspor semua data' })).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Unduh' }).first())
      .toHaveAttribute('href', '/api/data/export?format=json');
    await expect
      .element(screen.getByRole('link', { name: 'Unduh' }).nth(1))
      .toHaveAttribute('href', '/api/data/export?format=csv');

    // The destructive action is gated by typing the account's email exactly.
    await userEvent.click(screen.getByRole('button', { name: 'Hapus akun' }));
    const dialog = page.getByRole('alertdialog', { name: 'Hapus akun selamanya?' });
    const confirm = dialog.getByRole('button', { name: 'Hapus akun saya' });
    await expect.element(confirm).toBeDisabled();
    await userEvent.fill(dialog.getByLabelText('Ketik avtara@example.test untuk konfirmasi'), 'avtara@other.test');
    await expect.element(confirm).toBeDisabled();
    await userEvent.fill(dialog.getByLabelText('Ketik avtara@example.test untuk konfirmasi'), 'avtara@example.test');
    await expect.element(confirm).toBeEnabled();
  });

  it('starts the 7-day grace period on consent, and shows why the date matters', async () => {
    server.requestAccountDeletion.mockResolvedValueOnce({ ok: false, code: 'TWO_FACTOR_REQUIRED' });
    const { screen } = await renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Hapus akun' }));
    const dialog = page.getByRole('alertdialog', { name: 'Hapus akun selamanya?' });
    await userEvent.fill(dialog.getByLabelText('Ketik avtara@example.test untuk konfirmasi'), EMAIL);
    await userEvent.click(dialog.getByRole('button', { name: 'Hapus akun saya' }));
    // A 2FA refusal surfaces in the dialog; the account stays.
    await expect.element(dialog.getByText('Aktifkan verifikasi dua langkah dulu.')).toBeVisible();
    // The account itself stays: the dialog is still open for a retry once 2FA is on.
    await expect.element(page.getByRole('alertdialog')).toBeVisible();

    server.requestAccountDeletion.mockResolvedValueOnce({ ok: true, value: PENDING });
    await userEvent.click(dialog.getByRole('button', { name: 'Hapus akun saya' }));
    const pending = screen.getByRole('alert');
    await expect.element(pending.getByText('Penghapusan akun dijadwalkan')).toBeVisible();
    await expect.element(pending.getByText(/dihapus pada 23 Okt 2026/)).toBeVisible();
  });

  it('cancels a pending deletion during the grace period', async () => {
    server.cancelAccountDeletion
      .mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' })
      .mockResolvedValueOnce({ ok: true, value: IDLE });
    const { screen } = await renderSection(PENDING);
    const pending = screen.getByRole('alert');
    await expect.element(pending.getByText('Penghapusan akun dijadwalkan')).toBeVisible();
    const cancel = pending.getByRole('button', { name: 'Batalkan penghapusan' });

    // A failed cancel keeps the banner and shows why.
    await userEvent.click(cancel);
    await expect.element(pending.getByText(/Sampai saat itu kamu masih bisa masuk/i)).toBeVisible();
    await expect.element(cancel).toBeEnabled();

    await userEvent.click(cancel);
    await expect.element(screen.getByRole('region', { name: 'Hapus akun' })).toBeVisible();
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
  });
});
