# Analysis: Accounts & wallets · Budget · Subscriptions · Calendar

Sources: `/tmp/digest/05-rekening-dompet.md`, `06-anggaran.md`, `07-langganan.md`, `08-kalender.md`. Sample data: user "Avtara K.", today is **15 Oct 2026** (day 15 of 31).

---

# A. Accounts & wallets (Section 05 [Vmofv])

## 1. Summary & user goal
The user manually records every place their money lives: banks, e-wallets, cash, investment platforms, and credit cards. This page shows the available balance, total assets, and accounts that need adjusting. The user can reconcile balances against the bank app without logging into the bank ("Tidak perlu login bank" (no bank login needed), "Tanpa login bank · tanpa akses mutasi" (no bank login · no statement access)). Multi-currency is supported: Gotrade is recorded in USD and converted at "kurs Rp16.350".

## 2. Screens & states
| Screen | Node id | Content/purpose | State |
|---|---|---|---|
| Accounts & wallets (page) | ycP7T | KPIs (Available balance, Investments, Total assets, Needs adjusting), list grouped by BANK/E-WALLET/TUNAI/INVESTASI, BCA detail panel (6-month chart, toggles, recent transactions, savings allocation) | default |
| Adjust balance | lAmFr | Reconcile 1 account: recorded vs actual, with 3 ways to record the difference | dialog |
| Adjust multiple accounts | F6sIL | Bulk reconciliation for accounts not checked in a while | dialog |
| Add account: Bank | C016z | Bank form (logo, last 4 digits, currency, opening balance, color) | dialog (logo not found) |
| Add: E-Wallet | BSYfj | Phone number instead of last 4 digits | dialog |
| Add: Cash | rmT6r | Minimal form | dialog |
| Add: Investment | RcdFp | Asset type, "Nilai saat ini" (current value) | dialog |
| Add: Credit card | FkWkq | Limit, statement date, payment due date | dialog |
| Edit account | a7r2RK | "Mata uang & saldo awal terkunci" (currency & opening balance locked) | dialog |
| Edit: custom color | Bl7ke | Hex color picker "#14B8A6", "Terakhir dipakai" (recently used) | popover |
| Archive account | wkqih | Transfer the balance (optional) then archive, pick a new default | confirmation dialog |
| ⋮ menu (bank) | Ik3il | Edit, Lihat transaksi, Transfer dari sini, Tampil sebagai kartu, Hitung di saldo tersedia, Arsipkan | menu |
| ⋮ menu (investment) | b2Rb6T | Perbarui nilai pasar, Atur kurs USD, Tarik ke rekening bank, Gabung di kartu Investasi | menu |
| Drag to reorder | UiCq6 | "Lepas di atas Bank Jago · urutan kartu ikut berubah" (drop above Bank Jago · card order changes too) | drag |
| Card limit reached | amsm2 | "Maks 3 rekening jadi kartu" (max 3 accounts as cards) | inline error/toast |
| Archived tab | oed7u | Jenius: Pulihkan (restore) / Hapus permanen (delete permanently) | tab |
| Needs-adjusting filter | r3WDF7 | "Belum dicek lebih dari 14 hari" (not checked for over 14 days), "Sesuaikan sekaligus" (adjust all at once) | filter |
| Low balance (OVO) | I3a8q | "Saldo di bawah batas Rp100.000", estimated run-out | warning |
| Investment panel (Gotrade) | Va1Jx | USD value, 6-month chart, Setoran/Dividen/Ditarik (deposits/dividends/withdrawn) | default |
| Updating market value | GHdic | "memperbarui 2 / 5…", "Diperbarui 19.41" | loading (partial) |
| Credit card: cycle detail | YFgrE | Cycle timeline, calculation rules | default |
| Credit card: change limit & dates | U64Fs4 | Inline edit of limit, statement and due dates | edit |
| Skeleton | RVgMr | "Memuat rekening…" | loading |
| Refreshing data | z9IPq6 | "Memperbarui saldo…" | loading (refresh) |
| Failed to load | nSLCl | "504 · GET /accounts", shows last saved balance | error |
| Empty | M9WVC | "Tambahkan rekening pertamamu", "Tambah dompet tunai" | empty |

## 3. User flows
- **Dialog → adjust balance**: open account → "Sesuaikan saldo" → enter "Saldo sebenarnya" (actual balance, 42.795.000) → system shows "Selisih −Rp15.000" → pick one way to record the difference:
  - (a) record as an expense transaction (e.g. "Biaya keuangan → Admin bulanan −Rp15.000"),
  - (b) "Ada transaksi yang terlewat" (a transaction was missed): opens the BCA transaction list since 1 Oct,
  - (c) "Koreksi tanpa transaksi" (correction without a transaction; excluded from expense reports).
  
  The adjustment date can be changed ("Per 15 Okt 2026, 19.40 · Ubah"). The last adjustment is shown: "Terakhir disesuaikan 1 Okt · −Rp12.500".
- **Adjust multiple**: from the "Perlu disesuaikan" KPI or the "Sesuaikan sekaligus" button → list of accounts labeled "dicek N hari lalu" (checked N days ago) → enter actual balance per row → difference category selectable per row (OVO → "Biaya platform", Dompet → "Makan & Dapur") → "total −Rp52.500".
- **Add account**: choose type (Bank/E-Wallet/Cash/Credit card; Investment also available) → enter provider ("ketik bebas" (free text); logo auto-found, or user uploads a PNG/uses an icon) → display name → last 4 digits/phone number → currency → opening balance + date → color → toggles → card preview.
- **Edit → custom color → archive**: when archiving, the user can move the balance to another account (optional; e.g. "Rp8.125.000 → Rp50.935.000") and pick a new default account → "Transfer & arsipkan".
- **List → ⋮ menu → investment menu → drag reorder → card limit → archived → needs adjusting** (in the screen order above). The Archived tab offers Restore or Delete permanently (which also removes 87 transactions from reports).
- **Panel → investment → update market value → low balance**: per-platform price refresh runs incrementally ("2 / 5"). For low balance there are CTAs "Top-up dari BCA" and "Ubah batas" (change threshold).
- **Credit card → cycle detail → change limit & dates**.
- **Loading / failed / empty**.

## 4. Data entities & fields
**Account**
- id, user_id
- type: enum `bank|ewallet|cash|investment|credit_card`
- provider_name: free text ("Bank Central Asia", "SeaBank")
- logo: auto | upload PNG | icon
- display_name
- last4: char(4), nullable ("•• 4821")
- phone: for e-wallets ("0812 3456 7818", displayed as "0812•• 18")
- currency: ISO (IDR/USD); locked after creation
- opening_balance: bigint minor; opening_date ("Sejak 12 Jan 2025"); locked
- color: hex
- include_in_available: bool ("Hitung dalam saldo tersedia" / "Hitung dalam total saldo")
- include_in_net_worth: bool [INFERENCE: for Investments the text is "Masuk kekayaan bersih · tidak masuk saldo tersedia" (counts toward net worth · not toward available balance)]
- show_as_card: bool (max 3)
- is_default_quick_entry: bool ("Default Catat Cepat"; unique per user)
- sort_order: int
- status: `active|archived`; archived_at; label "ditutup Mar 2026"
- low_balance_threshold: bigint, nullable (Rp100.000)
- last_reconciled_at
- created_at ("dibuat 12 Jan 2025")
- derived: transaction_count (214)

**Investment fields**
- asset_type: enum/text ("Reksa dana & SBN", "ETF AS", "Bitcoin", "Saham ID", "Emas")
- current_value
- cash_balance ("kas US$52")
- market_value_updated_at
- fx_rate_override ("Atur kurs USD")
- merge_into_investment_card: bool ("Gabung di kartu Investasi")
- RDN sub-label

**Credit card fields**
- issuer
- credit_limit (15.000.000)
- statement_day (20)
- due_day (5)
- current_bill (derived)
- deduct_bill_from_available: bool

**BalanceAdjustment** (reconciliation history)
- account_id, as_of (datetime)
- recorded_balance, actual_balance, diff
- mode: enum `expense_txn|missing_txn|silent_correction`
- category_id (nullable)
- transaction_id (nullable)

**SavingsAllocation** (from the "DIALOKASIKAN KE TABUNGAN" panel): account_id, goal_id, amount ("DP Rumah · Nominal tetap Rp5.000.000"; "Dana tidak rutin … Rp4.200.000"). Relates to Savings goals, handled by another section.

**FxRate**: currency, rate (16.350), source auto/manual, updated_at.

**CreditCardCycle** [INFERENCE]: period_start/end ("21 Sep – 20 Okt"), statement_date, due_date, amount, payment_status `lunas penuh|sebagian|minimum|belum bayar`.

## 5. Business rules & calculations
- **Available balance** = Σ balances of accounts with include_in_available (non-investment): bank 54.175.000 + e-wallet 498.000 + cash 350.000 = **Rp55.023.000** ✔. If the credit card toggle is on, the current credit card bill is also subtracted.
- **Free** = available − allocated to savings: 55.023.000 − 17.300.000 = 37.723.000. The design shows "Rp37.700.000", so it rounds to hundreds of thousands [INFERENCE]. Per account: BCA 42.810.000 − 5.000.000 − 4.200.000 = "Bebas dipakai Rp33.610.000" ✔.
- **Investments** = Σ platform values (converted to IDR): 45.420.000 + 5.500.000 + 4.300.000 + 3.700.000 + 2.500.000 = 61.420.000 ✔. Gotrade: US$2.778 × 16.350 = 45.420.300 → "≈ Rp45.420.000".
- **Total assets / net worth** = available + investments = **116.443.000** ✔. The comparison "+Rp4.220.000 sejak 30 Sep" requires month-end snapshots. In net worth, credit card bills are subtracted and the limit is not counted as an asset.
- **Account balance** = opening_balance + Σ transactions (in − out ± transfers) + Σ adjustments.
- **Reconciliation**: difference = actual − recorded (42.795.000 − 42.810.000 = −15.000). An account is flagged "Perlu disesuaikan" (needs adjusting) if not checked for **> 14 days** (OVO 34 days, Dompet 21 days). Bulk adjustment: −14.500 + −38.000 = "total −Rp52.500" ✔.
- **Low balance**: balance < threshold. Estimate "cukup ±7 minggu lagi" (enough for ±7 more weeks) = balance ÷ average spend (86.000 ÷ 50.000/month ≈ 1,7 months ≈ 7 weeks).
- **Card display limit**: at most 3 accounts with show_as_card. Other accounts are collapsed into "3 lainnya" (3 others).
- **Archive**: transactions still appear in reports. Delete permanently also deletes its transactions. If the default account is archived, the user must pick a new default.
- **Edit**: currency and opening balance are locked once the account has transactions [INFERENCE: always locked].
- **Credit card** (text "CARA WRITE.FINANCIAL MENGHITUNG" (how write.financial calculates)):
  - Card purchases are recorded as expenses on the transaction date and immediately reduce the budget.
  - Usage is automatically recorded as debt in Debts & installments.
  - Paying the bill is recorded as a **transfer** to avoid double counting.
  - Healthy utilization ≤ 30%.
  - Payment reminder D-3 (2 Nov for a 5 Nov due date).
  - The cycle runs from statement_day+1 to statement_day (21 Sep–20 Oct).
  - Option "Ubah transaksi jadi cicilan" (convert transaction to installments) for transactions ≥ Rp500.000.
- **Investment value**: return percentages "+15,2% sejak beli" (since purchase) and "+18,4%" for 6 months. BCA 6-month chart "+12,1%". Monthly in/out flows: In +24,7jt, Out −14jt, Transfer out −9,5jt.

## 6. Background jobs/scheduler & integrations
- **Market value & exchange rate refresh**: "Kurs USD otomatis · Kurs acuan Rp16.350" and "memperbarui 2 / 5…" imply a per-platform job (ETF/stock/gold/crypto prices) plus a daily exchange rate job [INFERENCE: price source not yet decided].
- **Net worth snapshot** at month end ("sejak 30 Sep") and monthly balances for the 6-month chart.
- **"Needs adjusting" check** (>14 days) and **low balance** check, including notifications [INFERENCE: notifications not explicitly shown, only badges].
- **Credit card cycle**: statement date job (20th), D-3 payment reminder ("notifikasi & muncul di Halaman berikutnya"), and payment confirmation on the due date.
- No bank integration. Provider logos are "ditemukan otomatis" (found automatically) from a logo catalog (static or an external service) [INFERENCE].

## 7. UI components
Sidebar + topbar (Cari ⌘K, Tanya Asisten ⌘J), KPI cards, grouped account list with subtotals, right detail panel, sparkline/area chart ("Sumbu dimulai dari Rp…" (axis starts at Rp…)), toggle rows, dialog/modal forms, account-type segmented control, money input with "Rp/US$" prefix, date picker, color swatches + hex picker, logo uploader, card preview, ⋮ menu, "⋮⋮" drag handle, Aktif/Diarsipkan tabs, "default" badge, skeleton, error banner with code, empty state, cycle timeline.

## 8. Open questions
- The form's type options are only Bank/E-Wallet/Cash/Credit card, yet there is an "Add: Investment" screen. How is Investment selected?
- Rounding "bebas Rp37.700.000" vs the computed 37.723.000: what is the rounding rule?
- Archived Jenius shows "•• 4821", same as BCA. Likely swapped dummy data.
- Difference between "Hitung dalam total saldo" vs "Hitung dalam saldo tersedia" vs "kekayaan bersih": is this 1 flag or 2?
- "Investasi tidak dihitung" (investments not counted) in the Gotrade panel: does it mean not counted in the available balance?
- Does "Atur kurs USD" (manual) override the automatic exchange rate, and is it per account or global?
- Delete permanently: is a soft-delete/grace period needed?
- First adjustment at account creation: is opening_balance = an adjustment?

---

# B. Budget (Section 06 [M9Yf5])

## 1. Summary & user goal
The user sets monthly limits per category, grouped into **Needs** and **Wants**. The user tracks spending pace against "ideal hari ini" (ideal for today) and the safe daily limit, then covers overspent categories by moving leftovers from other categories. A budget applies every month until changed (versioned by "berlaku mulai" (effective from)), closed months are read-only, and there are Sinking funds ("Dana tidak rutin") for annual expenses.

## 2. Screens & states
| Screen | Node id | Content/purpose | State |
|---|---|---|---|
| Budget (page) | E86u2e | Remaining hero, Safe daily limit, Projection, Over limit, Needs & Wants, list of 10 categories, "Perlu perhatian" (needs attention) panel, sinking funds | default |
| No notes (wide list) | pyk2Z | Layout without right panel | variant |
| September (closed) | Z8qibf | "Hanya baca · bulan sudah ditutup" (read-only · month closed), results, September notes | read-only |
| Set budget | F0xibH | Sheet to set per-category limits, "Isi dari rata-rata 3 bulan" (fill from 3-month average) | sheet |
| Change history | Cb4oT | Timeline of total versions per month | sheet |
| Needs tab | p4FGEL | Group filter | tab |
| Sort | KHy8x | Lewat batas dulu / Sisa terbanyak / Nama A–Z / Urutan sendiri / Kelompokkan | dropdown |
| Category ⋮ menu | WdceE | Ubah batas, Pindahkan sisa ke…, Lihat detail, Bawa sisa ke bulan depan, Anggaran tetap, Ingatkan di 85%, Hapus | menu |
| Inline limit edit | U4jwnw | Inline edit, "↵ simpan · Esc batal", impact on total | inline edit |
| Category detail | IACml | Makan & Dapur: daily chart, 3 months, transactions | panel/sheet |
| Add budget category | I7KGD | Search categories without a budget, "Buat kategori baru" (create new category) | popover |
| Move leftover | FgYBA | Cover the Belanja Online shortfall | dialog |
| Leftover moved | wV9IH | Toast "Urungkan" (undo) | success/toast |
| Warning dismissed | NpMMC | "1 diabaikan sampai akhir bulan · Tampilkan" (1 dismissed until month end · show) | panel state |
| New sinking fund | j6G7bA | Sinking fund form | dialog |
| Fund detail: Liburan Bali | McGzv | Progress, contribution history | panel |
| 85% warning toast | o2VZw4 | "Hiburan sudah 86%" | toast |
| Skeleton / Refreshing / Failed | tb5ji / c5qKe / a1IpXc | "500 · GET /budgets/2026-10" | loading/error |

(No dedicated empty screen in this section.)

## 3. User flows
- **Header → September closed → set budget → history**: navigate to the previous, read-only month ("ditutup 30 Sep, sisa dipindah ke tabungan", "Sisa dipindah ke Dana Darurat" (leftover moved to savings / Emergency Fund)). On Set budget, the user enters per-category limits, can use "Isi dari rata-rata 3 bulan", then saves ("1 perubahan · berlaku mulai Oktober 2026"). In History, changes can be filtered by "Semua kategori" (all categories).
- **Category list → tab → sort → ⋮ menu → change limit → detail → add category**: inline limit edit shows "−Rp200.000 → total Rp18.550.000". Add budget category picks from categories without a budget (e.g. "Biaya platform Rp22.660 bulan ini") or creates a new category.
- **Right card → move leftover → moved → dismiss**: the "Pindahkan Rp400.000" CTA opens a dialog with pre-filled sources (Hobi 300.000, Perawatan Diri 100.000) → save → toast with Undo. "Abaikan" (dismiss) hides the warning until month end.
- **New sinking fund → fund detail**: enter name, target, due date, and "Sudah terkumpul" (already collected) → monthly amount is computed → toggle "Sisihkan tiap gajian" (set aside every payday) (the contribution enters the Review queue every 25th, then is recorded as a transfer to Bank Jago once confirmed).
- **Budget warning**: a new transaction crossing 85% triggers a toast.

## 4. Data entities & fields
**BudgetPlan / BudgetVersion**
- user_id
- effective_from_month (YYYY-MM)
- created_at
- expected_income (Rp26.000.000; "pemasukan")
- derived total

**BudgetLine**
- version_id
- category_id
- group: enum `kebutuhan|keinginan` [INFERENCE: a category property, not a line property]
- limit_amount: bigint
- rollover: bool ("Bawa sisa ke bulan depan")
- fixed: bool ("Anggaran tetap"; e.g. Sewa Kos "lunas 1 Okt")
- alert_threshold_pct (85)
- sort_order

**BudgetChangeLog**
- category_id
- old → new amount
- delta
- effective_month
- changed_at (e.g. "15 Okt · 14.32")
- type: `create|update|new_category`

**BudgetMonth (period)**
- month
- status: `open|closed`
- closed_at
- leftover_amount
- leftover_destination (goal/Dana Darurat)

**BudgetTransfer** (move leftover)
- month
- from_category, to_category
- amount
- created_at
- undoable

**AlertDismissal**: category_id, month, dismissed_until (month end).

**Category** (owned by the Transactions module): name, group (Kebutuhan/Keinginan/Biaya keuangan…), parent ("Biaya keuangan → Admin bulanan").

**SinkingFund (Sinking funds)**
- name
- target_amount
- due_month
- collected_amount
- monthly_amount (derived)
- schedule_day (25 / "tiap gajian")
- needs_confirmation: bool
- storage_account_id (Bank Jago)
- source_account (BCA)
- contributions[]: date, amount, status scheduled/confirmed, type "Setoran awal"/"Transfer terjadwal"

Relates to Savings goals/accounts.

## 5. Business rules & calculations
- **% used** = spent ÷ limit: 16.500.000 ÷ 18.750.000 = **88%** ✔. **Remaining** = 2.250.000.
- **Ideal on day N** = N ÷ days in month: 15/31 = **48%** ✔ (shown as "garis putih = posisi ideal hari ini" (white line = today's ideal position)). Status "Lebih cepat dari rencana" (ahead of plan) appears when % used > ideal.
- **Safe daily limit** = remaining ÷ days left: 2.250.000 ÷ 16 = 140.625 → "Rp140.000". Per category: Makan 300.000/16 = 18.750 → "Rp19.000"; Transportasi 600.000/16 = 37.500 → "Rp38.000"; Hiburan 400.000/16 = "Rp25.000". Rounding is inconsistent (see §8).
- **Days left** are counted to month end ("÷ 16 hari"), while the subtitle says "16 hari lagi menuju gajian berikutnya" (16 days until next payday). For October both happen to match.
- **Month-end projection**: "Rp24.200.000 · lewat Rp5.400.000" (24,2 − 18,75 ≈ 5,45). This does not match linear extrapolation 16,5jt ÷ 15 × 31 = 34,1jt. Likely separates fixed costs (Sewa paid) from variable [INFERENCE]. Makan & Dapur: projection 6.400.000 (linear = 6,61jt).
- **Groups**: Needs 10.400.000/12.000.000 = 87%, Wants 6.100.000/6.750.000 = 90%. Total 18.750.000 = 12.000.000 + 6.750.000 ✔.
- **Over limit**: Belanja Online 2.400.000/2.000.000 = 120% → "lewat Rp400.000". A predictive warning "akan lewat Rp566.000" (will exceed by Rp566.000) also exists.
- **Move leftover**: the budget total stays the same ("Total anggaran tetap Rp18.750.000"). The target limit increases (2.000.000 → 2.400.000), source limits decrease (Hobi 700.000 → remaining 0; Perawatan Diri 250.000 → 150.000). Suggested sources come from categories with the largest remaining [INFERENCE].
- **85% warning**: toast when spent ≥ threshold ("Hiburan sudah 86% … Sisa Rp350.000 untuk 16 hari (Rp22.000/hari)": 350.000/16 = 21.875 → 22.000).
- **Set budget**: Allocated 18.950.000; Remaining income = 26.000.000 − 18.950.000 = **7.050.000** ✔. Suggestions come from the per-category "rata-rata 3 bulan" (3-month average).
- **Versions**: changes are "berlaku mulai <bulan>" (effective from <month>) and "berlaku sampai diubah lagi" (valid until changed again). Next month (Nov) is marked "otomatis", inheriting the latest version. Totals per month: Jul 18,3jt, Aug 18,0jt, Sep 18,75jt, Oct 18,95jt.
- **Month close**: a finished month becomes read-only and its leftover moves to savings (Sep: leftover 1.150.000 → Dana Darurat). Spending without a budget is still reported ("+Rp700.000 tanpa anggaran"). Comparison "vs Agustus +8,3%".
- **Rollover** per category ("Bawa sisa ke bulan depan"): adds to the next month's limit [INFERENCE].
- **Sinking funds**: monthly = (target − collected) ÷ months until due. Example: 1.500.000 ÷ 6 (Nov–Apr) = **250.000** ✔; total sinking funds 1.150.000 → 1.400.000. Liburan Bali: shortfall 8.000.000 − 2.800.000 = 5.200.000; 5.200.000 ÷ 6 contributions ≈ **867.000** ✔ (progress 35%). If the target increases, contributions are recalculated ("naik jadi Rp867.000 mulai Okt karena target dinaikkan").
- The trend "−7,3% / 3 bulan" and insights such as "62% pengeluaran Hiburan terjadi di akhir pekan" and "Stok dapur … menyumbang 74%" are derived analytics.

## 6. Background jobs/scheduler & integrations
- **Month close** (month end, 30 Sep): lock the period, compute results, move leftover to savings, apply rollover, create the new period from the latest version ("Nov · otomatis"), and reset warning dismissals.
- **Threshold warning** (85%) triggered by an event after a transaction is recorded, then toast/notification.
- **Scheduled sinking fund contributions** every 25th/payday: create an item in the Review queue, then record the transfer once confirmed.
- **Monthly notes/insights** ("Catatan September") for the period recap [INFERENCE: generated by a job or the Assistant].
- Per-category 3-month averages can be computed on demand or cached.

## 7. UI components
Progress bar with ideal marker (white line), KPI cards, category list with bars + remaining/daily labels, Semua/Kebutuhan/Keinginan tabs, sort dropdown, ⋮ menu, inline number edit with keyboard hints, side sheets (Set, History), change timeline, daily bar chart with limit line, 3-month mini chart, move-leftover dialog (multi-source input + HASIL summary), toast + Undo, "Perlu perhatian" panel with CTAs, sinking fund form with month chips, "Hanya baca" badge, skeleton, error banner.

## 8. Open questions
- Header total **18.750.000** vs Set budget/History **18.950.000** "berlaku mulai Oktober 2026". Do mid-month changes apply immediately to the current month?
- Set budget shows Needs "Rp12.200.000", while the main page shows Rp12.000.000 (effect of the Makan change 3,5 → 3,7jt).
- Month-end projection formula is unclear (24,2jt).
- Daily limit rounding: floor to thousands (140.000) or round (19.000/38.000)?
- Are days left counted to month end or to next payday (payday-based budget period)?
- Is "sisa dipindah ke Dana Darurat" automatic or user-confirmed? How does it interact with per-category rollover?
- The "Biaya keuangan" group appears in Add category, so groups are not only Needs/Wants.
- "Anggaran tetap" (fixed budget) menu: what exactly does it mean (limit = fixed bill, no daily pace?)
- Does a budget transfer (move leftover) apply only to this month or change the version?

---

# C. Subscriptions (Section 07 [CjvCu])

## 1. Summary & user goal
The user records subscriptions and recurring bills (monthly/yearly/weekly, IDR/USD). The system shows this month's billing schedule, reminds before charges, and checks whether the paying account has enough balance. On the due date, the charge enters the **Review queue** and the balance is only deducted once the user marks it as paid. There is also recurring-charge detection from transactions, monthly usage review, pause, and cancel.

## 2. Screens & states
| Screen | Node id | Content/purpose | State |
|---|---|---|---|
| Subscriptions (page) | CZmJm | KPIs Per bulan/Per tahun/Sisa tagihan Okt, 6-month chart, October schedule timeline, table, Monthly review, Bisa dihemat (could save), By category | default |
| Detection from transactions | DIcp7 | 2 candidates (Vidio, Google One), Tambahkan/Bukan langganan/Tambah semua | popover/panel |
| Add subscription | sN6Eh | Form | dialog |
| Charge tooltip | OWkue | Netflix: from account, balance after, reminder, status | hover |
| Add: USD → Pay from | yuefQ | Account dropdown grouped into MATA UANG SAMA (same currency) / DIKONVERSI SAAT DITAGIH (converted when charged) | dropdown |
| Paused tab | k1FvrG | Headspace, "Lanjut 1 Des 2026" (resumes 1 Dec 2026), savings | tab |
| Cancelled tab | W9vmme | 3 cancelled, total saved | tab |
| ⋮ menu | WaS25 | Edit, Tandai sudah dibayar, Ganti rekening, Riwayat tagihan, Jeda, Batalkan | menu |
| Change account | x5B5f | Account submenu + shortfall warning | submenu |
| Detail: ChatGPT | UONDi | Total paid, price increase, usage rating, charge history | panel |
| Edit: ChatGPT | JZBFF | Form + "Harga naik dari tagihan lalu" (price up from last charge) | dialog |
| Pause: Netflix | QO7La | Choose duration, reminder before reactivation | dialog |
| Cancel: YouTube | VtfuA | Stop after the charge / now | dialog |
| Review answered | u8sjx | "6 / 6 dinilai", "Pertimbangkan berhenti" (consider stopping) | card state |
| Hiburan category filter | UZLdT | "3 langganan Hiburan · 37% … Rp331.900/bulan" | filter |
| D-1 reminder | C861Ys | Banner "Besok: Netflix Rp186.000 … Mau dijeda dulu?" (tomorrow … pause it first?) | notification |
| Unconfirmed charge | Lu10H | iCloud+ past 9 Oct: "Ya, catat / Belum ditagih" (yes, record / not charged yet) | warning |
| Insufficient balance | IFaSb | OVO short by Rp243.000, "Top-up dari BCA" / "Kembali ke Jago" | warning |
| Skeleton / Refreshing / Failed | M5E6R / E68KO1 / BEzz9 | "500 · GET /subscriptions", "Pengingat Netflix 18 Okt tetap akan dikirim" (Netflix reminder for 18 Oct will still be sent) | loading/error |
| Empty | Jo4sL | "Deteksi otomatis aktif setelah 2 bulan transaksi tercatat" (auto-detection activates after 2 months of recorded transactions) | empty |

## 3. User flows
- **Header & schedule → detection → add → tooltip → USD & pay from**:
  - Detection: user reviews candidates (name, "tiap ±tgl 12" (around the 12th each month), last date, amount, account, category) → Tambahkan (add) or Bukan langganan (not a subscription). Impact is shown: "Jika ditambahkan: Rp970.800/bulan (+Rp65.900)".
  - Add: name (free text + logo) → price + currency → cycle + next billing date ("Sen, 2 Nov 2026") → Pay from → category (Needs/Wants) → description → reminder ("3 hari sebelumnya · notifikasi") → toggle "Masa uji coba gratis" (free trial) ("Tagihan pertama setelah uji coba berakhir" (first charge after trial ends)).
  - USD: USD accounts appear under "MATA UANG SAMA". IDR accounts show "DIKONVERSI SAAT DITAGIH ≈ Rp163.500 per tagihan · kurs Rp16.350", and "Nominal rupiah dikonfirmasi di Perlu ditinjau" (rupiah amount confirmed in the Review queue).
- **Table → paused → cancelled → ⋮ menu → change account → detail → edit → pause → cancel**:
  - Pause: options 1 month (reactivates 18 Nov, −Rp186.000), 2 months, or a custom date, plus a reminder 3 days before reactivation (15 Nov). Note: "Jeda juga di aplikasi Netflix — write.financial hanya mencatat." (also pause in the Netflix app — write.financial only records).
  - Cancel: "Berhenti setelah tagihan 22 Okt" (stop after the 22 Oct charge; the charge still enters the Review queue) or "Berhenti sekarang" (stop now; the charge is removed from the schedule), plus a checkbox "Sudah dibatalkan di aplikasi YouTube" (already cancelled in the YouTube app). Cancelled subscriptions can be reactivated from the ⋮ menu.
  - Change account: "Berlaku mulai tagihan 28 Okt" (effective from the 28 Oct charge) and flags accounts with insufficient balance.
- **Cards & warnings → review answered → category filter → D-1 reminder → unconfirmed → insufficient balance**:
  - Monthly review: "Seberapa sering kamu pakai YouTube Premium?" (how often do you use YouTube Premium?) with ratings Sering/Kadang/Jarang/Belum dinilai (often/sometimes/rarely/not rated). A "Jarang" result surfaces the suggestion "Pertimbangkan berhenti … Rp708.000/tahun" → Batalkan… / Tanya lagi bulan depan (ask again next month).
  - Past-due charges not yet recorded: "Ya, catat" or "Belum ditagih".
- **Loading / failed / empty**.

## 4. Data entities & fields
**Subscription**
- id, user_id
- name ("Netflix")
- plan ("Premium 4K", "Family · 4 akun")
- logo/icon
- price: bigint minor
- currency (IDR/USD)
- cycle: enum `weekly|monthly|yearly`
- next_billing_date
- pay_from_account_id
- category_id (Hiburan/Produktivitas/Kesehatan/Penyimpanan/Transportasi)
- group (Kebutuhan/Keinginan)
- description
- reminder_days_before (3; the tooltip example shows "H-1" for Netflix, so it is configurable per subscription)
- reminder_channel (notification)
- trial: bool + trial_end_date [INFERENCE]
- status: enum `active|paused|cancelled`
- paused_since, resume_date, resume_reminder: bool
- cancelled_at/ends_at, cancel_mode `after_next|now`, replaced_by ("diganti Spotify")
- started_at ("aktif sejak Mar 2025")
- usage_rating: enum `sering|kadang|jarang|null` + rated_at + next_ask_at ("ditanya lagi 1 Nov")

**SubscriptionCharge (charge)**
- subscription_id
- due_date
- amount_expected
- currency
- fx_rate
- amount_idr_confirmed
- status: enum `scheduled|due_review|paid|unconfirmed|skipped`
- account_id
- transaction_id (after confirmation)
- confirmed_at

Schedule statuses: "Akan ditagih · Sudah dibayar · Belum dikonfirmasi" (will be charged · paid · unconfirmed).

**PriceChange**: old 299.000 → new 329.000, from_charge (Sep), reason (USD exchange rate).

**DetectedRecurring**: merchant, day_of_month (±12), last_date, amount, account, category, occurrences (3×), status `new|added|dismissed`.

Relations: Account (payer), Transaction (result of confirmation in the Review queue), Category, Calendar events.

## 5. Business rules & calculations
- **Per month** = Σ prices of active monthly subscriptions: 186.000 + 86.900 + 59.000 + 329.000 + 199.000 + 45.000 = **904.900** ✔. Yearly ones are separate ("Rp904.900/bulan + Rp660.900/tahun"). Niagahoster 660.900/12 = 55.075 ✔ as the monthly equivalent.
- **Per year** = 904.900 × 12 + 660.900 = 11.519.700 → "Rp11.520.000" ✔. "≈ 44% pemasukan sebulan" (of one month's income) = 11,52jt ÷ 26jt ✔. "5,5% dari pengeluaran" (of spending) = 904.900 ÷ 16.500.000 ✔.
- **Remaining charges this month** = Σ scheduled charges until month end: 186.000 + 86.900 + 59.000 + 329.000 = **660.900** (4 charges, 18–28 Oct) ✔. If Netflix is paused: 660.900 − 186.000 = **474.900** ✔.
- **Detection**: +39.000 + 26.900 = +65.900 → 970.800 ✔. Detection activates only after 2 months of data. Candidate criteria: charged ≥3× on similar dates ("tiap ±tgl 12").
- **USD conversion**: US$10 × 16.350 = Rp163.500 (estimate); the final amount is confirmed in the Review queue.
- **Balance after** = account balance − charge (Netflix tooltip: "Saldo setelah Rp42.624.000" = 42.810.000 − 186.000 ✔). Insufficient: OVO 86.000 vs 329.000 → "kurang Rp243.000" ✔. Top-up suggestion "Rp244.000" [INFERENCE: rounded/with buffer].
- **Savings** when paused/cancelled = price × months not charged: Headspace 70.000 × 2 = 140.000; Canva 95.000 × 7 = 665.000; Apple Music 55.000 × 6 = 330.000; Gojek Plus 25.000 × 8 = 200.000; total **1.195.000** ✔.
- **Price increase** is detected by comparing with the last charge: +30.000 (+10%).
- **Could save** "≤ Rp708.000/tahun" = YouTube 59.000 × 12, based on the "Jarang" rating and "Fungsi dobel: musik" (duplicate function: music) (Spotify Family). write.financial does not read activity from other apps.
- **By category**: Hiburan 331.900/904.900 = 37% (filter). The By category card says "34%", likely because the denominator includes yearly ones (see §8).
- **Confirmation**: the transaction and balance deduction are created only after the user "Tandai sudah dibayar" (mark as paid)/confirms in the Review queue. Past-due charges without confirmation have status "belum dikonfirmasi" (iCloud+ 9 Oct).
- Active subscriptions also reduce the **safe daily limit** (empty state text "memasukkannya ke batas aman harian" (includes them in the safe daily limit)).

## 6. Background jobs/scheduler & integrations
- **D-N reminder** before a charge (default 3 days, Netflix D-1 on 17 Oct). Still runs even if the UI fails ("Pengingat Netflix 18 Okt tetap akan dikirim").
- **Due date**: create a SubscriptionCharge `due_review` in the Review queue, then advance next_billing_date per the cycle.
- **Past-due without confirmation**: mark `unconfirmed` and show a warning.
- **Balance sufficiency check** of the paying account before the due date (runs after balance changes or daily).
- **Trial end** → first charge.
- **Pause end**: reminder 3 days before reactivation, then auto-reactivates on resume_date.
- **Cancel after_next**: change status after the last charge.
- **Recurring detection** from transactions (daily/weekly batch).
- **Monthly review** on the 1st ("Dinilai 1 Okt · ditanya lagi 1 Nov").
- **USD exchange rate** for estimates (uses the same exchange rate job as Accounts).

## 7. UI components
KPI cards, 6-month bar chart with annotations ("+ Spotify", "ChatGPT naik"), monthly schedule timeline with letter avatars + "Hari ini" marker + status legend, subscriptions table (Layanan/Tagihan berikutnya/Rekening/Pemakaian/Harga), Aktif/Dijeda/Dibatalkan tabs, tooltip, ⋮ menu + account submenu, dialog form (cycle segmented control, multi-currency price input, trial toggle, reminder select), grouped account dropdown, review card (rating chips), "Bisa dihemat" insight card, donut/bar by category, warning banners (D-1, unconfirmed, insufficient balance), skeleton, error, empty state.

## 8. Open questions
- Header "6 aktif" vs tab "Aktif 7" and "Total 7 langganan aktif" (is Niagahoster yearly counted separately?). Review shows "6 / 7 dinilai".
- Spotify Rp86.900 (table) vs 87.000 (schedule/calendar), and Google One 26.900 vs "Rp27.000": display rounding?
- Hiburan percentage 34% vs 37%: what is the denominator?
- Headspace "Tahunan dibayar bulanan" (yearly billed monthly): does it need a special cycle/type?
- ChatGPT detail "Rp3.950.000/tahun" = 329.000 × 12 = 3.948.000 ✔, but the table account is Bank Jago while the balance warning mentions OVO. A change-account scenario?
- For paid yearly cycles, is the budget charged all at once or amortized?
- Scope of "tagihan rutin" (recurring bills; Sewa Kos every 1st appears in the Calendar as "Tagihan rutin"): is rent stored as a Subscription or as a recurring transaction?
- Trial: the trial end date field is not explicitly visible.

---

# D. Calendar (Section 08 [plVAA])

## 1. Summary & user goal
The Calendar is a view of "Pengeluaran harian, pemasukan, dan tagihan terjadwal dalam satu tampilan" (daily spending, income, and scheduled bills in one view) with Week/Month/Year modes. It contains a daily spending heatmap, weekly totals (M1–M6), scheduled events (subscriptions, payday, sinking fund/savings contributions), and projections for upcoming months. The user can open a day's breakdown or record a transaction directly on a given date.

## 2. Screens & states
| Screen | Node id | Content/purpose | State |
|---|---|---|---|
| Calendar (Month) | zEWoe | KPIs (Daily average, Most expensive day, Frugal days, Weekend), month grid + Weekly total column, month summary, 11 Oct detail, Pattern by weekday | default |
| Calendar (Week) | qYzQD | 12–18 Oct: spent this week, income, scheduled, safe limit for rest of week, per-day columns with hourly transactions, composition | default |
| Calendar (Year) | Ncucu | 12 months with mini heatmaps, year KPIs, Monthly trend + % saved | default |
| Month picker | BLMk2 | 12-month picker + spending (jt), presets Bulan ini/Bulan lalu/Rentang khusus | popover |
| 1 Oct detail (payday) | sYRh0 | 4 transactions, surplus +13.650.000 | panel |
| 18 Oct detail (scheduled) | V0mbHr | Scheduled Netflix charge, "Buka di Langganan" (open in Subscriptions) | panel |
| Record on this date | q3o9L | Transaction form with date pre-filled to 11 Oct | dialog |
| Date tooltip | aXUNE | 9 Oct: 0,85× average, Needs/Wants split, largest | hover |
| Hide income | Z0Mxk | Expenses only | filter |
| November (upcoming) | z6baj | Schedule & projection, 9 bills, estimated payday | future |
| Week: select day | oELDK | Selected day in week mode | selected |
| Year: hover month | cQI15 | Month tooltip | hover |
| Skeleton Month/Week/Year | CQlVn / e7PlO / F8HnZ | "Memuat kalender…" | loading |
| Refreshing (month change) | C1zLi | "Memuat data November 2026…" | loading |
| Failed to load | tFQbo | "504 · GET /calendar/2026-10", CTA "Buka Transaksi" | error |
| Empty | oYpYJ | "Kalender masih kosong", Catat transaksi / Tambah langganan | empty |

## 3. User flows
- **Month → Week → Year**: switch mode. In Year mode, clicking a month opens the month view.
- **Navigation & day detail**: pick a month via the picker. Click 1 Oct (payday) → transaction breakdown with source account, time, tags, and the recurring item "Sewa Kos — Oktober · tiap tgl 1 · perlu konfirmasi" (every 1st · needs confirmation). Click 18 Oct (future) → scheduled charge + "Belum ada transaksi — pengeluaran baru tercatat saat kamu mencatatnya" (no transactions yet — spending is recorded only when you record it). From the 11 Oct detail, choose "Catat di tanggal ini" → Record Transaction sheet with "Tanggal terisi dari kalender · 11 Okt 2026, 12.00" (date filled from calendar) and context "11 Okt sudah 5 transaksi (Rp3.380.000)". Hovering a date shows a tooltip.
- **Filter & period**: legend toggles (Kebutuhan/Keinginan, Pemasukan, Setoran tabungan) to hide income. November shows a projection ("Perkiraan dari pola Okt" (estimated from the Oct pattern)). In Week mode the user selects a day; in Year mode hovers a month.
- **Loading / failed / empty**.

## 4. Data entities & fields
The Calendar is a **read model/aggregation** with no entities of its own:
- **DayCell**: date, total_expense, total_income, net (surplus), needs/wants split, intensity bucket (Sedikit→Banyak (few→many)), tx_count, largest_merchant, ratio_vs_avg, is_weekend, scheduled_events[].
- **WeekRow**: M1..M6, expense, net, scheduled_amount ("+186.000 terjadwal").
- **ScheduledEvent** (union):
  - SubscriptionCharge ("Netflix 186.000", "pengingat 17 Okt")
  - RecurringTransaction/recurring bill (Sewa Kos every 1st, needs confirmation)
  - Recurring income (Gaji — PT Kinarya, "diperkirakan Rp18.500.000" (estimated), BCA)
  - Transfer/contribution ("Bibit ↔ 3.000.000", "Dana tdk rutin" on the 25th, "ORI026 +7.900" coupon)
  - Credit card bill [INFERENCE]
  
  Fields: date, title, amount, kind enum `bill|income|transfer|savings|coupon`, status `scheduled|confirmed|unconfirmed`, source_id.
- **MonthSummary**: Spent so far, Income, Scheduled for rest of month, Safe daily limit, daily average, most expensive day, frugal days (< Rp300.000), weekend ratio.
- **YearSummary**: spent/income/saved, % saved per month, most expensive month + major event ("Lebaran · 18 Mar · Rp6.200.000 · tiket mudik"), surplus months.
- Transaction (from the Transactions module): date+time, merchant, category, account, tags ("#gadget · kerja"), note, receipt photo, "Ulangi setiap bulan" (repeat every month).

## 5. Business rules & calculations
- **Daily average** = spent ÷ elapsed days: 16.500.000 ÷ 15 = **1.100.000** ✔.
- **Most expensive day**: 11 Oct 3.380.000 → "3× rata-rata" (3,07). Tooltip 9 Oct 940.000/1.100.000 = **0,85×** ✔.
- **Frugal days** = number of days with spending < Rp300.000 ("3 hari").
- **Weekend** = Sat–Sun average ÷ Mon–Fri average = "2,8×" (Rp1.550.000/weekend day). Pattern by weekday: average per weekday (Mon 860.000 … Sun 1.900.000).
- **Day surplus** = income − spending: 1 Oct 18.500.000 − 4.500.000 − 250.000 − 100.000 = **+13.650.000** ✔.
- **Weekly totals**: M1 spent 6.360.000 / net +12.100.000; M3 spent 1.650.000 + "+186.000 terjadwal".
- **Scheduled for rest of month** = 660.900 (same as Subscriptions). Safe daily limit 140.000 (from Budget).
- **Week mode**: "Batas aman sisa minggu" (safe limit for rest of week) = 140.000 × 3 days = **420.000** ✔. "vs Sen–Kam lalu −26%" compares 1.650.000 with 5–8 Oct 2.410.000 (≈ −31,5%; mismatch, see §8). Transactions in day columns are sorted by time. Transfers (Ke Bibit RDPU Rp3.000.000) are separated from spending.
- **Year mode**: Saved = income − spent = 262.500.000 − 187.700.000 = **74.800.000** ✔; 74,8 ÷ 262,5 = **28,5%** ✔. Average 187,7jt ÷ 10 ≈ 18,8jt/month ✔. Green = surplus month.
- **Upcoming months**: show schedule + projection ("Masuk (proyeksi) +Rp18.500.000", "9 tagihan · Rp5.400.000 + transfer Rp3.870.000"). 1 Nov net = 18.500.000 − 4.500.000 = +14.000.000 ✔. Income projection is based on the Oct pattern. Bills are still shown even if the Nov budget isn't set ("atur anggaran dulu" (set budget first)).
- Spending is recorded only after the user records or confirms it. Scheduled events do not affect balances.
- Record form: max 5 tags, quick amounts +10.000/+50.000/+100.000/+500.000, default time 12.00 when created from the calendar.

## 6. Background jobs/scheduler & integrations
The Calendar has no jobs of its own. It reads schedules produced by other modules:
- materialization of subscription charges, recurring transactions (Sewa, Gaji), and sinking fund/savings contributions for N months ahead [INFERENCE: or computed on the fly from RRULE rules];
- **payday projection** from last month's pattern.

Daily/monthly/yearly aggregates can be cached (materialized view or Redis) and invalidated when transactions change [INFERENCE].

## 7. UI components
Minggu/Bulan/Tahun segmented control, month picker popover with presets, heatmap calendar grid + weekly total column, filter legend (category toggles), scheduled event chips in cells, day tooltip, day detail panel (category summary + transaction list + CTA), per-day week columns, mini month heatmaps (year mode), income vs spending trend chart + % saved, weekday pattern bars, KPI cards, Record Transaction form (component shared with Transactions), per-mode skeletons, error, empty state.

## 8. Open questions
- "rata-rata Rp448.000" for 4 days totaling 1.650.000 (should be 412.500), and "−26%" vs the computed −31,5%: which formula?
- The month picker shows Oct "16,5" (jt) as running spending, while Year mode shows October as "berjalan" (in progress) without a number.
- The week starts on Monday (header "Sen … Min"): is it configurable?
- Which events must appear: credit card (statement/due), debt installments, savings contributions? The legend mentions "Setoran tabungan". Day "25 · Dana tdk rutin" exists but with amount "Rp0" for M4.
- "+146.000 terjadwal" in M4 = Spotify 87.000 + YouTube 59.000 ✔. The sinking fund on the 25th is not counted; is it because it's treated as a transfer?
- "Ulangi setiap bulan" in the Record form: does it create a recurring transaction, the same as "Tagihan rutin"?
- Time zone and day boundary (WIB) for daily aggregation.
