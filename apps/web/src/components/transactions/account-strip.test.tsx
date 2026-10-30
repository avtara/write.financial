// SPDX-License-Identifier: AGPL-3.0-only
import type { AccountView } from '@wf/db/accounts';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ARCHIVED, BCA, CARD, GOTRADE, JAGO, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionsView } from '../../../test/transaction-fixtures.ts';
import { AccountStrip } from './account-strip.tsx';

/** BCA Tahapan and BCA Visa are cards; Bank Jago and OVO are "2 lainnya"; Gotrade (investment) is neither. */
const ACCOUNTS: readonly AccountView[] = [{ ...BCA }, CARD, JAGO, OVO, GOTRADE, ARCHIVED];
const VIEW = transactionsView([], { accounts: [{ accountId: JAGO.id, count: 7, inMinor: 0n, outMinor: 70_000n }] });

async function renderStrip(selected: string | undefined, accounts = ACCOUNTS) {
  const onSelect = vi.fn();
  const result = await renderApp(
    <AccountStrip
      accounts={accounts}
      baseCurrency="IDR"
      availableMinor={48_146_000n}
      view={VIEW}
      selected={selected}
      onSelect={onSelect}
    />,
  );
  return { ...result, onSelect, section: result.screen.getByRole('region', { name: 'Rekening & dompet' }) };
}

describe('AccountStrip', () => {
  it('shows the available balance, the cards, and a link to manage accounts', async () => {
    const { section, onSelect } = await renderStrip(undefined);
    await expect.element(section.getByText('Klik kartu untuk memfilter tabel')).toBeVisible();
    await expect.element(section.getByRole('link', { name: 'Kelola rekening' })).toHaveAttribute('href', '/accounts');
    const available = section.getByRole('button', { name: /Saldo tersedia/ });
    await expect.element(available).toHaveAttribute('aria-pressed', 'true');
    await expect.element(available).toMatchTextContent('tanpa investasi');
    await expect.element(available).toMatchTextContent('Rp48.146.000');
    await userEvent.click(available);
    expect(onSelect).toHaveBeenCalledWith(undefined);
    await userEvent.click(section.getByRole('button', { name: /BCA Visa/ }));
    expect(onSelect).toHaveBeenLastCalledWith(CARD.id);
  });

  it('filters by a card, and clears the filter when the same card is pressed again', async () => {
    const { section, onSelect } = await renderStrip(BCA.id);
    await expect
      .element(section.getByRole('button', { name: /Saldo tersedia/ }))
      .toHaveAttribute('aria-pressed', 'false');
    const card = section.getByRole('button', { name: /BCA Tahapan/ });
    await expect.element(card).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it('picks one or all of the other accounts from "N lainnya"', async () => {
    const { section, onSelect } = await renderStrip(undefined);
    await userEvent.click(section.getByRole('button', { name: /2 lainnya/ }));
    const others = page.getByRole('dialog', { name: 'Rekening lainnya' });
    const all = others.getByRole('button', { name: /Semua rekening lainnya/ });
    await expect.element(all).toHaveAttribute('aria-pressed', 'false');
    await expect.element(all).toMatchTextContent('7 transaksi');
    const jago = others.getByRole('button', { name: /Bank Jago/ });
    await expect.element(jago).toMatchTextContent('Bank · 7 transaksi');
    await expect.element(jago).toMatchTextContent('Rp5.250.000');
    await expect.element(others.getByRole('button', { name: /OVO/ })).toMatchTextContent('0 transaksi');
    await userEvent.click(all);
    expect(onSelect).toHaveBeenCalledWith(`${JAGO.id},${OVO.id}`);
    await expect.element(others).not.toBeInTheDocument();
    await userEvent.click(section.getByRole('button', { name: /2 lainnya/ }));
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: /OVO/ }));
    expect(onSelect).toHaveBeenLastCalledWith(OVO.id);
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the list right under "N lainnya", also when it is the only tile beside the balance', async () => {
    await page.viewport(1440, 900);
    // No account marked as a card: "2 lainnya" sits right after "Saldo tersedia", far from the strip's end.
    const { section } = await renderStrip(undefined, [JAGO, OVO]);
    const card = section.getByRole('button', { name: /2 lainnya/ });
    await userEvent.click(card);
    const list = page.getByRole('dialog', { name: 'Rekening lainnya' });
    await expect.element(list).toBeVisible();
    const cardBox = card.element().getBoundingClientRect();
    const listBox = list.element().getBoundingClientRect();
    expect(Math.abs(listBox.left - cardBox.left)).toBeLessThanOrEqual(1);
    expect(listBox.top).toBeGreaterThanOrEqual(cardBox.bottom);
  });

  it('adds "≈ Rp…" under another account in a foreign currency', async () => {
    const wise = { ...JAGO, id: 'acc-wise', displayName: 'Wise USD', currency: 'USD', balanceBaseMinor: 1_962_000n };
    const { section } = await renderStrip(undefined, [...ACCOUNTS, wise]);
    await userEvent.click(section.getByRole('button', { name: /3 lainnya/ }));
    const others = page.getByRole('dialog', { name: 'Rekening lainnya' });
    await expect.element(others.getByRole('button', { name: /Wise USD/ })).toMatchTextContent(/≈ Rp1\.962\.000$/);
    expect(others.getByRole('button', { name: /Bank Jago/ }).element().textContent).not.toContain('≈');
  });

  it('marks the chosen other accounts', async () => {
    const { section } = await renderStrip(`${JAGO.id},${OVO.id}`);
    await userEvent.click(section.getByRole('button', { name: /2 lainnya/ }));
    const others = page.getByRole('dialog', { name: 'Rekening lainnya' });
    await expect
      .element(others.getByRole('button', { name: /Semua rekening lainnya/ }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect.element(others.getByRole('button', { name: /OVO/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the one chosen other account', async () => {
    const { section } = await renderStrip(OVO.id);
    await userEvent.click(section.getByRole('button', { name: /2 lainnya/ }));
    const list = page.getByRole('dialog', { name: 'Rekening lainnya' });
    await expect.element(list.getByRole('button', { name: /OVO/ })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(list.getByRole('button', { name: /Bank Jago/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not mark "all" when more than the other accounts are chosen', async () => {
    const { section } = await renderStrip(`${JAGO.id},${OVO.id},${BCA.id}`);
    await userEvent.click(section.getByRole('button', { name: /2 lainnya/ }));
    await expect
      .element(page.getByRole('dialog').getByRole('button', { name: /Semua rekening lainnya/ }))
      .toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps "all" unmarked when the other accounts disappear while the list is open', async () => {
    function Harness() {
      const [accounts, setAccounts] = useState(ACCOUNTS);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setAccounts(ACCOUNTS.filter((account) => account.id !== JAGO.id && account.id !== OVO.id));
            }}
          >
            archive
          </button>
          <AccountStrip
            accounts={accounts}
            baseCurrency="IDR"
            availableMinor={0n}
            view={VIEW}
            selected={undefined}
            onSelect={vi.fn()}
          />
        </>
      );
    }
    const { screen } = await renderApp(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: /2 lainnya/ }));
    const all = page.getByRole('dialog').getByRole('button', { name: /Semua rekening lainnya/ });
    await expect.element(all).toHaveAttribute('aria-pressed', 'false');
    // A plain click (no pointer down) leaves the popover open.
    screen
      .getByRole('button', { name: 'archive' })
      .element()
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect.element(all).toMatchTextContent('0 transaksi');
    await expect.element(all).toHaveAttribute('aria-pressed', 'false');
  });
});
