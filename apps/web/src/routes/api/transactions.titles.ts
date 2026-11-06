// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { serveTransactionTitles } from '../../server/transaction-titles.ts';

export const Route = createFileRoute('/api/transactions/titles')({
  server: { handlers: { GET: serveTransactionTitles } },
});
