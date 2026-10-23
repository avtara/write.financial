// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { DANA_DARURAT, GOAL_ACCOUNTS } from '../../../test/goal-fixtures.ts';
import { JAGO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AllocatedAccountWarning } from './allocated-account-warning.tsx';

describe('AllocatedAccountWarning',()=>{
 it('previews an expense from allocated cash and lets the user acknowledge it',async()=>{
  const {screen}=await renderApp(<AllocatedAccountWarning goals={[DANA_DARURAT]} accounts={GOAL_ACCOUNTS} accountId={JAGO.id} expense amountMinor={450_000n} locale="id" onSwitch={vi.fn()}/>);
  await expect.element(screen.getByRole('status')).toHaveTextContent('Rp8.125.000 → Rp7.675.000');
  await screen.getByRole('button',{name:'Tetap dari Bank Jago'}).click();
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
 });
});
