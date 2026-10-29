// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A subscription's decorative mark: uploaded image, licensed local catalog mark, custom icon, then initial.
 */
import type { SubscriptionView } from '@wf/db/schedules';
import { getCatalogRecord } from '@wf/domain/catalog';
import { colorProps } from '../../lib/colors.ts';
import { CATEGORY_ICONS } from '../category-icon.tsx';
import { avatarColor } from './subscriptions-model.ts';

const SIZES = {
  sm: { box: 'size-6 rounded-[6px] text-[11px]', glyph: 'size-3' },
  md: { box: 'size-8 rounded-[8px] text-[13px]', glyph: 'size-4' },
  lg: { box: 'size-10 rounded-[10px] text-[15px]', glyph: 'size-5' },
} as const;

export interface SubscriptionAvatarProps {
  readonly subscription: Pick<SubscriptionView, 'id' | 'name' | 'icon' | 'logoKey' | 'catalogId'>;
  readonly size?: keyof typeof SIZES;
}

export function SubscriptionAvatar({ subscription, size = 'md' }: SubscriptionAvatarProps) {
  const { box, glyph } = SIZES[size];
  if (subscription.logoKey !== null) {
    return (
      <img
        src={`/api/subscription-logo/${subscription.id}?v=${encodeURIComponent(subscription.logoKey.slice(-12))}`}
        alt=""
        className={`${box} shrink-0 border border-border bg-white object-contain`}
      />
    );
  }
  const mark = getCatalogRecord(subscription.catalogId)?.logoPath;
  if (mark != null) {
    return <img src={mark} alt="" className={`${box} shrink-0 border border-border bg-white object-contain p-1`} />;
  }
  const Glyph = subscription.icon === null ? undefined : CATEGORY_ICONS[subscription.icon]?.glyph;
  return (
    <span
      {...colorProps(avatarColor(subscription.id))}
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center border border-[color-mix(in_srgb,var(--wf-color)_30%,transparent)] bg-[color-mix(in_srgb,var(--wf-color)_16%,transparent)] font-semibold text-[var(--wf-color)] ${box}`}
    >
      {Glyph === undefined ? subscription.name.slice(0, 1).toUpperCase() : <Glyph className={glyph} />}
    </span>
  );
}
