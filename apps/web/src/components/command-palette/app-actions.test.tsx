// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { AppCommandActions } from './app-actions.tsx';
import { CommandPaletteProvider } from './command-palette.tsx';

const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));
const assistant = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../assistant/assistant.tsx', () => ({ useAssistant: () => assistant }));
vi.mock('../../server/fn/search.ts', () => ({
  listRecent: () => Promise.resolve({ ok: true, value: [] }),
  searchEverything: () =>
    Promise.resolve({
      ok: true,
      value: {
        transactions: { hits: [], total: 0 },
        review: { hits: [], total: 0 },
        accounts: { hits: [], total: 0 },
        categories: { hits: [], total: 0 },
        tags: { hits: [], total: 0 },
        subscriptions: { hits: [], total: 0 },
      },
    }),
  touchRecent: vi.fn(),
}));

const dialog = () => page.getByRole('dialog', { name: 'Cari atau jalankan perintah' });

async function openPalette() {
  await userEvent.keyboard('{Meta>}k{/Meta}');
  await expect.element(dialog().getByRole('combobox')).toHaveFocus();
}

let router: Awaited<ReturnType<typeof renderApp>>['router'];

beforeEach(async () => {
  vi.clearAllMocks();
  ({ router } = await renderApp(
    <CommandPaletteProvider>
      <AppCommandActions />
    </CommandPaletteProvider>,
  ));
});

describe('AppCommandActions', () => {
  it('records a transaction or a transfer from "Aksi cepat"', async () => {
    await openPalette();
    const quick = dialog().getByRole('group', { name: 'Aksi cepat' });
    await expect.element(quick.getByRole('option', { name: /^Catat transaksi/ })).toHaveTextContent('Catat transaksiN');
    await userEvent.keyboard('{Enter}');
    expect(record.open).toHaveBeenCalledWith();

    await openPalette();
    await userEvent.click(dialog().getByRole('option', { name: 'Catat transfer' }));
    expect(record.open).toHaveBeenLastCalledWith({ type: 'transfer' });
  });

  it('adds an account from "Aksi cepat"', async () => {
    await openPalette();
    await userEvent.type(dialog().getByRole('combobox'), 'rekening');
    await userEvent.click(dialog().getByRole('option', { name: 'Tambah rekening' }));
    await vi.waitFor(() => {
      expect(router.state.location.href).toBe('/accounts?new=bank');
    });
  });

  it('adds a subscription from "Aksi cepat"', async () => {
    await openPalette();
    await userEvent.type(dialog().getByRole('combobox'), 'langganan');
    await userEvent.click(dialog().getByRole('option', { name: 'Tambah langganan' }));
    await vi.waitFor(() => {
      expect(router.state.location.href).toBe('/subscriptions?new=true');
    });
  });

  it('records an unmatched query as a transaction description', async () => {
    await openPalette();
    await userEvent.type(dialog().getByRole('combobox'), 'cicilan motor');
    // The Assistant is offered first (design "COBA · Tanya Asisten"), so the record action is one step down.
    const option = dialog().getByRole('option', { name: 'Catat “cicilan motor” sebagai transaksi' });
    await expect.element(option).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(record.open).toHaveBeenCalledWith({ description: 'cicilan motor' });
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  it('offers the Assistant for an unmatched query (FR-S4)', async () => {
    await openPalette();
    await userEvent.type(dialog().getByRole('combobox'), 'cicilan motor');
    await userEvent.click(dialog().getByRole('option', { name: 'Tanya Asisten' }));
    expect(assistant.open).toHaveBeenCalledWith();
    await expect.element(dialog()).not.toBeInTheDocument();
  });
});
