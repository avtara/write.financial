// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who may create an account (FR-OP1, `instance_settings.registration_mode`):
 * - `open`: anyone.
 * - `closed` (self-host default) and `invite`: only with an invitation for that email. Email sign-up must carry
 *   the invitation token; Google sign-up, whose email the provider has verified, uses any pending invitation for
 *   that email. The difference between the two is who may issue invitations (`invitations.ts`).
 * The first admin is created by `createFirstAdmin`, not by sign-up.
 */
import { sha256Hex } from '@wf/crypto/hash';
import type { InstanceSettings } from '@wf/db/instance-settings';
import type { InvitationsRepository } from '@wf/db/invitations';

/** Sign-up needs an invitation and none was given. */
export class RegistrationClosedError extends Error {
  override readonly name = 'RegistrationClosedError';
  readonly code = 'REGISTRATION_CLOSED';

  constructor() {
    super('Registration on this instance is by invitation only');
  }
}

/** The invitation token is unknown, expired, used, or for another email. */
export class InvalidInvitationError extends Error {
  override readonly name = 'InvalidInvitationError';
  readonly code = 'INVALID_INVITATION';

  constructor() {
    super('The invitation is invalid, expired, already used, or for another email address');
  }
}

export type SignUpSource =
  | { readonly kind: 'email'; readonly invitationToken: string | null }
  /** Google sign-up: the provider verified the email. */
  | { readonly kind: 'provider' };

export interface RegistrationPolicy {
  /**
   * Checks an email sign-up before anything else happens, so an uninvited request learns nothing (not even
   * whether the email already has an account).
   * @throws {RegistrationClosedError | InvalidInvitationError}
   */
  checkEmailSignUp: (email: string, invitationToken: string | null) => Promise<void>;
  /**
   * Consumes the invitation for a user about to be created; `false` rejects the creation. Email sign-up must
   * present its token; provider sign-up uses any pending invitation for the email.
   */
  admitNewUser: (email: string, source: SignUpSource) => Promise<boolean>;
}

export interface RegistrationDeps {
  readonly settings: () => Promise<Pick<InstanceSettings, 'registrationMode'>>;
  readonly invitations: Pick<InvitationsRepository, 'isUsable' | 'claim' | 'claimForEmail'>;
}

export function createRegistrationPolicy({ settings, invitations }: RegistrationDeps): RegistrationPolicy {
  return {
    checkEmailSignUp: async (email, invitationToken) => {
      if ((await settings()).registrationMode === 'open') return;
      if (invitationToken === null) throw new RegistrationClosedError();
      if (!(await invitations.isUsable(sha256Hex(invitationToken), email))) throw new InvalidInvitationError();
    },
    admitNewUser: async (email, source) => {
      if ((await settings()).registrationMode === 'open') return true;
      if (source.kind === 'provider') return invitations.claimForEmail(email);
      return source.invitationToken !== null && invitations.claim(sha256Hex(source.invitationToken), email);
    },
  };
}
