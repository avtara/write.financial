// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The user's own market data keys (FR-ST4, BYOK): stored encrypted with the user's DEK, never logged and never
 * returned — views carry only the last 4 characters. Saving a key requires active 2FA (also enforced by the insert
 * policy). The connection test and the polling run in the worker, which reads the key with `apiKey` and records the
 * outcome with `setStatus` (status, quota, `retry_after` after a 429). Deleting a key deletes that provider's
 * `user_quotes` of the user (the providers' terms require it).
 */
import { decryptText, encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import { BYOK_PROVIDERS, type ByokProvider, type CredentialStatus, type MarketProvider } from '@wf/domain/market';
import { asc, eq } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import { deleteUserQuotesIn } from './market-data.ts';
import { marketCredentials, users } from './schema.ts';

/** AAD purpose of `market_credentials.api_key_enc`. */
export const API_KEY_PURPOSE = 'market_credentials.api_key';

/** Longest key accepted (provider keys are well below it). */
const MAX_KEY_LENGTH = 512;

export interface MarketCredentialView {
  readonly id: string;
  readonly provider: ByokProvider;
  /** The last 4 characters of the key; the key itself never leaves the server. */
  readonly last4: string;
  readonly active: boolean;
  readonly status: CredentialStatus;
  readonly quotaUsed: number;
  readonly quotaLimit: number | null;
  readonly quotaResetAt: Date | null;
  /** Paused until then (429 / quota exhausted); requests fall back to the next source meanwhile. */
  readonly retryAfter: Date | null;
  readonly lastTestedAt: Date | null;
  readonly updatedAt: Date;
}

/** The outcome of a connection test or a polling run. Omitted fields are kept. */
export interface CredentialStatusInput {
  readonly status: CredentialStatus;
  readonly quotaUsed?: number;
  readonly quotaLimit?: number | null;
  readonly quotaResetAt?: Date | null;
  readonly retryAfter?: Date | null;
  /** Set for a connection test ("Tes koneksi"). */
  readonly testedAt?: Date;
}

export interface MarketCredentialsRepository {
  list: (userId: string) => Promise<MarketCredentialView[]>;
  /**
   * Saves (or replaces) the key for `provider`: status back to untested, quota counters reset.
   * @throws {LedgerError} `TWO_FACTOR_REQUIRED`, `INVALID_MARKET_CREDENTIAL`
   */
  save: (
    userId: string,
    input: { readonly provider: ByokProvider; readonly apiKey: string; readonly active?: boolean },
  ) => Promise<MarketCredentialView>;
  /** @throws {LedgerError} `NOT_FOUND` */
  setActive: (userId: string, provider: ByokProvider, active: boolean) => Promise<MarketCredentialView>;
  /** @throws {LedgerError} `NOT_FOUND` */
  setStatus: (userId: string, provider: ByokProvider, input: CredentialStatusInput) => Promise<MarketCredentialView>;
  /** The decrypted key, for the worker's request (never sent to a client); `null` without one. */
  apiKey: (userId: string, provider: ByokProvider) => Promise<string | null>;
  /**
   * Deletes the key and the provider's `user_quotes` of the user; returns how many quotes went.
   * @throws {LedgerError} `NOT_FOUND`
   */
  remove: (userId: string, provider: ByokProvider) => Promise<{ readonly quotesDeleted: number }>;
}

const VIEW = {
  id: marketCredentials.id,
  provider: marketCredentials.provider,
  last4: marketCredentials.last4,
  active: marketCredentials.active,
  status: marketCredentials.status,
  quotaUsed: marketCredentials.quotaUsed,
  quotaLimit: marketCredentials.quotaLimit,
  quotaResetAt: marketCredentials.quotaResetAt,
  retryAfter: marketCredentials.retryAfter,
  lastTestedAt: marketCredentials.lastTestedAt,
  updatedAt: marketCredentials.updatedAt,
};

/** A view row as selected (the column holds any market provider; only BYOK ones are ever saved). */
type CredentialRow = Omit<MarketCredentialView, 'provider'> & { readonly provider: MarketProvider };

const viewOf = (row: CredentialRow): MarketCredentialView => ({ ...row, provider: row.provider as ByokProvider });

export function createMarketCredentials(
  db: Database,
  { getDek, now = () => new Date() }: { readonly getDek: (userId: string) => Promise<Dek>; readonly now?: () => Date },
): MarketCredentialsRepository {
  const aad = (userId: string) => ({ userId, purpose: API_KEY_PURPOSE });
  const one = (rows: readonly CredentialRow[]): MarketCredentialView => {
    const [row] = rows;
    if (row === undefined) throw new LedgerError('NOT_FOUND', 'No key for this provider');
    return viewOf(row);
  };
  return {
    list: (userId) =>
      withUser(db, userId, async (tx) =>
        (await tx.select(VIEW).from(marketCredentials).orderBy(asc(marketCredentials.createdAt))).map(viewOf),
      ),

    save: async (userId, input) => {
      if (!(BYOK_PROVIDERS as readonly string[]).includes(input.provider)) {
        throw new LedgerError('INVALID_MARKET_CREDENTIAL', 'Not a BYOK provider');
      }
      const key = input.apiKey.trim();
      if (key.length < 4 || key.length > MAX_KEY_LENGTH || /\s/.test(key)) {
        throw new LedgerError('INVALID_MARKET_CREDENTIAL', 'Invalid API key');
      }
      // Fetched outside the transaction: getDek opens its own.
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const user = firstRow(
          await tx.select({ twoFactor: users.twoFactorEnabled }).from(users).where(eq(users.id, userId)),
          'users',
        );
        if (user.twoFactor !== true) throw new LedgerError('TWO_FACTOR_REQUIRED', 'Market keys need 2FA');
        const at = now();
        const values = {
          apiKeyEnc: encrypt(dek, key, aad(userId)),
          last4: key.slice(-4),
          active: input.active ?? true,
          status: 'untested' as const,
          quotaUsed: 0,
          quotaLimit: null,
          quotaResetAt: null,
          retryAfter: null,
          lastTestedAt: null,
          updatedAt: at,
        };
        return one(
          await tx
            .insert(marketCredentials)
            .values({ ...values, userId, provider: input.provider })
            .onConflictDoUpdate({ target: [marketCredentials.userId, marketCredentials.provider], set: values })
            .returning(VIEW),
        );
      });
    },

    setActive: (userId, provider, active) =>
      withUser(db, userId, async (tx) =>
        one(
          await tx
            .update(marketCredentials)
            .set({ active, updatedAt: now() })
            .where(eq(marketCredentials.provider, provider))
            .returning(VIEW),
        ),
      ),

    setStatus: (userId, provider, input) =>
      withUser(db, userId, async (tx) =>
        one(
          await tx
            .update(marketCredentials)
            .set({
              status: input.status,
              ...(input.quotaUsed === undefined ? {} : { quotaUsed: input.quotaUsed }),
              ...(input.quotaLimit === undefined ? {} : { quotaLimit: input.quotaLimit }),
              ...(input.quotaResetAt === undefined ? {} : { quotaResetAt: input.quotaResetAt }),
              ...(input.retryAfter === undefined ? {} : { retryAfter: input.retryAfter }),
              ...(input.testedAt === undefined ? {} : { lastTestedAt: input.testedAt }),
              updatedAt: now(),
            })
            .where(eq(marketCredentials.provider, provider))
            .returning(VIEW),
        ),
      ),

    apiKey: async (userId, provider) => {
      const [row] = await withUser(db, userId, (tx) =>
        tx
          .select({ apiKeyEnc: marketCredentials.apiKeyEnc })
          .from(marketCredentials)
          .where(eq(marketCredentials.provider, provider)),
      );
      if (row === undefined) return null;
      return decryptText(await getDek(userId), row.apiKeyEnc, aad(userId));
    },

    remove: (userId, provider) =>
      withUser(db, userId, async (tx) => {
        one(await tx.delete(marketCredentials).where(eq(marketCredentials.provider, provider)).returning(VIEW));
        return { quotesDeleted: await deleteUserQuotesIn(tx, provider) };
      }),
  };
}
