// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { OverviewPage } from '../../components/overview-page.tsx';
import { Route } from './index.tsx';

describe('/ (Overview)', () => {
  it('renders the overview page', () => {
    expect(Route.options.component).toBe(OverviewPage);
  });
});
