// SPDX-License-Identifier: AGPL-3.0-only
import { REDACT_PATHS, REDACTED } from '@wf/crypto/redact';
import type { LogLevel } from '@wf/config';
import { pino, type DestinationStream, type Logger } from 'pino';

/** JSON logs with secrets censored by key (`@wf/crypto/redact`); the caller picks the stream. */
export function createLogger(level: LogLevel, destination: DestinationStream): Logger {
  return pino({ level, base: { service: 'web' }, redact: { paths: [...REDACT_PATHS], censor: REDACTED } }, destination);
}
