// SPDX-License-Identifier: AGPL-3.0-only
import { isNotFound, isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { VIEWER } from '../../../test/fake-auth.ts';
import type { Viewer } from '../../server/gate.ts';
import { Route } from './settings.$section.tsx';

function beforeLoad(section: string, viewer: Viewer = VIEWER): unknown {
  const hook = Route.options.beforeLoad;
  if (typeof hook !== 'function') throw new Error('beforeLoad missing');
  try {
    return hook({ params: { section }, context: { viewer } } as never);
  } catch (error) {
    return error;
  }
}

describe('/settings/$section', () => {
  it('opens the Settings dialog on the section over the overview, in place of the link', () => {
    for (const [section, viewer] of [
      ['profile', VIEWER],
      ['tags', VIEWER],
      ['instance', { ...VIEWER, role: 'admin' }],
    ] as const) {
      const redirect = beforeLoad(section, viewer);
      expect(isRedirect(redirect)).toBe(true);
      expect(redirect).toMatchObject({ options: { to: '/', search: { settings: section }, replace: true } });
    }
  });

  it('answers 404 for unknown sections and for "instance" to non-admins', () => {
    expect(isNotFound(beforeLoad('billing'))).toBe(true);
    expect(isNotFound(beforeLoad('instance'))).toBe(true);
  });
});
