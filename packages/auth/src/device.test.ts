// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { describeDevice, deviceFingerprint, ipSubnet } from './device.ts';

const KEY = new Uint8Array(32).fill(7);
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

describe('ipSubnet', () => {
  it.each([
    ['203.0.113.7', '203.0.113.0/24'],
    [' 203.0.113.250 ', '203.0.113.0/24'],
    ['::ffff:198.51.100.9', '198.51.100.0/24'],
    ['0:0:0:0:0:ffff:198.51.100.9', '198.51.100.0/24'],
    ['2001:db8:abcd:12::1', '2001:db8:abcd::/48'],
    ['2001:0DB8:ABCD:0012:0000:0000:0000:0001', '2001:db8:abcd::/48'],
    ['2001:db8::1', '2001:db8:0::/48'],
    ['::1', '0:0:0::/48'],
    ['fe80::1%eth0', 'fe80:0:0::/48'],
    ['64:ff9b:1::192.0.2.33', '64:ff9b:1::/48'],
    ['::', '0:0:0::/48'],
  ])('%s → %s', (ip, subnet) => {
    expect(ipSubnet(ip)).toBe(subnet);
  });

  it.each(['', 'localhost', '999.1.1.1', 'not-an-ip'])('rejects %j', (ip) => {
    expect(ipSubnet(ip)).toBeNull();
  });
});

describe('deviceFingerprint', () => {
  it('is the same for the same browser on the same network', () => {
    expect(deviceFingerprint(KEY, FIREFOX_LINUX, '203.0.113.7')).toBe(
      deviceFingerprint(KEY, FIREFOX_LINUX, '203.0.113.99'),
    );
  });

  it('changes with the browser, the network, or the key', () => {
    const base = deviceFingerprint(KEY, FIREFOX_LINUX, '203.0.113.7');
    expect(deviceFingerprint(KEY, CHROME_MAC, '203.0.113.7')).not.toBe(base);
    expect(deviceFingerprint(KEY, FIREFOX_LINUX, '198.51.100.7')).not.toBe(base);
    expect(deviceFingerprint(new Uint8Array(32).fill(8), FIREFOX_LINUX, '203.0.113.7')).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles requests without user agent or IP', () => {
    expect(deviceFingerprint(KEY, null, null)).toBe(deviceFingerprint(KEY, '', 'garbage'));
  });
});

describe('describeDevice', () => {
  it.each([
    [FIREFOX_LINUX, 'Firefox · Linux'],
    [CHROME_MAC, 'Chrome · macOS'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge · Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari · iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      'Samsung Internet · Android',
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/114.0',
      'Opera · ChromeOS',
    ],
    ['curl/8.9.1', 'curl/8.9.1'],
    ['SomeApp (Linux)', 'Linux'],
  ])('%s → %s', (userAgent, label) => {
    expect(describeDevice(userAgent)).toBe(label);
  });

  it('caps an unknown user agent and returns null without one', () => {
    expect(describeDevice('x'.repeat(200))).toHaveLength(80);
    expect(describeDevice(null)).toBeNull();
    expect(describeDevice('  ')).toBeNull();
  });
});
