# Research: Free Market Data Sources for write.financial

Verified on 17 Oct 2026 from official pages (pricing/docs/terms). In addition to reading the pages, a number of endpoints were tested directly with `curl` and a headless browser from the research workstation. Test results are marked **[tested 17-10]**. Figures or clauses that could not be confirmed from a primary source are marked **[UNVERIFIED]**. Conclusions that are the author's interpretation are marked **[INFERENCE]**.

Terms used in this document:
- **Server-shared**: the write.financial server fetches the data once, stores it in a global cache, then shows it to many users.
- **BYOK**: the user enters their own personal key. Requests use that key, and the results are for that user only.
- **Manual**: the user types the price or NAV themselves.

---

## 0. Key findings (TL;DR)

1. **FX rates**: there is a source that is truly free, keyless, and allowed for commercial use: **Frankfurter**. Frankfurter also offers a **Bank Indonesia (BI transaction rate)** provider. Backups are **fawazahmed0/exchange-api** (CC0) and **open.er-api.com** (attribution required).
2. **US stocks/ETFs, IDX stocks, IHSG**: there is no free, keyless source that may legally be displayed to the public. Every free tier (Finnhub, Alpha Vantage, Tiingo, Massive/Polygon, EODHD, Marketstack, Twelve Data, FMP) is licensed *personal/internal/non-commercial*, or its display license must be purchased. Therefore: **BYOK + manual**, with no server default.
3. **Crypto**: there is no keyless source with explicit shared/commercial permission.
   - **CoinMarketCap Basic** (free key owned by the operator) explicitly grants *commercial use* for one product with ≤100k users and allows caching. This is the server-default candidate, even though it needs a free operator-owned key.
   - CoinGecko Demo/keyless does **not** include commercial rights.
   - Indodax's General Terms & Conditions (SKU) restrict use of the platform and its data to personal purposes.
4. **Gold**:
   - Daily XAU spot can be taken from **fawazahmed0** (CC0, keyless, includes IDR).
   - Antam prices (logammulia.com) **have no API**. Get them via manual input, or show an estimate derived from spot.
   - GoldAPI.io and metals.dev can be BYOK (100 requests/month each).
5. **Mutual fund NAV & SBN (government retail bond) prices**: no legal free API.
   - Pasardana's terms forbid reuse of data without written permission.
   - For mutual funds: **manual**.
   - For ORI: compute the value locally from nominal + fixed coupon.
6. **Prohibited**: unofficial Yahoo Finance (`query1.finance.yahoo.com`, yfinance) and Stooq. Also prohibited: scraping Pasardana, Bareksa, Bibit, logammulia, IDX, and BI for a shared service.

---

## 1. Candidate table per need

Legend for the "Public/commercial permission" column:
- ✅ may be displayed in a public/commercial app
- ⚠️ gray area, or conditions apply
- ❌ personal/non-commercial only, or prohibited

### 1.1 USD/IDR, SGD, and other exchange rates (daily + historical)

| API | Key? | Free quota (official source) | Coverage | Public/commercial permission | Notes | Source URL |
|---|---|---|---|---|---|---|
| **Frankfurter** (`api.frankfurter.dev/v2`) | No | "There are no quotas. Requests are rate-limited to prevent abuse, but there are no monthly or daily caps." The rate-limit figure is not published. | 223 currencies from 104 central banks. IDR ✔ (provider `bi`: 27 currencies, data since 2024-01-02; ECB also has IDR). Historical since 1948, `from/to` time series, `group=month`. No XAU. | ✅ "Is the API free for commercial use? Yes. Blended rates are Frankfurter's own calculation". Caching "encouraged". Per-provider endpoints are subject to the provider's terms. For BI: "None published". | [tested 17-10] `GET /v2/rate/usd/idr` → `{"rate":17989}`. BI rates are of type *transaction* (BI transaction rate, not JISDOR). Updated daily. | https://frankfurter.dev/ , https://frankfurter.dev/license/ , https://frankfurter.dev/providers/bi/ |
| **fawazahmed0/exchange-api** (jsDelivr + Cloudflare Pages fallback) | No | README: "No Rate limits", "Daily Updated". jsDelivr: "free for both personal and commercial use, there are no limits on bandwidth or number of requests". However, mass scraping of unique files is considered abuse. | 200+ currencies, including crypto & metals (XAU). Historical via date tag `@YYYY-MM-DD`. | ✅ Repo license **CC0-1.0**. Upstream data origin is undocumented → quality needs cross-checking. | [tested 17-10] `xau.min.json` dated 2026-10-16: XAU→IDR 75.442.309, XAU→USD 4.182,94. The README requires a fallback mechanism to `currency-api.pages.dev`. | https://github.com/fawazahmed0/exchange-api , https://www.jsdelivr.com/terms/acceptable-use-policy-jsdelivr-net |
| **open.er-api.com** (ExchangeRate-API Open Access) | No | "Rate Limited". A rate-limited IP gets 429 and is unblocked after 20 minutes. Recommended: request 1×/24 hours (or at most 1×/hour). | ±160 currencies, IDR ✔. **No historical data.** Updated 1×/day. | ⚠️ May be cached and used for "personal or commercial currency conversion purposes", **attribution required** (link "Rates By Exchange Rate API"). **No redistribution**, and the data may not be used in a "product or service that offers programmatic or automatic access to exchange rate data". | Has a `time_eol_unix` field as a deprecation signal. Free plan *with key*: 1.5k requests/month, no attribution. | https://www.exchangerate-api.com/docs/free , https://www.exchangerate-api.com/terms |
| **Bank Indonesia – JISDOR / BI Transaction Rate** (bi.go.id site) | – | No official public API found. The HTML page shows a table (JISDOR 16 Oct 2026 displayed). | USD/IDR (JISDOR); 27 currencies (transaction rate). | ⚠️ BI terms page not found [UNVERIFIED]. From the research server, `curl` to bi.go.id timed out; via browser it works. | BI transaction rates are already available via Frankfurter (`providers=bi`), so scraping is unnecessary. JISDOR itself is not available in Frankfurter [UNVERIFIED]. | https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx |
| ExchangeRate-API Free (key) | Yes | 1,500 requests/month, daily updates | IDR ✔; historical on paid plans only [UNVERIFIED] | ✅ ToS: "both Free Plan and paid … are suitable for either commercial or personal use". Still no redistribution. | Optional, not needed. | https://www.exchangerate-api.com/docs/free |
| Alpha Vantage FX, Twelve Data FX, Finnhub FX | Yes | see §1.2 | | ❌ personal / non-display | Not needed since Frankfurter exists. | |

### 1.2 US stock/ETF prices (SPY, QQQ, SCHD, VEA, VWO, SGOV, NVDA, MSFT, AAPL, GOOGL, AMZN, MSTY, NVDY, TSLY, CONY), 15-minute interval, plus SPY benchmark

| API | Key? | Free quota (official source) | Coverage | Public/commercial permission | Notes | Source URL |
|---|---|---|---|---|---|---|
| **Finnhub** | Yes | "Limit 60 API calls/minute". Plus a global limit of "30 API calls/second". Exceeding → HTTP **429**. | `/quote` real-time US stocks (including ETFs [UNVERIFIED for YieldMax ETFs]). Field `pc` = previous close. **Stock Candles = Premium** (historical not available for free). International markets/IDX = Enterprise. | ❌ "All plan … strictly for personal use"; "not redistribute or share access to data or derived results … with anyone". Only suitable as BYOK. | [tested 17-10] without key → 401 `{"error":"Please use an API key."}`. Data must be deleted when the subscription ends. | https://finnhub.io/pricing , https://finnhub.io/docs/api/rate-limit , https://finnhub.io/docs/api/quote , https://finnhub.io/terms-of-service |
| **Tiingo** (Starter, free) | Yes | 50 requests/hour, 1,000 requests/day, 500 unique symbols/month, 1 GB/month bandwidth | US & China stocks 49,571, ETFs & mutual funds 60,756. EOD history 30+ years. IEX feed (intraday/last). Endpoint `/iex?tickers=a,b,c` fetches many tickers in 1 request. Crypto ✔. No IDX. | ❌ License "Internal Use Only" (individual). Redistribution requires a special paid product. | [tested 17-10] `/api/test` without token → `"'AUTHORIZATION header' was not set"`; wrong token → `"Auth Token was not correct"`. | https://www.tiingo.com/about/pricing , https://www.tiingo.com/documentation/iex |
| **Massive (formerly Polygon)** Stocks Basic | Yes | "5 API Calls / Minute", 2 years of history, **End of Day** | All US tickers. Endpoint `GET /v2/aggs/grouped/locale/us/market/stocks/{date}` returns OHLC for **all US stocks in 1 request** (Basic: "Included", recency "End-of-day"). No intraday/snapshot on Basic. | ❌ "Individual use". Terms for Individuals: "personal, individual, and non-business use". | [tested 17-10] wrong key → 401 `{"status":"ERROR","error":"Unknown API Key"}` (host `api.massive.com`). | https://massive.com/pricing , https://massive.com/docs/rest/stocks/aggregates/daily-market-summary.md , https://massive.com/legal/terms |
| **Alpha Vantage** | Yes | "25 API requests per day" | Global equities (e.g. .LON, .TRT, .DEX, .BSE, .SHH; **IDX not listed** [UNVERIFIED]), FX, crypto. US real-time & 15-minute delayed data = premium. Free `GLOBAL_QUOTE` = price & previous close of the last trading day. | ❌ ToS: personal, non-commercial. The "commercial" category includes activity that "allows individuals or entities other than User to access information". | [tested 17-10] key is **not validated**: `apikey=invalidkey123` still returns SPY data. Key `demo` → field `"Information"`. So a connection test cannot prove a key is valid. | https://www.alphavantage.co/support/ , https://www.alphavantage.co/terms_of_service/ (PDF) |
| **Twelve Data** Basic | Yes | 8 credits/minute, 800/day cap | Basic: US market only ("Real-time US equities, forex, crypto"). | ❌ Basic = "internal non-display usage only". Terms 2.3(l): "Use Free Tier data for commercial purposes" is prohibited. **Showing prices to humans counts as *display*.** | [tested 17-10] `apikey=demo` returns AAPL. Not recommended, even for BYOK. | https://twelvedata.com/pricing , https://twelvedata.com/terms |
| **Financial Modeling Prep** Basic | Yes | 250 calls/day, 500 MB bandwidth/30 days | Quota limited to sample symbols: "Symbol Limited to AAPL, TSLA, AMZN and 84 more". US only. 5 years EOD. | ❌ "Displaying or redistributing data sourced from FMP requires a specific Data Display and Licensing Agreement". | [tested 17-10] `apikey=demo` → 401 "Invalid API KEY". Not recommended. | https://site.financialmodelingprep.com/pricing-plans |
| **Marketstack** Free | Yes | 100 requests/month, EOD, 1 year history | 70 exchanges (US data sourced from Tiingo). Indices = Basic plan and up. The `symbols` parameter can take multiple symbols [UNVERIFIED for free]. | ❌ "Non-Commercial Use" | Only suitable for EOD 1×/day. | https://marketstack.com/pricing |
| **EODHD** Free | Yes | 20 calls/day, 20 requests/minute, 1 year EOD history, live/15-minute delayed (global) | Global including **Jakarta (JK)** and US. 1 call per EOD/live; 5 calls for intraday/news. | ❌ Non-Professional: prohibits "retransmitting, redistributing, displaying, or granting access" to other parties. | See §1.3. | https://eodhd.com/pricing , https://eodhd.com/financial-apis/terms-conditions |
| **Yahoo Finance (unofficial)** | No | – | Technically complete: US, `.JK`, `^JKSE`. [tested 17-10] `query1…/chart/BBCA.JK` → 200. | ❌ **PROHIBITED.** Yahoo ToS forbids "access or collect data … using any automated means … scrapers" without permission, as well as commercial use and building a "data feed". | See §4. | https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html |
| **Stooq** | No | – | Historical CSV | ❌ "This data is intended solely for personal use. Any commercial use is prohibited." [tested 17-10] the CSV endpoint now uses a JS proof-of-work challenge. | See §4. | https://stooq.com/db/h/ |

### 1.3 IDX stocks (BBCA, BBRI, TLKM) + IHSG index + IHSG benchmark

| API | Key? | Free quota | Coverage | Permission | Notes | URL |
|---|---|---|---|---|---|---|
| **EODHD** Free | Yes | 20 calls/day, 20/minute, 1 year EOD, live 15-minute delayed | Exchange **JK** listed (BBCA.JK has a summary page). IHSG is probably `JKSE.INDX` [UNVERIFIED for free tier]. | ❌ personal (Non-Professional), OK for BYOK | [tested 17-10] token `demo` → 403 for `.JK`/`.INDX` (demo only works for certain symbols). Header `x-ratelimit-limit: 1200`. | https://eodhd.com/pricing , https://eodhd.com/exchange/JK |
| **Marketstack** Free | Yes | 100 requests/month, EOD | XIDX exchange [UNVERIFIED for free]. Indices not available on Free. | ❌ Non-Commercial | EOD-only BYOK backup. | https://marketstack.com/pricing |
| Twelve Data | Yes | Basic: US only; IDX from Grow ($29) | | ❌ | – | https://twelvedata.com/pricing |
| Finnhub | Yes | International quotes = Enterprise | | ❌ | Cannot be used for IDX. | https://finnhub.io/docs/api/quote |
| idx.co.id (IDX website) | – | No public API; terms page not found [UNVERIFIED] | | ❌ Exchange data is licensed (vendors). Scraping = risk. | Do not use. | – |
| Yahoo `.JK` / `^JKSE` | – | | | ❌ PROHIBITED | | see §1.2 |

### 1.4 Crypto (BTC, ETH, SOL) in IDR/USD, 5-minute interval

| API | Key? | Free quota | Coverage | Permission | Notes | URL |
|---|---|---|---|---|---|---|
| **CoinMarketCap Basic** | Yes (free) | **15,000 credits/month**, **50 requests/minute**, updates every 60 seconds, conversion: "Limit 1 per call", 1 API key | Price, market cap, `percent_change_24h`. Conversion to IDR ✔. Historical endpoints not available on Basic [UNVERIFIED]. | ✅ "Basic through Professional all include commercial use rights — the free Basic tier included … covers one product with up to 100k users". No redistribution/resale as a data service. Local caching allowed ("intentionally worded to allow legitimate local caching"). | 1 credit per 100 assets per call. Each additional `convert` adds credits. Response includes `status.credit_count`. 429 errors: 1008 (minute), 1009 (daily), 1010 (monthly), 1011 (IP). | https://coinmarketcap.com/api/pricing/ , https://coinmarketcap.com/llms-full.txt |
| **CoinMarketCap Keyless** (`/public-api`) | No | "IP-based rate pool", figure not published | 18 standard endpoints, including `/v2/simple/price` and `/v3/cryptocurrency/quotes/latest` | ⚠️ No keyless-specific license clause found [UNVERIFIED]. Pricing FAQ describes keyless as for exploration; a free key is recommended for production. | [tested 17-10] `simple/price?symbol=BTC,ETH,SOL&convert=IDR` → 200, `credit_count:1`, BTC ≈ Rp1,47 M. | https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api.md |
| **CoinGecko Demo** | Yes (free) | **10,000 calls/month**, **100 calls/minute** (docs: "Demo plan: 100 calls/min"). 1 year of daily/hourly history. | `/simple/price` multi-id & multi `vs_currencies` (idr,usd) in 1 call | ❌ for shared/commercial. Help center: "Does the Demo (free) API plan include commercial rights? No". BYOK FAQ: "If you sell a product … you need a paid API plan … even if users supply their own API keys." "Powered by CoinGecko" attribution required. Cache must be refreshed ≤24 hours. | BYOK only ⚠️ and only if write.financial is not sold/monetized [INFERENCE]. Errors: 401 (10002/10010/10011), 429. CORS not supported, must go through a backend proxy. | https://www.coingecko.com/en/api/pricing , https://docs.coingecko.com/docs/errors-and-rate-limits , https://support.coingecko.com/articles/1043089972-what-are-the-differences-between-commercial-and-custom-licenses , https://www.coingecko.com/en/api_terms |
| CoinGecko Keyless | No | IP-based | same | ❌ FAQ: commercial products still need a paid plan | – | same |
| **Indodax Public API** | No | "Public API rate limited to 180request/minute" | Native IDR pairs (btcidr, ethidr, solidr, usdtidr, **paxgidr, xautidr**). `/api/ticker_all` and `/api/summaries` fetch all pairs in 1 call, including `prices_24h`. OHLC `/tradingview/history_v2`. | ⚠️ Docs: "open data for public". However, Indodax SKU: Platform access rights are "semata-mata untuk tujuan pribadi" (solely for personal purposes); "dilarang memperbanyak, … mendistribusikan, … mengkomersialkan … tanpa izin tertulis" (reproducing, distributing, commercializing … without written permission is prohibited). The IP page names "data" as Indodax property. | [tested 17-10] `/api/ticker/btcidr` → last Rp1.459.802.000. Viable for shared use **after obtaining written permission** (Indonesian company, realistic request). | https://raw.githubusercontent.com/btcid/indodax-official-api-docs/master/Public-RestAPI.md , https://help.indodax.com/hc/id/articles/4416650994585-SYARAT-DAN-KETENTUAN-UMUM |
| **Binance public market data** (`data-api.binance.vision`) | No | Weight-based limit per IP. Violation → 429, then 418 ban (2 minutes to 3 days). Headers `X-MBX-USED-WEIGHT-*`, `Retry-After`. | No IDR pairs (use USDT, then multiply by the exchange rate). Historical klines ✔. | ⚠️ Binance ToS prohibits "use the Services for resale or commercial purposes" (from a search-result quote; the ToS page could not be opened) [fully UNVERIFIED]. | [tested 17-10] `api.binance.com` & `www.binance.com` → TLS certificate error (interception, likely Indonesian ISP blocking [INFERENCE]). `data-api.binance.vision` → 200. | https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/rest-api.md , …/faqs/market_data_only.md |
| **Tokocrypto public API** | No | Limits similar to Binance (weight per IP, 429/418) | IDR pairs [UNVERIFIED] | ⚠️ Data ToS not found [UNVERIFIED] | [tested 17-10] `/open/v1/common/time` → 200. Not needed. | https://www.tokocrypto.com/apidocs/ |

### 1.5 Gold (XAU spot, Antam/Pluang prices in IDR)

| API | Key? | Free quota | Coverage | Permission | Notes | URL |
|---|---|---|---|---|---|---|
| **fawazahmed0** (`currencies/xau.json`) | No | No limit (see §1.1) | Daily XAU→IDR/USD + historical by date | ✅ CC0 | Upstream source undocumented. Cross-check with other sources. | see §1.1 |
| **GoldAPI.io** Sandbox | Yes | "Up to 100/month" (pricing page JS bundle) | XAU/XAG/XPT/XPD in ~70 currencies, including **IDR**. `/api/price/XAU/IDR`, historical by date, `/api/history` max 90 days. | ⚠️ Terms could not be loaded (SPA) [UNVERIFIED] | [tested 17-10] `/api/stat` without key → 403 `{"error":"No API Key provided"}`. Headers `x-ratelimit-limit: 10`, `x-ratelimit-remaining`, `x-ratelimit-reset`. | https://www.goldapi.io/pricing , https://www.goldapi.io/llms.txt |
| **metals.dev** Free | Yes | "100 requests per month", 60-second updates | Spot + LBMA/LME/MCX + exchange rates (IDR ✔) | ⚠️ Terms could not be loaded [UNVERIFIED] | Errors: 1101 invalid key; **1203 this month's quota (including grace) exhausted**. `GET /usage` shows remaining quota. | https://metals.dev/pricing , https://metals.dev/docs |
| **Indodax PAXG/IDR, XAUT/IDR** | No | 180 requests/minute | Gold tokens (1 token ≈ 1 troy oz) in IDR | ⚠️ same as Indodax in §1.4 | [tested 17-10] paxgidr Rp74.986.529, xautidr Rp74.470.000. A proxy, not an official spot price. | see §1.4 |
| **Logam Mulia (logammulia.com) – Antam prices** | – | No API. Page: "Harga di-update setiap hari pkl. 08.30 WIB" (prices updated daily at 08:30 WIB) | Prices for 0.5 g to 1 kg (base price and +0.25% PPh tax). [tested 17-10] 1 gr = Rp2.572.000 / Rp2.578.430. | ⚠️/❌ Terms page not found [UNVERIFIED]. Scraping for shared display is risky. | **Manual.** | https://www.logammulia.com/id/harga-emas-hari-ini |
| Pluang | – | No public API found [UNVERIFIED] | | ❌ | **Manual.** | – |

### 1.6 Indonesian mutual fund NAV (Bibit RDPU, IDX30)

| Source | Key? | Access | Coverage | Permission | Notes | URL |
|---|---|---|---|---|---|---|
| **Pasardana** | – | No official API. Has a web table + DOWNLOAD button (1,540 mutual funds, reference date 16-Oct-2026). | Daily NAV per product, 1D/MtD/YtD | ❌ Terms: "Dilarang menggandakan, mencetak ulang, mendistribusikan, menyadur, menggunakan ulang, dan menyiarkan segala informasi … tanpa izin tertulis" (copying, reprinting, distributing, adapting, reusing, or broadcasting any information … without written permission is prohibited) | A license/permission can be requested from PT Bina Investama Infonet. | https://pasardana.id/fund/search , https://pasardana.id/term-of-use |
| **OJK – reksadana.ojk.go.id** | – | Web, no API | **Monthly aggregate** NAV statistics (published from the 8th of the following month). Product list (2,506 items) without per-unit NAV on the list page. | ⚠️ Government site. Still no daily NAV per product [UNVERIFIED for detail pages]. | Does not meet the daily need. | https://reksadana.ojk.go.id/Public/StatistikNABReksadanaPublic.aspx |
| Bareksa, Bibit, KSEI | – | No public API. Bareksa/Bibit terms pages could not be accessed [UNVERIFIED]. | | ❌ | **Manual** (user copies the NAV from the Bibit app / fund fact sheet). | – |
| Twelve Data "mutual funds NAV" | Yes | From Pro ($99) | | ❌ | Not a free option. | https://twelvedata.com/pricing |

### 1.7 Retail SBN (ORI026)

| Source | Access | Notes | URL |
|---|---|---|---|
| DJPPR/Ministry of Finance (information memorandum) | PDF/web, no API | ORI has a **fixed** coupon, paid monthly. ORI026 has two series (T3 and T6). Example: BCA lists "ORI026-T6 kupon 6,40% per tahun". T3 coupon and maturity date [UNVERIFIED], take from the memorandum. | https://djppr.kemenkeu.go.id/obligasinegararitel , https://www.bca.co.id/id/Individu/produk/Investasi-dan-Asuransi/obligasi/pasar-perdana/Obligasi-ORI026-T6 |
| PHEI (daily SBN fair market prices) | Web, no public API | Data usage terms not found [UNVERIFIED]. Manual reference only. | https://www.phei.co.id/en-us/Data/Fair-Prices-and-Yield |
| Distribution partners (secondary-market bid price) | In each partner's app | Manual | – |

### 1.8 Historical / yesterday's close / monthly snapshot (cross-asset)

| Need | Available legal source |
|---|---|
| FX yesterday's close & historical | Frankfurter `?date=` / `?from=&to=` (free, ✅), fawazahmed0 `@YYYY-MM-DD` |
| Crypto "today's change" | CMC `percent_change_24h` in quotes, or our own snapshot at 00:00 WIB (derived from polling) |
| US previous close | BYOK: Finnhub `pc`, Alpha Vantage `08. previous close`, Tiingo `prevClose` (IEX) [UNVERIFIED field name], Massive grouped daily |
| US/IHSG year-end (YTD baseline) | BYOK: Massive grouped daily for last year's final trading date (1 call for all US), Tiingo EOD, EODHD EOD (1 year → covers last year's 31 Dec until roughly the end of the following year). Or **manual, 1 number per year**. |
| Monthly snapshot | Built by write.financial itself from the daily cache (derived data of the user's portfolio value) |

---

## 2. Final recommendation per need

### 2.0 Architecture principles (apply to all assets)

1. **Global cache table** `market_quote(provider, symbol, quote_ccy, bucket_ts, price, prev_close, fetched_at, source_attr)`. `bucket_ts` = time rounded to the interval (5 minutes for crypto, 1 day for FX).
   - The scheduler only fetches the **union of symbols** across all users for server-shared sources.
   - Load per source stays O(number of unique symbols), not O(number of users).
   - User requests never trigger a fetch directly. User requests only read the cache. If the cache is stale, the user request sets a *debounced* "needs refresh" flag, and a worker fetches the data.
2. **Separate per-user BYOK cache**: `user_quote(user_id, provider, symbol, bucket_ts, …)`.
   - Results from user A's key **must not** be used for user B, because that is redistribution and violates Finnhub/AV/Tiingo/EODHD/Massive.
   - BYOK polling only during the relevant exchange hours and only for users active within the last N days.
   - Dedupe per user across devices.
3. **Price resolution priority per holding**: manual override (if the user set "kunci manual" (manual lock)) → user BYOK → server default → last known value (show label "per {tanggal}" (as of {date})).
4. Always store and show the **source + data time** ("Kurs: Frankfurter/BI, 16 Okt 2026"; "AAPL: Tiingo IEX, tertunda" (delayed)).
5. All keyless sources rate-limit per IP, and all users share a single server IP. Therefore the global cache is mandatory, with exponential backoff on 429.

### 2.1 USD/IDR, SGD, etc. exchange rates (daily)

- **Server default**: **Frankfurter**.
  - 1 call/day for all currencies: `GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=IDR,SGD,EUR,JPY,…`.
  - For Indonesia's "official" numbers: `GET /v2/providers/bi/rates?base=…`.
  - Run the cron after daily publication, e.g. 17:00 WIB and 08:00 WIB as a retry. Store 1 row per (date, currency).
  - Historical backfill: one time-series call `from=YYYY-01-01` (NDJSON available).
  - Load: ~1–2 calls/day total.
- **Ordered server fallbacks**:
  1. fawazahmed0 via jsDelivr (`cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json`)
  2. `latest.currency-api.pages.dev`
  3. open.er-api.com, at most 1×/day. If used, show the attribution "Rates By Exchange Rate API".
- **BYOK**: not needed. Optional ExchangeRate-API Free key (1,500 requests/month; 1×/day = 31/month ✔).
- **Manual**: the user may override the exchange rate per date, e.g. the actual rate when exchanging at a bank.

### 2.2 US stocks/ETFs (15 symbols, 15-minute interval) + SPY benchmark

- **Server default**: **none**. No free source is legally licensed for shared display. Without BYOK, show the manual price / last entered price.
- **BYOK (recommended order)**:
  1. **Tiingo**
     - IEX batch `GET /iex/?tickers=spy,qqq,…` → 1 call per slot for 15 tickers.
     - 15-minute interval during US market hours (09:30–16:00 ET = 26 slots) = **26 calls/day**. That is 4 calls/hour (< 50/hour), < 1,000/day, 15 unique symbols (< 500/month). ✔
     - Even a 2–5 minute interval still fits (max 25 calls/hour).
     - EOD/YTD: 1 call per ticker, once, for the year-end baseline.
  2. **Finnhub**
     - `/quote` 1 call per symbol → 15 calls/slot, 390 calls/day. 60/minute limit ✔. No published daily cap.
     - Provides `pc` for "today's change".
     - Historical (candles) is premium → YTD baseline must come from another source or manual.
  3. **Massive Basic**
     - 1 call/day `grouped/…/stocks/{date}` covers all tickers (EOD).
     - YTD baseline: 1 call for last year's final trading date. ✔ for daily.
     - ✘ for 15 minutes (Basic is EOD only) → **suggest a daily interval**.
  4. **Alpha Vantage**
     - 25/day → at most 1×/day after market close for 15 symbols (15 calls) + 10 spare.
     - ✘ for 15 minutes (needs 390 calls/day). **Suggest daily.**
  - Not recommended: Twelve Data (non-display), FMP (display requires a license + sample symbols), Marketstack (100/month, EOD).
- **Manual**: input price per symbol, or "kunci harga manual" (lock manual price).
- **Per-user fallback order**: primary BYOK → second BYOK (if filled in) → last manual → user's last cached value with a stale label.
- **SPY YTD benchmark**: baseline is last year's final trading-day close from Massive/Tiingo/AV (BYOK), or manual, 1 number per year. The running value comes from the same BYOK.

### 2.3 IDX stocks (BBCA, BBRI, TLKM) + IHSG + IHSG benchmark

- **Server default**: **none** (see §1.3).
- **BYOK**: **EODHD Free** (20 calls/day; 1 call per ticker for EOD/live).
  - 4 symbols (3 stocks + IHSG) × 1 EOD (≈16:15 WIB) = 4 calls/day.
  - If the user wants 15-minute delayed intraday: +3 refreshes (10:00, 12:00, 14:30 WIB) × 4 = 12 → total **16/day** ✔ (4 left for tests/spare).
  - 15-minute interval ✘ (needs ±96 calls/day).
  - IHSG (`JKSE.INDX`) coverage on the free tier [UNVERIFIED]. The connection test must test this symbol.
  - Backup: Marketstack Free (100/month, EOD) [IDX on free UNVERIFIED].
- **Manual**: IDX and IHSG closing prices (for YTD, 1 year-end number + current value is enough).
- **Fallback order**: EODHD → Marketstack → manual.

### 2.4 Crypto (BTC, ETH, SOL) IDR/USD every 5 minutes

- **Server default**: **CoinMarketCap Basic with a free operator-owned key.** This is not "keyless", but it is free of charge, and it is the only option whose commercial/shared permission is explicitly written.
  - 1 call per 5 minutes: `GET /v2/cryptocurrency/quotes/latest?id=1,1027,5426&convert=IDR` (≤100 assets & 1 convert = 1 credit) → 31 days × 288 = **8,928 credits/month**.
  - USD: derive from IDR ÷ USD/IDR (Frankfurter), or a second call `convert=USD` every 15 minutes (+2,976) → total **11,904 ≤ 15,000** ✔.
  - The union of all users' symbols stays at 1 credit as long as ≤100 assets.
  - "Today's change": `percent_change_24h` from CMC, or our own 00:00 WIB snapshot.
- **Ordered server fallbacks**:
  1. CMC Keyless `/public-api/v2/simple/price` (license status [UNVERIFIED]; only when CMC Basic fails)
  2. **Indodax `/api/summaries`** (native IDR, 1 call for all pairs). Only once write.financial has Indodax's written permission. Until then, do not use it shared.
  3. Last cached value + stale label
  4. Manual
- **Optional BYOK**:
  - CoinGecko Demo: 1 call per 5 minutes `/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=idr,usd` → 8,928/month ≤ 10,000 ✔ (tight, no room for tests).
    - **License warning**: CoinGecko states that a product that is *sold* still needs a paid plan even with BYOK. Enable only if write.financial is not monetized, and show "Powered by CoinGecko".
  - User's own CMC Basic: 15,000/month ✔.
- **Manual**: crypto price input (e.g. assets not on CMC).

### 2.5 Gold (XAU, Antam, Pluang)

- **Server default**:
  - **fawazahmed0 `xau.min.json`** 1×/day → XAU/IDR and XAU/USD.
  - Per-gram conversion = price per troy oz ÷ 31,1034768.
  - Display as "harga spot (estimasi)" (spot price, estimate).
- **Antam/Pluang**: **manual**.
  - The user enters the buy/buyback price per gram (Antam updates at 08:30 WIB).
  - Optional feature: a user-saved "premium Antam vs spot (%)". The app computes a daily estimate = spot × (1 + premium), labeled "estimasi" (estimate).
- **Optional BYOK**:
  - GoldAPI.io (100/month): 1×/day = 31 ✔, or 2×/day = 62 ✔.
  - metals.dev (100/month): same.
  - 3×/day (93) is too tight → **max 2×/day**.
- **Fallback**: fawazahmed0 → (Indodax PAXG/IDR after permission) → last value → manual.

### 2.6 Mutual fund NAV (Bibit RDPU, IDX30)

- **Server default**: **none.** No legal free API.
- **BYOK**: no relevant free provider.
- **Manual (primary)**:
  - The user enters NAV/unit + NAV date.
  - For **RDPU** (money market funds): an "estimated daily accrual" option from a user-entered annual yield (e.g. 4–5%/year ÷ 365), labeled as an estimate. When the user enters the real NAV, the estimate is recalibrated.
  - For **IDX30 index mutual funds**: manual. Alternatively, proxy movement from IHSG/IDX30 via the user's EODHD BYOK [IDX30 availability UNVERIFIED], labeled as an estimate.
- **Medium term**: request data permission/license from Pasardana (PT Bina Investama Infonet). It is the only complete daily NAV aggregator found.

### 2.7 SBN (ORI026)

- **No API needed.** Value = nominal (par) + fixed coupon computed locally.
  - The user picks the series (ORI026-T3/T6), nominal, and settlement date.
  - The monthly coupon schedule and maturity date are filled from the information memorandum (static seed data per series, manually verified).
- **Optional manual**: secondary-market price (distribution partner bid) or PHEI reference, if the user wants *mark-to-market*.

### 2.8 Fallback order summary

| Asset | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| FX | Frankfurter | fawazahmed0 jsDelivr | fawazahmed0 pages.dev | open.er-api (attribution) | Manual / last cache |
| US stock/ETF | BYOK Tiingo | BYOK Finnhub | BYOK Massive (EOD) / AV (EOD) | Manual | User's last cache |
| IDX + IHSG | BYOK EODHD | BYOK Marketstack | Manual | User's last cache | – |
| Crypto | CMC Basic (operator key) | CMC Keyless | Indodax (after permission) | User BYOK CoinGecko/CMC | Manual / cache |
| XAU spot | fawazahmed0 | BYOK GoldAPI / metals.dev | Indodax PAXG (after permission) | Manual | – |
| Antam/Pluang | Manual | Estimate spot × user premium | – | – | – |
| Mutual funds | Manual | Accrual estimate (RDPU) | – | – | – |
| ORI | Local fixed-coupon calculation | Manual market price | – | – | – |

### 2.9 BYOK quota sufficiency for 1 user with ±25 symbols

Assumptions: 15 US, 4 IDX (including IHSG), 3 crypto, 1 gold, 2+ FX.

| Provider | Need at design interval | Free quota | Fits? | Interval that fits |
|---|---|---|---|---|
| Tiingo (15 US) | 26 calls/day (batch) | 50/hour, 1,000/day | ✔ | 15 minutes (even 2–5 minutes) |
| Finnhub (15 US) | 15 calls/slot, 390/day | 60/minute | ✔ | 15 minutes |
| Massive Basic (US) | – (EOD only) | 5/minute | ✔ for EOD | 1×/day |
| Alpha Vantage (15 US) | 390/day | 25/day | ✘ | 1×/day (15 calls) |
| Twelve Data (15 US) | 390/day, 15 credits/slot | 8/minute, 800/day | ✔ quota-wise (spread over 2 minutes/slot) | – (non-display license ❌) |
| FMP (15 US) | 390/day | 250/day | ✘ | 30 minutes (195/day) – license ❌ |
| EODHD (4 IDX) | 96/day at 15 minutes | 20/day | ✘ | EOD + 3 refreshes/day (16) |
| Marketstack (IDX/US EOD) | 1/day (multi-symbol) | 100/month | ✔ | 1×/trading day |
| CoinGecko Demo (3 crypto) | 8,928/month | 10,000/month, 100/minute | ✔ (tight) | 5 minutes |
| CMC Basic (3 crypto) | 8,928–11,904/month | 15,000/month | ✔ | 5 minutes |
| GoldAPI / metals.dev | 31–62/month | 100/month | ✔ | 1–2×/day |
| ExchangeRate-API key | 31/month | 1,500/month | ✔ | daily |

---

## 3. BYOK field design per provider (Settings › API kurs & pasar screen)

Common pattern for all providers:
- `API key` field (password field, show/hide button).
- "Aktif" (active) toggle.
- "Gunakan untuk: [aset]" (use for: [asset]) selector.
- Status badge: `Belum diuji` (not tested) / `Terhubung` (connected) / `Key salah` (wrong key) / `Kuota habis s.d. {reset}` (quota exhausted until {reset}) / `Limit per menit, coba lagi` (per-minute limit, try again).
- License text: "Key pribadi — data hanya untuk Anda" (personal key — data for you only).
- Storage:
  - Key encrypted on the server (envelope encryption).
  - Key never sent back to the client; show the last 4 characters.
  - Key never logged.
  - Requests are made by a server proxy with per-user isolation (some providers, e.g. CoinGecko, do not support CORS).

| Provider | Field | "Dapatkan key gratis" (get a free key) link | Displayed quota | Connection test (lightweight endpoint) | Quota exhaustion / error detection |
|---|---|---|---|---|---|
| **Tiingo** | API token | https://www.tiingo.com/account/api/token (log in first; sign up at https://www.tiingo.com/) [token URL UNVERIFIED] | "Gratis: 50 request/jam, 1.000/hari, 500 simbol/bulan · Lisensi pribadi" | `GET https://api.tiingo.com/api/test` + header `Authorization: Token <key>`, `Content-Type: application/json`. Success = 200 with `message` [success content UNVERIFIED]. Wrong token → `{"message":"Auth Token was not correct"}` [tested 17-10]. | HTTP 429 [UNVERIFIED]. Count per hour/day on the app side. |
| **Finnhub** | API key | https://finnhub.io/register | "Gratis: 60 call/menit · US saja · Lisensi pribadi" | `GET https://finnhub.io/api/v1/quote?symbol=SPY` + header `X-Finnhub-Token`. Success = 200 & `c>0`. Missing/wrong key → 401 `{"error":…}` [tested 17-10]. | **HTTP 429** (docs). Additional 30/second limit. |
| **Massive (Polygon)** | API key | https://massive.com/ (Create account) | "Gratis: 5 call/menit · EOD · 2 tahun · Individual use" | `GET https://api.massive.com/v1/marketstatus/now?apiKey=<key>` [endpoint UNVERIFIED]. Wrong key → 401 `{"status":"ERROR","error":"Unknown API Key"}` [tested 17-10]. | HTTP 429 [UNVERIFIED]. Use an app-side queue of ≤5/minute. |
| **Alpha Vantage** | API key | https://www.alphavantage.co/support/#api-key | "Gratis: 25 request/hari · Lisensi pribadi" | `GET https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY&apikey=<key>` → must contain `"Global Quote"`. **Note**: even a random key passes [tested 17-10], so this test only proves connectivity. Show "tidak dapat memverifikasi key" (cannot verify key). | HTTP **200** with an `"Information"` or `"Note"` field (limit/demo message) instead of data [tested 17-10 for `demo`; limit text UNVERIFIED]. Count 25/day on the app side. |
| **EODHD** | API token | https://eodhd.com/register | "Gratis: 20 call/hari · EOD 1 tahun · IDX ✔ · Lisensi pribadi" | `GET https://eodhd.com/api/user?api_token=<key>&fmt=json` (account info, remaining quota) [fields UNVERIFIED]. Follow with `GET /api/eod/BBCA.JK?api_token=…&fmt=json&from=<yesterday>` to confirm IDX coverage. Wrong token → 401 `Unauthenticated` [tested 17-10]. | Headers `X-RateLimit-Limit`/`X-RateLimit-Remaining` (per minute) [tested 17-10]. Daily cap exhausted → HTTP 402/429 [UNVERIFIED]. 403 = symbol/plan not allowed. |
| **Marketstack** | Access key | https://marketstack.com/signup/free | "Gratis: 100 request/bulan · EOD · non-komersial" | `GET https://api.marketstack.com/v2/eod/latest?access_key=<key>&symbols=AAPL` [endpoint version UNVERIFIED] | JSON error `error.code` e.g. `usage_limit_reached` / HTTP 429 [UNVERIFIED] |
| **CoinMarketCap** (optional for users; operator key in server env) | API key | https://coinmarketcap.com/api/pricing/ (Get Free API Key) | "Gratis: 15.000 kredit/bulan, 50 request/menit" + remaining from `/v1/key/info` | `GET https://pro-api.coinmarketcap.com/v1/key/info` + header `X-CMC_PRO_API_KEY`. Consumes no credits. Wrong key → 401 `error_code:1001` [tested 17-10]. | **HTTP 429** + `status.error_code`: 1008 (minute), 1009 (daily), 1010 (monthly), 1011 (IP). Monitor `status.credit_count`. |
| **CoinGecko Demo** | Demo API key | https://www.coingecko.com/en/developers/dashboard | "Gratis: 10.000 call/bulan, 100/menit · wajib 'Powered by CoinGecko' · non-komersial" | `GET https://api.coingecko.com/api/v3/ping` + header `x-cg-demo-api-key`. Missing key → 401 `error_code:10002` [tested 17-10]. Pro key on the Demo root → 10011/10010. | **HTTP 429** (rate limit). Monthly quota exhausted → 429 [UNVERIFIED]. 4xx/5xx errors still count toward the limit. |
| **GoldAPI.io** | Access token | https://www.goldapi.io/ (Sign up) | "Gratis (Sandbox): maks 100 request/bulan · XAU/IDR ✔" | `GET https://www.goldapi.io/api/stat` + header `x-access-token` (usage statistics). Without key → 403 `No API Key provided` [tested 17-10]. | Headers `x-ratelimit-limit/remaining/reset` [tested 17-10]. Quota exhausted → 429 (`TOO_MANY_REQUESTS` constant in the bundle) [UNVERIFIED]. |
| **metals.dev** | API key | https://metals.dev/ (Get Free API Key) | "Gratis: 100 request/bulan" + remaining from `/usage` | `GET https://api.metals.dev/usage?api_key=<key>`. Wrong key → 401 `error_code:1101` [tested 17-10]. | JSON `status:"failure"`, `error_code:1203` = this month's quota (including grace) exhausted. |
| **ExchangeRate-API** (optional) | API key | https://app.exchangerate-api.com/sign-up | "Gratis: 1.500 request/bulan" + remaining from `/quota` | `GET https://v6.exchangerate-api.com/v6/<key>/quota` (delayed 5–60 minutes). | JSON `result:"error"`, `error-type:"quota-reached"` / `"invalid-key"` / `"inactive-account"`. |
| Twelve Data, FMP | **Not shown** (free license does not allow display, see §4) | – | – | – | – |

UI behavior when a quota is exhausted:
- Mark the provider as "jeda sampai {reset}" (paused until {reset}) (per minute: 60 seconds; daily: 00:00 in the provider's time zone; monthly: anchor date).
- Automatically fall through to the next fallback.
- Show a small banner on the holding: "Harga dari {sumber cadangan / manual}, per {waktu}" (price from {backup source / manual}, as of {time}).

---

## 4. Legal/technical risks & what must NOT be used

### 4.1 PROHIBITED

| Source | Reason (primary source) |
|---|---|
| **Unofficial Yahoo Finance** (`query1/query2.finance.yahoo.com`, yfinance, `^JKSE`, `.JK`) | Yahoo ToS forbids "access or collect data … using any automated means, … scrapers, data mining tools" without permission; forbids building a "database, archive, … data feed" substituting Yahoo's services; and "you may not access or reuse the Services … for any commercial purpose". The endpoint is technically reachable ([tested 17-10] 200), but that does not mean it is allowed. |
| **Stooq** | "This data is intended solely for personal use. Any commercial use is prohibited." The CSV endpoint now uses a JS challenge. |
| **Scraping Pasardana, Bareksa, Bibit, logammulia.com, idx.co.id, bi.go.id** for shared display | Pasardana explicitly prohibits reuse/distribution without written permission. The others have no terms that permit it (or terms not found [UNVERIFIED]). IDX exchange data is licensed. |
| **CoinGecko Demo/keyless as server default** | Help center: Demo and keyless grant no commercial rights. BYOK FAQ: a product that is sold still needs a paid plan. |
| **Indodax as a shared source without written permission** | SKU: Platform access is "semata-mata untuk tujuan pribadi" (solely for personal purposes); distributing/commercializing any part of the Platform without written permission is prohibited. |
| **Twelve Data Basic & FMP Basic** (including via BYOK) | Twelve Data Basic: "internal non-display usage only" and the prohibition "Use Free Tier data for commercial purposes". FMP: display requires a "Data Display and Licensing Agreement". |
| **Using user A's BYOK results for user B** (shared cache, public export endpoint) | Violates Finnhub ("not redistribute or share access … with anyone"), Alpha Vantage, Tiingo (Internal Use), EODHD (prohibits "displaying … to others"), Massive (Individual use). |
| **Exposing a public FX endpoint/export** (API or FX CSV for third parties) | ExchangeRate-API: data may not be used in a "product or service that offers programmatic or automatic access". CMC: no redistribution as a data service. |

### 4.2 Risks & mitigations

1. **Free tiers can change/be revoked at any time.** Examples: ExchangeRate-API ("Free Plans can be discontinued … without notice"), CoinGecko API Terms (limits "may be varied … without notice"), Finnhub ("change the Terms … without notice").
   Mitigation: per-provider adapter layer + ordered fallbacks. Show data timestamps. Monitor the `time_eol_unix` field (open.er-api).
2. **Per-IP rate limits on keyless sources.** All users share the server IP. Mitigation: global cache, one worker per source, exponential backoff, honor `Retry-After`. Never fetch during page render.
3. **Binance is blocked on Indonesian networks** ([tested 17-10]: `api.binance.com`/`www.binance.com` fail TLS; `data-api.binance.vision` passes) [INFERENCE: ISP blocking]. Do not depend on Binance. Binance's legal status in Indonesia is also sensitive (licensed local exchanges: Indodax/Tokocrypto).
4. **Mandatory attribution.**
   - CoinGecko: "Powered by CoinGecko" (font ≥10) if CoinGecko BYOK is active.
   - open.er-api: link "Rates By Exchange Rate API" if this fallback was ever used.
   - Voluntary credit: Frankfurter/BI.
   Mitigation: a "Sumber data" (data sources) component in the portfolio screen footer and on the About page.
5. **Caching/deletion requirements.**
   - CoinGecko: cache must be refreshed at most every 24 hours; data deleted when access ends.
   - Finnhub: "All data must be deleted should your subscription … ends".
   Mitigation: when the user deletes a BYOK key → delete that provider's `user_quote` rows. Derived portfolio values (monthly snapshots) are stored as user data [INFERENCE: derived data belongs to the user; review with legal counsel].
6. **Price accuracy & definitions.**
   - Frankfurter default = *blended* mid-rate. For official numbers use `providers=bi` (BI transaction rate, not JISDOR).
   - fawazahmed0 does not document its upstream source.
   - Tiingo IEX = IEX prices only, not consolidated.
   - Free Alpha Vantage = last close.
   - A "delayed/EOD" label is mandatory. Do not call it "real-time".
   - The Alpha Vantage FAQ also notes that US real-time/15-minute data is regulated by exchanges/FINRA/SEC.
7. **Key validation is unreliable.** Alpha Vantage accepts random keys [tested 17-10]. The "Terhubung" (connected) status for AV must read "Terhubung (key tidak dapat diverifikasi)" (connected, key cannot be verified).
8. **BYOK key security.** Encryption at rest, masking, never logged/included in error tracking, rate-limit the "Tes koneksi" (test connection) button (tests consume the user's quota, e.g. GoldAPI/metals.dev 100/month), and support rotation/deletion.
9. **CoinGecko Demo quota is tight** (8,928 of 10,000 at a 5-minute interval). If the user uses the same CoinGecko key elsewhere, the quota can run out. Offer a 10-minute interval (4,464/month) as the CoinGecko BYOK default.
10. **Market hours & holidays.** Poll US 20:30–03:00 WIB (DST) / 21:30–04:00 WIB (non-DST). Poll IDX 09:00–16:15 WIB, Monday–Friday. Skip exchange holidays so quota is not wasted (Finnhub has a *Market Holiday* endpoint [UNVERIFIED free]).
11. **JISDOR vs BI transaction rate vs blended.** Show the rate type name in the UI so users are not confused when they differ by a few rupiah.

---

## 5. Appendix: list of primary source URLs read

- Frankfurter: https://frankfurter.dev/ · https://frankfurter.dev/license/ · https://frankfurter.dev/providers/bi/ · API `https://api.frankfurter.dev/v2/providers/bi`
- fawazahmed0: https://github.com/fawazahmed0/exchange-api · jsDelivr AUP: https://www.jsdelivr.com/terms/acceptable-use-policy-jsdelivr-net
- ExchangeRate-API: https://www.exchangerate-api.com/docs/free · https://www.exchangerate-api.com/terms · https://www.exchangerate-api.com/docs/standard-requests · https://www.exchangerate-api.com/docs/request-quota-endpoint
- Bank Indonesia JISDOR: https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx
- Twelve Data: https://twelvedata.com/pricing · https://twelvedata.com/terms
- Alpha Vantage: https://www.alphavantage.co/support/ · https://www.alphavantage.co/terms_of_service/ · https://www.alphavantage.co/documentation/
- Finnhub: https://finnhub.io/pricing · https://finnhub.io/docs/api/rate-limit · https://finnhub.io/docs/api/quote · https://finnhub.io/terms-of-service
- FMP: https://site.financialmodelingprep.com/pricing-plans
- Marketstack: https://marketstack.com/pricing
- Tiingo: https://www.tiingo.com/about/pricing · https://www.tiingo.com/documentation/iex
- Massive (Polygon): https://massive.com/pricing · https://massive.com/legal/terms · https://massive.com/docs/rest/stocks/aggregates/daily-market-summary.md
- EODHD: https://eodhd.com/pricing · https://eodhd.com/financial-apis/terms-conditions · https://eodhd.com/exchange/JK
- Yahoo ToS: https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html
- Stooq: https://stooq.com/db/h/
- CoinGecko: https://www.coingecko.com/en/api/pricing · https://docs.coingecko.com/docs/errors-and-rate-limits · https://www.coingecko.com/en/api_terms · https://support.coingecko.com/articles/1043089972-what-are-the-differences-between-commercial-and-custom-licenses
- CoinMarketCap: https://coinmarketcap.com/api/pricing/ · https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api.md · https://coinmarketcap.com/llms-full.txt
- Indodax: https://raw.githubusercontent.com/btcid/indodax-official-api-docs/master/Public-RestAPI.md · https://help.indodax.com/hc/id/articles/4416650994585-SYARAT-DAN-KETENTUAN-UMUM
- Binance: https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/rest-api.md · https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/faqs/market_data_only.md
- Tokocrypto: https://www.tokocrypto.com/apidocs/
- GoldAPI.io: https://www.goldapi.io/pricing · https://www.goldapi.io/llms.txt
- metals.dev: https://metals.dev/pricing · https://metals.dev/docs
- Logam Mulia: https://www.logammulia.com/id/harga-emas-hari-ini
- Pasardana: https://pasardana.id/fund/search · https://pasardana.id/term-of-use
- OJK: https://reksadana.ojk.go.id/Public/StatistikNABReksadanaPublic.aspx · https://reksadana.ojk.go.id/Public/ProdukReksadanaPublic.aspx
- DJPPR ORI: https://djppr.kemenkeu.go.id/obligasinegararitel · BCA ORI026-T6: https://www.bca.co.id/id/Individu/produk/Investasi-dan-Asuransi/obligasi/pasar-perdana/Obligasi-ORI026-T6
- PHEI: https://www.phei.co.id/en-us/Data/Fair-Prices-and-Yield
