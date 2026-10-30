// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The design persona "Avtara" for 1–15 Oktober 2026 (design Section 00 "Sumber data" plus the Dashboard, Transaksi,
 * Rekening, Anggaran, Langganan and Kalender digests), with September 2026 as the closed period before it (Section 10
 * "Laporan September 2026", Section 06 `Z8qibf`). Account balances are as of 31 Agu, so that opening + the September
 * and October flows give the balances shown on 15 Okt. Merchants, dates and amounts the design shows are used
 * verbatim; the remaining daily spending is filled in so that every budget card and report total matches.
 */
import type { AlertPct } from './budget.ts';
import type { BuiltInCategoryKey } from './categories.ts';
import type { GoalAssetSourceMode } from './goal-assets.ts';
import type { GoalValuation } from './goals.ts';
import type { AssetClass } from './investments.ts';
import type { AccountType } from './ledger.ts';
import type { Market } from './market.ts';
import type { CancelMode, SubscriptionCycle, UsageRating } from './subscriptions.ts';

export interface SeedAccount {
  readonly key: string;
  readonly type: AccountType;
  readonly providerName: string;
  readonly displayName: string;
  readonly last4: string | null;
  readonly phoneMasked: string | null;
  readonly currency: string;
  readonly openingBalanceMinor: bigint;
  /** YYYY-MM-DD. */
  readonly openingDate: string;
  readonly color: string;
  readonly includeInAvailable: boolean;
  readonly isDefaultQuickEntry: boolean;
}

export type SeedTransaction =
  | {
      readonly kind: 'expense' | 'income';
      /** ISO 8601 with the +07:00 offset. */
      readonly occurredAt: string;
      readonly accountKey: string;
      readonly categoryKey: BuiltInCategoryKey;
      /** > 0, in the account currency. */
      readonly amountMinor: bigint;
      readonly merchant: string | null;
      readonly description: string | null;
      /** Lowercase slugs, at most 5. */
      readonly tags: readonly string[];
    }
  | {
      readonly kind: 'transfer';
      readonly occurredAt: string;
      readonly fromAccountKey: string;
      readonly toAccountKey: string;
      /** In the currency of the source account. */
      readonly sentMinor: bigint;
      /** In the currency of the destination account. */
      readonly receivedMinor: bigint;
      readonly description: string | null;
      readonly tags: readonly string[];
    };

export interface SeedFxRate {
  readonly base: string;
  readonly quote: string;
  /** Decimal string. */
  readonly rate: string;
  readonly asOf: string;
}

/** An account funding a goal (FR-G2): wholly, or a fixed amount of it. */
export interface SeedGoalSource {
  readonly accountKey: string;
  readonly mode: 'whole' | 'fixed';
  /** `fixed` only. */
  readonly amountMinor: bigint | null;
}

export interface SeedGoal {
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  /** "Dana tidak rutin" are sinking funds (FR-B6). */
  readonly kind: 'savings' | 'sinking';
  readonly targetMinor: bigint;
  /** Dana Darurat: "Target 3× pengeluaran bulanan"; `targetMinor` is the value in force. */
  readonly targetMonths: number | null;
  readonly currency: string;
  /** YYYY-MM. */
  readonly deadlineMonth: string | null;
  readonly tag: string | null;
  /** "Simpan di": where deposits go by default. */
  readonly accountKey: string | null;
  readonly sources: readonly SeedGoalSource[];
  /** Investment assets funding it (FR-G2): wholly, or `pctBps` of the units. */
  readonly assetSources: readonly {
    readonly assetKey: string;
    readonly mode: GoalAssetSourceMode;
    readonly pctBps: number | null;
  }[];
}

/**
 * An asset of the persona (design 09 "Kepemilikan") on its platform. `opening` is what was held before the ledger
 * starts (31 Agu, recorded as a purchase without a cash leg: "Pembelian yang belum dicatat"); `buys` are paid from
 * the platform's cash through the ledger (the 1st-of-month DCA, the RDPU buy still "diproses").
 */
export interface SeedAsset {
  readonly key: string;
  readonly accountKey: string;
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly market: Market;
  /** "Daftar saya" category name. */
  readonly category: string | null;
  /** The manual price at {@link SeedInvestments.priceAt}, quote major units. */
  readonly price: string;
  readonly opening: { readonly units: string; readonly amountMinor: bigint; readonly fxRate: string } | null;
  readonly buys: readonly {
    /** ISO 8601 with the +07:00 offset. */
    readonly occurredAt: string;
    readonly units: string;
    readonly price: string;
    /** Paid without fee or tax, platform currency minor units. */
    readonly amountMinor: bigint;
    readonly pending: boolean;
  }[];
}

/** Design 09 "Investasi" on 15 Okt 2026, 16.42 WIB (rate USD Rp16.350). */
export interface SeedInvestments {
  /** When the manual prices were taken ("harga 16.42 WIB"). */
  readonly priceAt: string;
  /** When the `opening` holdings are recorded: the day the accounts open (31 Agu). */
  readonly openedAt: string;
  readonly categories: readonly { readonly name: string; readonly assetClass: AssetClass }[];
  readonly assets: readonly SeedAsset[];
  /** Allocation targets per class (bps, Σ 10 000). */
  readonly targets: Readonly<Partial<Record<AssetClass, number>>>;
  /** Month-end portfolio values (growth chart). */
  readonly snapshots: readonly {
    readonly date: string;
    readonly valueMinor: bigint;
    readonly costMinor: bigint;
    readonly contributionsMinor: bigint;
  }[];
}

/**
 * A receivable as of 15 Okt (Section 19 "Piutang", `KZZZy`). The seed records them without ledger transactions
 * (lent and repaid before tracking, already reflected in the account balances), so the Section 00 balances, flows,
 * and transaction counts stay as designed.
 */
export interface SeedReceivable {
  readonly counterparty: string;
  readonly source: 'split_bill' | 'loan';
  readonly description: string | null;
  readonly amountMinor: bigint;
  readonly accountKey: string;
  /** ISO 8601 with the +07:00 offset. */
  readonly lentAt: string;
  readonly dueDate: string | null;
  /** H-1 09.00 reminder. */
  readonly remind: boolean;
  readonly payments: readonly {
    readonly amountMinor: bigint;
    readonly accountKey: string;
    readonly receivedAt: string;
  }[];
}

/** A budget version (`budget_versions` + `budget_lines`), lines by built-in category. */
export interface SeedBudgetVersion {
  /** YYYY-MM: the first period it applies to. */
  readonly effectiveFrom: string;
  readonly expectedIncomeMinor: bigint;
  readonly lines: readonly {
    readonly categoryKey: BuiltInCategoryKey;
    readonly limitMinor: bigint;
    readonly isFixed: boolean;
    readonly rollover: boolean;
    readonly alertPct: AlertPct;
  }[];
}

/** Explicit historical observations from Section 10, not reconstructed from October's live allocations. */
export interface SeedGoalSnapshot {
  readonly date: string;
  readonly recordedAt: string;
  readonly goals: readonly {
    readonly goal: string;
    readonly currency: string;
    readonly targetMinor: bigint;
    readonly savedMinor: bigint | null;
    readonly valuation: GoalValuation;
  }[];
}

/** A bill of a seed subscription or recurrence that a seed transaction already paid (a confirmed occurrence). */
export interface SeedPaidBill {
  readonly dueDate: string;
  /** `occurredAt` of the seed transaction that paid it. */
  readonly occurredAt: string;
}

/** A subscription (FR-SUB1) as of 15 Okt 2026 (design Section 07 "Langganan"). */
export interface SeedSubscription {
  readonly name: string;
  readonly plan: string | null;
  readonly icon: string;
  readonly description: string | null;
  readonly priceMinor: bigint;
  readonly currency: 'IDR';
  readonly cycle: SubscriptionCycle;
  /** The next bill not yet paid on 15 Okt (iCloud+: 9 Okt, overdue and unconfirmed). */
  readonly nextBillingDate: string;
  readonly accountKey: string;
  readonly categoryKey: BuiltInCategoryKey;
  /** `null` = no reminder. */
  readonly remindDaysBefore: number | null;
  readonly startedOn: string;
  readonly usageRating: UsageRating | null;
  readonly state:
    | { readonly status: 'active' }
    | { readonly status: 'paused'; readonly pausedOn: string; readonly pausedUntil: string }
    | { readonly status: 'cancelled'; readonly endsOn: string; readonly cancelMode: CancelMode };
  readonly paid: readonly SeedPaidBill[];
}

/** A monthly recurring transfer (FR-T6), Section 00 "Setoran rutin & investasi". */
export interface SeedRecurrence {
  readonly description: string;
  readonly fromAccountKey: string;
  readonly toAccountKey: string;
  readonly sentMinor: bigint;
  readonly receivedMinor: bigint;
  readonly tags: readonly string[];
  /**
   * Goal split shown in the Review queue ("DIBAGI KE"), by goal name, with the months each share runs (YYYY-MM;
   * `endMonth` `null` = until changed). Confirming an occurrence credits each running share to its goal in
   * `toAccountKey` (its fixed amount there grows, or one is made), so no other goal may hold that account wholly.
   */
  readonly allocations: readonly {
    readonly goal: string;
    readonly amountMinor: bigint;
    readonly startMonth: string;
    readonly endMonth: string | null;
  }[];
  readonly monthDay: number;
  readonly startOn: string;
  readonly remindOffsetDays: number;
  readonly paid: readonly SeedPaidBill[];
}

export interface DesignSeed {
  readonly baseCurrency: 'IDR';
  readonly timezone: 'Asia/Jakarta';
  /** Periods start on the 1st (Section 14 default; "Oktober" = 1–31 Okt, day 15 of 31 on 15 Okt). */
  readonly periodStartDay: 1;
  readonly accounts: readonly SeedAccount[];
  /** 1–15 Okt 2026: 128 transactions. */
  readonly transactions: readonly SeedTransaction[];
  /** 1–30 Sep 2026, the closed period: 121 transactions. */
  readonly septemberTransactions: readonly SeedTransaction[];
  /** Periods closed by the period close (FR-P3/P4): September, closed at the start of October. */
  readonly closedPeriods: readonly { readonly start: string; readonly end: string; readonly closedAt: string }[];
  readonly budgets: readonly SeedBudgetVersion[];
  readonly fxRates: readonly SeedFxRate[];
  readonly goals: readonly SeedGoal[];
  readonly goalSnapshots: readonly SeedGoalSnapshot[];
  /** 7 active (Rp904.900/bulan + Niagahoster Rp660.900/tahun), 1 paused, 3 cancelled. */
  readonly subscriptions: readonly SeedSubscription[];
  readonly recurrences: readonly SeedRecurrence[];
  /** Outstanding Rp542.500 (Nadia 242.500 + Raka 300.000), Dimas and Sari settled within 90 days. */
  readonly receivables: readonly SeedReceivable[];
  /** 5 platforms, 22 assets + the pending RDPU: Rp61.420.000, cost Rp53.931.000 (+Rp7.489.000). */
  readonly investments: SeedInvestments;
}

/** The balances of {@link ACCOUNTS} are as of this day; the seed opens the accounts a month earlier. */
const OPENING_DATE = '2026-09-30';

/** Comments give the balance on 15 Okt and the October flow (Section 00 card "Rekening · saldo & arus Oktober"). */
const ACCOUNTS: readonly SeedAccount[] = [
  // 42.810.000 = 41.610.000 + 24.700.000 in − 14.000.000 out − 9.500.000 transfers
  {
    key: 'bca',
    type: 'bank',
    providerName: 'Bank Central Asia',
    displayName: 'BCA Tahapan',
    last4: '4821',
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 41_610_000n,
    openingDate: OPENING_DATE,
    color: 'blue',
    includeInAvailable: true,
    isDefaultQuickEntry: true,
  },
  // 8.125.000 = 7.625.000 + 500.000 "Kantong darurat"
  {
    key: 'jago',
    type: 'bank',
    providerName: 'Bank Jago',
    displayName: 'Bank Jago',
    last4: '0377',
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 7_625_000n,
    openingDate: OPENING_DATE,
    color: 'orange',
    includeInAvailable: true,
    isDefaultQuickEntry: false,
  },
  // 3.240.000 = 3.840.000 + 1.300.000 in − 1.900.000 out
  {
    key: 'mandiri',
    type: 'bank',
    providerName: 'Bank Mandiri',
    displayName: 'Mandiri',
    last4: '9102',
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 3_840_000n,
    openingDate: OPENING_DATE,
    color: 'yellow',
    includeInAvailable: true,
    isDefaultQuickEntry: false,
  },
  // 412.000 = 812.000 − 400.000
  {
    key: 'gopay',
    type: 'ewallet',
    providerName: 'GoPay',
    displayName: 'GoPay',
    last4: null,
    phoneMasked: '0812•• 18',
    currency: 'IDR',
    openingBalanceMinor: 812_000n,
    openingDate: OPENING_DATE,
    color: 'green',
    includeInAvailable: true,
    isDefaultQuickEntry: false,
  },
  // 86.000 = 136.000 − 50.000
  {
    key: 'ovo',
    type: 'ewallet',
    providerName: 'OVO',
    displayName: 'OVO',
    last4: null,
    phoneMasked: '0812•• 18',
    currency: 'IDR',
    openingBalanceMinor: 136_000n,
    openingDate: OPENING_DATE,
    color: 'violet',
    includeInAvailable: true,
    isDefaultQuickEntry: false,
  },
  // 350.000 = 500.000 − 150.000
  {
    key: 'cash',
    type: 'cash',
    providerName: 'Tunai',
    displayName: 'Dompet (tunai)',
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 500_000n,
    openingDate: OPENING_DATE,
    color: 'amber',
    includeInAvailable: true,
    isDefaultQuickEntry: false,
  },
  // Platform cash only (holdings are investment trades): US$51,99 on 15 Okt = US$51,63 + US$366,97 top-up − US$366,61
  // DCA (SPY US$244,29 + SCHD US$122,32); with the holdings Gotrade is worth Rp45.420.000 (US$2.778).
  {
    key: 'gotrade',
    type: 'investment',
    providerName: 'Gotrade',
    displayName: 'Gotrade',
    last4: null,
    phoneMasked: null,
    currency: 'USD',
    openingBalanceMinor: 5_163n,
    openingDate: OPENING_DATE,
    color: 'cyan',
    includeInAvailable: false,
    isDefaultQuickEntry: false,
  },
  // No cash; holds BTC Rp5.500.000.
  {
    key: 'indodax',
    type: 'investment',
    providerName: 'Indodax',
    displayName: 'Indodax',
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 0n,
    openingDate: OPENING_DATE,
    color: 'blue',
    includeInAvailable: false,
    isDefaultQuickEntry: false,
  },
  // No cash; holds BBCA, BBRI, TLKM Rp4.300.000.
  {
    key: 'stockbit',
    type: 'investment',
    providerName: 'Stockbit',
    displayName: 'Stockbit',
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 0n,
    openingDate: OPENING_DATE,
    color: 'red',
    includeInAvailable: false,
    isDefaultQuickEntry: false,
  },
  // No cash; holds XAU Rp3.700.000.
  {
    key: 'pluang',
    type: 'investment',
    providerName: 'Pluang',
    displayName: 'Pluang',
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 0n,
    openingDate: OPENING_DATE,
    color: 'violet',
    includeInAvailable: false,
    isDefaultQuickEntry: false,
  },
  // No cash: the 14 Okt Rp3.000.000 paid the RDPU buy, still "diproses" (NAB 16 Okt); holds IDX30 1.000.000 + ORI
  // 1.500.000 (Section 01 "Bibit RDPU · Reksa dana & SBN · Rp2.500.000").
  {
    key: 'bibit',
    type: 'investment',
    providerName: 'Bibit',
    displayName: 'Bibit',
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 0n,
    openingDate: OPENING_DATE,
    color: 'green',
    includeInAvailable: false,
    isDefaultQuickEntry: false,
  },
];

/** `[local time "MM-DD HH:mm" in Oktober 2026 (WIB), account key, category, amount, merchant, description, tags]`. */
type FlowRow = readonly [string, string, BuiltInCategoryKey, bigint, string | null, string | null, readonly string[]];

/** Section 00: Rp26.000.000 in 4 transactions. */
const INCOME_ROWS: readonly FlowRow[] = [
  ['10-01 08:00', 'bca', 'system:salary', 18_500_000n, 'PT Kinarya', 'Gaji Oktober', ['gaji']],
  ['10-08 00:05', 'mandiri', 'system:dividend_interest', 210_000n, 'Bank Mandiri', 'Dividen & bunga', []],
  ['10-08 10:30', 'mandiri', 'system:sales', 1_090_000n, null, 'Penjualan & lainnya', []],
  [
    '10-14 21:03',
    'bca',
    'system:freelance',
    6_200_000n,
    'Studio Arunika',
    'Invoice #0912',
    ['freelance', 'studio-arunika'],
  ],
];

/** Section 00: Rp16.500.000 in 121 transactions (needs 10.400.000, wants 6.100.000). */
const EXPENSE_ROWS: readonly FlowRow[] = [
  ['10-01 09:15', 'bca', 'system:rent', 4_500_000n, 'Sewa Kos', 'Oktober', ['rumah']],
  ['10-01 19:40', 'gopay', 'system:food', 250_000n, 'Indomaret', 'Stok dapur', ['belanja-bulanan']],
  ['10-01 21:05', 'gopay', 'system:transport', 100_000n, 'Gojek', 'GoCar pulang', []],
  ['10-02 07:50', 'bca', 'system:transport', 23_000n, 'Gojek', 'Ke kantor', ['kantor']],
  ['10-02 10:00', 'bca', 'system:bills', 150_000n, 'Iuran kos', 'Kebersihan & keamanan', ['rumah', 'bulanan']],
  ['10-02 12:15', 'bca', 'system:food', 20_000n, 'Nasi uduk', 'Sarapan telat', []],
  ['10-02 13:10', 'bca', 'system:entertainment', 28_000n, 'Kopi Kenangan', null, ['kerja']],
  ['10-02 15:30', 'cash', 'system:entertainment', 12_000n, 'Es Teh Indonesia', null, []],
  ['10-02 17:40', 'bca', 'system:transport', 6_000n, 'KRL Commuter', null, ['kantor']],
  ['10-02 18:20', 'bca', 'system:transport', 18_000n, 'Gojek', null, []],
  ['10-02 19:30', 'bca', 'system:entertainment', 25_000n, 'Chatime', null, []],
  ['10-02 20:45', 'bca', 'system:entertainment', 33_000n, 'Fore Coffee', null, []],
  ['10-02 21:30', 'bca', 'system:transport', 25_000n, 'Grab', null, []],
  ['10-02 22:30', 'cash', 'system:transport', 9_000n, 'Ojek pangkalan', null, []],
  ['10-03 08:30', 'bca', 'system:subscriptions', 199_000n, 'Fit Hub', 'Gym bulanan', ['bulanan']],
  ['10-03 09:12', 'ovo', 'system:food', 25_500n, 'Alfamart', null, []],
  ['10-03 10:30', 'bca', 'system:transport', 32_000n, 'Gojek', null, ['akhir-pekan']],
  ['10-03 11:15', 'bca', 'system:entertainment', 45_000n, 'Tomoro Coffee', null, ['akhir-pekan']],
  ['10-03 11:50', 'bca', 'system:entertainment', 40_000n, 'Fore Coffee', null, ['akhir-pekan']],
  ['10-03 13:00', 'bca', 'system:food', 165_000n, 'Sate Khas Senayan', 'Makan siang', ['akhir-pekan']],
  ['10-03 14:30', 'bca', 'system:entertainment', 75_000n, 'Timezone', null, ['akhir-pekan']],
  ['10-03 16:00', 'cash', 'system:transport', 10_000n, 'Parkir motor', null, []],
  ['10-03 16:40', 'bca', 'system:entertainment', 52_000n, 'Kopi Kenangan', null, ['akhir-pekan']],
  ['10-03 18:00', 'bca', 'system:transport', 21_000n, 'Gojek', null, ['akhir-pekan']],
  ['10-03 19:10', 'bca', 'system:entertainment', 64_500n, 'Steam', 'Game indie', []],
  ['10-03 20:30', 'bca', 'system:transport', 38_000n, 'Grab', null, ['akhir-pekan']],
  ['10-03 21:20', 'bca', 'system:entertainment', 30_000n, 'Chatime', null, []],
  ['10-03 22:10', 'bca', 'system:transport', 44_000n, 'Gojek', null, ['akhir-pekan']],
  ['10-04 08:30', 'cash', 'system:entertainment', 18_000n, 'Kopi warung', null, []],
  ['10-04 09:30', 'bca', 'system:transport', 29_000n, 'Gojek', null, ['akhir-pekan']],
  ['10-04 10:45', 'bca', 'system:entertainment', 47_500n, 'Timezone', null, ['akhir-pekan']],
  ['10-04 12:15', 'bca', 'system:food', 98_000n, 'Bakmi GM', 'Makan siang', ['akhir-pekan']],
  ['10-04 14:00', 'bca', 'system:entertainment', 85_000n, 'Gramedia World', 'Majalah & stiker', []],
  ['10-04 15:40', 'bca', 'system:entertainment', 40_000n, 'Janji Jiwa', null, []],
  ['10-04 17:30', 'bca', 'system:transport', 36_000n, 'Grab', null, ['akhir-pekan']],
  ['10-04 18:10', 'cash', 'system:transport', 10_000n, 'Parkir motor', null, []],
  ['10-04 19:00', 'bca', 'system:entertainment', 58_000n, 'Mixue', null, ['akhir-pekan']],
  ['10-04 20:10', 'bca', 'system:transport', 26_000n, 'Grab', null, []],
  ['10-04 21:00', 'bca', 'system:transport', 36_000n, 'Gojek', null, []],
  ['10-05 07:15', 'bca', 'system:transport', 6_000n, 'KRL Commuter', null, ['kantor']],
  ['10-05 07:45', 'bca', 'system:transport', 22_000n, 'Gojek', 'Ke kantor', ['kantor']],
  ['10-05 08:00', 'bca', 'system:subscriptions', 660_900n, 'Niagahoster', 'Hosting tahunan', ['kerja']],
  ['10-05 08:02', 'bca', 'system:subscriptions', 26_900n, 'Google One', 'Penyimpanan 100 GB', ['bulanan']],
  ['10-05 10:30', 'bca', 'system:entertainment', 32_000n, 'Kopi Kenangan', null, ['kerja']],
  ['10-05 15:20', 'bca', 'system:entertainment', 26_000n, 'Roti O', null, []],
  ['10-05 17:50', 'bca', 'system:transport', 6_000n, 'KRL Commuter', null, ['kantor']],
  ['10-05 18:20', 'bca', 'system:transport', 19_000n, 'Gojek', null, []],
  ['10-05 19:20', 'mandiri', 'system:food', 600_000n, 'Lotte Mart', 'Stok dapur', ['belanja-bulanan']],
  ['10-05 20:30', 'bca', 'system:entertainment', 49_000n, 'Steam', 'DLC game', []],
  ['10-06 07:10', 'bca', 'system:transport', 20_000n, 'Gojek', 'Ke kantor', ['kantor']],
  ['10-06 07:50', 'bca', 'system:transport', 6_000n, 'KRL Commuter', null, ['kantor']],
  ['10-06 09:00', 'bca', 'system:bills', 150_000n, 'Telkomsel Halo', 'Paket bulanan', ['bulanan']],
  ['10-06 10:40', 'bca', 'system:entertainment', 30_000n, 'Fore Coffee', null, ['kerja']],
  ['10-06 12:20', 'bca', 'system:food', 42_000n, 'GrabFood', 'Nasi Padang', ['kantor']],
  ['10-06 15:10', 'bca', 'system:entertainment', 27_000n, 'Kopi Kenangan', null, ['kerja']],
  ['10-06 18:05', 'bca', 'system:transport', 21_000n, 'Gojek', null, []],
  ['10-06 19:30', 'bca', 'system:entertainment', 42_000n, 'Mixue', null, []],
  ['10-06 21:10', 'bca', 'system:transport', 6_000n, 'KRL Commuter', null, []],
  ['10-07 07:20', 'bca', 'system:transport', 6_000n, 'KRL Commuter', null, ['kantor']],
  ['10-07 07:40', 'bca', 'system:transport', 24_000n, 'Gojek', 'Ke kantor', ['kantor']],
  ['10-07 10:15', 'bca', 'system:entertainment', 33_000n, 'Tomoro Coffee', null, ['kerja']],
  ['10-07 13:00', 'cash', 'system:entertainment', 12_000n, 'Es Teh Indonesia', null, []],
  ['10-07 17:45', 'bca', 'system:transport', 6_000n, 'KRL Commuter', null, ['kantor']],
  ['10-07 18:30', 'cash', 'system:transport', 8_000n, 'Ojek pangkalan', null, []],
  ['10-07 19:45', 'bca', 'system:entertainment', 55_000n, 'Popmart', 'Blind box', []],
  ['10-07 20:10', 'bca', 'system:food', 662_000n, 'Sayurbox', 'Stok dapur', ['belanja-bulanan']],
  ['10-07 21:00', 'bca', 'system:transport', 22_000n, 'Grab', null, []],
  ['10-08 07:15', 'bca', 'system:transport', 22_000n, 'Gojek', 'Ke kantor', ['kantor']],
  ['10-08 07:55', 'bca', 'system:transport', 6_000n, 'KRL Commuter', null, ['kantor']],
  ['10-08 08:30', 'bca', 'system:entertainment', 29_000n, 'Kopi Kenangan', null, ['kerja']],
  ['10-08 12:30', 'bca', 'system:food', 64_000n, 'Solaria', 'Makan siang', ['kantor']],
  ['10-08 15:00', 'cash', 'system:entertainment', 15_000n, 'Es Teh Indonesia', null, []],
  ['10-08 17:50', 'bca', 'system:transport', 6_000n, 'KRL Commuter', null, ['kantor']],
  ['10-08 18:10', 'bca', 'system:transport', 20_000n, 'Gojek', null, []],
  ['10-08 19:40', 'bca', 'system:entertainment', 38_000n, 'Janji Jiwa', null, []],
  ['10-08 20:30', 'bca', 'system:transport', 23_000n, 'Gojek', null, []],
  ['10-08 21:30', 'bca', 'system:subscriptions', 13_200n, 'Google Play', 'Langganan aplikasi catatan', []],
  ['10-09 08:40', 'mandiri', 'system:bills', 280_000n, 'PAM Jaya', 'Air bulanan', ['rumah', 'bulanan']],
  ['10-09 20:05', 'mandiri', 'system:bills', 100_000n, 'Tokopedia', 'Pulsa & data', []],
  ['10-09 21:15', 'mandiri', 'system:hobby', 560_000n, 'Tokopedia', 'Cat akrilik & kanvas', []],
  ['10-10 07:30', 'cash', 'system:food', 15_000n, 'Bubur ayam', null, []],
  ['10-10 09:00', 'bca', 'system:transport', 30_000n, 'Gojek', null, ['akhir-pekan']],
  ['10-10 10:15', 'bca', 'system:entertainment', 48_000n, 'Starbucks', null, ['akhir-pekan']],
  ['10-10 11:00', 'gopay', 'system:transport', 5_000n, 'GoPay', 'Parkir mal', []],
  ['10-10 11:20', 'bca', 'system:entertainment', 35_000n, 'Tomoro Coffee', null, ['akhir-pekan']],
  ['10-10 12:10', 'cash', 'system:transport', 5_000n, 'Parkir motor', null, []],
  ['10-10 12:30', 'bca', 'system:food', 160_000n, 'Sushi Tei', 'Makan siang', ['akhir-pekan']],
  ['10-10 13:45', 'bca', 'system:transport', 35_000n, 'Grab', null, ['akhir-pekan']],
  ['10-10 14:20', 'cash', 'system:entertainment', 20_000n, 'Gorengan', null, []],
  ['10-10 15:10', 'bca', 'system:entertainment', 30_000n, 'Timezone', null, ['akhir-pekan']],
  ['10-10 15:30', 'mandiri', 'system:hobby', 140_000n, 'Gramedia', 'Buku sketsa', []],
  ['10-10 16:30', 'bca', 'system:entertainment', 36_000n, 'Janji Jiwa', null, []],
  ['10-10 17:30', 'bca', 'system:transport', 40_000n, 'Gojek', null, ['akhir-pekan']],
  ['10-10 18:15', 'cash', 'system:transport', 10_000n, 'Parkir motor', null, []],
  ['10-10 18:45', 'bca', 'system:transport', 23_000n, 'KRL Commuter', 'Kartu multi-trip', []],
  ['10-10 19:10', 'bca', 'system:entertainment', 35_000n, 'Chatime', null, ['akhir-pekan']],
  ['10-10 20:00', 'mandiri', 'system:entertainment', 220_000n, 'Loket', 'Tiket stand-up comedy', ['akhir-pekan']],
  ['10-10 20:20', 'bca', 'system:transport', 64_000n, 'Grab', 'Pulang malam', ['akhir-pekan']],
  ['10-10 21:30', 'bca', 'system:food', 30_000n, 'Martabak Bangka', null, []],
  ['10-10 21:50', 'bca', 'system:entertainment', 38_000n, 'Kopi Kenangan', null, []],
  ['10-10 22:40', 'bca', 'system:transport', 52_000n, 'Grab', null, ['akhir-pekan']],
  ['10-10 23:10', 'bca', 'system:transport', 48_000n, 'Gojek', null, ['akhir-pekan']],
  ['10-11 10:05', 'bca', 'system:food', 642_000n, 'Superindo', null, ['belanja-bulanan']],
  ['10-11 13:20', 'gopay', 'system:transport', 45_000n, 'Gojek', null, []],
  ['10-11 14:12', 'bca', 'system:shopping', 2_150_000n, 'Erafone', 'Headphone', ['gadget', 'kerja']],
  ['10-11 16:48', 'bca', 'system:entertainment', 58_000n, 'Kopi Kenangan', null, ['akhir-pekan']],
  [
    '10-11 19:30',
    'bca',
    'system:entertainment',
    485_000n,
    'CGV Grand Indonesia',
    'Nonton bareng',
    ['akhir-pekan', 'date-night'],
  ],
  ['10-12 07:40', 'bca', 'system:transport', 200_000n, 'Pertamina', null, []],
  ['10-12 08:30', 'cash', 'system:entertainment', 6_000n, 'Kopi warung', null, []],
  ['10-12 16:10', 'bca', 'system:bills', 270_000n, 'Biznet Internet', null, ['bulanan']],
  ['10-12 18:20', 'ovo', 'system:food', 24_500n, 'Indomaret Point', null, []],
  ['10-13 08:05', 'bca', 'system:transport', 26_000n, 'KRL Commuter', null, ['kantor']],
  ['10-13 12:30', 'bca', 'system:food', 50_000n, 'Mie Gacoan', null, []],
  ['10-13 19:48', 'bca', 'system:food', 214_000n, 'Superindo', null, ['belanja-bulanan']],
  ['10-14 10:20', 'bca', 'system:entertainment', 48_000n, 'Starbucks', null, ['kerja']],
  ['10-14 17:45', 'bca', 'system:transport', 63_000n, 'Grab', null, []],
  ['10-14 18:02', 'bca', 'system:bills', 350_000n, 'PLN Token Listrik', null, ['rumah']],
  ['10-14 20:14', 'bca', 'system:shopping', 250_000n, 'Shopee', 'Rak buku 5 susun', ['rumah', 'ruang-kerja']],
  ['10-15 07:55', 'bca', 'system:food', 110_000n, 'Indomaret', null, []],
  ['10-15 08:12', 'bca', 'system:transport', 42_000n, 'Gojek', 'Ke kantor', ['kantor']],
  ['10-15 12:41', 'bca', 'system:food', 28_000n, 'Warteg Bahari', null, ['kantor']],
];

/** Section 00 "Setoran rutin & investasi": the 3 transfers (Rp9.500.000). */
const TRANSFERS: readonly SeedTransaction[] = [
  {
    kind: 'transfer',
    occurredAt: '2026-10-01T08:30:00+07:00',
    fromAccountKey: 'bca',
    toAccountKey: 'gotrade',
    sentMinor: 6_000_000n,
    receivedMinor: 36_697n,
    description: 'DCA SPY 4.000.000 + SCHD 2.000.000',
    tags: ['dp-rumah', 'dana-pensiun'],
  },
  {
    kind: 'transfer',
    occurredAt: '2026-10-01T08:35:00+07:00',
    fromAccountKey: 'bca',
    toAccountKey: 'jago',
    sentMinor: 500_000n,
    receivedMinor: 500_000n,
    description: 'Kantong darurat',
    tags: ['dana-darurat'],
  },
  {
    kind: 'transfer',
    occurredAt: '2026-10-14T19:30:00+07:00',
    fromAccountKey: 'bca',
    toAccountKey: 'bibit',
    sentMinor: 3_000_000n,
    receivedMinor: 3_000_000n,
    description: 'Setor dana darurat · Bibit RDPU',
    tags: ['dana-darurat'],
  },
];

/** Section 10 "Laporan September 2026": Rp25.800.000 in 4 transactions. */
const SEPTEMBER_INCOME_ROWS: readonly FlowRow[] = [
  ['09-01 08:00', 'bca', 'system:salary', 18_500_000n, 'PT Kinarya', 'Gaji September', ['gaji']],
  ['09-08 00:05', 'mandiri', 'system:dividend_interest', 270_000n, 'Bank Mandiri', 'Dividen & bunga', []],
  ['09-10 11:20', 'mandiri', 'system:sales', 1_130_000n, null, 'Penjualan & lainnya', []],
  [
    '09-15 20:40',
    'bca',
    'system:freelance',
    5_900_000n,
    'Studio Arunika',
    'Invoice #0897',
    ['freelance', 'studio-arunika'],
  ],
];

/**
 * The September expenses the design names (Section 06 `Z8qibf`, Section 10, Section 13, Section 14): Sewa Kos, the
 * 9.9 Shopee sale with the ergonomic chair, Tokopedia — Sepatu lari Rp449.000 on 27 Sep (the largest transaction of
 * 25–30 Sep, which moves into October when periods start on the 25th), bills, subscriptions, and the categories
 * without daily filler.
 */
const SEPTEMBER_EXPENSE_ROWS: readonly FlowRow[] = [
  ['09-01 09:15', 'bca', 'system:rent', 4_500_000n, 'Sewa Kos', 'September', ['rumah']],
  ['09-02 10:00', 'bca', 'system:bills', 150_000n, 'Iuran kos', 'Kebersihan & keamanan', ['rumah', 'bulanan']],
  ['09-03 08:30', 'bca', 'system:subscriptions', 199_000n, 'Fit Hub', 'Gym bulanan', ['bulanan']],
  ['09-04 20:10', 'bca', 'system:shopping', 110_000n, 'Shopee', 'Kabel data', []],
  ['09-05 16:30', 'bca', 'system:hobby', 180_000n, 'Gramedia', 'Buku', []],
  ['09-06 18:45', 'gopay', 'system:health', 120_000n, 'Apotek K-24', null, []],
  ['09-07 11:00', 'cash', 'system:personal_care', 85_000n, 'Barbershop', null, []],
  ['09-09 00:15', 'bca', 'system:shopping', 1_050_000n, 'Shopee', 'Kursi kerja ergonomis', ['ruang-kerja']],
  ['09-09 00:20', 'bca', 'system:shopping', 230_000n, 'Shopee', 'Lampu meja', ['ruang-kerja']],
  ['09-09 09:00', 'bca', 'system:subscriptions', 45_000n, 'iCloud+', '200 GB', ['bulanan']],
  ['09-09 12:30', 'bca', 'system:shopping', 185_000n, 'Shopee', 'Rak sepatu', ['rumah']],
  ['09-09 21:10', 'bca', 'system:shopping', 96_000n, 'Shopee', 'Alat tulis', []],
  ['09-09 21:40', 'bca', 'system:bills', 350_000n, 'PLN Token Listrik', null, ['rumah']],
  ['09-11 19:00', 'bca', 'system:gifts', 150_000n, 'Kitabisa', 'Donasi', []],
  ['09-12 08:00', 'bca', 'system:bills', 500_000n, 'PDAM', 'Air', ['rumah']],
  ['09-12 10:30', 'bca', 'system:subscriptions', 274_100n, 'Canva', 'Canva Pro', ['kerja']],
  ['09-12 22:00', 'bca', 'system:hobby', 220_000n, 'Steam', null, []],
  ['09-13 15:20', 'bca', 'system:shopping', 200_000n, 'Uniqlo', 'Kaos', []],
  ['09-15 13:40', 'bca', 'system:shopping', 120_000n, 'Shopee', 'Botol minum', []],
  ['09-16 17:15', 'bca', 'system:health', 180_000n, 'Klinik Pratama', 'Periksa', []],
  ['09-17 19:30', 'cash', 'system:hobby', 175_000n, 'Futsal', 'Sewa lapangan', ['akhir-pekan']],
  ['09-18 09:00', 'bca', 'system:subscriptions', 186_000n, 'Netflix', 'Premium 4K', ['bulanan']],
  ['09-19 18:00', 'bca', 'system:gifts', 400_000n, 'Kado nikahan', null, []],
  ['09-20 10:00', 'bca', 'system:bills', 400_000n, 'IndiHome', 'Internet', ['rumah', 'bulanan']],
  ['09-20 16:00', 'bca', 'system:hobby', 150_000n, 'Toko Buku Kalam', null, []],
  ['09-21 20:30', 'bca', 'system:shopping', 160_000n, 'Shopee', 'Sprei', ['rumah']],
  ['09-22 09:00', 'bca', 'system:subscriptions', 59_000n, 'YouTube Premium', null, ['bulanan']],
  ['09-23 14:00', 'ovo', 'system:personal_care', 165_000n, 'Guardian', null, []],
  ['09-24 09:00', 'bca', 'system:subscriptions', 86_900n, 'Spotify', 'Family', ['bulanan']],
  ['09-26 19:00', 'bca', 'system:gifts', 150_000n, 'Kado ulang tahun', null, []],
  ['09-27 13:05', 'bca', 'system:shopping', 449_000n, 'Tokopedia', 'Sepatu lari', []],
  ['09-29 19:30', 'cash', 'system:hobby', 175_000n, 'Futsal', 'Sewa lapangan', []],
];

/**
 * Daily spending filled in so that the September categories match the report (Makan & Dapur 3.400.000, Transportasi
 * 1.600.000, Hiburan 1.800.000): `count` rows spread over 2–30 Sep, amounts varying around the average, the last one
 * taking the remainder.
 */
const SEPTEMBER_FILLER: readonly {
  readonly categoryKey: BuiltInCategoryKey;
  readonly totalMinor: bigint;
  readonly count: number;
  readonly stepMinor: bigint;
  readonly merchants: readonly string[];
  readonly accountKeys: readonly string[];
}[] = [
  {
    categoryKey: 'system:food',
    totalMinor: 3_400_000n,
    count: 34,
    stepMinor: 10_000n,
    merchants: ['Indomaret', 'Warteg Bahari', 'GoFood', 'Superindo', 'Alfamart', 'Nasi Padang Sederhana'],
    accountKeys: ['bca', 'gopay', 'bca', 'ovo', 'cash'],
  },
  {
    categoryKey: 'system:transport',
    totalMinor: 1_600_000n,
    count: 28,
    stepMinor: 5_000n,
    merchants: ['Gojek', 'Grab', 'KRL Commuter', 'Pertamina'],
    accountKeys: ['bca', 'gopay', 'bca', 'cash'],
  },
  {
    categoryKey: 'system:entertainment',
    totalMinor: 1_800_000n,
    count: 20,
    stepMinor: 10_000n,
    merchants: ['Kopi Kenangan', 'Starbucks', 'CGV', 'Fore Coffee', 'Chatime'],
    accountKeys: ['bca', 'gopay', 'bca', 'ovo'],
  },
];

function septemberFiller(): FlowRow[] {
  return SEPTEMBER_FILLER.flatMap(({ categoryKey, totalMinor, count, stepMinor, merchants, accountKeys }) => {
    const average = (totalMinor / BigInt(count) / stepMinor) * stepMinor;
    const rows: FlowRow[] = [];
    let left = totalMinor;
    for (let index = 0; index < count; index += 1) {
      const amountMinor = index === count - 1 ? left : average + BigInt((index % 5) - 2) * stepMinor;
      left -= amountMinor;
      const day = String(2 + Math.floor((index * 29) / count)).padStart(2, '0');
      const hour = String(7 + ((index * 5) % 15)).padStart(2, '0');
      const minute = String((index * 13 + categoryKey.length) % 60).padStart(2, '0');
      rows.push([
        `09-${day} ${hour}:${minute}`,
        accountKeys[index % accountKeys.length] as string,
        categoryKey,
        amountMinor,
        merchants[index % merchants.length] as string,
        null,
        [],
      ]);
    }
    return rows;
  });
}

/** Section 00 "Ditabung per bulan · Sep · 2,5 + 5,0": the September transfers (Rp7.500.000). */
const SEPTEMBER_TRANSFERS: readonly SeedTransaction[] = [
  {
    kind: 'transfer',
    occurredAt: '2026-09-01T08:30:00+07:00',
    fromAccountKey: 'bca',
    toAccountKey: 'gotrade',
    sentMinor: 5_000_000n,
    // round(5.000.000 / 16.350 × 100) cents.
    receivedMinor: 30_581n,
    description: 'DCA SPY + SCHD',
    tags: ['dp-rumah', 'dana-pensiun'],
  },
  {
    kind: 'transfer',
    occurredAt: '2026-09-01T08:35:00+07:00',
    fromAccountKey: 'bca',
    toAccountKey: 'jago',
    sentMinor: 500_000n,
    receivedMinor: 500_000n,
    description: 'Kantong darurat',
    tags: ['dana-darurat'],
  },
  {
    kind: 'transfer',
    occurredAt: '2026-09-14T19:30:00+07:00',
    fromAccountKey: 'bca',
    toAccountKey: 'jago',
    sentMinor: 2_000_000n,
    receivedMinor: 2_000_000n,
    description: 'Setor dana darurat',
    tags: ['dana-darurat'],
  },
];

/**
 * Section 06 "Riwayat perubahan": the version in force since September 2026 (Rp18.750.000, the limits of the Section 00
 * card "Anggaran Oktober" and the September results). Sewa Kos, Tagihan & Utilitas, and Langganan are fixed costs
 * ("lunas 1 Okt", no daily rate).
 */
const BUDGETS: readonly SeedBudgetVersion[] = [
  {
    effectiveFrom: '2026-09',
    expectedIncomeMinor: 26_000_000n,
    lines: (
      [
        ['system:rent', 4_500_000n, true],
        ['system:food', 3_500_000n, false],
        ['system:transport', 2_000_000n, false],
        ['system:bills', 1_500_000n, true],
        ['system:health', 500_000n, false],
        ['system:shopping', 2_000_000n, false],
        ['system:entertainment', 2_500_000n, false],
        ['system:subscriptions', 1_000_000n, true],
        ['system:hobby', 1_000_000n, false],
        ['system:personal_care', 250_000n, false],
      ] as const
    ).map(([categoryKey, limitMinor, isFixed]) => ({
      categoryKey,
      limitMinor,
      isFixed,
      rollover: false,
      alertPct: 85,
    })),
  },
];

function flowTransactions(kind: 'expense' | 'income', rows: readonly FlowRow[]): SeedTransaction[] {
  return rows.map(([localTime, accountKey, categoryKey, amountMinor, merchant, description, tags]) => ({
    kind,
    occurredAt: `2026-${localTime.replace(' ', 'T')}:00+07:00`,
    accountKey,
    categoryKey,
    amountMinor,
    merchant,
    description,
    tags,
  }));
}

/** Moves `balances` (per account key) by the transactions' flows in each account's own currency. */
function post(balances: Map<string, bigint>, transactions: readonly SeedTransaction[], sign: 1n | -1n): void {
  const move = (accountKey: string, deltaMinor: bigint): void => {
    const balance = balances.get(accountKey);
    if (balance === undefined) throw new RangeError(`unknown seed account: ${accountKey}`);
    balances.set(accountKey, balance + sign * deltaMinor);
  };
  for (const transaction of transactions) {
    if (transaction.kind === 'transfer') {
      move(transaction.fromAccountKey, -transaction.sentMinor);
      move(transaction.toAccountKey, transaction.receivedMinor);
    } else {
      move(transaction.accountKey, transaction.kind === 'income' ? transaction.amountMinor : -transaction.amountMinor);
    }
  }
}

/**
 * Design 09 holdings (15 Okt, 16.42 WIB). Values are the design's per asset (USD at Rp16.350, units exact to 12
 * digits); US$ gains are the table's (cost = value − gain), IDR gains the table's. The design does not show every
 * price: QQQ, VEA, SCHD, VWO, SGOV, YieldMax, the US individual stocks, BTC, XAU, the IDX stocks, and the NAVs are
 * illustrative, and the US individual split (NVDA 1.650.000 from OgLFo) is ours. SGOV is Rp3.449.963 so that with
 * the US$51,99 cash (Rp850.037) Gotrade is Rp45.420.000. The rows' gains add up to Rp7.493.903 while the KPI is
 * Rp7.489.000 (value 61.420.000 − cost 53.931.000): QQQ's opening buy carries the Rp4.638 difference in its rate.
 */
const ASSETS: readonly SeedAsset[] = [
  {
    key: 'spy',
    accountKey: 'gotrade',
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF',
    assetClass: 'us_stocks',
    market: 'us_equity',
    category: null,
    price: '690.10',
    // Rp13.500.000 now.
    opening: { units: '0.564475979415', amountMinor: 26_948n, fxRate: '16349.85898768' },
    buys: [
      {
        occurredAt: '2026-09-01T09:00:00+07:00',
        units: '0.276',
        price: '664.80',
        amountMinor: 18_348n,
        pending: false,
      },
      {
        occurredAt: '2026-10-01T09:00:00+07:00',
        units: '0.356',
        price: '686.20',
        amountMinor: 24_429n,
        pending: false,
      },
    ],
  },
  {
    key: 'qqq',
    accountKey: 'gotrade',
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust',
    assetClass: 'us_stocks',
    market: 'us_equity',
    category: null,
    price: '605.30',
    // Rp7.400.000 now.
    opening: { units: '0.747727388699', amountMinor: 36_453n, fxRate: '16362.72460428' },
    buys: [],
  },
  {
    key: 'vea',
    accountKey: 'gotrade',
    symbol: 'VEA',
    name: 'Vanguard FTSE Developed Markets',
    assetClass: 'international',
    market: 'us_equity',
    category: null,
    price: '61.40',
    // Rp4.300.000 now.
    opening: { units: '4.283337815896', amountMinor: 24_086n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'schd',
    accountKey: 'gotrade',
    symbol: 'SCHD',
    name: 'Schwab US Dividend Equity',
    assetClass: 'us_stocks',
    market: 'us_equity',
    category: null,
    price: '28.10',
    // Rp4.900.000 now.
    opening: { units: '1.848702651333', amountMinor: 3_597n, fxRate: '16350' },
    buys: [
      { occurredAt: '2026-09-01T09:05:00+07:00', units: '4.448', price: '27.50', amountMinor: 12_232n, pending: false },
      {
        occurredAt: '2026-10-01T09:05:00+07:00',
        units: '4.368571',
        price: '28.00',
        amountMinor: 12_232n,
        pending: false,
      },
    ],
  },
  {
    key: 'vwo',
    accountKey: 'gotrade',
    symbol: 'VWO',
    name: 'Vanguard FTSE Emerging Markets',
    assetClass: 'international',
    market: 'us_equity',
    category: null,
    price: '53.20',
    // Rp2.500.000 now.
    opening: { units: '2.874157871744', amountMinor: 14_692n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'sgov',
    accountKey: 'gotrade',
    symbol: 'SGOV',
    name: 'iShares 0–3 Month Treasury Bond ETF',
    assetClass: 'cash',
    market: 'us_equity',
    category: null,
    price: '100.48',
    // Rp3.449.963 now.
    opening: { units: '2.099989165157', amountMinor: 20_434n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'msty',
    accountKey: 'gotrade',
    symbol: 'MSTY',
    name: 'MSTR Option Income',
    assetClass: 'income',
    market: 'us_equity',
    category: 'YieldMax',
    price: '13.35',
    // Rp1.200.000 now.
    opening: { units: '5.497715012198', amountMinor: 8_630n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'nvdy',
    accountKey: 'gotrade',
    symbol: 'NVDY',
    name: 'NVDA Option Income',
    assetClass: 'income',
    market: 'us_equity',
    category: 'YieldMax',
    price: '15.80',
    // Rp900.000 now.
    opening: { units: '3.483915921496', amountMinor: 5_676n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'tsly',
    accountKey: 'gotrade',
    symbol: 'TSLY',
    name: 'TSLA Option Income',
    assetClass: 'income',
    market: 'us_equity',
    category: 'YieldMax',
    price: '8.95',
    // Rp600.000 now.
    opening: { units: '4.100251140382', amountMinor: 4_055n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'cony',
    accountKey: 'gotrade',
    symbol: 'CONY',
    name: 'COIN Option Income',
    assetClass: 'income',
    market: 'us_equity',
    category: 'YieldMax',
    price: '6.40',
    // Rp400.000 now.
    opening: { units: '3.822629969419', amountMinor: 2_550n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'nvda',
    accountKey: 'gotrade',
    symbol: 'NVDA',
    name: 'NVIDIA',
    assetClass: 'us_stocks',
    market: 'us_equity',
    category: 'US individual',
    price: '182.50',
    // Rp1.650.000 now.
    opening: { units: '0.552972225713', amountMinor: 7_690n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'msft',
    accountKey: 'gotrade',
    symbol: 'MSFT',
    name: 'Microsoft',
    assetClass: 'us_stocks',
    market: 'us_equity',
    category: 'US individual',
    price: '512.30',
    // Rp1.150.000 now.
    opening: { units: '0.137295318051', amountMinor: 5_360n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'aapl',
    accountKey: 'gotrade',
    symbol: 'AAPL',
    name: 'Apple',
    assetClass: 'us_stocks',
    market: 'us_equity',
    category: 'US individual',
    price: '247.80',
    // Rp1.000.000 now.
    opening: { units: '0.246820337008', amountMinor: 4_660n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'googl',
    accountKey: 'gotrade',
    symbol: 'GOOGL',
    name: 'Alphabet',
    assetClass: 'us_stocks',
    market: 'us_equity',
    category: 'US individual',
    price: '241.60',
    // Rp900.000 now.
    opening: { units: '0.227838872349', amountMinor: 4_195n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'amzn',
    accountKey: 'gotrade',
    symbol: 'AMZN',
    name: 'Amazon',
    assetClass: 'us_stocks',
    market: 'us_equity',
    category: 'US individual',
    price: '226.90',
    // Rp720.000 now.
    opening: { units: '0.194079758694', amountMinor: 3_356n, fxRate: '16350' },
    buys: [],
  },
  {
    key: 'btc',
    accountKey: 'indodax',
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: 'crypto',
    market: 'crypto',
    category: null,
    price: '1460000000',
    // Rp5.500.000 now.
    opening: { units: '0.003767123288', amountMinor: 3_890_000n, fxRate: '1' },
    buys: [],
  },
  {
    key: 'xau',
    accountKey: 'pluang',
    symbol: 'XAU',
    name: 'Emas',
    assetClass: 'gold',
    market: 'gold_spot',
    category: null,
    price: '2425000',
    // Rp3.700.000 now.
    opening: { units: '1.525773195876', amountMinor: 3_025_000n, fxRate: '1' },
    buys: [],
  },
  {
    key: 'bbca',
    accountKey: 'stockbit',
    symbol: 'BBCA',
    name: 'Bank Central Asia',
    assetClass: 'indonesia',
    market: 'idx_equity',
    category: 'Indonesia',
    price: '8000',
    // Rp2.400.000 now.
    opening: { units: '300', amountMinor: 2_305_000n, fxRate: '1' },
    buys: [],
  },
  {
    key: 'bbri',
    accountKey: 'stockbit',
    symbol: 'BBRI',
    name: 'Bank Rakyat Indonesia',
    assetClass: 'indonesia',
    market: 'idx_equity',
    category: 'Indonesia',
    price: '4000',
    // Rp1.300.000 now.
    opening: { units: '325', amountMinor: 1_486_000n, fxRate: '1' },
    buys: [],
  },
  {
    key: 'tlkm',
    accountKey: 'stockbit',
    symbol: 'TLKM',
    name: 'Telkom Indonesia',
    assetClass: 'indonesia',
    market: 'idx_equity',
    category: 'Indonesia',
    price: '3000',
    // Rp600.000 now.
    opening: { units: '200', amountMinor: 732_000n, fxRate: '1' },
    buys: [],
  },
  {
    key: 'idx30',
    accountKey: 'bibit',
    symbol: 'IDX30',
    name: 'Reksa Dana Indeks IDX30',
    assetClass: 'indonesia',
    market: 'mutual_fund',
    category: 'Indonesia',
    price: '1250',
    // Rp1.000.000 now.
    opening: { units: '800', amountMinor: 978_000n, fxRate: '1' },
    buys: [],
  },
  {
    key: 'ori',
    accountKey: 'bibit',
    symbol: 'ORI',
    name: 'ORI026',
    assetClass: 'indonesia',
    market: 'sbn',
    category: 'Indonesia',
    price: '1',
    // Rp1.500.000 now.
    opening: { units: '1500000', amountMinor: 1_482_000n, fxRate: '1' },
    buys: [],
  },
  // Section 00/13: "Bibit RDPU · 14 Okt 19.30 · diproses, NAB 16 Okt · 3.000.000" (units an estimate until allotted).
  {
    key: 'rdpu',
    accountKey: 'bibit',
    symbol: 'RDPU',
    name: 'Reksa Dana Pasar Uang',
    assetClass: 'cash',
    market: 'mutual_fund',
    category: null,
    // The last NAB before the order; the units come with the 16 Okt NAB.
    price: '1850',
    opening: null,
    buys: [
      {
        occurredAt: '2026-10-14T19:31:00+07:00',
        units: '1621.621621',
        price: '1850',
        amountMinor: 3_000_000n,
        pending: true,
      },
    ],
  },
];

// Same offset everywhere, so the ISO strings sort chronologically.
const byTime = (a: SeedTransaction, b: SeedTransaction): number => a.occurredAt.localeCompare(b.occurredAt);

const SEPTEMBER_TRANSACTIONS: readonly SeedTransaction[] = [
  ...flowTransactions('income', SEPTEMBER_INCOME_ROWS),
  ...flowTransactions('expense', [...SEPTEMBER_EXPENSE_ROWS, ...septemberFiller()]),
  ...SEPTEMBER_TRANSFERS,
].sort(byTime);

/** Moves `balances` by the cash the buys of `assets` paid from their platforms between `from` and `to` (inclusive). */
function postBuys(
  balances: Map<string, bigint>,
  assets: readonly SeedAsset[],
  sign: 1n | -1n,
  from = '',
  to = '\uffff',
): void {
  for (const asset of assets) {
    for (const buy of asset.buys) {
      const day = buy.occurredAt.slice(0, 10);
      if (day < from || day > to) continue;
      const balance = balances.get(asset.accountKey);
      if (balance === undefined) throw new RangeError(`unknown seed account: ${asset.accountKey}`);
      balances.set(asset.accountKey, balance - sign * buy.amountMinor);
    }
  }
}

/** {@link ACCOUNTS} opened on 31 Agu: the 30 Sep balances minus the September flows and buys. */
function openedOn31August(): SeedAccount[] {
  const balances = new Map(ACCOUNTS.map((account) => [account.key, account.openingBalanceMinor]));
  post(balances, SEPTEMBER_TRANSACTIONS, -1n);
  postBuys(balances, ASSETS, -1n, '2026-09-01', '2026-09-30');
  return ACCOUNTS.map((account) => ({
    ...account,
    openingBalanceMinor: balances.get(account.key) as bigint,
    openingDate: '2026-08-31',
  }));
}

const ACTIVE = { status: 'active' } as const;

/**
 * Section 07 "Langganan" on 15 Okt: 7 active (Rp904.900/bulan + Niagahoster Rp660.900/tahun; remaining in Oktober
 * Netflix, Spotify, YouTube, ChatGPT = Rp660.900), Headspace paused since 1 Sep, 3 cancelled (Rp1.195.000 saved).
 * Earlier bills point at the September/October seed transactions that paid them; ChatGPT's history predates the seed.
 */
const SUBSCRIPTIONS: readonly SeedSubscription[] = [
  {
    name: 'Netflix',
    plan: 'Premium 4K',
    icon: 'tv',
    description: null,
    priceMinor: 186_000n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: '2026-10-18',
    accountKey: 'bca',
    categoryKey: 'system:subscriptions',
    // "Pengingat H-1 · 17 Okt" (the M3 exit reminder).
    remindDaysBefore: 1,
    startedOn: '2024-01-18',
    usageRating: 'sometimes',
    state: ACTIVE,
    paid: [{ dueDate: '2026-09-18', occurredAt: '2026-09-18T09:00:00+07:00' }],
  },
  {
    name: 'Spotify',
    plan: 'Family',
    icon: 'music',
    description: '4 akun',
    priceMinor: 86_900n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: '2026-10-20',
    accountKey: 'gopay',
    categoryKey: 'system:subscriptions',
    remindDaysBefore: 3,
    startedOn: '2026-06-20',
    usageRating: 'often',
    state: ACTIVE,
    paid: [{ dueDate: '2026-09-20', occurredAt: '2026-09-24T09:00:00+07:00' }],
  },
  {
    name: 'YouTube Premium',
    plan: 'Individu',
    icon: 'play',
    description: null,
    priceMinor: 59_000n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: '2026-10-22',
    accountKey: 'bca',
    categoryKey: 'system:subscriptions',
    remindDaysBefore: 3,
    startedOn: '2026-09-22',
    // "6 / 7 dinilai": YouTube Premium is the one still to rate.
    usageRating: null,
    state: ACTIVE,
    paid: [{ dueDate: '2026-09-22', occurredAt: '2026-09-22T09:00:00+07:00' }],
  },
  {
    name: 'ChatGPT',
    plan: 'Plus',
    icon: 'bot',
    description: 'Akun kerja, dipakai bareng tim desain',
    priceMinor: 329_000n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: '2026-10-28',
    accountKey: 'jago',
    categoryKey: 'system:subscriptions',
    remindDaysBefore: 3,
    startedOn: '2025-03-28',
    usageRating: 'often',
    state: ACTIVE,
    paid: [],
  },
  {
    name: 'Fit Hub',
    plan: 'Gym bulanan',
    icon: 'dumbbell',
    description: null,
    priceMinor: 199_000n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: '2026-11-03',
    accountKey: 'bca',
    categoryKey: 'system:subscriptions',
    remindDaysBefore: 3,
    startedOn: '2025-11-03',
    usageRating: 'sometimes',
    state: ACTIVE,
    paid: [
      { dueDate: '2026-09-03', occurredAt: '2026-09-03T08:30:00+07:00' },
      { dueDate: '2026-10-03', occurredAt: '2026-10-03T08:30:00+07:00' },
    ],
  },
  {
    name: 'iCloud+',
    plan: '200 GB',
    icon: 'cloud',
    description: null,
    priceMinor: 45_000n,
    currency: 'IDR',
    cycle: 'monthly',
    // "iCloud+ Rp45.000 seharusnya ditagih 9 Okt" — overdue and unconfirmed on 15 Okt.
    nextBillingDate: '2026-10-09',
    accountKey: 'bca',
    categoryKey: 'system:subscriptions',
    remindDaysBefore: 3,
    startedOn: '2025-01-09',
    usageRating: 'often',
    state: ACTIVE,
    paid: [{ dueDate: '2026-09-09', occurredAt: '2026-09-09T09:00:00+07:00' }],
  },
  {
    name: 'Niagahoster',
    plan: 'Hosting + domain',
    icon: 'server',
    description: null,
    priceMinor: 660_900n,
    currency: 'IDR',
    cycle: 'yearly',
    nextBillingDate: '2027-10-05',
    accountKey: 'bca',
    categoryKey: 'system:subscriptions',
    remindDaysBefore: 3,
    startedOn: '2024-10-05',
    usageRating: 'often',
    state: ACTIVE,
    paid: [{ dueDate: '2026-10-05', occurredAt: '2026-10-05T08:00:00+07:00' }],
  },
  {
    name: 'Headspace',
    plan: 'Tahunan dibayar bulanan',
    icon: 'brain',
    description: null,
    priceMinor: 70_000n,
    currency: 'IDR',
    cycle: 'monthly',
    // "Lanjut 1 Des 2026 · dijeda sejak 1 Sep · hemat Rp140.000 sejauh ini".
    nextBillingDate: '2026-12-01',
    accountKey: 'bca',
    categoryKey: 'system:subscriptions',
    remindDaysBefore: 3,
    startedOn: '2025-06-01',
    usageRating: null,
    state: { status: 'paused', pausedOn: '2026-09-01', pausedUntil: '2026-12-01' },
    paid: [],
  },
  {
    name: 'Canva Pro',
    plan: 'Individu',
    icon: 'palette',
    description: null,
    priceMinor: 95_000n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: '2026-04-01',
    accountKey: 'bca',
    categoryKey: 'system:subscriptions',
    remindDaysBefore: 3,
    startedOn: '2024-04-01',
    usageRating: null,
    state: { status: 'cancelled', endsOn: '2026-03-31', cancelMode: 'now' },
    paid: [],
  },
  {
    name: 'Apple Music',
    plan: 'Individu',
    icon: 'music',
    description: 'diganti Spotify',
    priceMinor: 55_000n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: '2026-05-01',
    accountKey: 'bca',
    categoryKey: 'system:subscriptions',
    remindDaysBefore: 3,
    startedOn: '2024-05-01',
    usageRating: null,
    state: { status: 'cancelled', endsOn: '2026-04-30', cancelMode: 'now' },
    paid: [],
  },
  {
    name: 'Gojek Plus',
    plan: 'Paket hemat',
    icon: 'bike',
    description: null,
    priceMinor: 25_000n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: '2026-03-01',
    accountKey: 'gopay',
    categoryKey: 'system:transport',
    remindDaysBefore: 3,
    startedOn: '2025-03-01',
    usageRating: null,
    state: { status: 'cancelled', endsOn: '2026-02-28', cancelMode: 'now' },
    paid: [],
  },
];

/**
 * Section 00 "Setoran rutin & investasi": the monthly transfers, H-1 reminders. September and October transfers of
 * the seed paid the earlier occurrences. Goal shares (Section 13 "Setoran rutin"): Dana Darurat gets 500.000 on the
 * 1st and 3.000.000 on the 14th (Rp3.500.000/bulan, "tgl 1 & 14"); "Sisihkan dana tidak rutin" (25th, review card
 * yNnG3 "BCA Tahapan → Bank Jago") splits Rp1.150.000 over three sinking funds from October to their due months, and
 * confirming it puts each share in Bank Jago for its fund ("Dana tidak rutin (Bank Jago)", O4YIh2; "Disimpan di Bank
 * Jago", McGzv); the DCA goes to DP Rumah and Dana Pensiun through their assets (M5).
 */
const RECURRENCES: readonly SeedRecurrence[] = [
  {
    description: 'Kantong darurat',
    fromAccountKey: 'bca',
    toAccountKey: 'jago',
    sentMinor: 500_000n,
    receivedMinor: 500_000n,
    tags: ['dana-darurat'],
    allocations: [{ goal: 'Dana Darurat', amountMinor: 500_000n, startMonth: '2026-09', endMonth: null }],
    monthDay: 1,
    startOn: '2026-09-01',
    remindOffsetDays: 1,
    paid: [
      { dueDate: '2026-09-01', occurredAt: '2026-09-01T08:35:00+07:00' },
      { dueDate: '2026-10-01', occurredAt: '2026-10-01T08:35:00+07:00' },
    ],
  },
  {
    description: 'DCA SPY 4.000.000 + SCHD 2.000.000',
    fromAccountKey: 'bca',
    toAccountKey: 'gotrade',
    sentMinor: 6_000_000n,
    receivedMinor: 36_697n,
    tags: ['dp-rumah', 'dana-pensiun'],
    allocations: [],
    monthDay: 1,
    startOn: '2026-09-01',
    remindOffsetDays: 1,
    paid: [
      { dueDate: '2026-09-01', occurredAt: '2026-09-01T08:30:00+07:00' },
      { dueDate: '2026-10-01', occurredAt: '2026-10-01T08:30:00+07:00' },
    ],
  },
  {
    description: 'Setor dana darurat · Bibit RDPU',
    fromAccountKey: 'bca',
    toAccountKey: 'bibit',
    sentMinor: 3_000_000n,
    receivedMinor: 3_000_000n,
    tags: ['dana-darurat'],
    allocations: [{ goal: 'Dana Darurat', amountMinor: 3_000_000n, startMonth: '2026-10', endMonth: null }],
    monthDay: 14,
    // "sejak Okt; Sep → Jago 2.000.000".
    startOn: '2026-10-14',
    remindOffsetDays: 1,
    paid: [{ dueDate: '2026-10-14', occurredAt: '2026-10-14T19:30:00+07:00' }],
  },
  {
    description: 'Sisihkan dana tidak rutin',
    fromAccountKey: 'bca',
    toAccountKey: 'jago',
    sentMinor: 1_150_000n,
    receivedMinor: 1_150_000n,
    tags: [],
    allocations: [
      { goal: 'Liburan Bali', amountMinor: 867_000n, startMonth: '2026-10', endMonth: '2027-03' },
      { goal: 'Servis motor', amountMinor: 240_000n, startMonth: '2026-10', endMonth: '2026-12' },
      { goal: 'Perpanjang STNK', amountMinor: 43_000n, startMonth: '2026-10', endMonth: '2027-02' },
    ],
    monthDay: 25,
    startOn: '2026-10-25',
    remindOffsetDays: 1,
    paid: [],
  },
];

/**
 * Section 19 "Piutang" (`KZZZy`, 15 Okt): Nadia's share of the CGV bill (due Sun 18 Okt, H-1 reminder) and Raka's
 * cash loan (Rp100.000 back on 10 Okt, due Sat 31 Okt) are active, Rp542.500 in total; Dimas and Sari paid back
 * within the last 90 days ("LUNAS · 90 HARI"); Bima Aditya is an older one ("pernah: … Bima Aditya"). Lending dates
 * the design does not show are chosen before the repayment.
 */
const RECEIVABLES: readonly SeedReceivable[] = [
  {
    counterparty: 'Nadia',
    source: 'split_bill',
    description: 'Nonton bareng CGV Grand Indonesia',
    amountMinor: 242_500n,
    accountKey: 'bca',
    lentAt: '2026-10-15T08:30:00+07:00',
    dueDate: '2026-10-18',
    remind: true,
    payments: [],
  },
  {
    counterparty: 'Raka Pratama',
    source: 'loan',
    description: null,
    amountMinor: 400_000n,
    accountKey: 'gopay',
    lentAt: '2026-10-02T12:00:00+07:00',
    dueDate: '2026-10-31',
    remind: false,
    payments: [{ amountMinor: 100_000n, accountKey: 'gopay', receivedAt: '2026-10-10T12:00:00+07:00' }],
  },
  {
    counterparty: 'Dimas',
    source: 'split_bill',
    description: 'Patungan kado',
    amountMinor: 150_000n,
    accountKey: 'bca',
    lentAt: '2026-09-26T19:00:00+07:00',
    dueDate: null,
    remind: false,
    payments: [{ amountMinor: 150_000n, accountKey: 'gopay', receivedAt: '2026-10-02T12:00:00+07:00' }],
  },
  {
    counterparty: 'Sari',
    source: 'loan',
    description: 'Talangan tiket kereta',
    amountMinor: 385_000n,
    accountKey: 'bca',
    lentAt: '2026-09-12T12:00:00+07:00',
    dueDate: null,
    remind: false,
    payments: [{ amountMinor: 385_000n, accountKey: 'bca', receivedAt: '2026-09-21T12:00:00+07:00' }],
  },
  {
    counterparty: 'Bima Aditya',
    source: 'loan',
    description: null,
    amountMinor: 300_000n,
    accountKey: 'bca',
    lentAt: '2026-06-05T12:00:00+07:00',
    dueDate: null,
    remind: false,
    payments: [{ amountMinor: 300_000n, accountKey: 'bca', receivedAt: '2026-06-20T12:00:00+07:00' }],
  },
];

export const DESIGN_SEED: DesignSeed = {
  baseCurrency: 'IDR',
  timezone: 'Asia/Jakarta',
  periodStartDay: 1,
  accounts: openedOn31August(),
  transactions: [
    ...flowTransactions('income', INCOME_ROWS),
    ...flowTransactions('expense', EXPENSE_ROWS),
    ...TRANSFERS,
  ].sort(byTime),
  septemberTransactions: SEPTEMBER_TRANSACTIONS,
  closedPeriods: [{ start: '2026-09-01', end: '2026-09-30', closedAt: '2026-10-01T00:05:00+07:00' }],
  budgets: BUDGETS,
  fxRates: [{ base: 'USD', quote: 'IDR', rate: '16350', asOf: '2026-10-15' }],
  // Section 00 card "Tujuan tabungan"; deadlines from the savings-goal seed table (docs/design-analysis/CrossCutting.md).
  // Account sources (Section 05 "Rp17.300.000 dialokasikan ke tabungan", Section 13): Dana Darurat's "Kantong darurat"
  // is all of Bank Jago today (Rp8.125.000) as a fixed amount, so the sinking funds' set-asides can land in Bank Jago
  // next to it (a whole source would take them for Dana Darurat); fixed amounts of BCA Tahapan for DP Rumah
  // (5.000.000) and the three sinking funds ("Rp4.200.000 dipakai dana tidak rutin"). Asset sources (Section 00 card,
  // 13 "Rp22.400.000 di investasi"): Dana Darurat the RDPU being bought (Rp3.000.000), DP Rumah SPY 60% + IDX30, Dana
  // Pensiun SPY 40% + SCHD → Rp11.125.000 / Rp14.100.000 / Rp10.300.000.
  goals: [
    {
      name: 'Dana Darurat',
      icon: 'shield',
      color: 'green',
      kind: 'savings',
      targetMinor: 54_000_000n,
      targetMonths: 3,
      currency: 'IDR',
      deadlineMonth: '2027-11',
      tag: 'dana-darurat',
      accountKey: 'jago',
      sources: [{ accountKey: 'jago', mode: 'fixed', amountMinor: 8_125_000n }],
      assetSources: [{ assetKey: 'rdpu', mode: 'whole', pctBps: null }],
    },
    {
      name: 'DP Rumah',
      icon: 'house',
      color: 'blue',
      kind: 'savings',
      targetMinor: 150_000_000n,
      targetMonths: null,
      currency: 'IDR',
      deadlineMonth: null,
      tag: 'dp-rumah',
      accountKey: null,
      sources: [{ accountKey: 'bca', mode: 'fixed', amountMinor: 5_000_000n }],
      assetSources: [
        { assetKey: 'spy', mode: 'percent', pctBps: 6000 },
        { assetKey: 'idx30', mode: 'whole', pctBps: null },
      ],
    },
    {
      name: 'Dana Pensiun',
      icon: 'sunset',
      color: 'violet',
      kind: 'savings',
      targetMinor: 500_000_000n,
      targetMonths: null,
      currency: 'IDR',
      deadlineMonth: null,
      tag: 'dana-pensiun',
      accountKey: null,
      sources: [],
      assetSources: [
        { assetKey: 'spy', mode: 'percent', pctBps: 4000 },
        { assetKey: 'schd', mode: 'whole', pctBps: null },
      ],
    },
    {
      name: 'Liburan Bali',
      icon: 'tree-palm',
      color: 'cyan',
      kind: 'sinking',
      targetMinor: 8_000_000n,
      targetMonths: null,
      currency: 'IDR',
      deadlineMonth: '2027-03',
      tag: 'liburan-bali',
      accountKey: null,
      sources: [{ accountKey: 'bca', mode: 'fixed', amountMinor: 2_800_000n }],
      assetSources: [],
    },
    {
      name: 'Servis motor',
      icon: 'wrench',
      color: 'amber',
      kind: 'sinking',
      targetMinor: 1_200_000n,
      targetMonths: null,
      currency: 'IDR',
      deadlineMonth: '2026-12',
      tag: 'servis-motor',
      accountKey: null,
      sources: [{ accountKey: 'bca', mode: 'fixed', amountMinor: 720_000n }],
      assetSources: [],
    },
    {
      name: 'Perpanjang STNK',
      icon: 'file-text',
      color: 'orange',
      kind: 'sinking',
      targetMinor: 850_000n,
      targetMonths: null,
      currency: 'IDR',
      deadlineMonth: '2027-02',
      tag: 'perpanjang-stnk',
      accountKey: null,
      sources: [{ accountKey: 'bca', mode: 'fixed', amountMinor: 680_000n }],
      assetSources: [],
    },
  ],
  goalSnapshots: [
    {
      date: '2026-08-31',
      recordedAt: '2026-08-31T23:55:00+07:00',
      goals: [
        { goal: 'Dana Darurat', currency: 'IDR', targetMinor: 54_000_000n, savedMinor: 5_125_000n, valuation: 'cash' },
        { goal: 'DP Rumah', currency: 'IDR', targetMinor: 150_000_000n, savedMinor: 9_504_000n, valuation: 'market' },
        {
          goal: 'Dana Pensiun',
          currency: 'IDR',
          targetMinor: 500_000_000n,
          savedMinor: 3_176_000n,
          valuation: 'market',
        },
        { goal: 'Liburan Bali', currency: 'IDR', targetMinor: 8_000_000n, savedMinor: 1_933_000n, valuation: 'cash' },
        { goal: 'Servis motor', currency: 'IDR', targetMinor: 1_200_000n, savedMinor: 480_000n, valuation: 'cash' },
        { goal: 'Perpanjang STNK', currency: 'IDR', targetMinor: 850_000n, savedMinor: 637_000n, valuation: 'cash' },
      ],
    },
    {
      date: '2026-09-30',
      recordedAt: '2026-09-30T23:55:00+07:00',
      goals: [
        { goal: 'Dana Darurat', currency: 'IDR', targetMinor: 54_000_000n, savedMinor: 7_625_000n, valuation: 'cash' },
        { goal: 'DP Rumah', currency: 'IDR', targetMinor: 150_000_000n, savedMinor: 11_514_000n, valuation: 'market' },
        {
          goal: 'Dana Pensiun',
          currency: 'IDR',
          targetMinor: 500_000_000n,
          savedMinor: 6_526_000n,
          valuation: 'market',
        },
        { goal: 'Liburan Bali', currency: 'IDR', targetMinor: 8_000_000n, savedMinor: 2_800_000n, valuation: 'cash' },
        { goal: 'Servis motor', currency: 'IDR', targetMinor: 1_200_000n, savedMinor: 720_000n, valuation: 'cash' },
        { goal: 'Perpanjang STNK', currency: 'IDR', targetMinor: 850_000n, savedMinor: 680_000n, valuation: 'cash' },
      ],
    },
  ],
  subscriptions: SUBSCRIPTIONS,
  recurrences: RECURRENCES,
  receivables: RECEIVABLES,
  investments: {
    priceAt: '2026-10-15T16:42:00+07:00',
    openedAt: '2026-08-31T12:00:00+07:00',
    // "Kelola kategori": 5 aset · kelas Indonesia, 4 aset · kelas Income (YieldMax), 5 aset · kelas Saham AS.
    categories: [
      { name: 'Indonesia', assetClass: 'indonesia' },
      { name: 'YieldMax', assetClass: 'income' },
      { name: 'US individual', assetClass: 'us_stocks' },
    ],
    assets: ASSETS,
    // w1jn3J "Target alokasi": Saham AS 50, Internasional 12, Indonesia 12, Kripto 7, Kas & SGOV 8, Emas 5, Income 6.
    targets: { us_stocks: 5000, international: 1200, indonesia: 1200, crypto: 700, cash: 800, gold: 500, income: 600 },
    // XZruO "Akhir September 2026 · Rp57.700.000 · Modal disetor Rp50.900.000 · Setoran bulan ini +Rp3.000.000"; the
    // other month ends have no cost basis in the design.
    snapshots: [
      { date: '2026-09-30', valueMinor: 57_700_000n, costMinor: 50_900_000n, contributionsMinor: 3_000_000n },
    ],
  },
};

/**
 * Balance of every seed account in its own currency after all seed transactions (September and October): opening
 * − expenses + income − sent (transfer source) + received (transfer destination) − buys paid from platform cash.
 * Used by the DB seed CLI as a
 * self-check.
 */
export function seedClosingBalances(seed: DesignSeed): ReadonlyMap<string, bigint> {
  const balances = new Map(seed.accounts.map((account) => [account.key, account.openingBalanceMinor]));
  post(balances, [...seed.septemberTransactions, ...seed.transactions], 1n);
  postBuys(balances, seed.investments.assets, 1n);
  return balances;
}
