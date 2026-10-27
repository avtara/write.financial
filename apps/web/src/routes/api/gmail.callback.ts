// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { gmailCallback } from '../../server/gmail-webhooks.ts';
export const Route = createFileRoute('/api/gmail/callback')({ server: { handlers: { GET: gmailCallback } } });
