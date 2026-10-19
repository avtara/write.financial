// SPDX-License-Identifier: AGPL-3.0-only
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { renderApp } from '../../../test/render.tsx';
import {
  CommandPaletteProvider,
  MissingCommandPaletteProviderError,
  useCommandActions,
  useCommandPalette,
  type CommandActions,
} from './command-palette.tsx';

vi.mock('../../server/fn/search.ts', () => ({
  listRecent: () => Promise.resolve({ ok: true, value: [] }),
  searchEverything: vi.fn(),
  touchRecent: vi.fn(),
}));

function Registers() {
  const actions = useMemo<CommandActions>(
    () => ({ quick: [{ id: 'export', label: 'Ekspor data', icon: Plus, run: () => undefined }] }),
    [],
  );
  useCommandActions(actions);
  return null;
}

/** A page that mounts and unmounts a component registering an action, and opens the palette from a button. */
function Page() {
  const [mounted, setMounted] = useState(true);
  const palette = useCommandPalette();
  return (
    <>
      {mounted ? <Registers /> : null}
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        lepas
      </button>
      <button type="button" onClick={palette.open}>
        buka
      </button>
    </>
  );
}

const dialog = () => page.getByRole('dialog', { name: 'Cari atau jalankan perintah' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CommandPaletteProvider', () => {
  it('toggles with ⌘K, closes with Escape, and lists the actions of mounted components only', async () => {
    await renderApp(
      <CommandPaletteProvider>
        <Page />
      </CommandPaletteProvider>,
    );
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await expect.element(dialog().getByRole('combobox')).toHaveFocus();
    await expect.element(dialog().getByRole('option', { name: 'Ekspor data' })).toBeVisible();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await expect.element(dialog()).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: 'lepas' }));
    await userEvent.click(page.getByRole('button', { name: 'buka' }));
    await expect.element(dialog().getByRole('group', { name: 'Halaman' })).toBeVisible();
    await expect.element(dialog().getByRole('option', { name: 'Ekspor data' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'buka' })).toHaveFocus();
  });

  it('is needed by the hooks', async () => {
    function Orphan() {
      useCommandPalette();
      return null;
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Orphan />)).rejects.toThrow(MissingCommandPaletteProviderError);
    error.mockRestore();
  });
});
