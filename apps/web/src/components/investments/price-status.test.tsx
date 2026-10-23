// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { manualQuote, SPY, BTC, TODAY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { PriceFallback, PriceStatusPill } from './price-status.tsx';
import { quoteStatus } from './investments-model.ts';

describe('price fallbacks',()=>{
 it('retains timestamped stale quotes and distinguishes valuation at cost',async()=>{
  const status=quoteStatus([{...SPY,quote:null},{...BTC,quote:manualQuote('1',{stale:true,source:'last',label:'last'})}]);
  const retry=vi.fn();
  const {screen}=await renderApp(<><PriceStatusPill status={status} today={TODAY} timeZone="Asia/Jakarta" locale="id"/><PriceFallback status={status} today={TODAY} timeZone="Asia/Jakarta" locale="id" retrying={false} onRetry={retry}/></>);
  await expect.element(screen.getByRole('status')).toHaveTextContent('SPY belum punya harga, dinilai dengan harga modal.');
  await expect.element(screen.getByRole('status')).toHaveTextContent('BTC memakai harga terakhir');
  await screen.getByRole('button',{name:'Coba lagi'}).click();
  expect(retry).toHaveBeenCalledOnce();
 });
});
