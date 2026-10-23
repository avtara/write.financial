// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { DP_RUMAH } from '../../../test/goal-fixtures.ts';
import { goalAssetOptions, SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { accountsOnly, draftBps, draftProblem, GoalAssetNotices } from './goal-asset-sources.tsx';

describe('goal asset sources',()=>{
 it('enforces the share left by other goals, including whole-asset mode',()=>{
  const draft={key:0,assetId:SPY.id,mode:'percent' as const,percent:'60'};
  const assets=goalAssetOptions([SPY]);
  expect(draftProblem(draft,assets,DP_RUMAH.id,'id')).toBeNull();
  expect(draftProblem({...draft,percent:'70'},assets,DP_RUMAH.id,'id')).toContain('Maks. 60%');
  expect(draftProblem({...draft,mode:'whole'},assets,DP_RUMAH.id,'id')).toContain('Melebihi 100%');
  expect(draftBps({...draft,percent:'0'})).toBeNull();
  expect(draftBps({...draft,percent:'0,01'})).toBe(1);
 });
 it('account-only valuation removes asset amounts but preserves account funding',()=>{
  const [goal]=accountsOnly([DP_RUMAH]);
  expect(goal?.savedMinor).toBe(5_000_000n);
  expect(goal?.assetSources).toEqual([]);
  expect(DP_RUMAH.savedMinor).toBe(14_100_000n);
 });
 it('offers account-only mode when a held asset has no price',async()=>{
  const toggle=vi.fn();
  const {screen}=await renderApp(<GoalAssetNotices goals={[DP_RUMAH]} assets={goalAssetOptions([{...SPY,quote:null}])} accountsOnly={false} currency="IDR" locale="id" onAccountsOnly={toggle} onRetry={vi.fn()}/>);
  await screen.getByRole('button',{name:'Lihat saldo rekening saja'}).click();
  expect(toggle).toHaveBeenCalledWith(true);
 });
});
