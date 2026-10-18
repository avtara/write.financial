// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The instance settings (FR-OP1) as the web process reads them: every request needs the default locale, the sign-in
 * pages need the registration mode, and the mailer needs the SMTP settings. Reads are cached for a few seconds
 * (single-flight), and a save through this store replaces the cached value at once, so the admin who saved sees the
 * change immediately; other processes see it after at most {@link INSTANCE_CACHE_MS}.
 */
import type { InstanceSettings, InstanceSettingsRepository, SetupInput } from '@wf/db/instance-settings';

export const INSTANCE_CACHE_MS = 5_000;

export interface InstanceStore {
  get: () => Promise<InstanceSettings>;
  /** `InstanceSettingsRepository.updateSetup`, then caches the saved settings. */
  updateSetup: (adminUserId: string, input: SetupInput) => Promise<InstanceSettings>;
  smtpPassword: () => Promise<string | null>;
}

export function createInstanceStore(repository: InstanceSettingsRepository, now: () => number): InstanceStore {
  let cached: { readonly value: Promise<InstanceSettings>; readonly at: number } | null = null;

  return {
    get: () => {
      if (cached === null || now() - cached.at >= INSTANCE_CACHE_MS) {
        const value = repository.get();
        const entry = { value, at: now() };
        cached = entry;
        // A failed read is not cached: the next request tries again.
        value.catch(() => {
          if (cached === entry) cached = null;
        });
      }
      return cached.value;
    },
    updateSetup: async (adminUserId, input) => {
      const saved = await repository.updateSetup(adminUserId, input);
      cached = { value: Promise.resolve(saved), at: now() };
      return saved;
    },
    smtpPassword: repository.smtpPassword,
  };
}
