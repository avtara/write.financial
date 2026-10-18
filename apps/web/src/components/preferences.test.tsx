// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { getLocale } from '@wf/i18n/runtime';
import { usePrivacy } from '@wf/ui/privacy';
import { Component, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { DEFAULT_PREFERENCES, flushReact } from '../../test/render.tsx';
import { parseCookies, type Preferences } from '../lib/preferences.ts';
import { MissingPreferencesProviderError, PEEK_SECONDS, PreferencesProvider, usePreferences } from './preferences.tsx';

function Probe() {
  const { preferences, setLocale, setTheme, setBalancesHidden, peekSecondsLeft, togglePeek } = usePreferences();
  const privacy = usePrivacy();
  return (
    <>
      <output data-testid="state">
        {JSON.stringify({ ...preferences, peekSecondsLeft, privacyHidden: privacy.hidden })}
      </output>
      <output data-testid="label">{privacy.hiddenLabel}</output>
      <button
        type="button"
        onClick={() => {
          setLocale('en');
        }}
      >
        en
      </button>
      <button
        type="button"
        onClick={() => {
          setTheme('light');
        }}
      >
        light
      </button>
      <button
        type="button"
        onClick={() => {
          setTheme('system');
        }}
      >
        system
      </button>
      <button
        type="button"
        onClick={() => {
          setBalancesHidden(true);
        }}
      >
        hide
      </button>
      <button
        type="button"
        onClick={() => {
          privacy.setHidden(false);
        }}
      >
        show
      </button>
      <button type="button" onClick={togglePeek}>
        peek
      </button>
    </>
  );
}

async function renderProbe(initial: Partial<Preferences> = {}) {
  const screen = await render(
    <PreferencesProvider initial={{ ...DEFAULT_PREFERENCES, ...initial }}>
      <Probe />
    </PreferencesProvider>,
  );
  const state = () =>
    JSON.parse(screen.getByTestId('state').element().textContent) as Preferences & {
      peekSecondsLeft: number | null;
      privacyHidden: boolean;
    };
  return { screen, state };
}

const cookies = () => parseCookies(document.cookie);

beforeEach(() => {
  for (const name of cookies().keys()) document.cookie = `${name}=; Max-Age=0; Path=/`;
});

afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
});

describe('PreferencesProvider', () => {
  it('starts from the server-resolved preferences and provides privacy mode with its label', async () => {
    const { screen, state } = await renderProbe({ balancesHidden: true, platform: 'other' });
    expect(state()).toEqual({
      ...DEFAULT_PREFERENCES,
      balancesHidden: true,
      platform: 'other',
      peekSecondsLeft: null,
      privacyHidden: true,
    });
    await expect.element(screen.getByTestId('label')).toHaveTextContent(m.privacy_hidden_amount());
  });

  it('switches the locale in the Paraglide runtime and its cookie without a reload', async () => {
    const { screen, state } = await renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'en' }));
    expect(state().locale).toBe('en');
    expect(getLocale()).toBe('en');
    expect(cookies().get('wf_locale')).toBe('en');
  });

  it('persists theme and privacy mode in cookies', async () => {
    const { screen, state } = await renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'light' }));
    await userEvent.click(screen.getByRole('button', { name: 'hide' }));
    expect(state()).toMatchObject({ theme: 'light', balancesHidden: true, privacyHidden: true });
    expect(cookies().get('wf_theme')).toBe('light');
    expect(cookies().get('wf_privacy')).toBe('hidden');
    // `<Money>` consumers turn privacy mode off through the same preference.
    await userEvent.click(screen.getByRole('button', { name: 'show' }));
    expect(state()).toMatchObject({ balancesHidden: false, privacyHidden: false });
    expect(cookies().get('wf_privacy')).toBe('visible');
  });

  it('peeks for five seconds, counting down, and can end a peek early', async () => {
    const { screen, state } = await renderProbe({ balancesHidden: true });
    vi.useFakeTimers();
    await userEvent.click(screen.getByRole('button', { name: 'peek' }));
    expect(state()).toMatchObject({ peekSecondsLeft: PEEK_SECONDS, privacyHidden: false });
    await vi.advanceTimersByTimeAsync(1000);
    await flushReact();
    expect(state().peekSecondsLeft).toBe(PEEK_SECONDS - 1);
    for (let second = 1; second < PEEK_SECONDS; second++) {
      await vi.advanceTimersByTimeAsync(1000);
      await flushReact();
    }
    expect(state()).toMatchObject({ peekSecondsLeft: null, privacyHidden: true });

    await userEvent.click(screen.getByRole('button', { name: 'peek' }));
    await userEvent.click(screen.getByRole('button', { name: 'peek' }));
    expect(state()).toMatchObject({ peekSecondsLeft: null, privacyHidden: true });
  });

  it('ends a peek when privacy mode changes', async () => {
    const { screen, state } = await renderProbe({ balancesHidden: true });
    await userEvent.click(screen.getByRole('button', { name: 'peek' }));
    await userEvent.click(screen.getByRole('button', { name: 'hide' }));
    expect(state().peekSecondsLeft).toBeNull();
  });

  it('follows the OS color scheme live while the theme is system', async () => {
    const query = Object.assign(new EventTarget(), { matches: true });
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
    const prefersLight = (light: boolean) => {
      query.matches = light;
      query.dispatchEvent(new Event('change'));
    };
    const { screen } = await renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'system' }));
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: light)');
    expect(document.documentElement.dataset.theme).toBe('light');
    prefersLight(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
    // Leaving `system` stops following the OS.
    await userEvent.click(screen.getByRole('button', { name: 'light' }));
    prefersLight(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
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

describe('usePreferences', () => {
  it('refuses to run outside the provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const screen = await render(
      <Boundary>
        <Probe />
      </Boundary>,
    );
    await expect.element(screen.getByText(new MissingPreferencesProviderError().name)).toBeVisible();
  });
});
