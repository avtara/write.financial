// SPDX-License-Identifier: AGPL-3.0-only
import type { Active, Over } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { accountView } from '../../../test/accounts.ts';
import { renderApp } from '../../../test/render.tsx';
import { groupByType } from '../../lib/accounts.ts';
import { AccountList, ArchivedList, dragAnnouncements, reorderedIds, type AccountListProps } from './account-list.tsx';

const BCA = accountView({ displayName: 'BCA Tahapan', isDefaultQuickEntry: true });
const JAGO = accountView({ displayName: 'Bank Jago', providerName: 'Bank Jago', last4: '0377' });
const MANDIRI = accountView({ displayName: 'Mandiri', providerName: 'Bank Mandiri' });
const GOPAY = accountView({
  displayName: 'GoPay',
  providerName: 'GoPay',
  type: 'ewallet',
  last4: null,
  phoneMasked: '0812•• 18',
});
const CASH = accountView({ displayName: 'Dompet', providerName: 'Dompet', type: 'cash', last4: null });
const GOTRADE = accountView({
  displayName: 'Gotrade',
  providerName: 'Gotrade',
  type: 'investment',
  currency: 'USD',
  last4: null,
  balanceMinor: 277_800n,
  balanceBaseMinor: 45_420_300n,
  includeInAvailable: false,
});
const ACTIVE = [BCA, JAGO, MANDIRI, GOPAY, CASH, GOTRADE];

async function renderList(props: Partial<AccountListProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onReconcile: vi.fn(),
    onArchive: vi.fn(),
    onToggle: vi.fn(),
    onReorder: vi.fn(),
  };
  const result = await renderApp(
    <AccountList accounts={ACTIVE} baseCurrency="IDR" selectedId={BCA.id} {...handlers} {...props} />,
  );
  return { ...result, ...handlers };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('reorderedIds', () => {
  const groups = groupByType(ACTIVE);
  it('moves within the group and keeps the other groups in place', () => {
    expect(reorderedIds(groups, MANDIRI.id, { id: BCA.id })).toEqual([
      MANDIRI.id,
      BCA.id,
      JAGO.id,
      GOPAY.id,
      CASH.id,
      GOTRADE.id,
    ]);
  });

  it('ignores drops outside the group, on itself, nowhere, or of an unknown account', () => {
    expect(reorderedIds(groups, BCA.id, { id: GOPAY.id })).toBeNull();
    expect(reorderedIds(groups, BCA.id, { id: BCA.id })).toBeNull();
    expect(reorderedIds(groups, BCA.id, null)).toBeNull();
    expect(reorderedIds(groups, 'unknown', { id: BCA.id })).toBeNull();
  });
});

describe('dragAnnouncements', () => {
  it('names the accounts, and says nothing over empty space', () => {
    const announce = dragAnnouncements(ACTIVE);
    const active = { id: BCA.id } as Active;
    const over = { id: JAGO.id } as Over;
    expect(announce.onDragStart({ active })).toContain(BCA.displayName);
    expect(announce.onDragOver({ active, over })).toContain(BCA.displayName);
    expect(announce.onDragOver({ active, over })).toContain(JAGO.displayName);
    expect(announce.onDragOver({ active, over: null })).toBeUndefined();
    expect(announce.onDragEnd({ active, over })).toContain(BCA.displayName);
    expect(announce.onDragEnd({ active, over })).toContain(JAGO.displayName);
    expect(announce.onDragEnd({ active, over: null })).toBeUndefined();
    expect(announce.onDragCancel({ active, over: null })).toContain(BCA.displayName);
  });

  it('never reads out an internal id for an account that left the list mid-drag', () => {
    const announce = dragAnnouncements(ACTIVE);
    const gone = { id: 'acc-gone-0192' } as Active;
    expect(announce.onDragStart({ active: gone })).not.toContain('acc-gone-0192');
    expect(announce.onDragEnd({ active: gone, over: { id: JAGO.id } as Over })).toContain(JAGO.displayName);
  });
});

describe('AccountList', () => {
  it('groups accounts with totals and marks the selected one', async () => {
    const { screen, onSelect } = await renderList();
    const bank = screen.getByRole('region', { name: 'Bank' });
    await expect.element(bank.getByText('3 rekening')).toBeVisible();
    await expect.element(bank.getByText('Rp3.000.000')).toBeVisible();
    await expect.element(bank.getByText('•• 4821 · Bank Central Asia · default')).toBeVisible();
    await expect.element(bank.getByText('•• 0377', { exact: true })).toBeVisible();
    await expect.element(screen.getByText('0812•• 18', { exact: true })).toBeVisible();
    const investment = screen.getByRole('region', { name: 'Investasi' });
    await expect.element(investment.getByText('tidak dihitung di saldo tersedia')).toBeVisible();
    expect(investment.element().textContent).toContain('≈ Rp45.420.300');
    expect(investment.element().textContent).toContain('US$2.778,00');
    // The foreign row says what it is worth in rupiah; base-currency rows do not.
    await expect
      .element(investment.getByRole('button', { name: /^Gotrade/ }))
      .toMatchTextContent(/US\$2\.778,00≈ Rp45\.420\.300$/);
    expect(bank.element().textContent).not.toContain('≈');
    await expect.element(screen.getByRole('button', { name: /^BCA Tahapan/ })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByRole('button', { name: /^Mandiri/ }));
    expect(onSelect).toHaveBeenCalledWith(MANDIRI);
  });

  it('lines the "Saldo" column and the group subtotals up with the row amounts', async () => {
    const { screen } = await renderList();
    const bank = screen.getByRole('region', { name: 'Bank' });
    // Where the text ends: the box's right edge less its right padding.
    const rightEdge = (element: Element) =>
      Math.round(element.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(element).paddingRight));
    const rowAmount = rightEdge(
      bank
        .getByRole('button', { name: /^Mandiri/ })
        .getByText(/^Rp/)
        .element(),
    );
    expect(rightEdge(screen.getByText('Saldo', { exact: true }).element())).toBe(rowAmount);
    expect(rightEdge(bank.getByText('Rp3.000.000').element())).toBe(rowAmount);
  });

  it('runs the ⋮ menu actions', async () => {
    const { screen, onEdit, onReconcile, onArchive, onToggle } = await renderList();
    const open = () => userEvent.click(screen.getByRole('button', { name: 'Menu BCA Tahapan' }));
    await open();
    await userEvent.click(page.getByRole('menuitem', { name: 'Edit rekening' }));
    await open();
    await userEvent.click(page.getByRole('menuitem', { name: 'Sesuaikan saldo' }));
    await open();
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Tampil sebagai kartu' }));
    await open();
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Hitung di saldo tersedia' }));
    await open();
    await userEvent.click(page.getByRole('menuitem', { name: 'Arsipkan' }));
    expect(onEdit).toHaveBeenCalledWith(BCA);
    expect(onReconcile).toHaveBeenCalledWith(BCA);
    expect(onToggle.mock.calls).toEqual([[BCA, 'includeInAvailable', false]]);
    expect(onArchive).toHaveBeenCalledWith(BCA);
  });

  it('opens the account’s transactions from the ⋮ menu', async () => {
    const { screen, router } = await renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Menu BCA Tahapan' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Lihat transaksi' }));
    await expect.poll(() => router.state.location.pathname).toBe('/transactions');
    expect(router.state.location.search).toEqual({ account: BCA.id });
  });

  it('disables "Tampil sebagai kartu" when the cards are full', async () => {
    const { screen } = await renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Menu Mandiri' }));
    await expect
      .element(page.getByRole('menuitemcheckbox', { name: 'Tampil sebagai kartu' }))
      .toHaveAttribute('aria-disabled', 'true');
  });

  it('reorders with the keyboard', async () => {
    const { screen, onReorder } = await renderList();
    const handle = screen.getByRole('button', { name: 'Seret untuk mengurutkan Mandiri' });
    await userEvent.click(handle);
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard(' ');
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    expect(onReorder).toHaveBeenCalledWith([BCA.id, MANDIRI.id, JAGO.id, GOPAY.id, CASH.id, GOTRADE.id]);
    // Dropping in place changes nothing; Escape cancels a move.
    await userEvent.click(handle);
    await userEvent.keyboard(' ');
    await userEvent.keyboard(' ');
    await userEvent.click(handle);
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Escape}');
    expect(onReorder).toHaveBeenCalledTimes(1);
  });
});

describe('ArchivedList', () => {
  it('lists archived accounts with Restore and Delete permanently', async () => {
    const jenius = accountView({
      displayName: 'Jenius',
      status: 'archived',
      archivedAt: new Date('2026-03-10T05:00:00Z'),
      transactionCount: 87,
      balanceMinor: 0n,
    });
    const old = accountView({ displayName: 'Lama', status: 'archived' });
    const handlers = { onSelect: vi.fn(), onRestore: vi.fn(), onDelete: vi.fn() };
    await page.viewport(1100, 800);
    const { screen } = await renderApp(
      <ArchivedList accounts={[jenius, old]} timeZone="Asia/Jakarta" selectedId={jenius.id} {...handlers} />,
    );
    const rows = screen.getByRole('listitem');
    await expect.element(rows.first()).toHaveAttribute('aria-current', 'true');
    await expect.element(rows.first().getByText('Bank · IDR · •• 4821 · 87 transaksi')).toBeInTheDocument();
    await expect.element(rows.first().getByText(/10 Mar 2026/)).toBeInTheDocument();
    await expect.element(rows.first().getByText('Rp0')).toBeInTheDocument();
    await userEvent.click(rows.first().getByRole('button', { name: /Jenius/ }));
    await userEvent.click(rows.first().getByRole('button', { name: 'Pulihkan' }));
    await userEvent.click(rows.first().getByRole('button', { name: 'Hapus permanen' }));
    for (const fn of [handlers.onSelect, handlers.onRestore, handlers.onDelete])
      expect(fn).toHaveBeenCalledWith(jenius);
    await expect.element(screen.getByText(/Hapus permanen juga menghapus transaksinya/)).toBeVisible();
  });

  it('says when nothing is archived', async () => {
    const { screen } = await renderApp(
      <ArchivedList
        accounts={[]}
        timeZone="Asia/Jakarta"
        selectedId={null}
        onSelect={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Belum ada rekening yang diarsipkan.')).toBeVisible();
  });
});
