// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AdjustDialog } from './asset-dialogs.tsx';

describe('AdjustDialog',()=>{
 it('carries a missing position value into the sale instead of silently discarding it',async()=>{
  const sell=vi.fn(); const submit=vi.fn();
  const {screen}=await renderApp(<AdjustDialog asset={SPY} rate="16350" base="IDR" locale="id" onOpenChange={vi.fn()} onSubmit={submit} onSell={sell}/>);
  await screen.getByRole('textbox',{name:'Di aplikasi Gotrade'}).fill('1,15');
  await screen.getByRole('radio',{name:/Catat sebagai penjualan/}).click();
  await screen.getByRole('button',{name:'Lanjut ke Catat jual'}).click();
  expect(sell).toHaveBeenCalledWith(SPY,expect.any(BigInt));
  expect(sell.mock.calls[0]?.[1]).toBeGreaterThan(0n);
  expect(submit).not.toHaveBeenCalled();
 });
});
