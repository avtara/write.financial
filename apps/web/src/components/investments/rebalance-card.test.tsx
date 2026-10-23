// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { RebalanceCard } from './rebalance-card.tsx';

describe('RebalanceCard',()=>{
 it('recomputes suggestions when fresh money is entered, without a trade action',async()=>{
  const {screen}=await renderApp(<RebalanceCard portfolio={portfolioView()} rates={{USD:'16350'}} locale="id" onEditTargets={vi.fn()} />);
  const card=screen.getByRole('region',{name:'Kalkulator rebalancing'});
  await screen.getByRole('textbox',{name:'Dana tambahan'}).fill('100.000.000');
  await expect.element(card).toHaveTextContent('Beli Rp100.000.000 · jual Rp0');
 });
});
