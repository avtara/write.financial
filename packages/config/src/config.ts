// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Environment configuration for web, worker, and migrate (plan §3 `config`, D22).
 *
 * `loadConfig` validates the whole environment at once and either returns a deeply frozen
 * `Config` or throws a `ConfigError` that lists every invalid key. Error messages name keys
 * and rules only; they never contain the values, because many of them are secrets.
 *
 * Secrets may instead be given as `<NAME>_FILE` pointing at a file (Docker secrets); one
 * trailing newline is stripped. Setting both `<NAME>` and `<NAME>_FILE` is an error.
 * Empty values (`KEY=` in a `.env` file) count as unset.
 *
 * `DEPLOYMENT_MODE=cloud` is stricter than `selfhost` (the default):
 * - `PUBLIC_URL` must be `https:` (the managed instance is always behind TLS).
 * - `SMTP_URL` and `MAIL_FROM` are required: on a self-hosted instance the operator may
 *   configure SMTP later in the setup wizard (FR-OP1), but the cloud instance must be able to
 *   send verification and password-reset mail from its first request.
 * - `CMC_API_KEY` is required: the cloud instance runs the built-in crypto prices with the
 *   operator's key (D23); self-hosters may run without it (BYOK/manual fallback).
 * Google stays optional in both modes: it can also be configured in instance settings
 * (FR-OP2), and Gmail stays off on cloud until verification (D24).
 */
import { readFileSync } from 'node:fs';
import * as z from 'zod';

export type DeploymentMode = 'selfhost' | 'cloud';
export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface Config {
  readonly deploymentMode: DeploymentMode;
  readonly nodeEnv: NodeEnv;
  /** Normalized origin + path the instance is reached at, e.g. `https://write.financial/`. */
  readonly publicUrl: string;
  readonly db: {
    /** `wf_app` role (RLS enforced). */
    readonly appUrl: string;
    /** `wf_worker` role. */
    readonly workerUrl: string;
    /** `wf_auth` role, used only by the auth module (Better Auth reads sessions before a user is known). */
    readonly authUrl: string;
    /** `wf_migrate` role; only the migrate process needs it, so it is optional here. */
    readonly migrateUrl: string | null;
    /** A superuser; only `wf-db bootstrap` needs it to create the roles above. */
    readonly superuserUrl: string | null;
    /** `wf_readonly_ops` role for operators; `wf-db bootstrap` takes its password from here (no login when unset). */
    readonly readonlyOpsUrl: string | null;
  };
  readonly redis: { readonly url: string };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly buckets: {
      readonly attachments: string;
      readonly avatars: string;
      readonly reports: string;
      readonly exports: string;
    };
  };
  readonly crypto: {
    /** Path of the KEK secret file; read only by `@wf/crypto`. */
    readonly kekFile: string;
  };
  readonly auth: { readonly secret: string };
  /**
   * One-time token that unlocks the first-run setup wizard (FR-OP1) while setup is pending; `null` when not configured.
   * The self-host `init` generates it and prints the setup URL; see apps/launcher/src/init.ts.
   */
  readonly setup: { readonly token: string | null };
  /** `null` when SMTP is not configured through the environment. */
  readonly mail: { readonly smtpUrl: string; readonly from: string } | null;
  /** `null` when Google sign-in is not configured through the environment. */
  readonly google: {
    readonly clientId: string;
    readonly clientSecret: string;
    /** `null` when Gmail push (D24) is not configured. */
    readonly gmail: {
      readonly cloudProject: string;
      readonly pubsubTopic: string;
      readonly pushServiceAccount: string;
    } | null;
  } | null;
  readonly market: { readonly cmcApiKey: string | null };
  /** Exact operator-trusted OpenAI-compatible API bases, including the path; empty disables custom egress. */
  readonly ai: { readonly allowedBaseUrls: readonly string[] };
  readonly log: { readonly level: LogLevel };
}

export type ReadFile = (path: string) => string;

export interface ConfigIssue {
  /** Environment variable name, e.g. `DATABASE_URL` or `AUTH_SECRET_FILE`. */
  readonly key: string;
  readonly message: string;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n')}`);
    this.issues = issues;
  }
}

const required = () => z.string({ error: 'is required' });

/** Checks the protocol only; the value itself never reaches an error message. */
const url = (protocols: readonly string[]) =>
  required().refine((value) => protocols.includes(URL.parse(value)?.protocol ?? ''), {
    error: `must be a URL with protocol ${protocols.join(' or ')}`,
  });

const POSTGRES = ['postgres:', 'postgresql:'];
const HTTP = ['http:', 'https:'];

/** S3 bucket naming rules (lowercase letters, digits, dots, hyphens; 3–63 chars). */
const bucket = (fallback: string) =>
  required()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { error: 'must be a valid S3 bucket name' })
    .default(fallback);

/** `addr@example.com` or `Name <addr@example.com>`. */
const mailbox = required().refine((value) => z.email().safeParse(/<([^<>]+)>$/.exec(value)?.[1] ?? value).success, {
  error: 'must be an email address or "Name <address>"',
});

const schema = z.object({
  DEPLOYMENT_MODE: z.enum(['selfhost', 'cloud'], { error: 'must be selfhost or cloud' }).default('selfhost'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'], { error: 'must be development, test, or production' })
    .default('production'),
  PUBLIC_URL: url(HTTP),
  DATABASE_URL: url(POSTGRES),
  DATABASE_URL_WORKER: url(POSTGRES),
  DATABASE_URL_AUTH: url(POSTGRES),
  DATABASE_URL_MIGRATE: url(POSTGRES).optional(),
  DATABASE_URL_SUPERUSER: url(POSTGRES).optional(),
  DATABASE_URL_READONLY_OPS: url(POSTGRES).optional(),
  REDIS_URL: url(['redis:', 'rediss:']),
  S3_ENDPOINT: url(HTTP),
  S3_REGION: required().default('us-east-1'),
  S3_ACCESS_KEY_ID: required(),
  S3_SECRET_ACCESS_KEY: required(),
  S3_BUCKET_ATTACHMENTS: bucket('wf-attachments'),
  S3_BUCKET_AVATARS: bucket('wf-avatars'),
  S3_BUCKET_REPORTS: bucket('wf-reports'),
  S3_BUCKET_EXPORTS: bucket('wf-exports'),
  KEK_FILE: required(),
  AUTH_SECRET: required().min(32, { error: 'must be at least 32 characters' }),
  SETUP_TOKEN: required().min(22, { error: 'must be at least 22 characters' }).optional(),
  SMTP_URL: url(['smtp:', 'smtps:']).optional(),
  MAIL_FROM: mailbox.optional(),
  GOOGLE_CLIENT_ID: required().optional(),
  GOOGLE_CLIENT_SECRET: required().optional(),
  GOOGLE_CLOUD_PROJECT: required().optional(),
  GOOGLE_GMAIL_PUBSUB_TOPIC: required()
    .regex(/^projects\/[^/]+\/topics\/[^/]+$/, { error: 'must look like projects/<project>/topics/<topic>' })
    .optional(),
  GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT: required()
    .regex(/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/, { error: 'must be a Google service account email' })
    .optional(),
  CMC_API_KEY: required().optional(),
  AI_ALLOWED_BASE_URLS: required()
    .default('')
    .refine(
      (value) =>
        value === '' ||
        value.split(',').every((item) => {
          const parsed = URL.parse(item.trim());
          return (
            parsed !== null &&
            HTTP.includes(parsed.protocol) &&
            !parsed.username &&
            !parsed.password &&
            !parsed.search &&
            !parsed.hash
          );
        }),
      { error: 'must be comma-separated HTTP(S) API base URLs without credentials, queries or fragments' },
    ),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
      error: 'must be fatal, error, warn, info, debug, trace, or silent',
    })
    .default('info'),
});

type Key = keyof typeof schema.shape;
const KEYS = Object.keys(schema.shape) as Key[];

/** Keys that may also be provided as `<KEY>_FILE`. */
const SECRET_KEYS: Partial<Record<Key, true>> = {
  DATABASE_URL: true,
  DATABASE_URL_WORKER: true,
  DATABASE_URL_AUTH: true,
  DATABASE_URL_MIGRATE: true,
  DATABASE_URL_SUPERUSER: true,
  DATABASE_URL_READONLY_OPS: true,
  REDIS_URL: true,
  S3_ACCESS_KEY_ID: true,
  S3_SECRET_ACCESS_KEY: true,
  AUTH_SECRET: true,
  SETUP_TOKEN: true,
  SMTP_URL: true,
  GOOGLE_CLIENT_SECRET: true,
  CMC_API_KEY: true,
};

const defaultReadFile: ReadFile = (path) => readFileSync(path, 'utf8');

/**
 * Validates `env` (usually `process.env`) and returns the frozen configuration.
 * `readFile` resolves `<NAME>_FILE` secrets; it defaults to a synchronous UTF-8 read.
 * @throws {ConfigError} listing every invalid or missing key.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>, readFile = defaultReadFile): Config {
  const issues: ConfigIssue[] = [];
  const raw: Partial<Record<Key, string>> = {};
  /** Keys whose problem is already reported (both forms set, unreadable file). */
  const reported = new Set<Key>();

  for (const key of KEYS) {
    const direct = nonEmpty(env[key]);
    const filePath = SECRET_KEYS[key] ? nonEmpty(env[`${key}_FILE`]) : undefined;
    if (filePath === undefined) {
      if (direct !== undefined) raw[key] = direct;
    } else if (direct !== undefined) {
      issues.push({ key, message: `set either ${key} or ${key}_FILE, not both` });
      reported.add(key);
    } else {
      try {
        const content = nonEmpty(readFile(filePath).replace(/\r?\n$/, ''));
        if (content !== undefined) raw[key] = content;
      } catch {
        issues.push({ key: `${key}_FILE`, message: 'cannot read the file' });
        reported.add(key);
      }
    }
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as Key;
      if (!reported.has(key)) issues.push({ key, message: issue.message });
    }
  }
  const isSet = (key: Key): boolean => raw[key] !== undefined || reported.has(key);
  issues.push(...crossFieldIssues(raw, isSet));

  if (!parsed.success || issues.length > 0) {
    throw new ConfigError(issues.toSorted((a, b) => rank(a.key) - rank(b.key)));
  }
  return deepFreeze(toConfig(parsed.data));
}

function crossFieldIssues(raw: Partial<Record<Key, string>>, isSet: (key: Key) => boolean): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const requireAll = (keys: readonly Key[], reason: string) => {
    for (const key of keys) if (!isSet(key)) issues.push({ key, message: `is required ${reason}` });
  };

  if (isSet('SMTP_URL')) requireAll(['MAIL_FROM'], 'when SMTP_URL is set');

  const gmail = ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_GMAIL_PUBSUB_TOPIC', 'GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT'] as const;
  const oauth = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;
  if (gmail.some(isSet)) requireAll([...oauth, ...gmail], 'to enable Gmail');
  else if (oauth.some(isSet)) requireAll(oauth, 'to enable Google sign-in');

  if (raw.DEPLOYMENT_MODE === 'cloud') {
    requireAll(['SMTP_URL', 'MAIL_FROM', 'CMC_API_KEY'], 'when DEPLOYMENT_MODE is cloud');
    if (URL.parse(raw.PUBLIC_URL ?? '')?.protocol === 'http:') {
      issues.push({ key: 'PUBLIC_URL', message: 'must use https: when DEPLOYMENT_MODE is cloud' });
    }
    if ((raw.AI_ALLOWED_BASE_URLS ?? '').split(',').some((value) => URL.parse(value.trim())?.protocol === 'http:')) {
      issues.push({ key: 'AI_ALLOWED_BASE_URLS', message: 'must use https: when DEPLOYMENT_MODE is cloud' });
    }
  }
  return issues;
}

type Env = z.infer<typeof schema>;

function toConfig(env: Env): Config {
  return {
    deploymentMode: env.DEPLOYMENT_MODE,
    nodeEnv: env.NODE_ENV,
    publicUrl: new URL(env.PUBLIC_URL).href,
    db: {
      appUrl: env.DATABASE_URL,
      workerUrl: env.DATABASE_URL_WORKER,
      authUrl: env.DATABASE_URL_AUTH,
      migrateUrl: env.DATABASE_URL_MIGRATE ?? null,
      superuserUrl: env.DATABASE_URL_SUPERUSER ?? null,
      readonlyOpsUrl: env.DATABASE_URL_READONLY_OPS ?? null,
    },
    redis: { url: env.REDIS_URL },
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      buckets: {
        attachments: env.S3_BUCKET_ATTACHMENTS,
        avatars: env.S3_BUCKET_AVATARS,
        reports: env.S3_BUCKET_REPORTS,
        exports: env.S3_BUCKET_EXPORTS,
      },
    },
    crypto: { kekFile: env.KEK_FILE },
    auth: { secret: env.AUTH_SECRET },
    setup: { token: env.SETUP_TOKEN ?? null },
    mail: env.SMTP_URL === undefined ? null : { smtpUrl: env.SMTP_URL, from: env.MAIL_FROM as string },
    google:
      env.GOOGLE_CLIENT_ID === undefined
        ? null
        : {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string,
            gmail:
              env.GOOGLE_CLOUD_PROJECT === undefined
                ? null
                : {
                    cloudProject: env.GOOGLE_CLOUD_PROJECT,
                    pubsubTopic: env.GOOGLE_GMAIL_PUBSUB_TOPIC as string,
                    pushServiceAccount: env.GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT as string,
                  },
          },
    market: { cmcApiKey: env.CMC_API_KEY ?? null },
    ai: {
      allowedBaseUrls:
        env.AI_ALLOWED_BASE_URLS === ''
          ? []
          : [
              ...new Set(
                env.AI_ALLOWED_BASE_URLS.split(',').map((value) => new URL(value.trim()).href.replace(/\/+$/, '')),
              ),
            ],
    },
    log: { level: env.LOG_LEVEL },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/** Issues are reported in schema order; `<KEY>_FILE` sorts with `<KEY>` (`KEK_FILE` is a key itself). */
function rank(key: string): number {
  const keys: readonly string[] = KEYS;
  return keys.includes(key) ? keys.indexOf(key) : keys.indexOf(key.replace(/_FILE$/, ''));
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child as object);
  }
  return Object.freeze(value);
}
