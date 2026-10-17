# Riset Sumber Data Pasar Gratis untuk write.financial

Diverifikasi pada 17 Okt 2026 dari halaman resmi (pricing/docs/terms). Selain membaca halaman, sejumlah endpoint diuji langsung dengan `curl` dan headless browser dari workstation riset. Hasil uji ditandai **[uji 17-10]**. Angka atau klausul yang tidak bisa dikonfirmasi dari sumber primer ditandai **[UNVERIFIED]**. Kesimpulan yang merupakan tafsiran penulis ditandai **[INFERENCE]**.

Arti istilah dalam dokumen ini:
- **Server-shared**: server write.financial mengambil data satu kali, menyimpannya di cache global, lalu menampilkannya ke banyak user.
- **BYOK**: user memasukkan key pribadinya. Request memakai key itu, dan hasilnya hanya untuk user tersebut.
- **Manual**: user mengetik sendiri harga atau NAB.

---

## 0. Temuan kunci (TL;DR)

1. **Kurs FX**: ada sumber yang benar-benar gratis, tanpa key, dan boleh dipakai komersial, yaitu **Frankfurter**. Frankfurter juga menyediakan provider **Bank Indonesia (kurs transaksi BI)**. Cadangannya **fawazahmed0/exchange-api** (CC0) dan **open.er-api.com** (wajib atribusi).
2. **Saham/ETF AS, saham IDX, IHSG**: tidak ada sumber gratis tanpa key yang legal ditampilkan ke publik. Semua free tier (Finnhub, Alpha Vantage, Tiingo, Massive/Polygon, EODHD, Marketstack, Twelve Data, FMP) berlisensi *personal/internal/non-commercial*, atau lisensi display-nya harus dibeli. Karena itu: **BYOK + manual**, tanpa default server.
3. **Kripto**: tidak ada sumber keyless yang izin shared/komersialnya tegas.
   - **CoinMarketCap Basic** (key gratis milik operator) secara eksplisit memberi *commercial use* untuk satu produk dengan ≤100k user dan mengizinkan caching. Ini kandidat default server, meski butuh key gratis milik operator.
   - CoinGecko Demo/keyless **tidak** termasuk hak komersial.
   - Syarat & Ketentuan Umum (SKU) Indodax membatasi pemakaian platform dan datanya untuk keperluan pribadi.
4. **Emas**:
   - XAU spot harian bisa diambil dari **fawazahmed0** (CC0, tanpa key, ada IDR).
   - Harga Antam (logammulia.com) **tidak punya API**. Ambil lewat input manual, atau tampilkan estimasi dari spot.
   - GoldAPI.io dan metals.dev bisa jadi BYOK (masing-masing 100 request/bulan).
5. **NAB reksa dana & harga SBN**: tidak ada API gratis yang legal.
   - Syarat Pasardana melarang pemakaian ulang data tanpa izin tertulis.
   - Untuk reksa dana: **manual**.
   - Untuk ORI: hitung nilai sendiri dari nominal + kupon tetap.
6. **Dilarang**: Yahoo Finance unofficial (`query1.finance.yahoo.com`, yfinance) dan Stooq. Juga dilarang scraping Pasardana, Bareksa, Bibit, logammulia, IDX, dan BI untuk layanan shared.

---

## 1. Tabel kandidat per kebutuhan

Legenda kolom "Izin publik/komersial":
- ✅ boleh tampil di app publik/komersial
- ⚠️ abu-abu, atau butuh syarat
- ❌ personal/non-commercial saja, atau dilarang

### 1.1 Kurs USD/IDR, SGD, dan mata uang lain (harian + historis)

| API | Key? | Free quota (sumber resmi) | Cakupan | Izin publik/komersial | Catatan | URL sumber |
|---|---|---|---|---|---|---|
| **Frankfurter** (`api.frankfurter.dev/v2`) | Tidak | "There are no quotas. Requests are rate-limited to prevent abuse, but there are no monthly or daily caps." Angka rate limit tidak dipublikasikan. | 223 mata uang dari 104 bank sentral. IDR ✔ (provider `bi`: 27 mata uang, data sejak 2024-01-02; ECB juga punya IDR). Historis sejak 1948, time series `from/to`, `group=month`. Tanpa XAU. | ✅ "Is the API free for commercial use? Yes. Blended rates are Frankfurter's own calculation". Caching "encouraged". Endpoint per provider tunduk pada terms provider. Untuk BI: "None published". | [uji 17-10] `GET /v2/rate/usd/idr` → `{"rate":17989}`. Kurs BI berjenis *transaction* (kurs transaksi BI, bukan JISDOR). Update harian. | https://frankfurter.dev/ , https://frankfurter.dev/license/ , https://frankfurter.dev/providers/bi/ |
| **fawazahmed0/exchange-api** (jsDelivr + fallback Cloudflare Pages) | Tidak | README: "No Rate limits", "Daily Updated". jsDelivr: "free for both personal and commercial use, there are no limits on bandwidth or number of requests". Namun scraping massal file unik dianggap abuse. | 200+ mata uang, termasuk kripto & logam (XAU). Historis via tag tanggal `@YYYY-MM-DD`. | ✅ Lisensi repo **CC0-1.0**. Asal data hulu tidak didokumentasikan → kualitasnya perlu dicek silang. | [uji 17-10] `xau.min.json` tanggal 2026-10-16: XAU→IDR 75.442.309, XAU→USD 4.182,94. README mewajibkan mekanisme fallback ke `currency-api.pages.dev`. | https://github.com/fawazahmed0/exchange-api , https://www.jsdelivr.com/terms/acceptable-use-policy-jsdelivr-net |
| **open.er-api.com** (ExchangeRate-API Open Access) | Tidak | "Rate Limited". IP yang kena limit mendapat 429 dan dibuka lagi setelah 20 menit. Disarankan request 1×/24 jam (atau maks 1×/jam). | ±160 mata uang, IDR ✔. **Tanpa historis.** Update 1×/hari. | ⚠️ Boleh di-cache dan dipakai untuk "personal or commercial currency conversion purposes", **wajib atribusi** (link "Rates By Exchange Rate API"). **Tidak boleh redistribusi**, dan data tidak boleh dipakai di "product or service that offers programmatic or automatic access to exchange rate data". | Ada field `time_eol_unix` untuk sinyal deprecation. Paket Free *dengan key*: 1,5k request/bulan, tanpa atribusi. | https://www.exchangerate-api.com/docs/free , https://www.exchangerate-api.com/terms |
| **Bank Indonesia – JISDOR / Kurs Transaksi BI** (situs bi.go.id) | – | Tidak ada API publik resmi yang ditemukan. Halaman HTML menampilkan tabel (JISDOR 16 Okt 2026 tampil). | USD/IDR (JISDOR); 27 mata uang (kurs transaksi). | ⚠️ Halaman S&K BI tidak ditemukan [UNVERIFIED]. Dari server riset, `curl` ke bi.go.id timeout; via browser bisa. | Kurs transaksi BI sudah tersedia lewat Frankfurter (`providers=bi`), jadi scraping tidak perlu. JISDOR sendiri tidak tersedia di Frankfurter [UNVERIFIED]. | https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx |
| ExchangeRate-API Free (key) | Ya | 1.500 request/bulan, update harian | IDR ✔; historis hanya paket berbayar [UNVERIFIED] | ✅ ToS: "both Free Plan and paid … are suitable for either commercial or personal use". Tetap tidak boleh redistribusi. | Opsional, tidak diperlukan. | https://www.exchangerate-api.com/docs/free |
| Alpha Vantage FX, Twelve Data FX, Finnhub FX | Ya | lihat §1.2 | | ❌ personal / non-display | Tidak perlu karena ada Frankfurter. | |

### 1.2 Harga saham/ETF AS (SPY, QQQ, SCHD, VEA, VWO, SGOV, NVDA, MSFT, AAPL, GOOGL, AMZN, MSTY, NVDY, TSLY, CONY), interval 15 menit, plus benchmark SPY

| API | Key? | Free quota (sumber resmi) | Cakupan | Izin publik/komersial | Catatan | URL sumber |
|---|---|---|---|---|---|---|
| **Finnhub** | Ya | "Limit 60 API calls/minute". Ditambah batas global "30 API calls/second". Lewat batas → HTTP **429**. | `/quote` real-time US stocks (termasuk ETF [UNVERIFIED untuk ETF YieldMax]). Field `pc` = previous close. **Stock Candles = Premium** (historis tidak tersedia gratis). Market internasional/IDX = Enterprise. | ❌ "All plan … strictly for personal use"; "not redistribute or share access to data or derived results … with anyone". Hanya cocok sebagai BYOK. | [uji 17-10] tanpa key → 401 `{"error":"Please use an API key."}`. Data harus dihapus saat langganan berakhir. | https://finnhub.io/pricing , https://finnhub.io/docs/api/rate-limit , https://finnhub.io/docs/api/quote , https://finnhub.io/terms-of-service |
| **Tiingo** (Starter, gratis) | Ya | 50 request/jam, 1.000 request/hari, 500 simbol unik/bulan, bandwidth 1 GB/bulan | US & China stocks 49.571, ETF & reksa dana 60.756. EOD historis 30+ tahun. IEX feed (intraday/last). Endpoint `/iex?tickers=a,b,c` mengambil banyak ticker dalam 1 request. Kripto ✔. Tanpa IDX. | ❌ License "Internal Use Only" (individu). Redistribusi butuh produk khusus berbayar. | [uji 17-10] `/api/test` tanpa token → `"'AUTHORIZATION header' was not set"`; token salah → `"Auth Token was not correct"`. | https://www.tiingo.com/about/pricing , https://www.tiingo.com/documentation/iex |
| **Massive (eks-Polygon)** Stocks Basic | Ya | "5 API Calls / Minute", historis 2 tahun, **End of Day** | Semua ticker US. Endpoint `GET /v2/aggs/grouped/locale/us/market/stocks/{date}` mengembalikan OHLC **semua saham US dalam 1 request** (Basic: "Included", recency "End-of-day"). Tanpa intraday/snapshot di Basic. | ❌ "Individual use". Terms for Individuals: "personal, individual, and non-business use". | [uji 17-10] key salah → 401 `{"status":"ERROR","error":"Unknown API Key"}` (host `api.massive.com`). | https://massive.com/pricing , https://massive.com/docs/rest/stocks/aggregates/daily-market-summary.md , https://massive.com/legal/terms |
| **Alpha Vantage** | Ya | "25 API requests per day" | Ekuitas global (contoh .LON, .TRT, .DEX, .BSE, .SHH; **IDX tidak tercantum** [UNVERIFIED]), FX, kripto. Data real-time & 15-menit tertunda US = premium. `GLOBAL_QUOTE` gratis = harga & previous close hari bursa terakhir. | ❌ ToS: personal, non-commercial. Kategori "commercial" mencakup aktivitas yang "allows individuals or entities other than User to access information". | [uji 17-10] key **tidak divalidasi**: `apikey=invalidkey123` tetap mengembalikan data SPY. Key `demo` → field `"Information"`. Jadi uji koneksi tidak bisa membuktikan key valid. | https://www.alphavantage.co/support/ , https://www.alphavantage.co/terms_of_service/ (PDF) |
| **Twelve Data** Basic | Ya | 8 kredit/menit, batas 800/hari | Basic: market US saja ("Real-time US equities, forex, crypto"). | ❌ Basic = "internal non-display usage only". Terms 2.3(l): "Use Free Tier data for commercial purposes" dilarang. **Menampilkan harga ke manusia termasuk *display*.** | [uji 17-10] `apikey=demo` mengembalikan AAPL. Tidak direkomendasikan, bahkan untuk BYOK. | https://twelvedata.com/pricing , https://twelvedata.com/terms |
| **Financial Modeling Prep** Basic | Ya | 250 call/hari, bandwidth 500 MB/30 hari | Kuota terbatas pada simbol sampel: "Symbol Limited to AAPL, TSLA, AMZN and 84 more". US only. EOD 5 tahun. | ❌ "Displaying or redistributing data sourced from FMP requires a specific Data Display and Licensing Agreement". | [uji 17-10] `apikey=demo` → 401 "Invalid API KEY". Tidak direkomendasikan. | https://site.financialmodelingprep.com/pricing-plans |
| **Marketstack** Free | Ya | 100 request/bulan, EOD, histori 1 tahun | 70 bursa (data US bersumber dari Tiingo). Index = paket Basic ke atas. Parameter `symbols` bisa banyak simbol [UNVERIFIED untuk free]. | ❌ "Non-Commercial Use" | Hanya cocok untuk EOD 1×/hari. | https://marketstack.com/pricing |
| **EODHD** Free | Ya | 20 call/hari, 20 request/menit, histori EOD 1 tahun, live/delayed 15 menit (global) | Global termasuk **Jakarta (JK)** dan US. 1 call per EOD/live; 5 call untuk intraday/news. | ❌ Non-Professional: dilarang "retransmitting, redistributing, displaying, or granting access" ke pihak lain. | Lihat §1.3. | https://eodhd.com/pricing , https://eodhd.com/financial-apis/terms-conditions |
| **Yahoo Finance (unofficial)** | Tidak | – | Teknis lengkap: US, `.JK`, `^JKSE`. [uji 17-10] `query1…/chart/BBCA.JK` → 200. | ❌ **DILARANG.** ToS Yahoo melarang "access or collect data … using any automated means … scrapers" tanpa izin, juga pemakaian komersial dan pembuatan "data feed". | Lihat §4. | https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html |
| **Stooq** | Tidak | – | CSV historis | ❌ "This data is intended solely for personal use. Any commercial use is prohibited." [uji 17-10] endpoint CSV kini memakai tantangan JS proof-of-work. | Lihat §4. | https://stooq.com/db/h/ |

### 1.3 Saham IDX (BBCA, BBRI, TLKM) + indeks IHSG + benchmark IHSG

| API | Key? | Free quota | Cakupan | Izin | Catatan | URL |
|---|---|---|---|---|---|---|
| **EODHD** Free | Ya | 20 call/hari, 20/menit, EOD 1 tahun, live 15 menit tertunda | Exchange **JK** tercantum (BBCA.JK punya halaman ringkasan). IHSG kemungkinan `JKSE.INDX` [UNVERIFIED untuk free tier]. | ❌ personal (Non-Professional), boleh untuk BYOK | [uji 17-10] token `demo` → 403 untuk `.JK`/`.INDX` (demo hanya untuk simbol tertentu). Header `x-ratelimit-limit: 1200`. | https://eodhd.com/pricing , https://eodhd.com/exchange/JK |
| **Marketstack** Free | Ya | 100 request/bulan, EOD | Bursa XIDX [UNVERIFIED untuk free]. Index tidak tersedia di Free. | ❌ Non-Commercial | Cadangan BYOK EOD saja. | https://marketstack.com/pricing |
| Twelve Data | Ya | Basic: US saja; IDX mulai Grow ($29) | | ❌ | – | https://twelvedata.com/pricing |
| Finnhub | Ya | Quote internasional = Enterprise | | ❌ | Tidak bisa untuk IDX. | https://finnhub.io/docs/api/quote |
| idx.co.id (situs BEI) | – | Tidak ada API publik; halaman S&K tidak ditemukan [UNVERIFIED] | | ❌ Data bursa berlisensi (vendor). Scraping = risiko. | Jangan dipakai. | – |
| Yahoo `.JK` / `^JKSE` | – | | | ❌ DILARANG | | lihat §1.2 |

### 1.4 Kripto (BTC, ETH, SOL) dalam IDR/USD, interval 5 menit

| API | Key? | Free quota | Cakupan | Izin | Catatan | URL |
|---|---|---|---|---|---|---|
| **CoinMarketCap Basic** | Ya (gratis) | **15.000 kredit/bulan**, **50 request/menit**, update tiap 60 detik, konversi: "Limit 1 per call", 1 API key | Harga, market cap, `percent_change_24h`. Konversi ke IDR ✔. Endpoint historis tidak tersedia di Basic [UNVERIFIED]. | ✅ "Basic through Professional all include commercial use rights — the free Basic tier included … covers one product with up to 100k users". Tidak boleh redistribusi/resale sebagai layanan data. Caching lokal diizinkan ("intentionally worded to allow legitimate local caching"). | 1 kredit per 100 aset per call. Setiap `convert` tambahan menambah kredit. Respons memuat `status.credit_count`. Error 429: 1008 (menit), 1009 (harian), 1010 (bulanan), 1011 (IP). | https://coinmarketcap.com/api/pricing/ , https://coinmarketcap.com/llms-full.txt |
| **CoinMarketCap Keyless** (`/public-api`) | Tidak | "IP-based rate pool", angka tidak dipublikasikan | 18 endpoint standar, termasuk `/v2/simple/price` dan `/v3/cryptocurrency/quotes/latest` | ⚠️ Tidak ditemukan klausul lisensi khusus keyless [UNVERIFIED]. Pricing FAQ menyebut keyless untuk eksplorasi; untuk produksi disarankan key gratis. | [uji 17-10] `simple/price?symbol=BTC,ETH,SOL&convert=IDR` → 200, `credit_count:1`, BTC ≈ Rp1,47 M. | https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api.md |
| **CoinGecko Demo** | Ya (gratis) | **10.000 call/bulan**, **100 call/menit** (docs: "Demo plan: 100 calls/min"). Historis harian/jam 1 tahun. | `/simple/price` multi-id & multi `vs_currencies` (idr,usd) dalam 1 call | ❌ untuk shared/komersial. Help center: "Does the Demo (free) API plan include commercial rights? No". FAQ BYOK: "If you sell a product … you need a paid API plan … even if users supply their own API keys." Wajib atribusi "Powered by CoinGecko". Cache wajib di-refresh ≤24 jam. | BYOK hanya ⚠️ dan hanya jika write.financial tidak dijual/dimonetisasi [INFERENCE]. Error: 401 (10002/10010/10011), 429. CORS tidak didukung, harus lewat proxy backend. | https://www.coingecko.com/en/api/pricing , https://docs.coingecko.com/docs/errors-and-rate-limits , https://support.coingecko.com/articles/1043089972-what-are-the-differences-between-commercial-and-custom-licenses , https://www.coingecko.com/en/api_terms |
| CoinGecko Keyless | Tidak | IP-based | sama | ❌ FAQ: produk komersial tetap butuh plan berbayar | – | sama |
| **Indodax Public API** | Tidak | "Public API rate limited to 180request/minute" | Pasangan IDR native (btcidr, ethidr, solidr, usdtidr, **paxgidr, xautidr**). `/api/ticker_all` dan `/api/summaries` mengambil semua pair dalam 1 call, termasuk `prices_24h`. OHLC `/tradingview/history_v2`. | ⚠️ Docs: "open data for public". Namun SKU Indodax: hak akses Platform "semata-mata untuk tujuan pribadi"; "dilarang memperbanyak, … mendistribusikan, … mengkomersialkan … tanpa izin tertulis". Halaman HKI menyebut "data" sebagai milik Indodax. | [uji 17-10] `/api/ticker/btcidr` → last Rp1.459.802.000. Layak dipakai shared **setelah mendapat izin tertulis** (perusahaan Indonesia, permintaan realistis). | https://raw.githubusercontent.com/btcid/indodax-official-api-docs/master/Public-RestAPI.md , https://help.indodax.com/hc/id/articles/4416650994585-SYARAT-DAN-KETENTUAN-UMUM |
| **Binance public market data** (`data-api.binance.vision`) | Tidak | Batas berbasis weight per IP. Melanggar → 429, lalu ban 418 (2 menit s/d 3 hari). Header `X-MBX-USED-WEIGHT-*`, `Retry-After`. | Tanpa pair IDR (pakai USDT, lalu kali kurs). Klines historis ✔. | ⚠️ ToS Binance melarang "use the Services for resale or commercial purposes" (dari kutipan hasil search; halaman ToS tidak bisa dibuka) [UNVERIFIED penuh]. | [uji 17-10] `api.binance.com` & `www.binance.com` → error sertifikat TLS (intersepsi, kemungkinan blokir ISP Indonesia [INFERENCE]). `data-api.binance.vision` → 200. | https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/rest-api.md , …/faqs/market_data_only.md |
| **Tokocrypto public API** | Tidak | Batas mirip Binance (weight per IP, 429/418) | Pair IDR [UNVERIFIED] | ⚠️ ToS data tidak ditemukan [UNVERIFIED] | [uji 17-10] `/open/v1/common/time` → 200. Tidak diperlukan. | https://www.tokocrypto.com/apidocs/ |

### 1.5 Emas (XAU spot, harga Antam/Pluang dalam IDR)

| API | Key? | Free quota | Cakupan | Izin | Catatan | URL |
|---|---|---|---|---|---|---|
| **fawazahmed0** (`currencies/xau.json`) | Tidak | Tanpa limit (lihat §1.1) | XAU→IDR/USD harian + historis per tanggal | ✅ CC0 | Sumber hulu tidak didokumentasikan. Cek silang dengan sumber lain. | lihat §1.1 |
| **GoldAPI.io** Sandbox | Ya | "Up to 100/month" (bundle JS halaman pricing) | XAU/XAG/XPT/XPD dalam ~70 mata uang, termasuk **IDR**. `/api/price/XAU/IDR`, historis per tanggal, `/api/history` maks 90 hari. | ⚠️ Terms tidak bisa dimuat (SPA) [UNVERIFIED] | [uji 17-10] `/api/stat` tanpa key → 403 `{"error":"No API Key provided"}`. Header `x-ratelimit-limit: 10`, `x-ratelimit-remaining`, `x-ratelimit-reset`. | https://www.goldapi.io/pricing , https://www.goldapi.io/llms.txt |
| **metals.dev** Free | Ya | "100 requests per month", update 60 detik | Spot + LBMA/LME/MCX + kurs (IDR ✔) | ⚠️ Terms tidak bisa dimuat [UNVERIFIED] | Error: 1101 key invalid; **1203 kuota bulan ini (termasuk grace) habis**. `GET /usage` menampilkan sisa kuota. | https://metals.dev/pricing , https://metals.dev/docs |
| **Indodax PAXG/IDR, XAUT/IDR** | Tidak | 180 request/menit | Token emas (1 token ≈ 1 troy oz) dalam IDR | ⚠️ sama seperti Indodax di §1.4 | [uji 17-10] paxgidr Rp74.986.529, xautidr Rp74.470.000. Proxy, bukan harga spot resmi. | lihat §1.4 |
| **Logam Mulia (logammulia.com) – harga Antam** | – | Tidak ada API. Halaman: "Harga di-update setiap hari pkl. 08.30 WIB" | Harga 0,5 g s.d. 1 kg (harga dasar dan +PPh 0,25%). [uji 17-10] 1 gr = Rp2.572.000 / Rp2.578.430. | ⚠️/❌ Halaman S&K tidak ditemukan [UNVERIFIED]. Scraping untuk tampilan shared berisiko. | **Manual.** | https://www.logammulia.com/id/harga-emas-hari-ini |
| Pluang | – | Tidak ada API publik yang ditemukan [UNVERIFIED] | | ❌ | **Manual.** | – |

### 1.6 NAB reksa dana Indonesia (Bibit RDPU, IDX30)

| Sumber | Key? | Akses | Cakupan | Izin | Catatan | URL |
|---|---|---|---|---|---|---|
| **Pasardana** | – | Tidak ada API resmi. Ada tabel web + tombol DOWNLOAD (1.540 reksa dana, tanggal acuan 16-Okt-2026). | NAB harian per produk, 1D/MtD/YtD | ❌ S&K: "Dilarang menggandakan, mencetak ulang, mendistribusikan, menyadur, menggunakan ulang, dan menyiarkan segala informasi … tanpa izin tertulis" | Bisa minta lisensi/izin dari PT Bina Investama Infonet. | https://pasardana.id/fund/search , https://pasardana.id/term-of-use |
| **OJK – reksadana.ojk.go.id** | – | Web, tanpa API | Statistik NAB **agregat bulanan** (dipublikasi mulai tanggal 8 bulan berikutnya). Daftar produk (2.506 item) tanpa NAB per unit di halaman daftar. | ⚠️ Situs pemerintah. Tetap tidak ada NAB harian per produk [UNVERIFIED untuk halaman detail]. | Tidak memenuhi kebutuhan harian. | https://reksadana.ojk.go.id/Public/StatistikNABReksadanaPublic.aspx |
| Bareksa, Bibit, KSEI | – | Tidak ada API publik. Halaman S&K Bareksa/Bibit tidak bisa diakses [UNVERIFIED]. | | ❌ | **Manual** (user menyalin NAB dari app Bibit / fund fact sheet). | – |
| Twelve Data "mutual funds NAV" | Ya | Mulai Pro ($99) | | ❌ | Bukan opsi gratis. | https://twelvedata.com/pricing |

### 1.7 SBN ritel (ORI026)

| Sumber | Akses | Catatan | URL |
|---|---|---|---|
| DJPPR/Kemenkeu (memorandum informasi) | PDF/web, tanpa API | ORI berkupon **tetap**, dibayar bulanan. ORI026 punya dua seri (T3 dan T6). Contoh: BCA mencantumkan "ORI026-T6 kupon 6,40% per tahun". Kupon T3 dan tanggal jatuh tempo [UNVERIFIED], ambil dari memorandum. | https://djppr.kemenkeu.go.id/obligasinegararitel , https://www.bca.co.id/id/Individu/produk/Investasi-dan-Asuransi/obligasi/pasar-perdana/Obligasi-ORI026-T6 |
| PHEI (harga pasar wajar SBN harian) | Web, tanpa API publik | Ketentuan pemakaian data tidak ditemukan [UNVERIFIED]. Hanya sebagai referensi manual. | https://www.phei.co.id/en-us/Data/Fair-Prices-and-Yield |
| Mitra distribusi (bid price pasar sekunder) | Di aplikasi masing-masing | Manual | – |

### 1.8 Historis / penutupan kemarin / snapshot bulanan (lintas aset)

| Kebutuhan | Sumber legal yang tersedia |
|---|---|
| FX penutupan kemarin & historis | Frankfurter `?date=` / `?from=&to=` (gratis, ✅), fawazahmed0 `@YYYY-MM-DD` |
| Kripto "perubahan hari ini" | CMC `percent_change_24h` di quotes, atau snapshot milik sendiri pukul 00:00 WIB (diturunkan dari polling) |
| US previous close | BYOK: Finnhub `pc`, Alpha Vantage `08. previous close`, Tiingo `prevClose` (IEX) [UNVERIFIED field name], Massive grouped daily |
| US/IHSG akhir tahun (baseline YTD) | BYOK: Massive grouped daily tanggal terakhir tahun lalu (1 call untuk semua US), Tiingo EOD, EODHD EOD (1 tahun → mencakup 31 Des tahun lalu sampai sekitar akhir tahun berikutnya). Atau **manual 1 angka per tahun**. |
| Snapshot bulanan | Dibuat sendiri oleh write.financial dari cache harian (data turunan nilai portofolio user) |

---

## 2. Rekomendasi final per kebutuhan

### 2.0 Prinsip arsitektur (berlaku untuk semua aset)

1. **Tabel cache global** `market_quote(provider, symbol, quote_ccy, bucket_ts, price, prev_close, fetched_at, source_attr)`. `bucket_ts` = waktu dibulatkan ke interval (5 menit kripto, 1 hari FX).
   - Scheduler hanya mengambil **union simbol** dari semua user untuk sumber server-shared.
   - Beban per sumber tetap O(jumlah simbol unik), tidak O(jumlah user).
   - Request user tidak pernah memicu fetch langsung. Request user hanya membaca cache. Kalau cache basi (stale), request user memasang flag "perlu refresh" yang di-*debounce*, lalu worker yang mengambil data.
2. **Cache BYOK terpisah per user**: `user_quote(user_id, provider, symbol, bucket_ts, …)`.
   - Hasil dari key user A **tidak boleh** dipakai untuk user B, karena itu redistribusi dan melanggar Finnhub/AV/Tiingo/EODHD/Massive.
   - Polling BYOK hanya selama jam bursa terkait dan hanya untuk user yang aktif dalam N hari terakhir.
   - Dedupe per user lintas perangkat.
3. **Prioritas resolusi harga per holding**: manual override (jika user set "kunci manual") → BYOK user → default server → nilai terakhir yang diketahui (tampilkan label "per {tanggal}").
4. Selalu simpan dan tampilkan **sumber + waktu data** ("Kurs: Frankfurter/BI, 16 Okt 2026"; "AAPL: Tiingo IEX, tertunda").
5. Semua keyless source membatasi per IP, dan seluruh user berbagi satu IP server. Karena itu global cache wajib, dengan backoff eksponensial saat 429.

### 2.1 Kurs USD/IDR, SGD, dll. (harian)

- **Default server**: **Frankfurter**.
  - 1 call/hari untuk semua mata uang: `GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=IDR,SGD,EUR,JPY,…`.
  - Untuk angka "resmi" Indonesia: `GET /v2/providers/bi/rates?base=…`.
  - Cron dijalankan setelah publikasi harian, misalnya 17:00 WIB dan 08:00 WIB sebagai retry. Simpan 1 baris per (tanggal, mata uang).
  - Backfill historis: satu call time series `from=YYYY-01-01` (bisa NDJSON).
  - Beban: ~1–2 call/hari total.
- **Fallback server berurutan**:
  1. fawazahmed0 via jsDelivr (`cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json`)
  2. `latest.currency-api.pages.dev`
  3. open.er-api.com, maksimal 1×/hari. Jika dipakai, tampilkan atribusi "Rates By Exchange Rate API".
- **BYOK**: tidak diperlukan. Opsional ExchangeRate-API Free key (1.500 request/bulan; 1×/hari = 31/bulan ✔).
- **Manual**: user boleh menimpa kurs per tanggal, misalnya kurs riil saat tukar di bank.

### 2.2 Saham/ETF AS (15 simbol, interval 15 menit) + benchmark SPY

- **Default server**: **tidak ada**. Tidak ada sumber gratis yang izinnya legal untuk tampilan shared. Tanpa BYOK, tampilkan harga manual / harga terakhir yang diinput.
- **BYOK (urutan rekomendasi)**:
  1. **Tiingo**
     - IEX batch `GET /iex/?tickers=spy,qqq,…` → 1 call per slot untuk 15 ticker.
     - Interval 15 menit selama jam bursa US (09:30–16:00 ET = 26 slot) = **26 call/hari**. Itu 4 call/jam (< 50/jam), < 1.000/hari, 15 simbol unik (< 500/bulan). ✔
     - Interval 2–5 menit pun masih muat (maks 25 call/jam).
     - EOD/YTD: 1 call per ticker sekali saja untuk baseline akhir tahun.
  2. **Finnhub**
     - `/quote` 1 call per simbol → 15 call/slot, 390 call/hari. Batas 60/menit ✔. Tidak ada cap harian yang dipublikasikan.
     - Menyediakan `pc` untuk "perubahan hari ini".
     - Historis (candles) premium → baseline YTD harus dari sumber lain atau manual.
  3. **Massive Basic**
     - 1 call/hari `grouped/…/stocks/{date}` mencakup semua ticker (EOD).
     - Baseline YTD: 1 call untuk tanggal bursa terakhir tahun lalu. ✔ untuk harian.
     - ✘ untuk 15 menit (Basic hanya EOD) → **sarankan interval harian**.
  4. **Alpha Vantage**
     - 25/hari → maksimal 1×/hari setelah bursa tutup untuk 15 simbol (15 call) + 10 cadangan.
     - ✘ untuk 15 menit (butuh 390 call/hari). **Sarankan harian.**
  - Tidak direkomendasikan: Twelve Data (non-display), FMP (display butuh lisensi + simbol sampel), Marketstack (100/bulan, EOD).
- **Manual**: input harga per simbol, atau "kunci harga manual".
- **Urutan fallback per user**: BYOK utama → BYOK kedua (jika diisi) → manual terakhir → nilai cache terakhir milik user dengan label basi.
- **Benchmark SPY YTD**: baseline penutupan hari bursa terakhir tahun lalu dari Massive/Tiingo/AV (BYOK), atau manual 1 angka per tahun. Nilai berjalan diambil dari BYOK yang sama.

### 2.3 Saham IDX (BBCA, BBRI, TLKM) + IHSG + benchmark IHSG

- **Default server**: **tidak ada** (lihat §1.3).
- **BYOK**: **EODHD Free** (20 call/hari; 1 call per ticker untuk EOD/live).
  - 4 simbol (3 saham + IHSG) × 1 EOD (≈16:15 WIB) = 4 call/hari.
  - Jika user ingin intraday tertunda 15 menit: +3 refresh (10:00, 12:00, 14:30 WIB) × 4 = 12 → total **16/hari** ✔ (sisa 4 untuk uji/cadangan).
  - Interval 15 menit ✘ (butuh ±96 call/hari).
  - Cakupan IHSG (`JKSE.INDX`) di free tier [UNVERIFIED]. Uji koneksi harus mengetes simbol ini.
  - Cadangan: Marketstack Free (100/bulan, EOD) [IDX di free UNVERIFIED].
- **Manual**: harga penutupan IDX dan IHSG (untuk YTD cukup 1 angka akhir tahun + nilai terkini).
- **Urutan fallback**: EODHD → Marketstack → manual.

### 2.4 Kripto (BTC, ETH, SOL) IDR/USD tiap 5 menit

- **Default server**: **CoinMarketCap Basic dengan key gratis milik operator.** Ini bukan "tanpa key", tetapi tanpa biaya, dan satu-satunya opsi yang izin komersial/shared-nya tegas tertulis.
  - 1 call per 5 menit: `GET /v2/cryptocurrency/quotes/latest?id=1,1027,5426&convert=IDR` (≤100 aset & 1 convert = 1 kredit) → 31 hari × 288 = **8.928 kredit/bulan**.
  - USD: turunkan dari IDR ÷ USD/IDR (Frankfurter), atau call kedua `convert=USD` tiap 15 menit (+2.976) → total **11.904 ≤ 15.000** ✔.
  - Union simbol semua user tetap 1 kredit selama ≤100 aset.
  - "Perubahan hari ini": `percent_change_24h` dari CMC, atau snapshot 00:00 WIB milik sendiri.
- **Fallback server berurutan**:
  1. CMC Keyless `/public-api/v2/simple/price` (status lisensi [UNVERIFIED]; hanya saat CMC Basic gagal)
  2. **Indodax `/api/summaries`** (IDR native, 1 call semua pair). Hanya jika write.financial sudah mendapat izin tertulis Indodax. Sebelum itu jangan dipakai shared.
  3. Nilai terakhir di cache + label basi
  4. Manual
- **BYOK opsional**:
  - CoinGecko Demo: 1 call per 5 menit `/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=idr,usd` → 8.928/bulan ≤ 10.000 ✔ (tipis, tanpa ruang uji).
    - **Peringatan lisensi**: CoinGecko menyatakan produk yang *dijual* tetap butuh plan berbayar meski BYOK. Aktifkan hanya jika write.financial tidak dimonetisasi, dan tampilkan "Powered by CoinGecko".
  - CMC Basic milik user: 15.000/bulan ✔.
- **Manual**: input harga kripto (misalnya aset yang tidak ada di CMC).

### 2.5 Emas (XAU, Antam, Pluang)

- **Default server**:
  - **fawazahmed0 `xau.min.json`** 1×/hari → XAU/IDR dan XAU/USD.
  - Konversi per gram = harga per troy oz ÷ 31,1034768.
  - Tampilkan sebagai "harga spot (estimasi)".
- **Antam/Pluang**: **manual**.
  - User mengisi harga beli/buyback per gram (Antam update 08:30 WIB).
  - Fitur opsional: "premium Antam vs spot (%)" yang disimpan user. App menghitung estimasi harian = spot × (1 + premium), dengan label "estimasi".
- **BYOK opsional**:
  - GoldAPI.io (100/bulan): 1×/hari = 31 ✔, atau 2×/hari = 62 ✔.
  - metals.dev (100/bulan): sama.
  - 3×/hari (93) terlalu mepet → **maks 2×/hari**.
- **Fallback**: fawazahmed0 → (Indodax PAXG/IDR setelah izin) → nilai terakhir → manual.

### 2.6 NAB reksa dana (Bibit RDPU, IDX30)

- **Default server**: **tidak ada.** Tidak ada API legal gratis.
- **BYOK**: tidak ada provider gratis yang relevan.
- **Manual (utama)**:
  - User mengisi NAB/unit + tanggal NAB.
  - Untuk **RDPU**: opsi "estimasi akrual harian" dari imbal hasil tahunan yang diisi user (misalnya 4–5%/tahun ÷ 365), dengan label estimasi. Saat user mengisi NAB riil, estimasi dikalibrasi ulang.
  - Untuk **reksa dana indeks IDX30**: manual. Bisa juga proxy pergerakan dari IHSG/IDX30 milik BYOK EODHD [UNVERIFIED ketersediaan IDX30] dengan label estimasi.
- **Jangka menengah**: minta izin/lisensi data ke Pasardana (PT Bina Investama Infonet). Itu satu-satunya agregator NAB harian lengkap yang ditemukan.

### 2.7 SBN (ORI026)

- **Tidak perlu API.** Nilai = nominal (par) + kupon tetap yang dihitung lokal.
  - User memilih seri (ORI026-T3/T6), nominal, dan tanggal setelmen.
  - Jadwal kupon bulanan dan tanggal jatuh tempo diisi dari memorandum informasi (seed data statis per seri, diverifikasi manual).
- **Manual opsional**: harga pasar sekunder (bid mitra distribusi) atau referensi PHEI, jika user ingin *mark-to-market*.

### 2.8 Ringkasan urutan fallback

| Aset | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| FX | Frankfurter | fawazahmed0 jsDelivr | fawazahmed0 pages.dev | open.er-api (atribusi) | Manual / cache terakhir |
| US stock/ETF | BYOK Tiingo | BYOK Finnhub | BYOK Massive (EOD) / AV (EOD) | Manual | Cache user terakhir |
| IDX + IHSG | BYOK EODHD | BYOK Marketstack | Manual | Cache user terakhir | – |
| Kripto | CMC Basic (key operator) | CMC Keyless | Indodax (setelah izin) | BYOK CoinGecko/CMC user | Manual / cache |
| XAU spot | fawazahmed0 | BYOK GoldAPI / metals.dev | Indodax PAXG (setelah izin) | Manual | – |
| Antam/Pluang | Manual | Estimasi spot × premium user | – | – | – |
| Reksa dana | Manual | Estimasi akrual (RDPU) | – | – | – |
| ORI | Kalkulasi lokal kupon tetap | Manual harga pasar | – | – | – |

### 2.9 Kecukupan kuota BYOK untuk 1 user ±25 simbol

Asumsi: 15 US, 4 IDX (termasuk IHSG), 3 kripto, 1 emas, 2+ FX.

| Provider | Kebutuhan pada interval desain | Kuota free | Muat? | Interval yang muat |
|---|---|---|---|---|
| Tiingo (15 US) | 26 call/hari (batch) | 50/jam, 1.000/hari | ✔ | 15 menit (bahkan 2–5 menit) |
| Finnhub (15 US) | 15 call/slot, 390/hari | 60/menit | ✔ | 15 menit |
| Massive Basic (US) | – (EOD saja) | 5/menit | ✔ untuk EOD | 1×/hari |
| Alpha Vantage (15 US) | 390/hari | 25/hari | ✘ | 1×/hari (15 call) |
| Twelve Data (15 US) | 390/hari, 15 kredit/slot | 8/menit, 800/hari | ✔ secara kuota (sebar 2 menit/slot) | – (lisensi non-display ❌) |
| FMP (15 US) | 390/hari | 250/hari | ✘ | 30 menit (195/hari) – lisensi ❌ |
| EODHD (4 IDX) | 96/hari pada 15 menit | 20/hari | ✘ | EOD + 3 refresh/hari (16) |
| Marketstack (IDX/US EOD) | 1/hari (multi-simbol) | 100/bulan | ✔ | 1×/hari bursa |
| CoinGecko Demo (3 kripto) | 8.928/bulan | 10.000/bulan, 100/menit | ✔ (tipis) | 5 menit |
| CMC Basic (3 kripto) | 8.928–11.904/bulan | 15.000/bulan | ✔ | 5 menit |
| GoldAPI / metals.dev | 31–62/bulan | 100/bulan | ✔ | 1–2×/hari |
| ExchangeRate-API key | 31/bulan | 1.500/bulan | ✔ | harian |

---

## 3. Desain field BYOK per provider (layar Pengaturan › API kurs & pasar)

Pola umum untuk semua provider:
- Field `API key` (password field, tombol tampilkan/sembunyikan).
- Toggle "Aktif".
- Pilihan "Gunakan untuk: [aset]".
- Badge status: `Belum diuji` / `Terhubung` / `Key salah` / `Kuota habis s.d. {reset}` / `Limit per menit, coba lagi`.
- Teks lisensi: "Key pribadi — data hanya untuk Anda".
- Penyimpanan:
  - Key dienkripsi di server (envelope encryption).
  - Key tidak pernah dikirim balik ke client; tampilkan 4 karakter terakhir.
  - Key tidak pernah di-log.
  - Request dilakukan oleh proxy server dengan isolasi per user (beberapa provider, misalnya CoinGecko, tidak mendukung CORS).

| Provider | Field | Link "Dapatkan key gratis" | Kuota yang ditampilkan | Tes koneksi (endpoint ringan) | Deteksi kuota habis / error |
|---|---|---|---|---|---|
| **Tiingo** | API token | https://www.tiingo.com/account/api/token (login dulu; daftar di https://www.tiingo.com/) [URL token UNVERIFIED] | "Gratis: 50 request/jam, 1.000/hari, 500 simbol/bulan · Lisensi pribadi" | `GET https://api.tiingo.com/api/test` + header `Authorization: Token <key>`, `Content-Type: application/json`. Sukses = 200 dengan `message` [isi sukses UNVERIFIED]. Token salah → `{"message":"Auth Token was not correct"}` [uji 17-10]. | HTTP 429 [UNVERIFIED]. Hitung sendiri per jam/hari di sisi app. |
| **Finnhub** | API key | https://finnhub.io/register | "Gratis: 60 call/menit · US saja · Lisensi pribadi" | `GET https://finnhub.io/api/v1/quote?symbol=SPY` + header `X-Finnhub-Token`. Sukses = 200 & `c>0`. Tanpa/salah key → 401 `{"error":…}` [uji 17-10]. | **HTTP 429** (docs). Batas tambahan 30/detik. |
| **Massive (Polygon)** | API key | https://massive.com/ (Create account) | "Gratis: 5 call/menit · EOD · 2 tahun · Individual use" | `GET https://api.massive.com/v1/marketstatus/now?apiKey=<key>` [endpoint UNVERIFIED]. Key salah → 401 `{"status":"ERROR","error":"Unknown API Key"}` [uji 17-10]. | HTTP 429 [UNVERIFIED]. Pakai antrean ≤5/menit di sisi app. |
| **Alpha Vantage** | API key | https://www.alphavantage.co/support/#api-key | "Gratis: 25 request/hari · Lisensi pribadi" | `GET https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY&apikey=<key>` → harus berisi `"Global Quote"`. **Catatan**: key acak pun lolos [uji 17-10], jadi tes ini hanya membuktikan konektivitas. Tampilkan "tidak dapat memverifikasi key". | HTTP **200** dengan field `"Information"` atau `"Note"` (pesan limit/demo) alih-alih data [uji 17-10 untuk `demo`; teks limit UNVERIFIED]. Hitung 25/hari di sisi app. |
| **EODHD** | API token | https://eodhd.com/register | "Gratis: 20 call/hari · EOD 1 tahun · IDX ✔ · Lisensi pribadi" | `GET https://eodhd.com/api/user?api_token=<key>&fmt=json` (info akun, sisa kuota) [field UNVERIFIED]. Lanjutkan dengan `GET /api/eod/BBCA.JK?api_token=…&fmt=json&from=<kemarin>` untuk memastikan cakupan IDX. Token salah → 401 `Unauthenticated` [uji 17-10]. | Header `X-RateLimit-Limit`/`X-RateLimit-Remaining` (per menit) [uji 17-10]. Cap harian habis → HTTP 402/429 [UNVERIFIED]. 403 = simbol/plan tidak diizinkan. |
| **Marketstack** | Access key | https://marketstack.com/signup/free | "Gratis: 100 request/bulan · EOD · non-komersial" | `GET https://api.marketstack.com/v2/eod/latest?access_key=<key>&symbols=AAPL` [versi endpoint UNVERIFIED] | Error JSON `error.code` misalnya `usage_limit_reached` / HTTP 429 [UNVERIFIED] |
| **CoinMarketCap** (opsional untuk user; key operator di env server) | API key | https://coinmarketcap.com/api/pricing/ (Get Free API Key) | "Gratis: 15.000 kredit/bulan, 50 request/menit" + sisa dari `/v1/key/info` | `GET https://pro-api.coinmarketcap.com/v1/key/info` + header `X-CMC_PRO_API_KEY`. Tidak memakan kredit. Key salah → 401 `error_code:1001` [uji 17-10]. | **HTTP 429** + `status.error_code`: 1008 (menit), 1009 (harian), 1010 (bulanan), 1011 (IP). Pantau `status.credit_count`. |
| **CoinGecko Demo** | Demo API key | https://www.coingecko.com/en/developers/dashboard | "Gratis: 10.000 call/bulan, 100/menit · wajib 'Powered by CoinGecko' · non-komersial" | `GET https://api.coingecko.com/api/v3/ping` + header `x-cg-demo-api-key`. Key hilang → 401 `error_code:10002` [uji 17-10]. Key Pro di root Demo → 10011/10010. | **HTTP 429** (rate limit). Kuota bulanan habis → 429 [UNVERIFIED]. Error 4xx/5xx tetap dihitung ke limit. |
| **GoldAPI.io** | Access token | https://www.goldapi.io/ (Sign up) | "Gratis (Sandbox): maks 100 request/bulan · XAU/IDR ✔" | `GET https://www.goldapi.io/api/stat` + header `x-access-token` (statistik pemakaian). Tanpa key → 403 `No API Key provided` [uji 17-10]. | Header `x-ratelimit-limit/remaining/reset` [uji 17-10]. Kuota habis → 429 (konstanta `TOO_MANY_REQUESTS` di bundle) [UNVERIFIED]. |
| **metals.dev** | API key | https://metals.dev/ (Get Free API Key) | "Gratis: 100 request/bulan" + sisa dari `/usage` | `GET https://api.metals.dev/usage?api_key=<key>`. Key salah → 401 `error_code:1101` [uji 17-10]. | JSON `status:"failure"`, `error_code:1203` = kuota bulan ini (termasuk grace) habis. |
| **ExchangeRate-API** (opsional) | API key | https://app.exchangerate-api.com/sign-up | "Gratis: 1.500 request/bulan" + sisa dari `/quota` | `GET https://v6.exchangerate-api.com/v6/<key>/quota` (tertunda 5–60 menit). | JSON `result:"error"`, `error-type:"quota-reached"` / `"invalid-key"` / `"inactive-account"`. |
| Twelve Data, FMP | **Tidak ditampilkan** (lisensi free tidak mengizinkan display, lihat §4) | – | – | – | – |

Perilaku UI saat kuota habis:
- Tandai provider sebagai "jeda sampai {reset}" (per menit: 60 detik; harian: 00:00 zona provider; bulanan: tanggal anchor).
- Turun otomatis ke fallback berikutnya.
- Tampilkan banner kecil di holding: "Harga dari {sumber cadangan / manual}, per {waktu}".

---

## 4. Risiko legal/teknis & yang TIDAK boleh dipakai

### 4.1 DILARANG

| Sumber | Alasan (sumber primer) |
|---|---|
| **Yahoo Finance unofficial** (`query1/query2.finance.yahoo.com`, yfinance, `^JKSE`, `.JK`) | ToS Yahoo melarang "access or collect data … using any automated means, … scrapers, data mining tools" tanpa izin; melarang membuat "database, archive, … data feed" pengganti layanan Yahoo; dan "you may not access or reuse the Services … for any commercial purpose". Endpoint memang bisa diakses secara teknis ([uji 17-10] 200), tetapi tidak berarti boleh. |
| **Stooq** | "This data is intended solely for personal use. Any commercial use is prohibited." Endpoint CSV kini memakai tantangan JS. |
| **Scraping Pasardana, Bareksa, Bibit, logammulia.com, idx.co.id, bi.go.id** untuk tampilan shared | Pasardana melarang eksplisit penggunaan ulang/distribusi tanpa izin tertulis. Yang lain tidak punya terms yang mengizinkan (atau terms tidak ditemukan [UNVERIFIED]). Data bursa IDX berlisensi. |
| **CoinGecko Demo/keyless sebagai default server** | Help center: Demo dan keyless tidak memberi hak komersial. FAQ BYOK: produk yang dijual tetap butuh plan berbayar. |
| **Indodax sebagai sumber shared tanpa izin tertulis** | SKU: akses Platform "semata-mata untuk tujuan pribadi", dilarang mendistribusikan/mengkomersialkan bagian mana pun dari Platform tanpa izin tertulis. |
| **Twelve Data Basic & FMP Basic** (termasuk via BYOK) | Twelve Data Basic: "internal non-display usage only" dan larangan "Use Free Tier data for commercial purposes". FMP: display butuh "Data Display and Licensing Agreement". |
| **Memakai hasil BYOK user A untuk user B** (cache shared, endpoint export publik) | Melanggar Finnhub ("not redistribute or share access … with anyone"), Alpha Vantage, Tiingo (Internal Use), EODHD (melarang "displaying … to others"), Massive (Individual use). |
| **Membuka endpoint/ekspor kurs publik** (API atau CSV kurs untuk pihak lain) | ExchangeRate-API: data tidak boleh dipakai di "product or service that offers programmatic or automatic access". CMC: tidak boleh redistribusi sebagai layanan data. |

### 4.2 Risiko & mitigasi

1. **Free tier bisa berubah/dicabut sewaktu-waktu.** Contoh: ExchangeRate-API ("Free Plans can be discontinued … without notice"), CoinGecko API Terms (limit "may be varied … without notice"), Finnhub ("change the Terms … without notice").
   Mitigasi: lapisan adapter per provider + fallback berurutan. Tampilkan timestamp data. Pantau field `time_eol_unix` (open.er-api).
2. **Rate limit per IP pada sumber keyless.** Semua user berbagi IP server. Mitigasi: global cache, satu worker per sumber, backoff eksponensial, hormati `Retry-After`. Jangan pernah fetch saat render halaman.
3. **Binance diblokir di jaringan Indonesia** ([uji 17-10]: `api.binance.com`/`www.binance.com` gagal TLS; `data-api.binance.vision` lolos) [INFERENCE: pemblokiran ISP]. Jangan bergantung pada Binance. Status hukum Binance di Indonesia juga sensitif (exchange lokal berizin: Indodax/Tokocrypto).
4. **Atribusi wajib.**
   - CoinGecko: "Powered by CoinGecko" (font ≥10) jika BYOK CoinGecko aktif.
   - open.er-api: link "Rates By Exchange Rate API" jika fallback ini pernah dipakai.
   - Kredit sukarela: Frankfurter/BI.
   Mitigasi: komponen "Sumber data" di footer layar portofolio dan di halaman Tentang.
5. **Persyaratan caching/penghapusan.**
   - CoinGecko: cache maksimal di-refresh 24 jam; data dihapus saat akses berakhir.
   - Finnhub: "All data must be deleted should your subscription … ends".
   Mitigasi: saat user menghapus key BYOK → hapus `user_quote` milik provider itu. Nilai portofolio turunan (snapshot bulanan) disimpan sebagai data user [INFERENCE: data turunan milik user; tinjau ulang dengan konsultan hukum].
6. **Akurasi & definisi harga.**
   - Frankfurter default = *blended* mid-rate. Untuk angka resmi gunakan `providers=bi` (kurs transaksi BI, bukan JISDOR).
   - fawazahmed0 tidak mendokumentasikan sumber hulu.
   - Tiingo IEX = harga IEX saja, bukan consolidated.
   - Alpha Vantage gratis = penutupan terakhir.
   - Label "tertunda/EOD" wajib. Jangan sebut "real-time".
   - Alpha Vantage FAQ juga mengingatkan bahwa data real-time/15-menit US diatur bursa/FINRA/SEC.
7. **Validasi key tidak andal.** Alpha Vantage menerima key acak [uji 17-10]. Status "Terhubung" untuk AV harus berbunyi "Terhubung (key tidak dapat diverifikasi)".
8. **Keamanan key BYOK.** Enkripsi at-rest, masking, tidak di-log/ikut error tracking, rate-limit tombol "Tes koneksi" (tes memakan kuota user, misalnya GoldAPI/metals.dev 100/bulan), dan dukung rotasi/hapus.
9. **Kuota CoinGecko Demo tipis** (8.928 dari 10.000 pada interval 5 menit). Jika user memakai CoinGecko key yang sama di tempat lain, kuota bisa habis. Tawarkan interval 10 menit (4.464/bulan) sebagai default BYOK CoinGecko.
10. **Jam bursa & hari libur.** Polling US 20:30–03:00 WIB (DST) / 21:30–04:00 WIB (non-DST). Polling IDX 09:00–16:15 WIB, Senin–Jumat. Lewati hari libur bursa agar kuota tidak terbuang (Finnhub punya endpoint *Market Holiday* [UNVERIFIED free]).
11. **JISDOR vs kurs transaksi BI vs blended.** Tampilkan nama jenis kurs di UI agar user tidak bingung ketika selisihnya beberapa rupiah.

---

## 5. Lampiran: daftar URL sumber primer yang dibaca

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
