# Analysis: Reports, Monthly Period, Notifications/Search/Assistant, Sign-in & Onboarding, Mobile

Sources: `/tmp/digest/10-laporan.md`, `14-periode-bulanan.md`, `15-notifikasi-pencarian-asisten.md`, `16-masuk-onboarding.md`, `17-mobile.md`. All figures are quoted from the design (sample user: Avtara K., "today" = Kam, 15 Okt 2026).

---

## A. Reports (Section 10 [onBoC])

### 1. Summary & user goal
The user views financial reports for closed periods ("Laporan September 2026 · Final · 1–30 Sep · dibandingkan dengan Agustus 2026 · 121 transaksi"), complete with KPIs, an automatic narrative, charts, and tables by category, account, tag, goal, largest transactions, and subscriptions. Reports can be exported to PDF, CSV, or Excel, and emailed automatically. Purpose: monthly review ("Catatan untuk Oktober" (notes for October)) and archiving, e.g. "Rekap SPT Tahunan 2025" (annual tax return recap).

### 2. Screens & states
| Screen | Node id | Content/purpose | State |
|---|---|---|---|
| write.financial — Laporan | ogfhy (1440x3671) | Full monthly report, 7 sections | default |
| Laporan — Ekspor PDF | yLlRY | "Ekspor laporan" dialog: format, period, sections, appearance, paper, masking, preview | dialog |
| PDF Hal. 1 — Ringkasan | TAU0h (794x1123, A4) | KPIs, net worth, report contents, savings | PDF output |
| PDF Hal. 2 — Arus uang | t3PQGb | Sankey of income → where it went, source table, daily spending | PDF output |
| PDF Hal. 3 — Pengeluaran | STgHg | Categories Sep vs Aug + budget, merchants, tags, accounts | PDF output |
| PDF Hal. 4 — Transaksi & langganan | ZWRR8 | Largest transactions, subscriptions, "Catatan untuk Oktober", disclaimer | PDF output |
| Laporan — Skeleton (memuat) | r6w3vW | "Menyusun laporan…" (compiling report) | loading |
| Laporan — Memperbarui data (ganti periode) | yISo5 | "Menghitung ulang…" (recalculating) | partial loading |
| Laporan — Gagal menyusun | fOodO | "Laporan September gagal disusun", "Ekspor PDF dinonaktifkan sementara", "Coba lagi · Hubungi bantuan", code "500 · POST /reports/2026-09" | error |
| Laporan — Kosong (pengguna baru) | gyfhQ | Timeline "15 Okt Mulai mencatat → 31 Okt Periode pertama ditutup → 1 Nov Laporan Oktober terbit"; CTAs "Catat transaksi", "Atur tanggal mulai" | empty |
| Laporan — September tetap 1–30 Sep | IvIWD (Section 14) | Banner "Laporan lama tidak berubah" (old reports do not change) | info |

### 3. User flows
- **Page**: open Reports → choose type "Bulanan · Kuartal · Tahunan · Kustom" → comparison "vs Agustus" → navigate tabs "Arus uang · Pengeluaran · Pemasukan · Rekening & tag" ("Halaman 1 dari 1 · 7 bagian").
- **Export PDF → export options → PDF output (A4, 4 pages)**: click "Ekspor PDF" → choose Format (CSV "semua aplikasi" / Excel "sheet per bulan" / PDF "siap dicetak") → Period ("September 2026 · final", August, Q3 2026, This year, Custom…; "Laporan final tersedia s.d. Sep 2026") → Sections ("5 dari 6": Overview & net worth p. 1, Money flow & income p. 2, [Spending] p. 3, Largest transactions & subscriptions p. 4, "Daftar 121 transaksi lengkap +5 hal." unchecked) → Appearance Light ("hemat tinta" (saves ink))/Dark → Paper A4/Letter → "Samarkan nomor rekening" ("•• 4821 tetap disamarkan, nominal tetap terlihat") → preview "4 halaman · A4" → download.
- **Loading → skeleton → refreshing data**: first load uses a skeleton; when switching periods, old data stays visible with a "Menghitung ulang…" indicator; on failure, an error screen with Retry is shown.
- **Empty — new user**: a timeline up to the first report's publication is shown; the user is directed to record transactions or set the period start date.

### 4. Data entities & fields
- **Report** (per-period snapshot): `period_id`, `type` enum(bulanan, kuartal, tahunan, kustom), `range_start/end` (date), `status` enum(final, berjalan?) ["Final"], `compare_to_period_id`, `tx_count` int (121), `generated_at` timestamp ("Dibuat 15 Okt 2026, 19.45"), `summary_text` (narrative "dibuat otomatis dari transaksimu" (generated automatically from your transactions)), plus KPIs (bigint minor): income 25.800.000, expense 18.300.000, net 7.500.000, savings_rate (decimal 29,1%), net_worth 112.200.000 "per 30 Sep".
- **ReportExport / SavedReport** ("Laporan tersimpan · Diunduh atau dikirim otomatis"): `name` ("Laporan Agustus 2026", "Q2 2026 Apr–Jun", "Rekap SPT Tahunan 2025"), `format` enum(PDF, XLSX, CSV), `size_bytes` (1,2 MB / 86 KB / 2,4 MB), `file_url`, options: `sections[]`, `theme` enum(terang, gelap), `paper` enum(A4, Letter), `mask_account_numbers` bool.
- **ReportAutoSend**: "Kirim otomatis tiap tanggal 1 · PDF ke email terdaftar" → `enabled` bool, `day` (1), `format` (PDF), `to` = user email.
- Derived data read: Transaction (date, description, category, merchant, account, tag, amount), Category (+ Needs/Wants/Savings group, budget limit), Account (BCA Tahapan "debit & transfer", Bank Jago "kartu virtual", GoPay "QRIS & ojek", Tunai), IncomeSource (Gaji "PT Kinarya", Freelance "3 klien · 4 invoice", "Studio Arunika 62%", Penjualan & lainnya, Dividen & bunga "6 aset · bersih setelah pajak"), SavingsGoal (31 Aug, Sep contribution, price, 30 Sep, progress), Subscription, monthly NetWorthSnapshot (Apr–Sep: 85,2 · 91,0 · 95,5 · 98,1 · 105,5 · 112,2 million), FX rate ("kurs Rp16.350/USD"), investment prices as of 30 Sep.
- **Notes for the next period** (p. 4): a list of text items, e.g. "Belanja Online lewat Rp600.000 — batas Oktober tetap Rp2.000.000…". [INFERENCE] generated automatically by rules/AI, or written by the user.

### 5. Business rules & calculations
- Net cash flow = income − expenses: 25.800.000 − 18.300.000 = **+7.500.000**. August: 24.900.000 − 16.900.000 = 8.000.000; change −6,3%.
- Savings rate = saved / income: 7.500.000 / 25.800.000 = **29,1%** (Aug 32,1%, shown as "−3,0 poin", so the difference is in percentage points, not relative percent).
- % change = (current − previous)/previous: income (25,8−24,9)/24,9 = +3,6%; expenses (18,3−16,9)/16,9 = +8,3%.
- Net worth = investments 57.700.000 + cash & savings 54.500.000 = 112.200.000. "+32% sejak Apr" = 112,2/85,2 − 1.
- Money flow uses an income split: Needs 11.200.000 (43%), Wants 7.100.000 (28%), Savings 7.500.000 (29%) of a 25.800.000 total. Category percentages are also computed against income (Sewa Kos 4.500.000 = 17%).
- ANGGARAN (budget) column: spent/limit, e.g. Belanja Online 2.600.000/2.000.000 = 130% ("lewat Rp600.000" (over by Rp600.000)); "9 dari 10 anggaran terpenuhi".
- Daily average = expenses / number of days: 18.300.000/30 = **Rp610.000** (Aug Rp545.000). "Minggu terboros 7–13 Sep Rp5.200.000" (most expensive week); "Akhir pekan … 41% dari pengeluaran variabel" (variable = excluding FIXED costs such as rent).
- Largest transactions: share = amount / total expenses (Rent 4.500.000/18.300.000 = 24,6%); "6 transaksi = 40% dari pengeluaran".
- Subscriptions: monthly total 329.000 + 199.000 + 186.000 + 86.900 + 45.000 = **Rp845.900**; yearly equivalent ×12 = Rp10.150.000 (rounded); "4,6% dari pengeluaran".
- Goals: progress = balance/target (Dana Darurat 7.625.000/54.000.000 = 14,1%); ending value = opening + contributions + price change (9.504.000 + 1.800.000 + 210.000 = 11.514.000).
- "Disisihkan dana tidak rutin*" (set aside to sinking funds) Rp1.150.000 "tidak dihitung di saving rate" (not counted in the savings rate).
- Transfers between accounts are not counted as income/expenses.
- Finalized monthly reports are **immutable** ("Laporan lama tidak berubah") even if the period settings change.
- A report is published after the full period has closed ("Laporan dibuat setelah satu periode penuh tercatat"; the October period closes 31 Oct, the report is published 1 Nov).
- Investment values in the report use prices and exchange rates as of the period end date ("harga 30 Sep 2026 dan kurs Rp16.350/USD").

### 6. Background jobs/scheduler & integrations
- **Period close / generate report snapshot** on the first day of the new period (1 Nov for October). Visible endpoint: `POST /reports/2026-09`.
- **Auto-send on the 1st of each month**: render the PDF, then send it to the registered email.
- **Render PDF/XLSX/CSV** in a worker (large size, 4+5 pages).
- Snapshot of investment prices and exchange rates at period end (depends on the price/FX sync job).
- Narrative "Ringkasan September · dibuat otomatis" [INFERENCE] produced by deterministic rules or AI at period close.

### 7. UI components
App sidebar + search "Cari… ⌘K", segmented control (Bulanan/Kuartal/Tahunan/Kustom), comparison dropdown, "Ekspor PDF" button, tabs, KPI cards with delta and comparison value ("Agu Rp24.900.000"), "Final" badge, net worth line/area chart, money-flow Sankey, daily bar chart (weekends highlighted, annotations "sewa", "9.9"), category table with budget progress + "Unduh CSV", merchant ranking list, account percentage bars, tag chips `#akhir-pekan`, goals table, subscription list with letter avatars, saved files list, auto-send toggle, export dialog (radio cards, section checklist with page numbers, mask toggle, preview), skeleton, error state with code, timeline-style empty state.

### 8. Open questions
- Quarterly/Yearly/Custom: are these also final snapshots, or computed on the fly? "Q3 2026" appears in export, but only monthly reports carry the "Final" label.
- Content of the "Pemasukan" (income) tab and the Accounts & tags section in the PDF: the dialog says "5 dari 6" sections, but only 4 pages are shown. The unlisted section is the list of 121 transactions.
- Excel format "sheet per bulan" for multi-month ranges: its column structure is not in the design.
- "Catatan untuk Oktober": generated by AI, rules, or the user?
- Report status for the current period (October): can it be viewed as a draft? The design only shows "Laporan final tersedia s.d. Sep 2026".
- Error 500 shown to the user ("POST /reports/2026-09"): is this intentional?

---

## B. Monthly period & Period close (Section 14 [Db5FC])

### 1. Summary & user goal
The user picks the monthly period start day (1–28, default the 1st, ideally aligned with payday), so budgets, savings rate, reports, calendar, and savings are computed per "payday month". When changing the start day, the user chooses whether the change applies from the next period (with a prorated transition period) or the current period is recalculated. Finalized reports never change.

### 2. Screens & states
| Screen | Node id | Content/purpose | State |
|---|---|---|---|
| Pengaturan — Periode bulanan | kNL3D | Period settings, default the 1st | default |
| … — pilih tanggal | WpMpY | Picker "Mulai tiap tanggal" / "Ikuti gajian"; "Tanggal 29–31 tidak tersedia…" | dropdown open |
| … — ubah ke tanggal 25 | hvzfS | Warning "Gaji PT Kinarya biasanya masuk tgl 1, bukan tgl 25 · Tidak sejalan gajian"; period preview; radio "TERAPKAN PERUBAHAN"; "Ada perubahan belum disimpan" | dirty edit + warning |
| Periode bulanan — konfirmasi hitung ulang | d2ztG3 | Dialog "Hitung ulang periode Oktober?" | confirmation dialog |
| Dashboard — pilih periode | DLnov | Period dropdown: Des 2026 (25 Nov–24 Des, 30 days, "Mulai tgl 25"), Nov transition (1–24 Nov, 24 days), Okt Berjalan (current), Sep, Agu, "Atau pilih rentang kustom…" | dropdown |
| Anggaran — Oktober + info transisi | Gb4iH | November proration banner | info |
| Tabungan — Oktober + rencana transisi | w61TJ | November contribution plan Rp3.500.000 (not Rp4.650.000) | info |
| Laporan — September tetap | IvIWD | "Laporan lama tidak berubah" | info |
| Kalender — November (transisi) | ufSoF | "Periode transisi 1–24 Nov · periode Desember mulai 25 Nov (garis biru)", "Bulan belum dimulai · yang tampil adalah jadwal & proyeksi" | future/projection |

### 3. User flows
**Settings → default the 1st → pick day → change to the 25th → confirm recalculation**
1. Open Settings → Monthly period (default the 1st).
2. Choose mode "Mulai tiap tanggal" (start on a fixed day, 1–28) or "Ikuti gajian" (follow payday).
3. Pick 25. The system warns if the day does not match the detected salary income, then shows a preview: "25 Sep – 24 Okt disebut “Oktober”" (periods are named after the month in which they end).
4. Choose how to apply the change:
   - **Start next period**: "Oktober tetap 1–31 Okt, lalu transisi 1–24 Nov: batas anggaran Rp18.750.000 → Rp15.000.000 (24/30 hari)", then December 25 Nov – 24 Dec.
   - **Recalculate current period**: "Oktober jadi 25 Sep – 24 Okt. Transaksi 25–30 Sep ikut pindah". A confirmation dialog appears: "Anggaran & saving rate Oktober dihitung ulang · Laporan September yang sudah final tidak berubah · Setoran rutin & tagihan tetap di tanggalnya" → button "Hitung ulang".

**Applied across all pages** ("Start next period" scenario): Dashboard shows "periode tgl 25 mulai Des." and the period list; Budget shows a transition banner; Savings goals adjusts the contribution plan; the September report does not change; Calendar November marks the transition period and the start of the December period.

### 4. Data entities & fields
- **UserSettings.period**: `start_day` int 1–28, `mode` enum(fixed_day, follow_payday) ["Ikuti gajian"], `effective_from_period` (date), `apply_mode` enum(next_period, recalc_current).
- **Period** (materialized): `id`, `user_id`, `label` ("Oktober 2026", named after the end month), `start_date`, `end_date`, `days` int (24/30/31), `kind` enum(normal, transisi), `status` enum(berjalan, final, akan datang), `closed_at`. [INFERENCE] a `periods` table is needed so the history of old periods (1–30 Sep) stays stable after settings change.
- **PeriodSettingChange** (audit) [INFERENCE]: `old_day`, `new_day`, `apply_mode`, `created_at`.
- Relations: Budget (limit per category per period, subject to proration), RecurringDeposit/SavingsPlan (the 1st & 14th, the 25th), Report (per Period, immutable), salary IncomeSource (to detect payday "PT Kinarya … tgl 1").

### 5. Business rules & calculations
- Start day is limited to 1–28: "Tanggal 29–31 tidak tersedia supaya periode selalu ada di setiap bulan" (also "maks. tanggal 28" in the Reports empty state).
- Period naming: the period 25 Sep – 24 Oct is called "Oktober".
- Transition period proration: limit = normal limit × transition_days / 30. Example 18.750.000 × 24/30 = **15.000.000**. The divisor is 30, not the number of calendar days.
- Transition savings plan: contributions whose date falls outside the transition period move to the next period. "Sisihkan dana tidak rutin tiap tgl 25 jatuh di awal periode Desember, jadi rencana November Rp3.500.000 (Dana Darurat tgl 1 & 14) — bukan Rp4.650.000".
- Current-period recalc: transactions are moved between periods by date (Tokopedia Rp449.000 on 27 Sep moves into October); budget and savings rate are recalculated; final periods are not changed; recurring contribution and bill schedules stay on their calendar dates.
- Budget on day N (Gb4iH): "Hari ke-15 dari 31"; ideal = 15/31 = **48%**; spent 16.500.000/18.750.000 = **88%**; remaining 2.250.000; "Batas aman harian Rp140.000 · sisa ÷ 16 hari" (2.250.000/16 = 140.625, rounded down to thousands). "Proyeksi akhir bulan Rp24.200.000 · lewat Rp5.400.000" (formula not explicit, see open questions).
- "16 hari lagi menuju gajian berikutnya" = days remaining in the period.
- Payday detection: the recurring salary income date is compared with the selected start day to show the warning.

### 6. Background jobs/scheduler & integrations
- **Period close** when `end_date` passes (user time zone, Asia/Jakarta): mark the Period final, create the next period (normal/transition), copy budgets (there is a "Salin dari September" button, so [INFERENCE] copying may be manual or automatic), prorate for transition periods, then enqueue report generation.
- **Recalculation job** after the "Hitung ulang" confirmation: reassign transaction periods, recompute budget and savings-rate aggregates. [INFERENCE] run as an async job ("Menghitung ulang…").
- Calendar projection for upcoming months (scheduled bills, "Gajian 1 Nov · diperkirakan Rp18.500.000").

### 7. UI components
Settings row with day picker (1–28 grid), segmented "Mulai tiap tanggal / Ikuti gajian", warning callout, period preview timeline (fixed → Transition → normal), radio cards "TERAPKAN PERUBAHAN", sticky bar "Ada perubahan belum disimpan", confirmation dialog with impact checklist, period switcher dropdown with badges (Berjalan/Transisi/Mulai tgl 25) and "rentang kustom", info banners on the Budget/Savings goals/Reports pages, blue line marker on the calendar.

### 8. Open questions
- "Ikuti gajian" mode: is the day taken automatically from detected salary transactions? What if salary lands on a weekend or on a day > 28?
- Is proration always divided by 30, or by the number of days in a normal period?
- Transition direction when the day is moved earlier (e.g. from 25 to 1): is the transition period longer than a month?
- Formula for "Proyeksi akhir bulan Rp24.200.000": a linear run-rate 16,5 jt/15×31 ≈ 34,1 jt does not match. Possibly fixed costs + variable run-rate [INFERENCE].
- Quarterly/Yearly reports after the start day changes: do boundaries follow periods or the calendar?

---

## C. Notifications (Section 15 [ZEmNI])

### 1. Summary & user goal
The notification panel (bell) contains budget warnings, low balance, subscription bills, contribution confirmations, API quota, and the weekly summary. Items are grouped by day and have action buttons. The user can mark all as read.

### 2. Screens & states
| Screen | Node id | Content/purpose | State |
|---|---|---|---|
| Notifikasi — terbuka | JdcJD | Popover "Notifikasi · 4 baru · Tandai dibaca", tabs "Anggaran & tagihan · Sistem" | default/unread |
| Notifikasi — semua sudah dibaca | h5aPn2 | "Semua sudah dibaca · Pengingat berikutnya: Netflix ditagih 18 Okt (Rp186.000), dikirim H-1 jam 09.00." | empty |
| Mobile — Notifikasi | JRmIg | Full-screen mobile version | mobile |

### 3. User flows
Click the bell → list (HARI INI 15 OKT / KEMARIN 14 OKT / SENIN 12 OKT) → per-item actions ("Lihat anggaran", "Isi saldo", "Buka Tabungan") → "Tandai dibaca" → empty state showing the next reminder → "Lihat semua notifikasi".

### 4. Data entities & fields
**Notification**: `id`, `user_id`, `type` enum(budget_exceeded, budget_threshold, low_balance, bill_due, goal_deposit_recorded, api_quota, weekly_summary), `category` enum(anggaran_tagihan, sistem), `title`, `body`, `created_at` (14.12, 09.00, 07.00), `read_at` nullable, `action` {label, route}, `ref_entity` (budget/account/subscription/goal). Sample payloads: "Rp2.400.000 dari Rp2.000.000 (120%) · Erafone Rp2.150.000 & Shopee Rp250.000"; "OVO Rp86.000 dan GoPay Rp412.000 di bawah batas Rp500.000"; "CoinGecko 80% kuota · 8.012 dari 10.000 permintaan bulan ini"; "Setoran … Rp3.000.000 ke Bibit RDPU · pembelian diproses, NAB 16 Okt".
**NotificationPreference** [INFERENCE]: thresholds (90%, 100%, low-balance limit Rp500.000 per account), send time ("H-1 jam 09.00").

### 5. Business rules & calculations
- Budget threshold: notify at ≥ ~90% ("Makan & Dapur 91%") and > 100% ("lewat batas", 120%). Remaining-per-day text: 300.000/16 days.
- Low balance: balance < account limit (Rp500.000), merged into one item for multiple accounts.
- Subscription bill reminder: D-1 at 09.00 (empty state); the list item says "3 hari lagi", so [INFERENCE] there is also a D-3 reminder.
- External API quota: notify at 80% (8.012/10.000).
- Weekly summary is sent Monday for the previous Mon–Sun week (5–11 Oct: Rp8.490.000, largest Erafone Rp2.150.000).
- Badge "4 baru" = number of items with `read_at` null.

### 6. Background jobs/scheduler & integrations
Budget evaluator (triggered on transaction save + 09.00 cron), low-balance check (07.00), bill reminders (09.00 D-1/D-3), weekly summary job (Monday), CoinGecko quota monitor (crypto price integration), mutual fund purchase status (NAV). Channel: in-app; [INFERENCE] push/email not yet visible.

### 7. UI components
Notification popover, filter tabs, per-date group headers, notification item (icon, title, time, body, action button), "Tandai dibaca" link, empty state with next-reminder info, unread badge.

### 8. Open questions
- The "Lihat semua notifikasi" (see all notifications) page is not designed yet.
- Notification preference settings (thresholds, time, email/push channels) are not in this section.
- Are mobile/web push notifications supported?

---

## D. Global search ⌘K (Section 15)

### 1. Summary & user goal
A command palette for searching transactions, pages, subscriptions, calendar, and commands. When empty, it shows quick actions and recently opened items. When there are no results, the user is directed to the Assistant via Tab or to entity-creation actions. Search works without AI.

### 2. Screens & states
| Screen | Node id | Content | State |
|---|---|---|---|
| ⌘K — terbuka | Z6JVby | "Cari transaksi, halaman, atau perintah…"; AKSI CEPAT; BARU DIBUKA; HALAMAN with shortcuts "G R", "G T" | default |
| ⌘K — hasil "netflix" | hLRXP | Groups LANGGANAN, TRANSAKSI (2), KALENDER, TANYA ASISTEN | results |
| ⌘K — tanpa hasil | nK8wJ | "Tidak ada hasil untuk “cicilan motor”" + COBA (try) suggestions | empty |

### 3. User flows
⌘K → type a query → navigate ↑↓, Enter to open, Esc to close → results grouped by type → Tab sends the query to the Assistant ("“Berapa total Netflix tahun ini?” · Dijawab dari transaksimu · claude-sonnet-5.5"). If no results: "Tanya Asisten: “cicilan motor”", "Tambah “Cicilan motor” di Utang & cicilan", "Buat tujuan tabungan “Motor baru”".

### 4. Data entities & fields
Search index covering: Transaction (merchant/description, date, category, account, amount), Subscription ("Premium 4K · tiap tgl 18 · BCA Tahapan"), CalendarEvent/Bill ("Tagihan Netflix · Min, 18 Okt · 3 hari lagi"), SavingsGoal (progress "Rp11.125.000 dari Rp54.000.000 · 21%"), Investment ("SPY · Gotrade · DP Rumah 60% · Pensiun 40% · Rp13.500.000"), Page, Command. **RecentItem**: `user_id`, `entity_type`, `entity_id`, `opened_at`.

### 5. Business rules
- Results are grouped by type with their counts (TRANSAKSI 2).
- Unmatched queries are forwarded to the Assistant as a prompt. The hint "Asisten bisa mencari dari catatan & tag transaksi" suggests ⌘K search [INFERENCE] does not full-text search notes/tags, or simply found nothing there.
- Quick actions: Record transaction, Record transfer, Contribute to savings goal.

### 6. Background jobs/scheduler
None. [INFERENCE] Can use Postgres full-text/trigram directly.

### 7. UI components
Command palette modal, input with Esc hint, grouped result list, shortcut chips (G R, ⌘K, Tab), footer hint "↑↓ pilih · ↵ buka · Tab untuk tanya Asisten", result items with meta and amounts, small progress bars for goals.

### 8. Open questions
Full list of "G x" shortcuts for other pages; which fields are indexed; whether ⌘K can execute commands directly (e.g. "Catat transfer" opens the form).

---

## E. Ask the Assistant ⌘J (AI, BYOK) (Section 15)

### 1. Summary & user goal
An AI chat panel using the user's own API key (BYOK: OpenRouter, ZenMux, or an OpenAI-compatible endpoint). The Assistant can answer questions based on transaction/budget data, record transactions via chat, and read receipts (image/PDF). The Assistant "selalu minta konfirmasi sebelum menyimpan transaksi" (always asks for confirmation before saving a transaction). Cost and tokens per message are shown, along with monthly usage against the limit ("$1,24 dari $5 bulan ini").

### 2. Screens & states
| Screen | Node id | Content | State |
|---|---|---|---|
| Asisten — tanya sisa anggaran | xvTmH | Answer + "Makan & Dapur" budget card, source chips, suggested actions | default/answer |
| Asisten — catat lewat chat | I3S0A | "Draft transaksi · belum disimpan" + impact; Ubah/Batal | awaiting confirmation |
| Asisten — struk duplikat | wBIPB | "Sepertinya transaksi ini sudah ada"; "Lampirkan ke transaksi itu / Tetap catat baru" | duplicate |
| Asisten — belum terhubung (BYOK) | QGATc | "Belum ada penyedia AI · Hubungkan AI agent dulu"; "Buka Pengaturan → AI agent" | not configured |
| Asisten — gagal terhubung | wpx0t | "OpenRouter tidak merespons · Timeout 30 detik · tidak ada biaya yang terpakai"; "Coba lagi · Ganti ke ZenMux" | error |
| Baca struk — seret file | FqH1q | "Lepas untuk membaca struk · JPG, PNG, PDF · maks. 10 MB" | drag-over |
| Baca struk — sedang membaca | mD6sJ | "Membaca struk… mengenali 4 item · perkiraan $0,009" | loading |
| Baca struk — draft dari struk | Q8bxz | Line items, one price flagged as unclear, suggested category, account "dari “Debit BCA”" | draft |
| Baca struk — tersimpan | nTDON | "Tersimpan … struk terlampir · Buka di Transaksi"; toast "Urungkan" (undo); "dicatat oleh Asisten, dikonfirmasi olehmu" | success |
| Baca struk — gagal dibaca | D1VXq | "buram & terpotong · Total dan tanggal tidak terbaca"; "Unggah ulang · Isi manual" | error |
| Mobile — Asisten | SNuu2 | Mobile version | mobile |

### 3. User flows
- **Ask**: ⌘J → "Berapa sisa anggaran Makan bulan ini?" → text answer + data card + context chips ("Anggaran Oktober · Transaksi 1–15 Okt") + suggestions ("Bandingkan dengan Sep", "Pasang pengingat").
- **Record via chat**: "Catat makan siang tadi 45.000 pakai GoPay" → draft card (category, account, time "Kam, 15 Okt · 12.10", impact) → confirm / Ubah / Batal.
- **Receipt**: drag or upload a file → reading → (a) duplicate detected: attach to the existing transaction or record as new anyway; (b) multi-item draft with uncertain fields flagged → user corrects ("Plester luka dikoreksi: Rp12.500 ✓") → Save → toast with Urungkan; (c) unreadable → re-upload or fill in manually.
- **Not connected** → direct to Settings → AI agent. **Failure** → retry or switch provider; the question is kept.

### 4. Data entities & fields
- **AiProviderConfig**: `provider` enum(openrouter, zenmux, openai_compatible), `base_url`, `api_key` (encrypted; the design says "disimpan terenkripsi di perangkat" (stored encrypted on the device)), `model` ("claude-sonnet-5.5"), `monthly_budget_usd` ($5), `fallback_provider`.
- **AiConversation / AiMessage**: `role`, `content`, `created_at` (16.38), `status` enum(sent, pending_confirmation, failed), `tokens_in`/`tokens_out` (2,1k → 180), `cost_usd` (decimal, $0,008), `model`, `attachments[]`, `context_refs[]` (source chips), `tool_calls`.
- **AiUsage** (monthly): `spent_usd` 1,24 / `limit_usd` 5.
- **TransactionDraft** (from the agent): `merchant`, `amount` bigint, `category_id` (+ "disarankan" (suggested)), `account_id` (mapped from receipt text "Debit BCA"), `occurred_at`, `note`, `line_items[]` {name, qty, price, `low_confidence` bool}, `attachment_id`, `source` = assistant. Transaction stores `created_by` = assistant and `confirmed_by` = user ("dicatat oleh Asisten, dikonfirmasi olehmu").
- **Attachment/Receipt**: `filename`, `mime` (JPG/PNG/PDF), `size` (≤10 MB; 2,1 MB), `ocr_status` enum(uploaded, reading, parsed, unreadable), `parsed_total`, `parsed_date`, `items_count`, `transaction_id`.
- **Reminder** (from "Pasang pengingat"): category, 100% threshold.

### 5. Business rules & calculations
- The agent never writes data without user confirmation. Saving goes through a draft, then save, and can be undone.
- Impact preview before saving: Makan & Dapur (3.200.000 + 45.000)/3.500.000 = 92,7% → **93%**; GoPay 412.000 − 45.000 = **367.000** "(di bawah batas Rp500.000)". Receipt: Kesehatan 96.500/500.000 = **19%**; Oct expenses 16.500.000 + 96.500 ≈ **16.600.000**.
- Budget answer: remaining 300.000 / 16 days ≈ **Rp19.000/day**; ideal on day 15 = 3.500.000 × 15/31 = **Rp1.690.000**; "18× · rata² Rp178.000" (3.200.000/18).
- Duplicate detection: same merchant + time + amount (Indomaret 15 Oct 07.55 Rp110.000) already recorded, so it is not recorded again.
- Receipt validation: total and date are required. Item amounts must be consistent with the total (unclear prices are flagged).
- Cost control: estimated cost shown before and after the request; $5 monthly limit; no cost on timeout; 30-second timeout.
- ⌘K search keeps working without AI.

### 6. Background jobs/scheduler & integrations
LLM via OpenRouter/ZenMux/OpenAI-compatible (vision for receipts). File upload to storage. Receipt reading can be synchronous with streaming or [INFERENCE] run as a BullMQ job. Monthly usage and cost aggregation; reset each month. Reminders set from chat are handled by the notification evaluator.

### 7. UI components
Chat side panel (header with model, provider, cost meter), user/assistant bubbles with timestamps, budget data card (progress + ideal line), context chips, suggested-action chips, transaction draft card (editable fields, impact, Simpan/Ubah/Batal), receipt card (thumbnail, items, uncertainty flag), duplicate card, dropzone overlay, reading progress, error card, configuration empty state, token/cost meta, input "Tanya atau minta catat transaksi…" + attachment, toast with Urungkan.

### 8. Open questions
- "Key disimpan terenkripsi di perangkat" conflicts with the server architecture (worker/VPS). Is the key stored in the browser (with LLM requests from the client), or stored encrypted on the server?
- Full list of agent tools: read, record transaction, set reminder, compare. Can the agent modify budgets or goals?
- When the $5 limit is reached: block or warn?
- Conversation history: kept per session or permanently?

---

## F. Sign-in & Onboarding (Section 16 [k5aeOF])

### 1. Summary & user goal
Authentication uses Google OAuth or email + password, with "Ingat perangkat ini selama 30 hari" (remember this device for 30 days), forgot-password via an email link, and an app lock with a PIN after 5 minutes of inactivity. A 5-step onboarding sets up profile and currency, period and income, opening account balances, and the first savings goal. Key message: "Dicatat manual, tanpa login ke bank. Data dienkripsi dan hanya milikmu." (recorded manually, no bank login; data is encrypted and yours only).

### 2. Screens & states
| Screen | Node id | Content | State |
|---|---|---|---|
| Masuk | GNOjT | Google, email, password, remember 30 days | default |
| Masuk — kata sandi salah | D0gWC | "Kata sandi salah · sisa 3 percobaan sebelum dikunci 15 menit" | error |
| Daftar | zPHkt | Name, Email, Password "Min. 10 karakter · kuat", consent to Terms & Privacy | default |
| Lupa kata sandi — email terkirim | L4tjTX | "Tautan berlaku 30 menit", "Kirim ulang dalam 0:42" | success/cooldown |
| Aplikasi terkunci (PIN) | z6Ce7 | Keypad, "Terkunci otomatis setelah 5 menit tidak aktif", "Lupa PIN? Masuk dengan kata sandi" | locked |
| Masuk — Google: pilih akun | j8qhCU | Account chooser; "Akses Gmail tidak termasuk — itu diminta terpisah di Pengaturan." | OAuth |
| Masuk — email terdaftar via Google | uoHuu | "Akun ini dibuat dengan Google … belum punya kata sandi"; "Kirim tautan atur kata sandi" | info |
| Onboarding 1 — profil & mata uang | CsGVt | Name, nickname, base currency, additional currencies, exchange rate, language, time zone | step 1/5 |
| Onboarding 2 — periode & pemasukan | N1A49s | Payday (1/25/28/Pick 1–28), average income | 2/5 |
| Onboarding 3 — rekening | VE8Zf | Accounts + today's balance | 3/5 |
| Onboarding 4 — tujuan pertama | RRyTG | Goal presets, target, stored in, recurring contribution; Lewati (skip) | 4/5 |
| Onboarding 5 — selesai | S53M66 | Setup summary + AI Assistant & password options | 5/5 |

### 3. User flows
- **Sign in → wrong password → sign up → forgot password → locked (PIN)**: email login (wrong → count attempts → 15-minute lock) / Sign up / Forgot → reset email → resend cooldown. PIN lock after 5 minutes idle; fallback to password.
- **Google → choose account → Google email without password**: OAuth (name, email, photo; no Gmail) → if the user tries to sign in with the email of a Google account that has no password, show the Google option or "Kirim tautan atur kata sandi".
- **Onboarding**: 1 Profile (prefilled from Google; "Email terverifikasi otomatis") → 2 Period ("Dipakai sebagai awal periode bulanan · Okt 2026 = 1–31 Okt"; income 25.800.000) → 3 Accounts (BCA Tahapan 42.810.000, Bank Jago 8.125.000, GoPay 412.000; "+ Mandiri · + OVO · + Tunai · + Lainnya…") → 4 Goal (Dana Darurat target 54.000.000 at Bank Jago, contribution Rp500.000 on the 1st of each month from BCA Tahapan; skippable via Lewati) → 5 Done → "Ke Ringkasan" ("catat transaksi pertama — tekan N di mana saja").

### 4. Data entities & fields
- **User**: `name` ("Avtara K."), `nickname` ("Avtara", used in the greeting "Selamat sore, Avtara"), `email`, `email_verified_at`, `avatar_url`, `password_hash` nullable, `plan` ("Paket Pribadi"), `base_currency` (IDR), `locale` (id), `timezone` (Asia/Jakarta, from the device), `onboarding_step`/`completed_at`.
- **OAuthAccount**: `provider` (google), `provider_user_id`, scope (profile; Gmail separate).
- **Session/TrustedDevice**: `remember_until` (+30 days), `device`.
- **LoginAttempt/Lockout**: `failed_count`, `locked_until` (+15 minutes).
- **PasswordResetToken**: `expires_at` (+30 minutes), resend throttle.
- **AppLock**: `pin_hash`, `idle_timeout` (5 minutes). [INFERENCE] PIN length is not visible (keypad 0–9).
- **UserCurrency**: `code` (USD, SGD), **FxSettings**: `mode` enum(otomatis, manual), `source` (Bank Indonesia JISDOR), **FxRate**: `pair`, `rate` (1 USD = Rp16.350, 1 SGD = Rp12.640), `as_of` ("hari ini 09.00").
- **Settings.period**: `start_day` from step 2; `avg_monthly_income` bigint (for budget suggestions, private).
- **Account**: `name`, `type` enum(bank, e-wallet, tunai, lainnya), `purpose`/note ("dipakai sehari-hari", "untuk dana darurat"), `currency`, `opening_balance` bigint, `opening_date` (today).
- **SavingsGoal**: `name`, `preset` enum(dana_darurat, liburan, dp_rumah), `target` bigint, `account_id` (Simpan di), **RecurringDeposit**: `amount` 500.000, `day` 1, `from_account_id`, needs-review status ("Perlu ditinjau tiap bulan dan tercatat setelah kamu konfirmasi").

### 5. Business rules & calculations
- Password minimum 10 characters, with a strength indicator.
- After several failures ("sisa 3 percobaan"), the account is locked for 15 minutes. [INFERENCE] The limit is 5 attempts total.
- Reset link valid for 30 minutes; there is a resend cooldown (0:42 remaining, [INFERENCE] 60 seconds).
- Google account without a password: the email is considered verified, so a set-password link can be sent directly.
- Available balance = sum of account balances: 42.810.000 + 8.125.000 + 412.000 = **Rp51.347.000**. Past transactions do not need to be entered.
- Emergency fund target = 3 × monthly expenses ≈ Rp54.000.000 (expenses ≈ Rp18 jt/month; [INFERENCE] derived from budget limits or from the entered income).
- Period start day is limited to 1–28.
- All totals, budgets, and reports are computed in the base currency; foreign currencies are converted using the exchange rate.
- Recurring contributions are not posted automatically: they must be reviewed and confirmed.

### 6. Background jobs/scheduler & integrations
Google OAuth; email delivery (reset, verification); daily automatic exchange rate sync (BI JISDOR, "09.00"); recurring contribution reminders/review on their dates; cleanup of expired tokens/lockouts.

### 7. UI components
Split auth layout (brand panel with sample metric cards + form), Google button, "atau" (or) divider, inputs with inline errors, remember-device checkbox, password strength meter, success card with countdown, PIN keypad, 5-step stepper, date choice chips, "Rp" money input, editable account list + quick-add chips, goal preset cards, checklist summary in the Done step, Lanjut/Kembali/Lewati (next/back/skip) buttons.

### 8. Open questions
- Is there email verification for email (non-Google) sign-ups?
- When is the PIN set? There is no PIN setup step in onboarding. Is the PIN optional?
- Onboarding for non-Google users (step 1 without Google data) is not designed yet.
- The old row label "1 preferensi → 2 rekening → 3 tujuan → 4 selesai" is inconsistent with the actual 5 steps; treat the 5 steps as final.
- "Data dienkripsi": at-rest encryption only, or end-to-end?

---

## G. Mobile version (Section 17 [HtRXc])

### 1. Summary & user goal
Mobile version (390x844) with a 4-item tab bar "Ringkasan · Transaksi · Tabungan · Lainnya" and a keypad-style record-transaction form. Other pages are reached via the "Lainnya" (more) menu. Notification, skeleton, and offline states are available, plus light and dark themes.

### 2. Screens & states
| Screen | Node id | Content | State |
|---|---|---|---|
| Mobile Tab Bar | XI2Pw | Ringkasan · Transaksi · Tabungan · Lainnya | component |
| Mobile — Ringkasan | dwg18 | KPIs, Accounts & wallets, Budget (top 3), Recent transactions | default (dark) |
| Mobile — Ringkasan (terang) | R2bkF | Same, light theme | theme |
| Mobile — Transaksi | ULYTm | Search "merchant, catatan, #tag", filter Keluar/Masuk/Transfer, totals, grouped by day | default |
| Mobile — Catat transaksi | K2Blg | Type, amount, impact, category chips, account, time, keypad with "000", "Simpan pengeluaran" | form |
| Mobile — Tabungan | GFTyB | Total collected, goal cards | default |
| Mobile — Asisten | SNuu2 | Compact chat, "$1,24/$5" | default |
| Mobile — Lainnya | b17pqN | Profile, KEUANGAN menu (Budget remaining Rp2.250.000, Subscriptions 7, Calendar, Investments Rp61.400.000, Reports, Debts & installments Rp0), ALAT (Tanya Asisten, Sembunyikan saldo), AKUN (Pengaturan, Keluar) | menu |
| Mobile — Notifikasi | JRmIg | Full-screen notification list | default |
| Mobile — Ringkasan skeleton | EheUc | Skeleton | loading |
| Mobile — Offline | ugGfr | "Kamu offline · Data terakhir 15 Okt 16.40 · catatan baru disimpan di perangkat" | offline |

### 3. User flows
Overview → Transactions → Record (FAB/center button [INFERENCE]) → Savings goals → Assistant → Overview (light); Lainnya opens secondary pages. While offline, the user can still record; data is stored locally and synced when back online.

### 4. Data entities & fields
Same as web. Additions: preference `hide_balances` bool ("Sembunyikan saldo"), `theme` enum(gelap, terang); **OfflineQueue** [INFERENCE] (local transaction drafts + `last_synced_at` "15 Okt 16.40").

### 5. Business rules
- Impact preview while recording: "Makan & Dapur jadi 93% · GoPay sisa Rp367.000" (same formula as the Assistant).
- Transactions header totals: +Rp26.000.000 / −Rp16.500.000 for the 1–15 Oct period. Per-day subtotals ("Kamis, 15 Okt · −Rp180.000").
- Transfers are shown as neutral ("Ke Bibit RDPU · Transfer · #dana-darurat · Rp3.000.000").
- Lainnya shows the meta "periode mulai tgl 1".

### 6. Background jobs/scheduler & integrations
Offline queue sync (client → server, idempotency-key dedup [INFERENCE]); [INFERENCE] PWA service worker. Push notifications not yet visible.

### 7. UI components
Bottom tab bar, 2×2 KPI grid, account cards, compact budget progress, transaction list grouped by day, segmented filter, search bar, numeric keypad, category chips, record bottom sheet/form, goal cards with progress, grouped menu list with right-aligned values, offline banner, skeleton, light/dark theme variants.

### 8. Open questions
- Native app or PWA/responsive web? The design does not say.
- How to open Record and the Assistant on mobile: the tab bar has only 4 items (FAB?).
- Offline scope: recording transactions only, or editing too? How are conflicts handled?
- Mobile versions of the Budget, Calendar, Investments, and Reports pages are not designed (only links in Lainnya).
- How to trigger ⌘K/global search on mobile.
