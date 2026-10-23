// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AllocationCard, allocationRows } from './allocation-card.tsx';

describe('AllocationCard',()=>{
 it('uses actual holdings drift, not the inconsistent design label',async()=>{
  const {screen}=await renderApp(<AllocationCard portfolio={portfolioView()} locale="id" onEditTargets={vi.fn()} />);
  await expect.element(screen.getByRole('region',{name:'Alokasi aset'})).toHaveTextContent('3,8%');
 });
 it('shows shares without inventing targets for a new portfolio',()=>{
  const rows=allocationRows(portfolioView({targets:{}}));
  expect(rows.find(row=>row.key==='crypto')).toMatchObject({shareBps:895,targetBps:null,deviationBps:null});
 });
});
