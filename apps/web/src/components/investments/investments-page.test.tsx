// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { investmentsOverview, portfolioView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { InvestmentsPage } from './investments-page.tsx';

describe('InvestmentsPage',()=>{
 it('converts displayed portfolio values without changing the holdings',async()=>{
  const {screen}=await renderApp(<InvestmentsPage overview={investmentsOverview()} accounts={[]} timeZone="Asia/Jakarta"/>);
  const kpis=screen.getByRole('region',{name:'Ringkasan investasi'});
  await expect.element(kpis).toHaveTextContent('Nilai portofolioRp61.420.000');
  await screen.getByRole('button',{name:'USD',exact:true}).click();
  await expect.element(kpis).toHaveTextContent('Nilai portofolioUS$3.756,57');
  await screen.getByRole('button',{name:'IDR',exact:true}).click();
  await expect.element(kpis).toHaveTextContent('Nilai portofolioRp61.420.000');
 });
 it('explains that a platform is required rather than offering an unusable asset form',async()=>{
  const {screen}=await renderApp(<InvestmentsPage overview={investmentsOverview({portfolio:portfolioView({assets:[],platforms:[]})})} accounts={[]} timeZone="Asia/Jakarta"/>);
  await expect.element(screen.getByRole('button',{name:'Tambah aset',exact:true})).toBeDisabled();
  await expect.element(screen.getByText('Belum ada portofolio')).toBeVisible();
 });
});
