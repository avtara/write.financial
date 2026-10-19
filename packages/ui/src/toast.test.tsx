// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { toast, ToastCard, Toaster } from './toast.tsx';

function tokenColor(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(--${token})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

afterEach(() => {
  toast.dismiss();
});

describe('ToastCard', () => {
  it.each([
    ['success', 'green-fg'],
    ['error', 'red-fg'],
    ['warning', 'amber-fg'],
    ['info', 'blue-fg'],
  ] as const)('shows a %s icon', async (tone, color) => {
    const screen = await render(<ToastCard title="Judul toast" tone={tone} />);
    await expect.element(screen.getByText('Judul toast')).toBeVisible();
    expect(getComputedStyle(screen.container.querySelector('svg') as SVGElement).color).toBe(tokenColor(color));
    expect(screen.getByRole('button').query()).toBeNull();
  });

  it('shows a description and an action button', async () => {
    const onClick = vi.fn();
    const screen = await render(
      <ToastCard
        title="Judul toast"
        description="Keterangan singkat hasil tindakan."
        action={{ label: 'Aksi', onClick }}
      />,
    );
    await expect.element(screen.getByText('Keterangan singkat hasil tindakan.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Aksi' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('toast', () => {
  it('appears in the named region, runs its action once, and dismisses itself', async () => {
    const onClick = vi.fn();
    const screen = await render(<Toaster label="Notifikasi" />);
    await expect.element(screen.getByRole('region', { name: 'Notifikasi' })).toBeInTheDocument();
    toast({ title: 'Gagal menyimpan', tone: 'error', action: { label: 'Coba lagi', onClick } });
    const retry = page.getByRole('button', { name: 'Coba lagi' });
    await expect.element(page.getByText('Gagal menyimpan')).toBeVisible();
    await userEvent.click(retry);
    expect(onClick).toHaveBeenCalledOnce();
    await expect.element(page.getByText('Gagal menyimpan')).not.toBeInTheDocument();
  });

  it('replaces a toast with the same id and leaves after its duration', async () => {
    await render(<Toaster label="Notifikasi" />);
    const id = toast({ title: 'Menyimpan…', id: 'save', duration: 60_000 });
    expect(id).toBe('save');
    toast({ title: 'Tersimpan', id: 'save', duration: 300 });
    await expect.element(page.getByText('Tersimpan')).toBeVisible();
    expect(page.getByText('Menyimpan…').query()).toBeNull();
    await expect.element(page.getByText('Tersimpan'), { timeout: 3000 }).not.toBeInTheDocument();
  });

  it('offers Urungkan after a reversible change', async () => {
    const onUndo = vi.fn();
    await render(<Toaster label="Notifikasi" />);
    toast.undo({ title: 'Transaksi dihapus', description: 'Shopee · −Rp389.000', undoLabel: 'Urungkan', onUndo });
    await expect.element(page.getByText('Shopee · −Rp389.000')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Urungkan' }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('is 400 px wide', async () => {
    await page.viewport(1440, 900);
    await render(<Toaster label="Notifikasi" />);
    toast({ title: 'Transaksi tersimpan' });
    await expect.element(page.getByText('Transaksi tersimpan')).toBeVisible();
    const card = page.getByText('Transaksi tersimpan').element().closest('li') as HTMLElement;
    await expect.poll(() => Math.round(card.getBoundingClientRect().width)).toBe(400);
  });
});
