// SPDX-License-Identifier: AGPL-3.0-only
/**
 * State of a Record Transaction form: the values, the idempotency key of the next submission (`clientId`, kept
 * across retries of the same entry), whether errors show yet, and the reference rates a cross-currency transfer
 * needs (FR-T4). While a rate refreshes, or when refreshing fails, the last one loaded stays in use.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { ReferenceRate } from '@wf/db/fx-rates';
import type { TagView } from '@wf/db/tags';
import type { Locale } from '@wf/domain/money';
import { m } from '@wf/i18n/messages';
import { toast } from '@wf/ui/toast';
import { useEffect, useRef, useState } from 'react';
import { getReferenceRate } from '../../server/fn/ledger.ts';
import type { RecordTransactionInput } from '../../server/fn/transactions-write.ts';
import {
  fxFigures,
  ratePair,
  shortfall,
  toRecordInput,
  transferAccounts,
  validate,
  type FormErrors,
  type FxFigures,
  type Shortfall,
  type TransactionFormValues,
} from './transaction-draft.ts';

/** What the ledger forms pick from (`listAccounts`, `listCategories`, `listTags`). */
export interface LedgerData {
  readonly baseCurrency: string;
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
  readonly tags: readonly TagView[];
}

/** `loading` also while a refresh runs over a rate already shown; `failed` keeps showing the last one. */
export type RateStatus = 'loading' | 'ready' | 'failed';

interface RateEntry {
  /** `undefined` until the first answer; `null` = no rate known for the pair. */
  readonly rate: ReferenceRate | null | undefined;
  readonly status: RateStatus;
}

export interface RateState {
  readonly status: RateStatus;
  /** The rate in use; during a refresh or after a failure, the last one loaded. */
  readonly reference: ReferenceRate | null;
  readonly refresh: () => void;
}

export interface TransactionFormState {
  readonly values: TransactionFormValues;
  readonly update: (patch: Partial<TransactionFormValues>) => void;
  /** Starts over with `values` and a new `clientId` (after saving, or when a draft opens). */
  readonly reset: (values: TransactionFormValues) => void;
  readonly errors: FormErrors;
  /** Errors show after the first attempt to save. */
  readonly showErrors: boolean;
  readonly figures: FxFigures | null;
  /** The reference rate of a cross-currency transfer; `null` otherwise. */
  readonly rate: RateState | null;
  readonly shortfall: Shortfall | null;
  /** The server input of the current values, or `null` (and errors shown) while they are invalid. */
  readonly prepare: (options: {
    readonly timeZone: string;
    readonly source: 'manual' | 'quick';
  }) => RecordTransactionInput | null;
}

const pairKey = (pair: { readonly base: string; readonly quote: string }) => `${pair.base}/${pair.quote}`;

export function useTransactionForm({
  initial,
  data,
  locale,
}: {
  readonly initial: TransactionFormValues;
  readonly data: LedgerData;
  readonly locale: Locale;
}): TransactionFormState {
  const [values, setValues] = useState(initial);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [showErrors, setShowErrors] = useState(false);
  const [rates, setRates] = useState<Readonly<Record<string, RateEntry>>>({});
  const requested = useRef(new Set<string>());

  const pair = values.type === 'transfer' ? transferAccounts(values, data.accounts) : null;
  const cross = pair !== null && pair.from.currency !== pair.to.currency ? pair : null;
  const referenceKey = cross === null ? null : pairKey(ratePair(cross.from.currency, cross.to.currency, data.baseCurrency));
  // Neither side in the base currency: the FX difference is valued with the destination → base rate.
  const toBaseKey =
    cross === null || cross.from.currency === data.baseCurrency || cross.to.currency === data.baseCurrency
      ? null
      : pairKey({ base: cross.to.currency, quote: data.baseCurrency });

  const load = (key: string) => {
    requested.current.add(key);
    const [base = '', quote = ''] = key.split('/');
    const fail = () => {
      setRates((current) => ({ ...current, [key]: { rate: current[key]?.rate, status: 'failed' } }));
      toast({
        tone: 'error',
        title: m.record_rate_failed_title(),
        description: m.record_rate_failed_description(),
        action: {
          label: m.record_rate_retry(),
          onClick: () => {
            refresh(key);
          },
        },
      });
    };
    getReferenceRate({ data: { base, quote } }).then((result) => {
      if (result.ok) setRates((current) => ({ ...current, [key]: { rate: result.value, status: 'ready' } }));
      else fail();
    }, fail);
  };
  const refresh = (key: string) => {
    setRates((current) => ({ ...current, [key]: { rate: current[key]?.rate, status: 'loading' } }));
    load(key);
  };

  useEffect(() => {
    for (const key of [referenceKey, toBaseKey]) {
      if (key !== null && !requested.current.has(key)) load(key);
    }
    // `load` only starts a request and reads state through updaters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceKey, toBaseKey]);

  const entry = referenceKey === null ? undefined : rates[referenceKey];
  const reference = entry?.rate ?? null;
  const toBase = toBaseKey === null ? null : (rates[toBaseKey]?.rate ?? null);
  const figures = fxFigures(values, {
    accounts: data.accounts,
    baseCurrency: data.baseCurrency,
    locale,
    reference,
    receivedToBase: toBase,
  });
  const errors = validate(values, data.accounts, figures);

  return {
    values,
    update: (patch) => {
      setValues((current) => ({ ...current, ...patch }));
    },
    reset: (next) => {
      setValues(next);
      setClientId(crypto.randomUUID());
      setShowErrors(false);
    },
    errors,
    showErrors,
    figures,
    rate:
      referenceKey === null
        ? null
        : {
            status: entry?.status ?? 'loading',
            reference,
            refresh: () => {
              refresh(referenceKey);
            },
          },
    shortfall: shortfall(values, data.accounts),
    prepare: ({ timeZone, source }) => {
      if (Object.keys(errors).length > 0) {
        setShowErrors(true);
        return null;
      }
      return toRecordInput(values, { clientId, timeZone, source, accounts: data.accounts, figures });
    },
  };
}
