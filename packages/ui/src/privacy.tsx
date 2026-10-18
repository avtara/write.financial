// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, use, useMemo, type ReactNode } from 'react';

/** Privacy mode (PRD §6.2, design section 12): money amounts render as `Rp••••••`. */
export interface Privacy {
  /** `true` while balances are hidden. */
  readonly hidden: boolean;
  readonly setHidden: (hidden: boolean) => void;
  /** What assistive technology announces instead of a hidden amount, e.g. "nominal disembunyikan". */
  readonly hiddenLabel: string;
}

/** Thrown when a component that may show money renders outside `<PrivacyProvider>`. */
export class MissingPrivacyProviderError extends Error {
  override name = 'MissingPrivacyProviderError';
}

const PrivacyContext = createContext<Privacy | null>(null);

export interface PrivacyProviderProps {
  /** Controlled: the caller owns and persists the preference (per user or per device). */
  hidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
  hiddenLabel: string;
  children: ReactNode;
}

export function PrivacyProvider({ hidden, onHiddenChange, hiddenLabel, children }: PrivacyProviderProps) {
  const value = useMemo(
    () => ({ hidden, setHidden: onHiddenChange, hiddenLabel }),
    [hidden, onHiddenChange, hiddenLabel],
  );
  return <PrivacyContext value={value}>{children}</PrivacyContext>;
}

/**
 * Reads privacy mode. There is deliberately no default: rendering money without a provider
 * would silently show amounts that the user asked to hide.
 */
export function usePrivacy(): Privacy {
  const privacy = use(PrivacyContext);
  if (privacy === null) throw new MissingPrivacyProviderError('usePrivacy() needs a <PrivacyProvider> above it');
  return privacy;
}
