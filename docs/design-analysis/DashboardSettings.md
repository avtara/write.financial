# Section 02 Analysis — Dashboard, Quick Add bar & Settings (including Gmail)

Source: `/tmp/digest/02-dashboard.md` (Section n1V9y). All numbers are quoted from the design. Guesses are marked [INFERENCE].

---

## A. Dashboard (Overview) — Month / Week / Year period

### 1. Summary & user goal
The home page ("Ringkasan") shows the financial state for one period: KPIs (Income, Expenses, Saved & Invested, Saving Rate), account balances, Money Flow (Sankey), spending by category, 6-month trend, budget, spending calendar, and subscriptions. The user can switch the period (Week/Month/Year), rearrange cards, and record transactions directly from the Quick Add bar.

### 2. Screens & states
| Screen | Node id | Content/purpose | State |
|---|---|---|---|
| write.financial — Dashboard (Bulan) | iUqiN | Period "1–15 Oktober 2026", all cards | default |
| Dashboard — Minggu | tBbvD | "12–18 Oktober 2026", weekly budget, per-day calendar, week composition | default (week period) |
| Dashboard — Tahun | g9BK2 | "Januari–Oktober 2026", monthly chart Jan–Dec, 2026 calendar by month, yearly insights | default (year period) |
| Dashboard — Pilih Periode | FCcZd | 2026 month-grid popover + total spending (millions) per month; shortcuts Bulan ini/Bulan lalu/Rentang khusus… | popover |
| Dashboard — Menu Pengguna (terbuka) | zm4dg | email, "Pribadi", Pengaturan ⌘, , Keluar | dropdown |
| Dashboard — Konfirmasi keluar | LpVa1 | sign-out dialog + option "Keluar dari semua perangkat" (sign out of all devices) | dialog |
| Dashboard — Menu Pengguna (mode terang) | GiHqy | same, light theme | dropdown (light) |
| Arus Uang — Filter Kebutuhan/Keinginan/Tabungan | UOdxM / ue2v6 / E8xo3g | Sankey filtered to one group | filter active |
| Arus Uang — Menu ⋯ | q1pusQ | Buka di Laporan, Unduh PNG, Salin gambar ⌘C, Tampilkan nilai Rupiah/Persen, Tampilkan sumber <1%, Hitung transfer antar rekening | menu |
| Arus Uang — Hover aliran | fqzal | tooltip "Kebutuhan → Makan & Dapur" | hover |
| Pemasukan vs Pengeluaran — Hover Sep | SGcTm | month tooltip | hover |
| Kalender — Navigasi ke September | jXuuE | another month's calendar + summary | navigation |
| Dashboard — Kosong (pengguna baru) | olRpH | 3-step onboarding | empty |
| Dashboard — Memuat | CdNBN | "Memuat ringkasan 1–15 Oktober 2026…" | loading (skeleton) |
| Dashboard — Memperbarui data (ganti periode) | IKIBD | "Memperbarui ringkasan…" over old data | partial loading |
| Dashboard — Gagal memuat (offline) | I2SEfl | "Kamu sedang offline", code `NETWORK_OFFLINE` | error |
| Dashboard — Mode atur | iBCvF | arrange layout, 1 hidden card | edit |
| Dashboard — Seret kartu | e1r8q | drag Subscriptions to the left of Calendar | drag |
| Dashboard — Kelola kartu | GcXr5 | card list panel, visibility toggle, width ⅓/⅔/Penuh | dialog |
| Dashboard — Tata letak tersimpan | R1aqQ | toast + Urungkan (Undo) | success |

### 3. User flows
- **Switch period**: click Minggu/Bulan/Tahun → state "Memperbarui ringkasan…" → all cards recalculated. Click label "Okt 2026" → Pilih Periode popover (month grid with spending totals, "Nov · —" no data yet) → Bulan ini / Bulan lalu (Sep 2026) / Rentang khusus….
- **User menu → sign out**: click avatar "AK Avtara K. · Paket Pribadi" → menu (email, Pribadi, Pengaturan ⌘,) → Keluar → dialog "Keluar dari write.financial?" with checkbox "Keluar dari semua perangkat · Aktif di 2 perangkat lain · iPhone, MacBook" → Batal/Keluar.
- **Money Flow interaction**: chips Semua/Kebutuhan/Keinginan/Tabungan → filter; hover a band → tooltip; click → "lihat 18 transaksi"; ⋯ menu → export/display options.
- **Calendar**: month navigation; click a date → detail panel ("Minggu, 11 Oktober · 5 transaksi · Rp3.380.000 · 3× rata-rata") listing transactions with tags & times.
- **Arrange dashboard**: Atur → arrange mode (drag ⋮⋮, click the eye to hide) → drag a card ("Lepas untuk memindah Langganan ke kiri Kalender Pengeluaran") → Kelola kartu (toggle, order, width) → Simpan tata letak → toast "Langganan dipindah ke kiri · Pemasukan vs Pengeluaran disembunyikan · Urungkan". There is "Reset ke default".
- **New user**: Empty → Step 1 Add account (± 1 minute) → Step 2 Record transaction (locked: "Butuh rekening dulu" (needs an account first)) → Step 3 Set budget; option "Impor mutasi CSV · Bisa dilewati" (import CSV statement · skippable).
- **Offline**: "Coba lagi" or "Lihat data terakhir · 15 Okt 16.40".

### 4. Data entities & fields
- **User/Profile**: display_name ("Avtara K."), nickname ("Avtara"), plan ("Paket Pribadi"), workspace ("Pribadi"; [INFERENCE] there is a workspace/space concept, only one visible).
- **Account**: name ("BCA Tahapan"), type enum (Bank, E-Wallet, Tunai, Investasi), masked_number ("•• 4821", "0812•• 18"), currency (IDR/USD), balance bigint, period delta ("+Rp1.200.000 bulan ini"), linked goals ("4 tujuan", "Dana Darurat"), platform count for investments ("IDR + USD · 5 platform · dalam IDR · Rp61.420.000 · +Rp6.000.000 disetor Okt").
- **Transaction**: type enum keluar/masuk/transfer, amount bigint, category_id, account_id (from/to for transfers), occurred_at (date+time, e.g. "14.12"), note, merchant/description ("Erafone — Headphone"), tags[] ("gadget", "kerja"), status ("Perlu ditinjau" — from Subscriptions/Gmail).
- **Category**: name, group enum (Kebutuhan/Keinginan/Tabungan; income: Gaji, Freelance, Penjualan & lainnya, Dividen & bunga, THR), "TETAP" (fixed) flag (Sewa Kos "lunas 1 Okt"), monthly_budget bigint.
- **Subscription** (Subscriptions card): name, plan ("Premium 4K", "Family", "Individu", "Plus", "Gym bulanan", "200 GB"), price bigint, next_bill_date, status ("Lunas"), usage ("dibuka 2× dalam 30 hari" [INFERENCE] usage data source is unclear).
- **DashboardLayout** (per user): card list {key, visible bool, order int, width enum ⅓/⅔/Penuh}; available cards: Quick Add bar (fixed at top), KPI Overview (fixed at top), Accounts & wallets, Money Flow, Spending by Category, Income vs Expenses, Category Budget, Subscriptions, Spending Calendar; addable: Investments summary, Savings goals, Bill reminders ("7 hari ke depan"). "Tersimpan di akunmu" (saved to your account).
- **Onboarding progress**: steps completed (0/3).

### 5. Business rules & calculations
- **Saved & Invested = Income − Expenses**: 26.000.000 − 16.500.000 = 9.500.000 (Oct); year 262,5 jt − 187,7 jt = 74,8 jt.
- **Saving rate = saved / income**: 9,5/26 = 36,5% (target 30%); week 4,41/6,2 = 71,1%; year 74,8/262,5 = 28,5%.
- **Comparison**: Month "vs Sep" (+4,1%, −9,8%, +27%); Week "vs mgg lalu" and spending "vs Sen–Kam lalu" (current period compared with the same day range, like-for-like); Year "vs 2025".
- **Money Flow (Sankey)**: income sources → Needs/Wants/Savings → categories. Percent = value/income (Needs 10,4 jt = 40%, Wants 6,1 jt = 23%, Savings 9,5 jt = 37%). Hover: group share (Makan 3,2/10,4 = 31%), average transaction 3.200.000/18 = Rp178.000, budget progress "3.200.000 / 3.500.000". Sources < 1% hidden by default ("Dividen & bunga <1%"). **Transfers between accounts are not counted** (optional in the menu). Week: "Belum dialokasikan Rp1.410.000, tetap di rekening" (income not yet spent/contributed).
- **Remaining budget per day** = (limit − spent) / remaining days in period including today: Makan (3.500.000 − 3.200.000)/16 days (16–31 Oct) ≈ Rp19.000; Hiburan 400.000/16 = Rp25.000; Transportasi 600.000/16 ≈ Rp38.000. Fixed categories: "lunas" (paid). Over: 2.400.000/2.000.000 = 120% "lewat Rp400.000".
- **Over-budget projection**: "akan lewat Rp566.000" (90%, 900.000/1.000.000) — the projection formula cannot be reconstructed from the numbers (linear pace 900k/15×31 ≈ 1,86 jt → over by 860k) [INFERENCE: may account for scheduled bills]; see open questions.
- **Weekly budget = monthly limit / 4,4**: 3.500.000→795.000, 2.000.000→455.000, 2.500.000→568.000, 1.000.000→227.000. Status "1 hampir habis" (1 almost used up). Yearly budget = monthly limit × 10 elapsed months (Jan–Oct): 3,5 jt→35 jt.
- **Calendar daily average** = period spending / number of days: Oct 16,5 jt/15 = 1,1 jt; Sep 18,3 jt/30 = 610.000; 2026 187,7 jt/304 days ≈ 617.000. Markers "3× rata-rata", "Hari terboros" (biggest spending day), surplus days (income > expenses, e.g. "+13.650.000" 1 Oct), "tanpa belanja" (no spending), legend Sedikit/Banyak/Surplus/Setoran tabungan/Tagihan terjadwal. Year: "Hari hemat 41 hari di bawah Rp300.000", "Akhir pekan 2,4× lebih boros dari hari kerja".
- **Income vs Expenses (6 months)**: average savings Rp6.800.000/month; Sep tooltip: difference +7,5 jt, savings ratio 7,5/25,8 = 29%, "+8,3% belanja vs Agustus"; "Tren pengeluaran −7,3% / 3 bulan".
- **Subscriptions**: Per month = sum of monthly subscriptions = 186.000 + 86.900 + 59.000 + 329.000 + 199.000 + 45.000 = Rp904.900; Per year = 904.900×12 + yearly subscriptions Rp660.900 = Rp11.520.000. Countdown "3 hari lagi". Savings tip: YouTube 59.000×12 = Rp708.000/year. 6-month subscription cost chart "+24%".
- **Time-based greeting**: "Selamat sore" [INFERENCE: from the user's local time zone].
- **Currency**: IDR+USD balances displayed "dalam IDR" (in IDR) using the Settings exchange rate. "Saldo tersedia · tanpa investasi Rp55.023.000".

### 6. Background jobs/scheduler & integrations
- Per-period overview aggregation ("Diperbarui 15 Okt 2026, 16.42") — [INFERENCE] could be computed on demand or cached/materialized; the timestamp implies a snapshot.
- Client-side offline queue: "Transaksi yang kamu catat tetap disimpan di perangkat dan dikirim saat online lagi" (sync from the client, not a worker).
- Exchange rate for converting USD balances (see Settings exchange rate).
- Subscription insight "hanya dibuka 2× dalam 30 hari" [INFERENCE: no usage data source in the design].

### 7. UI components
Navigation sidebar (badges Transactions 128, Subscriptions 7; Cari ⌘K; Tanya Asisten ⌘J), period segmented control, month picker popover, KPI card with delta badge, account card, Sankey chart with filter chips + tooltip + ⋯ menu, budget progress bar, bar/line chart with tooltip, calendar heatmap + day detail panel, subscription list with letter avatars, tip banner, user menu dropdown, confirm dialog, skeleton, offline banner, toast with Urungkan, drag-and-drop edit mode, Kelola kartu panel (toggle + width choice), onboarding stepper empty state.

### 8. Open questions
- Formula for "akan lewat Rp566.000".
- Does the "Bulan" period follow "Periode bulanan" (Monthly period; the Settings menu item exists but has no screen) — e.g. month start = payday?
- "Rentang khusus…" (custom range) has no screen.
- Does the weekly budget use a fixed 4,4 factor or actual days?
- Data source for "dibuka 2× dalam 30 hari".
- Workspace "Pribadi" in the menu: is there multi-workspace?

---

## B. Quick Add bar (bar on the Dashboard)

### 1. Summary
A single-line input bar at the top of the Dashboard (shortcut **N**) to quickly record Keluar/Masuk/Transfer (expense/income/transfer): amount, category, date, note, Simpan (↵).

### 2. Screens & states
| Screen | Node | Content | State |
|---|---|---|---|
| Default bar (Keluar) | iUqiN | "Rp 85.000 · Makan & Dapur · Hari ini · Catatan, mis. makan siang · Simpan ↵" | default |
| Catat Cepat: Masuk | g7ND9q | "+Rp 6.200.000 · Dari · Ke · Catatan" | Masuk tab |
| Catat Cepat: Transfer | V7jC0w | "Dari · Ke · Bibit RDPU · Catatan" | Transfer tab |
| Pilih Kategori | BOkCJ | search, KEBUTUHAN/KEINGINAN groups, remaining budget info per category, "Buat kategori pengeluaran", ↑↓ navigation | popover |
| Pilih Tanggal | xALG8 | shortcuts Hari ini/Kemarin/2 hari lalu/Sabtu lalu/Awal bulan, Jadwalkan, calendar ("ada transaksi" dots), Time + "Sekarang" | popover |
| Tersimpan | XZ54L | toast "Transaksi tersimpan · Makan & Dapur · −Rp85.000 · BCA Tahapan · Urungkan" | success |
| Empty amount | p4AWD | "Isi jumlah dulu sebelum menyimpan" | validation error |

### 3. Flow
Type amount → pick category (keyboard ↑↓, Esc) → pick date/time (optional, can "Jadwalkan" (schedule) into the future) → note → ↵ → toast + Urungkan. Masuk: Dari (income source/category [INFERENCE]) and Ke (account). Transfer: Dari account → Ke account (e.g. "Bibit RDPU", an investment account).

### 4. Entities
Transaction {type, amount bigint, category_id (keluar/masuk), from_account_id, to_account_id, occurred_at timestamptz, note, is_scheduled [INFERENCE from "Jadwalkan"]}. Default account ("BCA Tahapan") [INFERENCE: default/last-used account].

### 5. Business rules
- Amount required > 0.
- The category popover shows budget status: "sisa anggaran Rp300.000", "lewat anggaran Rp400.000", "akan lewat anggaran Rp566.000" (with the amount being typed added [INFERENCE]).
- Auto rules run when saving via the Quick Add bar (see Settings › Auto rules).
- Transfers are not counted as income/expenses.

### 6. Jobs
Scheduled transactions ("Jadwalkan") need a job to post/flag them when due [INFERENCE].

### 7. Components
Keluar/Masuk/Transfer segmented tabs, Rp-prefixed amount input, category combobox with keyboard hints, date-time picker with shortcuts, kbd hints (N, ↵, Esc), undo toast, inline validation.

### 8. Questions
Account selection for Keluar is not visible in the bar (the toast mentions BCA Tahapan) — where does it come from? What does "Jadwalkan" do (goes to the Review queue?).

---

## C. New Subscription (dialog from the Dashboard)

### 1. Summary
Dialog that creates a recurring bill; it appears on the calendar and enters "Perlu ditinjau" (needs review) when due; supports free trial periods.

### 2. Screens & states
| Screen | Node | Content | State |
|---|---|---|---|
| Tambah Langganan | AzWY9 | standard form | default dialog |
| uji coba gratis aktif | oEASr | 14-day trial + timeline | toggle on |
| uji coba — Lainnya | fYcJR | custom days input (21) | custom input |

### 3. Flow
Fill Layanan (free text, "Disney+ Hotstar") → logo (Unggah PNG / Pakai ikon) → Harga → Siklus (Bulanan/Tahunan/Mingguan) → Tagihan berikutnya → Bayar dari (account) → Kategori → Deskripsi (optional) → Ingatkan (3 days before, notification) → optional Masa uji coba (7 hari/14 hari/1 bulan/Lainnya) → Simpan langganan.

### 4. Entities
Subscription {service_name text, logo (upload|icon), price bigint, cycle enum(weekly, monthly, yearly), next_bill_date date (label changes to "Tagihan pertama" (first bill) during a trial), pay_from_account_id, category_id, description?, remind_days_before int (3), remind_channel (notification), trial_days int?, trial_start date}.

### 5. Rules
- First bill = start + trial duration, billed the next day: 17 Oct + 14 days → "Min, 1 Nov 2026"; 21 days → "Min, 8 Nov 2026". Reminder = bill − 3 days (29 Oct; 5 Nov). Summary "Gratis 14 hari · lalu Rp39.000/bulan".
- When due → transaction with status "Perlu ditinjau"; **the balance is only deducted after it is marked as paid**.

### 6. Jobs
D-N reminder; creating the "Perlu ditinjau" bill when due; rolling over next_bill_date per cycle.

### 7. Components
Form modal, logo uploader, cycle segmented control, date picker, account/category select, toggle + duration chips, trial timeline (17 Okt → 🔔 Diingatkan → Ditagih).

### 8. Questions
Is "Tagihan berikutnya" (next bill) computed automatically by default? Cancellation behavior during the trial?

---

## D. Settings (sub-features)

General layout: header "Pengaturan · Akun, mata uang & kurs, tampilan, notifikasi, dan data — tersinkron di semua perangkat"; left nav: AKUN (Profil & akun), PREFERENSI (Mata uang & kurs, Periode bulanan, Tampilan, Notifikasi, Kategori, Tag, Aturan otomatis), DATA (Data & cadangan, Keamanan), INTEGRASI (AI agent (BYOK), API kurs & pasar, Gmail), LAINNYA (Pintasan keyboard, Bantuan & tentang). Sticky footer: "Tersinkron ke semua perangkat · Batal · Simpan perubahan" (state "Ada perubahan belum disimpan" / "Belum disimpan" (unsaved changes)). Opened from the user menu or ⌘, .

### 1. Summary
Hub for account and app preferences, stored on the server per user and synced across devices; changes are edited as a draft and then saved explicitly.

### 2. Screens & states
| Screen | Node | Content | State |
|---|---|---|---|
| Profil & akun | bcBrM | photo, name, greeting name, language, time zone, email, sign-in methods | default (password set) |
| Profil — Google, kata sandi belum diatur | zAsMe | banner "Atur kata sandi sebagai cadangan · Nanti" (set a backup password · Later) | default Google-only account |
| Profil — atur kata sandi | yPz2Z | inline form new password + repeat, meter "13 karakter · kuat" | edit |
| Profil — kata sandi tersimpan | S0XrWl | toast/dialog "Kata sandi diatur … Oke" | success |
| Mata uang & kurs | cqz0s | base currency, other currencies, Otomatis exchange rate mode | default |
| — pilih mata uang utama | T67Pn | currency dropdown | dropdown |
| — kurs manual | BkgXr | Manual mode, effective from, exchange rate input | edit, unsaved |
| Tampilan | ODH9k | theme, number/date format, week start, hide balances | default |
| Tampilan — sembunyikan saldo aktif | Trbov | toggle on + Intip (Peek balance) explanation | dirty |
| Notifikasi | HNPLN | reminders & summaries, channel | default |
| — pilih waktu pengingat tagihan | gK5Rk | H-3 / H-1 / Hari H, time 09.00 | popover |
| — ubah jam pengingat | punnX | 07.00…20.00 / Jam lain | popover |
| — ambang peringatan anggaran | PIDcm | 50% / 80% (+100%) | popover |
| Kategori | YnLF6 | list Expenses (12) / Income (4), drag to reorder | default |
| — menu ⋯ Belanja Online | iHweD | Edit (E), Pindah ke Kebutuhan, Lihat transaksi, Gabungkan dengan…, Arsipkan, Hapus | menu |
| — hapus (konfirmasi) | g8bxL | deletion impact | destructive dialog |
| — dihapus (toast) | fDbls | "12 transaksi perlu ditinjau · Tinjau"; count becomes 11 | success |
| — kategori baru | zGTve | category form + preview | dialog |
| — pilih warna | h4zLb8 | palette + hex "14B8A6", "Terakhir dipakai" (recently used) | popover |
| Tag | k2GrzG | tag table, merge suggestion | default |
| Tag — gabungkan 3 tag | Q283b | merge dialog | dialog |
| Aturan otomatis | HXDL7 | ordered rule list, suggestions | default |
| — edit "Berangkat ke kantor" | evJtJ | IF/THEN (JIKA/MAKA) editor + preview | edit |
| — tersimpan | RjTTZ | toast + Urungkan | success |
| — gagal menyimpan | h7hnWe | toast "Koneksi terputus… Coba lagi" | error |
| Data & cadangan | Svmyv | export/import, backups, danger zone | default |
| Keamanan | pdmek | app lock, password, active devices | default |
| Pintasan keyboard | MoQlc | shortcut list | default |
| Bantuan & tentang | R4rZFa | help, version | default |
| AI agent (BYOK) | MXnjE | provider, API key, model, permissions & limits | connected |
| AI agent — ZenMux gagal | l1nyC | 401 error | error |
| AI agent — log | GpdeI | agent activity table | log |
| AI agent — log detail baca struk | OJaxo | request detail + tool call | detail |
| API kurs & pasar | W6ThPJ | 3 price data providers | default (quota warning) |
| API kurs — log | iCbPR | request log | log |
| API kurs — log detail 429 | eDyYC | rate limit response detail | error detail |
| Gmail (4 screens + toast) | bCdNA, kHEuC, D6NOl8, DS1LC, ukKey | see section E | — |

### 3. User flows
- **Profil & akun → password**: account registered via Google → suggestion banner → "Atur kata sandi" → enter new password + repeat ("tidak perlu verifikasi email lagi" (no further email verification needed)) → Simpan kata sandi → "Sekarang kamu bisa masuk dengan Google atau avtara.k@gmail.com + kata sandi" → status "Diatur · baru saja".
- **Currency & exchange rate**: choose base currency (dropdown) → Otomatis mode (BI JISDOR, "Perbarui sekarang") or Manual (enter rate, "Berlaku sejak 1 Okt 2026", compared vs BI) → Save.
- **Display**: choose theme Terang/Gelap/Sistem, number format (Rp1.234.567 or Rp1,2jt), date format, week start (Senin), Sembunyikan saldo (hide balances) toggle → Save.
- **Notifications**: configure bill reminders (H-3/H-1/Hari H + time), budget threshold, low balance (500.000), weekly summary, channel Push/Email/Keduanya.
- **Categories**: drag to reorder → ⋯ → Hapus → impact dialog → toast "Tinjau"; or Kategori baru → Jenis, Nama, Kelompok, Ikon, Warna, Anggaran → Buat kategori.
- **Tags**: view statistics → banner "3 tag terlihat sama" (3 tags look alike) → Tinjau & gabungkan → choose target tag ("paling sering" (most used)) → Gabungkan 3 tag.
- **Auto rules**: view list (Aktif 9 / Nonaktif 1) → suggestions from corrections ("Buat aturan"/"Abaikan") → edit rule → October preview → option "Terapkan ke transaksi lama" (apply to past transactions) → Save → success/failure toast.
- **Data**: Ekspor…, Impor…, Pilih cadangan untuk pulihkan, Hapus transaksi.
- **Security**: app lock toggle, auto lock, change password, sign out a device / all other devices.
- **AI agent BYOK**: choose provider (OpenRouter/ZenMux/Custom) → API key → Tes → choose model → permissions & cost limit → view log → detail.
- **Exchange rate & market API**: configure provider per asset class → view log → error detail.

### 4. Data entities & fields
- **UserProfile**: avatar_url (from Google, upload JPG/PNG ≤ 2 MB), full_name text ("dipakai di laporan PDF" (used in PDF reports)), nickname text, language enum (id), timezone text IANA ("Asia/Jakarta (WIB)"), email (immutable, verified bool).
- **AuthIdentity**: provider enum (google, password), email, linked_at ("terhubung sejak Apr 2026"), is_primary ("Utama"), password_set bool, password_changed_at ("terakhir diubah 3 bulan lalu").
- **Session/Device**: device_name ("MacBook Pro", "iPhone 15", "iPad Air"), browser ("Chrome"), location (Jakarta/Bandung), last_active_at, is_current.
- **CurrencySettings**: base_currency (IDR), other_currencies[] (USD, SGD — "terdeteksi dari rekening & investasimu" (detected from your accounts & investments)), rate_mode enum(auto, manual).
- **FxRate**: base, quote, rate numeric (Rp16.350 per USD), source ("Bank Indonesia · JISDOR"), fetched_at ("15 Okt 2026, 09.00 WIB"), change_pct (+0,4%), is_manual, effective_from date ("1 Okt 2026"). Rates are stored as numeric/decimal, not minor units.
- **DisplaySettings**: theme enum(light, dark, system), number_format enum(full, compact), date_format ("15 Okt 2026"), week_start enum (Senin), hide_balances bool.
- **NotificationSettings**: bill_reminder {enabled, offset enum(H-3, H-1, H), time time (09.00)}, budget_alert {enabled, thresholds int[] (80, 100; option 50)}, low_balance {enabled, threshold bigint 500.000}, weekly_summary {enabled, Monday morning}, channel enum(push, email, both).
- **Category**: type enum(expense, income), name varchar(24), group enum(Kebutuhan, Keinginan, Tabungan) [for expenses], icon, color hex, monthly_budget bigint? , sort_order int, archived bool, is_fixed [INFERENCE from "TETAP"].
- **Tag**: name, usage_count (142×), usage_this_month (21×), last_used_at, is_system ("otomatis · SISTEM"), aliases[] ("nama lamanya tetap dikenali saat kamu mengetik" (old name still recognized while typing)).
- **AutoRule**: name, order int (position 6), active bool, conditions[] {field enum(deskripsi, hari, jam, rekening, arah masuk/keluar, langganan terdaftar), operator (berisi salah satu, salah satu, sebelum), values[]}, logic "semua harus terpenuhi" (AND), actions[] {set_category, add_tag}, match_count_month ("14×"). RuleSuggestion {pattern "Kopi Kenangan", from_category, to_category, count 4}.
- **Backup**: created_at, size ("2,4 MB"), retention 30, frequency "Setiap hari" (daily) 03.00 WIB.
- **SecuritySettings**: app_lock bool (PIN/Face ID), auto_lock_after enum ("Setelah 5 menit").
- **AiProviderConnection**: provider enum(openrouter, zenmux, custom OpenAI-compatible), api_key (encrypted, displayed "sk-or-v1-••••3f9a"), added_at, status (Terhubung/Gagal + code 401), model ("anthropic/claude-sonnet-5.5"), allow_read_financial bool, allow_write_transactions bool, require_confirmation bool, monthly_cost_limit_usd numeric (5,00), usage (312 requests, $1,24).
- **AiAgentLog**: time, feature enum(Chat, Baca struk, Kategorisasi, Tes koneksi), detail, model, provider, tokens_in/out, cost_usd, duration, status (OK, 401, Dikonfirmasi), data_sent summary, tool_call ("buat_transaksi_draft {merchant, jumlah, kategori, rekening, tanggal}"). "Isi prompt & respons hanya disimpan di perangkat ini" (prompt & response content stored only on this device).
- **MarketDataProvider**: asset_class enum(fx, stocks/ETF, crypto), provider (BI JISDOR, Yahoo Finance, CoinGecko), api_key? (optional), frequency (Harian 09.00, 15 menit, 5 menit), active, last_run, quota_used/limit (8.000/10.000), alert "Batas 80%".
- **MarketDataLog**: time, source, request ("GET /simple/price btc,eth,sol → idr"), status (200, 429, 504), duration, retry attempt (1/3), fallback ("pakai harga 15.57"), response body; 30-day retention, key masked.

### 5. Business rules & calculations
- The base currency is used for all totals; other balances are converted using the exchange rate. Manual: "Kurs tetap dipakai sampai kamu mengubahnya" (rate stays in use until you change it); difference vs BI = (16.200 − 16.350)/16.350 = −0,9%.
- Compact number format: Rp1.234.567 → "Rp1,2jt".
- Hide balances: all amounts become "Rp ••••"; Intip (Peek balance) button in the header to view briefly.
- Budget alert when spending reaches 80% & 100% (option 50%), "Berlaku untuk semua kategori" (applies to all categories).
- Deleting a category: transactions remain (balances/reports unchanged), all of them go to "Perlu ditinjau", the category budget is deleted too (Belanja Online Rp2.000.000/month). Cannot be undone.
- Category name max 24 characters.
- Merging tags: transactions move to the target tag (16 = 12+3+1), other tags are deleted, old names become aliases, per-tag reports for July–September are recalculated. Similar-tag detection ("3 tag terlihat sama").
- Auto rules: run in order when a transaction is recorded via the Quick Add bar, Assistant, receipt, or statement import (and Gmail). **Category: the topmost matching rule wins; Tags: union of all matching rules.** Conditions within one rule = AND. The preview explains why something does not match ("bukan gojek/krl", "hari Minggu"). By default applies to new transactions; "Terapkan ke transaksi lama" is optional. Rule suggestions from ≥N manual corrections (example 4×).
- Password: strength meter; Google account already verified → password active immediately.
- Delete all transactions: accounts, categories & budgets are kept.
- AI: monthly cost limit in USD; "Selalu minta konfirmasi sebelum menyimpan" (always ask for confirmation before saving; the agent creates a draft).
- API quota: warning at ≥ 80% (8.000/10.000); automatic retry up to 3× for 429 (honors `retry-after: 30`); 10 s timeout → fall back to last price.

### 6. Background jobs/scheduler & integrations
- Daily exchange rate sync at 09.00 WIB from BI JISDOR (+ manual "Perbarui sekarang").
- Stock/ETF prices (Yahoo Finance) every 15 minutes; crypto (CoinGecko) every 5 minutes; retry/backoff, logging, quota monitoring.
- Bill reminders (H-3/H-1/Hari H at the chosen time, user timezone).
- Budget alerts (event-driven when a transaction comes in) and low balance.
- Weekly summary every Monday morning via push/email.
- Automatic daily backup at 03.00 WIB, retention 30; restore.
- Export (CSV/Excel/PDF) and CSV statement import — [INFERENCE] run as async jobs.
- Report recalculation after tag merge; applying rules to past transactions.
- Device session revocation. 30-day log retention (periodic cleanup).

### 7. UI components
Settings shell (grouped left nav + sticky save footer with dirty state), form row (label + hint + control), toggle, segmented control, select/dropdown, time/threshold choice popover, money & exchange rate input, color picker (palette + hex + recently used), icon picker, sortable list (drag), ⋯ menu with shortcuts, destructive confirm dialog with impact summary, toast with actions (Tinjau/Urungkan/Coba lagi), tag table, IF/THEN (JIKA/MAKA) rule builder with value chips, match/no-match preview panel, provider card with status badge, masked secret input + Tes, usage meter, log table with filters + JSON detail panel + Salin + Ekspor CSV, info banner (Atur kata sandi), device list.

### 8. Open questions
- **Monthly period** is in the nav but has no screen (custom month start date?).
- Push notification type: web push / mobile app? Is there a native app (iPhone, iPad are mentioned as devices)?
- App lock (PIN/Face ID) is "di perangkat ini" (on this device) — but the footer says "Tersinkron ke semua perangkat"; which settings are local?
- Shortcut "G" + R/T/A/L/I/P: letter-to-page mapping is not explicit [INFERENCE: R=Ringkasan, T=Transaksi, A=Anggaran, L=Langganan/Laporan?, I=Investasi, P=?]. Other shortcuts: N record, ⌘K search, ⌘, settings, ? shortcut list, ⇧↵ save & add another, Esc close.
- "Arsipkan" (archive) category: effect on budgets and forms?
- AI prompt content only on the device — how does the server store logs without the content?
- Can the base currency be changed from IDR? Effect on historical budgets?

---

## E. Gmail integration — automatic recording (sub-feature)

### 1. Summary & user goal
The user connects Gmail so that transaction notification emails (banks, e-wallets, online stores, bills) are recorded automatically. Emails arrive via Gmail push (Pub/Sub), are filtered by sender + keywords, then extracted by the BYOK AI agent; confidence ≥ 90% is recorded directly, the rest goes to "Perlu ditinjau" (Review queue).

### 2. Screens & states
| Screen | Node | Content | State |
|---|---|---|---|
| Gmail (belum terhubung) | bCdNA | explanation, "Lanjutkan dengan Google", Cara kerjanya (how it works) 1–4, gmail.readonly permission | empty/not connected |
| Gmail — izin Google (OAuth) | kHEuC | accounts.google.com consent "Melihat pesan dan setelan email Anda · Lanjutkan" | OAuth |
| Gmail (terhubung, filter kata kunci) | D6NOl8 | status, statistics, filters, options | connected |
| Gmail — uji filter dengan email | DS1LC | last 5 emails + AI results | test (dry run) |
| Gmail — izin dicabut (toast) | ukKey | status "Terputus", toast "Gmail terputus … Hubungkan" | error/disconnected |

### 3. User flows
1. Not connected → "Lanjutkan dengan Google" → OAuth consent scope `gmail.readonly` → return, status Terhubung (connected).
2. Connected: configure Dari pengirim (from sender), Berisi kata kunci (contains keywords), Abaikan jika berisi (ignore if contains), recording options → Simpan perubahan.
3. Test with an email → pick one of the last 5 emails → see filter status (Lolos/Diabaikan/Tidak cocok (passed/ignored/no match) + reason) and AI extraction result per field. "tidak ada yang disimpan" (nothing is saved).
4. Permission revoked in Google → status "Terputus · Izin dicabut dari akun Google 16.20 · email setelahnya belum dibaca" → toast → "Hubungkan lagi".
5. "Putuskan" to disconnect manually; "Lihat log Gmail" (the log screen does not exist).

### 4. Data entities & fields
- **GmailConnection**: user_id, google_email ("avtara.k@gmail.com"), oauth tokens (encrypted), scope ("gmail.readonly"), status enum(not_connected, connected, disconnected/revoked), push_active bool, watch_expires_at ("watch diperbarui otomatis tiap 6 hari" (watch auto-renewed every 6 days)), history_id [INFERENCE Gmail API requirement], last_email_at ("email terakhir 16.38"), revoked_at ("16.20").
- **GmailFilter**: sender_allowlist[] (domain/address: bca.co.id, gojek.com, pln.co.id, tokopedia.com, shopee.co.id), include_keywords[] (subject or body, "salah satu" (any of): transaksi, pembayaran, e-receipt, dana masuk, tagihan), exclude_keywords[] ("menang atas kata kunci" (wins over keywords): promo, OTP, kode verifikasi, newsletter), auto_record_high_confidence bool (≥ 90%), run_auto_rules bool, skip_if_manually_recorded bool.
- **GmailStats (per month)**: emails received 212, passed filter 38, auto-recorded, needs review, ignored by agent (per-category numbers not legible in the digest).
- **GmailMessageLog** [INFERENCE for "Lihat log Gmail" & test]: message_id, from, subject, received_at, filter_result enum(lolos, diabaikan, tidak_cocok), matched_keyword, reason ("pengirim tidak ada"), extraction {amount, merchant, account (from acct. no. ••4821), date, per-field confidence}, overall_confidence (97%), outcome (dicatat/perlu ditinjau/diabaikan), transaction_id. Email content is **not stored**, only the extraction result.

### 5. Business rules & calculations
- Pipeline order: sender ∈ allowlist **and** subject/body contains any keyword **and does not** contain an ignore keyword (ignore wins). Examples: Shopee "Flash sale 10.10" → Diabaikan (promo); "Kode verifikasi KlikBCA" → Diabaikan; email without a registered sender → "Tidak cocok · pengirim tidak ada".
- Per-field AI extraction with confidence: Amount −350.000 from "Rp 350.000,00" (99%), Merchant "PLN Token Listrik" from "PLN PRABAYAR" (98%), Account from acct. no. ••4821 (96%), Date 14 Okt 2026 18.02; total confidence 97% → "catat otomatis" (auto-record).
- Threshold: ≥ 90% → recorded directly (Gmail only; the general AI agent setting stays "selalu minta konfirmasi"); < 90% → "Perlu ditinjau".
- If the option is on, Auto rules & tags run ("Utilitas rumah" → Tagihan & Utilitas + #rumah).
- Dedup: skip if already recorded manually — match when amount ± 1% and time ± 2 hours. Also idempotent per email ("Email ini sudah dicatat … uji tidak mencatat ulang").
- Model from the AI agent settings (OpenRouter · claude-sonnet-5.5); cost counts toward the BYOK monthly limit [INFERENCE].
- write.financial cannot send/delete/modify emails.

### 6. Background jobs/scheduler & integrations
- Pub/Sub webhook endpoint for Gmail push notifications → enqueue a job (BullMQ) per history change: fetch email metadata/body, run filters, call the LLM, create a transaction / Review queue item, apply rules, dedup.
- Periodic job renews `users.watch` before expiry (design: every 6 days; Gmail watch lasts 7 days).
- Permission revocation detection (invalid_grant/401 error on token refresh) → status Terputus + notification/toast "Gmail terputus"; later emails are not read until reconnected [INFERENCE: backfill from history_id on reconnect is not mentioned].
- Monthly statistics (212/38/…) aggregated from the log.

### 7. UI components
Connection status card (badge Terhubung/Terputus, Push aktif), "Cara kerjanya" stepper, list chip input (domains/keywords + "tambah"), toggle with subtitle, stat tiles, email list with Lolos/Diabaikan/Tidak cocok badges, extraction result panel with per-field confidence, mock Google consent page, error toast with "Hubungkan" action.

### 8. Open questions
- The "Lihat log Gmail" screen does not exist.
- Matching the account from the email (acct. no. ••4821) — requires a masked account number field on Account.
- Are emails from the disconnected period backfilled on reconnect?
- Does using Gmail OAuth `gmail.readonly` (restricted scope) require Google verification/CASA — impacts launch.
- Must the connected Gmail account be the same as the login account? (the design uses the same email).
- Do Review queue items from Gmail store a reference to the email (without content)?
