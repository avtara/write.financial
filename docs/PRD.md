# write.financial — Product Requirements Document

| | |
|---|---|
| Status | Draft v1.1 — derived from the `dompetku.pen` design (Sections 00–18) + additional screens in Section 19 (17 Oct 2026) |
| Date | 17 Oct 2026 |
| Product owner decisions (17 Oct) | **Open source** + managed hosting at write.financial for those who don't have time to self-host · no API budget (free sources + BYOK) · **everything automatic must be confirmed** · missing screens are designed first (Section 19) · v1 is **desktop & tablet** only, mobile postponed · subscriber = pays for managed hosting, later |
| Evidence sources | `design/html/*.html` (Tailwind export), `design/digest/*.md` (outline + text per screen with node ids), `docs/design-analysis/*.md` (per-module analysis) |
| Related documents | `docs/IMPLEMENTATION_PLAN.md` |

Conventions: **FR-xx** = functional requirement, **P0/P1/P2** = priority, `[node]` = Pencil node id to check in the design. Decisions not stated in the design are marked **[Decision]**; all of them are collected in §12.

---

## 1. Product overview

write.financial is a personal finance tracking web app available in Bahasa Indonesia and English (D26), with IDR as the primary currency. All data is entered manually: the user does not need to log in to their bank and the app does not read bank statements. To speed up entry, there is the Quick Add bar (`N`), receipt photos (OCR), CSV/XLSX statement import, an AI Assistant (BYOK), and reading transaction emails from Gmail.

**Distribution.** Open source code (AGPL-3.0, D21). One codebase runs in two modes (D22): **self-host** (anyone runs their own instance via Docker Compose; the data belongs entirely to the instance operator) and **cloud** (a managed instance at `write.financial` for those who don't have time to host it themselves). No feature is locked to cloud; what is paid for in cloud is the hosting service, backups, and updates.

Data recorded and analyzed: accounts (bank, e-wallet, cash, credit card, investment platform; multi-currency), transactions, budgets per payday period, subscriptions, savings goals, investments, debts/installments, and final monthly reports.

Product differentiators:
1. **Periods follow payday.** The start day can be 1–28, and finalized period reports are immutable.
2. **"Perlu ditinjau" (Review queue).** Subscriptions, recurring contributions, and AI results never reduce a balance before the user confirms them.
3. **Savings goals linked to real assets.** Account balances and portions of investment units are allocated to goals, and their value follows market prices.
4. **Honest numbers.** Rupiah amounts are always written in full, signs are always explicit, there is a Privacy mode, and every destructive action can be undone.

## 2. Goals, non-goals, metrics

**Goals**
- G1: Record a transaction in ≤ 5 seconds from anywhere (shortcut `N`, Quick Add bar, Record Transaction sheet).
- G2: The user knows "how much can I spend today" (safe daily limit) and where the period is heading.
- G3: One place for net worth: cash + investments (IDR/USD) − debt.
- G4: Automatic monthly period close with a final report that can be exported and emailed.
- G5: Self-host in ≤ 15 minutes: `docker compose up` + first-run setup wizard, with no manual database steps.
- G6: Move between self-host and cloud without data loss (full export/import, FR-A11).

**Non-goals (v1)**
- Direct connections to banks, brokers, or open banking. The design states "Tidak perlu login bank" (no bank login needed).
- Multiple users in one workspace (shared couple finances). The "Pribadi" (Personal) menu is prepared, but there is only one workspace per user.
- **Phones (< 768 px).** v1 supports only desktop (≥ 1280 px) and tablet (768–1279 px). Section 17 (Mobile) is postponed. On screens < 768 px show a playful page asking for a wider screen ("Ups! Layarnya kurang lebar"), with no actions.
- **Subscriber/billing.** No paid plans yet. The "Paket Pribadi" (Personal plan) label is display-only, but the data model already provides `plan` + entitlements (§12, D17) so subscriber features can be added without a large migration.
- Investment advice. The rebalancing calculator "tidak membuat transaksi" (does not create transactions).

**Success metrics**
- Median time to save a transaction via the Quick Add bar < 5 seconds (measured on the client).
- ≥ 80% of Review queue items resolved ≤ 3 days after their due date.
- Average reconciliation difference per account < 1% of balance after 30 days of use.
- 0 cases of scheduled jobs creating duplicate transactions (idempotency).

## 3. Persona

**Avtara K.** (seed data in the design): an employee with a Rp18,5 jt salary (paid on the 1st) who also freelances, with 7 accounts (BCA, Jago, Mandiri, GoPay, OVO, cash, credit card) and 5 investment platforms (Gotrade USD, Bibit, Stockbit, Indodax, Pluang). They have 6 savings goals and 7 subscriptions. They use the keyboard on a laptop and an iPad (landscape & portrait).

## 4. Product principles (binding on all modules)

1. **Nothing automatically changes your financial data without confirmation.** Everything the system creates goes into the **Review queue** and only takes effect after the user presses "Catat / Sudah dibayar / Terapkan" (record / already paid / apply). This covers scheduled events (subscriptions, recurring contributions, recurring transactions, installments), AI results (Gmail, Assistant, receipts) **regardless of confidence**, statement imports, and period-close effects (moving leftover budget, rollover). Only things that don't change balances, budgets, or transactions may run automatically: reminders, notifications, price/exchange-rate sync, snapshots, period locking, and report generation.
2. **Transfers are not expenses.** Moves between one's own accounts, savings contributions, investment top-ups, and credit card bill payments are not counted as Income or Expense.
3. **Undo everywhere.** Delete, move, merge, and save show an "Urungkan" (undo) toast (soft delete + undo window).
4. **Single number format** (guide `LSwUS`): see §7.1.
5. **Keyboard-first:** `N` record, `⌘K` search, `⌘J` assistant, `⌘,` settings, `⌘.` peek balance, `G`+letter navigation, `E/D/⌫` on rows, `?` shortcut list.
6. **WCAG 2.2 AA accessibility:** token contrast per the guide's table, 2 px focus ring + 2 px gap only on `:focus-visible`, and every color meaning has a second cue (± sign, status text, bar pattern).
7. **Every page has complete states:** loading (skeleton), refreshing (stale data + indicator), failed (message + code + Coba lagi (retry) + last data if any), empty (onboarding CTA), offline (read-only + banner).
8. **Secure by default for a public app:** each user's financial data is isolated, secrets (API keys, tokens, 2FA secrets) are encrypted separately, and sensitive actions require two-step verification (§9).

## 5. Scope & priorities

| Module | Priority | Milestone | Design section |
|---|---|---|---|
| Auth + 2FA/passkey, onboarding, app shell, design system, privacy, theme | P0 | M0–M1 | 01, 11, 12, 16, 19 |
| Accounts & wallets (non-investment) | P0 | M1 | 05 |
| Categories, tags | P0 | M1 | 01, 02 (Settings) |
| Record Transaction + Transactions page | P0 | M1 | 02 (Quick Add bar), 03, 04 |
| Monthly period & period close | P0 | M2 | 14 |
| Budget | P0 | M2 | 06 |
| Dashboard (Overview) | P0 | M2 | 02 |
| Scheduling engine + Review queue + Subscriptions + Calendar + Notifications (popover + page) | P0 | M3 | 04, 07, 08, 15, 19 |
| Savings goals | P1 | M4 | 13 |
| Debts & installments, credit cards, **receivables** | P1 | M4 | 05, 18, 19 |
| Investments + market data (free built-in + BYOK + manual) | P1 | M5 | 09, 19 |
| Reports + export/import + custom range | P1 | M6 | 04, 10, 19 |
| Auto rules, AI Assistant (BYOK), receipt OCR | P2 | M7 | 02, 03, 15 |
| Gmail integration (all via the Review queue) + Gmail log | P2 | M7 | 02, 19 |
| Tablet layout, Customize dashboard, backup & restore | P1 | M8 | 02, 19 |
| Public release readiness: security audit, Google verification, privacy policy (UU PDP) | P0 | M9 | — |

## 6. Functional requirements

### 6.1 Auth, onboarding, account (Section 16, Settings › Profile/Security)
- **FR-A1** Sign in via Google OAuth (profile scope only; "Akses Gmail tidak termasuk" (Gmail access not included)) or email + password (min. 10 characters, strength meter). There is a "Ingat perangkat ini 30 hari" (remember this device for 30 days) option. `[GNOjT, zPHkt, j8qhCU]`
- **FR-A2** Wrong password or 2FA code: show remaining attempts; the account is locked for 15 minutes after 5 failures. Rate limiting is also per IP. `[D0gWC]`
- **FR-A3** Forgot password: link valid for 30 minutes, with a resend cooldown. Google accounts without a password can receive a "atur kata sandi" (set password) link. `[L4tjTX, uoHuu, zAsMe, yPz2Z]`
- **FR-A4** 5-step onboarding: profile & currency (+ additional currencies and exchange rates) → payday/period start and average income → accounts and today's balances → first goal (skippable) → done. `[CsGVt…S53M66]`
- **FR-A5** List of active devices, sign out of one device or all other devices, and a sign-out dialog with a "Keluar dari semua perangkat" (sign out of all devices) option. `[LpVa1, pdmek]`
- **FR-A6** App lock with a per-device PIN, enabled automatically after N minutes of inactivity (default 5). Fallback: sign in with password. `[z6Ce7]`
- **FR-A8** **Two-step verification**: authenticator app (TOTP, 6 digits, 30 seconds), passkey (WebAuthn), and 10 single-use backup codes. Setup: scan QR or type the key manually → verify code → save backup codes. At sign-in: code challenge, backup code/passkey alternatives, "Percayai perangkat ini 30 hari" (trust this device for 30 days) option. `[kKAEZ, NKmY8, ZAD9u]`
- **FR-A9** 2FA is **required** before: saving API keys (AI, market), connecting Gmail, exporting all data, and deleting the account. Sensitive actions also require re-authentication if the session is > 15 minutes old.
- **FR-A10** Security history: new sign-in, 2FA changed, password changed, key added/removed, Gmail connected/disconnected. Notification email for sign-ins from a new device.
- **FR-A11** User data rights (UU PDP (Indonesian Personal Data Protection Law No. 27/2022)): export all data (JSON + CSV), delete account (7-day grace period, then permanent deletion including backups after the retention period), explicit consent for Gmail and AI.
- **FR-A7** Profile: photo (≤ 2 MB), full name (used in PDFs), preferred name (used in the "Selamat sore, …" (good afternoon) greeting), language (Bahasa Indonesia / English, FR-S8), IANA time zone.

### 6.2 App shell & cross-module (Sections 01, 02, 11, 12, 15)
- **FR-S1** Sidebar: Overview, Transactions (count badge), Budget, Subscriptions (badge), Calendar, Investments, Reports, Savings goals, Debts & installments, Ask Assistant `⌘J`, Search `⌘K`, user menu. Page header: greeting, period summary, Week/Month/Year segment, period picker, "Atur" (customize), "Catat Transaksi N".
- **FR-S2** Dark theme (default), light, and system; preference synced to the account.
- **FR-S3** Privacy mode: all amounts (including inside sentences, notifications, AI chat, exchange rates, chart axes) are replaced with `Rp••••••`, while percentages and dates remain visible. Peek balance ("Intip saldo") by holding the button or `⌘.` shows amounts for 5 seconds with a countdown badge. A permanent toggle is in Settings › Appearance. `[L44CMl, VBOGr, uZheE, Trbov]`
- **FR-S4** `⌘K` command palette: quick actions, recently opened, pages (`G R`, `G T`, …), grouped results (Subscriptions, Transactions, Calendar, Goals, Investments). With no results, offer "Tanya Asisten" (ask the Assistant) (Tab) and entity-creation actions. Must keep working without AI. `[Z6JVby, hLRXP, nK8wJ]`
- **FR-S5** In-app notifications: sidebar popover (tabs "Anggaran & tagihan" (budget & bills) / "Sistem" (system), items grouped by day with action buttons, "Tandai dibaca" (mark as read), empty state showing "Pengingat berikutnya" (next reminder)) **and an All notifications page** (filters All / Unread / per type with counts, search, 30-day range, load older, 90-day retention). Notifications only prompt action; their buttons open the Review queue rather than recording directly. `[JdcJD, h5aPn2, dzA5V]`
- **FR-S7** Custom range: popover with presets (last 7/30 days, this/last period, quarter, year, since start), start/end inputs, two month calendars, future dates disabled, summary "N hari · melintasi N periode" (N days · spans N periods), comparison = the same preceding range. Used in Dashboard, Transactions, and Custom Reports. `[WLyvf]`
- **FR-S6** Toasts with actions (Urungkan/Tinjau/Coba lagi/Lihat — undo/review/retry/view), multi-line tooltips, destructive alert dialogs with an impact summary.
- **FR-S8** **Language (D26):** the whole UI is available in **Bahasa Indonesia** and **English**. Initial language: user preference → otherwise the `Accept-Language` header at sign-up (Indonesian if it contains `id`, otherwise English) → instance default (set in the setup wizard). Switcher in Settings › Profile and on the sign-in page; the change applies immediately without reload and is synced to the account. Translated surfaces: all UI text, toasts, validation errors, emails, PDF/Excel reports, notifications, built-in category names, onboarding, and the Assistant's replies (the AI is told to answer in the user's language). User-entered data (category names they created, notes, merchants) is never translated.

### 6.3 Accounts & wallets (Section 05)
- **FR-R1** Account types: Bank, E-Wallet (phone number in place of the last 4 digits), Cash, Investment (platform), Credit card (limit, statement date, due date). Fields: provider name (searchable local reference or manual text; selected licensed logo, uploaded image, or generic icon), display name, last 4 digits, currency (ISO), opening balance and its date, color. Selecting a reference prefills descriptive identity only; customized display names, uploads, currency locks, and all amounts/dates are preserved. `[A4n8Tw, C016z, BSYfj, rmT6r, RcdFp, FkWkq]`
- **FR-R2** Per-account flags: "Hitung dalam saldo tersedia" (count in Available balance), "Tampilkan sebagai kartu" (show as card) (max. 3 cards; the rest are merged into "N lainnya" (N more)), "Default Catat Cepat" (Quick Add default) (one per user), low-balance threshold. `[amsm2, I3a8q]`
- **FR-R3** Currency and opening balance are locked once the account has transactions. `[a7r2RK]`
- **FR-R4** Adjust balance (reconciliation). The user enters the actual balance, the system shows the difference, then the user chooses how to record it: (a) a categorized expense/income transaction, (b) find missed transactions, (c) correction without a transaction (excluded from reports). There is a bulk version for accounts not checked in > 14 days. `[lAmFr, F6sIL, r3WDF7]`
- **FR-R5** Archive account: the balance can optionally be transferred first, then a new default is chosen. Transactions remain in reports. The Archived tab offers Restore and Delete permanently (also deletes its transactions, with confirmation). `[wkqih, oed7u]`
- **FR-R6** Reorder cards by drag. The detail panel contains a 6-month chart, inflow/outflow/transfers, recent transactions, and allocations to savings.
- **FR-R7** Credit card: cycle timeline (statement date + 1 → statement date), current bill, remaining limit, and a payment reminder 3 days before (H-3). Paying the bill is recorded as a transfer. `[YFgrE, U64Fs4]`

### 6.4 Categories & tags (Section 01, Settings)
- **FR-K1** Expense categories (Needs/Wants groups, plus the system group "Biaya keuangan" (financial costs): Biaya bank, Biaya platform, Admin bulanan, Pajak & meterai, Selisih kurs). Income categories (Aktif/Pasif/Lainnya — active/passive/other). Fields: name ≤ 24 characters, icon (lucide), color (palette + hex), monthly budget (expense) or monthly target (income), order. `[PKbl5, noHtC, l3toE, YnLF6]`
- **FR-K2** Category menu: Edit, Move group, View transactions, Merge with…, Archive, Delete. On delete, its transactions remain but go into the "Perlu kategori" (needs category) queue, and that category's budget is deleted too. `[iHweD, g8bxL, fDbls, Ju8vG]`
- **FR-K3** Tags: lowercase slug (`dana-darurat`), max. 5 per transaction, `#` autocomplete with usage counts. Similar tags are detected and can be merged: the old name becomes an alias and per-tag reports are recalculated. `[MFm6o, k2GrzG, Q283b]`

### 6.5 Record Transaction (Section 02 Quick Add bar, Section 03)
- **FR-T1** Two entry points: the Quick Add bar on the Dashboard (single line) and the Record Transaction sheet (`N`, from anywhere, also on tablet). Tabs: Keluar / Masuk / Transfer (out / in / transfer), plus a Dividen & bunga (dividends & interest) variant.
- **FR-T2** Fields: amount (chips +10.000/+50.000/+100.000/+500.000), category (tiles + "Lainnya" (other) + search popover showing remaining/over/about-to-exceed budget), account (grouped popover with balances and a "saldo kurang" (insufficient balance) marker), date + time (presets Hari ini/Kemarin/2 hari lalu/Sabtu lalu/Awal bulan — today/yesterday/2 days ago/last Saturday/start of month, calendar with "ada transaksi" (has transactions) markers, "Jadwalkan" (schedule) for future dates), note, tags, receipt attachment, repeat.
- **FR-T3** Impact preview before saving: "Anggaran Transportasi jadi 73% · Rp1.460.000 / 2.000.000" and "Saldo Bank Jago jadi Rp14.325.000".
- **FR-T4** Transfer: From ≠ To (the same choice is disabled). An optional transfer fee is recorded as a separate expense in a fee category. Cross-currency: automatic reference exchange rate (showing update time) or Manual (showing % deviation from the reference). The user enters the actual "Diterima" (received) amount, then the **FX difference is recorded automatically** to the "Selisih kurs" category. Exchange-rate loading and failure states use the last rate. `[qB5s3, TyPAn, CpDml, N1CG8, KynJj, Y9v7p]`
- **FR-T5** Dividends/interest: source is an asset or account interest, breakdown gross − tax (e.g. "Pajak AS 15% (W-8BEN)", "pajak final 20%") = net, in the asset's currency with ≈ IDR conversion. `[SiIkP, b94mvI]`
- **FR-T6** Repeat: Weekly (day), Monthly (date), Yearly. Ends: never or after N times. Preview of the next 3 occurrences and a 1-day-before (H-1) reminder. Each occurrence goes into the Review queue. `[ifafu, i9gG9u, ETzDc, lsV22]`
- **FR-T7** Receipt: drag or choose a JPG/PNG/PDF file (≤ 2 MB per image; HEIC/WEBP rejected with a clear message). OCR fills amount, date, and merchant, with a "dari struk" (from receipt) badge. `[vKspl, eXSk4, IVy2Y, Q1VXMY]`
- **FR-T8** Inline validation: amount > 0, category required for out/in, source ≠ destination. Insufficient balance is only a **warning**, not a block, with actions "Catat pemasukan dulu / Sesuaikan saldo / Tetap simpan" (record income first / adjust balance / save anyway). `[jSYxL, szrvO, Ud5ju]`
- **FR-T9** After saving: toast with "Urungkan", and a "Tambah lagi setelah simpan" (add another after saving) option (`⇧↵`). Closing a filled form offers "Buang / Simpan draf / Lanjut mengisi" (discard / save draft / keep editing). `[m56kp, J9HC1]`

### 6.6 Transactions page (Section 04)
- **FR-L1** Period summary: In/Out/Transfer cards (transfers "tidak dihitung" (not counted)), daily spending chart with average, and clickable account cards that filter (plus an "N lainnya" popover). `[t7l0Cj, NCqkQ, h26Rk]`
- **FR-L2** Table with By day (groups + subtotals), By category (% + subtotals), and Flat views. Search (`/`) over merchant, note, and `#tag`. Filters: Date, Type, Category, Account, Tag (Any/All), plus + Filter (amount range, has attachment, recurring bill, source, currency, uncategorized). Sort. Configure columns (order, show/hide, density Comfortable/Compact). `[wi4p2…q1t7n8]`
- **FR-L3** Multi-select + bulk actions: change category, move account, add tag, delete. Row menu: Edit (E), Duplicate (D), Split transaction, Change category, Move account, Add tag, Copy amount, Delete (⌫). `[n71CLe, OveDm]`
- **FR-L4** Detail panel: inline editing, attachments with a lightbox (← → Esc, download, delete, max. N per transaction), activity timeline (created via, repeated, stopped, read by AI…), and a "Bukan transaksi" (not a transaction) button for Gmail results. `[fnn3m, jibQf, ryUf2]`
- **FR-L5** Split transaction: Σ parts = total ("Sisa Rp0 · pas" (remaining Rp0 · exact)), tags and attachments carry over to every part. **Split bill** with other people (equally/amount/percent/per item): other people's shares become **receivables** with a due date. The impact on budget and safe daily limit is previewed. `[GJppz, IGHyP]`
- **FR-L6** Delete: confirmation showing the balance impact ("Rp42.810.000 → Rp43.199.000"), attachments are deleted too, and an Urungkan toast. Duplicate: copies all fields except attachments, date set to now. `[NkXhx, pERdi, XOoye]`
- **FR-L7** **Review queue** with reasons: (1) AI results (Gmail, Assistant, receipts) **regardless of confidence** (confidence is only displayed and used for ordering), (2) deleted category (bulk or per-row assignment), (3) subscription due (Belum/Sudah dibayar — not yet/already paid, "Tandai semua dibayar" (mark all paid)), (4) recurring contribution/recurring transfer/installment (Ubah nominal (change amount), Belum/Sudah ditransfer (not yet/already transferred), with allocation to goals), (5) period-close proposals (move leftover budget, rollover). Until an item is confirmed, balances and budgets don't change. Bulk confirmation is available, but it is always a user action. `[N4J73r, Ju8vG, dIS46, yNnG3]`
- **FR-L8** Stop repeating: confirmation that future occurrences and their reminders are deleted, while past transactions remain. Urungkan toast. `[r892Xi, j51Sw]`
- **FR-L9** Statement import: choose account → upload CSV/XLSX (PDF e-statement = P2), max. 10 MB, bank format detected automatically, a generic CSV template is available → Review (found / to be imported / duplicates skipped / unreadable with a per-row reason; category guessed from history; transfers to one's own accounts detected) → "Impor N transaksi" (import N transactions) (this button is the confirmation). Errors handled: format, size, locked PDF, and account mismatch. `[e56WO, Z0eAyw, El2vm]`
- **FR-L10** Export: CSV / Excel (sheet per month) / PDF. Period, "ikuti filter aktif" (follow active filters) option, column selection (11 columns), optional attachments ZIP. Result is success or failure with Coba lagi. `[eiqas, QhAUq, yidyU]`

### 6.7 Monthly period & period close (Section 14)
- **FR-P1** Period start day 1–28 (29–31 not available) or "Ikuti gajian" (follow payday) mode (day taken from the recurring income in the Gaji (salary) category). The period name follows the month in which the period ends (25 Sep – 24 Oct = "Oktober"). `[kNL3D, WpMpY]`
- **FR-P2** Changing the start day offers two options. (a) **Start next period:** there is a transition period with a budget prorated as `batas × hari_transisi / 30`, e.g. 18.750.000 × 24/30 = 15.000.000. (b) **Recalculate the current period:** transactions are moved between periods, budget and saving rate are recalculated. Option (b) must be confirmed via a dialog. A warning appears if the day doesn't match the detected payday. `[hvzfS, d2ztG3]`
- **FR-P3** Closed periods are **final and read-only**, and their reports don't change even if settings change. Contribution and bill schedules keep following their calendar dates. `[IvIWD, Z8qibf]`
- **FR-P4** Period close at the start of a new period: **automatically** locks the period, computes results, creates the next period from the latest budget version, and builds the report. **Proposals** that change numbers (move leftover budget to savings goals, per-category rollover) go into the Review queue and are only applied after confirmation.

### 6.8 Budget (Section 06)
- **FR-B1** Per-category limits effective from a given period until changed (versioned), with change history. "Isi dari rata-rata 3 bulan" (fill from 3-month average). Budget setup shows Allocated vs income (remaining income). `[F0xibH, Cb4oT]`
- **FR-B2** Page: remaining hero, % used vs **ideal for day N** (marker line), safe daily limit, end-of-period projection, over-limit categories, Needs/Wants groups, "Perlu perhatian" (needs attention) panel, tabs, sort, inline limit editing (↵/Esc), category detail (daily chart, 3 months, transactions). `[E86u2e, U4jwnw, IACml]`
- **FR-B3** Move leftover between categories with the total budget unchanged; the suggested source is the category with the largest remainder. Urungkan toast. `[FgYBA, wV9IH]`
- **FR-B4** Per-category options: Carry leftover to next month (rollover), Fixed budget (fixed cost: doesn't use the daily rate, status "lunas" (paid off)), and warning threshold (default 85%, adjustable). `[WdceE, o2VZw4]`
- **FR-B5** Warnings can be dismissed until the end of the period. `[NpMMC]`
- **FR-B6** **Sinking funds**: target, due date, amount saved so far. The monthly contribution is calculated automatically. "Sisihkan tiap gajian" (set aside every payday) creates scheduled contributions into the Review queue. These funds are stored as savings goals of type `sinking` ([Decision]: one entity shared with Savings goals). `[j6G7bA, McGzv]`

### 6.9 Dashboard / Overview (Section 02)
- **FR-D1** Week / Month / Year period. Like-for-like comparison: week vs the same day range last week, month vs last month, year vs last year. `[iUqiN, tBbvD, g9BK2]`
- **FR-D2** Cards: KPIs (Income, Expense, Saved & Invested, Saving Rate vs 30% target), Accounts & wallets, **Money Flow (Sankey)** income → group → category (group filter; menu: open in Reports, download PNG, copy image, show Rp/%, show sources < 1%, count transfers between accounts), spending per category (small multiples), 6-month income vs expense, budget, spending calendar (click day → breakdown), subscriptions.
- **FR-D3** Customize dashboard: drag to reorder, hide cards, width ⅓/⅔/full, add cards (compact Investments, Savings goals, 7-day bill reminders). Layout saved to the account, with Reset to default and Urungkan. `[iBCvF, e1r8q, GcXr5, R1aqQ]`
- **FR-D4** States: empty (3-step stepper: account → record → budget), loading, refreshing, offline ("Lihat data terakhir" (view last data)). `[olRpH, CdNBN, IKIBD, I2SEfl]`

### 6.10 Subscriptions (Section 07)
- **FR-SUB1** Fields: service (logo/icon), plan, price + currency, weekly/monthly/yearly cycle, next bill, paid from (an IDR account for a USD subscription will be "dikonversi saat ditagih" (converted when charged) with an estimate), category, description, reminder N days before (default 3), trial period (7/14 days/1 month/custom; first bill = start + duration). `[ofF4z, sN6Eh, yuefQ, oEASr]`
- **FR-SUB1 reference prefill:** service name/alias search offers a short curated list including Netflix, YouTube Premium, Spotify and Indonesian services. A selection persists a reference ID and uses a locally bundled mark where provenance permits. It never suggests a price, plan, currency, payer, cycle, or billing date; arbitrary manual names remain supported and uploads take precedence.
- **FR-SUB2** Page: KPIs Per month / Per year / Remaining bills this month, 6-month chart with annotations, monthly schedule timeline (Akan ditagih/Sudah dibayar/Belum dikonfirmasi — will be charged/paid/unconfirmed), table, Active/Paused/Cancelled tabs, By category. `[CZmJm]`
- **FR-SUB3** Actions: Mark as paid, Change account (effective from the next bill, with an insufficient-balance warning), Pause (1 month/2 months/custom date + reminder before reactivating), Cancel (after the next bill / now), Reactivate, Billing history, price-increase detection. `[WaS25, x5B5f, QO7La, VtfuA, UONDi]`
- **FR-SUB4** Subscription detection from transactions: merchants with ≥ 3 charges on similar dates, active after 2 months of data. Options: Add / Not a subscription / Add all, with a total-impact preview. `[DIcp7]`
- **FR-SUB5** Monthly usage review (Often/Sometimes/Rarely). A "Jarang" (rarely) rating or overlapping function surfaces a "Bisa dihemat" (could save) card. `[u8sjx]`
- **FR-SUB6** Warnings: 1-day-before reminder with a pause suggestion, overdue unconfirmed bill ("Ya, catat / Belum ditagih" (yes, record / not charged yet)), insufficient balance in the paying account (Top-up / change account). `[C861Ys, Lu10H, IFaSb]`

### 6.11 Calendar (Section 08)
- **FR-C1** Month mode (heatmap + weekly totals W1–W6 + summary + per-weekday pattern), Week (column per day with transactions by hour, safe limit for the rest of the week), Year (12 mini heatmaps, trend, % saved). `[zEWoe, qYzQD, Ncucu]`
- **FR-C2** Scheduled events in cells: subscription bills, recurring bills, payday (estimated), savings/sinking fund contributions, coupons, credit card cycles, installments. Scheduled events don't affect balances.
- **FR-C3** Clicking a day shows a breakdown panel. "Catat di tanggal ini" (record on this date) opens the form with the date prefilled (12.00). Future months show schedules + projections ("Perkiraan dari pola Okt" (estimate from Oct pattern)). The legend can be used as a filter. `[sYRh0, V0mbHr, q3o9L, z6baj, Z0Mxk]`

### 6.12 Savings goals (Section 13)
- **FR-G1** Goal: name, icon, color, target (fixed, or dynamic "3× pengeluaran bulanan" (3× monthly spending) for an emergency fund), deadline (month-year), `#tag` label, recurring contributions (several per goal; date, from → to; always via the Review queue). `[q0jRa]`
- **FR-G2** **Mixed funding sources**: accounts (fixed amount ≤ free balance) and/or investment assets (percentage of units or the whole asset). Total % per asset across goals ≤ 100%. New units from DCA are split according to the %. `[DeE0u, UpO8Q, QCbeZ]`
- **FR-G3** Manual deposit / Withdraw are created as labeled Transfers in Transactions, with a preview of progress, emergency-fund coverage (months), and estimated completion. `[PCgK1, vvQtO, nVb1Q]`
- **FR-G4** Goal reached: stop recurring contributions or continue as a reserve, then Mark complete (Completed tab, Urungkan). **Pay from goal**: an expense with a toggle that changes the goal status to *Terpakai* (used); the remainder can be moved to another goal or released as free balance. `[biM3a, rbvBr, itVPf, m535GI]`
- **FR-G5** Warnings when spending from an allocated account ("mengurangi Dana Darurat" (reduces the Emergency Fund)) and the impact of asset price drops on goals. Selling an asset allocated to ≥ 2 goals requires the user to choose which goal is reduced. `[F6SPeB, BGCD8, LcuPZ]`
- **FR-G6** Valuation fallback: if market prices are unavailable, the page still renders with a "Lihat saldo rekening saja" (view account balances only) option. `[Dr2U1]`

### 6.13 Debts & installments, credit cards (Section 18)
- **FR-U1** Types: credit card installment, paylater, 0% installment, KPR/KPM (mortgage/vehicle loan), personal loan, and **receivable**. KPIs: Remaining debt, Due this month, Nearest due date, Receivables. `[exCE7]`
- **FR-U7** Receivables: a Receivables tab on the Debts & installments page with an active list (person, source: split bill or cash loan, due date + countdown, repayment progress, remaining), 90-day paid history, "Cara write.financial menghitung" (how write.financial calculates) panel. **Record receivable**: who (with name suggestions), amount, from account, date, due date (1/2 weeks, end of month, no deadline), note, 1-day-before reminder to the user only, impact preview. **Receive payment**: amount (chips paid in full / partial), into account, date, preview. Rules: lending = transfer to receivable (not an expense), payment received = incoming transfer (not income), receivables count toward net worth but not Available balance, "Hapuskan" (write off) a receivable = expense in the "Piutang tak tertagih" (bad debt) category after confirmation. write.financial never contacts the other party; "Salin pengingat" (copy reminder) only copies text. `[KZZZy, H7g1A, ivnWw]`
- **FR-U2** Transactions from a credit card account ≥ Rp500.000 can be split into 3/6/12/24-month installments (monthly interest % and admin fee). The full expense is still recorded on the transaction date and counts toward that period's budget, while the installments are held against the limit. `[hNvip, x20Gf]`
- **FR-U3** 0% installment = principal ÷ tenor, the rounding remainder goes into the first installment (1.000.000/3 = 333.334 + 333.333 + 333.333).
- **FR-U4** Payments to the card (transfer) are allocated by a **configurable priority**: 1) installments (early payoff), 2) non-installment spending, 3) overpayment becomes credit balance. After a partial payoff, the user chooses "Kurangi nominal (tenor tetap)" (reduce amount, same tenor) or "Persingkat tenor" (shorten tenor). `[qrRRV, A7ttc]`
- **FR-U5** Adding a debt shows an **impact simulation**: installment/income ratio (healthy ≤ 30%), saving rate after installments, net worth. `[v3Igd]`
- **FR-U6** Non-card installments create scheduled events in the Review queue and the Calendar.

### 6.14 Investments (Section 09)
- **FR-I1** Platform = investment-type account, with cash (IDR/USD). Asset/holding: ticker, name, platform, quote currency, asset class (Saham AS, Internasional, Indonesia, Kripto, Kas & SGOV, Emas, Income — US stocks, international, Indonesia, crypto, cash & SGOV, gold, income), "Daftar saya" (my list) category (an asset is in only one category), units (high precision), average price.
- **FR-I1 reference prefill:** ticker and company-name fields search curated Indonesian and US listings compatible with the selected platform's quote currency. Identity is **MIC venue + ticker**, not ticker alone (for example XIDX:TLKM/IDR versus XNYS:TLK/USD). Selection sets ticker, company name, suggested class/market and a reference ID only; quantities, balances, purchase prices, and manual quotes are never populated. Descriptive fields remain editable; overriding listing symbol/class/market or switching to an incompatible platform detaches the reference rather than silently mismatching currency.
- **FR-I2** Investment transactions: Buy (amount or units, paid from platform cash, fee, tax, exchange rate), Sell (value or %, proceeds to cash or withdrawn to bank, realized gain), Dividend (reinvested / kept in cash / into an account), Cash top-up, **Adjust holdings** (unrecorded purchase / DRIP / correction; if units are lower → sell or correction). `[KDF13, JejMv, j2SH8r, oExkI]`
- **FR-I3** IDR/USD valuation (toggle), KPIs (value, cost basis, unrealized gain, today, 12-month dividends, yield), growth chart (1B/3B/YTD/1T/Semua; value vs cost basis) with YTD benchmarks (SPY, IHSG), allocation vs target per class (total validated at 100%), drift, rebalancing calculator with IDR/USD reference that does not create transactions. `[bgmSP, JBGq7, w1jn3J]`
- **FR-I4** Holdings table: search, group (My list / Asset class / Platform), asset menu, detail panel (buy/DCA history, dividends, allocation to goals). `[CtiSh, zxtp9]`
- **FR-I5** Sync prices: per-source progress, partial failures keep using the last price with its timestamp and source name, "Buka log API" (open API log). Required label "tertunda/penutupan" (delayed/close), never "real-time". `[SNpaj, TZxs4, KR0zN]`
- **FR-I6** Price sources per asset class (details in `docs/research/market-data.md`):

  | Class | Built-in server (free, global cache) | BYOK (user's own key, results only for that user) | Manual |
  |---|---|---|---|
  | Exchange rates | Frankfurter (BI transaction rate) → fawazahmed0 → open.er-api (attribution) | — | Rate per date |
  | US stocks/ETFs + SPY | — | Tiingo (15 minutes) → Finnhub → Massive/Alpha Vantage (daily) | Price per symbol |
  | IDX stocks + IHSG | — | EODHD (close + 3×/day) → Marketstack | Closing price |
  | Crypto | CoinMarketCap Basic (operator key) | User's own CoinMarketCap / CoinGecko | Price |
  | Gold | Daily XAU spot (fawazahmed0); Antam = spot × (1 + user-entered premium), labeled as an estimate | GoldAPI.io / metals.dev | Price per gram |
  | Mutual funds | — | — | NAV + date; optional accrual estimate for RDPU (money market funds) |
  | SBN (ORI) (government retail bonds) | Calculated from face value + fixed coupon | — | Optional market price |

  Prohibited: unofficial Yahoo Finance, Stooq, Twelve Data/FMP free, scraping Pasardana/Bareksa/Bibit/Logam Mulia/IDX/BI, Indodax as a data source, and using one user's BYOK results for another user. No data licenses will be applied for (D20): write.financial is a tracking tool, not a market data provider, so prices only support valuation and can always be entered manually.

### 6.15 Reports (Section 10)
- **FR-LP1** Final monthly report per period: KPIs with comparison, automatic narrative summary, net worth (6-month chart), money flow (Sankey + source table), spending per category vs budget, merchants, tags, accounts, goals, largest transactions, subscriptions, "Catatan untuk periode berikutnya" (notes for the next period). `[ogfhy]`
- **FR-LP2** Report types: Monthly (final snapshot), Quarterly/Yearly/Custom (aggregated from final monthly snapshots + the current period, marked "sementara" (provisional)) ([Decision]).
- **FR-LP3** PDF export A4/Letter, light/dark theme, choose sections (with page numbers), mask account numbers, page-count preview. Also CSV and Excel. `[yLlRY, TAU0h…ZWRR8]`
- **FR-LP4** Email the report at the start of each period (**opt-in**, PDF to the registered email, account numbers masked) and a "Laporan tersimpan" (saved reports) list.
- **FR-LP5** States: loading, recalculating, failed (export temporarily disabled), empty (timeline until the first report is published).

### 6.16 Auto rules, AI Assistant, OCR, Gmail (Section 02 Settings, 03, 15)
- **FR-AI1** Auto rules IF (description contains any of, day, time, account, direction, registered subscription; conditions combined with AND) THEN (set category, add tag). Rules only **fill in suggestions** in forms/drafts that the user still confirms (Quick Add bar, Assistant, receipts, import, Gmail). The category comes from the topmost matching rule; tags are the union of all matching rules. The preview shows match/no match with reasons. "Terapkan ke transaksi lama" (apply to past transactions) shows a list of changes for confirmation. Rule suggestions arise from ≥ 4 identical manual corrections. `[HXDL7, evJtJ]`
- **FR-AI2** BYOK: provider OpenRouter / ZenMux / OpenAI-compatible (base URL), API key (masked, Test button), model, permissions (read financial data, create transaction drafts, always ask for confirmation), monthly cost cap in USD and usage meter, activity log (feature, model, tokens, cost, duration, status, tool calls). `[MXnjE, l1nyC, GpdeI, OJaxo]`
- **FR-AI3** Assistant `⌘J`: answers from data (data cards + source chips + suggested actions), records via chat as a **draft** with impact, then confirmation (Ubah/Batal/Urungkan — edit/cancel/undo), reads multi-item receipts (uncertain fields flagged, duplicate detection on merchant+time+amount). States: not connected, 30-second timeout ("tidak ada biaya yang terpakai" (no cost incurred)), switch provider. The agent never writes data without confirmation. `[xvTmH, I3S0A, wBIPB, QGATc, wpx0t, Q8bxz]`
- **FR-AI4** Gmail: connect via separate OAuth (`gmail.readonly`, requires 2FA enabled), sender filter (allowlist) + keywords + ignore keywords (the last one wins), per-field AI extraction with confidence. **All results go into the Review queue**; the setting "Selalu minta konfirmasi sebelum dicatat" (always ask for confirmation before recording) is locked (Wajib — required). Skip if already recorded manually (amount ±1%, time ±2 hours) and idempotent per email. There is a filter test on the last 5 emails (dry run), monthly stats (received, passed filter, pending, confirmed, ignored), **Gmail log** (time, sender·subject, filter result, AI result + confidence, status Menunggu/Dikonfirmasi/Diabaikan/Duplikat — pending/confirmed/ignored/duplicate, CSV export, 30-day retention), revoked-permission detection, and "Hubungkan lagi" (reconnect). Email bodies are not stored, only sender, subject, excerpt, and extraction results. `[bCdNA, kHEuC, Axylg, h7iA2I, DS1LC, ukKey]`

### 6.17 Settings (Section 02)
Navigation: Account (Profile & account) · Preferences (Currency & exchange rates, Monthly period, Appearance, Notifications, Categories, Tags, Auto rules) · Data (Data & backup, Security) · Integrations (AI agent, Exchange-rate & market API, Gmail) · Other (Keyboard shortcuts, Help & about). A sticky "Simpan perubahan" (save changes) footer appears in the dirty state.
- **FR-ST1** Primary currency (IDR; changing the primary currency once data exists = out of scope for v1), other currencies (detected from accounts), exchange-rate mode Automatic (Frankfurter, rate type shown: "kurs transaksi BI" (BI transaction rate), + "Perbarui sekarang" (update now)) / Manual (rate + effective from + difference vs reference).
- **FR-ST2** Appearance: theme, number format (full/compact for non-table displays; separators follow the language by default: Indonesian `1.234.567,89`, English `1,234,567.89`, can be overridden), date format (localized month names), week start, hide balances.
- **FR-ST3** Notifications: bill reminders (H-3/H-1/Hari H (same day) + time), budget thresholds (50/80/100%), low balance, weekly summary (Monday), channels (in-app always; email optional). Web push is postponed along with mobile.
- **FR-ST4** Exchange-rate & market API: list of sources per asset class with mode (Built-in / BYOK / Manual) and status (Aktif · jam, Terhubung, Atur key, Estimasi, Kuota habis s.d. … — active · time, connected, set key, estimate, quota exhausted until …). BYOK row: provider, API key (masked, only the last 4 characters after saving), frequency capped to fit the free quota, quota meter, "Dapatkan key gratis" (get a free key) link, **Test connection** with per-symbol results, license notes ("key pribadi, data hanya untukmu" (personal key, data only for you), "tertunda, bukan real-time" (delayed, not real-time)). When the quota runs out: pause until reset and fall back to the next source. Requires 2FA enabled. Request log (30-day retention, keys masked). `[JtnsQ, PhHg9, iCbPR]`
- **FR-ST5** Data & backup: export all data, import, automatic daily backups (retention 30), restore from backup, delete all transactions (accounts, categories, and budgets remain).

### 6.18 Tablet (Section 19)
- **FR-TB1** Breakpoints: desktop ≥ 1280 px (full sidebar 248 px), tablet 768–1279 px (sidebar becomes a **64 px icon rail** with tooltips; logo, search, notifications, menu, assistant, avatar), < 768 px not supported in v1 (a playful "Ups! Layarnya kurang lebar" screen asking for a tablet or computer, with no actions). `[F5zMBH, aMmPV]`
- **FR-TB2** Tablet 1024 (landscape): single-column grid for cards that sit side by side on desktop (Income vs Expense, Budget, Calendar, Subscriptions), Sankey shows 2 levels (source → group; tap a group for details), Accounts shows max. 3 cards + "N lainnya", Quick Add bar without the note field.
- **FR-TB3** Tablet 768 (portrait): secondary header actions move into the ⋯ menu, summary without the daily chart, Transactions table without the Account column, detail panel becomes a **sheet** from the right over the list, filter chips scroll horizontally.
- **FR-TB4** Touch input: touch targets ≥ 40 px in the rail and table rows, every hover action also available via long-press or the ⋯ menu, keyboard shortcuts still work with an external keyboard.

### 6.19 Instance, self-host, and admin (D22)
- **FR-OP1** First-run setup wizard (only shown when the instance has no admin yet; shown in the browser's language with a switcher): create admin account + mandatory 2FA, instance name, public URL, default language (Bahasa Indonesia / English), default time zone, SMTP (optional, with a send-test button), and registration choice: **closed** (self-host default; invite only), **open**, or **by invitation**.
- **FR-OP2** Instance settings (admin only, requires 2FA): Google OAuth client (sign-in and Gmail, optional), operator key for built-in sources (CoinMarketCap Basic, optional; without a key, crypto falls back to BYOK/manual), upload limit, log retention, feature flags (Gmail, Assistant), maintenance banner.
- **FR-OP3** Admins only manage the instance and accounts (invite, deactivate, reset 2FA with email verification, delete). **Admins cannot view other users' financial data** from the UI, and `_enc` data cannot be read without the user's session (the DEK is only unwrapped in the context of a session/job belonging to that user).
- **FR-OP4** Instance status page: version, last migration, worker/dispatcher status, queues, built-in source quotas, age of the last backup, and new-version notice (checks GitHub releases, can be disabled; sends no data other than the version).
- **FR-OP5** No telemetry by default in either mode. Error tracking is only active if the instance operator provides their own DSN.
- **FR-OP6** Cloud mode only: hosting plan/subscription page, per-account resource limits (attachment storage; AI requests via the user's key are not limited), write.financial privacy policy & terms of service, and a "Pindah ke self-host" (move to self-host) flow (full export + guide).

## 7. Canonical calculation rules

All modules use the same functions from the `domain` package. The example numbers come from the design seed and serve as **golden tests**.

### 7.1 Number format
| Context | Format | Example |
|---|---|---|
| Tables, ledger | No "Rp", right-aligned, Geist Mono tabular | `42.810.000` |
| Headline figures | With Rp | `Rp55.023.000` |
| Sentences, charts | Full, dot thousands separator, **no jt/rb** | `Rp2.250.000` |
| Flows, differences | Always signed; minus uses U+2212 | `+9.500.000`, `−2.277.000` |
| Percentages | Decimal comma | `36,5%`, `87%` |
| Foreign currency | With exchange rate | `US$690,10` · `Rp16.350 per US$1` |
| Privacy | 6 dots | `Rp••••••` |

Input accepts abbreviations in both languages ("25rb", "1,5jt", "25k", "1.5m") and both decimal separators, interpreted according to the active number format. The examples above use the Indonesian format; with the English format the same values render as `42,810,000`, `Rp55,023,000`, `36.5%`, `−2,277,000`. The currency symbol stays `Rp` for IDR in both languages.

### 7.2 Formulas
| Quantity | Formula | Seed example |
|---|---|---|
| Account balance | opening balance + Σ confirmed postings + Σ adjustments | — |
| Available balance | Σ balances of `include_in_available` accounts (converted to IDR) | Rp55.023.000 |
| Investments | Σ units × last price × exchange rate + platform cash | Rp61.420.000 |
| Total assets / net worth | available + investments − remaining debt | Rp116.443.000 |
| Income / Expense | Σ transactions of type income / expense in the period (transfers excluded) | 26.000.000 / 16.500.000 |
| Saved & invested | income − expense | 9.500.000 |
| Saving rate | saved ÷ income | 36,5% |
| Ideal for day N | N ÷ number of days in period | 15/31 = 48% |
| Safe daily limit | (limit − spent) ÷ remaining days in period including today, rounded **down** to Rp1.000 ([Decision]) | 2.250.000/16 → Rp140.000 |
| Weekly budget | monthly limit × 7 ÷ days in period ([Decision], replaces the 4,4 factor) | — |
| End-of-period projection | Σ fixed budgets (full value) + (variable spending ÷ elapsed days × days in period) + unpaid scheduled bills ([Decision]) | — |
| "Akan lewat anggaran" (will exceed budget) | spent + amount being typed + scheduled bills in that category − limit > 0 | — |
| Transition period proration | limit × transition_days ÷ 30 | 18,75 jt × 24/30 = 15 jt |
| Effective rate / FX difference | sent ÷ received; (received − sent/reference) × reference | Rp16.474; −Rp22.660 |
| Cost basis (asset) | **average cost** method with the exchange rate at transaction time ([Decision]) | SPY Rp11.400.000 |
| Unrealized gain | value − cost basis | +Rp7.489.000 (+13,9%) |
| Portfolio drift | Σ\|weight − target\| ÷ 2 | 3,1% |
| Goal progress | saved ÷ target; saved = Σ account amounts + Σ (% units × price × rate) | 11.125.000/54.000.000 = 21% |
| Monthly goal contribution | (target − saved) ÷ months remaining to deadline | 18.000.000/8 = 2.250.000 |
| Emergency fund coverage | saved ÷ 3-month average spending | 0,6 bulan |
| Remaining card limit | limit − current bill − remaining installment principal | 13.000.000 |
| Subscriptions per year | Σ monthly × 12 + Σ yearly (+ weekly × 52) | Rp11.520.000 |

## 8. Domain model (summary)

User · Session/Device · Preference · **Account** (bank/ewallet/cash/investment/credit_card) · **Category** · Tag · **Transaction** (header) + **Posting** (line per account; transfer = 2 postings; a fee or tax is its own expense transaction linked to its parent; FX difference = posting) · Attachment · Recurrence · **ScheduledOccurrence** (source of the Review queue) · Subscription + SubscriptionCharge · **Period** · BudgetVersion + BudgetLine + BudgetTransfer · Goal + GoalFundingSource + GoalContributionPlan · Debt + InstallmentSchedule + DebtAllocation · Receivable · Asset/Holding + InvestmentTrade + PriceQuote + FxRate + PortfolioSnapshot · Report (JSON snapshot) · Notification · AutoRule · AiProviderConfig + AiUsageLog · GmailConnection + EmailIngestLog · ImportBatch · Backup.

The detailed schema is in the implementation plan §4.

## 9. Non-functional requirements

- **Security & privacy:** see §9.1. This is a requirement for public release, not an add-on.
- **Money integrity:** all money values are stored as `bigint` in the currency's minor unit (IDR exponent 0, USD 2). Units and prices `numeric(28,10)`, exchange rates `numeric(20,8)`. No `float` on money paths. Balances are derived from postings, not stored as mutated numbers.
- **Idempotency:** each scheduled event is unique per `(sumber, tanggal_jatuh_tempo)`, each email unique per `message_id`, each form submission unique per `client_id` (safe to retry).
- **Performance:** Dashboard and Transactions (≤ 10.000 transactions/year/user) TTFB < 300 ms p95 on a 2 vCPU VPS. Period switching < 500 ms. Per-period aggregates may be cached in Redis and invalidated on writes.
- **Availability:** scheduled reminders are still sent even if the UI fails (worker separate from web).
- **Time zone:** all day and period boundaries use the user's time zone (default Asia/Jakarta). Stored as `timestamptz` + local `date` for period keys.
- **Accessibility:** WCAG 2.2 AA, full keyboard navigation, `prefers-reduced-motion`.
- **Testing (D27):** every step ships with unit tests and **100% unit test coverage** (lines, branches, functions, statements) of the code it adds or changes. CI blocks any merge that drops coverage below 100% in any package. See D27 for scope and enforcement.
- **i18n:** Bahasa Indonesia (source language, matches the design) and English at launch (D26). Every UI string comes from the message catalog; no hard-coded text in components (lint). Numbers, currency, dates, relative times, and plurals use `Intl` with the active locale. Adding a third language = adding one message file.
- **Backups:** daily `pg_dump` at 03.00 WIB, **encrypted** (age, public key on the server, private key offline), 30-day retention, off-site copy. Restore tested every release. Data of deleted accounts disappears from backups once retention expires.

### 9.1 Data storage security (public app)

Threat model covered: (1) user A reads/modifies user B's data, (2) database, disk, or backup leak, (3) logs/telemetry leak secrets or financial data, (4) account takeover, (5) third parties (LLM, data providers) receive more data than necessary.

| Layer | Requirement |
|---|---|
| Tenant isolation | Every user-owned table has `user_id`. Access goes through a single repository layer that requires `userId` from the session (never from input). **Postgres Row-Level Security** is enabled on all user-owned tables as a second layer: the app connection uses a role without `BYPASSRLS` and sets `app.user_id` per transaction. Automated tests attempt cross-tenant access for every server function. Public IDs use UUID v7, not sequential. |
| Encryption in transit | TLS 1.2+ (Caddy, HSTS preload), Postgres/Redis connections only on `localhost`/private network or with TLS. |
| Encryption at rest (disk) | Postgres, Redis, and object storage (SeaweedFS, D25) data volumes on encrypted partitions (LUKS). Encrypted backups (age). |
| Application-level encryption (envelope) | Each user has a **data key** (DEK, AES-256-GCM) wrapped by a **master key** (KEK) from env/secret file outside the DB and outside the repo. Encrypted with the DEK: BYOK API keys (AI, market), Gmail OAuth tokens, transaction notes, email excerpts, OCR results, people's names in receivables, and all attachment/receipt files. TOTP secrets are encrypted by the auth module with a key derived from `AUTH_SECRET` (Better Auth 1.7 offers no hook for per-user keys, and the auth DB role cannot read `user_keys`); backup codes and reset/verification tokens are stored hashed. Amount, date, category, and merchant columns stay plaintext so they can be aggregated and searched; these columns are protected by RLS + disk encryption. KEK rotation without data re-encryption (re-wrap DEKs). Delete account = delete DEK (*crypto-shredding*). |
| Secrets never leave | API keys/tokens are never sent back to the browser (only the last 4 characters), never enter logs, error tracking, or job payloads (jobs carry only IDs; the worker decrypts at use). Automatic redaction of key/token/card number patterns in the logger. |
| Authentication | Argon2id for passwords, breached-password check (HIBP k-anonymity), 2FA TOTP/passkey/backup codes, lockout + rate limiting per account and IP, httpOnly + Secure + SameSite=Lax sessions, session ID rotation after login/2FA, session expiry (30 days "remember", 12 hours without), re-auth for sensitive actions, new-device sign-in notifications. |
| Web application | CSRF tokens for all mutations, strict Content-Security-Policy (no inline scripts), `X-Frame-Options: DENY`, Zod input validation on the server, uploads: MIME check (magic bytes) + size + image re-encode + strip EXIF/GPS metadata. Images & files **always go through the app server** (upload: encrypt then store in object storage; download: fetch, decrypt, send with `Content-Disposition` and `Cache-Control: private, no-store`). Object storage is never exposed to the internet and doesn't use public presigned URLs, since its contents are per-user ciphertext. |
| Third parties | LLMs only receive the minimum data for their task (not the whole ledger). Prompts/responses are not stored on the server, only metadata. Price providers only receive symbols, never user identity. |
| Audit | Immutable (append-only) security log for sign-ins, 2FA, keys, Gmail, exports, account deletion; visible to the user (FR-A10). |
| Compliance | UU PDP No. 27/2022: privacy policy, lawful basis for processing (consent for Gmail/AI), rights of access/export/deletion, incident notification. Gmail restricted scope: Google verification + third-party security assessment before Gmail is opened to the public. |
| Operations | Dependency scanning (CI), automatic OS patches, firewall (only 80/443/key-based SSH), passwordless SSH, admin access to the production DB logged, no production data in dev environments. Penetration test before the public cloud release (M9). |
| Open source | The public repo must contain no secrets (secret scanning in CI + pre-commit). `SECURITY.md` with the address `security@write.financial` and a responsible disclosure policy. Signed releases; Docker images with digest + SBOM. Secure defaults for self-host: closed registration, mandatory admin 2FA, KEK generated automatically at setup and the user is prompted to back it up. |

## 10. Design system

- **Tokens:** 133 dark/light variables from `dompetku.pen` (surfaces `bg/card/muted/surface-2..5/dialog/popover/input`, text `fg/text-strong/text-secondary/muted-fg/subtle/text-faint/text-disabled`, accents `blue/green/red/amber/violet/cyan/yellow/orange/rose` with `-fg`, `-fg-soft`, `-tint-1..5` variants, heat, scrim, shadow, ring, brand colors). Tokens are exported automatically to CSS variables + Tailwind theme.
- **Typography:** Geist (UI) and Geist Mono (numbers). Dominant scale 10–15 px (11,5/12/12,5/13/13,5), headings 17/20/24. Dense, like a pro app.
- **Shape:** radius 2–12 (dominant 3/4/6/8), gap 2–20, desktop canvas 1440 px, tablet 1024 & 768 px (Section 19).
- **Icons:** lucide (239 icons used). Design-only examples include 26 bank/e-wallet/asset logos in `images/logos/`; shipped catalog marks are the four individually reviewed same-origin files in `apps/web/public/catalog-logos/`, with provenance and copyright/trademark distinctions in `TRADEMARK.md`.
- **Brand (Section 20 `bnGdw`):** product name **write.financial**, always lowercase with the dot, including at the start of a sentence. Logo mark = a pen nib whose slit rises into a chart line. Components `Logo Mark / 12 (putih)`, `/15`, `/16`, `/18`, `/24` replace the old wallet icon in the sidebar, tablet rail, sign-in, onboarding, and PDF header. Inside a tile: `$fg` tile + `$primary-fg` mark (automatically inverted in light mode). Wordmark Geist 600, "write" `$fg` + ".financial" `$muted-fg`. App icon 180/64/32/16 px; favicon and apple-touch-icon exported from this component.
- **Core components:** Wallet Card (default, foreign currency, combined), Dialog/Sheet (header, footer), category/date/period/account/custom range picker popovers, Toast, Tooltip, Menu Item, Alert Dialog, Export Dialog, Sidebar, **Icon rail (tablet)**, Page Header, Quick Add, KPI Strip, Sankey Card, Small multiples, Calendar heatmap, 6-digit code input.
- **Local reference UX:** 66 curated identities (41 providers including Indonesian and global crypto exchanges, 12 stock listings, 13 subscriptions), each with a locally bundled mark; not exhaustive coverage. Empty input shows no directory; name/alias/ticker search returns at most six suggestions in the forms (hard cap eight), with arrows/Enter/Escape, accessible labels, and an explicit manual-entry hint. Reference rows live in shared read-only database data; optional associations on user records remain tenant-isolated. Search and branding use the bundled snapshot, with no third-party runtime calls. Existing manual records stay manual unless the user chooses a reference.

## 11. External integrations & product risks

| Integration | Requirement | Risk | Mitigation |
|---|---|---|---|
| Google OAuth (sign-in) | Profile, email | Low | — |
| Gmail API `gmail.readonly` + Pub/Sub push | Read transaction emails (all via the Review queue) | **Restricted** scope: public production requires Google verification + third-party security assessment. "Testing" status is limited to 100 test users and refresh tokens expire after 7 days | Public v1 release **without Gmail** (feature flag) until verification completes in M9; `history.list` polling as a push fallback |
| Exchange rates (Frankfurter, fawazahmed0, open.er-api) | Daily | Free tiers may change; per-IP rate limits | Global cache 1–2 calls/day, sequential fallback, manual rates, show rate type + time |
| US/IDX stocks (BYOK: Tiingo, Finnhub, EODHD, …) | 15 minutes (US), close + 3×/day (IDX) | Free licenses = personal use; small quotas | BYOK per user only, never shared; interval capped by quota; manual as backup |
| Crypto (CoinMarketCap Basic, operator key) | 5 minutes | 15.000 credits/month, limit ≤100k users | One call for all unique symbols, global cache; monitor `credit_count`; fallback to cache + manual |
| Gold, mutual fund NAV, SBN | Daily | No legal free API for Antam/NAV | XAU spot + user premium (estimate), manual NAV, ORI calculated from coupon |
| BYOK LLM (OpenRouter/ZenMux/compatible) | Chat, OCR vision, extraction | User cost, latency | Monthly cost cap, 30-second timeout, no cost on failure |
| Outgoing email (SMTP/Resend) | Reset, reminders, reports | Deliverability | SPF/DKIM, own domain |

## 12. Default decisions & questions for the product owner

I made the following decisions so work can proceed. All of them can be changed before the related milestone.

| # | Topic | Decision | Rationale | Status |
|---|---|---|---|---|
| D1 | Transfer model | Ledger: 1 transaction + N postings; every fee or tax is its own linked transaction (one action each) | Transfers, fees, FX differences, splits, credit cards are consistent; balance = Σ postings | Default |
| D2 | Devices | **Desktop + tablet** (icon rail at 768–1279 px). Phones postponed | Product owner decision 17 Oct | **Decided** |
| D3 | BYOK API keys | Stored encrypted **on the server** with a per-user DEK | Workers need the key; the design copy "di perangkat" (on the device) has been replaced in Section 19 | Default |
| D4 | Import parsing | CSV/XLSX parsed in the browser, only resulting rows are sent. PDF e-statement = P2 | Privacy; PDFs need per-bank parsers | Default |
| D5 | Export | CSV on the client; Excel/PDF/ZIP in the worker | PDF and email delivery need the server | Default |
| D6 | Investment cost basis | Average cost, historical exchange rate per transaction | The design only shows "harga rata-rata" (average price) | Default |
| D7 | Safe daily limit | Rounded down to Rp1.000 | Conservative; the design is inconsistent | Default |
| D8 | End-of-period projection | Fixed + variable rate + scheduled bills (§7.2) | The design's 24,2 jt figure can't be reproduced | Default |
| D9 | Sinking funds | One entity with Goals (`kind = sinking`) | Appears in Budget **and** Savings goals | Default |
| D10 | Quarterly/Yearly | Aggregate of monthly snapshots + current period as "sementara" (provisional) | Only monthly has the "Final" label | Default |
| D11 | App lock PIN | Per device, stored on the client (hash in IndexedDB) | Design: "di perangkat ini" (on this device) | Default |
| D12 | Mortgage/loan interest | Effective annuity; paylater/cards flat | Not defined in the design | Default |
| D13 | Notification channels | In-app + email; web push postponed along with mobile | Push is only useful on phones | Default |
| D14 | Automation | **Everything the system creates must be confirmed** (Gmail ≥ 90% is no longer recorded automatically; period close only proposes) | Product owner decision 17 Oct | **Decided** |
| D15 | Market data | Free built-in sources for exchange rates, crypto, gold spot; BYOK for US/IDX stocks; manual for NAV/Antam | No budget; free-tier stock licenses are personal only | **Decided** |
| D16 | Public release | Required: RLS + envelope encryption + 2FA for sensitive actions + encrypted backups + security audit; Gmail waits for Google verification | Open to the public | **Decided** |
| D17 | Subscriber | Subscriber = **managed hosting** customer (cloud mode). No premium features in the code: the `plans`/`user_plans` tables are only used in cloud mode for resource quotas and billing; in self-host all features are enabled. Billing follows after M9 | Open source; what is sold is the hosting service | **Decided** |
| D18 | Domain & email | Domain **write.financial**: app at `app.write.financial` (or root), transactional email from `no-reply@write.financial`, contact `halo@write.financial`, security `security@write.financial`, privacy `privasi@write.financial`. SPF, DKIM, DMARC (`p=quarantine`) required before M3 (reminder emails). The same domain is used on the Google OAuth consent screen and the privacy policy/terms of service URLs | Product owner answer 17 Oct | **Decided** |
| D19 | Data controller | **Self-host:** each instance operator (write.financial is only the software provider and receives no data). **Cloud:** write.financial is operated by [owner name] as data controller; before cloud opens to the public (M9) a PT Perorangan (Indonesian sole-proprietor limited company) + NIB (business identification number) is set up and registered as a PSE Lingkup Privat (private-scope electronic system operator) [needs legal confirmation]. The cloud privacy policy uses this identity | Open source + hosting model | **Decided** |
| D20 | Market data licensing | **Not applying** for Indodax permission or a Pasardana license. Product focus: tracking finances and assets. Crypto uses CoinMarketCap Basic (built-in) or BYOK; gold spot uses a built-in source + manual premium; mutual fund NAV and Antam prices are **entered manually** (with an optional RDPU accrual estimate) | Product owner answer 17 Oct | **Decided** |
| D21 | Code license | **AGPL-3.0-only** (official text in `LICENSE`). Anyone may use, modify, and host it; if a modified version is offered as a service, the modified code must be released. Contributions use the **DCO** (`Signed-off-by` on every commit, checked by CI). The project owner's copyright still allows an official cloud instance. The "write.financial" logo & name are not covered by the code license (`TRADEMARK.md`). Bundled catalog marks in `apps/web/public/catalog-logos/` are Wikimedia Commons files under their stated licenses or brand-published icons, with per-file provenance in `TRADEMARK.md`; third-party trademark rights remain reserved and the marks identify user records only, without endorsement. Design examples in `images/logos/` are not blanket-cleared production assets. Every source file gets the header `SPDX-License-Identifier: AGPL-3.0-only` | Open source + selling hosting; protects against closed services built on this code | **Decided** |
| D22 | Deployment mode | `DEPLOYMENT_MODE=selfhost` (default) or `cloud`. Differences are only in configuration: registration, plans page, privacy policy, resource quotas. One Docker image for both | One codebase, no fork | **Decided** |
| D23 | Data sources per instance | Built-in sources are run by each instance with the instance operator's keys (CMC Basic optional). Cloud uses write.financial's operator keys. BYOK & manual are the same in both modes | Free licenses apply per product/key owner | **Decided** |
| D24 | Gmail | **Self-host:** the operator creates their own Google Cloud project and installs the client ID in FR-OP2; for personal/family use the app is published without verification ("aplikasi belum diverifikasi" (unverified app) screen, max. 100 users) so refresh tokens don't expire every 7 days as in Testing status [to be tested in M7]. **Cloud:** Gmail stays disabled until verification + security assessment are complete | Makes Gmail usable earlier via self-host | **Decided** |
| D25 | Image & file storage | **SeaweedFS** (Apache-2.0, `weed server -s3`) as S3-compatible object storage for receipts, attachments, profile photos, uploaded account/subscription logos, report PDF/Excel files, and exports. The app only speaks the standard S3 API (`@aws-sdk/client-s3`), so instance operators can swap it for another S3 (Garage, RustFS, AWS S3, Cloudflare R2, Backblaze B2) via `.env`. Buckets: `wf-attachments`, `wf-avatars`, `wf-reports`, `wf-exports`; object keys `u/{userId}/{uuid}` without the original file name. MinIO is **not used**: its community repo was archived (Apr 2026) and its official image has been pulled from Docker Hub, so there are no security patches | Product owner request (object storage) + MinIO status | **Decided** |
| D26 | Internationalization | **Paraglide JS** (inlang) with TanStack Start: compile-time, type-safe message functions, tree-shaken per locale, works in SSR, server functions, and the worker (emails, PDFs, notifications). Locales `id` (source) and `en`. Locale is resolved from the user preference/cookie, **not** from a URL prefix (the app is behind login); route paths are English and language-neutral. CI fails if a key is missing in either locale or if a component contains a hard-coded user-facing string | Bilingual product for Indonesian and international self-hosters | **Decided** |
| D27 | Unit testing | **100% unit coverage is a merge gate** for every package (`apps/web`, `apps/worker`, every `packages/*`): lines, branches, functions, and statements, enforced **per file** by Vitest (`coverage.thresholds: { 100: true, perFile: true }`, v8 provider). Every source file has a co-located `*.test.ts(x)`; CI fails if a source file has no test file. Exclusions are only for code we do not write: generated Paraglide output, SQL migration files, `*.d.ts`, and config files, listed in one shared config and reviewed. `v8 ignore` comments are rejected by lint unless they carry a justification and a linked issue. Coverage alone does not prove correctness, so `packages/domain` and `packages/crypto` also run **mutation testing** (Stryker) with a ≥ 90% mutation score, and integration/E2E tests (Testcontainers, Playwright) remain required on top of unit tests. A step (PR/task/milestone item) is only "done" when its unit tests exist and the gate is green | Product owner requirement: every step must have unit tests at 100% | **Decided** |

All open questions have been answered.

## 13. Design inconsistencies for the designer to fix

| Location | Issue |
|---|---|
| Wallet Card `ALH0W` | BCA "−Rp11.200.000 bulan ini" vs data source +1.200.000 |
| Budget `E86u2e` vs Setup `F0xibH` | Total 18.750.000 vs 18.950.000; Needs 12,0 vs 12,2 jt |
| Budget | Projection Rp24.200.000 cannot be derived |
| Category popover | "akan lewat Rp566.000"; calculated 560.900 |
| Record `XOoye` | "lewat Rp789.000"; calculated 790.000 |
| Split bill `IGHyP` | 1.857.500 displayed as 1.860.000 |
| Subscriptions | Monthly total 904.900 / 905.000 / 859.900 / 845.900 (Sep report); "6 aktif" vs tab "Aktif 7"; Entertainment 37% vs 34% |
| Calendar Week | Average 448.000 (calculated 412.500); "−26%" (calculated −31,5%) |
| Net worth | +4.220.000 vs 4.243.000; 116.440.000 vs 116.443.000 |
| Savings goals `vvQtO` | "0,5 bulan" after depositing +1 jt (should be ≈ 0,67) |
| Investments | "11 posisi" vs ±22 tickers; "14 aset" vs "15 aset" |
| Format | "Rp18,75jt" in a card title violates the guide's jt/rb ban |
| Privacy mode | Amounts still leak in Budget, Savings goals, Subscriptions, Investments chart axes |
| Copy | ~~"write.financial tidak pernah meminta login bank / Semua dicatat manual" vs Gmail~~ — updated: the Gmail screen now says "baca email transaksi" (read transaction emails), results must be confirmed. Still needed: "data tetap di perangkatmu" (data stays on your device) (Investments, BYOK) → "dienkripsi di server" (encrypted on the server) |
| Gmail (Section 02/04) | ~~"Catat tanpa konfirmasi jika yakin ≥ 90%"~~ and "Tercatat otomatis" — **already changed** in the design (locked toggle "Wajib", status "Dikonfirmasi olehmu" (confirmed by you)) |
| Exchange-rate & market API `W6ThPJ` | Uses BI JISDOR + Yahoo Finance (prohibited) — **replaced** by Section 19 `JtnsQ`/`PhHg9`; old screen marked "[Usang]" (obsolete) |
| Onboarding | No PIN setup step; no non-Google variant |
| Accounts `oed7u` | Archived Jenius uses •• 4821 (same as BCA) |

## 14. Additional v1.1 screens (Section 19 in `dompetku.pen`)

| Row | Screen | Node | FR |
|---|---|---|---|
| Notifications | All notifications page | `dzA5V` | FR-S5 |
| Gmail | Gmail connected (confirmation required), Gmail log | `Axylg`, `h7iA2I` | FR-AI4 |
| Period | Custom range popover | `WLyvf` | FR-S7 |
| Receivables | Receivables list, Record receivable, Receive partial payment | `KZZZy`, `H7g1A`, `ivnWw` | FR-U7 |
| Security | Security (2FA not enabled), Set up authenticator, Sign in with 2FA | `kKAEZ`, `NKmY8`, `ZAD9u` | FR-A8–A10 |
| Tablet | Overview 1024, Transactions 768 | `F5zMBH`, `aMmPV` | FR-TB1–TB4 |
| Exchange-rate & market API | Built-in + BYOK + manual sources, Set IDX key + connection test | `JtnsQ`, `PhHg9` | FR-ST4, FR-I6 |
| Brand (Section 20) | Logo mark, dark/light lockups, app icon, usage rules, logo components | `bnGdw` | §10 |
