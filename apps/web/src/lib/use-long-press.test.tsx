// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render.tsx';
import { LONG_PRESS_MS, useLongPress } from './use-long-press.ts';

function Probe({ onLongPress, onClick }: { readonly onLongPress: () => void; readonly onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} {...useLongPress(onLongPress)}>
      row
    </button>
  );
}

async function renderProbe() {
  const onLongPress = vi.fn();
  const onClick = vi.fn();
  const { screen } = await renderApp(<Probe onLongPress={onLongPress} onClick={onClick} />);
  // A <button>, so an HTMLElement.
  const button = screen.getByRole('button', { name: 'row' }).element() as HTMLElement;
  const pointer = (type: string, init: PointerEventInit = {}) =>
    button.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: 10, clientY: 10, ...init }),
    );
  const contextMenu = () => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { screen, button, onLongPress, onClick, pointer, contextMenu };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useLongPress', () => {
  it('fires for a resting finger and swallows the tap the lifting finger sends', async () => {
    const probe = await renderProbe();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    probe.pointer('pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(probe.onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(probe.onLongPress).toHaveBeenCalledOnce();
    probe.pointer('pointerup');
    probe.button.click();
    expect(probe.onClick).not.toHaveBeenCalled();
    // The next tap is a tap again.
    probe.button.click();
    expect(probe.onClick).toHaveBeenCalledOnce();
  });

  it('does not fire for a scroll, an early lift, a cancelled pointer, or a mouse', async () => {
    const probe = await renderProbe();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    probe.pointer('pointerdown');
    probe.pointer('pointermove', { clientX: 12, clientY: 14 });
    probe.pointer('pointermove', { clientX: 10, clientY: 40 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    probe.pointer('pointerdown');
    probe.pointer('pointerup');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    probe.pointer('pointerdown');
    probe.pointer('pointercancel');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    probe.pointer('pointerdown', { pointerType: 'mouse' });
    probe.pointer('pointermove', { pointerType: 'mouse', clientX: 50 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(probe.onLongPress).not.toHaveBeenCalled();
    probe.button.click();
    expect(probe.onClick).toHaveBeenCalledOnce();
  });

  it('answers the context menu of a held finger once, and leaves a right-click to the browser', async () => {
    const probe = await renderProbe();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Android sends `contextmenu` while the finger still rests.
    probe.pointer('pointerdown');
    expect(probe.contextMenu()).toBe(true);
    expect(probe.onLongPress).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    // …or after the timer already fired: still no browser menu, and no second press.
    expect(probe.contextMenu()).toBe(true);
    expect(probe.onLongPress).toHaveBeenCalledOnce();
    probe.button.click();
    expect(probe.onClick).not.toHaveBeenCalled();
    expect(probe.contextMenu()).toBe(false);
  });

  it('forgets a press when the element goes away', async () => {
    const probe = await renderProbe();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    probe.pointer('pointerdown');
    await probe.screen.unmount();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(probe.onLongPress).not.toHaveBeenCalled();
  });
});
