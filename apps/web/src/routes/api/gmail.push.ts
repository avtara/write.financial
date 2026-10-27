// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { gmailPush } from '../../server/gmail-webhooks.ts';
export const Route = createFileRoute('/api/gmail/push')({ server: { handlers: { POST: gmailPush } } });
