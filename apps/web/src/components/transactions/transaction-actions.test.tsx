// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { categoryId, LEDGER } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionDetail, transactionRow } from '../../../test/transaction-fixtures.ts';
import type { ActionRow } from './action-row.ts';
import {
  MissingTransactionActionsProviderError,
  TransactionActionsProvider,
  useTransactionActions,
  type TransactionActionsProviderProps,
} from './transaction-actions.tsx';

const server = vi.hoisted(() => ({
  bulkAddTag: vi.fn(),
  bulkMoveAccount: vi.fn(),
  bulkSetCategory: vi.fn(),
  getTransactionDetail: vi.fn(),
  unsplitTransaction: vi.fn(),
  removeTransactions: vi.fn(),
  restoreTransactions: vi.fn(),
}));
vi.mock('../../server/fn/transactions.ts', () => ({
  bulkAddTag: server.bulkAddTag,
  bulkMoveAccount: server.bulkMoveAccount,
  bulkSetCategory: server.bulkSetCategory,
  getTransactionDetail: server.getTransactionDetail,
  unsplitTransaction: server.unsplitTransaction,
}));
vi.mock('../../server/fn/transactions-write.ts', () => ({
  removeTransactions: server.removeTransactions,
  restoreTransactions: server.restoreTransactions,
}));
const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { undo: vi.fn() }) }));
vi.mock('@wf/ui/toast', () => toasts);

/** The dialogs are tested on their own; here they only report what they were given and hand back answers. */
const dialogs = vi.hoisted(() => ({ props: vi.fn() }));
function stub(name: string, answers: Record<string, unknown[]>) {
  return function Stub(props: Record<string, unknown>) {
    dialogs.props(name, props);
    return (
      <div role="dialog" aria-label={name}>
        {Object.entries(answers).map(([handler, args]) => (
          <button
            key={handler}
            type="button"
            onClick={() => {
              void (props[handler] as (...values: unknown[]) => unknown)(...args);
            }}
          >
            {handler}
          </button>
        ))}
      </div>
    );
  };
}
vi.mock('./delete-dialog.tsx', () => ({ DeleteDialog: stub('delete', { onCancel: [], onConfirm: [] }) }));
vi.mock('./duplicate-sheet.tsx', () => ({ DuplicateSheet: stub('duplicate', { onClose: [], onSaved: ['tx-copy'] }) }));
vi.mock('./split-dialog.tsx', () => ({ SplitDialog: stub('split', { onClose: [], onSplit: [3] }) }));
vi.mock('./bulk-dialogs.tsx', () => ({
  CategoryDialog: stub('category', { onCancel: [], onApply: [['a'], 'cat-food'] }),
  MoveAccountDialog: stub('move', { onCancel: [], onApply: [['a'], 'acc-jago'] }),
  AddTagDialog: stub('tag', { onCancel: [], onApply: ['kopi'] }),
}));

const SHOPEE = transactionRow('a', { merchant: 'Shopee', amountMinor: -389_000n });
const OTHER = transactionRow('b', { accountId: 'acc-gone' });
const TRANSFER = transactionRow('t', { type: 'transfer', categoryId: null });

/** Buttons that call each action. */
function Harness({ rows = [SHOPEE] }: { rows?: readonly ActionRow[] }) {
  const actions = useTransactionActions();
  const calls: Record<string, () => void> = {
    'remove none': () => {
      actions.remove([]);
    },
    remove: () => {
      actions.remove(rows);
    },
    duplicate: () => {
      actions.duplicate('tx-1');
    },
    split: () => {
      actions.split('tx-1');
    },
    'ask category': () => {
      actions.changeCategory(rows);
    },
    'set category': () => {
      actions.changeCategory([SHOPEE, TRANSFER], categoryId('system:shopping'));
    },
    'set category of transfers': () => {
      actions.changeCategory([TRANSFER], null);
    },
    'move none': () => {
      actions.moveAccount([]);
    },
    move: () => {
      actions.moveAccount(rows);
    },
    'tag none': () => {
      actions.addTag([]);
    },
    tag: () => {
      actions.addTag(['a', 'b']);
    },
    copy: () => {
      actions.copyAmount(SHOPEE);
    },
  };
  return (
    <>
      <output aria-label="version">{actions.version}</output>
      {Object.entries(calls).map(([label, call]) => (
        <button key={label} type="button" onClick={call}>
          {label}
        </button>
      ))}
    </>
  );
}

async function renderActions(props: Partial<TransactionActionsProviderProps> = {}, rows?: readonly ActionRow[]) {
  const result = await renderApp(
    <TransactionActionsProvider ledger={LEDGER} timeZone="Asia/Jakarta" {...props}>
      <Harness {...(rows === undefined ? {} : { rows })} />
    </TransactionActionsProvider>,
  );
  const invalidate = vi.spyOn(result.router, 'invalidate').mockResolvedValue();
  const click = (name: string) => userEvent.click(page.getByRole('button', { name, exact: true }));
  return { ...result, invalidate, click };
}

const lastProps = (name: string) =>
  dialogs.props.mock.calls.filter(([dialog]) => dialog === name).at(-1)?.[1] as Record<string, unknown> | undefined;
const version = () => page.getByRole('status', { name: 'version' });
const failure = (description: string) => ({ title: 'Belum berhasil', description, tone: 'error' });
const NOT_FOUND = 'Data ini sudah tidak ada. Muat ulang halaman.';

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useTransactionActions', () => {
  it('refuses to work outside the provider', async () => {
    function Lonely() {
      useTransactionActions();
      return null;
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Lonely />)).rejects.toThrow(MissingTransactionActionsProviderError);
  });
});

describe('TransactionActionsProvider', () => {
  it('deletes one transaction after asking, with its balance note and Urungkan', async () => {
    server.removeTransactions.mockResolvedValue({ ok: true, value: { deleted: ['a'] } });
    server.restoreTransactions
      .mockResolvedValueOnce({ ok: true, value: {} })
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const onRemoved = vi.fn();
    const { click, invalidate } = await renderActions({ onRemoved });
    await click('remove none');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await click('remove');
    expect(lastProps('delete')).toMatchObject({ rows: [SHOPEE], ledger: LEDGER, timeZone: 'Asia/Jakarta' });
    await click('onConfirm');
    expect(server.removeTransactions).toHaveBeenCalledWith({ data: { ids: ['a'] } });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(onRemoved).toHaveBeenCalledWith(['a']);
    await expect.element(version()).toHaveTextContent('1');
    expect(invalidate).toHaveBeenCalledOnce();
    const [options] = toasts.toast.undo.mock.lastCall as [
      { title: string; description: ReactNode; undoLabel: string; onUndo: () => void },
    ];
    expect(options).toMatchObject({ title: 'Transaksi dihapus', undoLabel: 'Urungkan' });
    const note = (await renderApp(<p>{options.description}</p>)).screen;
    expect(note.container.textContent).toBe('Shopee · −Rp389.000 dikembalikan ke BCA Tahapan.');
    await note.unmount();
    options.onUndo();
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(2);
    });
    expect(server.restoreTransactions).toHaveBeenCalledWith({ data: { ids: ['a'] } });
    expect(toasts.toast).not.toHaveBeenCalled();
    options.onUndo();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith(failure(NOT_FOUND));
    });
    await expect.element(version()).toHaveTextContent('3');
  });

  it('deletes several without a note, names an unknown account blank, and reports a refusal', async () => {
    server.removeTransactions.mockResolvedValueOnce({ ok: false, code: 'PERIOD_CLOSED' });
    const many = await renderActions({}, [SHOPEE, OTHER]);
    await many.click('remove');
    await many.click('onConfirm');
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    });
    // The dialog stays for another try.
    await expect.element(page.getByRole('dialog', { name: 'delete' })).toBeVisible();
    server.removeTransactions.mockResolvedValueOnce({ ok: true, value: { deleted: ['a', 'b'] } });
    await many.click('onConfirm');
    await vi.waitFor(() => {
      expect(toasts.toast.undo).toHaveBeenCalledWith(
        expect.not.objectContaining({ description: expect.anything() as unknown }),
      );
    });
    expect(toasts.toast.undo.mock.lastCall?.[0]).toMatchObject({ title: '2 transaksi dihapus' });
    await many.screen.unmount();

    server.removeTransactions.mockResolvedValueOnce({ ok: true, value: { deleted: ['b'] } });
    const one = await renderActions({}, [OTHER]);
    await one.click('remove');
    await one.click('onConfirm');
    await vi.waitFor(() => {
      expect(toasts.toast.undo).toHaveBeenCalledTimes(2);
    });
    const [{ description }] = toasts.toast.undo.mock.lastCall as [{ description: ReactNode }];
    const note = (await renderApp(<p>{description}</p>)).screen;
    expect(note.container.textContent).toBe('Makan & Dapur · −Rp10.000 dikembalikan ke .');
  });

  it('closes the delete dialog on cancel', async () => {
    const { click } = await renderActions();
    await click('remove');
    await click('onCancel');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('duplicates from the fetched detail and offers to open the copy', async () => {
    const detail = transactionDetail('tx-1');
    server.getTransactionDetail.mockResolvedValue({ ok: true, value: detail });
    const onOpen = vi.fn();
    const { click, invalidate } = await renderActions({ onOpen });
    await click('duplicate');
    expect(server.getTransactionDetail).toHaveBeenCalledWith({ data: { id: 'tx-1' } });
    await expect.element(page.getByRole('dialog', { name: 'duplicate' })).toBeVisible();
    expect(lastProps('duplicate')).toMatchObject({ detail, ledger: LEDGER, timeZone: 'Asia/Jakarta' });
    await click('onSaved');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledOnce();
    const [{ title, action }] = toasts.toast.mock.lastCall as [
      { title: string; action: { label: string; onClick: () => void } },
    ];
    expect([title, action.label]).toEqual(['Transaksi diduplikat', 'Lihat']);
    action.onClick();
    expect(onOpen).toHaveBeenCalledWith('tx-copy');
    await click('duplicate');
    await click('onClose');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a duplicate on the Transactions page without `onOpen`', async () => {
    server.getTransactionDetail.mockResolvedValue({ ok: true, value: transactionDetail('tx-1') });
    const { click, router } = await renderActions();
    await click('duplicate');
    await click('onSaved');
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalled();
    });
    const [{ action }] = toasts.toast.mock.lastCall as [{ action: { onClick: () => void } }];
    action.onClick();
    await expect.poll(() => router.state.location.pathname).toBe('/transactions');
    expect(router.state.location.search).toEqual({ tx: 'tx-copy' });
  });

  it('reports a detail that cannot be fetched', async () => {
    server.getTransactionDetail.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    const { click } = await renderActions();
    await click('split');
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith(failure(NOT_FOUND));
    });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('splits with Urungkan, closing the split transaction’s detail', async () => {
    const detail = transactionDetail('tx-1');
    server.getTransactionDetail.mockResolvedValue({ ok: true, value: detail });
    server.unsplitTransaction
      .mockResolvedValueOnce({ ok: true, value: {} })
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const onRemoved = vi.fn();
    const { click, invalidate } = await renderActions({ onRemoved });
    await click('split');
    expect(lastProps('split')).toMatchObject({ detail, ledger: LEDGER });
    await click('onSplit');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(onRemoved).toHaveBeenCalledWith(['tx-1']);
    const [options] = toasts.toast.undo.mock.lastCall as [{ title: string; onUndo: () => void }];
    expect(options.title).toBe('Transaksi dipisah jadi 3');
    options.onUndo();
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(2);
    });
    expect(server.unsplitTransaction).toHaveBeenCalledWith({ data: { id: 'tx-1' } });
    options.onUndo();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith(failure(NOT_FOUND));
    });
    await click('split');
    await click('onClose');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('splits without `onRemoved`', async () => {
    server.getTransactionDetail.mockResolvedValue({ ok: true, value: transactionDetail('tx-1') });
    const { click, invalidate } = await renderActions();
    await click('split');
    await click('onSplit');
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledOnce();
    });
  });

  it('sets a category at once (skipping transfers), or asks for one', async () => {
    server.bulkSetCategory
      .mockResolvedValueOnce({ ok: true, value: { updated: ['a'] } })
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValueOnce({ ok: true, value: { updated: ['a'] } });
    const { click, invalidate } = await renderActions();
    await click('set category of transfers');
    expect(server.bulkSetCategory).not.toHaveBeenCalled();
    await click('set category');
    expect(server.bulkSetCategory).toHaveBeenCalledWith({
      data: { ids: ['a'], categoryId: categoryId('system:shopping') },
    });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ title: 'Kategori 1 transaksi diubah' });
    });
    expect(invalidate).toHaveBeenCalledOnce();

    await click('ask category');
    expect(lastProps('category')).toMatchObject({ rows: [SHOPEE], ledger: LEDGER });
    // Refused: the dialog stays.
    await click('onApply');
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith(failure(NOT_FOUND));
    });
    await expect.element(page.getByRole('dialog', { name: 'category' })).toBeVisible();
    await click('onApply');
    expect(server.bulkSetCategory).toHaveBeenLastCalledWith({ data: { ids: ['a'], categoryId: 'cat-food' } });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await click('ask category');
    await click('onCancel');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves rows to another account', async () => {
    server.bulkMoveAccount
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValueOnce({ ok: true, value: { updated: ['a'] } });
    const { click } = await renderActions();
    await click('move none');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await click('move');
    expect(lastProps('move')).toMatchObject({ rows: [SHOPEE], ledger: LEDGER });
    await click('onApply');
    await expect.element(page.getByRole('dialog', { name: 'move' })).toBeVisible();
    await click('onApply');
    expect(server.bulkMoveAccount).toHaveBeenLastCalledWith({ data: { ids: ['a'], accountId: 'acc-jago' } });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(toasts.toast).toHaveBeenLastCalledWith({ title: '1 transaksi dipindah' });
    await click('move');
    await click('onCancel');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds a tag', async () => {
    server.bulkAddTag
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValueOnce({ ok: true, value: { updated: ['a', 'b'] } });
    const { click } = await renderActions();
    await click('tag none');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await click('tag');
    expect(lastProps('tag')).toMatchObject({ count: 2, ledger: LEDGER });
    await click('onApply');
    await expect.element(page.getByRole('dialog', { name: 'tag' })).toBeVisible();
    await click('onApply');
    expect(server.bulkAddTag).toHaveBeenLastCalledWith({ data: { ids: ['a', 'b'], tag: 'kopi' } });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Tag #kopi ditambahkan ke 2 transaksi' });
    await click('tag');
    await click('onCancel');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('copies the amount as the table shows it, or says it could not', async () => {
    const write = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('denied'));
    const { click } = await renderActions();
    await click('copy');
    expect(write).toHaveBeenCalledWith('−389.000');
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ title: 'Jumlah disalin', description: '−389.000' });
    });
    await click('copy');
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Jumlah tidak bisa disalin', tone: 'error' });
    });
  });
});
