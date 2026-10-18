// SPDX-License-Identifier: AGPL-3.0-only
import { createServerFn } from '@tanstack/react-start';

/**
 * The root route's loader: the display preferences the request middleware resolved for this request (and
 * rendered with). Runs during SSR; its result is dehydrated to the client.
 */
export const getPreferences = createServerFn({ method: 'GET' }).handler(({ context }) => context.preferences);
