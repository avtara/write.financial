// SPDX-License-Identifier: AGPL-3.0-only
import { ReceiptText } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { EmptyState } from './empty-state.tsx';

describe('EmptyState', () => {
  it('shows the title, explanation, first actions, note, and faded rows', async () => {
    const screen = await render(
      <EmptyState
        icon={ReceiptText}
        title="Belum ada transaksi"
        description="Catat pemasukan atau pengeluaran pertamamu."
        actions={<button type="button">Catat transaksi</button>}
        note="Semua dicatat manual"
        ghostRows
        className="extra"
      />,
    );
    await expect.element(screen.getByText('Belum ada transaksi')).toBeVisible();
    await expect.element(screen.getByText('Catat pemasukan atau pengeluaran pertamamu.')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Catat transaksi' })).toBeVisible();
    await expect.element(screen.getByText('Semua dicatat manual')).toBeVisible();
    const root = screen.container.firstElementChild as HTMLElement;
    expect(root.className).toContain('extra');
    expect(root.querySelectorAll('[aria-hidden="true"] > div')).toHaveLength(3);
    // Plain content: not announced as a status or alert.
    expect(root.getAttribute('role')).toBeNull();
  });

  it('needs only an icon and a title', async () => {
    const screen = await render(<EmptyState icon={ReceiptText} title="Belum ada langganan" />);
    await expect.element(screen.getByText('Belum ada langganan')).toBeVisible();
    expect(screen.container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.getByRole('button').query()).toBeNull();
  });
});
