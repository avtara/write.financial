// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView, SPY, tradeView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AssetDetail } from './asset-detail.tsx';
const fake=vi.hoisted(()=>({trades:vi.fn()}));
vi.mock('../../server/fn/investments.ts',()=>({getAssetTrades:fake.trades}));

describe('AssetDetail',()=>{
 it('shows recorded buy history and both goal shares, not invented dividends',async()=>{
  fake.trades.mockResolvedValue({ok:true,value:[tradeView()]});
  const {screen}=await renderApp(<AssetDetail asset={SPY} portfolio={portfolioView()} timeZone="Asia/Jakarta" locale="id" onOpenChange={vi.fn()} onAction={vi.fn()}/>);
  const dialog=screen.getByRole('dialog');
  await expect.element(dialog).toHaveTextContent('DP Rumah');
  await expect.element(dialog).toHaveTextContent('Dana Pensiun');
  await expect.element(dialog).toHaveTextContent('60%');
  await expect.element(dialog).toHaveTextContent('40%');
  await expect.element(dialog).toHaveTextContent('Belum ada dividen tercatat.');
  await expect.element(dialog).toHaveTextContent('0,356');
 });
});
