// SPDX-License-Identifier: AGPL-3.0-only
import type { AssetView } from '@wf/db/investments';
import { getCatalogRecord } from '@wf/domain/catalog';

/** Decorative: a missing licensed mark deliberately uses the ticker rather than an invented brand logo. */
export function AssetLogo({ asset }: { readonly asset: Pick<AssetView, 'symbol' | 'catalogId'> }) {
  const mark = getCatalogRecord(asset.catalogId)?.logoPath;
  return mark == null ? (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 font-mono text-[9.5px] text-muted-fg"
    >
      {asset.symbol.slice(0, 5)}
    </span>
  ) : (
    <img src={mark} alt="" className="size-8 shrink-0 rounded-[8px] border border-border bg-white object-contain p-1" />
  );
}
