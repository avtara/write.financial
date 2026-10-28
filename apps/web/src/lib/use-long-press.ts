// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Long-press for touch (FR-TB4): what a mouse finds on hover, a finger finds by holding. Only touch pointers start
 * the timer; moving the finger (a scroll) cancels it. Android also fires `contextmenu` for a held finger, so that
 * opens the same thing instead of the browser's menu, and the click the browser sends when the finger lifts is
 * swallowed so the press does not also count as a tap.
 */
import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/** How long a finger must rest before the press counts (ms). */
export const LONG_PRESS_MS = 500;
/** How far it may drift and still count as resting (px). */
const SLOP_PX = 10;

export interface LongPressHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
  readonly onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  readonly onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ readonly x: number; readonly y: number } | null>(null);
  /** The press fired: the next click (and a late `contextmenu`) belongs to it. */
  const fired = useRef(false);

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };
  useEffect(() => cancel, []);

  const fire = () => {
    cancel();
    fired.current = true;
    onLongPress();
  };

  return {
    onPointerDown: (event) => {
      if (event.pointerType !== 'touch') return;
      cancel();
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(fire, LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      if (start.current === null) return;
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event) => {
      // Only a held finger: a right-click keeps the browser's own menu.
      if (start.current === null && !fired.current) return;
      event.preventDefault();
      if (!fired.current) fire();
    },
    onClickCapture: (event) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
