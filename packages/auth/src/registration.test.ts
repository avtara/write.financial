// SPDX-License-Identifier: AGPL-3.0-only
import { sha256Hex } from '@wf/crypto/hash';
import type { RegistrationMode } from '@wf/db/instance-settings';
import { describe, expect, it, vi } from 'vitest';
import { createRegistrationPolicy, InvalidInvitationError, RegistrationClosedError } from './registration.ts';

const TOKEN = 'invitation-token';

function setup(mode: RegistrationMode, usable = true) {
  const invitations = {
    isUsable: vi.fn(() => Promise.resolve(usable)),
    claim: vi.fn(() => Promise.resolve(usable)),
    claimForEmail: vi.fn(() => Promise.resolve(usable)),
  };
  const policy = createRegistrationPolicy({
    settings: () => Promise.resolve({ registrationMode: mode }),
    invitations,
  });
  return { policy, invitations };
}

describe('open registration', () => {
  it('lets anyone sign up without touching invitations', async () => {
    const { policy, invitations } = setup('open');
    await expect(policy.checkEmailSignUp('a@example.test', null)).resolves.toBeUndefined();
    expect(await policy.admitNewUser('a@example.test', { kind: 'email', invitationToken: null })).toBe(true);
    expect(await policy.admitNewUser('a@example.test', { kind: 'provider' })).toBe(true);
    expect(invitations.isUsable).not.toHaveBeenCalled();
    expect(invitations.claim).not.toHaveBeenCalled();
    expect(invitations.claimForEmail).not.toHaveBeenCalled();
  });
});

describe.each(['closed', 'invite'] as const)('%s registration', (mode) => {
  it('refuses an email sign-up without an invitation', async () => {
    const { policy } = setup(mode);
    await expect(policy.checkEmailSignUp('a@example.test', null)).rejects.toBeInstanceOf(RegistrationClosedError);
    expect(await policy.admitNewUser('a@example.test', { kind: 'email', invitationToken: null })).toBe(false);
  });

  it('checks and then consumes the invitation by the hash of its token', async () => {
    const { policy, invitations } = setup(mode);
    await policy.checkEmailSignUp('a@example.test', TOKEN);
    expect(invitations.isUsable).toHaveBeenCalledWith(sha256Hex(TOKEN), 'a@example.test');
    expect(await policy.admitNewUser('a@example.test', { kind: 'email', invitationToken: TOKEN })).toBe(true);
    expect(invitations.claim).toHaveBeenCalledWith(sha256Hex(TOKEN), 'a@example.test');
  });

  it('refuses an unusable invitation', async () => {
    const { policy } = setup(mode, false);
    await expect(policy.checkEmailSignUp('a@example.test', TOKEN)).rejects.toBeInstanceOf(InvalidInvitationError);
    expect(await policy.admitNewUser('a@example.test', { kind: 'email', invitationToken: TOKEN })).toBe(false);
  });

  it('admits a provider sign-up only with a pending invitation for the email', async () => {
    expect(await setup(mode).policy.admitNewUser('a@example.test', { kind: 'provider' })).toBe(true);
    expect(await setup(mode, false).policy.admitNewUser('a@example.test', { kind: 'provider' })).toBe(false);
  });
});

describe('errors', () => {
  it('carry stable codes for the API', () => {
    expect(new RegistrationClosedError()).toMatchObject({
      code: 'REGISTRATION_CLOSED',
      name: 'RegistrationClosedError',
    });
    expect(new InvalidInvitationError()).toMatchObject({ code: 'INVALID_INVITATION', name: 'InvalidInvitationError' });
  });
});
