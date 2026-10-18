// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ForgotPage } from '../../components/auth/forgot-page.tsx';
import { Route } from './forgot.tsx';

describe('/forgot', () => {
  it('renders the forgot-password page', () => {
    expect(Route.options.component).toBe(ForgotPage);
  });
});
