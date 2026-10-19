// SPDX-License-Identifier: AGPL-3.0-only
import type { ReferenceRate } from '@wf/db/fx-rates';
import type { LocalDate } from '@wf/domain/period';
import { setLocale } from '@wf/i18n/runtime';
import { Toaster } from '@wf/ui/toast';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { BCA, GOTRADE, JAGO, LEDGER, account } from '../../../test/ledger-fixtures.ts';
import type { RecordTransactionInput } from '../../server/fn/transactions-write.ts';
import { emptyValues, type TransactionFormValues } from './transaction-draft.ts';
import { useTransactionForm, type LedgerData } from './use-transaction-form.ts';

const server = vi.hoisted(() => ({ getReferenceRate: vi.fn() }));
vi.mock('../../server/fn/ledger.ts', () => server);

const rate = (base: string, quote: string, value: string): ReferenceRate => ({
  base,
  quote,
  rate: value,
  provider: 'exchangerate-api',
  rateType: 'blended',
  asOf: '2026-10-19' as LocalDate,
  fetchedAt: new Date('2026-10-19T01:00:00Z'),
  manual: false,
});
const USD_IDR = rate('USD', 'IDR', '16350.0275');

const START = emptyValues({ accountId: BCA.id, date: '2026-10-19' as LocalDate, time: '19:30' });
/** Rp3.000.000 from BCA to Gotrade (USD). */
const FX: TransactionFormValues = { ...START, type: 'transfer', amountMinor: 3_000_000n, toAccountId: GOTRADE.id };

function Wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster label="Notifikasi" />
    </>
  );
}

async function renderForm(initial: TransactionFormValues = START, data: LedgerData = LEDGER) {
  const hook = await renderHook(() => useTransactionForm({ initial, data, locale: 'id' }), { wrapper: Wrapper });
  const state = () => hook.result.current;
  return { ...hook, state };
}

beforeAll(async () => {
  await setLocale('id', { reload: false });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('useTransactionForm', () => {
  it('validates, shows errors on the first attempt, and prepares the input', async () => {
    const { state, act } = await renderForm();
    expect(state().rate).toBeNull();
    expect(state().figures).toBeNull();
    expect(state().showErrors).toBe(false);
    expect(state().errors).toEqual({ amount: 'required', category: 'required' });

    const prepared: (RecordTransactionInput | null)[] = [];
    await act(() => {
      prepared.push(state().prepare({ timeZone: 'Asia/Jakarta', source: 'manual' }));
    });
    expect(prepared).toEqual([null]);
    await expect.poll(() => state().showErrors).toBe(true);

    await act(() => {
      state().update({ amountMinor: 100_000n, accountId: 'acc-ovo', categoryId: 'cat-food' });
    });
    await expect.poll(() => state().errors).toEqual({});
    expect(state().shortfall?.shortMinor).toBe(14_000n);

    await act(() => {
      prepared.push(state().prepare({ timeZone: 'Asia/Jakarta', source: 'quick' }));
      prepared.push(state().prepare({ timeZone: 'Asia/Jakarta', source: 'quick' }));
    });
    const [, first, again] = prepared;
    expect(first).toMatchObject({ type: 'expense', accountId: 'acc-ovo', amountMinor: 100_000n, source: 'quick' });
    // Retries of the same entry keep their idempotency key.
    expect(again?.clientId).toBe(first?.clientId);

    await act(() => {
      state().reset({ ...START, amountMinor: 5n, categoryId: 'cat-food' });
    });
    await expect.poll(() => state().showErrors).toBe(false);
    await act(() => {
      prepared.push(state().prepare({ timeZone: 'Asia/Jakarta', source: 'manual' }));
    });
    expect(prepared[3]?.clientId).toEqual(expect.any(String));
    expect(prepared[3]?.clientId).not.toBe(first?.clientId);
    expect(server.getReferenceRate).not.toHaveBeenCalled();
  });

  it('needs no rate for a same-currency transfer', async () => {
    const { state } = await renderForm({ ...FX, toAccountId: JAGO.id });
    expect(state().rate).toBeNull();
    expect(server.getReferenceRate).not.toHaveBeenCalled();
  });

  it('loads the reference rate of a cross-currency transfer once', async () => {
    const { promise, resolve: answer } = Promise.withResolvers<unknown>();
    server.getReferenceRate.mockReturnValueOnce(promise);
    const { state, act } = await renderForm(FX);
    expect(server.getReferenceRate).toHaveBeenCalledWith({ data: { base: 'USD', quote: 'IDR' } });
    expect(state().rate).toMatchObject({ status: 'loading', reference: null });
    expect(state().errors).toEqual({ rate: 'required' });

    await act(() => {
      answer({ ok: true, value: USD_IDR });
    });
    await expect.poll(() => state().rate?.status).toBe('ready');
    expect(state().rate?.reference).toEqual(USD_IDR);
    expect(state().figures?.receivedMinor).toBe(18_349n);
    expect(state().errors).toEqual({});

    // Back and forth between pairs asks the server only once per pair.
    await act(() => {
      state().update({ toAccountId: JAGO.id });
    });
    await expect.poll(() => state().rate).toBeNull();
    await act(() => {
      state().update({ toAccountId: GOTRADE.id });
    });
    await expect.poll(() => state().rate?.status).toBe('ready');
    expect(server.getReferenceRate).toHaveBeenCalledTimes(1);

    let prepared: unknown = null;
    await act(() => {
      prepared = state().prepare({ timeZone: 'Asia/Jakarta', source: 'manual' });
    });
    expect(prepared).toMatchObject({ type: 'transfer', sentMinor: 3_000_000n, receivedMinor: 18_349n });
  });

  it('uses the same orientation from USD to IDR', async () => {
    server.getReferenceRate.mockResolvedValue({ ok: true, value: null });
    const { state } = await renderForm({ ...FX, accountId: GOTRADE.id, toAccountId: BCA.id, amountMinor: 1_000n });
    await expect.poll(() => state().rate?.status).toBe('ready');
    expect(server.getReferenceRate).toHaveBeenCalledExactlyOnceWith({ data: { base: 'USD', quote: 'IDR' } });
    // No rate known for the pair.
    expect(state().rate?.reference).toBeNull();
    expect(state().errors).toEqual({ rate: 'required' });
  });

  it('values the destination in the base currency when neither side is in it', async () => {
    const sgd = account({ id: 'acc-sgd', displayName: 'DBS', currency: 'SGD' });
    server.getReferenceRate.mockImplementation(({ data }: { data: { base: string; quote: string } }) =>
      Promise.resolve({
        ok: true,
        value: data.base === 'USD' ? rate('USD', 'SGD', '1.3') : rate('SGD', 'IDR', '12000'),
      }),
    );
    const { state } = await renderForm(
      { ...FX, accountId: GOTRADE.id, toAccountId: sgd.id, amountMinor: 10_000n, receivedMinor: 12_000n },
      { ...LEDGER, accounts: [...LEDGER.accounts, sgd] },
    );
    await expect.poll(() => state().figures?.difference.differenceBaseMinor).toBe(-120_000n);
    expect(server.getReferenceRate).toHaveBeenCalledWith({ data: { base: 'USD', quote: 'SGD' } });
    expect(server.getReferenceRate).toHaveBeenCalledWith({ data: { base: 'SGD', quote: 'IDR' } });
  });

  it('reports a failed answer with a toast whose "Coba lagi" asks again', async () => {
    server.getReferenceRate
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: true, value: USD_IDR });
    const { state } = await renderForm(FX);
    await expect.poll(() => state().rate?.status).toBe('failed');
    expect(state().rate?.reference).toBeNull();
    await expect.element(page.getByText('Kurs tidak bisa diperbarui')).toBeVisible();
    await expect.element(page.getByText('Masih memakai kurs terakhir.')).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: 'Coba lagi' }));
    await expect.poll(() => state().rate?.status).toBe('ready');
    expect(state().rate?.reference).toEqual(USD_IDR);
    expect(server.getReferenceRate).toHaveBeenCalledTimes(2);
  });

  it('keeps the last rate when a refresh is rejected', async () => {
    const { promise, reject } = Promise.withResolvers<unknown>();
    server.getReferenceRate.mockResolvedValueOnce({ ok: true, value: USD_IDR }).mockReturnValueOnce(promise);
    const { state, act } = await renderForm(FX);
    await expect.poll(() => state().rate?.status).toBe('ready');

    await act(() => {
      state().rate?.refresh();
    });
    await expect.poll(() => state().rate?.status).toBe('loading');
    expect(state().rate?.reference).toEqual(USD_IDR);

    await act(() => {
      reject(new Error('offline'));
    });
    await expect.poll(() => state().rate?.status).toBe('failed');
    expect(state().rate?.reference).toEqual(USD_IDR);
    expect(state().figures?.receivedMinor).toBe(18_349n);
    await expect.element(page.getByRole('button', { name: 'Coba lagi' })).toBeVisible();
  });
});
