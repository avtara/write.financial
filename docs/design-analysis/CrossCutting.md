# CrossCutting: Data source, Components, Light mode, Privacy mode

Sources: `/tmp/digest/00-sumber-data.md`, `01-komponen.md`, `11-mode-terang.md`, `12-mode-privasi.md`. The full text of the accessibility guide was taken from `design/html/01-komponen.html` (node `LSwUS`) because it was truncated in the digest.

---

## A. Section 00 — Data source [d7VC0]

### 1. Summary & user goal
This is not a product screen. The section is the "source of truth" sheet for the sample dataset for the period **1–15 October 2026** belonging to user "Avtara K.". It contains summaries of income/expenses, budget, accounts, savings history, goals, recurring contributions, and holdings. Every other screen derives its numbers from here, so this section serves as the **reference for seed data and test fixtures**.

### 2. Screens & states
| Name | Node | Content | State |
|---|---|---|---|
| Oktober 1–15 · ringkasan | e5iLf | Income, expenses, saved, saving rate, transaction count | default |
| Anggaran Oktober · batas Rp18,75jt | dAY7U | Limit and spent per category | default |
| Rekening · saldo & arus Oktober | mSYon | Balance, flow, and delta per account; total assets | default |
| Ditabung per bulan | SQz2o | May–Oct: savings + investments | default |
| Tujuan tabungan · sekarang (30 Sep) | S2WKf | 6 active goals + 1 completed | default |
| Setoran rutin & investasi | clKag | Contribution schedule, holdings, Netflix | default |

### 3. User flows
No flows. The content is reference data.

### 4. Data entities & fields
See the **Seed data** section below. Implied entities: `Transaction` (type income/expense/transfer, date+time, account, category, status "diproses" (processing)), `Account`, `Category` (+Needs/Wants group, budget), `Goal` (+mixed funding sources: accounts and % portions of holdings), `RecurringDeposit` (day, source → destination, amount), `Holding` (units, USD price, platform), `Subscription`.

### 5. Business rules & calculations (consistency check)
| Formula | Evidence | Status |
|---|---|---|
| Income = Σ | 18,5 + 6,2 + 1,09 + 0,21 = **26,0 jt** | ✓ |
| Saved = income − expenses | 26,0 − 16,5 = **9,5 jt** = Gotrade 6,0 + Jago 0,5 + RDPU 3,0 | ✓ |
| Saving rate = saved / income | 9,5/26 = **36,5%**; Sep: 7,5/25,8 = 29,1% | ✓ |
| Transaction count | 4 + 121 + 3 = **128** | ✓ |
| Needs / Wants spent | Rent 4,5 + Food 3,2 + Transport 1,4 + Bills 1,3 + Health 0 = **10,4** ✓; Wants 6,1 = Shopping 2,4 + Entertainment 2,1 + Subscriptions 0,9 + **0,7 other** (privacy peek shows Rp700.000) | ✓ |
| Limit per group | Needs 4,5+3,5+2,0+1,5+0,5 = **12,0** ✓; Wants 6,75 = 2,0+2,5+1,0 + **1,25** (Hobbies/Personal Care/Gifts & Donations, not itemized) | partial |
| Remaining budget | 18,75 − 16,5 = **2,25 jt**; 88% spent | ✓ |
| Ideal at day N | 15/31 = **48%** | ✓ |
| Safe daily limit = remaining ÷ days left | 2.250.000/16 ≈ **Rp140.000** | ✓ |
| Category % | Food 3,2/3,5 = 91%; Shopping 2,4/2,0 = 120%; Bills 1,3/1,5 = 87% | ✓ |
| Available balance = Σ non-investment accounts | 42,81+8,125+3,24+0,412+0,086+0,35 = **55,023 jt**; delta 1,2+0,5−0,6−0,4−0,05−0,15 = **+0,5** | ✓ |
| BCA flow | 24,7 − 14,0 − 9,5 = **+1,2** | ✓ |
| Total assets | 55,023 + 61,42 = **116,443 jt** | ✓ |
| 6-month average saved | (6,3+5,4+3,9+8,0+7,5+9,5)/6 = 6,77 ≈ **6,8 jt** | ✓ |
| Goals total | 11,125+14,1+10,3+2,8+0,72+0,68 = **39,725**; figures (30 Sep) Σ = 29,865; accounts 17,325 + investments 22,4 | ✓ |
| Goal progress | Emergency Fund 11,125/54 = **21%**; Emergency fund 0,6 months = 11,125/(54/3) | ✓ |
| Holding USD→IDR | SPY 1,197 × $690,10 × 16.350 ≈ **Rp13.506.000** (shown as 13,5 jt) = Down payment 60% 8,1 + Retirement 40% 5,4 | ✓ |
| Sinking funds on the 25th | 867.000 + 240.000 + 43.000 = **1.150.000** (Bali/Service/STNK) | ✓ |
| Planned goal contributions Oct | 0,5 + 3,0 + 1,15 = **4,65 jt** | ✓ |
| Portfolio | Cost basis 53,931 + gain 7,489 = **61,42**; 7,489/53,931 = 13,9%; US$3.757 × 16.350 ≈ 61,43 | ✓ |

**Inconsistencies to note:**
- The component Wallet Card (ALH0W) for BCA shows "−Rp11.200.000 bulan ini", while the data source says **+1.200.000**.
- End-of-month projection Rp24.200.000. Linear extrapolation 16,5/15×31 = 34,1 jt; if rent is treated as fixed, (12,0/15×31)+4,5 = 29,3 jt. The formula cannot be reproduced.
- Category popover: "Langganan akan lewat anggaran Rp566.000" (Subscriptions will exceed budget by Rp566.000). 900.000 + remaining bills 660.900 − 1.000.000 = 560.900, not 566.000.
- "Rp17.300.000 dialokasikan ke tabungan · bebas Rp37.700.000" (allocated to savings · free): 55,023 − 17,3 = 37,723 (rounded), and goal accounts total 17,325.
- Net worth "+Rp4.220.000 sejak 30 Sep": 116,443 − 112,2 = 4,243. Debts/installments may be included in the calculation [INFERENCE].
- The "Rekening bukan IDR" (non-IDR account) example: Gotrade Cash US$2.778 × 16.350 = Rp45.420.000 (+15,2%), while Gotrade holdings (SPY 13,5 + SCHD 4,9) are much smaller. The per-platform composition of 61,42 jt cannot be reconciled from this data.
- The card title uses "Rp18,75jt", although the guide forbids the jt/rb abbreviations.
- Subscriptions: header "Rp904.900/bulan", Oct schedule 199+45+186+87+59+329 = 905.000, and "H · 5 Okt Rp859.900". Three different figures.

### 6. Background jobs/scheduler & integrations
Implied by the data:
- Recurring contributions on the 1st / 14th / 25th → recurring job.
- Status "Bibit RDPU · diproses, NAB 16 Okt" → pending status that completes automatically when the NAV is published [INFERENCE].
- SPY price in USD and exchange rate 16.350 → price and exchange-rate sync.
- Netflix on the 18th → subscription bill.

### 7. UI components
Summary cards as label–value lists (not product UI).

### 8. Open questions
See the inconsistencies above. There are also 3 Wants categories (total limit 1,25 jt, spent 0,7 jt) that are not itemized per category.

---

## B. Section 01 — Components [mp8Q8]

### 1. Summary & user goal
This is a catalog of reusable components: Wallet Card and its variants, CRUD dialogs (category, account, subscription), base components (dialog/sheet parts, toast, tooltip, menu item, alert dialog, export dialog, category/date/month/account picker popovers), the layout shell, and the accessibility & number-format guide that applies to every page.

### 2. Screens & states
| Name | Node | Content/purpose | State |
|---|---|---|---|
| Wallet Card | ALH0W | Type · name · •• 4 digits · balance · "bulan ini" (this month) flow | default |
| Rekening bukan IDR (USD) | W2jXY | US$2.778,00 · kurs 16.350 · Rp45.420.000 · +15,2% untung | foreign-currency variant |
| Gabungan mata uang | ddgaI | "IDR + USD · Investasi · 5 platform · dalam IDR · Rp61.420.000 · +Rp3.500.000 disetor Okt" | aggregate variant |
| Dialog Kategori Baru | PKbl5 | Category form + preview | dialog |
| Dialog Rekening Baru | A4n8Tw | Account form + card preview | dialog |
| Dialog Langganan Baru | ofF4z | Subscription form | dialog |
| Col Parts | TEjIn | Dialog Header/Footer, Sheet Header | – |
| Col Feedback | SQDDM | Toast (title, description, "Aksi" (action)), Tooltip (Label, Rows 1–4, "Klik untuk rincian" (click for details)), Menu item, "Memperbarui…" (updating) | loading |
| Col Dialogs | JTxVb | Export dialog; Alert "Hapus item ini?" (delete this item?) | dialog/destructive |
| Col Popovers | DgoMF | Pick category, date+time, month, account | popover |
| Col Layout | z0lYFa | Sidebar + page header | default |
| Panduan Aksesibilitas | LSwUS | Contrast, focus ring, color blindness, number format | – |

### 3. User flows
- **New category:** choose Type (Pengeluaran/Pemasukan — expense/income) → Name (max. 24 characters) → Group (Kebutuhan/Keinginan — Needs/Wants) → Icon → Color → optional monthly budget ("Rp 500.000 / bulan") → preview → "Buat kategori" (create category).
- **New account:** Type (Bank/E-Wallet/Tunai/Investasi/Kartu kredit — bank/e-wallet/cash/investment/credit card) → Bank/provider name (free text; "Logo ditemukan otomatis" (logo found automatically), or "Unggah PNG"/"Pakai ikon" (upload PNG/use icon)) → Display name → Last 4 digits → Currency → Opening balance + As-of date → Card color → toggles "Hitung dalam total saldo" (count in total balance) and "Tampilkan sebagai kartu" (show as card) → "Tambah rekening" (add account). Note in the dialog: "Tidak perlu login bank" (no bank login needed; manual input).
- **New subscription:** Service (e.g. "Belum ada logo" (no logo yet)) → Price → Cycle (Bulanan/Tahunan/Mingguan — monthly/yearly/weekly) → Next billing → Pay from (account) → Category → Description → "Ingatkan sebelum ditagih: 3 hari sebelumnya · notifikasi" (remind 3 days before billing · notification) → toggle "Masa uji coba gratis" (free trial) → Simpan (save). Rule: when due, the bill enters the Review queue ("Perlu ditinjau"), and the balance is only deducted after it is marked as paid.
- **Export transactions:** Format (CSV/Excel sheet per month/PDF report) → Period (Active filter 12–15 Oct/This month/Last month/This year/Custom…) → toggle "Ikuti filter yang sedang aktif" (follow active filters) (Account/Type/Category/Tag) → Columns (9 of 11) → option "Sertakan lampiran (ZIP) · 3 struk · ±1,4 MB" (include attachments · 3 receipts) → summary "14 transaksi akan diekspor · transaksi_12-15okt-2026.csv · ±4 KB · Dibuat di perangkatmu" (generated on your device) → "Ekspor CSV".
- **Delete alert:** "Hapus item ini? Tindakan ini tidak bisa dibatalkan setelah beberapa detik." (cannot be undone after a few seconds) → Batal/Hapus (cancel/delete). Implies a short undo window via the "Aksi" toast [INFERENCE].
- **Category popover:** search ("Cari kategori… Esc") → KEBUTUHAN/KEINGINAN groups, each item with its budget status → ↑↓ to select → "Buat kategori pengeluaran" (create expense category).
- **Date popover:** presets (Hari ini, Kemarin, 2 hari lalu, Sabtu lalu, Awal bulan, Jadwalkan — today, yesterday, 2 days ago, last Saturday, start of month, schedule) → month calendar ("ada transaksi" (has transactions) marker) → Time → "Sekarang" (now) → Terapkan (apply).
- **Month popover:** year 2026 with total expenses per month in millions (Jan 18,9 … Okt 16,5, Nov/Des —), "Rentang khusus…" (custom range).
- **Account popover:** BANK/E-WALLET/TUNAI & INVESTASI groups with balances; OVO is flagged "saldo kurang" (insufficient balance).

### 4. Data entities & fields
- **Category:** `type` enum(expense, income); `name` varchar(24); `group` enum(kebutuhan, keinginan); `icon` string; `color` string; `monthly_budget` bigint nullable.
- **Account:** `type` enum(bank, ewallet, cash, investment, credit_card); `provider_name` text; `logo` (auto-resolved, uploaded PNG, or icon); `display_name`; `last4` char(4) (e-wallets use a phone-number format "0812•• 18"); `currency` ISO (IDR/USD/SGD); `opening_balance` bigint minor; `opening_date` date; `card_color`; `include_in_total` bool; `show_as_card` bool; `is_default` ("default" badge); `archived` (from "Diarsipkan 1").
- **Subscription:** `service_name`, `logo` nullable, `price` bigint, `cycle` enum(weekly, monthly, yearly), `next_billing_date` date, `pay_from_account_id` FK, `category_id` FK, `description` nullable, `remind_days_before` int (3), `trial` bool (+trial end date [INFERENCE]), `status` (Aktif/Dijeda/Dibatalkan — active/paused/cancelled).
- **ExportJob** (or client-side, given "Dibuat di perangkatmu"): format enum(csv, xlsx, pdf), period, filters, columns (Date & time, Description, Category, Account, Amount, Currency & exchange rate, Tag, Notes, Attachment link, Running balance, Transaction ID), include_attachments.
- **Transaction** (implied): per-transaction currency and exchange rate, tags, notes, attachments (receipts), running balance.

### 5. Business rules & calculations
- Budget status in the popover: "sisa anggaran Rp300.000" (budget remaining) = limit − spent; "lewat anggaran Rp400.000" (over budget); "akan lewat anggaran" (will exceed budget) = spent + scheduled subscription bills > limit.
- Foreign currency: IDR balance = USD balance × exchange rate (US$2.778 × 16.350 = Rp45.420.000); gain % = (value − cost basis)/cost basis.
- Accounts with `include_in_total = false` are excluded from Available balance and Net worth.
- Subscriptions do not deduct the balance until confirmed as paid.

### 6. Background jobs/scheduler & integrations
- Subscription reminders D-N; creating a Review queue item on the due date; trial-end conversion.
- Automatic logo from provider name (logo lookup).
- Exchange rates for foreign-currency accounts.
- Exports are generated on the device (client-side), so no worker is needed [INFERENCE].
- "Memperbarui…" indicates a sync in progress.

### 7. UI components
Wallet Card (3 variants), Dialog (Header/Footer), Sheet Header, Toast with action, multi-line Tooltip, Menu Item, destructive Alert Dialog, Export Dialog, category Combobox (groups + budget status + keyboard navigation), Date-time picker with presets, Month picker with totals, Account picker, Segmented control, Toggle/switch, money input with "Rp" prefix, Color/icon picker, live preview. **Layout shell:** sidebar (write.financial logo, Cari… ⌘K, MENU: Ringkasan, Transaksi [128], Anggaran, Langganan [7], Kalender, Investasi, Laporan, Tabungan, Utang & cicilan, Tanya Asisten ⌘J, profile "AK · Avtara K. · Paket Pribadi"). Page header: greeting ("Selamat sore, Avtara"), period lede, Minggu/Bulan/Tahun (week/month/year) segment, month picker "Okt 2026", "Atur" (configure), and the primary button "Catat Transaksi" (Record Transaction sheet) with shortcut **N**.

### 8. Open questions
- BCA Wallet Card −11,2 jt vs +1,2 jt.
- "Kartu kredit" (credit card) appears in the dialog, but there is no sample data or rule for negative balances.
- The "Investasi" sidebar item does not appear in Col Layout, but does appear in light and privacy modes.
- Are PDF/Excel exports also processed client-side?
- The duration of the delete undo window ("beberapa detik" — a few seconds) is unspecified.

---

## C. Section 11 — Light mode [tzEmf]

### 1. Summary & user goal
This is the light-theme version of the main pages and of dialogs/panels. The data is identical to dark mode; only the color tokens change. Users can choose a theme (there is a "Tampilan" (appearance) menu in Settings).

### 2. Screens & states
| Screen | Node | Content | State |
|---|---|---|---|
| Dashboard — Terang | W621Uo | Overview + quick add | default |
| Catat Transaksi — Terang | QOIZH | Record form 485.000 Entertainment; warning "Anggaran Hiburan jadi 103% · Rp2.590.000 / 2.500.000" | dialog |
| Transaksi — Terang | l5iy14 | Ledger, 128 transactions | default |
| Rekening & dompet — Terang | q0yPJ | 11 accounts | default |
| Anggaran — Terang | XMmnk | Remaining Rp2.250.000 | default |
| Langganan — Terang | Y0bpSR | 6 active, Oct schedule | default |
| Kalender — Terang | hDiRP | Daily heatmap | default |
| Investasi — Terang | EZDGa | Portfolio | default |
| Laporan — Terang | w8JQ9 | Sep 2026 report, Final | default |
| Pengaturan — terang | NZKL8 | Currency & exchange rate | panel |
| Notifikasi — terang | Z9tYC | 4 new | panel |
| ⌘K — terang | Q5lPHI | Command palette | popover |
| Asisten — terang | DJUYJ | Chat + transaction draft | panel |
| Tujuan baru / Setor manual / Atur sumber dana / Detail Dana Darurat — terang | WSyFx / xYXAZ / K9dfxd / m5WEN | Savings goals page + dialogs | dialog |
| Konfirmasi keluar — terang | ibWUT | "Keluar dari semua perangkat · Aktif di 2 perangkat lain · iPhone, MacBook" (sign out of all devices · active on 2 other devices) | alert |

### 3. User flows
No new flows. This is only the theme applied to existing flows. The theme toggle lives in Settings › Tampilan [INFERENCE: the contents of the Tampilan panel are not shown].

### 4. Data entities & fields
`UserPreference.theme` enum(dark, light, system?) [INFERENCE: a "system" option is not visible]. Settings are described as "tersinkron di semua perangkat" (synced across all devices), so the preference is stored server-side.

### 5. Business rules & calculations
No new rules. The light-token contrast differences are described in the guide: $subtle #71717A, $muted-fg #52525B, $green-fg #15803D.

### 6. Background jobs/scheduler & integrations
None.

### 7. UI components
All components are the same. The theme is implemented via CSS variables (tokens `$fg`, `$card`, `$subtle`, `$ring`, etc.) [INFERENCE].

### 8. Open questions
- Is there a "follow system" option?
- Light screens for Debts & installments, Monthly period, Onboarding, and Mobile are missing.
- Budget has the text "garis putih = posisi ideal hari ini" (white line = today's ideal position). In the light theme the line may not be white.

---

## D. Section 12 — Privacy mode [VPtAq]

### 1. Summary & user goal
Users can hide amounts (e.g. in public or while screen sharing) and occasionally "peek" briefly. Amounts are replaced by `Rp••••••`, while percentages, dates, names, transaction counts, and relative charts remain visible.

### 2. Screens & states
| Screen | Node | State |
|---|---|---|
| Intip — saldo tersembunyi | L44CMl | hidden; "Intip saldo ⌘ ." button in the header |
| Intip — hover tombol | VBOGr | tooltip "Tahan untuk melihat saldo · Nominal tampil selama tombol ditahan (atau ⌘ . selama 5 detik), lalu tersembunyi lagi otomatis." (hold to see balances; shown while held or ⌘ . for 5 seconds, then hidden again automatically) |
| Intip — sedang mengintip | uZheE | "Menampilkan · 5 dtk" countdown, all amounts visible |
| Dashboard/Transaksi/Rekening/Anggaran/Langganan/Kalender/Investasi/Laporan — disembunyikan | Fwczn, PLnyh, S0DpW, Vn9WT, GNJcg, b5pNsK, YpGK1, TlSbI | hidden |
| Notifikasi / Asisten — disembunyikan | FcTf9 / dzkrx | panel hidden |
| Setor manual / Atur sumber dana / Detail Dana Darurat — disembunyikan | m8oT0 / U5lBxH / P11EF | dialog hidden |

### 3. User flows
**Peek balance → hidden → hover → peeking:**
1. Privacy mode is on, so amounts display as `Rp••••••`.
2. Hovering the "Intip saldo" button shows an instruction tooltip.
3. Holding the button (press-and-hold), or pressing ⌘ ., reveals amounts with the badge "Menampilkan · 5 dtk" (showing · 5 s).
4. After the button is released, or after 5 seconds, amounts are hidden again.

How to turn Privacy mode on or off permanently is not depicted [INFERENCE: likely in Settings › Tampilan or Keamanan (security)].

### 4. Data entities & fields
`UserPreference.privacy_mode` bool. Possibly stored per device only [INFERENCE]. No new data fields.

### 5. Business rules & calculations
What is hidden:
- All IDR money amounts, including inside sentences ("Pemasukan naik tipis… (+Rp••••••)"), notifications ("Rp•••••• dari Rp•••••• (120%)"), and Assistant chat (including user input "Catat makan siang tadi ••• pakai GoPay").
- AI cost ("$•••••• dari $••••••").
- USD values ("≈ US$••••••").
- **Exchange rate** ("kurs USD Rp••••••").
- Deltas ("+Rp•••", "+••• net", "+••• terjadwal").
- Thresholds ("di bawah Rp••••••").

What stays visible: percentages (36,5%, 91%, 120%, +13,9%), dates/times, transaction/account counts, merchant/category names, •• 4821, charts and certain axis numbers (portfolio values 28,5…61,4 on the Investments chart remain visible).

Placeholder length: the guide specifies "6 dots", but small deltas use 3 dots ("+Rp•••", "+•••"). **Leaks/inconsistencies:**
- Budget-hidden still shows "Belanja Online +Rp400.000", "Rp10.400.000 / 12.000.000", "sisa Rp1.600.000".
- The Savings goals page still shows "Rp11.125.000 dari Rp54.000.000", "Rp3.500.000/bulan".
- Subscriptions still shows "45.000 · Rp45.000".
- Investments chart axis labels remain visible.

When peeking, numbers must match the seed: 26.000.000 / 16.500.000 / 9.500.000 / 55.023.000 (+500.000) / 61.420.000 (+6.000.000) / 3.676.000 (−800.000 = Mandiri+OVO+Dompet).

### 6. Background jobs/scheduler & integrations
No server jobs. Push/email notifications while Privacy mode is on may also need to mask amounts [INFERENCE: only the in-app panel is depicted].

### 7. UI components
"Intip saldo" button with hold-to-reveal, Tooltip, countdown badge, and a centralized `<Money>` component that masks values automatically. This component must be used in narrative text, notifications, AI chat, and charts.

### 8. Open questions
- Where is the permanent toggle?
- Are the leaks in Budget/Savings goals/Subscriptions intentional (e.g. budget figures considered non-sensitive)?
- Are chart axes hidden too?
- Is 3 dots vs 6 dots intentional?
- Are exports and AI output sent to the provider also masked?
- Is ⌘ . a 5-second toggle or hold?

---

## Number-format & accessibility rules
(Full text from node `LSwUS`.)

**Target:** WCAG 2.2 AA. Small text ≥ 4,5:1; large text and UI elements ≥ 3:1.

**Text token contrast on $card (dark / light):**

| Token | Dark | Light |
|---|---|---|
| $fg | 17.9:1 | 19.8:1 |
| $text-secondary | 12.6:1 | 10.4:1 |
| $muted-fg | 7.3:1 | 7.7:1 |
| $subtle | 5.1:1 | 4.8:1 |
| $text-faint | 2.4:1 | 2.6:1 |
| $blue-fg | 7.4:1 | 5.2:1 |
| $green-fg | 10.8:1 | 5.0:1 |
| $red-fg | 6.8:1 | – |
| $amber-fg | 11.2:1 | – |
| $violet | 6.9:1 | 5.7:1 |

Table notes: $text-faint may only be used for decoration and disabled elements. Light values for $red-fg/$amber-fg are not readable in the export. Fixes: $subtle (dark #737373→#858585, light #A1A1AA→#71717A), light $muted-fg →#52525B, light $green-fg →#15803D.

**Focus ring:** 2px `$ring` + 2px gap (`$ring-offset`), only on `focus-visible`. Tab order: header → lede → chart → ledger. Keyboard navigation: day bars ←/→; ledger rows ↑/↓ to move, Enter to open details, E to edit.

**Color-blind friendly** (checked with deuteranopia & protanopia simulation; every color meaning has a second cue):
- Money flows are always signed + / − (U+2212), including in charts.
- Actual and projected are distinguished by shape: actual = filled bar, projected = gray outlined bar.
- Budget status is written as text ("lewat Rp400.000", "akan lewat"), not only bar color.
- Donut slice order = legend order, and percentages are written in the legend.

**Rupiah format:**
- **Tables & ledger:** full number without "Rp", right-aligned, Geist Mono font (tabular). Debit/credit unsigned because the column carries the meaning (`42.810.000`).
- **Headline numbers** (summary cards, lede): full with Rp (`Rp55.023.000`).
- **Sentences & charts:** full with thousands dots (`Rp2.250.000`, `140.000`). **No jt/rb abbreviations.**
- **Flows & differences:** always signed; minus uses "−" U+2212, not a hyphen (`+9.500.000`, `−2.277.000`).
- **Percentages:** decimal comma, rounded to nearest (`36,5%`; 1.300.000/1.500.000 = `87%`).
- **Foreign currency:** `US$690,10`, with the exchange rate next to it: "Rp16.350 per US$1".
- **Privacy mode:** values replaced with 6 dots (`Rp••••••`); percentages and dates remain visible.

Implementation implication: a single util `formatMoney(minor, {currency, context: 'table'|'headline'|'sentence'|'delta', privacy})` based on `Intl.NumberFormat('id-ID')`, with the minus sign replaced by U+2212.

Exceptions in the design that violate the rules:
- Title "Rp18,75jt" (dAY7U).
- Data-source summary "masuk 24,7 − keluar 14,0", plus the month popover and heatmap using millions ("Angka kecil = total pengeluaran (juta)" — small number = total expenses in millions).
- Chart axis "28,5…61,4".

For **input**, the parser accepts abbreviations ("kopi 25rb gopay"), so the natural-language parser must understand "rb"/"jt".

---

## Seed data
User: **Avtara K.** (initials AK, "Paket Pribadi" (personal plan)). Current period: 1–15 Oct 2026, day 15 of 31, 16 days until payday. Primary currency IDR; USD exchange rate **16.350**. All money is stored as bigint rupiah.

### Accounts (11 active, 1 archived)
| Account | Type | Details | Balance 15 Oct | Δ Oct |
|---|---|---|---|---|
| BCA Tahapan | Bank | •• 4821, default, 4 goals; in 24,7 − out 14,0 − transfer 9,5 | 42.810.000 | +1.200.000 |
| Bank Jago | Bank | •• 0377, entirely Emergency Fund | 8.125.000 | +500.000 |
| Mandiri | Bank | •• 9102; in 1,3 − out 1,9 | 3.240.000 | −600.000 |
| GoPay | E-Wallet | 0812•• 18 | 412.000 | −400.000 |
| OVO | E-Wallet | needs adjustment (34 days), insufficient balance | 86.000 | −50.000 |
| Dompet (tunai) | Cash | needs adjustment (21 days) | 350.000 | −150.000 |
| **Available balance** | | | **55.023.000** | **+500.000** |
| Investments: 5 platforms (Gotrade USD, Bibit, … ) | Investment | not counted in Available balance; 1 in USD | 61.420.000 | contributed +6.000.000; RDPU 3.000.000 processing |
| **Total assets** | | | **116.443.000** | Net worth 30 Sep 112.200.000 |

[INFERENCE] Investment platforms whose names are visible: Gotrade (USD), Bibit (RDPU, IDX30, ORI). The other three platforms are not named in this digest.

### October categories & budget (total limit 18.750.000, 10 categories)
| Category | Group | Spent | Limit | % |
|---|---|---|---|---|
| Sewa Kos | Needs | 4.500.000 | 4.500.000 [INFERENCE] | 100 |
| Makan & Dapur (18×) | Needs | 3.200.000 | 3.500.000 | 91 |
| Transportasi | Needs | 1.400.000 | 2.000.000 | 70 |
| Tagihan & Utilitas | Needs | 1.300.000 | 1.500.000 | 87 |
| Kesehatan | Needs | 0 | 500.000 | 0 |
| Belanja Online (Erafone 2,15 + Shopee 0,25) | Wants | 2.400.000 | 2.000.000 | 120 |
| Hiburan | Wants | 2.100.000 | 2.500.000 | 84 |
| Langganan | Wants | 900.000 | 1.000.000 | 90 |
| Hobi, Perawatan Diri (remaining 250.000), Hadiah & Donasi | Wants | Σ 700.000 | Σ 1.250.000 | – |
| **Total** | Needs 10,4/12,0 · Wants 6,1/6,75 | **16.500.000** | **18.750.000** | 88 |

Income categories: Gaji, Freelance, Penjualan & lainnya, Dividen & bunga [INFERENCE: category names taken from income source labels]. Monthly expenses 2026 (millions): Jan 18,9 · Feb 17,2 · Mar 23,4 · Apr 18,1 · May 17,8 · Jun 19,2 · Jul 21,4 · Aug 16,9 · Sep 18,3 · Oct 16,5 (in progress).

### October income (26.000.000; 4 transactions)
Salary PT Kinarya 1 Oct → BCA 18.500.000. Freelance Studio Arunika 14 Oct → BCA 6.200.000 (invoice #0912). Penjualan & lainnya → Mandiri 1.090.000. Dividen & bunga → Mandiri 210.000. Transfers (3): Gotrade 6.000.000 (1 Oct), Jago 500.000 (1 Oct), Bibit RDPU 3.000.000 (14 Oct 19.30, processing, NAV 16 Oct).

### Saved per month
May 6.300.000 (2,3+4,0) · Jun 5.400.000 · Jul 3.900.000 (expenses 21.400.000) · Aug 8.000.000 · Sep 7.500.000 (saving rate 29,1%; income 25.800.000, expenses 18.300.000) · Oct 9.500.000 (3,5+6,0). Average 6.800.000.

### Subscriptions (Active 7 / Paused 1 / Cancelled 3; ≈Rp904.900/month)
Oct schedule: 3 Oct 199.000 · 5 Oct Fit Hub, Niagahoster · 9 Oct 45.000 iCloud+ (needs review) · 18 Oct Netflix 186.000 (BCA) · 20 Oct 87.000 · 22 Oct 59.000 · 28 Oct ChatGPT 329.000 (largest). Remaining Oct bills Rp660.900 (4 bills, 18–28 Oct). History: "+Spotify, ChatGPT naik, +YouTube" (ChatGPT price up) (+24% since May). Dialog example: Disney+ Hotstar 39.000/month, GoPay, Hiburan, billing 2 Nov 2026.

### Savings goals (6 active + 1 completed)
| Goal | Funding source | Target | Current | 30 Sep | Deadline / contribution |
|---|---|---|---|---|---|
| Dana Darurat | Jago 8,125 + RDPU 3 | 54.000.000 | 11.125.000 (21%) | 7.625.000 | Nov 2027; 3.500.000/month on the 1st & 14th |
| DP Rumah | SPY 60% 8,1 + IDX30 1 + BCA 5 | 150.000.000 | 14.100.000 | 11.514.000 | – |
| Dana Pensiun | SPY 40% 5,4 + SCHD 4,9 | 500.000.000 | 10.300.000 | 6.526.000 | – |
| Liburan Bali | Sinking fund | 8.000.000 | 2.800.000 (35%) | 2.800.000 | Mar 2027; 867.000/month on the 25th |
| Servis motor | Sinking fund | 1.200.000 | 720.000 (60%) | 720.000 | Dec 2026; 240.000/month on the 25th |
| Perpanjang STNK | Sinking fund | 850.000 | 680.000 | 680.000 | Feb 2027; 43.000/month on the 25th |
| Completed: Kursi kerja ergonomis | – | – | 1.050.000 | Shopee 9 Sep | – |
| **Total** | accounts 17,325 + investments 22,4 | | **39.725.000** | 29.865.000 | |

### Recurring contributions
1st: BCA → Jago emergency pocket 500.000. 1st: BCA → Gotrade 6.000.000 (DCA SPY 4.000.000 + SCHD 2.000.000; SPY allocated 60/40 Down payment/Retirement, SCHD → Retirement). 14th: BCA → Bibit RDPU 3.000.000 (since Oct; Sep → Jago 2.000.000). 25th: set aside sinking funds 1.150.000.

### Holdings
| Holding | Platform | Details | IDR value |
|---|---|---|---|
| SPY | Gotrade (USD) | 1,197 units × $690,10 | 13.500.000 |
| SCHD | Gotrade (USD) | – | 4.900.000 |
| IDX30 | Bibit | – | 1.000.000 |
| ORI | Bibit | not yet allocated | 1.500.000 |
| RDPU | Bibit | 3.000.000 processing, NAV 16 Oct | 3.000.000 |

Portfolio: 11 positions across 5 platforms; value 61.420.000 (≈US$3.757); cost basis 53.931.000; unrealized gain +7.489.000 (+13,9%); today +312.000 (+0,51%); 12-month dividends 2.640.000 net (yield 4,3%); portfolio YTD return +11,2% vs SPY +14,8% vs IHSG +3,1%. Month-end values (millions, Nov→Oct): 28,5 · 30,9 · 33,6 · 35,4 · 36,8 · 40,3 · 43,8 · 46,9 · 49,1 · 53,5 · 57,7 · 61,4. Gotrade Cash US$2.778,00 = Rp45.420.000 (+15,2%) per the component example.

### Miscellaneous
Assistant: model claude-sonnet-5.5 via OpenRouter, usage $1,24 of $5/month. CoinGecko quota 8.012/10.000 (80%). E-wallet low-balance threshold Rp500.000. Active sessions on 2 other devices (iPhone, MacBook). Tags in use: kantor, freelance, rumah, reimburse, liburan-bali. Transaction sources: Gmail, agent.
