// SPDX-License-Identifier: AGPL-3.0-only
import { HeadContent, Scripts, ScriptOnce } from '@tanstack/react-router';
import { Fragment, type ReactNode } from 'react';
import { usePreferences } from './preferences.tsx';
import { ShortcutProvider } from './shortcuts.tsx';

/**
 * Applies the OS color scheme before the first paint when the theme is `system` (the server cannot know
 * it). Inline, so it runs before the stylesheet paints; it carries the request's CSP nonce.
 */
export const SYSTEM_THEME_SCRIPT =
  "if(matchMedia('(prefers-color-scheme: light)').matches)document.documentElement.dataset.theme='light'";

/**
 * The HTML document. `lang` and `data-theme` come from the preferences, so the server renders the right
 * language and theme without a flash (dark is the `:root` default in `tokens.css`). Changing the locale
 * remounts the page under the new key, so every message function renders again in the new language.
 */
export function Document({ children }: { children: ReactNode }) {
  const { preferences } = usePreferences();
  const { locale, theme, platform } = preferences;
  return (
    // The `system` theme script sets `data-theme` before hydration; React must not report that as a mismatch.
    <html lang={locale} data-theme={theme === 'system' ? undefined : theme} suppressHydrationWarning>
      <head>
        <HeadContent />
        {theme === 'system' ? <ScriptOnce>{SYSTEM_THEME_SCRIPT}</ScriptOnce> : null}
      </head>
      <body>
        <ShortcutProvider platform={platform}>
          <Fragment key={locale}>{children}</Fragment>
        </ShortcutProvider>
        <Scripts />
      </body>
    </html>
  );
}
