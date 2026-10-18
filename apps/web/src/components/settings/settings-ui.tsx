// SPDX-License-Identifier: AGPL-3.0-only
/** Settings building blocks (design `bcBrM`/`kKAEZ`): an uppercase group label, a sunken card, and its rows. */
import type { ReactNode } from 'react';

export function SettingsGroup({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <div className="flex min-h-[26px] items-center justify-between gap-3">
        <h3 className="text-[11px] font-medium text-subtle uppercase">{label}</h3>
        {action}
      </div>
      <div className="flex flex-col divide-y divide-border rounded-[10px] border border-border bg-surface-sunken">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The control or button on the right. */
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-3.5 py-[11px]">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-[13px] font-medium text-fg">{title}</div>
        {description === undefined ? null : <div className="text-[12px] text-subtle">{description}</div>}
      </div>
      {children}
    </div>
  );
}

/** "Aktif", "Perangkat ini". */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-green-tint-2 px-2 text-[11px] font-medium text-green-fg">
      {children}
    </span>
  );
}
