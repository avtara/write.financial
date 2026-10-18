// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Outside the Start runtime a server function cannot run, so tests replace `createServerFn` with a builder that
 * returns the handler itself (with its input validator attached as `validator`):
 *   vi.mock('@tanstack/react-start', () => serverFnModule());
 * and call it as `fn({ context, data })`.
 */
import type { AuthSession } from '@wf/auth/auth';
import { ZodType } from 'zod';
import type { RequestContext } from '../src/server/request-middleware.ts';
import { fakeSession } from './fixtures.ts';

export function serverFnModule() {
  const handlerOf = (validator?: unknown) => ({
    handler: <T extends object>(handler: T) => Object.assign(handler, { validator }),
  });
  return { createServerFn: () => ({ ...handlerOf(), validator: (validator: unknown) => handlerOf(validator) }) };
}

/**
 * The request context a server function receives from the request middleware. `headers` are the request's;
 * cookies the function sets are collected in `setCookies`.
 */
export function requestContext(
  session: AuthSession | null = fakeSession(),
  locale: 'id' | 'en' = 'id',
  headers: Headers = new Headers(),
): RequestContext & { readonly setCookies: string[] } {
  const setCookies: string[] = [];
  return {
    nonce: 'test-nonce',
    preferences: { locale, theme: 'dark', balancesHidden: false, platform: 'other' },
    session: () => Promise.resolve(session),
    headers,
    setCookie: (cookie) => {
      setCookies.push(cookie);
    },
    setCookies,
  };
}

/** Calls a mocked server function (see {@link serverFnModule}). */
export function call<T>(fn: unknown, options: { context: RequestContext; data?: unknown }): Promise<T> {
  return (fn as (options: { context: RequestContext; data?: unknown }) => Promise<T>)(options);
}

/** The Zod input validator a mocked server function was built with. */
export function validatorOf(fn: unknown): ZodType {
  if (typeof fn === 'function' && 'validator' in fn && fn.validator instanceof ZodType) return fn.validator;
  throw new TypeError('not a server function with an input validator');
}
