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

type Mark = Pick<CatalogRecord, 'logoPath' | 'logoSourceUrl' | 'logoLicense'>;
const NO_LISTING = { symbol: null, venue: null, currency: null, assetClass: null, market: null };
const NO_LOGO: Mark = { logoPath: null, logoSourceUrl: null, logoLicense: null };
const DATA_LICENSE = 'AGPL-3.0-only (original factual curation; not source website content)';
const TRADEMARK = 'trademark rights reserved by the owner';
/** An unmodified Wikimedia Commons file, under the license its file page states. */
const commons = (slug: string, file: string, license = 'Public domain'): Mark => ({
  logoPath: `/catalog-logos/${slug}.svg`,
  logoSourceUrl: `https://commons.wikimedia.org/wiki/File:${file.replaceAll(' ', '_')}`,
  logoLicense: `${license} (Wikimedia Commons); ${TRADEMARK}`,
});
/** The brand's own published icon (its website or App Store listing), scaled to 128 px. */
const official = (slug: string, sourceUrl: string): Mark => ({
  logoPath: `/catalog-logos/${slug}.png`,
  logoSourceUrl: sourceUrl,
  logoLicense: `Brand-published icon, used only to identify the user's own account; ${TRADEMARK}`,
});
const provider = (
  slug: string,
  name: string,
  aliases: readonly string[],
  accountTypes: readonly AccountType[],
  sourceUrl: string,
  mark: Mark = NO_LOGO,
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
  mark: Mark = NO_LOGO,
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
/** A listing: `venue` is its ISO 10383 MIC (ARCX = NYSE Arca); `currency` is the listing's, not the platform's. */
const stock = (
  venue: 'XIDX' | 'XNAS' | 'XNYS' | 'ARCX',
  symbol: string,
  name: string,
  aliases: readonly string[],
  sourceUrl: string,
  mark: Mark = NO_LOGO,
  assetClass: AssetClass = venue === 'XIDX' ? 'indonesia' : 'us_stocks',
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
  assetClass,
  market: venue === 'XIDX' ? 'idx_equity' : 'us_equity',
  dataLicense: DATA_LICENSE,
  ...mark,
});
const BANK: readonly AccountType[] = ['bank', 'credit_card'];
const WALLET: readonly AccountType[] = ['ewallet'];
const BROKER: readonly AccountType[] = ['investment'];

const BCA = commons('bca', 'Bank Central Asia.svg', 'Public domain (PD-textlogo)');
const MANDIRI = commons('mandiri', 'Bank Mandiri logo 2016.svg');
const BRI = commons('bri', 'BRI 2025.svg');
const BNI = commons('bni', 'Bank Negara Indonesia logo (2004).svg');
const TELKOM = commons('telkom', 'TelkomGroup 2013.svg');

/** Kept in the database by the reference-catalog migrations; no runtime third-party requests. */
export const CATALOG: readonly CatalogRecord[] = [
  provider('bca', 'BCA', ['Bank Central Asia', 'Bank BCA', 'myBCA'], BANK, 'https://www.bca.co.id/', BCA),
  provider('mandiri', 'Bank Mandiri', ['Mandiri', 'Livin'], BANK, 'https://www.bankmandiri.co.id/', MANDIRI),
  provider('bri', 'BRI', ['Bank Rakyat Indonesia', 'BRImo'], BANK, 'https://bri.co.id/', BRI),
  provider('bni', 'BNI', ['Bank Negara Indonesia', 'wondr'], BANK, 'https://www.bni.co.id/', BNI),
  provider(
    'bsi',
    'Bank Syariah Indonesia',
    ['BSI', 'BYOND'],
    ['bank'],
    'https://www.bankbsi.co.id/',
    commons('bsi', 'Bank Syariah Indonesia.svg'),
  ),
  provider(
    'cimb-niaga',
    'CIMB Niaga',
    ['CIMB', 'OCTO'],
    BANK,
    'https://www.cimbniaga.co.id/',
    commons('cimb-niaga', 'CIMB Niaga logo.svg'),
  ),
  provider('jago', 'Bank Jago', ['Jago'], ['bank'], 'https://www.jago.com/', commons('jago', 'Bank Jago 2026.svg')),
  provider(
    'jenius',
    'Jenius',
    ['SMBC Indonesia', 'BTPN'],
    BANK,
    'https://www.jenius.com/',
    official('jenius', 'https://www.jenius.com/assets/ico/apple-touch-icon.png'),
  ),
  provider(
    'seabank',
    'SeaBank',
    ['Sea Bank'],
    ['bank'],
    'https://www.seabank.co.id/',
    commons('seabank', 'SeaBank.svg'),
  ),
  provider(
    'gopay',
    'GoPay',
    ['Go Pay', 'Gojek'],
    WALLET,
    'https://gopay.co.id/',
    commons('gopay', 'Gopay logo (2019).svg'),
  ),
  provider('ovo', 'OVO', ['Grab OVO'], WALLET, 'https://www.ovo.id/', commons('ovo', 'Logo ovo purple.svg')),
  provider(
    'dana',
    'DANA',
    ['Dompet Digital Indonesia'],
    WALLET,
    'https://www.dana.id/',
    commons('dana', 'Logo dana blue.svg'),
  ),
  provider(
    'shopeepay',
    'ShopeePay',
    ['Shopee Pay'],
    WALLET,
    'https://shopeepay.co.id/',
    official('shopeepay', 'https://shopeepay.co.id/favicon.png'),
  ),
  provider(
    'linkaja',
    'LinkAja',
    ['Link Aja', 'TCASH'],
    WALLET,
    'https://www.linkaja.id/',
    commons('linkaja', 'LinkAja.svg'),
  ),
  provider(
    'stockbit',
    'Stockbit',
    ['Stockbit Sekuritas'],
    BROKER,
    'https://stockbit.com/',
    official('stockbit', 'https://web-assets.stockbit.com/apple-touch-icon.png'),
  ),
  provider(
    'ajaib',
    'Ajaib',
    ['Ajaib Sekuritas'],
    BROKER,
    'https://ajaib.co.id/',
    official('ajaib', 'https://ajaib.co.id/apple-touch-icon.png'),
  ),
  provider(
    'ipot',
    'IPOT',
    ['Indo Premier', 'Indopremier'],
    BROKER,
    'https://www.indopremier.com/',
    official('ipot', 'https://apps.apple.com/id/app/id1514387216'),
  ),
  provider(
    'bibit',
    'Bibit',
    ['Bibit investasi'],
    BROKER,
    'https://bibit.id/',
    official('bibit', 'https://bibit.id/favicon/apple-touch-icon.png'),
  ),
  provider(
    'gotrade',
    'Gotrade',
    ['Go Trade', 'Gotrade Indonesia'],
    BROKER,
    'https://www.heygotrade.com/',
    official('gotrade', 'https://www.heygotrade.com/icons/icon-256x256.png?v=87238e2377ef075916eef41f358c18fe'),
  ),
  provider(
    'pluang',
    'Pluang',
    ['Pluang investasi'],
    BROKER,
    'https://pluang.com/',
    official('pluang', 'https://apps.apple.com/id/app/id1341588054'),
  ),
  provider(
    'bareksa',
    'Bareksa',
    ['Bareksa reksa dana'],
    BROKER,
    'https://www.bareksa.com/',
    official('bareksa', 'https://www.bareksa.com/'),
  ),
  provider(
    'indodax',
    'Indodax',
    ['Bitcoin.co.id'],
    BROKER,
    'https://indodax.com/',
    official('indodax', 'https://indodax.com/v3-exchange/icons/icon_512x512.aa03b9.png'),
  ),
  provider(
    'tokocrypto',
    'Tokocrypto',
    ['Toko Crypto'],
    BROKER,
    'https://www.tokocrypto.com/',
    official('tokocrypto', 'https://apps.apple.com/id/app/id1538556690'),
  ),
  provider(
    'pintu',
    'Pintu',
    ['Pintu crypto'],
    BROKER,
    'https://pintu.co.id/',
    official('pintu', 'https://pintu.co.id/android-chrome-512x512.png'),
  ),
  provider(
    'reku',
    'Reku',
    ['Rekeningku'],
    BROKER,
    'https://reku.id/',
    official('reku', 'https://images.reku.id/favicon/apple-icon-180x180.png'),
  ),
  provider(
    'binance',
    'Binance',
    ['Binance exchange'],
    BROKER,
    'https://www.binance.com/',
    commons('binance', 'Binance Logo.svg'),
  ),
  provider('okx', 'OKX', ['OKEx'], BROKER, 'https://www.okx.com/', commons('okx', 'OKX logo.svg')),
  provider(
    'bitget',
    'Bitget',
    ['Bitget exchange'],
    BROKER,
    'https://www.bitget.com/',
    commons('bitget', 'Bitget logo (2026).svg'),
  ),
  provider('bybit', 'Bybit', ['Bybit exchange'], BROKER, 'https://www.bybit.com/', commons('bybit', 'Bybit Logo.svg')),
  provider('kucoin', 'KuCoin', ['Ku Coin'], BROKER, 'https://www.kucoin.com/', commons('kucoin', 'KUCOIN.svg')),
  provider(
    'coinbase',
    'Coinbase',
    ['Coinbase exchange'],
    BROKER,
    'https://www.coinbase.com/',
    commons('coinbase', 'Coinbase.svg'),
  ),
  provider(
    'kraken',
    'Kraken',
    ['Kraken exchange', 'Payward'],
    BROKER,
    'https://www.kraken.com/',
    commons('kraken', 'K-logo-wikipedia.svg'),
  ),
  provider(
    'gate',
    'Gate',
    ['Gate.io', 'Gateio'],
    BROKER,
    'https://www.gate.com/',
    commons('gate', 'Gateio logo.svg', 'CC BY-SA 4.0, by Diongui'),
  ),
  provider(
    'mexc',
    'MEXC',
    ['MEXC Global'],
    BROKER,
    'https://www.mexc.com/',
    commons('mexc', 'Mexcglobal.svg', 'CC BY-SA 4.0, by MEXC Global'),
  ),
  provider(
    'cryptocom',
    'Crypto.com',
    ['Crypto com', 'CDC'],
    BROKER,
    'https://crypto.com/',
    official('cryptocom', 'https://apps.apple.com/id/app/id1569309855'),
  ),
  provider(
    'ibkr',
    'Interactive Brokers',
    ['IBKR'],
    BROKER,
    'https://www.interactivebrokers.com/',
    commons('ibkr', 'Interactive Brokers Logo (2014).svg'),
  ),
  provider(
    'schwab',
    'Charles Schwab',
    ['Schwab'],
    BROKER,
    'https://www.schwab.com/',
    commons('schwab', 'Charles Schwab Corporation logo.svg'),
  ),
  provider(
    'chase',
    'Chase',
    ['JPMorgan Chase', 'JP Morgan'],
    BANK,
    'https://www.chase.com/',
    commons('chase', 'Chase logo 2007.svg'),
  ),
  provider(
    'hsbc',
    'HSBC',
    ['Hongkong Shanghai Banking'],
    BANK,
    'https://www.hsbc.com/',
    commons('hsbc', 'HSBC logo (2018).svg'),
  ),
  provider(
    'dbs',
    'DBS',
    ['digibank'],
    BANK,
    'https://www.dbs.com/',
    official('dbs', 'https://apps.apple.com/id/app/id1170988769'),
  ),
  provider('wise', 'Wise', ['TransferWise'], ['bank'], 'https://wise.com/', commons('wise', 'Wise Logo 512x124.svg')),
  stock(
    'XIDX',
    'BBCA',
    'Bank Central Asia',
    ['BCA', 'PT Bank Central Asia Tbk'],
    'https://www.bca.co.id/en/tentang-bca/Hubungan-Investor',
    BCA,
  ),
  stock('XIDX', 'BBRI', 'Bank Rakyat Indonesia', ['BRI'], 'https://www.ir-bri.com/', BRI),
  stock('XIDX', 'BMRI', 'Bank Mandiri', ['Mandiri'], 'https://www.bankmandiri.co.id/', MANDIRI),
  stock('XIDX', 'BBNI', 'Bank Negara Indonesia', ['BNI'], 'https://www.bni.co.id/', BNI),
  stock('XIDX', 'TLKM', 'Telkom Indonesia', ['Telkom'], 'https://www.telkom.co.id/', TELKOM),
  stock(
    'XIDX',
    'ASII',
    'Astra International',
    ['Astra'],
    'https://www.astra.co.id/',
    commons('astra', 'ASTRA international.svg'),
  ),
  stock(
    'XNAS',
    'AAPL',
    'Apple',
    ['Apple Inc'],
    'https://investor.apple.com/',
    commons('apple', 'Apple logo black.svg'),
  ),
  stock(
    'XNAS',
    'MSFT',
    'Microsoft',
    ['Microsoft Corporation'],
    'https://www.microsoft.com/en-us/Investor/',
    commons('microsoft', 'Microsoft logo.svg'),
  ),
  stock(
    'XNAS',
    'GOOGL',
    'Alphabet Class A',
    ['Google', 'Alphabet'],
    'https://abc.xyz/investor/',
    commons('google', 'Google 2015 logo.svg'),
  ),
  stock(
    'XNAS',
    'NVDA',
    'NVIDIA',
    ['Nvidia Corporation'],
    'https://investor.nvidia.com/',
    commons('nvidia', 'Nvidia logo.svg'),
  ),
  stock(
    'XNYS',
    'JPM',
    'JPMorgan Chase',
    ['JP Morgan', 'Chase'],
    'https://www.jpmorganchase.com/ir',
    commons('jpmorganchase', 'Logo of JPMorganChase 2024.svg'),
  ),
  stock(
    'XNYS',
    'TLK',
    'Telkom Indonesia ADR',
    ['Telkom', 'American Depositary Shares'],
    'https://www.telkom.co.id/',
    TELKOM,
  ),
  stock(
    'XNAS',
    'QQQ',
    'Invesco QQQ Trust',
    ['Nasdaq 100', 'Invesco QQQ'],
    'https://www.invesco.com/qqq-etf/',
    official(
      'invesco',
      'https://www.invesco.com/etc.clientlibs/invesco/clientlibs/main/resources/images/apple-touch-icon.png',
    ),
  ),
  stock(
    'ARCX',
    'SPY',
    'SPDR S&P 500 ETF Trust',
    ['S&P 500', 'SPDR'],
    'https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy',
    commons('ssga', 'State Street Global Advisors.svg'),
  ),
  stock(
    'ARCX',
    'VWO',
    'Vanguard FTSE Emerging Markets ETF',
    ['Vanguard Emerging Markets', 'Emerging markets'],
    'https://investor.vanguard.com/investment-products/etfs/profile/vwo',
    commons('vanguard', 'Vanguard.svg'),
    'international',
  ),
  stock(
    'ARCX',
    'VEA',
    'Vanguard FTSE Developed Markets ETF',
    ['Vanguard Developed Markets', 'Developed markets'],
    'https://investor.vanguard.com/investment-products/etfs/profile/vea',
    commons('vanguard', 'Vanguard.svg'),
    'international',
  ),
  stock(
    'ARCX',
    'SCHD',
    'Schwab U.S. Dividend Equity ETF',
    ['Schwab Dividend', 'Dividend ETF'],
    'https://www.schwabassetmanagement.com/products/schd',
    commons('schwab', 'Charles Schwab Corporation logo.svg'),
  ),
  stock(
    'ARCX',
    'GDX',
    'VanEck Gold Miners ETF',
    ['Gold miners', 'VanEck Gold'],
    'https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/',
    commons('vaneck', 'Vaneck.svg'),
    'gold',
  ),
  stock(
    'ARCX',
    'GLD',
    'SPDR Gold Shares',
    ['Gold', 'Emas', 'SPDR Gold'],
    'https://www.spdrgoldshares.com/',
    commons('ssga', 'State Street Global Advisors.svg'),
    'gold',
  ),
  stock(
    'ARCX',
    'SGOV',
    'iShares 0-3 Month Treasury Bond ETF',
    ['T-Bill', 'Treasury', 'iShares Treasury'],
    'https://www.ishares.com/us/products/314116/ishares-0-3-month-treasury-bond-etf',
    commons('ishares', 'Logo-ishares 2019.svg'),
    'cash',
  ),
  stock(
    'XNYS',
    'GS',
    'Goldman Sachs',
    ['Goldman Sachs Group'],
    'https://www.goldmansachs.com/investor-relations/',
    commons('goldman-sachs', 'Goldman Sachs.svg'),
  ),
  stock(
    'ARCX',
    'AMDY',
    'YieldMax AMD Option Income Strategy ETF',
    ['YieldMax AMD', 'AMD income'],
    'https://yieldmaxetfs.com/our-etfs/amdy/',
    official('yieldmax', 'https://yieldmaxetfs.com/wp-content/uploads/2025/09/fav.png'),
    'income',
  ),
  stock(
    'ARCX',
    'MSTY',
    'YieldMax MSTR Option Income Strategy ETF',
    ['YieldMax MSTR', 'MicroStrategy income'],
    'https://yieldmaxetfs.com/our-etfs/msty/',
    official('yieldmax', 'https://yieldmaxetfs.com/wp-content/uploads/2025/09/fav.png'),
    'income',
  ),
  stock(
    'ARCX',
    'NVDY',
    'YieldMax NVDA Option Income Strategy ETF',
    ['YieldMax NVDA', 'Nvidia income'],
    'https://yieldmaxetfs.com/our-etfs/nvdy/',
    official('yieldmax', 'https://yieldmaxetfs.com/wp-content/uploads/2025/09/fav.png'),
    'income',
  ),
  service(
    'netflix',
    'Netflix',
    ['Netflix Indonesia'],
    'https://www.netflix.com/',
    commons('netflix', 'Netflix 2015 logo.svg', 'Public domain (PD-textlogo)'),
  ),
  service(
    'youtube-premium',
    'YouTube Premium',
    ['YouTube', 'YT Premium', 'YouTube Music'],
    'https://www.youtube.com/premium',
    commons('youtube', 'YouTube full-color icon (2024).svg', 'Public domain (PD-textlogo)'),
  ),
  service(
    'spotify',
    'Spotify',
    ['Spotify Premium', 'musik', 'music'],
    'https://www.spotify.com/',
    commons('spotify', 'Spotify logo without text.svg', 'Public domain (PD-textlogo)'),
  ),
  service(
    'disney-plus',
    'Disney+',
    ['Disney Plus', 'Disney Hotstar', 'Disney+ Hotstar'],
    'https://www.disneyplus.com/',
    commons('disney-plus', 'Disney+ 2024.svg'),
  ),
  service('vidio', 'Vidio', ['Vidio Premier'], 'https://www.vidio.com/', commons('vidio', 'Vidio logo.svg')),
  service('viu', 'Viu', ['Viu Premium'], 'https://www.viu.com/', commons('viu', 'Viu logo.svg')),
  service(
    'apple-music',
    'Apple Music',
    ['Apple musik'],
    'https://www.apple.com/apple-music/',
    commons('apple-music', 'Apple Music icon.svg'),
  ),
  service(
    'icloud',
    'iCloud+',
    ['iCloud', 'Apple iCloud'],
    'https://www.apple.com/icloud/',
    commons('icloud', 'ICloud logo.svg'),
  ),
  service(
    'google-one',
    'Google One',
    ['Google Drive', 'Google storage'],
    'https://one.google.com/',
    commons('google-one', 'Google One logo.svg'),
  ),
  service(
    'microsoft-365',
    'Microsoft 365',
    ['Office 365', 'Microsoft Office'],
    'https://www.microsoft.com/microsoft-365',
    commons('microsoft-365', 'Microsoft 365 (2022).svg'),
  ),
  service(
    'canva',
    'Canva',
    ['Canva Pro'],
    'https://www.canva.com/',
    official('canva', 'https://static.canva.com/domain-assets/canva/static/images/android-192x192-2.png'),
  ),
  service('notion', 'Notion', ['Notion Plus'], 'https://www.notion.com/', commons('notion', 'Notion-logo.svg')),
  service(
    'prime-video',
    'Prime Video',
    ['Amazon Prime', 'Amazon Video'],
    'https://www.primevideo.com/',
    commons('prime-video', 'Amazon Prime Video logo (2024).svg'),
  ),
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
