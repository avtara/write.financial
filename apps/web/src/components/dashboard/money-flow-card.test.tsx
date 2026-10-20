// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { dashboard, FOOD_ID } from '../../../test/dashboard-fixtures.ts';
import { ACCOUNTS, CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { MoneyFlowCard } from './money-flow-card.tsx';

const exporter = vi.hoisted(() => ({ flowPng: vi.fn(), download: vi.fn() }));
vi.mock('./money-flow-export.ts', () => exporter);
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);

const LOADED = new Date('2026-10-15T09:42:00Z');

function renderFlow(data = dashboard()) {
  return renderApp(
    <MoneyFlowCard
      dashboard={data}
      categories={CATEGORIES}
      accounts={ACCOUNTS}
      locale="id"
      timeZone="Asia/Jakarta"
      loadedAt={LOADED}
    />,
  );
}

/** A node of the diagram by its accessible name. */
const node = (name: RegExp) => page.getByRole('button', { name });

/**
 * SVG groups have no box of their own (the `<svg>` takes the pointer at their centre), so pointer events go straight
 * to the element: React derives enter / leave from `mouseover` / `mouseout`.
 */
function pointer(element: Element, type: 'mouseover' | 'mouseout' | 'click') {
  // React pairs `mouseout` with the element the pointer moves to; the card's heading is outside every node.
  const relatedTarget = type === 'mouseout' ? document.querySelector('#overview-flow') : null;
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget }));
}

beforeEach(async () => {
  await page.viewport(1440, 900);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('MoneyFlowCard on a desktop', () => {
  it('draws income → groups → categories with amounts and shares', async () => {
    const { screen } = await renderFlow();
    const region = screen.getByRole('region', { name: /^Arus Uang/ });
    await expect
      .element(region)
      .toMatchTextContent('Pemasukan Rp26.000.000 ke Kebutuhan, Keinginan, Lainnya, dan Tabungan');
    await expect.element(node(/^Gaji, Rp18\.500\.000 71%$/)).toBeInTheDocument();
    await expect.element(node(/^Makan & Dapur, Rp3\.200\.000 12%$/)).toBeInTheDocument();
    // Dividends (<1%) merge into "Sumber lain" until the menu shows them.
    await expect.element(node(/^Sumber lain, Rp210\.000 <1%$/)).toBeInTheDocument();
    await expect.element(region).toMatchTextContent('Rupiah · Transfer antar rekening tidak dihitung');
    await expect.element(region).toMatchTextContent('Diperbarui 15 Okt 2026, 16.42');
    expect(document.querySelector('svg [style]')).toBeNull();
  });

  it('explains a node or a band on hover and opens the category behind it', async () => {
    const { screen, router } = await renderFlow();
    const food = node(/^Makan & Dapur/);
    await expect.element(food).toBeInTheDocument();
    pointer(food.element(), 'mouseover');
    const tip = screen.getByRole('tooltip');
    await expect.element(tip).toMatchTextContent('Kebutuhan → Makan & Dapur');
    await expect.element(tip).toMatchTextContent('Porsi Kebutuhan42%');
    await expect.element(tip).toMatchTextContent('Transaksi18× · rata² Rp177.777');
    await expect.element(tip).toMatchTextContent('AnggaranRp3.200.000 / 3.500.000');
    await expect.element(tip).toMatchTextContent('Klik untuk lihat 18 transaksi');
    pointer(food.element(), 'mouseout');
    await expect.element(screen.getByRole('tooltip')).not.toBeInTheDocument();
    // The band into Gaji's node: the total's links carry the source's tone.
    const band = document.querySelector('path[d]') as SVGPathElement;
    pointer(band, 'mouseover');
    await expect.element(screen.getByRole('tooltip')).toBeVisible();
    pointer(band, 'mouseout');
    pointer(food.element(), 'click');
    expect(router.state.location.search).toEqual({ period: '2026-10', category: FOOD_ID });
    pointer(band, 'click');
  });

  it('focuses a group from its chip or its node, then opens its categories', async () => {
    const { screen, router } = await renderFlow();
    const chip = screen.getByRole('button', { name: 'Kebutuhan', exact: true });
    await userEvent.click(chip);
    await expect.element(screen.getByText('Kebutuhan · Rp7.700.000 · 30% dari pemasukan')).toBeVisible();
    await userEvent.click(chip);
    await expect.element(screen.getByText(/^Pemasukan Rp26\.000\.000/)).toBeVisible();
    const needs = node(/^Kebutuhan, Rp7\.700\.000/);
    (needs.element() as SVGGElement).focus();
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent('Kebutuhan');
    await userEvent.keyboard('{Enter}');
    await expect.element(screen.getByText('Kebutuhan · Rp7.700.000 · 30% dari pemasukan')).toBeVisible();
    await userEvent.keyboard('x');
    await userEvent.keyboard(' ');
    expect(router.state.location.search).toMatchObject({ category: expect.stringContaining(FOOD_ID) as string });
    (needs.element() as SVGGElement).blur();
    await userEvent.click(screen.getByRole('button', { name: 'Semua' }));
    pointer(node(/^Tanpa kategori/).element(), 'click');
    expect(router.state.location.search).toEqual({ period: '2026-10', uncategorized: true });
  });

  it('switches values, small sources, and transfers from the menu, and opens the transactions', async () => {
    const { screen, router } = await renderFlow();
    const menu = screen.getByRole('button', { name: 'Opsi arus uang' });
    await userEvent.click(menu);
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Persen' }));
    await expect.element(node(/^Gaji, 71%$/)).toBeInTheDocument();
    await userEvent.click(menu);
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Tampilkan sumber < 1%' }));
    await expect.element(node(/^Dividen & bunga, <1%$/i)).toBeInTheDocument();
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Hitung transfer antar rekening' }));
    await expect.element(node(/^Bank Jago, 13%$/)).toBeInTheDocument();
    await expect.element(node(/^Tetap di rekening, 23%$/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByText(/Persen dari pemasukan · Transfer antar rekening dihitung/)).toBeVisible();
    pointer(node(/^Bank Jago/).element(), 'click');
    expect(router.state.location.search).toEqual({ period: '2026-10', type: 'transfer' });
    await userEvent.click(menu);
    await userEvent.click(page.getByRole('menuitem', { name: 'Buka di Transaksi' }));
    expect(router.state.location.search).toEqual({ period: '2026-10' });
  });

  it('downloads and copies the drawing as PNG, and says when it fails', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    exporter.flowPng.mockResolvedValue(blob);
    const write = vi.spyOn(navigator.clipboard, 'write').mockResolvedValue();
    const { screen } = await renderFlow();
    const menu = screen.getByRole('button', { name: 'Opsi arus uang' });
    await userEvent.click(menu);
    await userEvent.click(page.getByRole('menuitem', { name: 'Unduh sebagai PNG' }));
    await vi.waitFor(() => {
      expect(exporter.download).toHaveBeenCalledWith(blob, 'arus-uang-2026-10-01-2026-10-15.png');
    });
    await userEvent.click(menu);
    await userEvent.click(page.getByRole('menuitem', { name: 'Salin gambar' }));
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ title: 'Gambar arus uang disalin', tone: 'success' });
    });
    expect(write).toHaveBeenCalledOnce();
    exporter.flowPng.mockRejectedValue(new Error('tainted'));
    await userEvent.click(menu);
    await userEvent.click(page.getByRole('menuitem', { name: 'Salin gambar' }));
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Gambar tidak bisa dibuat. Coba lagi.', tone: 'error' });
    });
    write.mockRestore();
  });
});

describe('MoneyFlowCard on a tablet (FR-TB2)', () => {
  it('shows sources → groups, and a group opens its categories', async () => {
    await page.viewport(1024, 768);
    const { screen } = await renderFlow();
    await expect.element(node(/^Kebutuhan, /)).toBeInTheDocument();
    expect(node(/^Makan & Dapur/).query()).toBeNull();
    pointer(node(/^Kebutuhan, /).element(), 'click');
    await expect.element(node(/^Makan & Dapur/)).toBeInTheDocument();
    expect(node(/^Gaji/).query()).toBeNull();
    pointer(node(/^Sewa Kos/).element(), 'mouseover');
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent('Kebutuhan → Sewa Kos');
  });
});

describe('MoneyFlowCard without flows', () => {
  it('says so without income or spending, and names spending without income', async () => {
    const { screen } = await renderFlow(dashboard({ flow: { incomes: [], expenses: [], transfers: [] } }));
    await expect.element(screen.getByText('Belum ada pemasukan atau pengeluaran di rentang ini.')).toBeVisible();
    const spending = dashboard({ flow: { ...dashboard().flow, incomes: [] } });
    const { screen: second } = await renderFlow(spending);
    await expect.element(second.getByText('Pengeluaran Rp16.500.000, belum ada pemasukan')).toBeVisible();
    pointer(node(/^Dari saldo/).element(), 'mouseover');
    await expect.element(second.getByRole('tooltip')).toMatchTextContent('Dari saldo');
  });
});

describe('MoneyFlowCard names', () => {
  it('names an account it does not know and explains uncategorized spending', async () => {
    const { screen } = await renderApp(
      <MoneyFlowCard
        dashboard={dashboard()}
        categories={CATEGORIES}
        accounts={[]}
        locale="id"
        timeZone="Asia/Jakarta"
        loadedAt={LOADED}
      />,
    );
    pointer(node(/^Tanpa kategori/).element(), 'mouseover');
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent('Lainnya → Tanpa kategori');
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent('Transaksi4×');
    await userEvent.click(screen.getByRole('button', { name: 'Opsi arus uang' }));
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Hitung transfer antar rekening' }));
    await expect.element(node(/^Rekening, Rp3\.500\.000/)).toBeInTheDocument();
  });
});
