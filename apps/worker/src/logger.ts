// SPDX-License-Identifier: AGPL-3.0-only
import type { LogLevel } from '@wf/config';
import { REDACT_PATHS, REDACTED } from '@wf/crypto/redact';
import pino, { type DestinationStream, type Logger } from 'pino';

/** JSON lines to stdout (or `destination`), with every secret-looking key censored (PRD §9.1). */
export function createLogger(level: LogLevel, destination: DestinationStream = pino.destination(1)): Logger {
  return pino(
    { level, base: { service: 'worker' }, redact: { paths: [...REDACT_PATHS], censor: REDACTED } },
    destination,
  );
}
