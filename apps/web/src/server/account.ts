// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The signed-in user's own settings (FR-A5, FR-A7, FR-A8, FR-A10, FR-S8): profile, devices, passkeys, and security
 * history. Everything is scoped by the session's user id; app data goes through `wf_app` + `withUser`. What reaches
 * the browser is a view without secrets: no session tokens, no IP hashes, no credential material.
 */
import type { Device } from '@wf/auth/auth';
import { describeDevice } from '@wf/auth/device';
import type { JsonObject } from '@wf/db/schema';
import type { SecurityEvent, SecurityEvents, SecurityEventType } from '@wf/db/security-events';

export interface DeviceView {
  readonly id: string;
  /** `Chrome · macOS`; `null` when the browser sent no user agent. */
  readonly label: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly current: boolean;
}

export interface PasskeyView {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: Date;
}

/** The non-secret details of a security event the history explains. */
export interface SecurityEventDetail {
  /** `sign_in`: how (`password`, `totp`, `backup_code`, `passkey`, `google`, `sign_up`). */
  readonly method?: string;
  /** `sign_in_failed`: which factor was wrong. */
  readonly factor?: string;
  readonly remainingAttempts?: number;
  readonly newDevice?: boolean;
  /** `session_revoked` for every other device: how many. */
  readonly count?: number;
  /** `passkey_added`: its name. */
  readonly name?: string;
}

export interface SecurityEventView {
  readonly id: string;
  readonly type: SecurityEventType;
  readonly at: Date;
  readonly device: string | null;
  readonly detail: SecurityEventDetail;
}

export interface SecurityHistory {
  readonly events: readonly SecurityEventView[];
  /** Pass back to load older events; `null` on the last page. */
  readonly nextBefore: string | null;
}

export interface SecurityOverview {
  readonly twoFactorEnabled: boolean;
  /** Whether the account has an email + password credential (otherwise Google only: "Atur kata sandi"). */
  readonly hasPassword: boolean;
  readonly googleLinked: boolean;
  readonly passkeys: readonly PasskeyView[];
  readonly devices: readonly DeviceView[];
  readonly history: SecurityHistory;
}

export const HISTORY_PAGE_SIZE = 20;

export function toDeviceView({ id, label, createdAt, expiresAt, current }: Device): DeviceView {
  return { id, label, createdAt, expiresAt, current };
}

const text = (meta: JsonObject, key: string) => (typeof meta[key] === 'string' ? { [key]: meta[key] } : {});
const number = (meta: JsonObject, key: string) => (typeof meta[key] === 'number' ? { [key]: meta[key] } : {});

export function toEventView({ id, type, at, userAgent, meta }: SecurityEvent): SecurityEventView {
  return {
    id,
    type,
    at,
    device: describeDevice(userAgent),
    detail: {
      ...text(meta, 'method'),
      ...text(meta, 'factor'),
      ...text(meta, 'name'),
      ...number(meta, 'remainingAttempts'),
      ...number(meta, 'count'),
      ...(meta['newDevice'] === true ? { newDevice: true } : {}),
    },
  };
}

export async function loadHistory(
  events: Pick<SecurityEvents, 'list'>,
  userId: string,
  before: string | undefined,
): Promise<SecurityHistory> {
  const page = await events.list(userId, { limit: HISTORY_PAGE_SIZE, ...(before === undefined ? {} : { before }) });
  return { events: page.events.map(toEventView), nextBefore: page.nextBefore };
}

export interface SecurityDeps {
  readonly listDevices: () => Promise<Device[]>;
  readonly listPasskeys: () => Promise<readonly { id: string; name?: string | null | undefined; createdAt: Date }[]>;
  /** Provider ids of the user's accounts: `credential`, `google`. */
  readonly listProviders: () => Promise<readonly string[]>;
  readonly events: Pick<SecurityEvents, 'list'>;
}

export async function loadSecurity(
  deps: SecurityDeps,
  user: { readonly id: string; readonly twoFactorEnabled?: boolean | null | undefined },
): Promise<SecurityOverview> {
  const [devices, passkeys, providers, history] = await Promise.all([
    deps.listDevices(),
    deps.listPasskeys(),
    deps.listProviders(),
    loadHistory(deps.events, user.id, undefined),
  ]);
  return {
    twoFactorEnabled: user.twoFactorEnabled === true,
    hasPassword: providers.includes('credential'),
    googleLinked: providers.includes('google'),
    passkeys: passkeys.map(({ id, name, createdAt }) => ({ id, name: name ?? null, createdAt })),
    devices: devices.map(toDeviceView),
    history,
  };
}
