# Analysis: Record Transaction (Section 03) & Transactions (Section 04)

Sources: `/tmp/digest/03-catat-transaksi.md`, `/tmp/digest/04-transaksi.md`. Node ids are written in [brackets].

---

## A. Record Transaction sheet (input sheet) — Section 03 [Q7ss6P]

### 1. Overview & user goal
A quick sheet that can be opened from anywhere ("Catat Transaksi" button, shortcut `N`) to record **Keluar** (expense), **Masuk** (income), **Transfer**, and a **Dividen / Bunga** (dividend / interest) variant. The user wants to record a transaction in a few seconds: enter the amount (with quick chips +10.000/+50.000/…), pick a category from the tiles, then account, date, note, and tags. There are also Foto struk (receipt photo, OCR) and Ulangi (repeat/recurring) options. The sheet immediately shows the impact on budget and balance ("Anggaran Transportasi jadi 73%", "Saldo Bank Jago jadi Rp14.325.000 setelah disimpan."). Transfers support cross-currency IDR↔USD, with a reference or manual exchange rate and the FX difference recorded automatically.

### 2. Screens & states
| Screen | Node | Content/purpose | State |
|---|---|---|---|
| Record Transaction (Sheet) | airjf | Keluar/Masuk/Transfer tabs, `Rp 85.000`, category tile "Makan & Dapur", "Hari ini", "Catatan, mis. makan siang", Simpan ↵ | default (Expense) |
| + Foto struk clicked | iL4L4 | Dropzone "Foto atau seret struk ke sini · Nominal & tanggal terisi otomatis · JPG, PNG, PDF" | option expanded |
| + Ulangi clicked | ifafu | Frequency Mingguan/Bulanan/Tahunan (weekly/monthly/yearly), "Tiap tgl", Ends "Tidak pernah" (never), preview "Lalu 15 Nov · 15 Des · 15 Jan · H-1" | option expanded |
| Sheet — Pick Category | uIA2X | Category search (Esc), KEBUTUHAN/KEINGINAN (Needs/Wants) groups; each category shows "sisa anggaran Rp300.000" (budget left), "lewat anggaran Rp400.000" (over budget), "akan lewat anggaran Rp566.000" (will go over budget); "Buat kategori pengeluaran"; ↑↓ navigation | popover |
| Sheet — Pick Account | IZfLx | BANK/E-WALLET/TUNAI & INVESTASI groups, balance per account, OVO "Rp86.000 · saldo kurang" (insufficient balance), Bibit RDPU "Reksa dana & SBN" | popover, balance warning |
| Sheet — Pick Date | u9c7V | Presets Hari ini 15 Okt / Kemarin / 2 hari lalu / Sabtu lalu / Awal bulan; "Jadwalkan" (schedule); Mon–Sun calendar; Time ":" "Sekarang"; "ada transaksi" (has transactions) dot; Terapkan | popover |
| Expense: Health (under Lainnya) | BJfbo | 250.000, "Apotek K-24 — vitamin", tags kesehatan/apotek, "Anggaran Kesehatan jadi 50% · Rp250.000 / 500.000" | filled |
| Expense: Transport (own tile) | nHThj | 63.000 "Grab — pulang kantor", tags kantor/ojol, "Anggaran Transportasi jadi 73% · Rp1.460.000 / 2.000.000" | filled |
| Record Income | PKtGi | "+Rp 6.200.000", income source (tiles Bonus/THR, Penjualan…), destination account, "14 Okt 2026, 21.03", "Invoice #0912 — Studio Arunika", tags freelance/studio-arunika + suggestions gaji/pasif/klien-baru, toggle "Pemasukan rutin" (recurring income), "Saldo Bank Jago jadi Rp14.325.000 setelah disimpan." | default |
| Pick Income Source | V0vjhj | Search; groups AKTIF / PASIF (Sewa properti, Royalti & afiliasi) / LAINNYA (Penjualan barang, Reimburse kantor, Cashback & refund, Hadiah diterima); month totals "Oktober", "Rp0"; "Buat kategori pemasukan" | popover |
| Income: Gift (Lainnya) | Hb6pS | +500.000, "Hadiah ulang tahun" | filled |
| Income: Salary (tile) | G7mAdM | +18.500.000 "Gaji Oktober · PT Kinarya", 1 Okt 08.00, BCA becomes Rp61.310.000 | filled |
| Record Dividend | SiIkP | "Jumlah bersih +US$ 6,88 ≈ Rp112.490 · kurs Rp16.350 per US$1"; Source NVDY (YieldMax NVDA Option Income); Into Gotrade Kas USD; breakdown gross distribution US$8,10, US tax 15% (W-8BEN) −US$1,22, Net US$6,88 | default |
| Dividend: Pick Source | b94mvI | REKENING · BUNGA (savings interest, 20% final tax, "Bunga 2,5% p.a.", Mandiri), YIELDMAX · DISTRIBUSI BULANAN (MSTY, NVDY, TSLY, CONY…) | popover |
| Record Transfer | qB5s3 | From (BCA Rp39.807.500 after) → To Bibit RDPU (Rp2.500.000 → Rp5.500.000); transfer fee 2.500, "Catat Rp2.500 sebagai pengeluaran · Biaya bank"; "Ulangi tiap bulan · Tiap tgl 14 · masuk Perlu ditinjau dulu" | default |
| Cross-currency transfer IDR→USD | TyPAn | Rate "1 USD = Rp16.350 · Kurs acuan · diperbarui 15 Okt, 16.42"; Acuan/Manual (reference/manual) toggle; "Diterima di Gotrade · Seharusnya US$183,49 · kurs efektif Rp16.474 · US$182,10"; "Selisih dicatat otomatis −Rp22.660 · US$1,39 lebih kecil dari seharusnya"; platform fee | default |
| Transfer USD→IDR | CpDml | Send US$100,00 (chips +$10/+$50/+$100), Gotrade US$234,10→US$134,10, BCA Rp39.810.000→Rp41.428.400; expected Rp1.635.000, effective rate Rp16.184, received 1.618.400, difference −Rp16.600 | default |
| Transfer: Pick From / To Account | AOKBG / jDHoU | The account already chosen on the other side is disabled ("Sudah dipilih sebagai tujuan/asal") | popover |
| Transfer: Fee Category | vjq8t | BIAYA KEUANGAN (financial fees): Biaya bank (BI-FAST, interbank, SKN), Biaya platform, Admin bulanan, Pajak & meterai, Selisih kurs ("Kurs efektif lebih buruk dari acuan"); "Buat kategori biaya" | popover |
| Rate: Manual Mode | N1CG8 | "1 USD = Rp 16.474 · Manual · +0,8% dari acuan Rp16.350"; "Tidak ada selisih" (no difference) | manual |
| Rate: Updating | KynJj | "Mengambil kurs terbaru…", "Menunggu kurs untuk menghitung…" | loading |
| Rate: Update failed | Y9v7p | "Gagal memperbarui · pakai kurs 15 Okt, 16.42"; toast "Kurs tidak bisa diperbarui · Tidak ada koneksi… · Coba lagi" | error (fallback) |
| Tag: suggestions while typing | MFm6o | Type "#rei" → TAG YANG ADA (existing tags): reimburse (12× used), reimburse-kantor (3×), kerja-rei… (1×); "Buat tag"; "2 / 5 tag" | autocomplete |
| Receipt: drag file | vKspl | "Lepaskan untuk mengunggah struk · 1 file · nominal & tanggal dibaca otomatis · struk-cgv.jpg" | drag-over |
| Receipt: reading | eXSk4 | "struk-cgv.jpg · 1,2 MB · Membaca nominal, tanggal & merchant…" | loading (OCR) |
| Receipt: autofilled | IVy2Y | badge "dari struk" (from receipt), "15 Okt 2026, 19.12 · CGV Grand Indonesia · 2 tiket + snack", "3 isian terbaca: jumlah, tanggal, merchant" | success |
| Receipt: upload failed | Q1VXMY | "IMG_3381.HEIC tidak diunggah · Format .heic tidak didukung. Gunakan JPG, PNG, atau PDF maks 2 MB. · Pilih file" | error |
| Expense: Repeat weekly | i9gG9u | 150.000 "Futsal mingguan — Lapangan Senayan", "Tiap Kamis" (every Thursday), preview 22 Okt · 29 Okt · 5 Nov · H-1 | option active |
| Income: recurring | ETzDc | "Retainer bulanan", Tiap tgl 14, "Berakhir · Setelah 6 kali" (ends after 6 times) | option active |
| Transfer: Repeat monthly | lsV22 | Tiap tgl 14, Tidak pernah, 14 Nov/14 Des/14 Jan, H-1 | option active |
| Validation: empty fields | jSYxL | "Masukkan jumlah lebih dari Rp0", "Pilih satu kategori", "2 isian perlu dilengkapi" | validation error |
| Saved, ready to add another | m56kp | "1 transaksi tersimpan di sesi ini", toast "Transaksi tersimpan · Hiburan · −Rp485.000 · BCA Tahapan. Form siap untuk transaksi berikutnya. · Urungkan" | success |
| Validation: source = destination account | szrvO | "Rekening asal dan tujuan tidak boleh sama · Pilih tujuan lain" | error |
| Warning: insufficient balance | Ud5ju | Transfer 50.000.000: "Saldo BCA Tahapan kurang Rp7.192.500 · Saldo tercatat Rp42.810.000, transfer + biaya Rp50.002.500. Mungkin ada pemasukan yang belum dicatat."; actions "Catat pemasukan dulu", "Sesuaikan saldo", "Tetap simpan" (save anyway) | warning (non-blocking) |
| Close without saving | J9HC1 | "Buang transaksi ini?… simpan sebagai draf"; summary "Nonton bareng — CGV Grand Ind… · Hiburan · BCA Tahapan · 2 tag"; Simpan draf / Lanjut mengisi / Buang | dialog |
| Create expense category | noHtC | Name (max 24 characters) "Pendidikan", Group, Icon, Color, Monthly budget (optional) 500.000/month, Preview "Kebutuhan · Rp500.000/bulan" | dialog |
| Create income category | l3toE | "Les privat", Group Aktif/Pasif, Icon, Color, Monthly target (optional) 1.500.000 | dialog |
| Loading categories & accounts | AemKn | "Memuat kategori…" | loading |
| Saving… | s1mwEx | "Menyimpan…" | loading |
| Duplicate: filled sheet (from §04) | XOoye | Shows the full sheet: chips +10.000/+50.000/+100.000/+500.000, "Lihat semua", tiles Belanja/Lainnya, "Hari ini, 19.45", optional note, tags "maks. 5 · Tambah tag… · Sering dipakai: reimburse · liburan-bali", Foto struk, repeat monthly, "Anggaran Belanja Online lewat Rp789.000 · Rp2.790.000 / 2.000.000", checkbox "Tambah lagi setelah simpan" (add another after saving), Batal/Simpan ⌘↵ | filled |

### 3. User flows
1. **Expense** (y7bcPI): open sheet (N) → type amount → pick a category tile, or "Lihat semua" (see all) → category popover (with remaining budget) → pick account → pick date → note + tags → Save (↵ / ⌘↵). Categories without their own tile are shown in the "Lainnya" (other) tile (BJfbo); categories with a tile are highlighted directly (nHThj).
2. **Income** (d5IFA): Masuk tab → amount → income source (tile / Lihat semua: AKTIF/PASIF/LAINNYA) → account → date → note/tags → optional recurring income → Save.
3. **Dividend / Interest** (K2ygzK): pick source (investment asset or account interest) → enter net amount in the asset's currency → gross/tax breakdown → ≈ IDR conversion → Save.
4. **Transfer** (oirbn, z4MZfY): pick From → pick To (the same account is disabled) → amount → transfer fee + fee category → optional Repeat. If currencies differ: automatic reference rate → enter the actual "Diterima" (received) amount → difference recorded automatically.
5. **Exchange rate** (BW1En): Reference → switch to Manual (enter rate; % deviation from reference shown) → updating → failure (use last rate + Coba lagi / retry).
6. **Tags** (N44SuZ): type `#` → tag suggestions with usage counts → ↑↓ select / ↵ add / "Buat tag" → max 5 tags.
7. **Receipt** (VD4Fa): drag file → reading (OCR) → fields autofilled (amount, date, merchant) or failure (format/size).
8. **Repeat** (C0dtY0): enable Repeat → pick frequency (weekly: weekday; monthly: day of month; yearly) → Ends (Never / After N times) → preview of next 3 occurrences + H-1 reminder → "masuk Perlu ditinjau dulu" (goes to Review queue first).
9. **Validation & result** (WremZ): Save with empty fields → inline errors → fix; transfer to the same account → error; insufficient balance → warning with 3 actions; saved → Urungkan (undo) toast, form reset ("Tambah lagi"); close while form is filled → Discard / Save draft dialog.
10. **Create category from popover** (zsh4a): "Buat kategori pengeluaran/pemasukan" → dialog → new category is selected immediately [INFERENCE].
11. **Loading** (eRR2Q): category/account skeleton → "Menyimpan…" button.

---

## B. Transactions page — Section 04 [ITYcg]

### 1. Overview & user goal
A page listing all transactions per period ("128 transaksi di 7 rekening · 1–15 Oktober 2026"). The top contains a Masuk/Keluar/Transfer summary, a daily spending chart, and account cards that can be clicked to filter the table. Below is a table (Per hari / Per kategori / Rata — by day / by category / flat) with search, filters, sorting, bulk actions, a detail panel (inline edit, tags, split, delete, duplicate, split bill → receivable), and the **Review queue** (AI results from Gmail, deleted categories, recurring schedules due). Bank statement import (CSV/XLSX/PDF) and Export (CSV/Excel/PDF/ZIP of attachments) also live on this page.

### 2. Screens & states
| Screen | Node | Content/purpose | State |
|---|---|---|---|
| Transactions (page) | t7l0Cj | Header + Impor mutasi / Ekspor / Catat Transaksi N; cards Masuk +Rp26.000.000 (4 trx), Keluar −Rp16.500.000 (121), Transfer Rp9.500.000 (3, "ke tabungan"); "Pengeluaran harian · rata-rata Rp1.100.000"; account cards (BCA Tahapan Rp42.810.000 "4 tujuan", Bank Jago "Dana Darurat" Rp8.125.000, GoPay Rp412.000, "3 lainnya" Rp3.676.000, investments "IDR + USD · 5 platform" Rp61.420.000); search "Cari merchant, catatan, atau #tag" ( / ); tabs Per hari/Per kategori/Rata; filter chips Tanggal 12–15 Okt · Jenis · Kategori · Rekening · Tag · + Filter; columns Time/Description/Amount; day group "Kamis, 15 Okt · Hari ini · 3 transaksi · −Rp180.000"; rows with tags, category, badge "Gmail · agent" | default |
| Other accounts | NCqkQ | Popover "Rekening lainnya · −Rp800.000 bulan ini", Mandiri/OVO ("saldo rendah" — low balance)/Cash, "Sematkan agar rekening tampil sebagai kartu sendiri" (pin to show as its own card); table "Difilter: Mandiri, OVO, Dompet · 14 transaksi"; "+Rp100.000 · 1 top-up OVO · tidak dihitung" (not counted); "Menampilkan 6 dari 14 transaksi" | filter |
| Pick OVO from Other | aCSAu | "Lainnya ▾ · OVO · 1 dari 3 lainnya" | filter |
| Pick BCA | h26Rk | "Difilter: BCA Tahapan · 49 transaksi", "−Rp3.000.000 · 1 keluar ke Bibit · tidak dihitung", "rata-rata Rp953.000" | filter |
| Flat view | r8ep9 | No grouping; date+time per row; footer "14 transaksi · −Rp1.651.000" | view |
| By-category view | ztMHB | Category groups with % (35%, 22%, 20%, 18%, 5%) and subtotals (−Rp620.000…) | view |
| Attachment lightbox | fnn3m | "248 KB · JPG · diunggah 15 Okt, 08.02 · Shopee — Rak buku 5 susun · 100% · Unduh · Hapus · 1 / 3"; ← → / Esc | overlay |
| Attachment upload failed | sx3H3 | "Gagal mengganti struk · Format .webp tidak didukung… Struk lama tetap tersimpan."; "IMG_2041.jpg tidak diunggah · Ukuran 3,4 MB melebihi batas 2 MB per gambar · Pilih ulang" | error |
| Import — Upload | e56WO | Stepper Upload file → Review transactions → Done; "Impor ke rekening" (BCA •• 4821 IDR); file max 10 MB, CSV · XLSX · PDF e-statement; "Bank yang didukung · dikenali otomatis · + CSV umum"; "Unduh template CSV"; "Transaksi yang sudah ada otomatis dilewati (deteksi duplikat). File diproses di perangkatmu dan tidak disimpan." (processed on your device, not stored); "PDF terkunci? …" | default |
| Import — Review | Z0eAyw | "mutasi-bca-okt-2026.csv · 42 KB · terdeteksi format BCA · periode 1–14 Okt 2026 → BCA Tahapan"; 48 Found / 41 To import / 5 Duplicates skipped / 2 Unreadable ("Baris 17: format tanggal '31/09/2026' tidak valid", "Baris 33: kolom jumlah kosong"); table bank description / category / amount / Status "Baru" (new); "TRSF KE BIBIT RDPU → Transfer → Bibit"; "QRIS MIXUE KEMANG · Pilih kategori · Perlu kategori"; "✦ kategori ditebak dari riwayat transaksimu" (category guessed from your history); "1 transaksi belum punya kategori · akan masuk 'Lainnya'"; Kembali / Impor 41 transaksi | review |
| Import — Failed | El2vm | "4 file belum bisa diproses": .docx not supported; 14,8 MB > 10 MB ("pecah per bulan" — split by month); locked PDF (password "biasanya tanggal lahir (DDMMYY)" — usually date of birth · Buka); "Rekening tidak cocok · terdeteksi Mandiri •• 9102 · Impor ke Mandiri / Tetap ke BCA" (account mismatch) | error |
| Export — Pick format | eiqas | Format CSV / Excel (sheet per month) / PDF report; Period (active filter 12–15 Okt, this month, last month, this year, Custom…); "Ikuti filter yang sedang aktif" (follow active filter) (Account/Type/Category/Tag: All); Columns 9 of 11 (Date & time, Currency & rate, Attachment link, Running balance, Transaction ID…); "Sertakan lampiran (ZIP) · 3 struk & gambar ±1,4 MB"; "14 transaksi akan diekspor · transaksi_12-15okt-2026.csv ±4 KB · Dibuat di perangkatmu" | default |
| Export — Failed | QhAUq | ZIP of 128 transactions + 23 attachments ±86 MB; "Ekspor gagal di 14 dari 23 lampiran · Koneksi terputus… Belum ada file tersimpan · Coba lagi" | error |
| Export — Succeeded | yidyU | "Ekspor selesai · 14 transaksi · …csv · 4 KB · Buka file" | success |
| Filter: Date | wi4p2 | Presets Today/Yesterday/This week/Last 7 days/This month/Last month/This year + range calendar; "12–15 Okt · 4 hari · 14 transaksi · Terapkan" | popover |
| Filter: Type | RLoeY | Type checklist + counts (Pengeluaran 12, Dividen & bunga 0); Select all; "Tampilkan 12" | popover |
| Filter: Category | hbmUp | "2 dipilih" (2 selected), search, groups KEBUTUHAN/KEINGINAN/PEMASUKAN & TRANSFER + counts; Clear selection; Tampilkan 7 | popover |
| Filter: Account | vBLUp | Groups BANK/E-WALLET/TUNAI & INVESTASI + counts | popover |
| Filter: Tag | PaIu7 | Match "Salah satu" (any) / "Semua tag" (all); #tag list + counts; "Tanpa tag" (untagged) | popover |
| + Filter: Amount range | ajFap | TAMBAH FILTER: Amount range, Has attachment, Recurring bill, Source (Manual/Import), Currency (IDR/USD), Uncategorized (0); Min 100.000 – Max; chips ≥50.000/≥100.000/≥1.000.000; "Termasuk pemasukan & transfer" (include income & transfers); "6 pengeluaran ≥ Rp100.000" | popover |
| Configure columns | q1t7n8 | Drag-to-reorder columns; "Tag di bawah deskripsi" (tags under description), Attachment, Running balance, Source; Density Nyaman/Padat (comfortable/compact); Reset to default | popover |
| Search: kantor | p22to9 | "4 hasil untuk 'kantor' · 12–15 Okt · total −Rp146.000"; "Dicari di" (searched in) | results |
| No results | auXN6 | "Tidak ada transaksi 'netflix'… Netflix biasanya ditagih tanggal 18"; Cari di semua tanggal / Hapus semua filter; "Netflix tercatat sebagai langganan · Rp186.000 tiap tgl 18" | empty |
| Sort | iQHBZ | Newest/Oldest/Largest/Smallest amount; "Kelompokkan per hari" (group by day); "Urut jumlah mematikan kelompok per hari" (sorting by amount disables day grouping) | popover |
| Multi-select | n71CLe | Bar "N dipilih · Ubah kategori · Pindah rekening · Tambah tag · Hapus" | bulk |
| Row menu | OveDm | E (edit), D (duplicate), Split transaction, Change category (submenu: Tagihan & Utilitas, All categories…), Move account, Add tag, Copy amount (−42.000), Delete ⌫ | context menu |
| Panel — Inline category edit | sRZzG | "Ubah kategori Shopee…" with remaining budget per category | inline edit |
| Panel — Add tag | dtIEb | "#lam" → lampu (2×), …aran (1×), "Buat tag #lam", "2 / 5 tag" | autocomplete |
| Panel — Split transaction | GJppz | Shopee Rp299.000: Belanja part (209.000) [INFERENCE], Hobi "Lampu baca LED" 65.000, Biaya platform "Ongkir + biaya layanan" 25.000; "Sisa Rp0 · pas" (remaining Rp0 · exact); Add part; Split evenly; "Tag, struk, dan 2 gambar ikut ke semua bagian. Anggaran tiap kategori ikut diperbarui."; "Pisah jadi 3" | dialog |
| Panel — Delete confirmation | NkXhx | "Struk dan 2 gambar ikut terhapus… mengurungkannya beberapa detik"; "Saldo BCA Tahapan Rp42.810.000 → Rp43.199.000" | dialog |
| Panel — Deleted | pERdi | Summary updated (127 transactions, Keluar −Rp16.111.000); toast "Transaksi dihapus · Shopee · −Rp389.000 dikembalikan ke BCA Tahapan · Urungkan" | success+undo |
| Panel — Duplicate | XOoye | "Disalin dari Shopee · 14 Okt… Struk & gambar tidak ikut disalin", date changed to "Hari ini, 19.45" | sheet |
| Recurring transfer detail | jibQf | "Setor dana darurat · Berulang · bulanan"; Fee Rp2.500 Biaya bank; "Aktif sejak 14 Okt · tampil di kalender"; Next 14 Nov/14 Des/14 Jan · H-1; activity timeline "Diulang tiap bulan, tgl 14 · 14 Okt 19.31", "Dicatat via Catat Transaksi · 14 Okt 19.30" | panel |
| Turn off Repeat: confirmation | r892Xi | "Hentikan pengulangan? Jadwal mulai 14 Nov dihapus dari kalender dan pengingat H-1 dimatikan… Transfer 14 Okt tetap tercatat · saldo tidak berubah" | dialog |
| Recurrence stopped | j51Sw | "Tidak berulang · Mati · dihentikan 17 Okt"; timeline "Pengulangan dihentikan · 3 jadwal dihapus · 17 Okt 10.12"; Urungkan toast | success+undo |
| Skeleton | a2Sg1 | "Memuat transaksi…" | loading |
| Refreshing data | CxfYv | "Memperbarui transaksi…" (when changing filters) | partial loading |
| Load failed | dNUPl | "Server tidak merespons saat mengambil 128 transaksi Oktober…"; Coba lagi / Hubungi bantuan; "504 · GET /transactions?period=2026-10" | error |
| Empty (new user) | v7E8YI | "Belum ada transaksi… Ketik bebas seperti 'makan siang 35rb gopay' — kategori dan rekening ditebak otomatis"; "Semua dicatat manual · write.financial tidak pernah meminta login bank" (everything is recorded manually · never asks for bank login) | empty |
| Split bill CGV (draft) | IGHyP | −Rp485.000; split method Sama rata/Nominal/Persen/Per item (equal/amount/percent/per item); You 242.500 (Hiburan, BCA) + Nadia 242.500 "jadi piutang · jatuh tempo 18 Okt" (becomes receivable · due 18 Oct); Add person; "Total cocok" (total matches); SETELAH DISIMPAN (after saving): Hiburan October 2.100.000→1.860.000, Expenses 16.500.000→16.260.000, Safe daily limit Rp140.000→Rp155.000, Receivables Rp0→Rp242.500 | draft dialog |
| PLN recorded by agent via Gmail | ryUf2 | "Tercatat otomatis · Gmail · AI agent · yakin 97%"; "dari aturan 'Utilitas rumah'"; email source (BCA <bca@bca.co.id>, excerpt, "lolos: bca.co.id · pembayaran", "Isi email tidak disimpan — hanya kutipan" (email body not stored — excerpt only)); timeline: Gmail push 18.02 → Read by AI agent claude-sonnet-5.5 (1,9 s, $0,004) → rule adds #rumah → auto-recorded "yakin 97% (batas 90%)"; button "Bukan transaksi" (not a transaction) | detail |
| Review queue from Gmail (2) | N4J73r | "keyakinan agent di bawah 90%" (agent confidence below 90%); Tokopedia "Menunggu pembayaran" (awaiting payment) 62% confidence (unpaid bill) → Catat tetap / Abaikan + "Abaikan 'Menunggu pembayaran' berikutnya"; BCA incoming funds +250.000 from RAKA PRATAMA 71% confidence → choose Other income / Refund / Between accounts + "Ingat pilihan untuk pengirim ini" (remember choice for this sender) → Catat; "Belum tercatat: saldo & anggaran tidak berubah sampai kamu memilih." | review |
| Review queue: category deleted | Ju8vG | "Perlu kategori · 12 · kategori Belanja Online dihapus"; "Set kategori untuk semua 12 transaksi · Pilih kategori · Terapkan"; per row "Sudah tercatat · Saran: Lainnya / Hobi"; "0 dari 12 sudah diberi kategori · Simpan" | review |
| Review queue: subscriptions due | dIS46 | iCloud+ Rp45.000 9 Okt "lewat 6 hari" (6 days overdue), Fit Hub Rp199.000 3 Okt "lewat 12 hari"; "Saldo baru dipotong setelah kamu konfirmasi" (balance deducted only after you confirm); Belum / Sudah dibayar (not yet / paid); "Total menunggu Rp244.000 · Tandai semua dibayar" | review |
| Review queue: recurring contribution 25 Okt | yNnG3 | "Sisihkan dana tidak rutin · BCA Tahapan → Bank Jago · Rp1.150.000 · Jatuh tempo hari ini"; DIBAGI KE (allocated to) Liburan Bali 867.000, Servis motor 240.000, Perpanjang STNK 43.000; Ubah nominal / Belum / Sudah ditransfer; "Lihat di Tabungan" | review |

### 3. User flows
1. **Page → account card** (jB0ri): click card → table filtered ("Difilter: BCA Tahapan · 49 transaksi") → "3 lainnya" card opens popover → pick OVO ("1 dari 3 lainnya") → switch to Flat / By category view → click attachment → lightbox → receipt replacement fails.
2. **Statement import**: pick destination account → upload file → (failure: format/size/locked PDF/account mismatch) → Review (duplicates skipped, failed rows, guessed categories, detected transfers) → "Impor 41 transaksi" → Done.
3. **Export**: pick format → period/filter → columns → ZIP attachments option → Export → success (Buka file) / failure (Coba lagi).
4. **Filters** (sGt7K): Date → Type → Category → Account → Tag (any/all) → + Filter (amount range, attachment, recurring bill, source, currency, uncategorized) → Configure columns.
5. **Table** (W3oN4U): search ("/") → no results (suggestion from subscription data) → sort → multi-select → bulk action → row menu (shortcuts E/D/⌫).
6. **Detail panel** (VLhJu): change category inline → add tag → split transaction → delete → Urungkan toast → duplicate (opens a filled Record Transaction sheet).
7. **Recurring transfer** (oMK4d): open detail → turn off Repeat → confirm → stopped (3 schedules removed, Urungkan).
8. **Split bill** (iP6Cg): pick split method → add person → other people's shares become receivables (with due date) → impact preview → save split.
9. **Gmail AI** (E1MPdQ): email arrives → agent reads it → if confidence ≥90% it is auto-recorded (can be marked "Bukan transaksi"); if <90% it goes to the Review queue → Catat / Abaikan (record / ignore), plus "remember" rules.
10. **Category deleted** (fDjqP): transactions lose their category → Perlu kategori (needs category) queue → set in bulk or per row → Save.
11. **Recurring schedule due** (b13ie0): subscription or savings contribution comes due → Review queue item (not yet recorded) → Paid/Transferred (optional Ubah nominal / change amount) → transaction created, balance and goal updated.

---

## 4. Data entities & fields (combined 03 + 04)

**transaction**
| Field | Type | Evidence |
|---|---|---|
| id | uuid | export column "ID transaksi" |
| user_id | fk | — |
| type | enum `expense \| income \| transfer \| dividend_interest` | Keluar/Masuk/Transfer tabs; Type filter "Dividen & bunga" |
| amount_minor | bigint (minor unit of the account currency) | Rp85.000; US$6,88 → cents |
| currency | char(3) IDR/USD | Currency filter |
| amount_base_minor (IDR) | bigint | "≈ Rp112.490" |
| fx_rate | numeric(18,6) | "kurs Rp16.350 per US$1" |
| fx_rate_source | enum `reference \| manual` | Acuan/Manual |
| fx_rate_as_of | timestamptz | "diperbarui 15 Okt, 16.42" |
| account_id | fk account | account |
| category_id | fk category, nullable | "Belum dikategorikan", "Perlu kategori" |
| occurred_at | timestamptz (date + time) | "14 Okt 2026, 21.03"; "Jadwalkan" (future date) |
| description / merchant | text | "Grab — pulang kantor"; OCR merchant "CGV Grand Indonesia" |
| note | optional text | "Catatan opsional" |
| source | enum `manual \| import \| gmail_agent \| recurring \| receipt_ocr?` | Source filter Manual/Impor; badge "Gmail · agent"; "Dicatat via Catat Transaksi" |
| review_status | enum `confirmed \| needs_review \| ignored` | Review queue; "Belum tercatat: saldo & anggaran tidak berubah" (pending items do not affect balance) |
| review_reason | enum `low_confidence \| category_deleted \| recurring_due \| subscription_due` | queue labels |
| ai_confidence | numeric(0–1) | "yakin 97%", 62%, 71% |
| recurrence_id | fk recurrence nullable | "Berulang · bulanan" |
| parent_transaction_id / split_group_id | fk | Split transaction (parts inherit tags + attachments) |
| duplicated_from_id | optional fk [INFERENCE] | "Disalin dari Shopee" |
| import_batch_id, external_ref / dedupe_hash | fk/text | import duplicate detection, "Deskripsi dari bank" |
| bank_description | text | "TRSF E-BANKING DB SHOPEE ID" |
| created_at, updated_at, deleted_at (soft delete for Urungkan) | timestamptz | Urungkan toast |

**transfer (or 2 linked transaction legs)**: from_account_id, to_account_id (≠), amount_sent_minor + currency, amount_received_minor + currency, reference_rate, effective_rate (Rp16.474), fx_diff_minor (−Rp22.660), fee_minor (2.500) + fee_category_id (bank/platform fee) → becomes a child expense transaction. Transfers to savings or investment accounts are shown as "ke tabungan" (to savings) and "tidak dihitung" (not counted) in the expense total.

**dividend detail**: source_asset_id (NVDY) or source_account_id (Mandiri interest), gross_minor (US$8,10), tax_minor (US$1,22), tax_label/rate ("Pajak AS 15% (W-8BEN)", "pajak final 20%"), net_minor.

**transaction_split_share** (split bill): transaction_id, person_name ("Nadia"), method enum `equal|amount|percent|item`, share_minor, receivable_id (fk Debts & installments › Receivables), due_date (18 Okt).

**tag**: id, user_id, name (slug, lowercase, kebab: "dana-darurat"), usage_count ("12× dipakai"). **transaction_tag** (m:n, max 5 per transaction).

**attachment**: id, transaction_id, file_name, mime (jpg/png/pdf), size_bytes (≤2 MB), storage_key, uploaded_at ("diunggah 15 Okt, 08.02"), kind enum `receipt|image`, ocr_result jsonb (amount, date, merchant, fields_read=3).

**recurrence**: id, template (type, amount, account, category, tags, note, transfer target, fee), frequency enum `weekly|monthly|yearly` (+ "Tiap hari" for weekly?), weekday (Kamis) / day_of_month (14), end_type enum `never|after_n|on_date?`, end_count (6), reminder_offset_days (H-1), requires_review bool ("masuk Perlu ditinjau dulu"), status `active|stopped`, started_at, stopped_at ("dihentikan 17 Okt"), next_occurrences.

**scheduled_occurrence / review item**: recurrence_id or subscription_id or savings_plan_id, due_date, expected_amount_minor, status `pending|confirmed|skipped`, allocations (contribution → goal: Liburan Bali 867.000 …).

**category**: id, kind enum `expense|income|fee`, name (≤24 chars), group enum (expense: kebutuhan/keinginan; income: aktif/pasif/lainnya; BIAYA KEUANGAN), icon, color, monthly_budget_minor (expense, optional), monthly_target_minor (income, optional), show_as_tile bool [INFERENCE: tile vs "Lainnya"], deleted_at.

**account** (reference): name, type (bank/e-wallet/cash/investment), currency, last4 ("•• 4821"), balance, pinned ("Sematkan agar rekening tampil sebagai kartu sendiri"), low-balance flag.

**draft_transaction**: payload jsonb (Simpan draf).

**import_batch**: account_id, file_name, detected_bank, period, counts (found 48 / imported 41 / duplicates 5 / failed 2), row_errors.

**email_ingest_log**: message_id, from, subject, quote (excerpt only), matched_filters ("bca.co.id · pembayaran"), model ("claude-sonnet-5.5"), latency (1,9 s), cost ($0,004), confidence, rule_id ("Utilitas rumah"), outcome. **ingest_rule**: name, sender filter, actions (add tag #rumah, set category), "Abaikan 'Menunggu pembayaran' berikutnya", "Ingat pilihan untuk pengirim ini".

**transaction_activity** (timeline): event (created_via, recurrence_set, recurrence_stopped, ai_read…), at, meta.

**user_preferences**: table columns (order, visibility), density (Nyaman/Padat), view mode, sort.

## 5. Business rules & calculations
- **Balance after save**: balance + amount (income) / − amount (expense). Bank Jago example: 8.125.000 + 6.200.000 = Rp14.325.000 ✔. BCA: 42.810.000 + 18.500.000 = Rp61.310.000 ✔.
- **Transfer**: from −(amount+fee) when the fee is charged to the sender; BCA 42.810.000 − 3.000.000 − 2.500 = Rp39.807.500 ✔; Bibit 2.500.000 + 3.000.000 = Rp5.500.000 ✔. The fee is recorded as a separate expense with a fee category.
- **Exchange rate & difference**: expected = sent / ref_rate; 3.000.000 / 16.350 = US$183,49 ✔; effective rate = sent / received = 3.000.000 / 182,10 ≈ Rp16.474 ✔; IDR difference = (received − expected) × ref_rate = −1,39 × 16.350 ≈ −Rp22.660 ✔ (recorded to the "Selisih kurs" (FX difference) category). USD→IDR: 100 × 16.350 = 1.635.000; received 1.618.400 → −Rp16.600, effective Rp16.184 ✔. Manual mode: difference = 0, deviation = 16.474/16.350 − 1 = +0,8% ✔. Note: BCA 39.810.000 = 42.810.000 − 3.000.000 (no fee on this screen).
- **Dividend**: net = gross − tax = 8,10 − 1,22 = 6,88 ✔; tax 15% × 8,10 = 1,215 → 1,22; IDR ≈ 6,88 × 16.350 = 112.488 → Rp112.490 (rounded to tens [INFERENCE]).
- **Budget impact**: % = (spent + amount)/budget. Transport 1.460.000/2.000.000 = 73% ✔; Health 250.000/500.000 = 50%. "akan lewat anggaran Rp566.000" = spent + active amount − budget. Belanja Online 2.790.000 − 2.000.000 = over by Rp789.000 (the design says 789.000, but the math gives 790.000 → ambiguity).
- **Insufficient balance (warning, not blocking)**: shortfall = (amount + fee) − balance = 50.002.500 − 42.810.000 = Rp7.192.500 ✔; "Tetap simpan" allows a negative balance.
- **Validation**: amount > 0; category required for expense/income; source ≠ destination; max 5 tags; category name ≤24; attachments JPG/PNG/PDF ≤2 MB (HEIC/WEBP rejected); import ≤10 MB per file, CSV/XLSX/PDF.
- **Page summary**: transfers to savings/investments and top-ups between own accounts are "tidak dihitung" (not counted) in Masuk/Keluar. Daily average = total expense / number of days (16.500.000/15 = 1.100.000 ✔; BCA 14.300.000/15 ≈ 953.000 ✔).
- **Delete**: balance restored (42.810.000 + 389.000 = 43.199.000 ✔); attachments deleted too; can be undone for a few seconds (soft delete).
- **Split transaction**: Σ parts = total ("Sisa Rp0 · pas"); tags and attachments copied to every part; per-category budgets updated.
- **Split bill**: the user's share stays an expense; other people's shares become receivables. Impact: Hiburan 2.100.000 − 242.500 = 1.857.500 (design shows 1.860.000, rounded); Safe daily limit rises 140k→155k [formula comes from the Overview module].
- **By-category %**: category subtotal / filtered total expense.
- **AI ingest**: confidence ≥ 90% → auto-recorded; < 90% → Review queue without affecting balance.
- **Duplicate**: copy all fields except attachments; date reset to now.
- **Import**: dedupe against existing transactions; categories guessed from history; uncategorized ones go to "Lainnya"; transfers between own accounts are recognized.
- **Category deleted**: its transactions stay "Sudah tercatat" (already recorded) but enter the Perlu kategori queue.
- **Recurring schedules** (subscriptions/contributions): do not deduct balance until confirmed.

## 6. Background jobs/scheduler & integrations
- **Recurrence generator**: creates the occurrence (pending review when "masuk Perlu ditinjau dulu") on the due date; generates the next 3 schedules for the calendar.
- **H-1 reminder** for recurring schedules / subscriptions / contributions; cancelled when the recurrence is stopped.
- **Due marker**: overdue subscriptions and savings contributions enter the Review queue ("lewat 6 hari").
- **Reference exchange rate sync** (USD/IDR) periodically + on-demand refresh endpoint; fallback to the last rate.
- **Receipt OCR**: async job (upload → read amount, date, merchant).
- **Gmail push → AI agent**: Pub/Sub webhook → queue → LLM extract → rules → record/enqueue; store cost and latency log.
- **Statement import**: parsing is stated to be "diproses di perangkatmu dan tidak disimpan" (processed on your device, not stored) (client-side), so only the batch commit happens on the server.
- **Export**: "Dibuat di perangkatmu" (generated on your device) → client-side; ZIP of attachments requires downloading many files (can partially fail).
- **Soft-delete purge** after the undo window [INFERENCE].
- **Draft cleanup** [INFERENCE].

## 7. UI components used
Sheet/side-sheet, segmented tabs (Keluar/Masuk/Transfer, Acuan/Manual, Per hari/Per kategori/Rata), amount input + quick chips, category tile grid + "Lainnya", grouped searchable popover listbox (categories/accounts/sources, with remaining-budget/balance meta, disabled items, ↑↓ Esc keyboard navigation), date-time picker with presets, tag input + autocomplete (2/5 counter), upload dropzone + progress + error, recurrence editor + schedule preview, inline validation + summary, warning banner with actions, toast with Urungkan (undo), confirm dialog, summary cards, daily sparkline/bar chart, clickable/pinnable account cards, filter chips + counted checklist popovers, sort menu, column config (drag), data table with groups + subtotals, bulk action bar, context menu with shortcuts, detail panel + activity timeline, lightbox, stepper wizard (import), import stat tiles, skeleton, empty state, error state with code, source/confidence badge (Gmail · agent · yakin 97%), kbd hints (⌘K, N, /, ⌘↵).

## 8. Open questions / ambiguities
1. Transfer model: one row with 2 accounts, or two legs (debit/credit)? Does the transfer fee become a separate expense transaction (the text "Catat Rp2.500 sebagai pengeluaran" points that way)?
2. Is the FX difference recorded as a "Selisih kurs" expense or only as metadata? What if the effective rate is better than the reference (a gain)?
3. IDR rounding rules (Rp112.488→112.490; 1.857.500→1.860.000; 789.000 vs 790.000) — design bug or intentional display rounding?
4. "Jadwalkan" in the date picker: do future-dated transactions become pending (not deducting balance)?
5. Tile vs "Lainnya" trigger: based on usage frequency or user-pinned?
6. Ends: besides "Tidak pernah" and "Setelah N kali", is there "Pada tanggal" (on date)? Weekly shows "Tiap hari" — does it mean day of the week?
7. Source inconsistency: the page says "write.financial tidak pernah meminta login bank / Semua dicatat manual", yet there is a Gmail AI agent integration. The Source filter only has Manual/Impor; is Gmail included?
8. How long is the undo window ("beberapa detik" — a few seconds)? Does the server soft delete or does the client delay the request?
9. Drafts: stored on the server or locally? Can there be more than one?
10. Attachment limit: 2 MB per image, but the lightbox shows "1 / 3". What is the maximum number of attachments per transaction?
11. Client-side import parsing (locked PDF, XLSX) — truly without a server? This affects security and the libraries used.
12. Balance state when a Review queue item from a transfer schedule has allocations to savings goals: are the transfer transaction + goal allocations created atomically?
13. The "fee" category (BIAYA KEUANGAN) is marked KEBUTUHAN — does this group count toward the budget?
