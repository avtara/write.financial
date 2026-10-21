// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { DANA_DARURAT, goalsOverview, movement, OCTOBER_MOVEMENTS } from '../../../test/goal-fixtures.ts';
import { ACCOUNTS, BCA, JAGO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { MonthContributions, movementText } from './month-contributions.tsx';

describe('MonthContributions', () => {
  it('golden: October’s contributions, recorded and scheduled, against the Rp4.650.000 plan', async () => {
    const { screen } = await renderApp(
      <MonthContributions overview={goalsOverview()} accounts={ACCOUNTS} locale="id" />,
    );
    const card = screen.getByRole('region', { name: 'Setoran Oktober' });
    await expect.element(card).toMatchTextContent(/Setoran OktoberRp4\.650\.000/);
    const rows = card.getByRole('listitem');
    await expect
      .element(rows.nth(0))
      .toMatchTextContent(/1OktKantong daruratBCA Tahapan → Bank Jago · Dana Darurat\+500\.000Tercatat/);
    await expect
      .element(rows.nth(1))
      .toMatchTextContent(/14OktSetor dana darurat · Bibit RDPUBCA Tahapan → — · Dana Darurat/);
    await expect
      .element(rows.nth(2))
      .toMatchTextContent(
        /25OktSisihkan dana tidak rutinBCA Tahapan → Bank Jago · Liburan Bali, Servis motor, Perpanjang STNKRp1\.150\.000Terjadwal/,
      );
    await expect
      .element(card.getByRole('link', { name: 'Buka' }))
      .toHaveAttribute('href', '/transactions?period=2026-10&type=transfer');
    await expect.element(card.getByText('Semua setoran ada di Transaksi')).toBeVisible();
  });

  it('says so without contributions, and labels review and skipped ones', async () => {
    const empty = await renderApp(
      <MonthContributions overview={goalsOverview({ movements: [] })} accounts={ACCOUNTS} locale="id" />,
    );
    await expect.element(empty.screen.getByText('Belum ada setoran bulan ini.')).toBeVisible();
    const statuses = await renderApp(
      <MonthContributions
        overview={goalsOverview({
          movements: [
            { ...OCTOBER_MOVEMENTS[0], key: 'a', status: 'review' } as (typeof OCTOBER_MOVEMENTS)[number],
            { ...OCTOBER_MOVEMENTS[0], key: 'b', status: 'skipped' } as (typeof OCTOBER_MOVEMENTS)[number],
          ],
        })}
        accounts={ACCOUNTS}
        locale="id"
      />,
    );
    await expect.element(statuses.screen.getByText('Perlu ditinjau')).toBeVisible();
    await expect.element(statuses.screen.getByText('Dilewati')).toBeVisible();
  });
});

describe('movementText', () => {
  const names = new Map([[DANA_DARURAT.id, DANA_DARURAT.name]]);

  it('names manual deposits and withdrawals, and an unnamed plan by its goals', () => {
    const date = '2026-10-07' as LocalDate;
    const deposit = movement({
      key: 'in',
      kind: 'manual',
      date,
      shares: [{ goalId: DANA_DARURAT.id, amountMinor: 1n }],
    });
    expect(movementText(deposit, names, ACCOUNTS)).toEqual({
      title: 'Setor manual',
      detail: `${BCA.displayName} → ${JAGO.displayName} · Dana Darurat`,
    });
    const withdrawal = movement({
      key: 'out',
      kind: 'manual',
      date,
      toAccountId: null,
      shares: [{ goalId: 'gone', amountMinor: -1n }],
    });
    expect(movementText(withdrawal, names, ACCOUNTS)).toEqual({ title: 'Tarik dana', detail: 'BCA Tahapan → — · —' });
    const unnamed = movement({ key: 'plan', shares: [{ goalId: DANA_DARURAT.id, amountMinor: 1n }] });
    expect(movementText(unnamed, names, ACCOUNTS).title).toBe('Dana Darurat');
  });
});
