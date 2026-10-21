// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { goalsOverview, LIBURAN_BALI, SEED_GOALS, SET_ASIDE } from '../../../test/goal-fixtures.ts';
import { ACCOUNTS } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { SinkingFunds } from './sinking-funds.tsx';

describe('SinkingFunds', () => {
  it('lists the sinking funds with their monthly amount and due month, their total, and the payday transfer', async () => {
    const onOpen = vi.fn();
    const onNew = vi.fn();
    const { screen } = await renderApp(
      <SinkingFunds overview={goalsOverview()} accounts={ACCOUNTS} locale="id" onOpen={onOpen} onNew={onNew} />,
    );
    const card = screen.getByRole('region', { name: 'Dana tidak rutin' });
    await expect.element(card.getByText('Disisihkan tiap tgl 25 · BCA Tahapan → Bank Jago')).toBeVisible();
    const liburan = card.getByRole('button', { name: /^Liburan Bali/ });
    await expect
      .element(liburan)
      .toMatchTextContent(/Rp867\.000\/bulan.*Rp2\.800\.000 \/ Rp8\.000\.000.*Jatuh tempo Mar 2027/);
    await expect.element(card.getByRole('button', { name: /^Servis motor/ })).toBeVisible();
    await expect.element(card.getByRole('button', { name: /^Perpanjang STNK/ })).toBeVisible();
    await expect.element(card.getByText('Total per bulan')).toBeVisible();
    await expect.element(card.getByText('Rp1.150.000/bulan')).toBeVisible();
    await liburan.click();
    expect(onOpen).toHaveBeenCalledWith(LIBURAN_BALI);
    await card.getByRole('button', { name: 'Dana baru' }).click();
    expect(onNew).toHaveBeenCalled();
  });

  it('leaves out an unknown due month and names unknown accounts with a dash', async () => {
    const { screen } = await renderApp(
      <SinkingFunds
        overview={goalsOverview({
          goals: [{ ...LIBURAN_BALI, deadlineMonth: null }],
          setAside: { ...SET_ASIDE, fromAccountId: 'gone', toAccountId: 'gone' },
        })}
        accounts={ACCOUNTS}
        locale="id"
        onOpen={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Disisihkan tiap tgl 25 · — → —')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: /^Liburan Bali/ })).not.toMatchTextContent(/Jatuh tempo/);
  });

  it('says so without sinking funds or a set-aside day', async () => {
    const { screen } = await renderApp(
      <SinkingFunds
        overview={goalsOverview({
          goals: SEED_GOALS.filter((goal) => goal.kind === 'savings'),
          setAside: { ...SET_ASIDE, monthDay: null },
        })}
        accounts={ACCOUNTS}
        locale="id"
        onOpen={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Belum ada dana tidak rutin.')).toBeVisible();
    await expect
      .element(screen.getByText('Untuk biaya tahunan atau sesekali — disisihkan sedikit tiap bulan.'))
      .toBeVisible();
    expect(screen.getByText('Total per bulan').query()).toBeNull();
  });
});
