// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { LOCALES, type Locale } from '@wf/i18n/locale';
import { useNavigate } from '@tanstack/react-router';
import { KbdHint, type KbdKey } from '@wf/ui/kbd-hint';
import { Check, ChevronsUpDown, LogOut, Settings, User } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { THEMES, type Theme } from '../lib/preferences.ts';
import type { Viewer } from '../server/gate.ts';
import { usePreferences } from './preferences.tsx';
import { useShortcuts } from './shortcuts.tsx';

const THEME_LABEL: Readonly<Record<Theme, () => string>> = {
  dark: m.theme_dark,
  light: m.theme_light,
  system: m.theme_system,
};

const LOCALE_LABEL: Readonly<Record<Locale, () => string>> = {
  id: m.language_name_id,
  en: m.language_name_en,
};

const ITEM =
  'flex h-8 cursor-default items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-text-secondary outline-none select-none data-[highlighted]:bg-muted data-[highlighted]:text-fg';
const GROUP_LABEL = 'px-2 pt-1.5 pb-1 text-[11px] font-medium text-subtle uppercase';

// Loaded on first use: it calls server functions, which the shell does not need until then.
const SignOutDialog = lazy(() => import('./sign-out-dialog.tsx').then((module) => ({ default: module.SignOutDialog })));

const SETTINGS_KEYS: readonly KbdKey[] = ['mod', ','];

type Person = Pick<Viewer, 'name' | 'email'>;

/** `AK` for "Avtara K."; the email's first letter when the name is empty. */
export function initials({ name, email }: Person): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('');
  return (letters === '' ? email.charAt(0) : letters).toUpperCase();
}

/** Initials of the signed-in user; a person icon for the guest (no session, e.g. outside the app layout). */
function Avatar({ viewer, size }: { viewer: Person | undefined; size: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-surface-5 text-[12px] font-semibold text-fg ${size === 'sm' ? 'size-[30px]' : 'size-[34px]'}`}
    >
      {viewer === undefined ? <User className="size-4" /> : initials(viewer)}
    </span>
  );
}

function Identity({ viewer }: { viewer: Person | undefined }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-px text-left">
      <span className="truncate text-[13px] font-medium text-fg">{viewer?.name ?? m.user_guest_name()}</span>
      <span className="truncate text-[11.5px] text-subtle">{viewer?.email ?? m.user_guest_status()}</span>
    </span>
  );
}

function RadioItem({ label, onSelect, value }: { label: string; onSelect: () => void; value: string }) {
  return (
    <DropdownMenu.RadioItem value={value} onSelect={onSelect} className={ITEM}>
      <span className="flex-1">{label}</span>
      <DropdownMenu.ItemIndicator>
        <Check aria-hidden="true" className="size-3.5 text-fg" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}

/** Opens Settings › Profil & akun with `⌘ ,` while signed in. */
function SettingsShortcut({ open }: { open: () => void }) {
  useShortcuts(useMemo(() => [{ keys: SETTINGS_KEYS, run: open }], [open]));
  return null;
}

/**
 * The user menu (design `zm4dg`): who is signed in, the display preferences (theme, language, privacy mode),
 * "Pengaturan" (`⌘ ,`), and "Keluar". Without a viewer (outside the signed-in layout) it shows the guest and only
 * the preferences. Non-modal, so Radix does not inject a scroll-lock `<style>` for the menu itself.
 */
export function UserMenu({ variant, viewer }: { variant: 'sidebar' | 'rail'; viewer?: Person | undefined }) {
  const { preferences, setTheme, setLocale, setBalancesHidden } = usePreferences();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const openSettings = useCallback(() => {
    void navigate({ to: '/settings/$section', params: { section: 'profile' } });
  }, [navigate]);

  let trigger: ReactNode;
  if (variant === 'sidebar') {
    trigger = (
      <button
        type="button"
        aria-label={m.user_menu_label()}
        className="flex w-full items-center gap-2.5 rounded-[8px] p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted"
      >
        <Avatar viewer={viewer} size="sm" />
        <Identity viewer={viewer} />
        <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
      </button>
    );
  } else {
    trigger = (
      <button
        type="button"
        aria-label={m.user_menu_label()}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Avatar viewer={viewer} size="sm" />
      </button>
    );
  }

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={variant === 'sidebar' ? 'top' : 'right'}
          align={variant === 'sidebar' ? 'start' : 'end'}
          sideOffset={8}
          className="z-50 w-[264px] rounded-[10px] border border-border-strong bg-popover text-fg shadow-[0_12px_32px_var(--shadow)]"
        >
          <div className="flex items-center gap-2.5 border-b border-border p-3">
            <Avatar viewer={viewer} size="md" />
            <Identity viewer={viewer} />
          </div>
          <div className="border-b border-border p-1.5">
            <DropdownMenu.Label className={GROUP_LABEL}>{m.theme_label()}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={preferences.theme}>
              {THEMES.map((theme) => (
                <RadioItem
                  key={theme}
                  value={theme}
                  label={THEME_LABEL[theme]()}
                  onSelect={() => {
                    setTheme(theme);
                  }}
                />
              ))}
            </DropdownMenu.RadioGroup>
          </div>
          <div className="border-b border-border p-1.5">
            <DropdownMenu.Label className={GROUP_LABEL}>{m.locale_switcher_label()}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={preferences.locale}>
              {LOCALES.map((locale) => (
                <RadioItem
                  key={locale}
                  value={locale}
                  label={LOCALE_LABEL[locale]()}
                  onSelect={() => {
                    setLocale(locale);
                  }}
                />
              ))}
            </DropdownMenu.RadioGroup>
          </div>
          <div className={`${viewer === undefined ? '' : 'border-b border-border'} p-1.5`}>
            <DropdownMenu.CheckboxItem
              checked={preferences.balancesHidden}
              onCheckedChange={setBalancesHidden}
              onSelect={(event) => {
                // Keep the menu open so the switch visibly flips.
                event.preventDefault();
              }}
              className={ITEM}
            >
              <span className="flex-1">{m.privacy_hide_balances()}</span>
              <span
                aria-hidden="true"
                className={`flex h-4 w-7 items-center rounded-full p-0.5 ${preferences.balancesHidden ? 'justify-end bg-fg' : 'justify-start bg-surface-5'}`}
              >
                <span className="size-3 rounded-full bg-bg" />
              </span>
            </DropdownMenu.CheckboxItem>
          </div>
          {viewer === undefined ? null : (
            <div className="p-1.5">
              <DropdownMenu.Item onSelect={openSettings} className={ITEM}>
                <Settings aria-hidden="true" className="size-3.5" />
                <span className="flex-1">{m.user_menu_settings()}</span>
                <KbdHint keys={SETTINGS_KEYS} platform={preferences.platform} />
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => {
                  setSigningOut(true);
                }}
                className={`${ITEM} text-red-fg data-[highlighted]:text-red-fg`}
              >
                <LogOut aria-hidden="true" className="size-3.5" />
                <span className="flex-1">{m.user_menu_sign_out()}</span>
              </DropdownMenu.Item>
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
      {viewer === undefined ? null : (
        <>
          <SettingsShortcut open={openSettings} />
          {signingOut ? (
            <Suspense fallback={null}>
              <SignOutDialog open onOpenChange={setSigningOut} />
            </Suspense>
          ) : null}
        </>
      )}
    </DropdownMenu.Root>
  );
}
