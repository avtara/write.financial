// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARD_BEFORE_PAYMENT, KULKAS, visa } from '../../../test/debt-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { CardPaymentContext } from '../../server/fn/debts.ts';
import { DEFAULT_TERMS } from '../debts/installment-terms.tsx';
import {
  CardInstallmentField,
  CardPaymentPreview,
  useCardContext,
  type CardPaymentChoice,
  type InstallmentChoice,
} from './card-extras.tsx';

const fake = vi.hoisted(() => ({ getCardPaymentContext: vi.fn() }));
vi.mock('../../server/fn/debts.ts', () => fake);

const d = (value: string) => value as LocalDate;
const OCT: CardPaymentContext = {
  today: d('2026-10-15'),
  card: visa(),
  debts: [],
  priority: ['installments', 'spending'],
};
const NOV: CardPaymentContext = {
  today: d('2026-11-10'),
  card: CARD_BEFORE_PAYMENT,
  debts: [KULKAS],
  priority: ['installments', 'spending'],
};

afterEach(() => {
  vi.clearAllMocks();
});

function Probe({ accountId }: { readonly accountId: string | null }) {
  const state = useCardContext(accountId);
  return <p>{typeof state === 'string' ? state : state === null ? 'none' : state.card.name}</p>;
}

describe('useCardContext', () => {
  it('loads a card, reports failures, and is empty without one', async () => {
    fake.getCardPaymentContext
      .mockResolvedValueOnce({ ok: true, value: OCT })
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockRejectedValueOnce(new TypeError('offline'));
    function Harness() {
      const [id, setId] = useState<string | null>('acc-visa');
      return (
        <>
          <Probe accountId={id} />
          {['acc-visa', 'acc-gone', 'acc-offline'].map((next) => (
            <button
              key={next}
              type="button"
              onClick={() => {
                setId(next);
              }}
            >
              {next}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setId(null);
            }}
          >
            clear
          </button>
        </>
      );
    }
    const { screen } = await renderApp(<Harness />);
    await expect.element(screen.getByText('BCA Visa')).toBeVisible();
    await screen.getByRole('button', { name: 'acc-gone' }).click();
    await expect.element(screen.getByText('failed')).toBeVisible();
    await screen.getByRole('button', { name: 'acc-offline' }).click();
    await expect.element(screen.getByText('failed')).toBeVisible();
    expect(fake.getCardPaymentContext).toHaveBeenLastCalledWith({ data: { accountId: 'acc-offline' } });
    await screen.getByRole('button', { name: 'clear' }).click();
    await expect.element(screen.getByText('none')).toBeVisible();
  });

  it('drops an answer for a card that is no longer chosen', async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    fake.getCardPaymentContext
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce({ ok: true, value: OCT });
    function Harness() {
      const [id, setId] = useState('acc-a');
      return (
        <>
          <Probe accountId={id} />
          <button
            type="button"
            onClick={() => {
              setId((current) => (current === 'acc-a' ? 'acc-b' : 'acc-c'));
            }}
          >
            next
          </button>
        </>
      );
    }
    const { screen } = await renderApp(<Harness />);
    await expect.element(screen.getByText('loading')).toBeVisible();
    await screen.getByRole('button', { name: 'next' }).click();
    await screen.getByRole('button', { name: 'next' }).click();
    await expect.element(screen.getByText('BCA Visa')).toBeVisible();
    first.resolve({ ok: true, value: NOV });
    second.reject(new TypeError('offline'));
    await expect.element(screen.getByText('BCA Visa')).toBeVisible();
  });
});

function Installment({
  context,
  amountMinor,
}: {
  readonly context: CardPaymentContext;
  readonly amountMinor: bigint | null;
}) {
  const [value, setValue] = useState<InstallmentChoice>({ on: false, terms: DEFAULT_TERMS });
  return (
    <CardInstallmentField
      context={context}
      amountMinor={amountMinor}
      date={d('2026-10-15')}
      value={value}
      onChange={setValue}
      locale="id"
    />
  );
}

describe('CardInstallmentField (hNvip, x20Gf)', () => {
  it('golden: off → on the current bill; on → 3× 1.000.000 and what changes', async () => {
    const { screen } = await renderApp(<Installment context={OCT} amountMinor={3_000_000n} />);
    const region = screen.getByRole('region', { name: 'Pecah jadi cicilan' });
    await expect.element(region).toMatchTextContent(/Kartu kredit · sisa limit Rp13\.750\.000/);
    await expect.element(region).toMatchTextContent(/Mati · masuk tagihan berjalan, ditagih 20 Okt/);
    await expect
      .element(region)
      .toMatchTextContent(/Total kewajiban kartu jadi Rp4\.250\.000: cicilan Rp0 \+ tagihan berjalan Rp4\.250\.000/);
    await region.getByRole('switch').click();
    await expect.element(region).toMatchTextContent(/Muncul karena rekeningnya kartu kredit/);
    await expect
      .element(region.getByRole('list', { name: 'Jadwal cicilan' }))
      .toMatchTextContent(/1\/3 · tagihan 20 Okt1\.000\.000/);
    await expect
      .element(region)
      .toMatchTextContent(/Pengeluaran Rp3\.000\.000 tetap tercatat 15 Okt — masuk anggaran Oktober\./);
    await region.getByRole('textbox', { name: 'Bunga' }).fill('x');
    await expect.element(region.getByRole('list', { name: 'Jadwal cicilan' })).not.toBeInTheDocument();
  });

  it('offers nothing below Rp500.000, without an amount, or on a card without a cycle', async () => {
    const { screen } = await renderApp(
      <>
        <Installment context={OCT} amountMinor={499_999n} />
        <Installment context={OCT} amountMinor={null} />
        <Installment context={{ ...OCT, card: visa({ dueDay: null }) }} amountMinor={3_000_000n} />
      </>,
    );
    expect(screen.getByRole('switch').elements()).toHaveLength(0);
    expect(screen.getByText(/Kartu kredit · sisa limit/).elements()).toHaveLength(3);
  });
});

function Payment({ context, amountMinor }: { readonly context: CardPaymentContext; readonly amountMinor: bigint }) {
  const [value, setValue] = useState<CardPaymentChoice>({ priority: null, mode: 'reduce_amount' });
  return (
    <>
      <CardPaymentPreview context={context} amountMinor={amountMinor} value={value} onChange={setValue} locale="id" />
      <p>mode:{value.mode}</p>
    </>
  );
}

describe('CardPaymentPreview (qrRRV)', () => {
  it('golden: Rp2.000.000 → installment A first, 3× Rp333.334, limit 11.000.000 → 13.000.000', async () => {
    const { screen } = await renderApp(<Payment context={NOV} amountMinor={2_000_000n} />);
    const region = screen.getByRole('region', { name: 'Alokasi pembayaran kartu' });
    const rows = region.getByRole('row');
    await expect
      .element(rows.nth(1))
      .toMatchTextContent(/1Tokopedia — Kulkas 2 pintuutang · 3×, belum tertagih.*3\.000\.0002\.000\.0001\.000\.000/);
    await expect
      .element(rows.nth(2))
      .toMatchTextContent(/2Tagihan berjalantagihan berjalan · 20 Nov.*1\.000\.00001\.000\.000/);
    await expect.element(rows.nth(3)).toMatchTextContent(/3Lebih bayarjadi saldo kredit.*—0—/);
    await expect.element(region).toMatchTextContent(/Sisa Tokopedia — Kulkas 2 pintu Rp1\.000\.000 dibagi/);
    await expect.element(region).toMatchTextContent(/3× Rp333\.334 · tenor tetap/);
    await expect.element(region).toMatchTextContent(/1× Rp1\.000\.000 · lunas 20 Nov/);
    await expect.element(region).toMatchTextContent(/Utang cicilan \(Utang & cicilan\)3\.000\.0001\.000\.000/);
    await expect.element(region).toMatchTextContent(/Total kewajiban kartu4\.000\.0002\.000\.000/);
    await expect.element(region).toMatchTextContent(/Sisa limit11\.000\.00013\.000\.000/);
    await expect.element(region).toMatchTextContent(/Tagihan 20 Nov2\.000\.0001\.333\.334/);
    await region.getByRole('radio', { name: /Persingkat tenor/ }).click();
    await expect.element(screen.getByText('mode:shorten_tenor')).toBeVisible();
    await region.getByRole('radio', { name: /Kurangi nominal/ }).click();
    await expect.element(screen.getByText('mode:reduce_amount')).toBeVisible();

    await expect.element(region.getByRole('button', { name: 'Naikkan Utang cicilan' })).toBeDisabled();
    await region.getByRole('button', { name: 'Naikkan Tagihan berjalan' }).click();
    await expect
      .element(region.getByRole('row').nth(1))
      .toMatchTextContent(/1Tagihan berjalan.*1\.000\.0001\.000\.0000/);
    await expect.element(region).toMatchTextContent(/Sisa Tokopedia — Kulkas 2 pintu Rp2\.000\.000 dibagi/);
    await region.getByRole('button', { name: 'Turunkan Tagihan berjalan' }).click();
    await expect.element(region.getByRole('row').nth(1)).toMatchTextContent(/1Tokopedia/);
  });

  it('pays only the bill of a card without installments or a cycle', async () => {
    const bare = { ...OCT, card: visa({ statementDay: null }) };
    const { screen } = await renderApp(<Payment context={bare} amountMinor={250_000n} />);
    const region = screen.getByRole('region', { name: 'Alokasi pembayaran kartu' });
    await expect.element(region.getByRole('row').nth(1)).toMatchTextContent(/Tagihan berjalanbelanja non-cicilan/);
    await expect.element(region).not.toMatchTextContent(/Tagihan 20/);
  });
});
