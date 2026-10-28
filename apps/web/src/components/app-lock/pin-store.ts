// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app lock's PIN on this device (PRD FR-A6, D11): one record per user in this browser's IndexedDB, never sent to
 * the server. Only a PBKDF2-SHA-256 hash of the PIN is kept (random 16-byte salt, {@link PIN_ITERATIONS} iterations,
 * WebCrypto), next to the auto-lock timeout, the consecutive wrong attempts, and when the user was last active, so a
 * reload after the timeout starts locked. Each call opens the database and closes it again; they are rare.
 */

export const PIN_LENGTH = 6;
/** The fifth consecutive wrong PIN removes the PIN from this device and signs the user out. */
export const MAX_PIN_ATTEMPTS = 5;
/** OWASP's minimum for PBKDF2-HMAC-SHA-256 (Password Storage Cheat Sheet). */
export const PIN_ITERATIONS = 310_000;
export const LOCK_TIMEOUTS = [1, 5, 15, 30] as const;
/** Minutes without activity before the app locks itself. */
export type LockTimeout = (typeof LOCK_TIMEOUTS)[number];
export const DEFAULT_LOCK_TIMEOUT: LockTimeout = 5;

export interface PinRecord {
  readonly userId: string;
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly hash: Uint8Array<ArrayBuffer>;
  readonly iterations: number;
  readonly timeoutMinutes: LockTimeout;
  readonly failedAttempts: number;
  /** Epoch milliseconds of the last activity written (throttled, so possibly a little older). */
  readonly lastActiveAt: number;
}

/** The fields {@link updatePin} may change. */
export type PinRecordPatch = Partial<Pick<PinRecord, 'timeoutMinutes' | 'failedAttempts' | 'lastActiveAt'>>;

/** The answer to an entered PIN; `remaining` wrong attempts left before the PIN is removed and the user signed out. */
export type PinCheck = { readonly ok: true } | { readonly ok: false; readonly remaining: number };

/** Thrown for a PIN that is not exactly {@link PIN_LENGTH} digits. */
export class InvalidPinError extends Error {
  override name = 'InvalidPinError';
}

const DATABASE = 'wf-app-lock';
const VERSION = 1;
const STORE = 'pins';
const PIN_PATTERN = new RegExp(`^\\d{${String(PIN_LENGTH)}}$`);

function settle<T>(request: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  request.onsuccess = () => {
    resolve(request.result);
  };
  request.onerror = () => {
    reject(request.error);
  };
  return promise;
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE, VERSION);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE, { keyPath: 'userId' });
  };
  return settle(request);
}

/** Runs `use` on the store in one transaction, then closes the database. */
async function withStore<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await use(database.transaction(STORE, mode).objectStore(STORE));
  } finally {
    database.close();
  }
}

async function derive(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256),
  );
}

export function isPin(value: string): boolean {
  return PIN_PATTERN.test(value);
}

/** The user's record in `store`; IndexedDB types every value `any`, and only this module writes the store. */
function stored(store: IDBObjectStore, userId: string): IDBRequest<PinRecord | undefined> {
  return store.get(userId) as IDBRequest<PinRecord | undefined>;
}

/** The user's PIN record on this device, `null` without one. */
export function readPin(userId: string): Promise<PinRecord | null> {
  return withStore('readonly', async (store) => (await settle(stored(store, userId))) ?? null);
}

/** Saves a new PIN for the user (replacing any earlier one), with no wrong attempts and active `now`. */
export async function createPin(
  userId: string,
  pin: string,
  timeoutMinutes: LockTimeout,
  now: number,
): Promise<PinRecord> {
  if (!isPin(pin)) throw new InvalidPinError(`A PIN is exactly ${String(PIN_LENGTH)} digits`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const record: PinRecord = {
    userId,
    salt,
    hash: await derive(pin, salt, PIN_ITERATIONS),
    iterations: PIN_ITERATIONS,
    timeoutMinutes,
    failedAttempts: 0,
    lastActiveAt: now,
  };
  await withStore('readwrite', (store) => settle(store.put(record)));
  return record;
}

/** Whether `pin` is the record's PIN; compares every derived byte, so the time taken does not tell where it differs. */
export async function matchesPin(record: PinRecord, pin: string): Promise<boolean> {
  const derived = await derive(pin, record.salt, record.iterations);
  if (derived.byteLength !== record.hash.byteLength) return false;
  const expected = new DataView(record.hash.buffer, record.hash.byteOffset, record.hash.byteLength);
  let difference = 0;
  derived.forEach((byte, index) => {
    difference |= byte ^ expected.getUint8(index);
  });
  return difference === 0;
}

/**
 * Changes the user's record in one transaction: `patch` receives the stored record, so counters cannot lose an update
 * from another tab. `null` when the user has no PIN (any more).
 */
export function updatePin(userId: string, patch: (current: PinRecord) => PinRecordPatch): Promise<PinRecord | null> {
  return withStore('readwrite', async (store) => {
    const current = await settle(stored(store, userId));
    if (current === undefined) return null;
    const next: PinRecord = { ...current, ...patch(current) };
    await settle(store.put(next));
    return next;
  });
}

export function deletePin(userId: string): Promise<void> {
  return withStore('readwrite', (store) => settle(store.delete(userId)));
}

/** How many users have a PIN on this device. */
export function countPins(): Promise<number> {
  return withStore('readonly', (store) => settle(store.count()));
}
