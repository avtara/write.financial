// SPDX-License-Identifier: AGPL-3.0-only
/** Password hashing (PRD §9.1): Argon2id with the OWASP Password Storage Cheat Sheet's first configuration. */
import { hash, verify } from '@node-rs/argon2';

/** FR-A1. */
export const MIN_PASSWORD_LENGTH = 10;
/** Upper bound so a single sign-in cannot make the server hash megabytes. */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * OWASP: Argon2id, m = 19 MiB, t = 2, p = 1. `@node-rs/argon2` defaults to Argon2id (version 0x13) and a
 * random 16-byte salt; the parameters are encoded in the PHC string, so they can be raised later without
 * invalidating stored hashes.
 */
export const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

/** PHC string `$argon2id$v=19$m=19456,t=2,p=1$…`. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Whether `password` matches the PHC string `hash` (in constant time). */
export function verifyPassword({ hash: phc, password }: { hash: string; password: string }): Promise<boolean> {
  return verify(phc, password);
}
