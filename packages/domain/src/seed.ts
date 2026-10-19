// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The design persona "Avtara" for 1–15 Oktober 2026 (design Section 00 "Sumber data" plus the Dashboard, Transaksi,
 * Rekening, Anggaran, Langganan and Kalender digests). Opening balances are as of 30 Sep 2026, so that opening + the
 * October flows give the balances shown on 15 Okt. Merchants, dates and amounts the design shows are used verbatim;
 * the remaining daily spending is filled in so that every budget card total matches.
 */
import type { BuiltInCategoryKey } from './categories.ts';
import type { AccountType } from './ledger.ts';

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
  readonly showAsCard: boolean;
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

export interface SeedGoal {
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly targetMinor: bigint;
  readonly currency: string;
  /** YYYY-MM. */
  readonly deadlineMonth: string | null;
  readonly tag: string | null;
}

export interface DesignSeed {
  readonly baseCurrency: 'IDR';
  readonly timezone: 'Asia/Jakarta';
  readonly accounts: readonly SeedAccount[];
  readonly transactions: readonly SeedTransaction[];
  readonly fxRates: readonly SeedFxRate[];
  readonly goals: readonly SeedGoal[];
}

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
    showAsCard: true,
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
    showAsCard: true,
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
    showAsCard: false,
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
    showAsCard: true,
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
    showAsCard: false,
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
    showAsCard: false,
    isDefaultQuickEntry: false,
  },
  // US$2.778,00 = US$2.411,03 + US$366,97 top-up (Rp6.000.000 at Rp16.350)
  {
    key: 'gotrade',
    type: 'investment',
    providerName: 'Gotrade',
    displayName: 'Gotrade',
    last4: null,
    phoneMasked: null,
    currency: 'USD',
    openingBalanceMinor: 241_103n,
    openingDate: OPENING_DATE,
    color: 'cyan',
    includeInAvailable: false,
    showAsCard: false,
    isDefaultQuickEntry: false,
  },
  {
    key: 'indodax',
    type: 'investment',
    providerName: 'Indodax',
    displayName: 'Indodax',
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 5_500_000n,
    openingDate: OPENING_DATE,
    color: 'blue',
    includeInAvailable: false,
    showAsCard: false,
    isDefaultQuickEntry: false,
  },
  {
    key: 'stockbit',
    type: 'investment',
    providerName: 'Stockbit',
    displayName: 'Stockbit',
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 4_300_000n,
    openingDate: OPENING_DATE,
    color: 'red',
    includeInAvailable: false,
    showAsCard: false,
    isDefaultQuickEntry: false,
  },
  {
    key: 'pluang',
    type: 'investment',
    providerName: 'Pluang',
    displayName: 'Pluang',
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 3_700_000n,
    openingDate: OPENING_DATE,
    color: 'violet',
    includeInAvailable: false,
    showAsCard: false,
    isDefaultQuickEntry: false,
  },
  // 5.500.000 = 2.500.000 (IDX30 1.000.000 + ORI 1.500.000) + 3.000.000 RDPU (still "diproses" in the design)
  {
    key: 'bibit',
    type: 'investment',
    providerName: 'Bibit',
    displayName: 'Bibit',
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 2_500_000n,
    openingDate: OPENING_DATE,
    color: 'green',
    includeInAvailable: false,
    showAsCard: false,
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

export const DESIGN_SEED: DesignSeed = {
  baseCurrency: 'IDR',
  timezone: 'Asia/Jakarta',
  accounts: ACCOUNTS,
  // Same offset everywhere, so the ISO strings sort chronologically.
  transactions: [
    ...flowTransactions('income', INCOME_ROWS),
    ...flowTransactions('expense', EXPENSE_ROWS),
    ...TRANSFERS,
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  fxRates: [{ base: 'USD', quote: 'IDR', rate: '16350', asOf: '2026-10-15' }],
  // Section 00 card "Tujuan tabungan"; deadlines from the savings-goal seed table (docs/design-analysis/CrossCutting.md).
  goals: [
    {
      name: 'Dana Darurat',
      icon: 'shield',
      color: 'green',
      targetMinor: 54_000_000n,
      currency: 'IDR',
      deadlineMonth: '2027-11',
      tag: 'dana-darurat',
    },
    {
      name: 'DP Rumah',
      icon: 'house',
      color: 'blue',
      targetMinor: 150_000_000n,
      currency: 'IDR',
      deadlineMonth: null,
      tag: 'dp-rumah',
    },
    {
      name: 'Dana Pensiun',
      icon: 'sunset',
      color: 'violet',
      targetMinor: 500_000_000n,
      currency: 'IDR',
      deadlineMonth: null,
      tag: 'dana-pensiun',
    },
    {
      name: 'Liburan Bali',
      icon: 'tree-palm',
      color: 'cyan',
      targetMinor: 8_000_000n,
      currency: 'IDR',
      deadlineMonth: '2027-03',
      tag: 'liburan-bali',
    },
    {
      name: 'Servis motor',
      icon: 'wrench',
      color: 'amber',
      targetMinor: 1_200_000n,
      currency: 'IDR',
      deadlineMonth: '2026-12',
      tag: 'servis-motor',
    },
    {
      name: 'Perpanjang STNK',
      icon: 'file-text',
      color: 'orange',
      targetMinor: 850_000n,
      currency: 'IDR',
      deadlineMonth: '2027-02',
      tag: 'perpanjang-stnk',
    },
  ],
};

/**
 * Balance of every seed account in its own currency after all seed transactions: opening − expenses + income
 * − sent (transfer source) + received (transfer destination). Used by the DB seed CLI as a self-check.
 */
export function seedClosingBalances(seed: DesignSeed): ReadonlyMap<string, bigint> {
  const balances = new Map(seed.accounts.map((account) => [account.key, account.openingBalanceMinor]));
  const post = (accountKey: string, deltaMinor: bigint): void => {
    const balance = balances.get(accountKey);
    if (balance === undefined) throw new RangeError(`unknown seed account: ${accountKey}`);
    balances.set(accountKey, balance + deltaMinor);
  };
  for (const transaction of seed.transactions) {
    if (transaction.kind === 'transfer') {
      post(transaction.fromAccountKey, -transaction.sentMinor);
      post(transaction.toAccountKey, transaction.receivedMinor);
    } else {
      post(transaction.accountKey, transaction.kind === 'income' ? transaction.amountMinor : -transaction.amountMinor);
    }
  }
  return balances;
}
