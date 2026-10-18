// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who may open Bull Board (plan §8 M0, §10): admins with two-step verification and a session from the last 15
 * minutes (FR-A9). Signed-out visitors are sent to sign in; everyone else gets 403.
 */
import type { AuthSession } from '@wf/auth/auth';
import { assertFreshSession, ReauthenticationRequiredError } from '@wf/auth/session';
import { m } from '@wf/i18n/messages';
import { escapeHtml, type QueueBoard } from './queue-board.ts';
import { QUEUE_BOARD_PATH } from './security.ts';

export type BoardAccess = 'allowed' | 'sign-in' | 'forbidden' | 'reauthenticate';

export function boardAccess(session: AuthSession | null, now: Date): BoardAccess {
  if (session === null) return 'sign-in';
  if (session.user.role !== 'admin' || session.user.twoFactorEnabled !== true) return 'forbidden';
  try {
    assertFreshSession(session, now);
  } catch (error) {
    if (error instanceof ReauthenticationRequiredError) return 'reauthenticate';
    throw error;
  }
  return 'allowed';
}

/** A plain page (no scripts, no styles) for the refusals. */
function refusal(locale: string, title: string, body: string, link: { href: string; label: string }): Response {
  const html = `<!DOCTYPE html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p></body></html>`;
  return new Response(html, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export interface ServeBoardDeps {
  readonly session: () => Promise<AuthSession | null>;
  readonly board: () => QueueBoard;
  readonly now: () => Date;
  readonly nonce: string;
  readonly locale: string;
}

export async function serveQueueBoard(request: Request, deps: ServeBoardDeps): Promise<Response> {
  const access = boardAccess(await deps.session(), deps.now());
  const reauth = `/sign-in?${new URLSearchParams({ redirect: QUEUE_BOARD_PATH, reauth: '1' }).toString()}`;
  switch (access) {
    case 'allowed':
      return deps.board().handle(request, deps.nonce);
    case 'sign-in':
      return Response.redirect(new URL(`/sign-in?redirect=${encodeURIComponent(QUEUE_BOARD_PATH)}`, request.url), 302);
    case 'reauthenticate':
      return refusal(deps.locale, m.queue_board_reauth_title(), m.queue_board_reauth_body(), {
        href: reauth,
        label: m.queue_board_reauth_action(),
      });
    case 'forbidden':
      return refusal(deps.locale, m.queue_board_forbidden_title(), m.queue_board_forbidden_body(), {
        href: '/',
        label: m.queue_board_forbidden_action(),
      });
  }
}
