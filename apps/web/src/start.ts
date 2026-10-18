// SPDX-License-Identifier: AGPL-3.0-only
import { createStart } from '@tanstack/react-start';
import { requestMiddleware } from './server/request-middleware.ts';

export const startInstance = createStart(() => ({ requestMiddleware: [requestMiddleware] }));
