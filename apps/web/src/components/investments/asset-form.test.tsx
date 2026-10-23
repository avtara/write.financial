// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView, SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AssetForm } from './asset-form.tsx';

describe('AssetForm',()=>{
 it('rejects an empty ticker and requires a price for manual valuation',async()=>{
  const portfolio=portfolioView(); const submit=vi.fn().mockResolvedValue(null);
  const {screen}=await renderApp(<AssetForm open={{asset:SPY}} platforms={portfolio.platforms} categories={portfolio.categories} locale="id" onOpenChange={vi.fn()} onSubmit={submit}/>);
  await screen.getByRole('textbox',{name:'Ticker',exact:true}).fill('');
  await screen.getByRole('button',{name:'Simpan',exact:true}).click();
  await expect.element(screen.getByText('Isi ticker, maks. 20 karakter')).toBeVisible();
  expect(submit).not.toHaveBeenCalled();
  await screen.getByRole('textbox',{name:'Ticker',exact:true}).fill('SPY');
  await screen.getByRole('textbox',{name:'Harga manual (USD)',exact:true}).fill('');
  await screen.getByRole('button',{name:'Simpan',exact:true}).click();
  await expect.element(screen.getByText('Harga manual wajib untuk sumber Manual')).toBeVisible();
  expect(submit).not.toHaveBeenCalled();
 });
});
