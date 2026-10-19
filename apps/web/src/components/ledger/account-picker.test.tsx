// SPDX-License-Identifier: AGPL-3.0-only
import type { AccountView } from '@wf/db/accounts';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ACCOUNTS, BCA, CARD, JAGO, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AccountPicker, AccountTrigger } from './account-picker.tsx';

function Picker({
  initial = null,
  onValueChange,
  ...props
}: {
  readonly initial?: string | null;
  readonly onValueChange?: (id: string) => void;
  readonly outflowMinor?: bigint | null;
  readonly disabledId?: string | null;
  readonly disabledReason?: string;
}) {
  const [value, setValue] = useState<string | null>(initial);
  const chosen = ACCOUNTS.find((account) => account.id === value);
  return (
    <AccountPicker
      accounts={ACCOUNTS}
      value={value}
      onValueChange={(id) => {
        onValueChange?.(id);
        setValue(id);
      }}
      label="Pilih rekening"
      searchPlaceholder="Cari rekening…"
      locale="id"
      {...props}
    >
      <AccountTrigger account={chosen} placeholder="Pilih rekening" aria-label="Rekening" />
    </AccountPicker>
  );
}

const open = async () => {
  await userEvent.click(page.getByRole('button', { name: 'Rekening' }));
  await expect.element(page.getByRole('combobox')).toHaveFocus();
};

describe('AccountPicker', () => {
  it('lists active accounts by type with their balances and picks one', async () => {
    const onValueChange = vi.fn();
    await renderApp(<Picker onValueChange={onValueChange} />);
    const trigger = page.getByRole('button', { name: 'Rekening' });
    await expect.element(trigger).toHaveTextContent('Pilih rekening');
    await open();
    for (const heading of ['Bank', 'E-Wallet', 'Investasi', 'Kartu kredit']) {
      await expect.element(page.getByText(heading, { exact: true })).toBeVisible();
    }
    expect(page.getByText('Tunai', { exact: true }).query()).toBeNull();
    expect(page.getByRole('option', { name: /Mandiri Lama/ }).query()).toBeNull();
    await expect
      .element(page.getByRole('option', { name: /BCA Tahapan/ }))
      .toHaveTextContent('BCA TahapanRp42.810.000');
    await expect.element(page.getByRole('option', { name: /Gotrade/ })).toHaveTextContent('GotradeUS$52,00');
    expect(page.getByText('saldo kurang').query()).toBeNull();

    // Searching by provider or last four digits.
    await userEvent.keyboard('9012');
    await expect.element(page.getByRole('option', { name: /BCA Visa/ })).toBeVisible();
    expect(page.getByRole('option', { name: /OVO/ }).query()).toBeNull();
    await userEvent.fill(page.getByRole('combobox'), 'jago');
    await userEvent.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith(JAGO.id);
    await expect.element(trigger).toHaveTextContent('Bank Jago');
  });

  it('marks accounts the amount would overdraw, except credit cards', async () => {
    await renderApp(<Picker initial={OVO.id} outflowMinor={100_000n} />);
    await open();
    const ovo = page.getByRole('option', { name: /OVO/ });
    await expect.element(ovo).toHaveTextContent('OVORp86.000saldo kurang');
    await expect.element(ovo).toHaveAttribute('aria-selected', 'true');
    await expect
      .element(page.getByRole('option', { name: /BCA Tahapan/ }))
      .toHaveTextContent('BCA TahapanRp42.810.000');
    await expect.element(page.getByRole('option', { name: /BCA Visa/ })).toHaveTextContent('BCA Visa−Rp1.250.000');
  });

  it('disables the account on the other side of a transfer, with the reason', async () => {
    await renderApp(<Picker disabledId={BCA.id} disabledReason="rekening asal" />);
    await open();
    const bca = page.getByRole('option', { name: /BCA Tahapan/ });
    await expect.element(bca).toHaveAttribute('aria-disabled', 'true');
    await expect.element(bca).toHaveTextContent('BCA Tahapanrekening asal');
  });

  it('shows the balance of a disabled account without a reason', async () => {
    await renderApp(<Picker disabledId={CARD.id} />);
    await open();
    const card = page.getByRole('option', { name: /BCA Visa/ });
    await expect.element(card).toHaveAttribute('aria-disabled', 'true');
    await expect.element(card).toHaveTextContent('BCA Visa−Rp1.250.000');
  });
});

describe('AccountTrigger', () => {
  it('shows the chosen account with its color', async () => {
    const account: AccountView = { ...OVO, color: 'violet' };
    const { screen } = await renderApp(<AccountTrigger account={account} placeholder="Pilih" className="mt-1" />);
    const button = screen.getByRole('button', { name: 'OVO' });
    await expect.element(button).toHaveClass('mt-1');
    expect(button.element().querySelector('[data-color="violet"]')).not.toBeNull();
  });
});
