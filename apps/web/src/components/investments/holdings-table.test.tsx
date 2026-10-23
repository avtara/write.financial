// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { HoldingsTable } from './holdings-table.tsx';

describe('HoldingsTable',()=>{
 it('filters categories as well as tickers and recovers from no matches',async()=>{
  const {screen}=await renderApp(<HoldingsTable portfolio={portfolioView()} display="base" usdRate="16350" locale="id" onAction={vi.fn()} onTopUp={vi.fn()} onAddAsset={vi.fn()}/>);
  const search=screen.getByRole('searchbox',{name:'Cari ticker atau nama'});
  await search.fill('yield');
  await expect.element(screen.getByText('YieldMax',{exact:true})).toBeVisible();
  await search.fill('no-such-position');
  await expect.element(screen.getByText('Tidak ada aset untuk “no-such-position”.')).toBeVisible();
  await search.fill('SPY');
  await expect.element(screen.getByText('SPDR S&P 500 ETF',{exact:true})).toBeVisible();
 });
});
