// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { OverviewPage } from '../../components/overview-page.tsx';

export const Route = createFileRoute('/_app/')({ component: OverviewPage });
