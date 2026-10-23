// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { portfolioView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { DividendsCard, PlatformsCard } from './income-cards.tsx';

describe('investment income and platforms',()=>{
 it('reports zero recorded dividends rather than design-only yield, and includes platform cash',async()=>{
  const portfolio=portfolioView();
  const {screen}=await renderApp(<><DividendsCard portfolio={portfolio} locale="id"/><PlatformsCard portfolio={portfolio} locale="id"/></>);
  await expect.element(screen.getByRole('region',{name:/Dividen/})).toHaveTextContent('Rp0');
  await expect.element(screen.getByRole('region',{name:'Platform'})).toHaveTextContent('Rp45.420.000');
 });
});
