# CrossCutting: Sumber data, Komponen, Mode terang, Mode privasi

Sumber: `/tmp/digest/00-sumber-data.md`, `01-komponen.md`, `11-mode-terang.md`, `12-mode-privasi.md`. Teks lengkap panduan aksesibilitas diambil dari `design/html/01-komponen.html` (node `LSwUS`) karena di digest terpotong.

---

## A. Section 00 — Sumber data [d7VC0]

### 1. Ringkasan & tujuan user
Ini bukan layar produk. Section ini adalah "lembar kebenaran" untuk dataset contoh periode **1–15 Oktober 2026** milik user "Avtara K.". Isinya ringkasan pemasukan/pengeluaran, anggaran, rekening, riwayat tabungan, tujuan, setoran rutin, dan holding. Semua layar lain menurunkan angkanya dari sini, jadi section ini dipakai sebagai **acuan seed data dan fixture tes**.

### 2. Daftar layar & state
| Nama | Node | Isi | State |
|---|---|---|---|
| Oktober 1–15 · ringkasan | e5iLf | Pemasukan, pengeluaran, ditabung, saving rate, jumlah transaksi | default |
| Anggaran Oktober · batas Rp18,75jt | dAY7U | Batas dan terpakai per kategori | default |
| Rekening · saldo & arus Oktober | mSYon | Saldo, arus, dan delta per rekening; total aset | default |
| Ditabung per bulan | SQz2o | Mei–Okt: tabungan + investasi | default |
| Tujuan tabungan · sekarang (30 Sep) | S2WKf | 6 tujuan aktif + 1 selesai | default |
| Setoran rutin & investasi | clKag | Jadwal setoran, holding, Netflix | default |

### 3. Alur user
Tidak ada alur. Isinya data referensi.

### 4. Entitas data & field
Lihat bagian **Seed data** di bawah. Entitas yang tersirat: `Transaction` (jenis masuk/keluar/transfer, tanggal+jam, rekening, kategori, status "diproses"), `Account`, `Category` (+kelompok Kebutuhan/Keinginan, anggaran), `Goal` (+sumber dana campuran: rekening dan porsi % holding), `RecurringDeposit` (tgl, sumber → tujuan, jumlah), `Holding` (unit, harga USD, platform), `Subscription`.

### 5. Aturan bisnis & perhitungan (cek konsistensi)
| Rumus | Bukti | Status |
|---|---|---|
| Pemasukan = Σ | 18,5 + 6,2 + 1,09 + 0,21 = **26,0 jt** | ✓ |
| Ditabung = pemasukan − pengeluaran | 26,0 − 16,5 = **9,5 jt** = Gotrade 6,0 + Jago 0,5 + RDPU 3,0 | ✓ |
| Saving rate = ditabung / pemasukan | 9,5/26 = **36,5%**; Sep: 7,5/25,8 = 29,1% | ✓ |
| Jumlah transaksi | 4 + 121 + 3 = **128** | ✓ |
| Kebutuhan / Keinginan terpakai | Sewa 4,5 + Makan 3,2 + Transport 1,4 + Tagihan 1,3 + Kesehatan 0 = **10,4** ✓; Keinginan 6,1 = Belanja 2,4 + Hiburan 2,1 + Langganan 0,9 + **0,7 lainnya** (privasi-peek menampilkan Rp700.000) | ✓ |
| Batas per kelompok | Kebutuhan 4,5+3,5+2,0+1,5+0,5 = **12,0** ✓; Keinginan 6,75 = 2,0+2,5+1,0 + **1,25** (Hobi/Perawatan Diri/Hadiah & Donasi, tidak dirinci) | sebagian |
| Sisa anggaran | 18,75 − 16,5 = **2,25 jt**; terpakai 88% | ✓ |
| Ideal hari ke-N | 15/31 = **48%** | ✓ |
| Batas aman harian = sisa ÷ sisa hari | 2.250.000/16 ≈ **Rp140.000** | ✓ |
| % kategori | Makan 3,2/3,5 = 91%; Belanja 2,4/2,0 = 120%; Tagihan 1,3/1,5 = 87% | ✓ |
| Saldo tersedia = Σ rekening non-investasi | 42,81+8,125+3,24+0,412+0,086+0,35 = **55,023 jt**; delta 1,2+0,5−0,6−0,4−0,05−0,15 = **+0,5** | ✓ |
| BCA arus | 24,7 − 14,0 − 9,5 = **+1,2** | ✓ |
| Total aset | 55,023 + 61,42 = **116,443 jt** | ✓ |
| Rata-rata ditabung 6 bln | (6,3+5,4+3,9+8,0+7,5+9,5)/6 = 6,77 ≈ **6,8 jt** | ✓ |
| Total tujuan | 11,125+14,1+10,3+2,8+0,72+0,68 = **39,725**; angka (30 Sep) Σ = 29,865; rekening 17,325 + investasi 22,4 | ✓ |
| Progress tujuan | Dana Darurat 11,125/54 = **21%**; Dana darurat 0,6 bulan = 11,125/(54/3) | ✓ |
| Holding USD→IDR | SPY 1,197 × $690,10 × 16.350 ≈ **Rp13.506.000** (tampil 13,5 jt) = DP 60% 8,1 + Pensiun 40% 5,4 | ✓ |
| Dana tidak rutin tgl 25 | 867.000 + 240.000 + 43.000 = **1.150.000** (Bali/Servis/STNK) | ✓ |
| Rencana setoran tujuan Okt | 0,5 + 3,0 + 1,15 = **4,65 jt** | ✓ |
| Portofolio | Modal 53,931 + untung 7,489 = **61,42**; 7,489/53,931 = 13,9%; US$3.757 × 16.350 ≈ 61,43 | ✓ |

**Inkonsistensi yang perlu dicatat:**
- Wallet Card komponen (ALH0W) BCA menampilkan "−Rp11.200.000 bulan ini", sedangkan sumber data menulis **+1.200.000**.
- Proyeksi akhir bulan Rp24.200.000. Ekstrapolasi linear 16,5/15×31 = 34,1 jt; kalau sewa dianggap tetap, (12,0/15×31)+4,5 = 29,3 jt. Rumusnya tidak bisa direproduksi.
- Popover kategori: "Langganan akan lewat anggaran Rp566.000". 900.000 + sisa tagihan 660.900 − 1.000.000 = 560.900, bukan 566.000.
- "Rp17.300.000 dialokasikan ke tabungan · bebas Rp37.700.000": 55,023 − 17,3 = 37,723 (dibulatkan), dan rekening tujuan 17,325.
- Kekayaan bersih "+Rp4.220.000 sejak 30 Sep": 116,443 − 112,2 = 4,243. Mungkin ada utang/cicilan yang ikut dihitung [INFERENCE].
- Contoh "Rekening bukan IDR" Gotrade Kas US$2.778 × 16.350 = Rp45.420.000 (+15,2%), sementara holding Gotrade (SPY 13,5 + SCHD 4,9) jauh lebih kecil. Komposisi 61,42 jt per platform tidak bisa direkonsiliasi dari data ini.
- Judul kartu memakai "Rp18,75jt", padahal panduan melarang singkatan jt/rb.
- Langganan: header "Rp904.900/bulan", jadwal Okt 199+45+186+87+59+329 = 905.000, dan "H · 5 Okt Rp859.900". Ada tiga angka berbeda.

### 6. Job latar/scheduler & integrasi
Tersirat dari data:
- Setoran rutin tgl 1 / 14 / 25 → job recurring.
- Status "Bibit RDPU · diproses, NAB 16 Okt" → status pending yang selesai otomatis saat NAB keluar [INFERENCE].
- Harga SPY dalam USD dan kurs 16.350 → sinkronisasi harga dan kurs.
- Netflix tgl 18 → tagihan langganan.

### 7. Komponen UI
Kartu ringkasan berbentuk daftar label–nilai (bukan UI produk).

### 8. Pertanyaan terbuka
Lihat inkonsistensi di atas. Ada juga 3 kategori Keinginan (total batas 1,25 jt, terpakai 0,7 jt) yang tidak dirinci per kategori.

---

## B. Section 01 — Komponen [mp8Q8]

### 1. Ringkasan & tujuan user
Ini katalog komponen reusable: Wallet Card dan variannya, dialog CRUD (kategori, rekening, langganan), komponen dasar (dialog/sheet parts, toast, tooltip, menu item, alert dialog, dialog ekspor, popover pilih kategori/tanggal/bulan/rekening), layout shell, dan panduan aksesibilitas & format angka yang berlaku di semua halaman.

### 2. Daftar layar & state
| Nama | Node | Isi/tujuan | State |
|---|---|---|---|
| Wallet Card | ALH0W | Jenis · nama · •• 4 digit · saldo · arus "bulan ini" | default |
| Rekening bukan IDR (USD) | W2jXY | US$2.778,00 · kurs 16.350 · Rp45.420.000 · +15,2% untung | varian valas |
| Gabungan mata uang | ddgaI | "IDR + USD · Investasi · 5 platform · dalam IDR · Rp61.420.000 · +Rp3.500.000 disetor Okt" | varian agregat |
| Dialog Kategori Baru | PKbl5 | Form kategori + pratinjau | dialog |
| Dialog Rekening Baru | A4n8Tw | Form rekening + pratinjau kartu | dialog |
| Dialog Langganan Baru | ofF4z | Form langganan | dialog |
| Col Parts | TEjIn | Dialog Header/Footer, Sheet Header | – |
| Col Feedback | SQDDM | Toast (judul, keterangan, "Aksi"), Tooltip (Label, Baris 1–4, "Klik untuk rincian"), Menu item, "Memperbarui…" | memuat |
| Col Dialogs | JTxVb | Dialog Ekspor; Alert "Hapus item ini?" | dialog/destruktif |
| Col Popovers | DgoMF | Pilih kategori, tanggal+jam, bulan, rekening | popover |
| Col Layout | z0lYFa | Sidebar + header halaman | default |
| Panduan Aksesibilitas | LSwUS | Kontras, focus ring, buta warna, format angka | – |

### 3. Alur user
- **Kategori baru:** pilih Jenis (Pengeluaran/Pemasukan) → Nama (maks. 24 karakter) → Kelompok (Kebutuhan/Keinginan) → Ikon → Warna → Anggaran bulanan opsional ("Rp 500.000 / bulan") → pratinjau → "Buat kategori".
- **Rekening baru:** Jenis (Bank/E-Wallet/Tunai/Investasi/Kartu kredit) → Nama bank/penyedia (ketik bebas; "Logo ditemukan otomatis", atau "Unggah PNG"/"Pakai ikon") → Nama tampilan → 4 digit akhir → Mata uang → Saldo awal + Per tanggal → Warna kartu → toggle "Hitung dalam total saldo" dan "Tampilkan sebagai kartu" → "Tambah rekening". Catatan di dialog: "Tidak perlu login bank" (input manual).
- **Langganan baru:** Layanan (contoh "Belum ada logo") → Harga → Siklus (Bulanan/Tahunan/Mingguan) → Tagihan berikutnya → Bayar dari (rekening) → Kategori → Deskripsi → "Ingatkan sebelum ditagih: 3 hari sebelumnya · notifikasi" → toggle "Masa uji coba gratis" → Simpan. Aturannya: saat jatuh tempo, tagihan masuk "Perlu ditinjau", dan saldo baru dipotong setelah ditandai sudah dibayar.
- **Ekspor transaksi:** Format (CSV/Excel sheet per bulan/PDF laporan) → Periode (Filter aktif 12–15 Okt/Bulan ini/Bulan lalu/Tahun ini/Kustom…) → toggle "Ikuti filter yang sedang aktif" (Rekening/Jenis/Kategori/Tag) → Kolom (9 dari 11) → opsi "Sertakan lampiran (ZIP) · 3 struk · ±1,4 MB" → ringkasan "14 transaksi akan diekspor · transaksi_12-15okt-2026.csv · ±4 KB · Dibuat di perangkatmu" → "Ekspor CSV".
- **Alert hapus:** "Hapus item ini? Tindakan ini tidak bisa dibatalkan setelah beberapa detik." → Batal/Hapus. Tersirat ada jendela undo singkat lewat toast "Aksi" [INFERENCE].
- **Popover kategori:** cari ("Cari kategori… Esc") → grup KEBUTUHAN/KEINGINAN, tiap item disertai status anggaran → ↑↓ untuk memilih → "Buat kategori pengeluaran".
- **Popover tanggal:** preset (Hari ini, Kemarin, 2 hari lalu, Sabtu lalu, Awal bulan, Jadwalkan) → kalender bulan (penanda "ada transaksi") → Jam → "Sekarang" → Terapkan.
- **Popover bulan:** tahun 2026 dengan total pengeluaran per bulan dalam juta (Jan 18,9 … Okt 16,5, Nov/Des —), "Rentang khusus…".
- **Popover rekening:** grup BANK/E-WALLET/TUNAI & INVESTASI beserta saldo; OVO diberi tanda "saldo kurang".

### 4. Entitas data & field
- **Category:** `type` enum(expense, income); `name` varchar(24); `group` enum(kebutuhan, keinginan); `icon` string; `color` string; `monthly_budget` bigint nullable.
- **Account:** `type` enum(bank, ewallet, cash, investment, credit_card); `provider_name` text; `logo` (auto-resolved atau upload PNG atau ikon); `display_name`; `last4` char(4) (e-wallet memakai format no. HP "0812•• 18"); `currency` ISO (IDR/USD/SGD); `opening_balance` bigint minor; `opening_date` date; `card_color`; `include_in_total` bool; `show_as_card` bool; `is_default` (badge "default"); `archived` (dari "Diarsipkan 1").
- **Subscription:** `service_name`, `logo` nullable, `price` bigint, `cycle` enum(weekly, monthly, yearly), `next_billing_date` date, `pay_from_account_id` FK, `category_id` FK, `description` nullable, `remind_days_before` int (3), `trial` bool (+tanggal akhir trial [INFERENCE]), `status` (Aktif/Dijeda/Dibatalkan).
- **ExportJob** (atau client-side, karena "Dibuat di perangkatmu"): format enum(csv, xlsx, pdf), periode, filter, kolom (Tanggal & jam, Deskripsi, Kategori, Rekening, Jumlah, Mata uang & kurs, Tag, Catatan, Link lampiran, Saldo berjalan, ID transaksi), include_attachments.
- **Transaction** (yang tersirat): mata uang dan kurs per transaksi, tag, catatan, lampiran (struk), saldo berjalan.

### 5. Aturan bisnis & perhitungan
- Status anggaran di popover: "sisa anggaran Rp300.000" = batas − terpakai; "lewat anggaran Rp400.000"; "akan lewat anggaran" = terpakai + tagihan langganan terjadwal > batas.
- Valas: saldo IDR = saldo USD × kurs (US$2.778 × 16.350 = Rp45.420.000); persen untung = (nilai − modal)/modal.
- Rekening dengan `include_in_total = false` tidak masuk saldo tersedia dan kekayaan bersih.
- Langganan tidak memotong saldo sampai dikonfirmasi dibayar.

### 6. Job latar/scheduler & integrasi
- Pengingat langganan H-N; pembuatan item "Perlu ditinjau" saat jatuh tempo; konversi akhir trial.
- Logo otomatis dari nama penyedia (lookup logo).
- Kurs untuk rekening valas.
- Ekspor dibuat di perangkat (client-side), jadi tidak perlu worker [INFERENCE].
- "Memperbarui…" menunjukkan sinkronisasi yang sedang berjalan.

### 7. Komponen UI
Wallet Card (3 varian), Dialog (Header/Footer), Sheet Header, Toast dengan aksi, Tooltip multi-baris, Menu Item, Alert Dialog destruktif, Dialog Ekspor, Combobox kategori (grup + status anggaran + navigasi keyboard), Date-time picker dengan preset, Month picker dengan total, Account picker, Segmented control, Toggle/switch, Input uang dengan prefiks "Rp", Color/icon picker, Pratinjau langsung. **Layout shell:** sidebar (logo write.financial, Cari… ⌘K, MENU: Ringkasan, Transaksi [128], Anggaran, Langganan [7], Kalender, Investasi, Laporan, Tabungan, Utang & cicilan, Tanya Asisten ⌘J, profil "AK · Avtara K. · Paket Pribadi"). Header halaman: sapaan ("Selamat sore, Avtara"), lede periode, segmen Minggu/Bulan/Tahun, pemilih bulan "Okt 2026", "Atur", dan tombol utama "Catat Transaksi" dengan shortcut **N**.

### 8. Pertanyaan terbuka
- Wallet Card BCA −11,2 jt vs +1,2 jt.
- "Kartu kredit" ada di dialog, tetapi tidak ada contoh data atau aturan saldo negatif.
- Item sidebar "Investasi" tidak muncul di Col Layout, tetapi ada di mode terang dan privasi.
- Apakah ekspor PDF/Excel juga diproses client-side?
- Durasi jendela undo hapus ("beberapa detik") tidak ditentukan.

---

## C. Section 11 — Mode terang [tzEmf]

### 1. Ringkasan & tujuan user
Ini versi tema terang dari halaman utama dan dari dialog/panel. Datanya identik dengan mode gelap; yang berubah hanya token warna. User bisa memilih tema (ada menu "Tampilan" di Pengaturan).

### 2. Daftar layar & state
| Layar | Node | Isi | State |
|---|---|---|---|
| Dashboard — Terang | W621Uo | Ringkasan + quick add | default |
| Catat Transaksi — Terang | QOIZH | Form catat 485.000 Hiburan; peringatan "Anggaran Hiburan jadi 103% · Rp2.590.000 / 2.500.000" | dialog |
| Transaksi — Terang | l5iy14 | Buku kas 128 trx | default |
| Rekening & dompet — Terang | q0yPJ | 11 rekening | default |
| Anggaran — Terang | XMmnk | Sisa Rp2.250.000 | default |
| Langganan — Terang | Y0bpSR | 6 aktif, jadwal Okt | default |
| Kalender — Terang | hDiRP | Heatmap harian | default |
| Investasi — Terang | EZDGa | Portofolio | default |
| Laporan — Terang | w8JQ9 | Laporan Sep 2026 Final | default |
| Pengaturan — terang | NZKL8 | Mata uang & kurs | panel |
| Notifikasi — terang | Z9tYC | 4 baru | panel |
| ⌘K — terang | Q5lPHI | Command palette | popover |
| Asisten — terang | DJUYJ | Chat + draft transaksi | panel |
| Tujuan baru / Setor manual / Atur sumber dana / Detail Dana Darurat — terang | WSyFx / xYXAZ / K9dfxd / m5WEN | Halaman Tabungan + dialog | dialog |
| Konfirmasi keluar — terang | ibWUT | "Keluar dari semua perangkat · Aktif di 2 perangkat lain · iPhone, MacBook" | alert |

### 3. Alur user
Tidak ada alur baru. Isinya hanya tema yang diterapkan ke alur yang sudah ada. Toggle tema ada di Pengaturan › Tampilan [INFERENCE: isi panel Tampilan tidak ditampilkan].

### 4. Entitas data & field
`UserPreference.theme` enum(dark, light, system?) [INFERENCE: opsi "system" tidak terlihat]. Pengaturan disebut "tersinkron di semua perangkat", jadi preferensi disimpan di server.

### 5. Aturan bisnis & perhitungan
Tidak ada aturan baru. Perbedaan kontras token terang dijelaskan di panduan: $subtle #71717A, $muted-fg #52525B, $green-fg #15803D.

### 6. Job latar/scheduler & integrasi
Tidak ada.

### 7. Komponen UI
Semua komponen sama. Tema diimplementasikan lewat CSS variables (token `$fg`, `$card`, `$subtle`, `$ring`, dst.) [INFERENCE].

### 8. Pertanyaan terbuka
- Ada opsi "ikuti sistem" atau tidak?
- Layar terang untuk Utang & cicilan, Periode bulanan, Onboarding, dan Mobile tidak ada.
- Di Anggaran ada teks "garis putih = posisi ideal hari ini". Di tema terang garisnya mungkin tidak putih.

---

## D. Section 12 — Mode privasi [VPtAq]

### 1. Ringkasan & tujuan user
User bisa menyembunyikan nominal (misalnya di tempat umum atau saat berbagi layar) dan sesekali "mengintip" sebentar. Nominal diganti `Rp••••••`, sedangkan persen, tanggal, nama, jumlah transaksi, dan grafik relatif tetap tampil.

### 2. Daftar layar & state
| Layar | Node | State |
|---|---|---|
| Intip — saldo tersembunyi | L44CMl | tersembunyi; tombol "Intip saldo ⌘ ." di header |
| Intip — hover tombol | VBOGr | tooltip "Tahan untuk melihat saldo · Nominal tampil selama tombol ditahan (atau ⌘ . selama 5 detik), lalu tersembunyi lagi otomatis." |
| Intip — sedang mengintip | uZheE | "Menampilkan · 5 dtk" countdown, semua nominal tampil |
| Dashboard/Transaksi/Rekening/Anggaran/Langganan/Kalender/Investasi/Laporan — disembunyikan | Fwczn, PLnyh, S0DpW, Vn9WT, GNJcg, b5pNsK, YpGK1, TlSbI | tersembunyi |
| Notifikasi / Asisten — disembunyikan | FcTf9 / dzkrx | panel tersembunyi |
| Setor manual / Atur sumber dana / Detail Dana Darurat — disembunyikan | m8oT0 / U5lBxH / P11EF | dialog tersembunyi |

### 3. Alur user
**Intip saldo → tersembunyi → hover → sedang mengintip:**
1. Mode privasi aktif, jadi nominal tampil `Rp••••••`.
2. Hover tombol "Intip saldo" memunculkan tooltip instruksi.
3. Tombol ditahan (press-and-hold), atau tekan ⌘ ., memunculkan nominal dengan badge "Menampilkan · 5 dtk".
4. Setelah tombol dilepas, atau setelah 5 detik, nominal tersembunyi lagi.

Cara mengaktifkan atau mematikan mode privasi secara permanen tidak digambarkan [INFERENCE: kemungkinan di Pengaturan › Tampilan atau Keamanan].

### 4. Entitas data & field
`UserPreference.privacy_mode` bool. Mungkin hanya disimpan per perangkat [INFERENCE]. Tidak ada field data baru.

### 5. Aturan bisnis & perhitungan
Yang disembunyikan:
- Semua nominal uang IDR, termasuk di dalam kalimat ("Pemasukan naik tipis… (+Rp••••••)"), notifikasi ("Rp•••••• dari Rp•••••• (120%)"), dan chat Asisten (termasuk input user "Catat makan siang tadi ••• pakai GoPay").
- Biaya AI ("$•••••• dari $••••••").
- Nilai USD ("≈ US$••••••").
- **Kurs** ("kurs USD Rp••••••").
- Delta ("+Rp•••", "+••• net", "+••• terjadwal").
- Ambang batas ("di bawah Rp••••••").

Yang tetap tampil: persen (36,5%, 91%, 120%, +13,9%), tanggal/jam, jumlah transaksi/rekening, nama merchant/kategori, •• 4821, grafik dan angka sumbu tertentu (nilai portofolio 28,5…61,4 di chart Investasi tetap tampil).

Panjang placeholder: panduan menetapkan "6 titik", tetapi delta kecil memakai 3 titik ("+Rp•••", "+•••"). **Kebocoran/inkonsistensi:**
- Anggaran-disembunyikan masih menampilkan "Belanja Online +Rp400.000", "Rp10.400.000 / 12.000.000", "sisa Rp1.600.000".
- Halaman Tabungan masih menampilkan "Rp11.125.000 dari Rp54.000.000", "Rp3.500.000/bulan".
- Langganan masih menampilkan "45.000 · Rp45.000".
- Label sumbu chart Investasi tetap tampil.

Saat mengintip, angka harus sama dengan seed: 26.000.000 / 16.500.000 / 9.500.000 / 55.023.000 (+500.000) / 61.420.000 (+6.000.000) / 3.676.000 (−800.000 = Mandiri+OVO+Dompet).

### 6. Job latar/scheduler & integrasi
Tidak ada server job. Notifikasi push/email saat mode privasi aktif mungkin perlu ikut menyamarkan nominal [INFERENCE: hanya panel in-app yang digambarkan].

### 7. Komponen UI
Tombol "Intip saldo" dengan hold-to-reveal, Tooltip, badge countdown, dan komponen `<Money>` terpusat yang otomatis menyamarkan nilai. Komponen ini wajib dipakai di teks naratif, notifikasi, chat AI, dan grafik.

### 8. Pertanyaan terbuka
- Lokasi toggle permanen?
- Apakah kebocoran di Anggaran/Tabungan/Langganan disengaja (misalnya angka anggaran dianggap tidak sensitif)?
- Apakah sumbu grafik ikut disembunyikan?
- Apakah 3 titik vs 6 titik disengaja?
- Apakah ekspor dan output AI ke provider juga disamarkan?
- Apakah ⌘ . bersifat toggle 5 detik atau tahan?

---

## Aturan format angka & aksesibilitas
(Teks utuh dari node `LSwUS`.)

**Target:** WCAG 2.2 AA. Teks kecil ≥ 4,5:1; teks besar dan elemen UI ≥ 3:1.

**Kontras token teks di atas $card (gelap / terang):**

| Token | Gelap | Terang |
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

Catatan tabel: $text-faint hanya boleh untuk dekorasi dan elemen nonaktif. Nilai terang $red-fg/$amber-fg tidak terbaca di export. Perbaikan: $subtle (gelap #737373→#858585, terang #A1A1AA→#71717A), $muted-fg terang →#52525B, $green-fg terang →#15803D.

**Focus ring:** 2px `$ring` + celah 2px (`$ring-offset`), hanya saat `focus-visible`. Urutan Tab: header → lede → grafik → buku kas. Navigasi keyboard: batang hari ←/→; baris buku kas ↑/↓ untuk pindah, Enter untuk buka detail, E untuk edit.

**Ramah buta warna** (dicek dengan simulasi deuteranopia & protanopia; setiap makna warna punya penanda kedua):
- Arus uang selalu bertanda + / − (U+2212), termasuk di grafik.
- Aktual dan proyeksi dibedakan bentuk: aktual = batang terisi, proyeksi = batang abu bergaris tepi.
- Status anggaran ditulis dengan teks ("lewat Rp400.000", "akan lewat"), tidak hanya warna bar.
- Urutan irisan donat = urutan legenda, dan persen ditulis di legenda.

**Format Rupiah:**
- **Tabel & buku kas:** angka lengkap tanpa "Rp", rata kanan, font Geist Mono (tabular). Debit/kredit tanpa tanda karena kolomnya sudah bermakna (`42.810.000`).
- **Angka utama** (kartu ringkasan, lede): lengkap dengan Rp (`Rp55.023.000`).
- **Kalimat & grafik:** lengkap dengan titik ribuan (`Rp2.250.000`, `140.000`). **Tidak memakai singkatan jt/rb.**
- **Arus & selisih:** selalu bertanda; minus memakai "−" U+2212, bukan tanda hubung (`+9.500.000`, `−2.277.000`).
- **Persen:** koma desimal, dibulatkan ke nilai terdekat (`36,5%`; 1.300.000/1.500.000 = `87%`).
- **Valas:** `US$690,10`, dengan kurs di sebelahnya: "Rp16.350 per US$1".
- **Mode privasi:** nilai diganti 6 titik (`Rp••••••`); persen dan tanggal tetap tampil.

Implikasi implementasi: satu util `formatMoney(minor, {currency, context: 'table'|'headline'|'sentence'|'delta', privacy})` berbasis `Intl.NumberFormat('id-ID')`, dengan tanda minus diganti U+2212.

Pengecualian di desain yang melanggar aturan:
- Judul "Rp18,75jt" (dAY7U).
- Ringkasan sumber data "masuk 24,7 − keluar 14,0", serta popover bulan dan heatmap yang memakai angka juta ("Angka kecil = total pengeluaran (juta)").
- Sumbu chart "28,5…61,4".

Untuk **input**, parser menerima singkatan ("kopi 25rb gopay"), jadi parser natural-language perlu memahami "rb"/"jt".

---

## Seed data
User: **Avtara K.** (inisial AK, "Paket Pribadi"). Periode berjalan: 1–15 Okt 2026, hari ke-15 dari 31, 16 hari lagi menuju gajian. Mata uang utama IDR; kurs USD **16.350**. Semua uang disimpan sebagai bigint rupiah.

### Rekening (aktif 11, diarsipkan 1)
| Rekening | Jenis | Detail | Saldo 15 Okt | Δ Okt |
|---|---|---|---|---|
| BCA Tahapan | Bank | •• 4821, default, 4 tujuan; masuk 24,7 − keluar 14,0 − transfer 9,5 | 42.810.000 | +1.200.000 |
| Bank Jago | Bank | •• 0377, seluruhnya Dana Darurat | 8.125.000 | +500.000 |
| Mandiri | Bank | •• 9102; masuk 1,3 − keluar 1,9 | 3.240.000 | −600.000 |
| GoPay | E-Wallet | 0812•• 18 | 412.000 | −400.000 |
| OVO | E-Wallet | perlu disesuaikan (34 hari), saldo kurang | 86.000 | −50.000 |
| Dompet (tunai) | Tunai | perlu disesuaikan (21 hari) | 350.000 | −150.000 |
| **Saldo tersedia** | | | **55.023.000** | **+500.000** |
| Investasi: 5 platform (Gotrade USD, Bibit, … ) | Investasi | tidak dihitung di saldo tersedia; 1 dalam USD | 61.420.000 | disetor +6.000.000; RDPU 3.000.000 diproses |
| **Total aset** | | | **116.443.000** | Kekayaan bersih 30 Sep 112.200.000 |

[INFERENCE] Platform investasi yang namanya terlihat: Gotrade (USD), Bibit (RDPU, IDX30, ORI). Tiga platform lainnya tidak disebut di digest ini.

### Kategori & anggaran Oktober (batas total 18.750.000, 10 kategori)
| Kategori | Kelompok | Terpakai | Batas | % |
|---|---|---|---|---|
| Sewa Kos | Kebutuhan | 4.500.000 | 4.500.000 [INFERENCE] | 100 |
| Makan & Dapur (18×) | Kebutuhan | 3.200.000 | 3.500.000 | 91 |
| Transportasi | Kebutuhan | 1.400.000 | 2.000.000 | 70 |
| Tagihan & Utilitas | Kebutuhan | 1.300.000 | 1.500.000 | 87 |
| Kesehatan | Kebutuhan | 0 | 500.000 | 0 |
| Belanja Online (Erafone 2,15 + Shopee 0,25) | Keinginan | 2.400.000 | 2.000.000 | 120 |
| Hiburan | Keinginan | 2.100.000 | 2.500.000 | 84 |
| Langganan | Keinginan | 900.000 | 1.000.000 | 90 |
| Hobi, Perawatan Diri (sisa 250.000), Hadiah & Donasi | Keinginan | Σ 700.000 | Σ 1.250.000 | – |
| **Total** | Kebutuhan 10,4/12,0 · Keinginan 6,1/6,75 | **16.500.000** | **18.750.000** | 88 |

Kategori pemasukan: Gaji, Freelance, Penjualan & lainnya, Dividen & bunga [INFERENCE: nama kategori diambil dari label sumber pemasukan]. Pengeluaran bulanan 2026 (juta): Jan 18,9 · Feb 17,2 · Mar 23,4 · Apr 18,1 · Mei 17,8 · Jun 19,2 · Jul 21,4 · Agu 16,9 · Sep 18,3 · Okt 16,5 (berjalan).

### Pemasukan Oktober (26.000.000; 4 transaksi)
Gaji PT Kinarya 1 Okt → BCA 18.500.000. Freelance Studio Arunika 14 Okt → BCA 6.200.000 (invoice #0912). Penjualan & lainnya → Mandiri 1.090.000. Dividen & bunga → Mandiri 210.000. Transfer (3): Gotrade 6.000.000 (1 Okt), Jago 500.000 (1 Okt), Bibit RDPU 3.000.000 (14 Okt 19.30, diproses, NAB 16 Okt).

### Ditabung per bulan
Mei 6.300.000 (2,3+4,0) · Jun 5.400.000 · Jul 3.900.000 (pengeluaran 21.400.000) · Agu 8.000.000 · Sep 7.500.000 (saving rate 29,1%; pemasukan 25.800.000, pengeluaran 18.300.000) · Okt 9.500.000 (3,5+6,0). Rata-rata 6.800.000.

### Langganan (Aktif 7 / Dijeda 1 / Dibatalkan 3; ≈Rp904.900/bulan)
Jadwal Okt: 3 Okt 199.000 · 5 Okt Fit Hub, Niagahoster · 9 Okt 45.000 iCloud+ (perlu ditinjau) · 18 Okt Netflix 186.000 (BCA) · 20 Okt 87.000 · 22 Okt 59.000 · 28 Okt ChatGPT 329.000 (terbesar). Sisa tagihan Okt Rp660.900 (4 tagihan, 18–28 Okt). Riwayat: "+Spotify, ChatGPT naik, +YouTube" (+24% sejak Mei). Contoh dialog: Disney+ Hotstar 39.000/bulan, GoPay, Hiburan, tagihan 2 Nov 2026.

### Tujuan tabungan (6 aktif + 1 selesai)
| Tujuan | Sumber dana | Target | Sekarang | 30 Sep | Tenggat / setoran |
|---|---|---|---|---|---|
| Dana Darurat | Jago 8,125 + RDPU 3 | 54.000.000 | 11.125.000 (21%) | 7.625.000 | Nov 2027; 3.500.000/bln tgl 1 & 14 |
| DP Rumah | SPY 60% 8,1 + IDX30 1 + BCA 5 | 150.000.000 | 14.100.000 | 11.514.000 | – |
| Dana Pensiun | SPY 40% 5,4 + SCHD 4,9 | 500.000.000 | 10.300.000 | 6.526.000 | – |
| Liburan Bali | Dana tidak rutin | 8.000.000 | 2.800.000 (35%) | 2.800.000 | Mar 2027; 867.000/bln tgl 25 |
| Servis motor | Dana tidak rutin | 1.200.000 | 720.000 (60%) | 720.000 | Des 2026; 240.000/bln tgl 25 |
| Perpanjang STNK | Dana tidak rutin | 850.000 | 680.000 | 680.000 | Feb 2027; 43.000/bln tgl 25 |
| Selesai: Kursi kerja ergonomis | – | – | 1.050.000 | Shopee 9 Sep | – |
| **Total** | rekening 17,325 + investasi 22,4 | | **39.725.000** | 29.865.000 | |

### Setoran rutin
Tgl 1 BCA → Kantong darurat Jago 500.000. Tgl 1 BCA → Gotrade 6.000.000 (DCA SPY 4.000.000 + SCHD 2.000.000; SPY dialokasikan 60/40 DP/Pensiun, SCHD → Pensiun). Tgl 14 BCA → Bibit RDPU 3.000.000 (sejak Okt; Sep → Jago 2.000.000). Tgl 25 sisihkan dana tidak rutin 1.150.000.

### Holding
| Holding | Platform | Detail | Nilai IDR |
|---|---|---|---|
| SPY | Gotrade (USD) | 1,197 unit × $690,10 | 13.500.000 |
| SCHD | Gotrade (USD) | – | 4.900.000 |
| IDX30 | Bibit | – | 1.000.000 |
| ORI | Bibit | belum dialokasikan | 1.500.000 |
| RDPU | Bibit | 3.000.000 diproses, NAB 16 Okt | 3.000.000 |

Portofolio: 11 posisi di 5 platform; nilai 61.420.000 (≈US$3.757); modal 53.931.000; untung belum terealisasi +7.489.000 (+13,9%); hari ini +312.000 (+0,51%); dividen 12 bulan 2.640.000 bersih (yield 4,3%); Return YTD portofolio +11,2% vs SPY +14,8% vs IHSG +3,1%. Nilai akhir bulan (juta, Nov→Okt): 28,5 · 30,9 · 33,6 · 35,4 · 36,8 · 40,3 · 43,8 · 46,9 · 49,1 · 53,5 · 57,7 · 61,4. Gotrade Kas US$2.778,00 = Rp45.420.000 (+15,2%) menurut contoh komponen.

### Lain-lain
Asisten: model claude-sonnet-5.5 via OpenRouter, pemakaian $1,24 dari $5/bulan. Kuota CoinGecko 8.012/10.000 (80%). Batas saldo rendah e-wallet Rp500.000. Sesi aktif di 2 perangkat lain (iPhone, MacBook). Tag yang dipakai: kantor, freelance, rumah, reimburse, liburan-bali. Sumber transaksi: Gmail, agent.
