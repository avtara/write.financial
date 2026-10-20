// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { Coffee, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { RecentEntry, SearchResults, TransactionHit } from '../../lib/search.ts';
import {
  CommandPaletteProvider,
  useCommandActions,
  useCommandPalette,
  type CommandActions,
} from './command-palette.tsx';

const server = vi.hoisted(() => ({
  searchEverything: vi.fn(),
  listRecent: vi.fn(),
  touchRecent: vi.fn(() => Promise.resolve({ ok: true, value: null })),
}));
vi.mock('../../server/fn/search.ts', () => server);

const SHOPEE: TransactionHit = {
  id: 'tx-shopee',
  type: 'expense',
  localDate: '2026-10-14' as LocalDate,
  title: 'Shopee — Rak buku 5 susun',
  amountMinor: -250_000n,
  currency: 'IDR',
  category: { name: 'system:shopping', builtInKey: 'system:shopping' },
  accountId: 'acc-bca',
  accountName: 'BCA Tahapan',
  toAccountName: null,
};

const RECENT: RecentEntry[] = [
  { kind: 'transactions', hit: SHOPEE },
  { kind: 'page', path: '/' },
  { kind: 'page', path: '/removed-page' },
  {
    kind: 'accounts',
    hit: {
      id: 'acc-gopay',
      displayName: 'GoPay',
      providerName: 'Gojek',
      type: 'ewallet',
      currency: 'IDR',
      balanceMinor: 367_000n,
      archived: false,
    },
  },
];

const EMPTY: SearchResults = {
  transactions: { hits: [], total: 0 },
  accounts: { hits: [], total: 0 },
  categories: { hits: [], total: 0 },
  tags: { hits: [], total: 0 },
};

const NETFLIX: SearchResults = {
  ...EMPTY,
  transactions: {
    total: 2,
    hits: [
      { ...SHOPEE, id: 'tx-sep', title: 'Netflix', localDate: '2026-09-18' as LocalDate, amountMinor: -186_000n },
      { ...SHOPEE, id: 'tx-aug', title: 'Netflix', localDate: '2026-08-18' as LocalDate, amountMinor: -186_000n },
    ],
  },
  tags: { total: 1, hits: [{ id: 'tag-netflix', slug: 'netflix', usageCount: 2 }] },
};

const record = vi.fn();
const recordAs = vi.fn();

/** A page registering its own actions, as other modules do. */
function PageWithActions() {
  const actions = useMemo<CommandActions>(
    () => ({
      quick: [
        { id: 'record', label: 'Catat transaksi', icon: Plus, shortcut: ['N'], run: record },
        { id: 'coffee', label: 'Beli kopi', icon: Coffee, keywords: ['ngopi'], run: record },
      ],
    }),
    [],
  );
  useCommandActions(actions);
  // A second module that only offers a creation action.
  const create = useMemo<CommandActions>(
    () => ({ create: [{ id: 'record-as', icon: Plus, label: (query) => `Catat “${query}”`, run: recordAs }] }),
    [],
  );
  useCommandActions(create);
  const palette = useCommandPalette();
  return (
    <button type="button" onClick={palette.open}>
      buka palet
    </button>
  );
}

async function renderPalette(ui = <PageWithActions />) {
  return renderApp(<CommandPaletteProvider>{ui}</CommandPaletteProvider>, { path: '/other' });
}

const dialog = () => page.getByRole('dialog', { name: 'Cari atau jalankan perintah' });
const input = () => dialog().getByRole('combobox');
const option = (name: string | RegExp) => dialog().getByRole('option', { name });

beforeEach(() => {
  vi.clearAllMocks();
  server.listRecent.mockResolvedValue({ ok: true, value: RECENT });
  server.searchEverything.mockResolvedValue({ ok: true, value: EMPTY });
});

describe('Palette', () => {
  it('opens with ⌘K on quick actions, recent items, and pages, and closes with Escape or ⌘K', async () => {
    await renderPalette();
    await expect.element(dialog()).not.toBeInTheDocument();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await expect.element(input()).toHaveFocus();
    await expect.element(input()).toHaveAttribute('placeholder', 'Cari transaksi, halaman, atau perintah…');
    await expect.element(dialog().getByRole('group', { name: 'Aksi cepat' })).toBeVisible();
    await expect.element(option(/^Catat transaksi/)).toHaveTextContent('Catat transaksiN');
    const recent = dialog().getByRole('group', { name: 'Baru dibuka' });
    await expect
      .element(recent.getByRole('option', { name: /Shopee/ }))
      .toHaveTextContent('Shopee — Rak buku 5 susunTransaksi · 14 Okt · Belanja Online · BCA Tahapan−Rp250.000');
    await expect
      .element(recent.getByRole('option', { name: /GoPay/ }))
      .toHaveTextContent('GoPayRekening · Gojek · E-WalletRp367.000');
    await expect.element(recent.getByRole('option', { name: /Ringkasan/ })).toHaveTextContent('RingkasanHalaman');
    expect(recent.getByRole('option').elements()).toHaveLength(3);
    const pages = dialog().getByRole('group', { name: 'Halaman' });
    await expect.element(pages.getByRole('option', { name: /Ringkasan/ })).toHaveTextContent('RingkasanGR');
    // Pages without a `G` letter show no shortcut.
    const accounts = pages.getByRole('option', { name: /Rekening/ });
    expect(accounts.element().textContent).toBe('Rekening & dompet');
    expect(dialog().element().textContent).toContain('↑↓pilih↵buka');

    await userEvent.keyboard('{Escape}');
    await expect.element(dialog()).not.toBeInTheDocument();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await expect.element(dialog()).toBeVisible();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(server.listRecent).toHaveBeenCalledWith({ data: {} });
  });

  it('searches once typing pauses and lists the groups with their totals', async () => {
    server.searchEverything.mockResolvedValue({ ok: true, value: NETFLIX });
    const { router } = await renderPalette();
    await userEvent.click(page.getByRole('button', { name: 'buka palet' }));
    // One input event: per-key typing on a loaded CI runner can pause longer than the debounce between keys.
    await userEvent.fill(input(), 'netflix');
    await expect.element(dialog().getByRole('group', { name: 'Transaksi · 2' })).toBeVisible();
    expect(server.searchEverything).toHaveBeenCalledTimes(1);
    expect(server.searchEverything).toHaveBeenCalledWith({ data: { query: 'netflix' } });
    await expect.element(option(/18 Sep/)).toHaveTextContent('Netflix18 Sep · Belanja Online · BCA Tahapan−Rp186.000');
    await expect.element(dialog().getByRole('group', { name: 'Tag' })).toHaveTextContent('#netflixDipakai 2×');
    // Quick actions, recent items, and pages that do not match are gone.
    await expect.element(dialog().getByRole('group', { name: 'Baru dibuka' })).not.toBeInTheDocument();
    await expect.element(dialog().getByRole('group', { name: 'Halaman' })).not.toBeInTheDocument();

    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(server.touchRecent).toHaveBeenCalledWith({ data: { kind: 'transaction', ref: 'tx-aug' } });
    await vi.waitFor(() => {
      expect(router.state.location.href).toBe('/accounts?account=acc-bca');
    });
  });

  it('filters quick actions and pages by label and keywords while typing', async () => {
    await renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(input(), 'ngopi');
    await expect.element(option('Beli kopi')).toBeVisible();
    await expect.element(option(/^Catat transaksi/)).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(record).toHaveBeenCalledTimes(1);
    await expect.element(dialog()).not.toBeInTheDocument();

    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(input(), 'ringk');
    await expect.element(option(/Ringkasan/)).toBeVisible();
    // Results arrive for the query; a search with no hits adds nothing while a page matches.
    await vi.waitFor(() => {
      expect(server.searchEverything).toHaveBeenCalledWith({ data: { query: 'ringk' } });
    });
    await expect.element(dialog().getByText('Tidak ada hasil', { exact: false })).not.toBeInTheDocument();
  });

  it('opens a page from the page group or the recent items, remembering it', async () => {
    const { router } = await renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.click(
      dialog()
        .getByRole('group', { name: 'Halaman' })
        .getByRole('option', { name: /Ringkasan/ }),
    );
    expect(server.touchRecent).toHaveBeenCalledWith({ data: { kind: 'page', ref: '/' } });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });

    router.history.push('/other');
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.click(
      dialog()
        .getByRole('group', { name: 'Baru dibuka' })
        .getByRole('option', { name: /Ringkasan/ }),
    );
    expect(server.touchRecent).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });

    router.history.push('/other');
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.click(dialog().getByRole('group', { name: 'Baru dibuka' }).getByRole('option', { name: /GoPay/ }));
    expect(server.touchRecent).toHaveBeenLastCalledWith({ data: { kind: 'account', ref: 'acc-gopay' } });
  });

  it('offers to create what was typed when nothing matches', async () => {
    await renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(input(), 'cicilan motor');
    await expect
      .element(dialog().getByRole('listbox').getByText('Tidak ada hasil untuk “cicilan motor”'))
      .toBeVisible();
    await expect.element(dialog().getByText('Bukan transaksi, kategori, tujuan, atau halaman yang ada.')).toBeVisible();
    await expect.element(page.getByRole('status')).toHaveTextContent('Tidak ada hasil untuk “cicilan motor”');
    const tryGroup = dialog().getByRole('group', { name: 'Coba' });
    await expect.element(tryGroup.getByRole('option', { name: 'Catat “cicilan motor”' })).toBeVisible();
    await userEvent.keyboard('{Enter}');
    expect(recordAs).toHaveBeenCalledWith('cicilan motor');
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  it('shows the empty state without creation actions when no page registered any', async () => {
    await renderPalette(<p>tanpa aksi</p>);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    // Without quick actions the group is hidden.
    await expect.element(dialog().getByRole('group', { name: 'Halaman' })).toBeVisible();
    await expect.element(dialog().getByRole('group', { name: 'Aksi cepat' })).not.toBeInTheDocument();
    await userEvent.type(input(), 'zzz');
    await expect.element(dialog().getByRole('listbox').getByText('Tidak ada hasil untuk “zzz”')).toBeVisible();
    await expect.element(dialog().getByRole('group', { name: 'Coba' })).not.toBeInTheDocument();
  });

  it('says so when the search fails, and keeps working without recent items', async () => {
    server.listRecent.mockResolvedValue({ ok: false, code: 'UNKNOWN' });
    server.searchEverything.mockRejectedValue(new TypeError('offline'));
    await renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await expect.element(dialog().getByRole('group', { name: 'Halaman' })).toBeVisible();
    await expect.element(dialog().getByRole('group', { name: 'Baru dibuka' })).not.toBeInTheDocument();
    await userEvent.type(input(), 'kopi');
    await expect.element(dialog().getByText('Pencarian gagal. Coba lagi.', { exact: true }).last()).toBeVisible();
    await expect.element(page.getByRole('status')).toHaveTextContent('Pencarian gagal. Coba lagi.');
  });

  it('announces a pending search and drops answers that arrive after the query changed or the palette closed', async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    server.searchEverything.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const recent = Promise.withResolvers<unknown>();
    server.listRecent.mockReturnValue(recent.promise);
    await renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(input(), 'net');
    await expect.element(page.getByRole('status')).toHaveTextContent('Mencari…');
    await expect.element(dialog().getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
    await vi.waitFor(() => {
      expect(server.searchEverything).toHaveBeenCalledTimes(1);
    });
    // Typing on: the answer to "net" no longer counts.
    await userEvent.type(input(), 'flix');
    first.resolve({ ok: true, value: NETFLIX });
    await vi.waitFor(() => {
      expect(server.searchEverything).toHaveBeenCalledTimes(2);
    });
    await expect.element(dialog().getByRole('group', { name: 'Transaksi · 2' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    second.resolve({ ok: true, value: NETFLIX });
    recent.resolve({ ok: true, value: RECENT });
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await expect.element(input()).toHaveValue('');
  });
});
