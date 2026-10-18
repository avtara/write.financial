// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { DoneStep } from './done-step.tsx';

const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('../../lib/navigation.ts', () => navigation);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DoneStep', () => {
  it('reminds to back up the KEK with copyable commands', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const { screen } = await renderApp(<DoneStep />);
    await expect.element(screen.getByRole('heading', { name: 'Cadangkan kunci enkripsi' })).toBeVisible();
    await expect.element(screen.getByText(/tidak bisa dipulihkan oleh siapa pun/)).toBeVisible();
    await expect.element(screen.getByText(/Kuncinya ada di \/run\/wf-secrets\/kek/)).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Salin perintah: docker compose cp web:/run/wf-secrets/kek ./write-financial-kek.backup',
      }),
    );
    expect(write).toHaveBeenLastCalledWith('docker compose cp web:/run/wf-secrets/kek ./write-financial-kek.backup');
    await userEvent.click(
      screen.getByRole('button', { name: 'Salin perintah: chmod 600 ./write-financial-kek.backup' }),
    );
    expect(write).toHaveBeenLastCalledWith('chmod 600 ./write-financial-kek.backup');
  });

  it('goes to the overview with a full page load', async () => {
    const { screen } = await renderApp(<DoneStep />);
    await userEvent.click(screen.getByRole('button', { name: 'Ke Ringkasan' }));
    expect(navigation.hardNavigate).toHaveBeenCalledWith('/');
  });
});
