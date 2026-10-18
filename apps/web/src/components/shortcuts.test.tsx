// SPDX-License-Identifier: AGPL-3.0-only
import type { Platform } from '@wf/ui/kbd-hint';
import { Component, useMemo, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import {
  MissingShortcutProviderError,
  SEQUENCE_TIMEOUT_MS,
  ShortcutProvider,
  useShortcuts,
  type ShortcutBinding,
} from './shortcuts.tsx';

function Bindings({ bindings }: { bindings: readonly ShortcutBinding[] }) {
  useShortcuts(bindings);
  return <input aria-label="field" />;
}

/** Mounts the bindings until "unmount" is clicked. */
function Harness({ bindings }: { bindings: readonly ShortcutBinding[] }) {
  const [mounted, setMounted] = useState(true);
  const stable = useMemo(() => bindings, [bindings]);
  return (
    <>
      {mounted ? <Bindings bindings={stable} /> : null}
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        unmount
      </button>
    </>
  );
}

async function setup(platform: Platform = 'mac') {
  const peek = vi.fn<() => void>();
  const overview = vi.fn<() => void>();
  const bindings: ShortcutBinding[] = [
    { keys: ['mod', '.'], run: peek },
    { keys: ['G', 'R'], run: overview },
  ];
  const screen = await render(
    <ShortcutProvider platform={platform}>
      <Harness bindings={bindings} />
    </ShortcutProvider>,
  );
  return { screen, peek, overview };
}

/** Dispatches a keydown with flags `userEvent` cannot produce (repeat, IME composition). */
function keydown(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('ShortcutProvider', () => {
  // The sequence window is measured with `performance.now()`. Frozen here, so real keystrokes count as
  // instantaneous however slowly the browser delivers them under load, and pauses are advanced explicitly.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires a ⌘ chord on Apple platforms and swallows the browser default', async () => {
    const { peek } = await setup('mac');
    expect(keydown('.', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(peek).not.toHaveBeenCalled();
    expect(keydown('.', { metaKey: true }).defaultPrevented).toBe(true);
    expect(peek).toHaveBeenCalledOnce();
  });

  it('fires a Ctrl chord elsewhere, but not with extra modifiers or held-down repeats', async () => {
    const { peek } = await setup('other');
    keydown('.', { metaKey: true });
    keydown('.', { ctrlKey: true, shiftKey: true });
    keydown('.', { ctrlKey: true, altKey: true });
    keydown('.', { ctrlKey: true, repeat: true });
    expect(peek).not.toHaveBeenCalled();
    keydown('.', { ctrlKey: true });
    expect(peek).toHaveBeenCalledOnce();
  });

  it('fires a sequence typed with real keys, case-insensitively', async () => {
    const { overview } = await setup();
    await userEvent.keyboard('gr');
    expect(overview).toHaveBeenCalledOnce();
    await userEvent.keyboard('G');
    await userEvent.keyboard('R');
    expect(overview).toHaveBeenCalledTimes(2);
  });

  it('needs the keys of a sequence in order', async () => {
    const { overview } = await setup();
    await userEvent.keyboard('rg');
    expect(overview).not.toHaveBeenCalled();
  });

  it('accepts a pause of up to the timeout between the keys of a sequence', async () => {
    const { overview } = await setup();
    keydown('g');
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS);
    keydown('r');
    expect(overview).toHaveBeenCalledOnce();
  });

  it('forgets a pending sequence after the timeout', async () => {
    const { overview } = await setup();
    keydown('g');
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS + 1);
    keydown('r');
    expect(overview).not.toHaveBeenCalled();
  });

  it('ignores sequences while typing in a field and after a modifier', async () => {
    const { screen, overview, peek } = await setup();
    await userEvent.click(screen.getByRole('textbox', { name: 'field' }));
    await userEvent.keyboard('gr');
    expect(overview).not.toHaveBeenCalled();
    // Chords still work inside fields.
    await userEvent.keyboard('{Meta>}.{/Meta}');
    expect(peek).toHaveBeenCalledOnce();

    keydown('g');
    keydown('x', { ctrlKey: true });
    keydown('r');
    expect(overview).not.toHaveBeenCalled();
  });

  it('ignores keys composed by an input method', async () => {
    const { overview } = await setup();
    keydown('g', { isComposing: true });
    keydown('r', { isComposing: true });
    expect(overview).not.toHaveBeenCalled();
  });

  it('stops firing once the registering component unmounts', async () => {
    const { screen, overview } = await setup();
    await userEvent.click(screen.getByRole('button', { name: 'unmount' }));
    await userEvent.keyboard('gr');
    expect(overview).not.toHaveBeenCalled();
  });
});

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error === null ? this.props.children : <output>{this.state.error.name}</output>;
  }
}

describe('useShortcuts', () => {
  it('refuses to run outside the provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const screen = await render(
      <Boundary>
        <Bindings bindings={[]} />
      </Boundary>,
    );
    await expect.element(screen.getByText(new MissingShortcutProviderError().name)).toBeVisible();
  });
});
