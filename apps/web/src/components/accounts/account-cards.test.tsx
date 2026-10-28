// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { accountView } from '../../../test/accounts.ts';
import { renderApp } from '../../../test/render.tsx';
import { AccountCards } from './account-cards.tsx';

describe('AccountCards', () => {
  it('shows the card accounts and merges the others into "N lainnya"', async () => {
    const bca = accountView({ displayName: 'BCA Tahapan', showAsCard: true, balanceMinor: 42_810_000n });
    const gopay = accountView({
      displayName: 'GoPay',
      type: 'ewallet',
      last4: null,
      phoneMasked: '0812•• 18',
      showAsCard: true,
    });
    const cash = accountView({ displayName: 'Dompet', type: 'cash', last4: null, balanceBaseMinor: 350_000n });
    const ovo = accountView({ displayName: 'OVO', type: 'ewallet', last4: null, balanceBaseMinor: null });
    const onSelect = vi.fn();
    const onShowOthers = vi.fn();
    const { screen } = await renderApp(
      <AccountCards
        accounts={[bca, gopay, cash, ovo, accountView({ type: 'investment' })]}
        baseCurrency="IDR"
        selectedId={bca.id}
        onSelect={onSelect}
        onShowOthers={onShowOthers}
      />,
    );
    const list = screen.getByRole('list', { name: 'Kartu rekening' });
    await expect.element(list.getByRole('button', { name: /BCA Tahapan/ })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(list.getByText('Rp42.810.000')).toBeVisible();
    await expect.element(list.getByText('0812•• 18')).toBeVisible();
    await userEvent.click(list.getByRole('button', { name: /GoPay/ }));
    expect(onSelect).toHaveBeenCalledWith(gopay);
    await expect.element(list.getByText('2 lainnya')).toBeVisible();
    await expect.element(list.getByText('Dompet · OVO')).toBeVisible();
    await expect.element(list.getByText('Rp350.000')).toBeVisible();
    const others = list.getByRole('button', { name: /2 lainnya/ });
    await userEvent.click(others);
    // With its card, so a list can open right under it.
    expect(onShowOthers).toHaveBeenCalledWith(others.element());
  });

  it('adds "≈ Rp…" under a balance in another currency when a rate is known', async () => {
    const wise = accountView({
      id: 'wise',
      displayName: 'Wise USD',
      currency: 'USD',
      showAsCard: true,
      balanceMinor: 12_000n,
      balanceBaseMinor: 1_962_000n,
    });
    const unknown = accountView({
      id: 'sgd',
      displayName: 'DBS SGD',
      currency: 'SGD',
      showAsCard: true,
      balanceBaseMinor: null,
    });
    const bca = accountView({ id: 'bca', displayName: 'BCA', showAsCard: true });
    const { screen } = await renderApp(
      <AccountCards accounts={[wise, unknown, bca]} baseCurrency="IDR" onSelect={vi.fn()} onShowOthers={vi.fn()} />,
    );
    await expect
      .element(screen.getByRole('button', { name: /Wise USD/ }))
      .toMatchTextContent(/US\$120,00≈ Rp1\.962\.000/);
    expect(screen.getByRole('button', { name: /DBS SGD/ }).element().textContent).not.toContain('≈');
    expect(screen.getByRole('button', { name: /BCA/ }).element().textContent).not.toContain('≈');
  });

  it('shows nothing without everyday accounts, and no "lainnya" card when all are cards', async () => {
    const { screen } = await renderApp(
      <AccountCards
        accounts={[accountView({ type: 'investment' })]}
        baseCurrency="IDR"
        selectedId={null}
        onSelect={vi.fn()}
        onShowOthers={vi.fn()}
      />,
    );
    expect(screen.container.querySelector('ul')).toBeNull();
    await screen.unmount();
    const again = await renderApp(
      <AccountCards
        accounts={[accountView({ showAsCard: true, type: 'cash', last4: null })]}
        baseCurrency="IDR"
        selectedId={null}
        onSelect={vi.fn()}
        onShowOthers={vi.fn()}
      />,
    );
    expect(again.screen.getByRole('listitem').elements()).toHaveLength(1);
  });

  it('adds a footer under each card and leaves out "pressed" where cards only navigate', async () => {
    const { screen } = await renderApp(
      <AccountCards
        accounts={[
          accountView({ id: 'card', displayName: 'Kartu', showAsCard: true }),
          accountView({ id: 'other', displayName: 'Lain', showAsCard: false }),
        ]}
        baseCurrency="IDR"
        onSelect={vi.fn()}
        onShowOthers={vi.fn()}
        footer={(accounts) => <span>{accounts.map((account) => account.id).join('+')}</span>}
      />,
    );
    const card = screen.getByRole('button', { name: /Kartu/ });
    await expect.element(card).toMatchTextContent('card');
    expect(card.element().hasAttribute('aria-pressed')).toBe(false);
    await expect.element(screen.getByRole('button', { name: /1 lainnya/ })).toMatchTextContent('other');
  });
});
