// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { DANA_DARURAT, GOAL_ACCOUNTS } from '../../../test/goal-fixtures.ts';
import { BCA, JAGO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AllocatedAccountWarning } from './allocated-account-warning.tsx';

describe('AllocatedAccountWarning', () => {
  it('previews an expense from allocated cash and lets the user acknowledge it', async () => {
    const { screen } = await renderApp(
      <AllocatedAccountWarning
        goals={[DANA_DARURAT]}
        accounts={GOAL_ACCOUNTS}
        accountId={JAGO.id}
        expense
        amountMinor={450_000n}
        locale="id"
        onSwitch={vi.fn()}
      />,
    );
    await expect.element(screen.getByRole('status')).toMatchTextContent('Rp8.125.000 → Rp7.675.000');
    await screen.getByRole('button', { name: 'Tetap dari Bank Jago' }).click();
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
  });

  it('offers a same-currency account no goal holds, and never warns for income or other accounts', async () => {
    const onSwitch = vi.fn();
    const { screen } = await renderApp(
      <AllocatedAccountWarning
        goals={[DANA_DARURAT]}
        accounts={GOAL_ACCOUNTS}
        accountId={JAGO.id}
        expense
        amountMinor={450_000n}
        locale="id"
        onSwitch={onSwitch}
      />,
    );
    await screen.getByRole('button', { name: `Pakai ${BCA.displayName}` }).click();
    expect(onSwitch).toHaveBeenCalledWith(BCA.id);
    await screen.unmount();
    for (const props of [
      { expense: false, accountId: JAGO.id },
      { expense: true, accountId: null },
      { expense: true, accountId: BCA.id },
    ]) {
      const quiet = await renderApp(
        <AllocatedAccountWarning
          goals={[DANA_DARURAT]}
          accounts={GOAL_ACCOUNTS}
          amountMinor={450_000n}
          locale="id"
          onSwitch={vi.fn()}
          {...props}
        />,
      );
      await expect.element(quiet.screen.getByRole('status')).not.toBeInTheDocument();
      await quiet.screen.unmount();
    }
  });

  it('clamps the reduction to what the goal holds and copes without a ratio or an alternative', async () => {
    const { screen } = await renderApp(
      <AllocatedAccountWarning
        goals={[DANA_DARURAT]}
        accounts={[JAGO]}
        accountId={JAGO.id}
        expense
        amountMinor={9_000_000n}
        locale="id"
        onSwitch={vi.fn()}
      />,
    );
    await expect.element(screen.getByRole('status')).toMatchTextContent('Rp8.125.000 → Rp0');
    await expect.element(screen.getByRole('button', { name: /^Pakai / })).not.toBeInTheDocument();
    await screen.unmount();
    const { screen: zeroTarget } = await renderApp(
      <AllocatedAccountWarning
        goals={[{ ...DANA_DARURAT, targetMinor: 0n }]}
        accounts={[JAGO]}
        accountId={JAGO.id}
        expense
        amountMinor={null}
        locale="id"
        onSwitch={vi.fn()}
      />,
    );
    await expect.element(zeroTarget.getByRole('status')).toMatchTextContent('Rp8.125.000 → Rp8.125.000');
    expect(zeroTarget.getByText('(', { exact: false })).toHaveLength(0);
  });
});
