// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_AFTER_PAYMENT,
  KULKAS_AFTER,
  OCTOBER_BILL,
  PAID_OVERVIEW,
  VISA_ACCOUNT,
  visa,
} from '../../../test/debt-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { cardState } from '../../lib/debts.ts';
import { CardBillCard, CardStrip } from './card-section.tsx';

const OCT_15 = '2026-10-15' as LocalDate;
const BILL = { ...visa(), transactions: OCTOBER_BILL };

describe('CardStrip', () => {
  it('golden rHTMd: bill 1.250.000 from 3 October transactions, 13.750.000 left, bill of 20 Okt due 5 Nov', async () => {
    const { screen } = await renderApp(
      <CardStrip bill={BILL} state={cardState(BILL, [], OCT_15)} account={VISA_ACCOUNT} heldNames={[]} locale="id" />,
    );
    const strip = screen.getByRole('region', { name: 'BCA Visa •• 7710' });
    await expect.element(strip).toMatchTextContent(/Tagihan berjalan3 transaksi Okt1\.250\.000/);
    await expect.element(strip).toMatchTextContent(/Sisa limitdari Rp15\.000\.00013\.750\.000/);
    await expect.element(strip).toMatchTextContent(/Tagihan 20 Oktbayar paling lambat 5 Nov1\.250\.000/);
    await expect.element(strip).not.toMatchTextContent(/Cicilan ditahan/);
  });

  it('golden A7ttc: B Superindo, installment A held, 13.000.000 left, statement 1.333.334', async () => {
    const [bill] = PAID_OVERVIEW.cards;
    const state = cardState(CARD_AFTER_PAYMENT, [KULKAS_AFTER], '2026-11-10' as LocalDate);
    const { screen } = await renderApp(
      <CardStrip bill={bill as typeof BILL} state={state} account={undefined} heldNames={['Kulkas']} locale="id" />,
    );
    const strip = screen.getByRole('region', { name: 'BCA Visa' });
    await expect.element(strip).toMatchTextContent(/Tagihan berjalanSuperindo — belanja bulanan 6 Nov1\.000\.000/);
    await expect.element(strip).toMatchTextContent(/Cicilan ditahan di limitsisa pokok Kulkas1\.000\.000/);
    await expect.element(strip).toMatchTextContent(/13\.000\.000/);
    await expect
      .element(strip)
      .toMatchTextContent(/Rekening koran 20 Novcicilan 333\.334 \+ tagihan 1\.000\.000 · tempo 5 Des1\.333\.334/);
  });

  it('names a single bill transaction by its merchant, or by its date alone', async () => {
    const one = (description: string | null, merchant: string | null) => ({
      ...visa(),
      transactions: [{ ...(OCTOBER_BILL[0] as (typeof OCTOBER_BILL)[number]), description, merchant }],
    });
    const { screen } = await renderApp(
      <>
        {[one(null, 'Superindo'), one(null, null)].map((bill, index) => (
          <CardStrip
            key={index}
            bill={{ ...bill, accountId: `card-${String(index)}`, name: `Kartu ${String(index)}` }}
            state={cardState(bill, [], OCT_15)}
            account={undefined}
            heldNames={[]}
            locale="id"
          />
        ))}
      </>,
    );
    await expect
      .element(screen.getByRole('region', { name: 'Kartu 0' }))
      .toMatchTextContent(/Tagihan berjalanSuperindo 12 Okt/);
    await expect.element(screen.getByRole('region', { name: 'Kartu 1' })).toMatchTextContent(/Tagihan berjalan 12 Okt/);
  });

  it('leaves out the limit and the statement of a card without them, and names an over-limit card red', async () => {
    const bare = { ...visa({ limitMinor: null, statementDay: null }), transactions: [] };
    const { screen } = await renderApp(
      <CardStrip bill={bare} state={cardState(bare, [], OCT_15)} account={VISA_ACCOUNT} heldNames={[]} locale="id" />,
    );
    const strip = screen.getByRole('region', { name: 'BCA Visa •• 7710' });
    await expect.element(strip).not.toMatchTextContent(/Sisa limit/);
    await expect.element(strip).not.toMatchTextContent(/Tagihan 20/);
    await screen.unmount();
    const over = { ...visa({ balanceMinor: -16_000_000n }), transactions: [] };
    const second = await renderApp(
      <CardStrip bill={over} state={cardState(over, [], OCT_15)} account={VISA_ACCOUNT} heldNames={[]} locale="id" />,
    );
    await expect.element(second.screen.getByText('−1.000.000')).toHaveClass(/text-red-fg/);
  });
});

describe('CardBillCard', () => {
  it('golden rHTMd: 8% of the limit, the three October transactions, pay and convert', async () => {
    const onPay = vi.fn();
    const onConvert = vi.fn();
    const { screen } = await renderApp(
      <CardBillCard
        bill={BILL}
        state={cardState(BILL, [], OCT_15)}
        account={VISA_ACCOUNT}
        heldNames={[]}
        locale="id"
        onPay={onPay}
        onConvert={onConvert}
      />,
    );
    const card = screen.getByRole('article', { name: 'Tagihan BCA Visa' });
    await expect.element(card).toMatchTextContent(/•• 7710 · tagihan tgl 20 · bayar tgl 5/);
    await expect.element(card).toMatchTextContent(/Rp1\.250\.000bayar paling lambat 5 Nov/);
    await expect.element(card).toMatchTextContent(/8,33% dari limit Rp15\.000\.000sisa limit Rp13\.750\.000/);
    await expect
      .element(card.getByRole('list'))
      .toHaveTextContent(
        'Superindo — belanja bulanan12 OktRp450.000Shopee — sepatu lari14 OktRp320.000Pertamina — bensin15 OktRp480.000',
      );
    await card.getByRole('button', { name: 'Bayar tagihan' }).click();
    await card.getByRole('button', { name: 'Ubah jadi cicilan' }).click();
    expect(onPay).toHaveBeenCalled();
    expect(onConvert).toHaveBeenCalled();
  });

  it('shows an empty cycle, no due date or usage without them, and names a transaction by merchant or card', async () => {
    const bare = {
      ...visa({ balanceMinor: 0n, limitMinor: null, statementDay: null, dueDay: null }),
      transactions: [],
    };
    const { screen } = await renderApp(
      <CardBillCard
        bill={bare}
        state={cardState(bare, [], OCT_15)}
        account={undefined}
        heldNames={[]}
        locale="id"
        onPay={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Belum ada transaksi di siklus ini')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Bayar tagihan' })).toBeDisabled();
    await expect.element(screen.getByText(/bayar paling lambat/)).not.toBeInTheDocument();
    await screen.unmount();
    const named = {
      ...visa(),
      transactions: [
        { ...(OCTOBER_BILL[0] as (typeof OCTOBER_BILL)[number]), description: null, merchant: 'Tokopedia' },
        { ...(OCTOBER_BILL[1] as (typeof OCTOBER_BILL)[number]), description: null, merchant: null },
      ],
    };
    const second = await renderApp(
      <CardBillCard
        bill={named}
        state={cardState(named, [], OCT_15)}
        account={undefined}
        heldNames={[]}
        locale="id"
        onPay={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    await expect.element(second.screen.getByRole('list')).toMatchTextContent(/^Tokopedia12 Okt.*BCA Visa14 Okt/);
  });
});
