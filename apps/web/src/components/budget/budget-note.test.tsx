// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { budgetLine, SHOPPING, TRANSPORT } from '../../../test/budget-fixtures.ts';
import { categoryView } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { BudgetImpact, budgetNotes, type BudgetLookup } from './budget-note.tsx';

const BUDGET: BudgetLookup = { lines: [TRANSPORT, SHOPPING], currency: 'IDR' };

describe('budgetNotes', () => {
  it('has no notes without a budget and none for a category without a line', () => {
    expect(budgetNotes(undefined, 0n, 'id')).toBeUndefined();
    expect(budgetNotes(BUDGET, 0n, 'id')?.(categoryView({ id: 'other' }))).toBeNull();
  });

  it('shows what is left, what the typed amount would exceed, and the overspend', async () => {
    const notes = budgetNotes(BUDGET, 500_000n, 'id');
    const quiet = budgetNotes(BUDGET, 100_000n, 'id');
    const { screen } = await renderApp(
      <ul>
        <li data-testid="left">{quiet?.(categoryView({ id: 'transport' }))}</li>
        <li data-testid="will">{notes?.(categoryView({ id: 'transport' }))}</li>
        <li data-testid="over">{notes?.(categoryView({ id: 'shopping' }))}</li>
      </ul>,
    );
    await expect.element(screen.getByTestId('left')).toHaveTextContent('sisa Rp400.000');
    await expect.element(screen.getByTestId('will')).toHaveTextContent('akan lewat Rp100.000');
    await expect.element(screen.getByTestId('over')).toHaveTextContent('lewat Rp400.000');
    expect(screen.getByTestId('over').element().querySelector('.text-red-fg')).not.toBeNull();
    expect(screen.getByTestId('will').element().querySelector('.text-amber-fg')).not.toBeNull();
  });
});

describe('BudgetImpact', () => {
  it('shows the line after the typed amount, red once it goes over', async () => {
    const { screen } = await renderApp(
      <>
        <div data-testid="ok">
          <BudgetImpact budget={BUDGET} categoryId="transport" typedMinor={60_000n} locale="id" />
        </div>
        <div data-testid="over">
          <BudgetImpact budget={BUDGET} categoryId="transport" typedMinor={500_000n} locale="id" />
        </div>
        <div data-testid="unlimited">
          <BudgetImpact
            budget={{
              lines: [budgetLine({ categoryId: 'zero', name: 'Zakat', limitMinor: 0n, spentMinor: 0n })],
              currency: 'IDR',
            }}
            categoryId="zero"
            typedMinor={1000n}
            locale="id"
          />
        </div>
      </>,
    );
    await expect
      .element(screen.getByTestId('ok'))
      .toHaveTextContent('Anggaran Transportasi jadi 83% · Rp1.660.000 / 2.000.000');
    await expect
      .element(screen.getByTestId('over'))
      .toHaveTextContent('Anggaran Transportasi jadi 105% · Rp2.100.000 / 2.000.000');
    await expect.element(screen.getByTestId('over').getByRole('paragraph')).toHaveClass('text-red-fg');
    await expect.element(screen.getByTestId('ok').getByRole('paragraph')).not.toHaveClass('text-red-fg');
    await expect.element(screen.getByTestId('unlimited')).toHaveTextContent('Anggaran Zakat jadi — · Rp1.000 / 0');
  });

  it('shows nothing without a budget, a line, or a positive amount', async () => {
    const { screen } = await renderApp(
      <div data-testid="none">
        <BudgetImpact budget={undefined} categoryId="transport" typedMinor={1000n} locale="id" />
        <BudgetImpact budget={BUDGET} categoryId={null} typedMinor={1000n} locale="id" />
        <BudgetImpact budget={BUDGET} categoryId="transport" typedMinor={null} locale="id" />
        <BudgetImpact budget={BUDGET} categoryId="transport" typedMinor={0n} locale="id" />
      </div>,
    );
    await expect.element(screen.getByTestId('none')).toBeEmptyDOMElement();
  });
});
