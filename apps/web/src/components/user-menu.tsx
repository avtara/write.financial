// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { LOCALES, type Locale } from '@wf/i18n/locale';
import { Check, ChevronsUpDown, User } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { THEMES, type Theme } from '../lib/preferences.ts';
import { usePreferences } from './preferences.tsx';

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

/** Placeholder avatar until accounts exist: there is no name to take initials from. */
function GuestAvatar({ size }: { size: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-surface-5 text-fg ${size === 'sm' ? 'size-[30px]' : 'size-[34px]'}`}
    >
      <User aria-hidden="true" className="size-4" />
    </span>
  );
}

function GuestIdentity() {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-px text-left">
      <span className="truncate text-[13px] font-medium text-fg">{m.user_guest_name()}</span>
      <span className="truncate text-[11.5px] text-subtle">{m.user_guest_status()}</span>
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

/**
 * The user menu (design `rnnqa`) in its signed-out state: who is using the app, plus the display
 * preferences that work without an account (theme, language, privacy mode). Sign-in, settings, and sign-out
 * join it with authentication. Non-modal, so Radix does not inject a scroll-lock `<style>` the CSP would block.
 */
export function UserMenu({ variant }: { variant: 'sidebar' | 'rail' }) {
  const { preferences, setTheme, setLocale, setBalancesHidden } = usePreferences();

  let trigger: ReactNode;
  if (variant === 'sidebar') {
    trigger = (
      <button
        type="button"
        aria-label={m.user_menu_label()}
        className="flex w-full items-center gap-2.5 rounded-[8px] p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted"
      >
        <GuestAvatar size="sm" />
        <GuestIdentity />
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
        <GuestAvatar size="sm" />
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
            <GuestAvatar size="md" />
            <GuestIdentity />
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
          <div className="p-1.5">
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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
