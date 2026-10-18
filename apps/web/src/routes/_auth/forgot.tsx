// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { ForgotPage } from '../../components/auth/forgot-page.tsx';

export const Route = createFileRoute('/_auth/forgot')({ component: ForgotPage });
