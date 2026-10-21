// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { BCA, CATEGORIES, categoryId } from '../../../test/ledger-fixtures.ts';
import { splitBillContext } from '../../../test/receivable-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { SplitBillSheet, type BillInput, type SplitBillSheetProps } from './split-bill.tsx';

const fake = vi.hoisted(() => ({ getSplitBillContext: vi.fn(), recordSplitBill: vi.fn() }));
vi.mock('../../server/fn/receivables.ts', () => fake);
const routeContext = vi.hoisted(() => vi.fn((): object => ({})));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<object>()),
  useRouteContext: routeContext,
}));

const ENTERTAINMENT = CATEGORIES.find((category) => category.id === categoryId('system:entertainment'));
const CGV: BillInput = {
  type: 'expense',
  clientId: '0192a6c0-0000-7000-8000-000000000009',
  occurredAt: new Date('2026-10-11T12:30:00Z'),
  accountId: BCA.id,
  amountMinor: 485_000n,
  categoryId: categoryId('system:entertainment'),
  description: 'CGV Grand Indonesia',
  note: null,
  tags: [],
  source: 'manual',
};

beforeEach(() => {
  routeContext.mockReturnValue({});
  fake.getSplitBillContext.mockResolvedValue({ ok: true, value: splitBillContext() });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderSheet(props: Partial<SplitBillSheetProps> = {}) {
  const onBack = vi.fn();
  const onSaved = vi.fn();
  const rendered = await renderApp(
    <SplitBillSheet
      bill={CGV}
      date={'2026-10-11' as LocalDate}
      account={BCA}
      category={ENTERTAINMENT}
      locale="id"
      onBack={onBack}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { ...rendered, onBack, onSaved, sheet: rendered.screen.getByRole('dialog', { name: 'Pisah tagihan' }) };
}

describe('SplitBillSheet (IGHyP)', () => {
  it('golden: CGV Rp485.000 halved with Nadia, due 18 Okt, with the preview, saved as expense + receivable', async () => {
    fake.recordSplitBill.mockResolvedValue({ ok: true, value: { transactionId: 'tx', receivables: ['nadia'] } });
    routeContext.mockReturnValue({ viewer: { name: 'Avtara K.', email: 'a@example.test' } });
    const { sheet, onSaved } = await renderSheet();
    await expect.element(sheet).toMatchTextContent(/CGV Grand Indonesia · Minggu, 11 Okt/);
    await expect.element(sheet.getByRole('radio', { name: 'Sama rata' })).toBeChecked();
    const people = sheet.getByRole('list', { name: 'Orang' });
    await expect
      .element(people.getByRole('listitem').first())
      .toMatchTextContent(/AKKamuHiburan · BCA TahapanRp242\.500/);
    await sheet.getByRole('combobox', { name: 'Nama orang ke-2' }).fill('Nadia');
    await expect
      .element(people.getByRole('listitem').last())
      .toMatchTextContent(/^Njadi piutang · jatuh tempo 18 OktRp242\.500$/);
    await expect.element(sheet.getByRole('status')).toMatchTextContent(/Total cocok: 242\.500 \+ 242\.500 = 485\.000/);
    const after = sheet.getByRole('region', { name: 'Setelah disimpan' });
    await expect.element(after).toMatchTextContent(/Hiburan Oktober2\.085\.0001\.842\.500/);
    await expect.element(after).toMatchTextContent(/Pengeluaran Oktober16\.985\.00016\.742\.500/);
    await expect.element(after).toMatchTextContent(/Batas aman harianRp110\.000Rp125\.000/);
    await expect.element(after).toMatchTextContent(/PiutangRp542\.500Rp785\.000/);
    await expect.element(sheet).toMatchTextContent(/Rp485\.000 tetap keluar dari BCA Tahapan/);
    await sheet.getByRole('button', { name: 'Simpan pembagian' }).click();
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ transactionId: 'tx', count: 1 });
    });
    expect(fake.recordSplitBill).toHaveBeenCalledWith({
      data: {
        transaction: { ...CGV, amountMinor: 242_500n },
        shares: [
          {
            clientId: expect.any(String) as unknown,
            counterparty: 'Nadia',
            amountMinor: 242_500n,
            dueDate: '2026-10-18',
            remind: true,
          },
        ],
      },
    });
  });

  it('splits by amount and percent, adds and removes people, and asks for names and a share of the user', async () => {
    fake.recordSplitBill.mockResolvedValue({ ok: false, code: 'PERIOD_CLOSED' });
    const { sheet, screen } = await renderSheet();
    await sheet.getByRole('button', { name: 'Simpan pembagian' }).click();
    await expect.element(sheet.getByText('Isi nama setiap orang')).toBeVisible();
    await sheet.getByRole('combobox', { name: 'Nama orang ke-2' }).fill('Nadia');
    await sheet.getByRole('button', { name: 'Tambah orang' }).click();
    await sheet.getByRole('combobox', { name: 'Nama orang ke-3' }).fill('Dimas');
    await expect.element(sheet.getByRole('status')).toMatchTextContent(/161\.668 \+ 161\.666 \+ 161\.666/);

    await sheet.getByRole('radio', { name: 'Nominal' }).click();
    await expect.element(sheet.getByRole('status')).toMatchTextContent(/Isi bagian setiap orang/);
    await sheet.getByRole('textbox', { name: 'Bagian Kamu' }).fill('0');
    await sheet.getByRole('textbox', { name: 'Bagian Nadia' }).fill('285000');
    await sheet.getByRole('textbox', { name: 'Bagian Dimas' }).fill('100000');
    await expect.element(sheet.getByRole('status')).toMatchTextContent(/Selisih Rp100\.000 dari total/);
    await sheet.getByRole('textbox', { name: 'Bagian Dimas' }).fill('200000');
    await sheet.getByRole('button', { name: 'Simpan pembagian' }).click();
    await expect.element(sheet.getByText(/Bagianmu harus lebih dari 0/)).toBeVisible();

    await sheet.getByRole('button', { name: 'Hapus Dimas' }).click();
    await sheet.getByRole('radio', { name: 'Persen' }).click();
    await sheet.getByRole('textbox', { name: 'Persen Kamu' }).fill('60');
    await sheet.getByRole('textbox', { name: 'Persen Nadia' }).fill('30');
    await expect.element(sheet.getByRole('status')).toMatchTextContent(/Selisih Rp48\.500 dari total/);
    await sheet.getByRole('textbox', { name: 'Persen Nadia' }).fill('40');
    await expect.element(sheet.getByRole('status')).toMatchTextContent(/291\.000 \+ 194\.000/);
    await sheet.getByRole('switch').click();
    await expect.element(sheet.getByRole('switch')).not.toBeChecked();
    await sheet.getByRole('button', { name: 'Tanpa tenggat' }).click();
    await expect.element(sheet.getByRole('switch')).toBeDisabled();
    await expect.element(sheet).toMatchTextContent(/jadi piutang · tanpa tenggat/);
    await sheet.getByRole('button', { name: 'Simpan pembagian' }).click();
    await expect.element(sheet.getByRole('alert').last()).toBeVisible();
    expect(fake.recordSplitBill).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shares: [expect.objectContaining({ amountMinor: 194_000n, dueDate: null, remind: false })],
      }) as unknown,
    });
    fake.recordSplitBill.mockRejectedValue(new Error('offline'));
    await sheet.getByRole('button', { name: 'Simpan pembagian' }).click();
    await expect.element(sheet.getByText('Transaksi tidak bisa disimpan. Coba lagi.')).toBeVisible();
    await screen.unmount();
  });

  it('splits per item with the rest in proportion, and the items follow removed people', async () => {
    const { sheet } = await renderSheet({ bill: { ...CGV, amountMinor: 484_000n } });
    await sheet.getByRole('combobox', { name: 'Nama orang ke-2' }).fill('Nadia');
    await sheet.getByRole('button', { name: 'Tambah orang' }).click();
    await sheet.getByRole('radio', { name: 'Per item' }).click();
    const items = sheet.getByRole('region', { name: 'Item' });
    await expect
      .element(items.getByRole('group', { name: 'Dibagi oleh (item 1)' }))
      .toHaveTextContent('KamuNadiaNama orang ke-3');
    await sheet.getByRole('combobox', { name: 'Nama orang ke-3' }).fill('Dimas');
    // Item 1 was shared by Kamu and Nadia; the next items start with everyone.
    await items.getByRole('textbox', { name: 'Harga item 1' }).fill('200000');
    await items.getByRole('button', { name: 'Tambah item' }).click();
    await items.getByRole('textbox', { name: 'Harga item 2' }).fill('100000');
    const second = items.getByRole('group', { name: 'Dibagi oleh (item 2)' });
    await second.getByRole('button', { name: 'Kamu' }).click();
    await items.getByRole('button', { name: 'Tambah item' }).click();
    await items.getByRole('button', { name: 'Hapus item 3' }).click();
    await expect.element(sheet.getByRole('status')).toMatchTextContent(/Total cocok/);
    await sheet.getByRole('button', { name: 'Hapus Nadia' }).click();
    await expect.element(second).toHaveTextContent('KamuDimas');
    // 200.000 for Kamu and 100.000 for Dimas, 300.000 of items for a 484.000 bill.
    await expect.element(sheet.getByRole('status')).toMatchTextContent(/322\.667 \+ 161\.333 = 484\.000/);
    await second.getByRole('button', { name: 'Dimas' }).click();
    await second.getByRole('button', { name: 'Kamu' }).click();
    await second.getByRole('button', { name: 'Dimas' }).click();
    await second.getByRole('button', { name: 'Kamu' }).click();
    await second.getByRole('button', { name: 'Dimas' }).click();
    await expect.element(sheet.getByRole('status')).toMatchTextContent(/Isi bagian setiap orang/);
  });

  it('works without the preview, a category, an account, or a description, and goes back', async () => {
    fake.getSplitBillContext.mockResolvedValue({ ok: false, code: 'INTERNAL' });
    const failed = await renderSheet({ category: undefined, account: undefined, bill: { ...CGV, description: null } });
    await expect.element(failed.sheet).toMatchTextContent(/Minggu, 11 Okt/);
    await expect.element(failed.sheet.getByRole('region', { name: 'Setelah disimpan' })).not.toBeInTheDocument();
    await failed.sheet.getByRole('button', { name: 'Batal' }).click();
    expect(failed.onBack).toHaveBeenCalled();
    await failed.screen.unmount();

    fake.getSplitBillContext.mockRejectedValue(new Error('offline'));
    const offline = await renderSheet();
    await expect.element(offline.sheet.getByRole('region', { name: 'Setelah disimpan' })).not.toBeInTheDocument();
    await offline.screen.unmount();

    // Outside the budget period and the month only the receivables change.
    fake.getSplitBillContext.mockResolvedValue({ ok: true, value: splitBillContext({ budget: null }) });
    const september = await renderSheet({ date: '2026-09-30' as LocalDate });
    await expect
      .element(september.sheet.getByRole('region', { name: 'Setelah disimpan' }))
      .toMatchTextContent(/^Setelah disimpanPiutangRp542\.500Rp785\.000$/);
    await september.screen.unmount();
    // Without the category's name its budget line is left out.
    fake.getSplitBillContext.mockResolvedValue({ ok: true, value: splitBillContext() });
    const nameless = await renderSheet({ category: undefined });
    await expect
      .element(nameless.sheet.getByRole('region', { name: 'Setelah disimpan' }))
      .toMatchTextContent(/^Setelah disimpanPengeluaran Oktober.*Batas aman harian.*Piutang.*$/);
    await userEvent.keyboard('{Escape}');
    expect(nameless.onBack).toHaveBeenCalled();
  });
});
