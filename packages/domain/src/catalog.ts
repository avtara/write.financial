// SPDX-License-Identifier: AGPL-3.0-only
/** Small, hand-curated reference data, not a global directory or a price feed. See TRADEMARK.md for provenance. */
import type { AssetClass } from './investments.ts';
import type { AccountType } from './ledger.ts';
import type { Market } from './market.ts';

export type CatalogKind = 'provider' | 'instrument' | 'service';
export interface CatalogRecord {
  readonly id: string;
  readonly kind: CatalogKind;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly accountTypes: readonly AccountType[];
  readonly symbol: string | null;
  /** ISO 10383 operating MIC: identity is venue + ticker, never ticker alone. */
  readonly venue: string | null;
  readonly currency: string | null;
  readonly assetClass: AssetClass | null;
  readonly market: Market | null;
  readonly logoPath: string | null;
  readonly sourceUrl: string;
  /** Applies to our original factual curation, not the source website or the trademark. */
  readonly dataLicense: string;
  readonly logoSourceUrl: string | null;
  readonly logoLicense: string | null;
}

const NO_LISTING = { symbol: null, venue: null, currency: null, assetClass: null, market: null };
const NO_LOGO = { logoPath: null, logoSourceUrl: null, logoLicense: null };
const DATA_LICENSE = 'AGPL-3.0-only (original factual curation; not source website content)';
const logo = (slug: string, file: string) => ({
  logoPath: `/catalog-logos/${slug}.svg`,
  logoSourceUrl: `https://commons.wikimedia.org/wiki/File:${file}`,
  logoLicense: 'Public domain (PD-textlogo); trademark rights reserved',
});
const BCA_LOGO = logo('bca', 'Bank_Central_Asia.svg');
const provider = (
  slug: string,
  name: string,
  aliases: readonly string[],
  accountTypes: readonly AccountType[],
  sourceUrl: string,
  mark = NO_LOGO as Pick<CatalogRecord, 'logoPath' | 'logoSourceUrl' | 'logoLicense'>,
): CatalogRecord => ({
  id: `provider:${slug}`,
  kind: 'provider',
  name,
  aliases,
  accountTypes,
  sourceUrl,
  dataLicense: DATA_LICENSE,
  ...NO_LISTING,
  ...mark,
});
const service = (
  slug: string,
  name: string,
  aliases: readonly string[],
  sourceUrl: string,
  mark = NO_LOGO as Pick<CatalogRecord, 'logoPath' | 'logoSourceUrl' | 'logoLicense'>,
): CatalogRecord => ({
  id: `service:${slug}`,
  kind: 'service',
  name,
  aliases,
  sourceUrl,
  accountTypes: [],
  dataLicense: DATA_LICENSE,
  ...NO_LISTING,
  ...mark,
});
const stock = (
  venue: 'XIDX' | 'XNAS' | 'XNYS',
  symbol: string,
  name: string,
  aliases: readonly string[],
  sourceUrl: string,
  mark = NO_LOGO as Pick<CatalogRecord, 'logoPath' | 'logoSourceUrl' | 'logoLicense'>,
): CatalogRecord => ({
  id: `stock:${venue.toLowerCase()}:${symbol.toLowerCase()}`,
  kind: 'instrument',
  name,
  aliases,
  sourceUrl,
  accountTypes: [],
  symbol,
  venue,
  currency: venue === 'XIDX' ? 'IDR' : 'USD',
  assetClass: venue === 'XIDX' ? 'indonesia' : 'us_stocks',
  market: venue === 'XIDX' ? 'idx_equity' : 'us_equity',
  dataLicense: DATA_LICENSE,
  ...mark,
});
const BANK: readonly AccountType[] = ['bank', 'credit_card'];
const WALLET: readonly AccountType[] = ['ewallet'];
const BROKER: readonly AccountType[] = ['investment'];

/** Kept in the database by the reference-catalog migration; no runtime third-party requests. */
export const CATALOG: readonly CatalogRecord[] = [
  provider('bca', 'BCA', ['Bank Central Asia', 'Bank BCA', 'myBCA'], BANK, 'https://www.bca.co.id/', BCA_LOGO),
  provider('mandiri', 'Bank Mandiri', ['Mandiri', 'Livin'], BANK, 'https://www.bankmandiri.co.id/'),
  provider('bri', 'BRI', ['Bank Rakyat Indonesia', 'BRImo'], BANK, 'https://bri.co.id/'),
  provider('bni', 'BNI', ['Bank Negara Indonesia', 'wondr'], BANK, 'https://www.bni.co.id/'),
  provider('bsi', 'Bank Syariah Indonesia', ['BSI', 'BYOND'], ['bank'], 'https://www.bankbsi.co.id/'),
  provider('cimb-niaga', 'CIMB Niaga', ['CIMB', 'OCTO'], BANK, 'https://www.cimbniaga.co.id/'),
  provider('jago', 'Bank Jago', ['Jago'], ['bank'], 'https://www.jago.com/'),
  provider('jenius', 'Jenius', ['SMBC Indonesia', 'BTPN'], BANK, 'https://www.jenius.com/'),
  provider('seabank', 'SeaBank', ['Sea Bank'], ['bank'], 'https://www.seabank.co.id/'),
  provider('gopay', 'GoPay', ['Go Pay', 'Gojek'], WALLET, 'https://gopay.co.id/'),
  provider('ovo', 'OVO', ['Grab OVO'], WALLET, 'https://www.ovo.id/'),
  provider('dana', 'DANA', ['Dompet Digital Indonesia'], WALLET, 'https://www.dana.id/'),
  provider('shopeepay', 'ShopeePay', ['Shopee Pay'], WALLET, 'https://shopeepay.co.id/'),
  provider('linkaja', 'LinkAja', ['Link Aja', 'TCASH'], WALLET, 'https://www.linkaja.id/'),
  provider('stockbit', 'Stockbit', ['Stockbit Sekuritas'], BROKER, 'https://stockbit.com/'),
  provider('ajaib', 'Ajaib', ['Ajaib Sekuritas'], BROKER, 'https://ajaib.co.id/'),
  provider('ipot', 'IPOT', ['Indo Premier', 'Indopremier'], BROKER, 'https://www.indopremier.com/'),
  provider('bibit', 'Bibit', ['Bibit investasi'], BROKER, 'https://bibit.id/'),
  provider('ibkr', 'Interactive Brokers', ['IBKR'], BROKER, 'https://www.interactivebrokers.com/'),
  provider('schwab', 'Charles Schwab', ['Schwab'], BROKER, 'https://www.schwab.com/'),
  provider('chase', 'Chase', ['JPMorgan Chase', 'JP Morgan'], BANK, 'https://www.chase.com/'),
  provider('hsbc', 'HSBC', ['Hongkong Shanghai Banking'], BANK, 'https://www.hsbc.com/'),
  provider('dbs', 'DBS', ['digibank'], BANK, 'https://www.dbs.com/'),
  provider('wise', 'Wise', ['TransferWise'], ['bank'], 'https://wise.com/'),
  stock(
    'XIDX',
    'BBCA',
    'Bank Central Asia',
    ['BCA', 'PT Bank Central Asia Tbk'],
    'https://www.bca.co.id/en/tentang-bca/Hubungan-Investor',
    BCA_LOGO,
  ),
  stock('XIDX', 'BBRI', 'Bank Rakyat Indonesia', ['BRI'], 'https://www.ir-bri.com/'),
  stock('XIDX', 'BMRI', 'Bank Mandiri', ['Mandiri'], 'https://www.bankmandiri.co.id/'),
  stock('XIDX', 'BBNI', 'Bank Negara Indonesia', ['BNI'], 'https://www.bni.co.id/'),
  stock('XIDX', 'TLKM', 'Telkom Indonesia', ['Telkom'], 'https://www.telkom.co.id/'),
  stock('XIDX', 'ASII', 'Astra International', ['Astra'], 'https://www.astra.co.id/'),
  stock('XNAS', 'AAPL', 'Apple', ['Apple Inc'], 'https://investor.apple.com/'),
  stock('XNAS', 'MSFT', 'Microsoft', ['Microsoft Corporation'], 'https://www.microsoft.com/en-us/Investor/'),
  stock('XNAS', 'GOOGL', 'Alphabet Class A', ['Google', 'Alphabet'], 'https://abc.xyz/investor/'),
  stock('XNAS', 'NVDA', 'NVIDIA', ['Nvidia Corporation'], 'https://investor.nvidia.com/'),
  stock('XNYS', 'JPM', 'JPMorgan Chase', ['JP Morgan', 'Chase'], 'https://www.jpmorganchase.com/ir'),
  stock('XNYS', 'TLK', 'Telkom Indonesia ADR', ['Telkom', 'American Depositary Shares'], 'https://www.telkom.co.id/'),
  service(
    'netflix',
    'Netflix',
    ['Netflix Indonesia'],
    'https://www.netflix.com/',
    logo('netflix', 'Netflix_2015_logo.svg'),
  ),
  service(
    'youtube-premium',
    'YouTube Premium',
    ['YouTube', 'YT Premium', 'YouTube Music'],
    'https://www.youtube.com/premium',
    logo('youtube', 'YouTube_full-color_icon_(2024).svg'),
  ),
  service(
    'spotify',
    'Spotify',
    ['Spotify Premium', 'musik', 'music'],
    'https://www.spotify.com/',
    logo('spotify', 'Spotify_logo_without_text.svg'),
  ),
  service(
    'disney-plus',
    'Disney+',
    ['Disney Plus', 'Disney Hotstar', 'Disney+ Hotstar'],
    'https://www.disneyplus.com/',
  ),
  service('vidio', 'Vidio', ['Vidio Premier'], 'https://www.vidio.com/'),
  service('viu', 'Viu', ['Viu Premium'], 'https://www.viu.com/'),
  service('apple-music', 'Apple Music', ['Apple musik'], 'https://www.apple.com/apple-music/'),
  service('icloud', 'iCloud+', ['iCloud', 'Apple iCloud'], 'https://www.apple.com/icloud/'),
  service('google-one', 'Google One', ['Google Drive', 'Google storage'], 'https://one.google.com/'),
  service(
    'microsoft-365',
    'Microsoft 365',
    ['Office 365', 'Microsoft Office'],
    'https://www.microsoft.com/microsoft-365',
  ),
  service('canva', 'Canva', ['Canva Pro'], 'https://www.canva.com/'),
  service('notion', 'Notion', ['Notion Plus'], 'https://www.notion.com/'),
  service('prime-video', 'Prime Video', ['Amazon Prime', 'Amazon Video'], 'https://www.primevideo.com/'),
];
const BY_ID: Readonly<Record<string, CatalogRecord>> = Object.fromEntries(CATALOG.map((record) => [record.id, record]));
export function getCatalogRecord(id: string | null | undefined): CatalogRecord | null {
  return id == null || !Object.hasOwn(BY_ID, id) ? null : (BY_ID[id] as CatalogRecord);
}
export interface CatalogSearchOptions {
  readonly kind: CatalogKind;
  readonly accountType?: AccountType;
  /** Instruments must match the selected platform's quote currency. */
  readonly currency?: string;
  readonly limit?: number;
}
const normalize = (value: string) => value.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
/** Empty input deliberately returns no list. Exact ticker/name/alias beats prefix, then substring. */
export function searchCatalog(query: string, options: CatalogSearchOptions): readonly CatalogRecord[] {
  const needle = normalize(query);
  if (needle === '') return [];
  const limit = Math.min(8, Math.max(0, Math.floor(options.limit ?? 6)));
  return CATALOG.flatMap((record) => {
    if (
      record.kind !== options.kind ||
      (options.accountType !== undefined && !record.accountTypes.includes(options.accountType)) ||
      (options.currency !== undefined && record.currency !== options.currency)
    )
      return [];
    const terms = [record.name, record.symbol ?? '', ...record.aliases].map(normalize);
    const score = terms.some((term) => term === needle)
      ? 0
      : terms.some((term) => term.startsWith(needle))
        ? 1
        : terms.some((term) => term.includes(needle))
          ? 2
          : -1;
    return score < 0 ? [] : [{ record, score }];
  })
    .sort((a, b) => a.score - b.score || a.record.name.localeCompare(b.record.name, 'en'))
    .slice(0, limit)
    .map(({ record }) => record);
}
