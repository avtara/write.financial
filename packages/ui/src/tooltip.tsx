// SPDX-License-Identifier: AGPL-3.0-only
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

export interface TooltipProps {
  /** The tooltip body. Strings keep their line breaks (`\n`), so multi-line hints need no markup (FR-S6). */
  content: ReactNode;
  /** A bold first line, e.g. the label of a chart point; amounts go through `<Money>`. */
  heading?: ReactNode;
  /** A quiet last line under a divider, e.g. "Klik untuk rincian". */
  hint?: ReactNode;
  /** The element that shows the tooltip on hover and keyboard focus; it must accept a ref and props. */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Delay before showing on hover, in ms. Default 300; focus shows it at once. */
  delayDuration?: number;
}

/**
 * Tooltip (design "Tooltip": `$popover` fill, `$border-strong` stroke, r8) on Radix Tooltip: it shows on hover and
 * on keyboard focus, hides on Escape, and is linked to its trigger with `aria-describedby`. Tooltips only describe:
 * anything the user must act on belongs in a popover. Each tooltip brings its own provider.
 */
export function Tooltip({
  content,
  heading,
  hint,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 300,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={8}
            collisionPadding={8}
            className="z-50 flex max-w-[280px] flex-col rounded-[8px] border border-border-strong bg-popover text-fg shadow-[0_12px_32px_var(--shadow)]"
          >
            {heading === undefined ? null : (
              <div className="border-b border-border px-3 py-2 text-[13px] font-semibold">{heading}</div>
            )}
            <div
              className={`text-[12px] whitespace-pre-line text-fg ${heading === undefined && hint === undefined ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
            >
              {content}
            </div>
            {hint === undefined ? null : (
              <div className="border-t border-border px-3 py-2 text-[11px] text-subtle">{hint}</div>
            )}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
