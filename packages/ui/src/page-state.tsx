// SPDX-License-Identifier: AGPL-3.0-only
import { CircleAlert, Inbox, LoaderCircle, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type BlockKind = 'loading' | 'error' | 'empty' | 'offline';

/**
 * `refreshing` keeps the current data on screen and only shows a compact "Memperbarui…" line, so it takes
 * no description or action. The other kinds replace the page content.
 */
export type PageStateProps =
  { kind: 'refreshing'; title: string } | { kind: BlockKind; title: string; description?: string; action?: ReactNode };

const SPIN = 'motion-safe:animate-spin';

const BLOCK: Readonly<Record<BlockKind, { Icon: LucideIcon; icon: string; role: 'status' | 'alert' | undefined }>> = {
  loading: { Icon: LoaderCircle, icon: `${SPIN} text-muted-fg`, role: 'status' },
  error: { Icon: CircleAlert, icon: 'text-red-fg', role: 'alert' },
  empty: { Icon: Inbox, icon: 'text-subtle', role: undefined },
  offline: { Icon: WifiOff, icon: 'text-amber-fg', role: 'status' },
};

/**
 * Every data view has these states (plan §9.1). Loading, refreshing, and offline are polite live regions,
 * errors are alerts, and empty is plain content. Spinners only spin without `prefers-reduced-motion`.
 */
export function PageState(props: PageStateProps) {
  if (props.kind === 'refreshing') {
    return (
      <div role="status" className="inline-flex items-center gap-1.5 text-[12px] text-muted-fg">
        <RefreshCw aria-hidden="true" className={`size-3 ${SPIN}`} />
        {props.title}
      </div>
    );
  }
  const { Icon, icon, role } = BLOCK[props.kind];
  return (
    <div
      role={role}
      data-kind={props.kind}
      className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center"
    >
      <Icon aria-hidden="true" className={`size-6 ${icon}`} />
      <p className="text-[14px] font-medium text-fg">{props.title}</p>
      {props.description === undefined ? null : (
        <p className="max-w-[360px] text-[12.5px] text-muted-fg">{props.description}</p>
      )}
      {props.action === undefined ? null : <div className="mt-2">{props.action}</div>}
    </div>
  );
}
