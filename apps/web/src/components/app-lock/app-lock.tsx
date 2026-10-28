// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app lock (PRD FR-A6, D11): with a PIN on this device, the app locks after the chosen minutes without activity
 * (pointer, keys, touch, wheel, focus), checked every few seconds, when the tab becomes visible again, and on load
 * from the last activity stored with the PIN, so reopening the app after the timeout starts locked. While locked the
 * lock screen renders instead of `children`, so nothing of the app (amounts, dialogs, shortcuts) exists. The fifth
 * consecutive wrong PIN, or "Lupa PIN?", signs out to the sign-in page and removes the PIN from this device; the PIN is
 * removed only once the sign-out went through, so a failed sign-out leaves the app locked. Signing out normally keeps
 * the PIN. `useAppLock()` gives Settings › Keamanan the PIN controls.
 */
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import { writeAppLockHint } from '../../lib/app-lock-hint.ts';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { hardNavigate } from '../../lib/navigation.ts';
import type { Viewer } from '../../server/gate.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { usePreferences } from '../preferences.tsx';
import { LockScreen } from './lock-screen.tsx';
import {
  countPins,
  createPin,
  DEFAULT_LOCK_TIMEOUT,
  deletePin,
  matchesPin,
  MAX_PIN_ATTEMPTS,
  readPin,
  updatePin,
  type LockTimeout,
  type PinCheck,
  type PinRecord,
} from './pin-store.ts';

/** How often the idle time is checked. */
export const IDLE_CHECK_MS = 5_000;
/** At most one write of the last activity per this many milliseconds. */
export const ACTIVITY_WRITE_MS = 15_000;

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'focusin'] as const;

/** Controls for a PIN that is set. */
export interface PinControls {
  readonly timeoutMinutes: LockTimeout;
  /** Checks a PIN; a wrong one counts towards {@link MAX_PIN_ATTEMPTS}, and the last one signs out. */
  readonly verify: (pin: string) => Promise<PinCheck>;
  readonly change: (pin: string) => Promise<void>;
  readonly remove: () => Promise<void>;
  readonly setTimeoutMinutes: (minutes: LockTimeout) => void;
}

export interface AppLockValue {
  /** `null` while this device has no PIN for the user. */
  readonly pin: PinControls | null;
  readonly enable: (pin: string) => Promise<void>;
}

/** Thrown when `useAppLock` is used outside `<AppLockProvider>`. */
export class MissingAppLockProviderError extends Error {
  override name = 'MissingAppLockProviderError';
}

const AppLockContext = createContext<AppLockValue | null>(null);

/** `record` is `undefined` until IndexedDB answered; only a stored PIN can be locked. */
type LockState =
  | { readonly record: PinRecord | null | undefined; readonly locked: false }
  | { readonly record: PinRecord; readonly locked: true };

const ignore = () => undefined;

/** Keeps the server's hint (`wf_app_lock`) in step with whether any user has a PIN on this device. */
function syncHint() {
  countPins().then((count) => {
    writeAppLockHint(count > 0);
  }, ignore);
}

/** When the user was last active, and when that was last written to IndexedDB; event handlers only, never render. */
class ActivityClock {
  #last = 0;
  #written = 0;

  /** Activity at `now`; whether it is due to be written (nothing written within {@link ACTIVITY_WRITE_MS}). */
  touch(now: number): boolean {
    this.#last = now;
    if (now - this.#written < ACTIVITY_WRITE_MS) return false;
    this.#written = now;
    return true;
  }

  /** Activity at `now` that is already stored with the PIN. */
  stored(now: number): void {
    this.#last = now;
    this.#written = now;
  }

  idleFor(now: number): number {
    return now - this.#last;
  }
}

export function AppLockProvider({
  viewer,
  hinted,
  children,
}: {
  viewer: Pick<Viewer, 'id' | 'name' | 'email'>;
  /**
   * Whether this browser's `wf_app_lock` cookie says it has a PIN: until IndexedDB answered, the app is not shown.
   * Only the first render's value counts, so the server render and the hydration agree.
   */
  hinted: boolean;
  children: ReactNode;
}) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const [state, setState] = useState<LockState>({ record: undefined, locked: false });
  const [checking] = useState(hinted);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [activity] = useState(() => new ActivityClock());
  const userId = viewer.id;

  useEffect(() => {
    void readPin(userId)
      .catch(() => null)
      .then((record) => {
        const now = Date.now();
        if (
          record !== null &&
          (record.failedAttempts >= MAX_PIN_ATTEMPTS || now - record.lastActiveAt >= record.timeoutMinutes * 60_000)
        ) {
          setState({ record, locked: true });
        } else {
          // Opening the app counts as activity.
          activity.stored(now);
          if (record !== null) updatePin(userId, () => ({ lastActiveAt: now })).catch(ignore);
          setState({ record, locked: false });
        }
        syncHint();
      });
  }, [activity, userId]);

  const record = state.record;
  const unlocked = state.locked ? null : (record ?? null);
  useEffect(() => {
    if (unlocked === null) return;
    const onActivity = () => {
      const now = Date.now();
      if (activity.touch(now)) updatePin(userId, () => ({ lastActiveAt: now })).catch(ignore);
    };
    const check = () => {
      if (activity.idleFor(Date.now()) < unlocked.timeoutMinutes * 60_000) return;
      setState({ record: unlocked, locked: true });
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, IDLE_CHECK_MS);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, [activity, unlocked, userId]);

  const controls = useMemo(() => {
    /** Signs out first; only then the PIN goes, so a failed sign-out cannot leave the app open. */
    const forget = async () => {
      setSignOutError(null);
      const result = await actions.signOut();
      if (!result.ok) {
        setSignOutError(authErrorMessage(result.error, preferences.locale));
        return;
      }
      await deletePin(userId).catch(ignore);
      syncHint();
      hardNavigate('/sign-in');
    };
    const save = async (pin: string, timeoutMinutes: LockTimeout) => {
      const now = Date.now();
      const created = await createPin(userId, pin, timeoutMinutes, now);
      activity.stored(now);
      setState({ record: created, locked: false });
      syncHint();
    };
    const pinControls = (record: PinRecord): PinControls => ({
      timeoutMinutes: record.timeoutMinutes,
      verify: async (pin) => {
        const matches = await matchesPin(record, pin);
        const now = Date.now();
        const updated = await updatePin(userId, (current) =>
          matches ? { failedAttempts: 0, lastActiveAt: now } : { failedAttempts: current.failedAttempts + 1 },
        );
        if (updated !== null && matches) {
          activity.stored(now);
          setState({ record: updated, locked: false });
          return { ok: true };
        }
        // Removed meanwhile (another tab used up the attempts): as good as the last attempt.
        const failed = updated ?? { ...record, failedAttempts: MAX_PIN_ATTEMPTS };
        const remaining = MAX_PIN_ATTEMPTS - failed.failedAttempts;
        if (remaining > 0) {
          setState((current) => ({ record: failed, locked: current.locked }));
          return { ok: false, remaining };
        }
        setState({ record: failed, locked: true });
        await forget();
        return { ok: false, remaining: 0 };
      },
      change: (pin) => save(pin, record.timeoutMinutes),
      remove: async () => {
        await deletePin(userId);
        setState({ record: null, locked: false });
        syncHint();
      },
      setTimeoutMinutes: (timeoutMinutes) => {
        updatePin(userId, () => ({ timeoutMinutes })).then((updated) => {
          setState({ record: updated, locked: false });
        }, ignore);
      },
    });
    return { forget, save, pinControls };
  }, [actions, activity, preferences.locale, userId]);

  const value = useMemo(
    (): AppLockValue => ({
      enable: (pin) => controls.save(pin, DEFAULT_LOCK_TIMEOUT),
      pin: record ? controls.pinControls(record) : null,
    }),
    [controls, record],
  );

  let content: ReactNode = children;
  if (state.locked) {
    content = (
      <LockScreen
        viewer={viewer}
        timeoutMinutes={state.record.timeoutMinutes}
        exhausted={state.record.failedAttempts >= MAX_PIN_ATTEMPTS}
        error={signOutError}
        onUnlock={controls.pinControls(state.record).verify}
        onForgot={() => {
          void controls.forget();
        }}
      />
    );
  } else if (state.record === undefined && checking) {
    // A PIN may be set: show nothing of the app until IndexedDB has answered.
    content = <div aria-busy="true" className="min-h-dvh bg-bg" />;
  }
  return <AppLockContext value={value}>{content}</AppLockContext>;
}

/** The app lock controls of the surrounding `<AppLockProvider>`. */
export function useAppLock(): AppLockValue {
  const value = use(AppLockContext);
  if (value === null) throw new MissingAppLockProviderError('useAppLock() needs an <AppLockProvider> above it');
  return value;
}
