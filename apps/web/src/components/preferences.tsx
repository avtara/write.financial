// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/i18n/locale';
import { setLocale as setRuntimeLocale } from '@wf/i18n/runtime';
import { PrivacyProvider } from '@wf/ui/privacy';
import { createContext, use, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import {
  preferenceCookie,
  PRIVACY_COOKIE_NAME,
  privacyCookieValue,
  THEME_COOKIE_NAME,
  type Preferences,
  type Theme,
} from '../lib/preferences.ts';

/** How long `⌘ .` / "Intip saldo" shows hidden amounts (FR-S3). */
export const PEEK_SECONDS = 5;

export interface PreferencesValue {
  readonly preferences: Preferences;
  readonly setLocale: (locale: Locale) => void;
  readonly setTheme: (theme: Theme) => void;
  readonly setBalancesHidden: (hidden: boolean) => void;
  /** Seconds left while peeking at hidden amounts, `null` otherwise. */
  readonly peekSecondsLeft: number | null;
  /** Starts a peek of {@link PEEK_SECONDS} seconds, or ends the running one early. */
  readonly togglePeek: () => void;
}

/** Thrown when a component that reads preferences renders outside `<PreferencesProvider>`. */
export class MissingPreferencesProviderError extends Error {
  override name = 'MissingPreferencesProviderError';
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function writeCookie(name: string, value: string) {
  document.cookie = preferenceCookie(name, value, location.protocol === 'https:');
}

/**
 * Owns the display preferences after the first render. `initial` is what the server resolved for this
 * request; every change is applied immediately and persisted to its cookie, so the next server render
 * matches without a flash. Also provides privacy mode to `<Money>` (through `PrivacyProvider`).
 */
export function PreferencesProvider({ initial, children }: { initial: Preferences; children: ReactNode }) {
  const [preferences, setPreferences] = useState(initial);
  const [peekSecondsLeft, setPeekSecondsLeft] = useState<number | null>(null);
  const { theme, balancesHidden } = preferences;

  // `system` follows the OS setting live; the inline head script already applied it before the first paint.
  useLayoutEffect(() => {
    if (theme !== 'system') return;
    const query = matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      document.documentElement.dataset.theme = query.matches ? 'light' : 'dark';
    };
    apply();
    query.addEventListener('change', apply);
    return () => {
      query.removeEventListener('change', apply);
    };
  }, [theme]);

  useEffect(() => {
    if (peekSecondsLeft === null) return;
    const timer = setTimeout(() => {
      setPeekSecondsLeft(peekSecondsLeft > 1 ? peekSecondsLeft - 1 : null);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [peekSecondsLeft]);

  // State setters are stable, so the actions are too: shortcut bindings built on them never re-register.
  const actions = useMemo(
    () => ({
      setLocale: (locale: Locale) => {
        // Writes the `wf_locale` cookie and switches the Paraglide runtime without a reload.
        void setRuntimeLocale(locale, { reload: false });
        setPreferences((current) => ({ ...current, locale }));
      },
      setTheme: (theme: Theme) => {
        writeCookie(THEME_COOKIE_NAME, theme);
        setPreferences((current) => ({ ...current, theme }));
      },
      setBalancesHidden: (hidden: boolean) => {
        writeCookie(PRIVACY_COOKIE_NAME, privacyCookieValue(hidden));
        setPeekSecondsLeft(null);
        setPreferences((current) => ({ ...current, balancesHidden: hidden }));
      },
      togglePeek: () => {
        setPeekSecondsLeft((left) => (left === null ? PEEK_SECONDS : null));
      },
    }),
    [],
  );
  const value = useMemo<PreferencesValue>(
    () => ({ preferences, peekSecondsLeft, ...actions }),
    [preferences, peekSecondsLeft, actions],
  );

  return (
    <PreferencesContext value={value}>
      <PrivacyProvider
        hidden={balancesHidden && peekSecondsLeft === null}
        onHiddenChange={actions.setBalancesHidden}
        hiddenLabel={m.privacy_hidden_amount()}
      >
        {children}
      </PrivacyProvider>
    </PreferencesContext>
  );
}

export function usePreferences(): PreferencesValue {
  const value = use(PreferencesContext);
  if (value === null) {
    throw new MissingPreferencesProviderError('usePreferences() needs a <PreferencesProvider> above it');
  }
  return value;
}
