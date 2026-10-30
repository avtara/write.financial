// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, categoryId, LEDGER, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import type { TransactionColumn } from '../../lib/transaction-columns.ts';
import { LONG_PRESS_MS } from '../../lib/use-long-press.ts';
import {
  categoryLabel,
  RowAmount,
  SignedMoney,
  sourceLabel,
  TransactionRowView,
  type TransactionRowViewProps,
} from './transaction-row.tsx';

const DEFAULT_COLUMNS: TransactionColumn[] = ['time', 'description', 'tags', 'category', 'account', 'amount'];

async function renderRow(props: Partial<TransactionRowViewProps> = {}) {
  const handlers = { onCheck: vi.fn(), onOpen: vi.fn(), onKeyDown: vi.fn(), onFocus: vi.fn(), onLongPress: vi.fn() };
  const result = await renderApp(
    <TransactionRowView
      row={transactionRow('t-1', { merchant: 'Gojek', description: 'ke kantor', tags: ['kantor', 'rumah'] })}
      columns={DEFAULT_COLUMNS}
      density="comfortable"
      mode="day"
      ledger={LEDGER}
      timeZone="Asia/Jakarta"
      locale="id"
      query={undefined}
      balance={null}
      label="Gojek"
      open={false}
      checked={false}
      tabStop
      menu={<button type="button">Menu Gojek</button>}
      {...handlers}
      {...props}
    />,
  );
  const label = props.label ?? 'Gojek';
  return { ...result, ...handlers, group: result.screen.getByRole('group', { name: label }) };
}

beforeEach(async () => {
  await page.viewport(1440, 900);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('sourceLabel / categoryLabel', () => {
  it('names automated sources and nothing for manual entries', () => {
    expect(sourceLabel('manual')).toBeNull();
    expect(sourceLabel('gmail')).toBe('Gmail · agent');
    expect(sourceLabel('quick')).toBe('Catat Cepat');
  });

  it('labels categories, uncategorized rows, and other types', () => {
    expect(categoryLabel({ type: 'expense', categoryId: categoryId('system:food') }, LEDGER).label).toBe(
      'Makan & Dapur',
    );
    expect(categoryLabel({ type: 'income', categoryId: null }, LEDGER)).toEqual({
      label: 'Belum dikategorikan',
      color: '',
    });
    expect(categoryLabel({ type: 'transfer', categoryId: null }, LEDGER).label).toBe('Transfer');
    expect(categoryLabel({ type: 'adjustment', categoryId: null }, LEDGER).label).toBe('Penyesuaian saldo');
  });
});

describe('amounts', () => {
  it('signs incomes in green, expenses with a minus, transfers neutral', async () => {
    const { screen } = await renderApp(
      <>
        <RowAmount row={transactionRow('a', { type: 'income', amountMinor: 6_200_000n })} locale="id" baseCurrency="IDR" />
        <RowAmount row={transactionRow('b')} locale="id" baseCurrency="IDR" />
        <RowAmount row={transactionRow('c', { type: 'transfer', amountMinor: -3_000_000n })} locale="id" baseCurrency="IDR" />
        <RowAmount row={transactionRow('d', { type: 'transfer', amountMinor: 5_000n })} locale="id" baseCurrency="IDR" />
      </>,
    );
    await expect.element(screen.getByText('+Rp6.200.000')).toHaveClass('text-green-fg');
    await expect.element(screen.getByText('−Rp10.000')).toBeVisible();
    await expect.element(screen.getByText('Rp3.000.000', { exact: true })).toHaveClass('text-muted-fg');
    await expect.element(screen.getByText('Rp5.000', { exact: true })).toBeVisible();
  });

  it('drops the sign and the color in privacy mode', async () => {
    const { screen } = await renderApp(<SignedMoney amountMinor={6_200_000n} currency="IDR" locale="id" />, {
      preferences: { balancesHidden: true },
    });
    const amount = screen.getByText('Rp••••••').element().closest('.font-mono.whitespace-nowrap');
    expect(amount?.textContent.startsWith('+')).toBe(false);
    expect(amount?.getAttribute('class')).not.toContain('text-green-fg');
  });
});

describe('TransactionRowView', () => {
  it('shows time, glyph, merchant — description, tags, category, account, and amount', async () => {
    const { group } = await renderRow();
    await expect.element(group).toHaveAttribute('tabindex', '0');
    await expect.element(group.getByText('12.41')).toBeVisible();
    await expect.element(group.getByText('Gojek — ke kantor')).toBeVisible();
    await expect.element(group.getByText('#kantor')).toBeVisible();
    await expect.element(group.getByText('Makan & Dapur')).toBeVisible();
    await expect.element(group.getByText(BCA.displayName)).toBeVisible();
    await expect.element(group.getByText('−Rp10.000')).toBeVisible();
    expect(group.element().querySelector('mark')).toBeNull();
    expect(group.element().getAttribute('aria-current')).toBeNull();
  });

  it('highlights the search in the text and the tags, and marks the open row', async () => {
    const { group } = await renderRow({ query: 'kantor', open: true, checked: true, tabStop: false });
    expect(group.element().querySelector('mark')?.textContent).toBe('kantor');
    await expect.element(group.getByText('#kantor')).toHaveClass('text-amber-fg');
    await expect.element(group.getByText('#rumah')).not.toHaveClass('text-amber-fg');
    await expect.element(group).toHaveAttribute('aria-current', 'true');
    await expect.element(group).toHaveAttribute('tabindex', '-1');
    await expect.element(group.getByRole('checkbox', { name: 'Pilih Gojek' })).toBeChecked();
  });

  it('shows the date in the Flat view and the inline source badge and clip, without tags when hidden', async () => {
    const row = transactionRow('t-1', {
      description: 'Rak buku',
      tags: ['rumah'],
      source: 'gmail',
      hasAttachment: true,
      categoryId: 'gone',
    });
    const { group } = await renderRow({
      row,
      mode: 'flat',
      density: 'compact',
      columns: ['time', 'description', 'category', 'amount'],
    });
    await expect.element(group.getByText('15 Okt · 12.41')).toBeVisible();
    await expect.element(group.getByText('Rak buku')).toBeVisible();
    await expect.element(group.getByText('Gmail · agent')).toBeVisible();
    await expect.element(group.getByRole('img', { name: 'Ada lampiran' })).toBeVisible();
    await expect.element(group.getByText('#rumah')).not.toBeInTheDocument();
    await expect.element(group.getByText('Belum dikategorikan')).toBeVisible();
    await expect.element(group).toHaveClass('min-h-[38px]');
  });

  it('falls back to the category name and draws transfers with their own glyph', async () => {
    const { group } = await renderRow({
      row: transactionRow('t-1', { type: 'transfer', categoryId: null, amountMinor: -3_000_000n }),
    });
    await expect.element(group.getByText('Transfer', { exact: true }).first()).toBeVisible();
  });

  it('uses the category name as the title, and an unknown glyph for custom icons', async () => {
    const kopi = userCategory({ id: 'kopi', name: 'Kopi', icon: 'unknown-icon' });
    const { group } = await renderRow({
      row: transactionRow('t-1', { categoryId: 'kopi' }),
      ledger: { ...LEDGER, categories: [...LEDGER.categories, kopi] },
    });
    expect(group.getByText('Kopi').elements()).toHaveLength(2);
  });

  it('puts attachment, running balance, and source in their own columns', async () => {
    const row = transactionRow('t-1', { merchant: 'Shopee', source: 'quick', hasAttachment: true });
    const columns: TransactionColumn[] = ['description', 'amount', 'attachment', 'balance', 'source'];
    const { group } = await renderRow({
      row,
      columns,
      label: 'Shopee',
      balance: { minor: 42_810_000n, currency: 'IDR' },
    });
    await expect.element(group.getByText('Rp42.810.000')).toBeVisible();
    await expect.element(group.getByRole('img', { name: 'Ada lampiran' })).toBeVisible();
    await expect.element(group.getByText('Catat Cepat')).toBeVisible();
    const plain = await renderRow({ row: transactionRow('t-2', { merchant: 'Gojek' }), columns });
    await expect
      .element(plain.group.getByText('—'))
      .toHaveAttribute('title', 'Saldo berjalan tampil saat satu rekening difilter');
    await expect.element(plain.group.getByRole('img', { name: 'Ada lampiran' })).not.toBeInTheDocument();
  });

  it('opens on click, checks on shift-click and on the checkbox, and leaves the menu alone', async () => {
    const { group, onOpen, onCheck, onFocus, onKeyDown } = await renderRow();
    await userEvent.click(group.getByText('Gojek — ke kantor'));
    expect(onOpen).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Shift>}');
    await userEvent.click(group.getByText('Makan & Dapur'));
    await userEvent.keyboard('{/Shift}');
    expect(onCheck).toHaveBeenLastCalledWith(true);
    await userEvent.click(group.getByRole('checkbox'));
    expect(onCheck).toHaveBeenLastCalledWith(false);
    await userEvent.click(group.getByRole('button', { name: 'Menu Gojek' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onCheck).toHaveBeenCalledTimes(2);
    expect(onFocus).toHaveBeenCalled();
    onFocus.mockClear();
    (group.getByRole('button', { name: 'Menu Gojek' }).element() as HTMLElement).focus();
    expect(onFocus).not.toHaveBeenCalled();
    (group.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('offers the ⋯ menu to a finger held on the row instead of opening it', async () => {
    const { group, onOpen, onLongPress } = await renderRow();
    const row = group.element() as HTMLElement;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      vi.advanceTimersByTime(LONG_PRESS_MS);
      row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
      row.click();
    } finally {
      vi.useRealTimers();
    }
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
