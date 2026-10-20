// SPDX-License-Identifier: AGPL-3.0-only
import type { Active, Over } from '@dnd-kit/core';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { DEFAULT_TABLE_PREFS, type TablePrefs } from '../../lib/transaction-columns.ts';
import { columnAnnouncements, ColumnSettings, reorderedColumns } from './column-settings.tsx';

const ids = (prefs: TablePrefs | null | undefined) => prefs?.columns.map((column) => column.id);

function Harness({ onChange }: { onChange: (prefs: TablePrefs) => void }) {
  const [prefs, setPrefs] = useState<TablePrefs>(DEFAULT_TABLE_PREFS);
  return (
    <ColumnSettings
      prefs={prefs}
      onChange={(next) => {
        onChange(next);
        setPrefs(next);
      }}
    />
  );
}

describe('reorderedColumns', () => {
  it('moves a column onto another, and ignores drops in place, nowhere, or of unknown ids', () => {
    expect(ids(reorderedColumns(DEFAULT_TABLE_PREFS, 'account', { id: 'time' }))?.slice(0, 3)).toEqual([
      'account',
      'time',
      'description',
    ]);
    expect(reorderedColumns(DEFAULT_TABLE_PREFS, 'time', { id: 'time' })).toBeNull();
    expect(reorderedColumns(DEFAULT_TABLE_PREFS, 'time', null)).toBeNull();
    expect(reorderedColumns(DEFAULT_TABLE_PREFS, 'nope', { id: 'time' })).toBeNull();
  });
});

describe('columnAnnouncements', () => {
  it('names the columns, and says nothing over empty space', () => {
    const announce = columnAnnouncements();
    const active = { id: 'account' } as Active;
    const over = { id: 'time' } as Over;
    expect(announce.onDragStart({ active })).toBe('Rekening diangkat.');
    expect(announce.onDragOver({ active, over })).toBe('Rekening di atas Waktu');
    expect(announce.onDragOver({ active, over: null })).toBeUndefined();
    expect(announce.onDragEnd({ active, over })).toBe('Rekening dipindah ke posisi Waktu');
    expect(announce.onDragEnd({ active, over: null })).toBeUndefined();
    expect(announce.onDragCancel({ active, over: null })).toBe('Batal memindahkan Rekening.');
  });
});

describe('ColumnSettings', () => {
  it('lists the columns in order with switches and locks', async () => {
    const onChange = vi.fn<(prefs: TablePrefs) => void>();
    const { screen } = await renderApp(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Atur kolom' }));
    const dialog = page.getByRole('dialog', { name: 'Atur kolom' });
    await expect.element(dialog.getByText('seret untuk urutkan', { exact: false })).toBeVisible();
    expect(dialog.element().textContent).toMatch(/^Kolom · seret untuk urutkan/);
    await expect.element(dialog.getByRole('img', { name: 'Deskripsi selalu tampil' })).toBeVisible();
    await expect.element(dialog.getByRole('img', { name: 'Jumlah selalu tampil' })).toBeVisible();
    expect(
      dialog
        .getByRole('switch')
        .elements()
        .map((element) => element.closest('label')?.textContent),
    ).toEqual(['Waktu', 'Tag di bawah deskripsi', 'Kategori', 'Rekening', 'Lampiran', 'Saldo berjalan', 'Sumber']);
    await expect.element(dialog.getByRole('switch', { name: 'Waktu' })).toBeChecked();
    await expect.element(dialog.getByRole('switch', { name: 'Lampiran' })).not.toBeChecked();
    await userEvent.click(dialog.getByRole('switch', { name: 'Lampiran' }));
    expect(onChange.mock.lastCall?.[0].columns.find((column: { id: string }) => column.id === 'attachment')).toEqual({
      id: 'attachment',
      visible: true,
    });
    await expect.element(dialog.getByRole('switch', { name: 'Lampiran' })).toBeChecked();
  });

  it('switches density and resets to the defaults', async () => {
    const onChange = vi.fn<(prefs: TablePrefs) => void>();
    const { screen } = await renderApp(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Atur kolom' }));
    await expect.element(page.getByRole('tab', { name: 'Nyaman' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(page.getByRole('tab', { name: 'Padat' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_TABLE_PREFS, density: 'compact' });
    await userEvent.click(page.getByRole('button', { name: 'Kembalikan ke default' }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_TABLE_PREFS);
  });

  it('reorders with the keyboard', async () => {
    const onChange = vi.fn<(prefs: TablePrefs) => void>();
    const { screen } = await renderApp(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Atur kolom' }));
    const handle = page.getByRole('button', { name: 'Seret untuk mengurutkan Kategori' });
    (handle.element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard(' ');
    await expect.poll(() => onChange.mock.calls.length).toBe(1);
    expect(ids(onChange.mock.calls[0]?.[0])?.slice(0, 4)).toEqual(['time', 'description', 'category', 'tags']);
    // Dropping in place changes nothing.
    (handle.element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledOnce();
  });
});
