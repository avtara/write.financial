# Analysis: Investments (09), Savings goals (13), Debts & installments (18)

Sources: `/tmp/digest/09-investasi.md`, `13-tabungan.md`, `18-utang-cicilan.md`. Example figures are taken from the design. Persona: "Avtara K.", reference dates 15–17 Oct 2026.

---

# A. Investments (Section 09, [yEYn8])

## 1. Overview & user goals
The user records a portfolio across many platforms (Gotrade, Indodax, Stockbit, Bibit, Pluang) **manually**, i.e. units and purchase price. Market prices and the USD exchange rate are updated automatically via API ("Harga diambil dari penyedia data · transaksi tetap manual" (prices come from a data provider · transactions stay manual); "Tidak menghubungkan akun broker" (does not connect broker accounts)). Goal: see portfolio value in IDR or USD, cost basis, profit/loss (unrealized and realized), dividends, allocation per asset class vs target (drift and rebalancing), and allocate assets to savings goals.

## 2. Screens & states
| Screen | Node | Content/purpose | State |
|---|---|---|---|
| write.financial — Investments | bgmSP | Header (11 positions · 5 platforms · USD rate Rp16.350 · prices 16.42 WIB), KPIs, growth chart, asset allocation, Holdings table, rebalancing calculator, dividends, "Tempat aset disimpan" (where assets are held) | default (IDR) |
| USD mode | JBGq7 | All values in USD ("ditampilkan dalam USD · kurs Rp16.350", US$3.757 ≈ Rp61.420.000), rebalancing "Acuan USD" (USD basis) | toggle |
| Syncing prices | SNpaj | "Sinkron 3/5…", "Memperbarui harga pasar" (updating market prices) | loading (sync) |
| Sync failed | TZxs4 | "1 platform gagal · Harga Stockbit belum diperbarui · BBCA, BBRI, TLKM memakai harga 16.15", "Coba lagi" (try again) | partial error |
| Chart hover | XZruO | Tooltip "Akhir September 2026 · Rp57.700.000 · Modal disetor Rp50.900.000 · +Rp6.800.000 +13,4% · Setoran bulan ini +Rp3.000.000 · vs Agustus +Rp4.200.000 (+7,9%)" | hover |
| Search: yield | T9yDX | "5 hasil untuk “yield”", total result Rp3.100.000 −9,3% | search |
| Group: asset class | n6Wcnt | Table per class: "4 posisi · Rp31.220.000 · 51% · target 51%" | grouping |
| Group: platform | p9ExJx | Per platform: "8 posisi · USD · 74% portofolio" | grouping |
| US individual expanded | YNG6S | Category expanded: NVDA, MSFT, AAPL, GOOGL, AMZN. YieldMax insight "total return +6,2%" | expanded |
| Asset ⋮ menu | zxtp9 | Beli lagi (buy more), Jual (sell), Catat dividen (record dividend), Sesuaikan kepemilikan… (adjust holding), Ubah target alokasi (25%) (change allocation target), Pindah ke kategori… (move to category), Atur alokasi ke tujuan… (set allocation to goals), Ubah detail aset… (edit asset details), Lihat detail (view details), Hapus aset (delete asset) | menu |
| Asset detail: SPY | CtiSh / DZkbW | Units, current/average price, cost basis, P/L, share vs target, allocation to goals, DCA purchase history, dividends | panel |
| SPY detail — edit allocation | Oi44y | Edit mode for allocation to goals | edit |
| Record buy | KDF13 | Buy/Sell/Dividend/Cash top-up form, impact preview | dialog |
| Record sell | JejMv | Sell by Rp amount, quick 25%/50%, proceeds to IDR balance or withdraw to bank, realized gain | dialog |
| Set allocation targets | w1jn3J | Target % per class, total validation 101% | dialog + validation error |
| Platform click: Gotrade | CWLga | Filter "8 posisi di Gotrade · termasuk kas US$52 · Kas & detail di Rekening" | filter |
| Skeleton | wnYAv | "Memuat portofolio…" (loading portfolio) | loading |
| Refreshing data | FKPat | "Memperbarui portofolio…" (refreshing portfolio) | refresh |
| Market prices failed to load | KR0zN | "Yahoo Finance & CoinGecko tidak merespons… harga terakhir 16.42", "Buka log API · 429 · CoinGecko · retry-after 30 dtk" | total error |
| Move QQQ to category | hP70H | Category picker "Daftar saya" (my lists) | dialog |
| QQQ moved | ZeE7F | Toast "QQQ dipindah ke US individual… Urungkan" (undo) | success + undo |
| Manage categories | MeRlb | Reorder (drag), list of categories + standalone assets | dialog |
| Edit YieldMax category | OgLFo | Name, asset class, asset selection (max. 1 category per asset) | dialog |
| Delete category | C2WmM | "Kategorinya saja yang dihapus…" (only the category is deleted) | confirmation |
| Adjust holding (more) | j2SH8r | Recorded units 1,197 vs at Gotrade 1,215, choose cause | dialog |
| Adjust holding (fewer) | oExkI | 1,150 → record sale / correction | dialog |
| Edit SGOV asset details | aW8Nv | Ticker, name, currency, asset class + drift preview | dialog |
| Empty | avPzM | "Belum ada portofolio" (no portfolio yet), CTA "Tambah aset" (add asset), "Atur API harga" (configure price API) | empty |
| Sell SPY used by 2 goals | LcuPZ (sec 13) | Sell an asset allocated to goals | dialog |

## 3. User flows
- **Header & chart**: toggle IDR↔USD → click "Sinkronkan" (sync) → per-platform progress (3/5) → may partially fail (Stockbit keeps using the 16.15 price) → "Coba lagi". Chart hover shows month-end value, cost basis, gain, that month's contributions, and the change vs the previous month. Ranges: 1B · 3B · YTD · 1T · Semua (1M · 3M · YTD · 1Y · All).
- **Holdings**: search ticker/name → change grouping (Daftar saya / Kelas aset / Platform) → expand category → ⋮ menu → Lihat detail.
- **Actions**: Record Investment Transaction (Buy: pick asset, amount in US$ or units, pay from platform cash, admin fee, tax, exchange rate → preview of share and remaining cash → "Simpan beli" (save buy)). Sell: value or % of position → proceeds to the platform IDR balance or withdraw to a bank account → realized gain. Set per-class targets. Click a platform to filter.
- **Composition (1)**: SPY detail → "DIALOKASIKAN KE TUJUAN · Ubah" (allocated to goals · edit) → change %. ⋮ menu → Pindah ke kategori → toast + Urungkan.
- **Composition (2)**: Manage categories (reorder) → Edit category (name, asset class, members) → Delete category (assets become standalone assets).
- **Composition (3)**: Adjust holding. If units are **more**, choose a cause: unrecorded purchase (creates a Buy transaction, cost basis rises), DRIP (recorded as dividend, cost basis unchanged), or correction without cost basis. If units are **fewer**: "Catat sebagai penjualan" (record as sale; continues to Record sell) or "Koreksi salah input" (correct input error; cost basis reduced proportionally). Then change asset class with a drift impact preview.
- **Empty**: Tambah aset / Atur API harga (in Settings).

## 4. Data entities & fields
- **InvestmentPlatform**: name (Gotrade, Indodax, Stockbit, Bibit, Pluang), currency (USD/IDR), cash balance (USD cash US$52 / Indodax IDR balance), per-platform `lastSyncedAt` ("sinkron 16.40", "16.15"), sync status. [INFERENCE] A platform is an *Account* type (see "12 rekening · … 5 platform investasi"; "Kas & detail di Rekening").
- **Asset/Holding**: ticker (SPY, QQQ, VEA, SCHD, VWO, SGOV, BTC, XAU, BBCA, BBRI, TLKM, IDX30, ORI026, MSTY, NVDY, TSLY, CONY, NVDA, MSFT, AAPL, GOOGL, AMZN), name, platformId, quote currency (enum USD/IDR), asset class (enum: Saham AS (US equities), Internasional (international), Indonesia, Kripto (crypto), Kas & SGOV (cash & SGOV), Emas (gold), Income), nullable categoryId, units (high-precision decimal, e.g. 0,0725 or 1,197; crypto needs more), average price (US$582,45, decimal in the original currency), IDR cost basis (Rp11.400.000, bigint), coupon metadata (ORI "kupon 6,3%"), dividend schedule ("tiap kuartal (Mar, Jun, Sep, Des) · berikutnya ±19 Des"), DCA ("DCA tiap tgl 1").
- **AssetCategory** ("Daftar saya"): name, asset class (used for targets), order, members (an asset may belong to only one category).
- **InvestmentTransaction**: type enum (Beli (buy), Jual (sell), Dividen (dividend), Top-up kas (cash top-up), Penyesuaian/koreksi (adjustment/correction), DRIP), date-time ("15 Okt, 19.50"), units, price per unit (original currency), amount, admin fee, tax, exchange rate (Rp16.350), total paid/received, cash source/destination (platform cash or bank account), DCA label, realized gain (derived). Also creates platform cash-ledger entries: "Pembelian SPY −US$50,00 · Biaya keuangan −US$0,15 · −US$0,02".
- **Dividend**: date, asset, net amount, tax ("pajak Rp20.000", "pajak final"), disposition enum (Dibelikan aset (manual) (reinvested in assets, manual) / Masih di kas (still in cash) / Masuk ke BCA (deposited to BCA)).
- **AllocationTarget**: asset class → target % (51/12/7/8/5/5…). There is also a per-asset target (SPY "target 25%", scale 0–40%).
- **GoalAllocation** (asset→goal): assetId, goalId, percentage (DP Rumah 60%, Dana Pensiun 40%), derived units (0,718 / 0,479), "ikut DCA" (follows DCA) flag. See the Savings goals section.
- **PriceQuote**: assetId/symbol, price, currency, source (Yahoo Finance, CoinGecko, + IDX/mutual funds [INFERENCE]), fetchedAt, daily change (+0,60%).
- **FxRate**: USD/IDR 16.350, fetchedAt.
- **PortfolioSnapshot** (monthly, for the chart): month-end value (28,5 … 61,4 million), contributed capital, that month's contributions.
- **HoldingAdjustment** (correction history): units before/after, cause, cost-basis impact ("Riwayat koreksi tersimpan di Detail aset").
- **ApiLog**: provider, HTTP code (429), retry-after ("Buka log API").

IDR money is stored as bigint rupiah. USD as bigint cents. Units and prices as high-precision numeric.

## 5. Business rules & calculations
- **Position value** = units × latest price (original currency) × exchange rate → IDR. SPY: 1,197 × US$690,10 = US$826,05 (≈ US$825,69 in the table) × 16.350 ≈ Rp13.500.000.
- **Cost basis** = Σ purchase cost (IDR at the transaction-time exchange rate) − the portion sold. SPY: 1,197 × US$582,45 ≈ US$697 → Rp11.400.000. Total cost basis Rp53.931.000.
- **Unrealized gain** = value − cost basis. Portfolio: 61.420.000 − 53.931.000 = +Rp7.489.000 (+13,9% = 7,489/53,931). SPY +Rp2.100.000 (+18,4%) or +US$128,44.
- **Realized gain** from Sell: BTC sold for Rp1.200.000 → "Untung terealisasi +Rp352.000" (proceeds − proportional cost basis; average-cost method [INFERENCE], since "Harga rata-rata" (average price) is shown). Realized column total +Rp1.476.700.
- **Received** = sale − admin fee − tax: 1.200.000 − 3.500 − 1.200 = Rp1.195.300.
- **Buy**: units = amount ÷ price: 50 / 690,10 = 0,0725. Total paid = 50 + 0,15 + 0,02 = US$50,17 × 16.350 = Rp820.280. Cash US$52,00 → US$1,83 (52 − 50,17).
- **Today** ("Hari ini") = Σ units × (current price − yesterday's close): +Rp312.000 (+0,51%).
- **12-month dividends** net Rp2.640.000. **Yield** = 2,64 / 61,42 = 4,3%. Per-asset yield: SPY US$5,10 · yield 1,2%.
- **Total return** = price gain + distributions received: YieldMax "Harga turun −9,3%, tapi dengan distribusi Rp530.000… total return +6,2%".
- **Share** = asset value / total portfolio (SPY 22,0%). **Portfolio drift** = Σ|share − target| / 2. Example: (0,8+1,0+0,6+2,0+0,4+0,3+1,1)/2 = 3,1% ✓.
- **Rebalancing** (calculator, "tidak membuat transaksi" (does not create transactions)): shortfall per asset = target% × (total + additional funds) − value. SPY: 25% × US$3.756,57 ≈ US$939 − 825,69 ≈ "+US$113,76". Total result "Beli Rp3.650.000 · jual Rp3.650.000 · Drift jadi 0%". Can use a Rupiah or USD basis.
- **Target validation**: total must be 100%. If "Total 101%", show "Total target lebih 1% · Ambil 1% dari Saham AS".
- **Categories** are for grouping only: "Nilai & transaksi tidak berubah" (values & transactions unchanged). The category's asset class is used for targets. Changing one asset's class shifts shares and drift (SGOV to Income: 7,0%→1,4%, 5,0%→10,6%, drift 3,1%→6,6%).
- **Adjust holding**: unit difference × price × exchange rate = 0,018 × 690,10 × 16.350 ≈ Rp203.000. The impact is split across goals per allocation (DP 60% +Rp122.000, Pensiun 40% +Rp81.000). For a unit shortfall on an asset used by 2 goals, the user must choose which goal is reduced (default proportional −Rp318.000/−Rp212.000).
- **DCA** into an allocated asset: new units are automatically split per goal % ("ikut DCA"; "Pembelian SPY baru (DCA) otomatis dibagi 60/40").
- **Chart**: month-end value vs contributed capital. YTD return is compared with benchmarks (Portofolio +11,2% · SPY +14,8% · IHSG +3,1%), so benchmark index prices are needed.
- **Concentration warning**: "74% aset ada di satu platform. Pertimbangkan batas perlindungan dan risiko akun." [INFERENCE] triggered by some threshold (>50%?).
- **Stale prices**: if sync fails, valuation uses the last price with its timestamp (16.15 / 16.42) and is still displayed.

## 6. Background jobs/scheduler & integrations
- **Market price sync** (manual via "Sinkronkan" + periodic [INFERENCE]): per provider/platform. Yahoo Finance (US and IDX equities/ETFs), CoinGecko (BTC), plus sources for gold (XAU Pluang), mutual fund NAV (Bibit IDX30/RDPU "NAB 16 Okt") and SBN (government bonds). Per-platform progress (3/5), per-platform status, 429 handling with retry-after (30 s), API log. BullMQ queue with per-provider backoff.
- **USD/IDR exchange rate sync** (Rp16.350). Used for valuation, USD mode, and the default rate in forms ("harga & kurs terisi dari data pasar terakhir").
- **Month-end portfolio snapshot** for the chart (value, cost basis, contributions) and a daily snapshot for "Hari ini" and YTD.
- **Benchmarks** SPY and IHSG for YTD return.
- **Scheduled DCA** "tiap tgl 1" (every 1st): [INFERENCE] creates a transaction/reminder to confirm (Savings goals shows "Top-up Gotrade — DCA · BCA · SPY Rp4.000.000 & SCHD Rp2.000.000 · Rp6.000.000" as a contribution). History shows DCA recorded at that day's price (0,356 units @ US$686,20).
- **Dividend forecast** ("berikutnya ±19 Des"): [INFERENCE] reminder or Calendar entry, no automatic recording.
- Price API keys are configured in Settings ("Atur API harga").

## 7. UI components
App shell (MENU sidebar, ⌘K, ⌘J), IDR/USD segmented toggle, Sinkronkan button with status, KPI cards, stacked area chart (cost basis vs gain) with range tabs and tooltip, allocation drift bars (±points), grouped/expandable holdings table with goal badges ("DP Rumah 60% · Pensiun 40%"), search, grouping segmented control, ⋮ menu, asset detail side panel, share-vs-target slider/scale, transaction form dialog with tabs (Beli/Jual/Dividen/Top-up kas) and "SETELAH DISIMPAN" (after saving) preview, quick chips 25%/50%, account picker, % inputs with total validation, drag-to-reorder list, toast with Urungkan, error banner with "Coba lagi"/"Buka log API", skeleton, empty state.

## 8. Open questions
- Cost method: average or FIFO? (the design only shows "Harga rata-rata").
- IDR cost basis for USD assets: historical per-transaction rate or current rate? Is FX P/L separated? (Savings goals shows "Perubahan harga & kurs" (price & FX change) separately.)
- Auto-sync frequency and providers for IDX, mutual funds, gold, and SBN are not specified (only Yahoo Finance & CoinGecko are named).
- "data tetap di perangkatmu" (data stays on your device) contradicts the server architecture (Postgres on a VPS). Copy needs clarification.
- Asset counts are inconsistent: "3 kategori berisi 14 aset" vs "15 aset" after QQQ is moved, and the header "11 posisi" vs ±22 tickers.
- Does DCA automatically create a Buy transaction, or only a confirmed Top-up transfer with the Buy recorded manually?
- Is there a per-asset target (SPY 25%) in addition to per-class targets, and how do the two interact?

---

# B. Savings goals (Section 13, [EICCD])

## 1. Overview & user goals
The user creates savings goals (target, deadline, holding account, recurring contribution) that are **linked to transactions**. Contributions and withdrawals are recorded as labeled Transfers (#dana-darurat), not expenses. Progress is computed from account balances, labeled transactions, and investment asset allocations at market value. Money is not moved, only allocated.

## 2. Screens & states
| Screen | Node | Content/purpose | State |
|---|---|---|---|
| write.financial — Savings goals | qm7zi | KPIs (Total terkumpul (total saved) Rp39.725.000 · Rp22.400.000 in investments; Setoran Oktober (October contributions) Rp3.500.000 of planned Rp4.650.000; Dana darurat (emergency fund) 0,6 months), 6 goal cards, October recurring-contribution timeline, "Ditabung per bulan" (saved per month) chart | default |
| Sort | JdZkw | Progres tertinggi/Sisa terbesar/Nama A–Z (highest progress/largest remaining/name A–Z); Tampilkan dana tidak rutin (show sinking funds); Kelompokkan per rekening (group by account) | dropdown |
| Emergency Fund ⋮ menu | D3nEd | Lihat detail (view details), Setor manual (S) (manual deposit), Tarik dana (withdraw), Ubah setoran rutin (edit recurring contribution), Jeda setoran rutin (pause recurring contribution), Tandai selesai (mark done), Hapus tujuan (delete goal) | menu |
| Pick month | WlXzb | 2026 month picker, "Angka = total ditabung per bulan" | popover |
| Oct chart tooltip | K53KpY | "Total Rp9.500.000 · 36,5% dari pemasukan" | hover |
| New goal | q0jRa | Form: name, icon & color, target, deadline, account, recurring contribution | dialog |
| New goal: pick account | IsSRI | List of accounts (Bank/E-wallet) and their balances | dropdown |
| Manual deposit | PCgK1 | Amount (chips 500.000/3.500.000 "Sisa bulan ini" (remaining this month)), from/to, date, note, progress & estimate preview | dialog |
| Deposit recorded | vvQtO | Toast "Transfer BCA Tahapan → Bank Jago dibuat di Transaksi · Lihat" | success |
| Withdraw | nVb1Q | Confirmation: progress 21%→17%, resilience 0,6→0,5, estimate Nov→Dec 2027 | confirmation |
| Emergency Fund detail | q9T3oQ | Held in (Kantong darurat 73% + RDPU "Diproses · NAB 16 Okt"), recurring contribution, history from Transactions | panel |
| Done tab | QI76x | "Terbaru selesai" (recently completed) | tab |
| Final STNK deposit | biM3a | Chip "Pas target 170.000" (exactly to target), "Tercapai setelah setoran ini" (reached after this deposit) | dialog |
| STNK reached | rbvBr | "4 bulan lebih cepat" (4 months early), Hentikan setoran rutin (stop recurring contribution) / Lanjutkan sebagai cadangan (continue as reserve), "Nanti saja / Tandai selesai" (later / mark done) | dialog |
| Done tab: STNK | JJuvW | Toast "setoran rutin Rp43.000 dihentikan · Urungkan", Aktif 5 · Selesai 2 | success |
| Pay from goal | itVPf | Record expense Rp812.000 with toggle "Bayar dari tujuan Perpanjang STNK" (pay from the STNK renewal goal) | dialog |
| Used, with remainder | O4YIh2 | Goal card in used status with a remainder | state |
| Move remainder Rp38.000 | m535GI | Pick another goal (Servis motor 60%→63%, Liburan 35%→35%) or "Lepas jadi saldo bebas" (release as free balance) | dialog |
| Remainder moved | NsuNu | Toast + Urungkan | success |
| Empty | a2uUH | Empty + templates (Dana darurat ±Rp54.000.000, Liburan, Jangka panjang, Gadget), "Impor dari Anggaran" (import from Budget) | empty |
| Skeleton | f33cdP | "Memuat tabungan…" (loading savings) | loading |
| Refreshing (September) | OT6vQ | "Memuat data September 2026…" | refresh |
| Balances hidden | uYQwR | Rp•••••• , "Intip saldo ⌘ ." (Peek balance) | privacy |
| Light mode | hsxsB | Light theme | theme |
| Failed to load | Dr2U1 | "harga investasi (SPY, SCHD, IDX30) belum tersedia… 502 · GET /goals?valuation=market", "Lihat saldo rekening saja" (view account balances only) | error |
| Record Transfer — pick goal | aPqfw | Quick add on Overview: transfer to a goal | dialog |
| Linked to Emergency Fund | Iia40 | Transfer linked to the goal | success |
| Transactions — transfers to savings | UEi5W | Filtered Transactions page (from "Buka" (open)) | navigation |
| DP Rumah detail (mixed) | DeE0u | 3 sources: SPY 60% Rp8.100.000, Bibit IDX30 Rp1.000.000, BCA fixed amount Rp5.000.000; October attribution | panel |
| Set funding sources | UpO8Q / B2aDS7 / kcC3y | Allocation mode: Persentase / Seluruh aset / Nominal tetap (percentage / entire asset / fixed amount); Tambah sumber (add source) | dialog |
| Exceeds 100% | QCbeZ | "Melebihi 100% — Dana Pensiun sudah memakai 40%. Maks. 60%" | validation error |
| Sell SPY used by 2 goals | LcuPZ | Sell an allocated asset, choose which goal is reduced | dialog |
| Account balance spent & price drop | F6SPeB | Banner "Belanja dari Bank Jago mengurangi Dana Darurat" (spending from Bank Jago reduces the Emergency Fund) (Servis AC Rp450.000 → Rp10.675.000), "SPY turun 3,1%: DP Rumah −Rp251.000, Dana Pensiun −Rp167.000" | warning |
| Record Expense — allocated account | BGCD8 | Warning when picking an account locked to a goal | warning |

## 3. User flows
- **Dropdown & menu**: sort or set view → goal ⋮ menu → pick month (reloads the period) → chart tooltip.
- **New goal & contributions**: New goal → fill in (Laptop kerja baru, Rp18.000.000, June 2027, account, contribution Rp2.250.000 every 25th from BCA Tahapan → "8× setoran (Nov 2026 – Jun 2027) · label #laptop-kerja") → pick account → Create. Manual deposit → toast + transfer created. Withdraw → confirmation → reverse Transfer.
- **Goal detail**: Emergency Fund panel → contribution history from Transactions ("Buka di Transaksi" (open in Transactions)) → Done tab.
- **Goal reached**: final deposit "Pas target" → reached dialog (stop recurring contribution or continue as reserve) → Tandai selesai → moves to the Done tab + Urungkan.
- **Use for the goal**: Record Expense Rp812.000 from Bank Jago with the "Bayar dari tujuan" (pay from goal) toggle → goal gets status *Terpakai* (used) → move the Rp38.000 remainder to another goal or release it as free balance → toast.
- **Linked to transactions**: Record Transfer on Overview → pick goal → linked (automatic label).
- **Mixed funding sources**: DP Rumah detail → Set sources → pick mode (Persentase/Seluruh aset/Nominal tetap) → Tambah sumber → >100% validation → selling SPY prompts a goal choice → a spending transaction from an allocated account shows the banner "Ganti rekening transaksi / Tetap kurangi" (change transaction account / reduce anyway).
- **States**: empty (templates / Impor dari Anggaran), skeleton, refreshing, balances hidden, light mode, failed to load (502 market valuation).

## 4. Data entities & fields
- **Goal**: name, icon, color, target (bigint IDR), deadline (month-year: "Juni 2027", "2030"), dynamic type/target ("Target 3× pengeluaran bulanan" (target 3× monthly expenses) for the Emergency Fund), label/tag (#dana-darurat), status enum (aktif (active), selesai/tercapai (done/reached), terpakai (used), dijeda (paused) [INFERENCE from "Jeda setoran rutin"]), created ("dibuat Agu 2026"), sinking-fund flag ("dana tidak rutin"; Liburan/Servis/STNK group), valuation mode (fixed vs "Nilai pasar" (market value)), "Lanjutkan sebagai cadangan" flag (may exceed target).
- **GoalFundingSource**: goalId, type enum (rekening (account) | aset investasi (investment asset)), refId, mode enum (Persentase | Seluruh aset | Nominal tetap), value (% or bigint), "ikut DCA". Constraint: Σ% per asset ≤ 100% across goals. Account fixed amount ≤ free balance ("Rp4.200.000 dipakai dana tidak rutin · bebas Rp33.610.000").
- **Sub-pocket/storage**: "Kantong darurat" (emergency pocket; Bank Jago sub-account), "Bibit RDPU". [INFERENCE] A pocket is a child account or an asset.
- **RecurringContribution**: goalId, amount/month, day (1st, 14th, 25th), from account → to account/pocket, requires confirmation ("perlu konfirmasi"; "masuk Perlu ditinjau tiap jatuh tempo, lalu tercatat sebagai Transfer" — enters the Review queue on each due date, then recorded as a Transfer), status active/paused/stopped. One goal can have several contributions (Emergency Fund: Rp500.000 on the 1st + Rp3.000.000 on the 14th). Can be combined ("Sisihkan dana tidak rutin · Liburan, Servis motor, STNK · Rp1.150.000").
- **Transaction** (owned by Transactions) with a `goalId`/tag field; Transfer type ("Tidak dihitung pengeluaran" (not counted as expense)), note, date. An expense can have `paidFromGoalId` ("Pakai dana tujuan" (use goal funds)).
- **GoalEvent/history**: opening balance ("Saldo awal Rp5.125.000 (Agu) + 4 setoran"), deposit, withdrawal, remainder move, mark done (with undo).
- **MonthlySavingsAggregate**: total saved per month (6,3/5,4/3,9/8,0/7,5/9,5 million), percent of income.

## 5. Business rules & calculations
- **Progress** = saved / target. Emergency Fund 11.125.000 / 54.000.000 = 21%. Saved = allocated share of account balances + assets (8.125.000 Kantong + 3.000.000 RDPU).
- **Total saved** = Σ goals: 11,125 + 2,8 + 0,72 + 0,68 + 14,1 + 10,3 = Rp39.725.000 ✓. Investment portion Rp22.400.000 = SPY 8,1 + IDX30 1,0 + SPY 5,4 + SCHD 4,9 + RDPU 3,0 ✓.
- **Investment-backed goal** = Σ (allocated units × price × exchange rate) + fixed amounts. DP Rumah = 8.100.000 + 1.000.000 + 5.000.000 = Rp14.100.000. Dana Pensiun = 5.400.000 + 4.900.000 = Rp10.300.000. Values move with the market (SPY −3,1% → DP −Rp251.000, Pensiun −Rp167.000).
- **Monthly attribution** (DP Rumah Oct): contributions (60% × DCA Rp4.000.000 = +Rp2.400.000) + price & FX change (+Rp186.000). The goal's share of unrealized gain +Rp1.260.000 (= 60% × 2.100.000 ✓).
- **Emergency fund (months)** = saved / monthly expenses. Target 3× ≈ Rp54.000.000, so expenses ≈ Rp18.000.000/month; 11,125/18 = 0,6. After depositing +Rp1.000.000 it becomes 12,125/18 ≈ 0,67 (design: "0,5 bulan"/"selesai" on the deposit-recorded screen; see open questions). Withdrawing Rp2.000.000: 9,125/18 = 0,5 ✓.
- **Contribution/month from target** = (target − saved) / months remaining until deadline: 18.000.000 / 8 = Rp2.250.000 (Nov 2026–Jun 2027).
- **Estimated completion** = now + ceil(remaining / monthly recurring contribution). Depositing Rp1.000.000 shifts Nov 2027 → Oct 2027; withdrawing Rp2.000.000 shifts it to Dec 2027. Status "Sesuai rencana / Hampir tercapai / 2 bulan lagi" (on track / almost reached / 2 months to go).
- **October contributions vs plan**: Rp3.500.000 of Rp4.650.000 (500.000 + 3.000.000 + 1.150.000 ✓); the rest on the 25th.
- **Saved per month** = Σ transfers to goals + investments. Oct Rp9.500.000 = 36,5% of income Rp26.000.000 (same as the saving rate).
- **Reached early**: "4 bulan lebih cepat dari rencana Feb 2027" (Oct vs Feb). Stopping the contribution lowers the monthly plan by Rp43.000.
- **Pay from goal**: the goal is marked *Terpakai* (not counted down). Remainder = 850.000 − 812.000 = Rp38.000, can be moved to another goal or released.
- **Allocated accounts**: an expense from a fully allocated account reduces the goal (Servis AC Rp450.000: 11.125.000 → 10.675.000). The user can change the account or reduce anyway.
- **Account free balance** = balance − Σ goal fixed-amount allocations (Available balance Rp55.023.000, "Rp17.300.000 dialokasikan ke tabungan · bebas Rp37.700.000").
- **Asset allocation validation**: Σ% of all goals per asset ≤ 100% ("Maks. 60%"). Selling an allocated asset → user chooses which goal is reduced. New DCA is split automatically per %.
- **Emergency fund template** = 3× monthly expenses ("±Rp54.000.000").

## 6. Background jobs/scheduler & integrations
- **Recurring contribution due** (1st/14th/25th): a daily job creates a Review queue item ("Perlu ditinjau"; a scheduled transaction awaiting confirmation), then it is recorded as a Transfer once confirmed. Shown on the timeline ("terjadwal" (scheduled) vs "Tercatat" (recorded)) and the Calendar ("Setoran tabungan", "Dana tdk rutin" on the 24th/25th).
- **Goal market valuation** depends on the Investments price/FX jobs. If prices are not available yet → error 502 `GET /goals?valuation=market` with the fallback "Lihat saldo rekening saja".
- **Notifications/banners** for price drops ("SPY turun 3,1% hari ini") and goals almost/already reached [INFERENCE for push].
- **RDPU status "Diproses · NAB 16 Okt"**: waiting for the mutual fund NAV (NAV price sync).
- **Monthly aggregate** "Ditabung per bulan" (computed on the fly or as a period rollup).
- Monthly expense basis for the emergency fund target (from Transactions data).

## 7. UI components
KPI cards, goal cards with progress bar, status badges, source chips ("SPY 60% · IDX30 · BCA Rp5.000.000"), Aktif/Selesai (active/done) tabs with counters, sort dropdown with view toggles, ⋮ menu with shortcut (S), month picker, bar chart with tooltip, recurring-contribution timeline, deposit/withdraw dialog with quick-amount chips and before→after preview, account picker, icon & color picker, detail side panel, allocation-mode input (segmented), toast with Undo/"Lihat" (view), warning banners, empty state + template cards, skeleton, privacy mask (⌘ .), light/dark theme, shortcut "⌘ ↵ untuk menyimpan" (to save).

## 8. Open questions
- Figure inconsistency after a deposit: screen vvQtO shows Rp16.325.000 and "0,5 bulan", whereas a +Rp1.000.000 deposit should give ≈0,67 months. The snippet may come from a different state; needs confirmation.
- Dynamic Emergency Fund target (3× expenses): recalculated monthly or locked at creation?
- Does "Kantong darurat" need its own sub-account entity?
- "Terpakai" (used) vs "Selesai" (done) status: do both go to the Done tab?
- For "Seluruh aset" (entire asset) mode (Bibit IDX30): are units from new DCA automatically included?
- The behavior of "Impor dari Anggaran" is not yet specified.

---

# C. Debts & installments (Section 18, [ucFim])

## 1. Overview & user goals
The user tracks liabilities: current credit card bills, installments (card, paylater, 0%), mortgages/vehicle loans (KPR/KPM), personal loans, and **receivables**. The design focuses on credit cards: card transactions can be split into installments, payments to the card are allocated by priority, and the installment schedule is recalculated on early repayment. When adding a debt, a simulation of its impact on the installment ratio, saving rate, and net worth is shown.

## 2. Screens & states
| Screen | Node | Content/purpose | State |
|---|---|---|---|
| write.financial — Debts & installments | exCE7 | KPIs (Sisa utang (remaining debt) Rp0, Harus dibayar (due), Jatuh tempo terdekat (next due date), Piutang (receivables)), "Kamu bebas utang" (you're debt-free), types: Cicilan kartu kredit (credit card installment), Paylater, Cicilan 0% (0% installment), KPR/KPM, Pinjaman pribadi (personal loan); CTAs Catat piutang (record receivable), Tambah utang / cicilan (add debt / installment) | empty |
| Credit card bill (not yet in installments) | rHTMd | BCA Visa •• 7710: current bill Rp1.250.000 (3 transactions), remaining limit Rp13.750.000 of Rp15.000.000, statement on the 20th / pay by the 5th, "21 hari lagi" (21 days left), Bayar tagihan (pay bill) / Ubah jadi cicilan (convert to installment), card payment priority | has bill |
| Result: installment A remaining Rp1M | A7ttc | Installment A Kulkas (fridge): remaining Rp1.000.000 of Rp3.000.000 (67% paid), schedule recalculated 10 Nov, history | has installment |
| Add installment (draft) | v3Igd | Form + "SIMULASI DAMPAK" (impact simulation) | draft dialog |
| Convert transaction to installment (no transactions yet) | OEZIG | Account page (credit card context, no transactions yet) | empty |
| Record card spend → split 3× | hNvip | Transaction form with "Pecah jadi cicilan" (split into installments) (3/6/12/24 months, interest, admin fee, schedule) | dialog |
| Record card spend → no installment | x20Gf | Toggle off → goes into the current bill | dialog |
| Transfer Rp2M to card → allocation | qrRRV | Priority allocation table (before/paid/remaining), options "Kurangi nominal" (reduce amount) / "Persingkat tenor" (shorten tenor) | dialog |

## 3. User flows
- **Page → debt-free → card bill → has installments**: empty → current bill appears automatically from card transactions ("tagihan dicatat sebagai utang" (the bill is recorded as debt)) → after splitting and a partial repayment, the Installment A card is shown with its schedule.
- **Add debt/installment**: pick type (card installment/KPR/loan) → name (MacBook Air M4 — iBox), principal Rp18.999.000, provider Kredivo, tenor 12, interest 0%/month, first installment 25 Nov 2026, pay from BCA Tahapan → simulation → "Simpan cicilan" (save installment). Alternative: convert an existing card transaction into an installment.
- **Record credit card spend**: transaction A Rp3.000.000 Tokopedia 2 Nov → "Pecah jadi cicilan" (appears because the account is a credit card) → 3 months, interest 0 → schedule 20 Nov/20 Dec/20 Jan @1.000.000 → Save. Transaction B Rp1.000.000 Superindo 6 Nov without installment → goes into the current bill. Transfer Rp2.000.000 BCA Tahapan → BCA Visa 10 Nov → priority allocation: installment A absorbs 2.000.000 (remaining 1.000.000), bill B 0 → choose "Kurangi nominal (3× Rp333.334, tenor tetap)" (reduce amount, same tenor) or "Persingkat tenor (1× Rp1.000.000, lunas 20 Nov)" (shorten tenor, paid off 20 Nov).
- **Record receivable**: the CTA exists ("Pinjaman pribadi · teman / keluarga · uang ditalangi" (personal loan · friends / family · money fronted)), but the flow is not designed.

## 4. Data entities & fields
- **CreditCardAccount** (Account type): name "BCA Visa", last 4 digits (7710), limit (Rp15.000.000), statement date (the 20th), due date (the 5th), payment priority order, credit balance (overpayment).
- **CardStatement/cycle**: period, statement date (20 Nov), due date (5 Dec), total (Rp1.333.334 = installment 333.334 + B 1.000.000), transaction list, status.
- **Debt/Installment**: type enum (cicilan_kartu, paylater, cicilan_0, kpr, kpm, pinjaman_pribadi), name, provider (Kredivo, BCA Visa), source transaction (nullable transactionId: "dari transaksi 2 Nov"), principal (bigint), tenor in months (3/6/12/24), interest % per month (decimal), admin fee (bigint), first installment date, paying account, remaining principal, % paid, status, last recalculation mode.
- **InstallmentSchedule**: debtId, n-th (1/3), billing date (20 Nov), due date (5 Dec), amount (333.334), status enum (Terjadwal (scheduled), Tertagih di rekening koran (billed on statement), Lunas (paid)).
- **DebtPayment/Allocation**: transferId (BCA Tahapan → BCA Visa Rp2.000.000), allocation per liability (Installment A 2.000.000, Bill B 0, Overpayment 0).
- **DebtEvent/history**: "Dibuat dari transaksi A" (created from transaction A), "Dilunasi sebagian Rp2.000.000 · 10 Nov" (partially repaid), "Sebelumnya 3× Rp1.000.000 · pilihan: kurangi nominal, tenor tetap" (previously 3× Rp1.000.000 · choice: reduce amount, same tenor).
- **Receivable**: [INFERENCE] counterparty, amount, date, status. Only the CTA and KPI are visible.

## 5. Business rules & calculations
- **0% installment** = principal ÷ tenor: 18.999.000 / 12 = Rp1.583.250; 3.000.000 / 3 = 1.000.000. The rounding remainder goes to the first installment: 1.000.000 / 3 → 333.334 + 333.333 + 333.333.
- **Interest-bearing** (KPR/loans): input "% per bulan" (% per month). Formula not designed; [INFERENCE] annuity (flat for paylater/cards, effective for KPR).
- **The expense stays recorded on the transaction date** (budget of the transaction month), while installments are debt payments: "Pengeluaran Rp3.000.000 tetap tercatat 2 Nov — masuk anggaran November". Ledger name "Cicilan MacBook Air M4 (1/12)".
- **Installments are not part of the current bill**: they go to Debts & installments. The limit is used up by the principal and restored as each installment is paid ("Cicilan ditahan di limit · sisa pokok A" (installment held against the limit · remaining principal A)).
- **Remaining limit** = limit − current bill − remaining installment principal: 15.000.000 − 1.000.000 − 1.000.000 = 13.000.000 ✓. Previously 15.000.000 − 1.250.000 = 13.750.000 ✓ (8% used).
- **Total card liability** = remaining installment principal + current bill (3.000.000 + 1.000.000 = 4.000.000).
- **Card payment priority** (editable, drag): 1 installment debt (early repayment), 2 non-installment spending, 3 overpayment → credit balance. "Kalau cicilan sudah lunas semua, sisa transfer otomatis ke prioritas berikutnya." (Once all installments are paid off, the remaining transfer automatically goes to the next priority.)
- **Recalculation after partial repayment**: "Kurangi nominal" (same tenor) or "Persingkat tenor". Note "bank menentukan; catat sesuai konfirmasi bank" (the bank decides; record per bank confirmation).
- **Convertible** regular↔installment "selama belum tertagih" (as long as not yet billed).
- **Days until due** ("21 hari lagi" from 15 Oct to 5 Nov).
- **Simulation**: installment/income ratio = 1.583.250 / 26.000.000 = 6,1% (healthy limit ≤ 30%). Saving rate 36,5% → 30,4% (minus 6,1 points; "masih di atas target 30%, sisa ruang 0,4 poin" (still above the 30% target, 0,4 points of headroom)). Net worth Rp116.440.000 → Rp97.440.000 (−principal 18.999.000 ≈ 19 million; "barang tidak dihitung sebagai aset" (goods are not counted as assets)).
- **Net worth** = total assets − remaining debt (with no debt = total assets Rp116.443.000).
- **Header** "Sisa utang", "Harus dibayar" (this month), "Jatuh tempo terdekat", "Piutang".

## 6. Background jobs/scheduler & integrations
- **Card cycle close** (statement date the 20th): move the current bill + n-th installment to status "Tertagih di rekening koran", create the statement.
- **Due-date reminders** (the 5th / first installment due 25 Nov), also shown in the Calendar ("Tagihan terjadwal" (scheduled bill)).
- **Non-card installments** (Kredivo paid from BCA Tahapan): [INFERENCE] create a scheduled Review queue transaction ("Perlu ditinjau") on each date, like recurring contributions.
- **Schedule recalculation** when a payment is recorded (synchronous within the request; no worker needed).
- No bank integration. Everything is recorded manually and adjusted per "konfirmasi bank" (bank confirmation).

## 7. UI components
KPI cards, empty state with debt-type chips, credit card card (limit bar, current bill, dates), bill transaction list, installment card (progress % paid), installment schedule table with status badges, history timeline, drag-to-reorder priority list, form dialog with type segmented control and tenor options (3/6/12/24), "Pecah jadi cicilan" toggle, "SIMULASI DAMPAK" panel (before→after), payment allocation table (priority/before/paid/remaining), recalculation radio options, "Draf belum disimpan" (draft not saved) banner.

## 8. Open questions
- KPR/loan interest formula (flat vs effective/annuity), admin fee (one-time or monthly?), late fees: not designed.
- Receivables flow not designed (only CTA and KPI).
- Non-card paylater (Kredivo): recorded as a separate liability account with a limit?
- Does a goods debt (MacBook) create a full expense transaction up front (like cards), or an expense per installment? The simulation lowers the monthly saving rate by the installment amount, implying installments count as monthly expenses, which contradicts the card flow (full expense on the transaction date).
- Rounding: net worth Rp116.440.000 vs Rp116.443.000.
- Screen OEZIG is labeled "Ubah transaksi jadi cicilan (belum ada transaksi)" but shows the Account page. The entry point for this feature is unclear.

---

# D. Cross-feature requirement: external price/FX data & valuation
1. **`price_quotes` table** (symbol, provider, price, currency, as_of) and **`fx_rates`** (USD/IDR). Keep history for daily change, monthly snapshots, and YTD.
2. **Providers**: Yahoo Finance (US ETFs/equities, IDX, SPY/IHSG indices), CoinGecko (BTC). Gold, mutual fund NAV, and SBN need sources not yet named. API keys in Settings.
3. **BullMQ worker**: sync job per platform/provider (progress "3/5"), rate limiting and backoff (429 retry-after), per-platform status, user-viewable API log. Manual sync triggers a job and the UI polls its status.
4. **Stale prices** are still used with a timestamp, shown per platform ("sinkron 16.15"). A total error must not block the Investments page. Savings goals has the fallback "Lihat saldo rekening saja".
5. **Centralized valuation** (used by Investments, Savings goals, Overview, Accounts "≈ Rp61.420.000", net worth): value = units × price × exchange rate; goal allocation = % × asset value + account fixed amounts.
6. **Snapshots**: month-end value + cost basis + contributions (growth chart), daily (Today).
