// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { fakeAuthActions } from '../../test/fake-auth.ts';
import type { AuthActions } from '../lib/auth-client.ts';
import { AuthActionsProvider, useAuthActions } from './auth-actions.tsx';

function Probe({ onActions }: { onActions: (actions: AuthActions) => void }) {
  onActions(useAuthActions());
  return null;
}

describe('useAuthActions', () => {
  it('returns the provided actions', async () => {
    const fake = fakeAuthActions();
    let seen: AuthActions | undefined;
    await render(
      <AuthActionsProvider actions={fake}>
        <Probe
          onActions={(actions) => {
            seen = actions;
          }}
        />
      </AuthActionsProvider>,
    );
    expect(seen).toBe(fake);
  });

  it('falls back to one browser client, created on first use', async () => {
    const seen: AuthActions[] = [];
    const collect = (actions: AuthActions) => {
      seen.push(actions);
    };
    await render(
      <>
        <Probe onActions={collect} />
        <Probe onActions={collect} />
      </>,
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(typeof seen[0]?.signInEmail).toBe('function');
    expect(new Set(seen).size).toBe(1);
  });
});
