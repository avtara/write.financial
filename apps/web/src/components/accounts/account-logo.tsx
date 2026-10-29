// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An account's decorative logo tile: uploaded image, then licensed local catalog mark, then the account type icon.
 */
import type { AccountView } from '@wf/db/accounts';
import { getCatalogRecord } from '@wf/domain/catalog';
import type { AccountType } from '@wf/domain/ledger';
import { Banknote, CreditCard, Landmark, Smartphone, TrendingUp, type LucideIcon } from 'lucide-react';
import { colorProps } from '../../lib/colors.ts';

export const ACCOUNT_TYPE_ICONS: Readonly<Record<AccountType, LucideIcon>> = {
  bank: Landmark,
  ewallet: Smartphone,
  cash: Banknote,
  investment: TrendingUp,
  credit_card: CreditCard,
};

const SIZES = {
  sm: { tile: 'size-[22px] rounded-[6px]', glyph: 'size-3' },
  md: { tile: 'size-[34px] rounded-[8px]', glyph: 'size-4' },
  lg: { tile: 'size-11 rounded-[11px]', glyph: 'size-5' },
} as const;

export interface AccountLogoProps {
  readonly account: Pick<AccountView, 'id' | 'type' | 'color' | 'logoKey' | 'catalogId'>;
  readonly size?: keyof typeof SIZES;
}

/** Decorative: the account name is always shown next to it. */
export function AccountLogo({ account, size = 'md' }: AccountLogoProps) {
  const { tile, glyph } = SIZES[size];
  if (account.logoKey !== null) {
    return (
      <img
        src={`/api/account-logo/${account.id}?v=${encodeURIComponent(account.logoKey.slice(-12))}`}
        alt=""
        className={`shrink-0 border border-border bg-white object-contain ${tile}`}
      />
    );
  }
  const mark = getCatalogRecord(account.catalogId)?.logoPath;
  if (mark != null) {
    return <img src={mark} alt="" className={`shrink-0 border border-border bg-white object-contain p-1 ${tile}`} />;
  }
  const Glyph = ACCOUNT_TYPE_ICONS[account.type];
  return (
    <span
      {...colorProps(account.color)}
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--wf-color,var(--subtle))_16%,transparent)] text-[var(--wf-color,var(--subtle))] ${tile}`}
    >
      <Glyph className={glyph} />
    </span>
  );
}
