// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { TargetsDialog, percentToBps } from './targets-dialog.tsx';

describe('allocation targets',()=>{
 it.each([['0',0],['12,34',1234],['100',10000],['100.01',null],['1.001',null],['-1',null],['',null]])('parses %s as %s basis points',(text,expected)=>{expect(percentToBps(text as string)).toBe(expected);});
 it('blocks a 101% total and offers an exact repair before saving',async()=>{
  const save=vi.fn().mockResolvedValue(null);
  const {screen}=await renderApp(<TargetsDialog open portfolio={portfolioView()} locale="id" onOpenChange={vi.fn()} onSubmit={save}/>);
  await screen.getByRole('textbox',{name:'Target Kripto',exact:true}).fill('8');
  await expect.element(screen.getByRole('button',{name:'Simpan target'})).toBeDisabled();
  await expect.element(screen.getByRole('alert')).toHaveTextContent('Total target lebih 1,0%');
  await screen.getByRole('button',{name:'Ambil 1,0% dari Saham AS'}).click();
  await screen.getByRole('button',{name:'Simpan target'}).click();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({us_stocks:4900,crypto:800}));
 });
});
