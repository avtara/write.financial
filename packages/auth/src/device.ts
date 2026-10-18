// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Device recognition for new-device sign-in emails (FR-A10). A device is the browser's user agent plus the
 * network it signs in from, coarsened to a subnet (IPv4 /24, IPv6 /48) so a new DHCP lease or IPv6 privacy
 * address on the same network is not a "new device". Only a keyed hash of the pair is stored.
 */
import { isIPv4, isIPv6 } from 'node:net';
import { hmacSha256Hex } from '@wf/crypto/hash';

/** Number of 16-bit groups a written IPv6 part stands for (an embedded IPv4 address counts as two). */
const groupCount = (groups: readonly string[]): number =>
  groups.reduce((count, group) => count + (group.includes('.') ? 2 : 1), 0);

/** The client's network, `203.0.113.0/24` or `2001:db8:abcd::/48`; `null` for anything that is not an IP. */
export function ipSubnet(ip: string): string | null {
  const address = ip.trim().toLowerCase().replace(/%.*$/, '');
  const mapped = /^[0:]*:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)?.[1];
  const v4 = mapped ?? address;
  if (isIPv4(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (!isIPv6(address)) return null;
  const [head = '', tail] = address.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const zeros = Array.from({ length: 8 - groupCount(left) - groupCount(right) }, () => '0');
  const groups = [...left, ...zeros, ...right];
  return `${groups
    .slice(0, 3)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(':')}::/48`;
}

/** Keyed fingerprint of (user agent, subnet); `key` is `deriveKey(AUTH_SECRET, 'device')`. */
export function deviceFingerprint(key: Uint8Array, userAgent: string | null, ip: string | null): string {
  return hmacSha256Hex(key, `${userAgent ?? ''}\n${ip === null ? '' : (ipSubnet(ip) ?? '')}`);
}

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * A short label for emails and the device list, e.g. `Firefox · Linux`; the user agent itself (capped) when
 * neither browser nor system is recognized, and `null` without a user agent.
 */
export function describeDevice(userAgent: string | null): string | null {
  if (userAgent === null || userAgent.trim() === '') return null;
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const parts = [browser, system].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(' · ') : userAgent.trim().slice(0, 80);
}
