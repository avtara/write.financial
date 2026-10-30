// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import {
  DEFAULT_DASHBOARD_LAYOUT,
  updateCard,
  type DashboardCard,
  type DashboardLayout,
} from '../../lib/dashboard-layout.ts';
import { DashboardEditor, DashboardGrid, DRAG_ANNOUNCEMENTS, ManageCards } from './dashboard-grid.tsx';

/** A card's stand-in content: its id as a heading and a link a preview must not follow. */
const content = (id: DashboardCard) => (
  <section aria-label={`card ${id}`}>
    <a href={`#${id}`}>open {id}</a>
  </section>
);

const order = () =>
  Array.from(document.querySelectorAll('[data-card]'), (element) => element.getAttribute('data-card'));

/** The editor or the "Kelola kartu" sheet with the page's state, reporting every change. */
function Harness({
  initial = DEFAULT_DASHBOARD_LAYOUT,
  manage = false,
  onChange,
}: {
  readonly initial?: DashboardLayout;
  readonly manage?: boolean;
  readonly onChange: (layout: DashboardLayout) => void;
}) {
  const [layout, setLayout] = useState(initial);
  const change = (next: DashboardLayout) => {
    onChange(next);
    setLayout(next);
  };
  return manage ? (
    <>
      <ManageCards open onOpenChange={() => undefined} layout={layout} onChange={change} />
      <p data-testid="order">{layout.cards.map((card) => card.id).join(',')}</p>
    </>
  ) : (
    <DashboardEditor layout={layout} onChange={change} render={content} />
  );
}

afterEach(async () => {
  await page.viewport(414, 896);
});

describe('DashboardGrid', () => {
  it('shows the shown cards in order at their widths, without the hidden ones or empty content', async () => {
    await page.viewport(1440, 900);
    const layout = updateCard(updateCard(DEFAULT_DASHBOARD_LAYOUT, 'flow', { visible: false }), 'goals', {
      visible: true,
      width: 'twoThirds',
    });
    const { screen } = await renderApp(
      <DashboardGrid layout={layout} render={(id) => (id === 'calendar' ? null : content(id))} />,
    );
    await expect.element(screen.getByRole('region', { name: 'card accounts' })).toBeVisible();
    expect(order()).toEqual(['accounts', 'categories', 'cashflow', 'budget', 'subscriptions', 'goals']);
    const width = (id: string) => document.querySelector(`[data-card="${id}"]`)?.getBoundingClientRect().width ?? 0;
    // ⅔ beside ⅓ in the 3-column grid from 1280 px; a full card spans the row.
    expect(width('cashflow')).toBeGreaterThan(width('budget') * 1.8);
    expect(width('accounts')).toBeGreaterThan(width('cashflow') * 1.4);
  });
});

describe('DashboardEditor', () => {
  it('removes a card into "Kartu lain yang bisa ditambahkan", adds it back, and changes a width', async () => {
    const onChange = vi.fn();
    const { screen } = await renderApp(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hapus kartu Langganan' }));
    expect(onChange).toHaveBeenLastCalledWith(
      updateCard(DEFAULT_DASHBOARD_LAYOUT, 'subscriptions', { visible: false }),
    );
    // Gone from the grid (no placeholder left behind), waiting with the cards that can be added.
    expect(screen.getByRole('region', { name: 'card subscriptions' }).query()).toBeNull();
    expect(screen.getByRole('button', { name: 'Pindahkan Langganan' }).query()).toBeNull();
    const addable = screen.getByRole('region', { name: 'Kartu lain yang bisa ditambahkan' });
    await userEvent.click(addable.getByRole('button', { name: 'Tambah Langganan' }));
    await expect.element(screen.getByRole('region', { name: 'card subscriptions' })).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('radiogroup', { name: 'Lebar Anggaran Kategori' }).getByRole('radio', { name: 'Penuh' }),
    );
    expect(onChange).toHaveBeenLastCalledWith(updateCard(DEFAULT_DASHBOARD_LAYOUT, 'budget', { width: 'full' }));
  });

  it('previews the cards without letting their links or buttons act', async () => {
    const { screen } = await renderApp(<Harness onChange={vi.fn()} />);
    const preview = screen.getByRole('link', { name: 'open accounts', includeHidden: true });
    expect(preview.element().closest('[inert]')).not.toBeNull();
  });

  it('adds an addable card from "Kartu lain yang bisa ditambahkan", and removing it puts it back there', async () => {
    const onChange = vi.fn();
    const { screen } = await renderApp(<Harness onChange={onChange} />);
    const addable = screen.getByRole('region', { name: 'Kartu lain yang bisa ditambahkan' });
    await expect.element(addable).toMatchTextContent(/Tujuan tabungan.*Pengingat tagihan/);
    await userEvent.click(addable.getByRole('button', { name: 'Tambah Tujuan tabungan' }));
    expect(onChange).toHaveBeenLastCalledWith(updateCard(DEFAULT_DASHBOARD_LAYOUT, 'goals', { visible: true }));
    await expect.element(screen.getByRole('button', { name: 'Pindahkan Tujuan tabungan' })).toBeVisible();
    expect(addable.getByRole('button', { name: 'Tambah Tujuan tabungan' }).query()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Hapus kartu Tujuan tabungan' }));
    await expect.element(addable.getByRole('button', { name: 'Tambah Tujuan tabungan' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pindahkan Tujuan tabungan' }).query()).toBeNull();
  });

  it('leaves out the addable section, here and in "Kelola kartu", once every card is added', async () => {
    const all: DashboardLayout = {
      cards: DEFAULT_DASHBOARD_LAYOUT.cards.map((card) => ({ ...card, visible: true })),
    };
    const { screen } = await renderApp(<Harness initial={all} onChange={vi.fn()} />);
    await expect.element(screen.getByRole('button', { name: 'Pindahkan Pengingat tagihan' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Kartu lain yang bisa ditambahkan' }).query()).toBeNull();
    await screen.unmount();
    const manage = await renderApp(<Harness manage initial={all} onChange={vi.fn()} />);
    const sheet = manage.screen.getByRole('dialog', { name: 'Kelola kartu dashboard' });
    await expect.element(sheet.getByRole('switch', { name: /Pengingat tagihan/ })).toBeChecked();
    expect(sheet.getByRole('region', { name: 'Bisa ditambahkan' }).query()).toBeNull();
  });

  it('moves a card with the keyboard through its handle', async () => {
    const onChange = vi.fn();
    const { screen } = await renderApp(<Harness onChange={onChange} />);
    const handle = screen.getByRole('button', { name: 'Pindahkan Arus Uang' });
    (handle.element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard(' ');
    await vi.waitFor(() => {
      expect(order().slice(0, 2)).toEqual(['flow', 'accounts']);
    });
    expect(onChange).toHaveBeenCalledOnce();

    // Picked up and dropped where it was: nothing to report.
    (screen.getByRole('button', { name: 'Pindahkan Anggaran Kategori' }).element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard(' ');
    await expect.element(screen.getByRole('button', { name: 'Pindahkan Anggaran Kategori' })).toHaveFocus();
    expect(onChange).toHaveBeenCalledOnce();
  });
});

describe('ManageCards', () => {
  it('switches cards on and off, sets widths, and reorders with the keyboard', async () => {
    const onChange = vi.fn();
    const { screen } = await renderApp(<Harness manage onChange={onChange} />);
    const sheet = screen.getByRole('dialog', { name: 'Kelola kartu dashboard' });
    await expect.element(sheet).toMatchTextContent('Bar Catat Cepat dan Ringkasan KPI tetap paling atas.');
    const addable = sheet.getByRole('region', { name: 'Bisa ditambahkan' });
    await expect.element(addable.getByRole('switch', { name: /Tujuan tabungan/ })).not.toBeChecked();

    await userEvent.click(sheet.getByRole('switch', { name: /Langganan/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      updateCard(DEFAULT_DASHBOARD_LAYOUT, 'subscriptions', { visible: false }),
    );
    await userEvent.click(addable.getByRole('switch', { name: /Pengingat tagihan/ }));
    // Switched on, it joins the order.
    await expect
      .element(sheet.getByRole('region', { name: 'Urutan di dashboard' }).getByRole('switch', { name: /Pengingat/ }))
      .toBeChecked();
    await userEvent.click(
      sheet.getByRole('radiogroup', { name: 'Lebar Pengingat tagihan' }).getByRole('radio', { name: '⅔' }),
    );
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      cards: expect.arrayContaining([{ id: 'bills', visible: true, width: 'twoThirds' }]) as unknown,
    });

    const handle = sheet.getByRole('button', { name: 'Pindahkan Rekening & dompet' });
    (handle.element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard(' ');
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="order"]')?.textContent).toMatch(/^flow,accounts,/);
    });
  });
});

describe('DRAG_ANNOUNCEMENTS', () => {
  it('names the cards, and says nothing over empty space', () => {
    const active = { id: 'subscriptions' } as never;
    const over = { id: 'calendar' } as never;
    expect(DRAG_ANNOUNCEMENTS.onDragStart({ active })).toBe('Langganan diangkat.');
    expect(DRAG_ANNOUNCEMENTS.onDragOver({ active, over })).toBe('Langganan di posisi Kalender Pengeluaran.');
    expect(DRAG_ANNOUNCEMENTS.onDragEnd({ active, over })).toBe('Langganan dipindah ke posisi Kalender Pengeluaran.');
    expect(DRAG_ANNOUNCEMENTS.onDragCancel({ active, over: null })).toBe('Batal memindahkan Langganan.');
    expect(DRAG_ANNOUNCEMENTS.onDragOver({ active, over: null })).toBeUndefined();
    expect(DRAG_ANNOUNCEMENTS.onDragEnd({ active, over: null })).toBeUndefined();
  });
});
