// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'drizzle-kit';

/** `pnpm --filter @wf/db generate` diffs `src/schema.ts` against `migrations/meta` and writes the next SQL file. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
