# Analisis: Catat Transaksi (Section 03) & Transaksi (Section 04)

Sumber: `/tmp/digest/03-catat-transaksi.md`, `/tmp/digest/04-transaksi.md`. Node id ditulis dalam [kurung].

---

## A. Catat Transaksi (sheet input) — Section 03 [Q7ss6P]

### 1. Ringkasan & tujuan user
Ini sheet cepat yang dibuka dari mana saja (tombol "Catat Transaksi", shortcut `N`) untuk mencatat **Keluar**, **Masuk**, **Transfer**, dan varian **Dividen / Bunga**. User ingin mencatat transaksi dalam beberapa detik. Caranya: isi nominal (ada chip cepat +10.000/+50.000/…), pilih kategori dari tile, lalu rekening, tanggal, catatan, dan tag. Ada juga opsi Foto struk (OCR) dan Ulangi (berulang). Sheet langsung menampilkan dampaknya ke anggaran dan saldo ("Anggaran Transportasi jadi 73%", "Saldo Bank Jago jadi Rp14.325.000 setelah disimpan."). Transfer mendukung lintas mata uang IDR↔USD, dengan kurs acuan atau manual dan selisih kurs yang dicatat otomatis.

### 2. Daftar layar & state
| Layar | Node | Isi/tujuan | State |
|---|---|---|---|
| Catat Transaksi (Sheet) | airjf | Tab Keluar/Masuk/Transfer, `Rp 85.000`, tile kategori "Makan & Dapur", "Hari ini", "Catatan, mis. makan siang", Simpan ↵ | default (Pengeluaran) |
| + Foto struk diklik | iL4L4 | Dropzone "Foto atau seret struk ke sini · Nominal & tanggal terisi otomatis · JPG, PNG, PDF" | expand opsi |
| + Ulangi diklik | ifafu | Frekuensi Mingguan/Bulanan/Tahunan, "Tiap tgl", Berakhir "Tidak pernah", preview "Lalu 15 Nov · 15 Des · 15 Jan · H-1" | expand opsi |
| Sheet — Pilih Kategori | uIA2X | Cari kategori (Esc), grup KEBUTUHAN/KEINGINAN; tiap kategori menampilkan "sisa anggaran Rp300.000", "lewat anggaran Rp400.000", "akan lewat anggaran Rp566.000"; "Buat kategori pengeluaran"; navigasi ↑↓ | popover |
| Sheet — Pilih Rekening | IZfLx | Grup BANK/E-WALLET/TUNAI & INVESTASI, saldo per rekening, OVO "Rp86.000 · saldo kurang", Bibit RDPU "Reksa dana & SBN" | popover, warning saldo |
| Sheet — Pilih Tanggal | u9c7V | Preset Hari ini 15 Okt / Kemarin / 2 hari lalu / Sabtu lalu / Awal bulan; "Jadwalkan"; kalender Sn–Mg; Jam ":" "Sekarang"; titik "ada transaksi"; Terapkan | popover |
| Pengeluaran: Kesehatan (masuk Lainnya) | BJfbo | 250.000, "Apotek K-24 — vitamin", tag kesehatan/apotek, "Anggaran Kesehatan jadi 50% · Rp250.000 / 500.000" | terisi |
| Pengeluaran: Transportasi (tile sendiri) | nHThj | 63.000 "Grab — pulang kantor", tag kantor/ojol, "Anggaran Transportasi jadi 73% · Rp1.460.000 / 2.000.000" | terisi |
| Catat Pemasukan | PKtGi | "+Rp 6.200.000", Sumber pemasukan (tile Bonus/THR, Penjualan…), Masuk ke rekening, "14 Okt 2026, 21.03", "Invoice #0912 — Studio Arunika", tag freelance/studio-arunika + saran gaji/pasif/klien-baru, toggle "Pemasukan rutin", "Saldo Bank Jago jadi Rp14.325.000 setelah disimpan." | default |
| Pilih Sumber Pemasukan | V0vjhj | Cari; grup AKTIF / PASIF (Sewa properti, Royalti & afiliasi) / LAINNYA (Penjualan barang, Reimburse kantor, Cashback & refund, Hadiah diterima); jumlah bulan "Oktober", "Rp0"; "Buat kategori pemasukan" | popover |
| Pemasukan: Hadiah (Lainnya) | Hb6pS | +500.000, "Hadiah ulang tahun" | terisi |
| Pemasukan: Gaji (tile) | G7mAdM | +18.500.000 "Gaji Oktober · PT Kinarya", 1 Okt 08.00, BCA jadi Rp61.310.000 | terisi |
| Catat Dividen | SiIkP | "Jumlah bersih +US$ 6,88 ≈ Rp112.490 · kurs Rp16.350 per US$1"; Sumber NVDY (YieldMax NVDA Option Income); Masuk ke Gotrade Kas USD; rincian Distribusi kotor US$8,10, Pajak AS 15% (W-8BEN) −US$1,22, Bersih US$6,88 | default |
| Dividen: Pilih Sumber | b94mvI | REKENING · BUNGA (Bunga tabungan, pajak final 20%, "Bunga 2,5% p.a.", Mandiri), YIELDMAX · DISTRIBUSI BULANAN (MSTY, NVDY, TSLY, CONY…) | popover |
| Catat Transfer | qB5s3 | Dari (BCA Rp39.807.500 setelah) → Ke Bibit RDPU (Rp2.500.000 → Rp5.500.000); Biaya transfer 2.500, "Catat Rp2.500 sebagai pengeluaran · Biaya bank"; "Ulangi tiap bulan · Tiap tgl 14 · masuk Perlu ditinjau dulu" | default |
| Transfer beda mata uang IDR→USD | TyPAn | Kurs "1 USD = Rp16.350 · Kurs acuan · diperbarui 15 Okt, 16.42"; toggle Acuan/Manual; "Diterima di Gotrade · Seharusnya US$183,49 · kurs efektif Rp16.474 · US$182,10"; "Selisih dicatat otomatis −Rp22.660 · US$1,39 lebih kecil dari seharusnya"; Biaya platform | default |
| Transfer USD→IDR | CpDml | Kirim US$100,00 (chip +$10/+$50/+$100), Gotrade US$234,10→US$134,10, BCA Rp39.810.000→Rp41.428.400; Seharusnya Rp1.635.000, kurs efektif Rp16.184, diterima 1.618.400, selisih −Rp16.600 | default |
| Transfer: Pilih Rekening Dari / Ke | AOKBG / jDHoU | Rekening yang sudah dipilih di sisi lain di-disable ("Sudah dipilih sebagai tujuan/asal") | popover |
| Transfer: Kategori Biaya | vjq8t | BIAYA KEUANGAN: Biaya bank (BI-FAST, antarbank, SKN), Biaya platform, Admin bulanan, Pajak & meterai, Selisih kurs ("Kurs efektif lebih buruk dari acuan"); "Buat kategori biaya" | popover |
| Kurs: Mode Manual | N1CG8 | "1 USD = Rp 16.474 · Manual · +0,8% dari acuan Rp16.350"; "Tidak ada selisih" | manual |
| Kurs: Sedang memperbarui | KynJj | "Mengambil kurs terbaru…", "Menunggu kurs untuk menghitung…" | memuat |
| Kurs: Gagal memperbarui | Y9v7p | "Gagal memperbarui · pakai kurs 15 Okt, 16.42"; toast "Kurs tidak bisa diperbarui · Tidak ada koneksi… · Coba lagi" | error (fallback) |
| Tag: saran saat mengetik | MFm6o | Ketik "#rei" → TAG YANG ADA: reimburse (12× dipakai), reimburse-kantor (3×), kerja-rei… (1×); "Buat tag"; "2 / 5 tag" | autocomplete |
| Struk: seret file | vKspl | "Lepaskan untuk mengunggah struk · 1 file · nominal & tanggal dibaca otomatis · struk-cgv.jpg" | drag-over |
| Struk: membaca | eXSk4 | "struk-cgv.jpg · 1,2 MB · Membaca nominal, tanggal & merchant…" | memuat (OCR) |
| Struk: terisi otomatis | IVy2Y | badge "dari struk", "15 Okt 2026, 19.12 · CGV Grand Indonesia · 2 tiket + snack", "3 isian terbaca: jumlah, tanggal, merchant" | sukses |
| Struk: gagal diunggah | Q1VXMY | "IMG_3381.HEIC tidak diunggah · Format .heic tidak didukung. Gunakan JPG, PNG, atau PDF maks 2 MB. · Pilih file" | error |
| Pengeluaran: Ulangi setiap minggu | i9gG9u | 150.000 "Futsal mingguan — Lapangan Senayan", "Tiap Kamis", preview 22 Okt · 29 Okt · 5 Nov · H-1 | opsi aktif |
| Pemasukan: rutin | ETzDc | "Retainer bulanan", Tiap tgl 14, "Berakhir · Setelah 6 kali" | opsi aktif |
| Transfer: Ulangi tiap bulan | lsV22 | Tiap tgl 14, Tidak pernah, 14 Nov/14 Des/14 Jan, H-1 | opsi aktif |
| Validasi: isian kosong | jSYxL | "Masukkan jumlah lebih dari Rp0", "Pilih satu kategori", "2 isian perlu dilengkapi" | error validasi |
| Tersimpan, siap tambah lagi | m56kp | "1 transaksi tersimpan di sesi ini", toast "Transaksi tersimpan · Hiburan · −Rp485.000 · BCA Tahapan. Form siap untuk transaksi berikutnya. · Urungkan" | sukses |
| Validasi: rekening asal = tujuan | szrvO | "Rekening asal dan tujuan tidak boleh sama · Pilih tujuan lain" | error |
| Peringatan: saldo tidak cukup | Ud5ju | Transfer 50.000.000: "Saldo BCA Tahapan kurang Rp7.192.500 · Saldo tercatat Rp42.810.000, transfer + biaya Rp50.002.500. Mungkin ada pemasukan yang belum dicatat."; aksi "Catat pemasukan dulu", "Sesuaikan saldo", "Tetap simpan" | warning (non-blocking) |
| Tutup tanpa simpan | J9HC1 | "Buang transaksi ini?… simpan sebagai draf"; ringkasan "Nonton bareng — CGV Grand Ind… · Hiburan · BCA Tahapan · 2 tag"; Simpan draf / Lanjut mengisi / Buang | dialog |
| Buat kategori pengeluaran | noHtC | Nama (maks. 24 karakter) "Pendidikan", Kelompok, Ikon, Warna, Anggaran bulanan (opsional) 500.000/bulan, Pratinjau "Kebutuhan · Rp500.000/bulan" | dialog |
| Buat kategori pemasukan | l3toE | "Les privat", Kelompok Aktif/Pasif, Ikon, Warna, Target bulanan (opsional) 1.500.000 | dialog |
| Memuat kategori & rekening | AemKn | "Memuat kategori…" | memuat |
| Menyimpan… | s1mwEx | "Menyimpan…" | memuat |
| Duplikat: sheet terisi (dari §04) | XOoye | Menampilkan bentuk lengkap sheet: chip +10.000/+50.000/+100.000/+500.000, "Lihat semua", tile Belanja/Lainnya, "Hari ini, 19.45", catatan opsional, tag "maks. 5 · Tambah tag… · Sering dipakai: reimburse · liburan-bali", Foto struk, Ulangi setiap bulan, "Anggaran Belanja Online lewat Rp789.000 · Rp2.790.000 / 2.000.000", checkbox "Tambah lagi setelah simpan", Batal/Simpan ⌘↵ | terisi |

### 3. Alur user
1. **Pengeluaran** (y7bcPI): buka sheet (N) → ketik nominal → pilih tile kategori, atau "Lihat semua" → popover kategori (dengan sisa anggaran) → pilih rekening → pilih tanggal → catatan + tag → Simpan (↵ / ⌘↵). Kategori yang tidak punya tile sendiri ditampilkan di tile "Lainnya" (BJfbo); kategori yang punya tile langsung disorot (nHThj).
2. **Pemasukan** (d5IFA): tab Masuk → nominal → sumber pemasukan (tile / Lihat semua: AKTIF/PASIF/LAINNYA) → rekening → tanggal → catatan/tag → opsional Pemasukan rutin → Simpan.
3. **Dividen / Bunga** (K2ygzK): pilih sumber (aset investasi atau bunga rekening) → isi jumlah bersih dalam mata uang aset → rincian kotor/pajak → konversi ≈ IDR → Simpan.
4. **Transfer** (oirbn, z4MZfY): pilih Dari → pilih Ke (rekening yang sama di-disable) → nominal → biaya transfer + kategori biaya → opsional Ulangi. Jika mata uang berbeda: kurs acuan otomatis → isi jumlah "Diterima" aktual → selisih dicatat otomatis.
5. **Kurs** (BW1En): Acuan → ganti ke Manual (isi kurs; tampil deviasi % dari acuan) → memperbarui → gagal (pakai kurs terakhir + Coba lagi).
6. **Tag** (N44SuZ): ketik `#` → saran tag dengan jumlah pemakaian → ↑↓ pilih / ↵ tambah / "Buat tag" → maksimal 5 tag.
7. **Struk** (VD4Fa): seret file → membaca (OCR) → field terisi otomatis (jumlah, tanggal, merchant) atau gagal (format/ukuran).
8. **Ulangi** (C0dtY0): aktifkan Ulangi → pilih frekuensi (mingguan: hari; bulanan: tanggal; tahunan) → Berakhir (Tidak pernah / Setelah N kali) → preview 3 jadwal berikut + pengingat H-1 → "masuk Perlu ditinjau dulu".
9. **Validasi & hasil** (WremZ): Simpan dengan field kosong → error inline → perbaiki; transfer ke rekening yang sama → error; saldo kurang → warning dengan 3 aksi; tersimpan → toast Urungkan, form direset ("Tambah lagi"); tutup saat form terisi → dialog Buang / Simpan draf.
10. **Buat kategori dari popover** (zsh4a): "Buat kategori pengeluaran/pemasukan" → dialog → kategori baru langsung terpilih [INFERENCE].
11. **Memuat** (eRR2Q): skeleton kategori/rekening → tombol "Menyimpan…".

---

## B. Halaman Transaksi — Section 04 [ITYcg]

### 1. Ringkasan & tujuan user
Halaman daftar semua transaksi per periode ("128 transaksi di 7 rekening · 1–15 Oktober 2026"). Bagian atasnya memuat ringkasan Masuk/Keluar/Transfer, grafik pengeluaran harian, dan kartu rekening yang bisa diklik untuk memfilter tabel. Di bawahnya ada tabel (Per hari / Per kategori / Rata) dengan pencarian, filter, sortir, bulk action, panel detail (edit langsung, tag, pisah, hapus, duplikat, pisah tagihan → piutang), serta antrean **Perlu ditinjau** (hasil AI dari Gmail, kategori dihapus, jadwal rutin jatuh tempo). Impor mutasi bank (CSV/XLSX/PDF) dan Ekspor (CSV/Excel/PDF/ZIP lampiran) juga ada di halaman ini.

### 2. Daftar layar & state
| Layar | Node | Isi/tujuan | State |
|---|---|---|---|
| Transaksi (halaman) | t7l0Cj | Header + Impor mutasi / Ekspor / Catat Transaksi N; kartu Masuk +Rp26.000.000 (4 trx), Keluar −Rp16.500.000 (121), Transfer Rp9.500.000 (3, "ke tabungan"); "Pengeluaran harian · rata-rata Rp1.100.000"; kartu rekening (BCA Tahapan Rp42.810.000 "4 tujuan", Bank Jago "Dana Darurat" Rp8.125.000, GoPay Rp412.000, "3 lainnya" Rp3.676.000, investasi "IDR + USD · 5 platform" Rp61.420.000); pencarian "Cari merchant, catatan, atau #tag" ( / ); tab Per hari/Per kategori/Rata; chip filter Tanggal 12–15 Okt · Jenis · Kategori · Rekening · Tag · + Filter; kolom Waktu/Deskripsi/Jumlah; grup hari "Kamis, 15 Okt · Hari ini · 3 transaksi · −Rp180.000"; baris dengan tag, kategori, badge "Gmail · agent" | default |
| Rekening lainnya | NCqkQ | Popover "Rekening lainnya · −Rp800.000 bulan ini", Mandiri/OVO ("saldo rendah")/Tunai, "Sematkan agar rekening tampil sebagai kartu sendiri"; tabel "Difilter: Mandiri, OVO, Dompet · 14 transaksi"; "+Rp100.000 · 1 top-up OVO · tidak dihitung"; "Menampilkan 6 dari 14 transaksi" | filter |
| Pilih OVO dari Lainnya | aCSAu | "Lainnya ▾ · OVO · 1 dari 3 lainnya" | filter |
| Pilih BCA | h26Rk | "Difilter: BCA Tahapan · 49 transaksi", "−Rp3.000.000 · 1 keluar ke Bibit · tidak dihitung", "rata-rata Rp953.000" | filter |
| Tampilan Rata | r8ep9 | Tanpa grup; tanggal+jam per baris; footer "14 transaksi · −Rp1.651.000" | view |
| Tampilan Per kategori | ztMHB | Grup kategori dengan % (35%, 22%, 20%, 18%, 5%) dan subtotal (−Rp620.000…) | view |
| Lightbox lampiran | fnn3m | "248 KB · JPG · diunggah 15 Okt, 08.02 · Shopee — Rak buku 5 susun · 100% · Unduh · Hapus · 1 / 3"; ← → / Esc | overlay |
| Unggah lampiran gagal | sx3H3 | "Gagal mengganti struk · Format .webp tidak didukung… Struk lama tetap tersimpan."; "IMG_2041.jpg tidak diunggah · Ukuran 3,4 MB melebihi batas 2 MB per gambar · Pilih ulang" | error |
| Impor — Unggah | e56WO | Stepper Unggah file → Tinjau transaksi → Selesai; "Impor ke rekening" (BCA •• 4821 IDR); file maks 10 MB, CSV · XLSX · PDF e-statement; "Bank yang didukung · dikenali otomatis · + CSV umum"; "Unduh template CSV"; "Transaksi yang sudah ada otomatis dilewati (deteksi duplikat). File diproses di perangkatmu dan tidak disimpan."; "PDF terkunci? …" | default |
| Impor — Tinjau | Z0eAyw | "mutasi-bca-okt-2026.csv · 42 KB · terdeteksi format BCA · periode 1–14 Okt 2026 → BCA Tahapan"; 48 Ditemukan / 41 Akan diimpor / 5 Duplikat dilewati / 2 Gagal dibaca ("Baris 17: format tanggal '31/09/2026' tidak valid", "Baris 33: kolom jumlah kosong"); tabel Deskripsi dari bank / kategori / jumlah / Status "Baru"; "TRSF KE BIBIT RDPU → Transfer → Bibit"; "QRIS MIXUE KEMANG · Pilih kategori · Perlu kategori"; "✦ kategori ditebak dari riwayat transaksimu"; "1 transaksi belum punya kategori · akan masuk 'Lainnya'"; Kembali / Impor 41 transaksi | review |
| Impor — Gagal | El2vm | "4 file belum bisa diproses": .docx tidak didukung; 14,8 MB > 10 MB ("pecah per bulan"); PDF terkunci (kata sandi "biasanya tanggal lahir (DDMMYY)" · Buka); "Rekening tidak cocok · terdeteksi Mandiri •• 9102 · Impor ke Mandiri / Tetap ke BCA" | error |
| Ekspor — Pilih format | eiqas | Format CSV / Excel (sheet per bulan) / PDF laporan; Periode (Filter aktif 12–15 Okt, Bulan ini, Bulan lalu, Tahun ini, Kustom…); "Ikuti filter yang sedang aktif" (Rekening/Jenis/Kategori/Tag: Semua); Kolom 9 dari 11 (Tanggal & jam, Mata uang & kurs, Link lampiran, Saldo berjalan, ID transaksi…); "Sertakan lampiran (ZIP) · 3 struk & gambar ±1,4 MB"; "14 transaksi akan diekspor · transaksi_12-15okt-2026.csv ±4 KB · Dibuat di perangkatmu" | default |
| Ekspor — Gagal | QhAUq | ZIP 128 transaksi + 23 lampiran ±86 MB; "Ekspor gagal di 14 dari 23 lampiran · Koneksi terputus… Belum ada file tersimpan · Coba lagi" | error |
| Ekspor — Berhasil | yidyU | "Ekspor selesai · 14 transaksi · …csv · 4 KB · Buka file" | sukses |
| Filter: Tanggal | wi4p2 | Preset Hari ini/Kemarin/Minggu ini/7 hari terakhir/Bulan ini/Bulan lalu/Tahun ini + kalender rentang; "12–15 Okt · 4 hari · 14 transaksi · Terapkan" | popover |
| Filter: Jenis | RLoeY | Checklist jenis + count (Pengeluaran 12, Dividen & bunga 0); Pilih semua; "Tampilkan 12" | popover |
| Filter: Kategori | hbmUp | "2 dipilih", cari, grup KEBUTUHAN/KEINGINAN/PEMASUKAN & TRANSFER + count; Hapus pilihan; Tampilkan 7 | popover |
| Filter: Rekening | vBLUp | Grup BANK/E-WALLET/TUNAI & INVESTASI + count | popover |
| Filter: Tag | PaIu7 | Cocokkan "Salah satu" / "Semua tag"; daftar #tag + count; "Tanpa tag" | popover |
| + Filter: Rentang jumlah | ajFap | TAMBAH FILTER: Rentang jumlah, Ada lampiran, Tagihan rutin, Sumber (Manual/Impor), Mata uang (IDR/USD), Belum dikategorikan (0); Min 100.000 – Maks; chip ≥50.000/≥100.000/≥1.000.000; "Termasuk pemasukan & transfer"; "6 pengeluaran ≥ Rp100.000" | popover |
| Atur kolom | q1t7n8 | Kolom drag-urut; "Tag di bawah deskripsi", Lampiran, Saldo berjalan, Sumber; Kepadatan Nyaman/Padat; Kembalikan ke default | popover |
| Cari: kantor | p22to9 | "4 hasil untuk 'kantor' · 12–15 Okt · total −Rp146.000"; "Dicari di" | hasil |
| Tanpa hasil | auXN6 | "Tidak ada transaksi 'netflix'… Netflix biasanya ditagih tanggal 18"; Cari di semua tanggal / Hapus semua filter; "Netflix tercatat sebagai langganan · Rp186.000 tiap tgl 18" | kosong |
| Urutkan | iQHBZ | Terbaru/Terlama/Jumlah terbesar/terkecil; "Kelompokkan per hari"; "Urut jumlah mematikan kelompok per hari" | popover |
| Pilih banyak | n71CLe | Bar "N dipilih · Ubah kategori · Pindah rekening · Tambah tag · Hapus" | bulk |
| Menu baris | OveDm | E (edit), D (duplikat), Pisah transaksi, Ubah kategori (submenu: Tagihan & Utilitas, Semua kategori…), Pindah rekening, Tambah tag, Salin jumlah (−42.000), Hapus ⌫ | context menu |
| Panel — Edit kategori langsung | sRZzG | "Ubah kategori Shopee…" dengan sisa anggaran per kategori | inline edit |
| Panel — Tambah tag | dtIEb | "#lam" → lampu (2×), …aran (1×), "Buat tag #lam", "2 / 5 tag" | autocomplete |
| Panel — Pisah transaksi | GJppz | Shopee Rp299.000: bagian Belanja (209.000) [INFERENCE], Hobi "Lampu baca LED" 65.000, Biaya platform "Ongkir + biaya layanan" 25.000; "Sisa Rp0 · pas"; Tambah bagian; Bagi rata; "Tag, struk, dan 2 gambar ikut ke semua bagian. Anggaran tiap kategori ikut diperbarui."; "Pisah jadi 3" | dialog |
| Panel — Hapus konfirmasi | NkXhx | "Struk dan 2 gambar ikut terhapus… mengurungkannya beberapa detik"; "Saldo BCA Tahapan Rp42.810.000 → Rp43.199.000" | dialog |
| Panel — Terhapus | pERdi | Ringkasan ter-update (127 transaksi, Keluar −Rp16.111.000); toast "Transaksi dihapus · Shopee · −Rp389.000 dikembalikan ke BCA Tahapan · Urungkan" | sukses+undo |
| Panel — Duplikat | XOoye | "Disalin dari Shopee · 14 Okt… Struk & gambar tidak ikut disalin", tanggal diubah jadi "Hari ini, 19.45" | sheet |
| Detail transfer berulang | jibQf | "Setor dana darurat · Berulang · bulanan"; Biaya Rp2.500 Biaya bank; "Aktif sejak 14 Okt · tampil di kalender"; Berikutnya 14 Nov/14 Des/14 Jan · H-1; timeline aktivitas "Diulang tiap bulan, tgl 14 · 14 Okt 19.31", "Dicatat via Catat Transaksi · 14 Okt 19.30" | panel |
| Matikan Ulangi: konfirmasi | r892Xi | "Hentikan pengulangan? Jadwal mulai 14 Nov dihapus dari kalender dan pengingat H-1 dimatikan… Transfer 14 Okt tetap tercatat · saldo tidak berubah" | dialog |
| Pengulangan dihentikan | j51Sw | "Tidak berulang · Mati · dihentikan 17 Okt"; timeline "Pengulangan dihentikan · 3 jadwal dihapus · 17 Okt 10.12"; toast Urungkan | sukses+undo |
| Skeleton | a2Sg1 | "Memuat transaksi…" | memuat |
| Memperbarui data | CxfYv | "Memperbarui transaksi…" (saat ganti filter) | memuat parsial |
| Gagal memuat | dNUPl | "Server tidak merespons saat mengambil 128 transaksi Oktober…"; Coba lagi / Hubungi bantuan; "504 · GET /transactions?period=2026-10" | error |
| Kosong (pengguna baru) | v7E8YI | "Belum ada transaksi… Ketik bebas seperti 'makan siang 35rb gopay' — kategori dan rekening ditebak otomatis"; "Semua dicatat manual · write.financial tidak pernah meminta login bank" | kosong |
| Pisah tagihan CGV (draf) | IGHyP | −Rp485.000; cara bagi Sama rata/Nominal/Persen/Per item; Kamu 242.500 (Hiburan, BCA) + Nadia 242.500 "jadi piutang · jatuh tempo 18 Okt"; Tambah orang; "Total cocok"; SETELAH DISIMPAN: Hiburan Oktober 2.100.000→1.860.000, Pengeluaran 16.500.000→16.260.000, Batas aman harian Rp140.000→Rp155.000, Piutang Rp0→Rp242.500 | draf dialog |
| PLN dicatat agent via Gmail | ryUf2 | "Tercatat otomatis · Gmail · AI agent · yakin 97%"; "dari aturan 'Utilitas rumah'"; Sumber email (BCA <bca@bca.co.id>, kutipan, "lolos: bca.co.id · pembayaran", "Isi email tidak disimpan — hanya kutipan"); timeline: Gmail push 18.02 → Dibaca AI agent claude-sonnet-5.5 (1,9 dtk, $0,004) → aturan menambah #rumah → Dicatat otomatis "yakin 97% (batas 90%)"; tombol "Bukan transaksi" | detail |
| Perlu ditinjau dari Gmail (2) | N4J73r | "keyakinan agent di bawah 90%"; Tokopedia "Menunggu pembayaran" yakin 62% (tagihan belum dibayar) → Catat tetap / Abaikan + "Abaikan 'Menunggu pembayaran' berikutnya"; BCA Dana masuk +250.000 dari RAKA PRATAMA yakin 71% → pilih Pemasukan lain / Refund / Antar rekening + "Ingat pilihan untuk pengirim ini" → Catat; "Belum tercatat: saldo & anggaran tidak berubah sampai kamu memilih." | review |
| Perlu ditinjau: kategori dihapus | Ju8vG | "Perlu kategori · 12 · kategori Belanja Online dihapus"; "Set kategori untuk semua 12 transaksi · Pilih kategori · Terapkan"; per baris "Sudah tercatat · Saran: Lainnya / Hobi"; "0 dari 12 sudah diberi kategori · Simpan" | review |
| Perlu ditinjau: langganan jatuh tempo | dIS46 | iCloud+ Rp45.000 9 Okt "lewat 6 hari", Fit Hub Rp199.000 3 Okt "lewat 12 hari"; "Saldo baru dipotong setelah kamu konfirmasi"; Belum / Sudah dibayar; "Total menunggu Rp244.000 · Tandai semua dibayar" | review |
| Perlu ditinjau: setoran rutin 25 Okt | yNnG3 | "Sisihkan dana tidak rutin · BCA Tahapan → Bank Jago · Rp1.150.000 · Jatuh tempo hari ini"; DIBAGI KE Liburan Bali 867.000, Servis motor 240.000, Perpanjang STNK 43.000; Ubah nominal / Belum / Sudah ditransfer; "Lihat di Tabungan" | review |

### 3. Alur user
1. **Halaman → kartu rekening** (jB0ri): klik kartu → tabel difilter ("Difilter: BCA Tahapan · 49 transaksi") → kartu "3 lainnya" membuka popover → pilih OVO ("1 dari 3 lainnya") → ganti tampilan Rata / Per kategori → klik lampiran → lightbox → ganti struk gagal.
2. **Impor mutasi**: pilih rekening tujuan → unggah file → (gagal: format/ukuran/PDF terkunci/rekening tidak cocok) → Tinjau (duplikat dilewati, baris gagal, kategori ditebak, transfer terdeteksi) → "Impor 41 transaksi" → Selesai.
3. **Ekspor**: pilih format → periode/filter → kolom → opsi ZIP lampiran → Ekspor → berhasil (Buka file) / gagal (Coba lagi).
4. **Filter** (sGt7K): Tanggal → Jenis → Kategori → Rekening → Tag (Salah satu/Semua) → + Filter (rentang jumlah, lampiran, tagihan rutin, sumber, mata uang, belum dikategorikan) → Atur kolom.
5. **Tabel** (W3oN4U): cari ("/") → tanpa hasil (saran dari data langganan) → urutkan → pilih banyak → bulk action → menu baris (shortcut E/D/⌫).
6. **Panel detail** (VLhJu): ubah kategori inline → tambah tag → pisah transaksi → hapus → toast Urungkan → duplikat (membuka sheet Catat terisi).
7. **Transfer berulang** (oMK4d): buka detail → matikan Ulangi → konfirmasi → dihentikan (3 jadwal dihapus, Urungkan).
8. **Pisah tagihan** (iP6Cg): pilih cara bagi → tambah orang → bagian orang lain jadi piutang (jatuh tempo) → preview dampak → Simpan pembagian.
9. **Gmail AI** (E1MPdQ): email masuk → agent membaca → jika yakin ≥90% dicatat otomatis (bisa ditandai "Bukan transaksi"); jika <90% masuk Perlu ditinjau → Catat / Abaikan, plus aturan "ingat".
10. **Kategori dihapus** (fDjqP): transaksi kehilangan kategori → antrean Perlu kategori → set massal atau per baris → Simpan.
11. **Jadwal rutin jatuh tempo** (b13ie0): langganan atau setoran tabungan jatuh tempo → item Perlu ditinjau (belum tercatat) → Sudah dibayar/ditransfer (opsional Ubah nominal) → transaksi dibuat, saldo dan tujuan ter-update.

---

## 4. Entitas data & field (gabungan 03 + 04)

**transaction**
| Field | Tipe | Bukti |
|---|---|---|
| id | uuid | kolom ekspor "ID transaksi" |
| user_id | fk | — |
| type | enum `expense \| income \| transfer \| dividend_interest` | tab Keluar/Masuk/Transfer; filter Jenis "Dividen & bunga" |
| amount_minor | bigint (minor unit mata uang rekening) | Rp85.000; US$6,88 → sen |
| currency | char(3) IDR/USD | filter Mata uang |
| amount_base_minor (IDR) | bigint | "≈ Rp112.490" |
| fx_rate | numeric(18,6) | "kurs Rp16.350 per US$1" |
| fx_rate_source | enum `reference \| manual` | Acuan/Manual |
| fx_rate_as_of | timestamptz | "diperbarui 15 Okt, 16.42" |
| account_id | fk account | rekening |
| category_id | fk category, nullable | "Belum dikategorikan", "Perlu kategori" |
| occurred_at | timestamptz (tanggal + jam) | "14 Okt 2026, 21.03"; "Jadwalkan" (tanggal masa depan) |
| description / merchant | text | "Grab — pulang kantor"; OCR merchant "CGV Grand Indonesia" |
| note | text opsional | "Catatan opsional" |
| source | enum `manual \| import \| gmail_agent \| recurring \| receipt_ocr?` | filter Sumber Manual/Impor; badge "Gmail · agent"; "Dicatat via Catat Transaksi" |
| review_status | enum `confirmed \| needs_review \| ignored` | Perlu ditinjau; "Belum tercatat: saldo & anggaran tidak berubah" (item pending tidak mempengaruhi saldo) |
| review_reason | enum `low_confidence \| category_deleted \| recurring_due \| subscription_due` | label antrean |
| ai_confidence | numeric(0–1) | "yakin 97%", 62%, 71% |
| recurrence_id | fk recurrence nullable | "Berulang · bulanan" |
| parent_transaction_id / split_group_id | fk | Pisah transaksi (bagian mewarisi tag + lampiran) |
| duplicated_from_id | fk opsional [INFERENCE] | "Disalin dari Shopee" |
| import_batch_id, external_ref / dedupe_hash | fk/text | deteksi duplikat impor, "Deskripsi dari bank" |
| bank_description | text | "TRSF E-BANKING DB SHOPEE ID" |
| created_at, updated_at, deleted_at (soft delete untuk Urungkan) | timestamptz | toast Urungkan |

**transfer (atau 2 leg transaksi terhubung)**: from_account_id, to_account_id (≠), amount_sent_minor + currency, amount_received_minor + currency, reference_rate, effective_rate (Rp16.474), fx_diff_minor (−Rp22.660), fee_minor (2.500) + fee_category_id (Biaya bank/platform) → menjadi transaksi expense anak. Transfer ke rekening tabungan atau investasi ditampilkan sebagai "ke tabungan" dan "tidak dihitung" di total keluar.

**dividend detail**: source_asset_id (NVDY) atau source_account_id (bunga Mandiri), gross_minor (US$8,10), tax_minor (US$1,22), tax_label/rate ("Pajak AS 15% (W-8BEN)", "pajak final 20%"), net_minor.

**transaction_split_share** (pisah tagihan): transaction_id, person_name ("Nadia"), method enum `equal|amount|percent|item`, share_minor, receivable_id (fk Utang & cicilan › Piutang), due_date (18 Okt).

**tag**: id, user_id, name (slug, lowercase, kebab: "dana-darurat"), usage_count ("12× dipakai"). **transaction_tag** (m:n, maks 5 per transaksi).

**attachment**: id, transaction_id, file_name, mime (jpg/png/pdf), size_bytes (≤2 MB), storage_key, uploaded_at ("diunggah 15 Okt, 08.02"), kind enum `receipt|image`, ocr_result jsonb (amount, date, merchant, fields_read=3).

**recurrence**: id, template (type, amount, account, category, tags, note, transfer target, fee), frequency enum `weekly|monthly|yearly` (+ "Tiap hari" untuk weekly?), weekday (Kamis) / day_of_month (14), end_type enum `never|after_n|on_date?`, end_count (6), reminder_offset_days (H-1), requires_review bool ("masuk Perlu ditinjau dulu"), status `active|stopped`, started_at, stopped_at ("dihentikan 17 Okt"), next_occurrences.

**scheduled_occurrence / review item**: recurrence_id atau subscription_id atau savings_plan_id, due_date, expected_amount_minor, status `pending|confirmed|skipped`, allocations (setoran → goal: Liburan Bali 867.000 …).

**category**: id, kind enum `expense|income|fee`, name (≤24 char), group enum (expense: kebutuhan/keinginan; income: aktif/pasif/lainnya; BIAYA KEUANGAN), icon, color, monthly_budget_minor (expense, opsional), monthly_target_minor (income, opsional), show_as_tile bool [INFERENCE: tile vs "Lainnya"], deleted_at.

**account** (referensi): name, type (bank/e-wallet/cash/investment), currency, last4 ("•• 4821"), balance, pinned ("Sematkan agar rekening tampil sebagai kartu sendiri"), low-balance flag.

**draft_transaction**: payload jsonb (Simpan draf).

**import_batch**: account_id, file_name, detected_bank, period, counts (found 48 / imported 41 / duplicates 5 / failed 2), row_errors.

**email_ingest_log**: message_id, from, subject, quote (kutipan saja), matched_filters ("bca.co.id · pembayaran"), model ("claude-sonnet-5.5"), latency (1,9 dtk), cost ($0,004), confidence, rule_id ("Utilitas rumah"), outcome. **ingest_rule**: name, sender filter, actions (tambah tag #rumah, set kategori), "Abaikan 'Menunggu pembayaran' berikutnya", "Ingat pilihan untuk pengirim ini".

**transaction_activity** (timeline): event (created_via, recurrence_set, recurrence_stopped, ai_read…), at, meta.

**user_preferences**: kolom tabel (urutan, visibilitas), density (Nyaman/Padat), view mode, sort.

## 5. Aturan bisnis & perhitungan
- **Saldo setelah simpan**: saldo + amount (masuk) / − amount (keluar). Contoh Bank Jago: 8.125.000 + 6.200.000 = Rp14.325.000 ✔. BCA: 42.810.000 + 18.500.000 = Rp61.310.000 ✔.
- **Transfer**: from −(amount+fee) jika biaya dibebankan ke pengirim; BCA 42.810.000 − 3.000.000 − 2.500 = Rp39.807.500 ✔; Bibit 2.500.000 + 3.000.000 = Rp5.500.000 ✔. Biaya dicatat sebagai expense terpisah dengan kategori biaya.
- **Kurs & selisih**: seharusnya = sent / ref_rate; 3.000.000 / 16.350 = US$183,49 ✔; kurs efektif = sent / received = 3.000.000 / 182,10 ≈ Rp16.474 ✔; selisih IDR = (received − expected) × ref_rate = −1,39 × 16.350 ≈ −Rp22.660 ✔ (dicatat ke kategori "Selisih kurs"). USD→IDR: 100 × 16.350 = 1.635.000; diterima 1.618.400 → −Rp16.600, efektif Rp16.184 ✔. Mode manual: selisih = 0, deviasi = 16.474/16.350 − 1 = +0,8% ✔. Catatan: BCA 39.810.000 = 42.810.000 − 3.000.000 (tanpa fee di layar ini).
- **Dividen**: net = gross − tax = 8,10 − 1,22 = 6,88 ✔; pajak 15% × 8,10 = 1,215 → 1,22; IDR ≈ 6,88 × 16.350 = 112.488 → Rp112.490 (dibulatkan ke puluhan [INFERENCE]).
- **Dampak anggaran**: % = (spent + amount)/budget. Transportasi 1.460.000/2.000.000 = 73% ✔; Kesehatan 250.000/500.000 = 50%. "akan lewat anggaran Rp566.000" = spent + amount aktif − budget. Belanja Online 2.790.000 − 2.000.000 = lewat Rp789.000 (desain menulis 789.000, padahal hitungannya 790.000 → ambiguitas).
- **Saldo kurang (warning, bukan blokir)**: kekurangan = (amount + fee) − saldo = 50.002.500 − 42.810.000 = Rp7.192.500 ✔; "Tetap simpan" memungkinkan saldo negatif.
- **Validasi**: amount > 0; kategori wajib untuk expense/income; asal ≠ tujuan; tag maks 5; nama kategori ≤24; lampiran JPG/PNG/PDF ≤2 MB (HEIC/WEBP ditolak); impor ≤10 MB per file, CSV/XLSX/PDF.
- **Ringkasan halaman**: transfer ke tabungan/investasi dan top-up antar rekening sendiri "tidak dihitung" di Masuk/Keluar. Rata-rata harian = total keluar / jumlah hari (16.500.000/15 = 1.100.000 ✔; BCA 14.300.000/15 ≈ 953.000 ✔).
- **Hapus**: saldo dikembalikan (42.810.000 + 389.000 = 43.199.000 ✔); lampiran ikut terhapus; bisa diurungkan beberapa detik (soft delete).
- **Pisah transaksi**: Σ bagian = total ("Sisa Rp0 · pas"); tag dan lampiran disalin ke setiap bagian; anggaran per kategori ikut di-update.
- **Pisah tagihan**: bagian user tetap expense; bagian orang lain menjadi piutang. Dampak: Hiburan 2.100.000 − 242.500 = 1.857.500 (desain 1.860.000, dibulatkan); Batas aman harian naik 140k→155k [rumus berasal dari modul Ringkasan].
- **Per kategori %**: subtotal kategori / total keluar terfilter.
- **AI ingest**: confidence ≥ 90% → dicatat otomatis; < 90% → Perlu ditinjau tanpa mempengaruhi saldo.
- **Duplikat**: salin semua field kecuali lampiran; tanggal di-reset ke sekarang.
- **Impor**: dedupe dengan transaksi yang sudah ada; kategori ditebak dari riwayat; yang tidak terkategori masuk "Lainnya"; transfer antar rekening sendiri dikenali.
- **Kategori dihapus**: transaksinya tetap "Sudah tercatat" tetapi masuk antrean Perlu kategori.
- **Jadwal rutin** (langganan/setoran): tidak memotong saldo sampai dikonfirmasi.

## 6. Job latar/scheduler & integrasi
- **Generator berulang**: membuat occurrence (pending review bila "masuk Perlu ditinjau dulu") pada tanggal jatuh tempo; men-generate 3 jadwal berikut untuk kalender.
- **Pengingat H-1** untuk jadwal berulang / langganan / setoran; dibatalkan saat pengulangan dihentikan.
- **Penanda jatuh tempo**: langganan dan setoran tabungan yang lewat jatuh tempo masuk Perlu ditinjau ("lewat 6 hari").
- **Sinkronisasi kurs acuan** (USD/IDR) secara berkala + endpoint refresh on-demand; fallback ke kurs terakhir.
- **OCR struk**: job async (upload → baca nominal, tanggal, merchant).
- **Gmail push → AI agent**: webhook Pub/Sub → queue → LLM extract → aturan → catat/antrekan; simpan log biaya dan latency.
- **Impor mutasi**: parsing dikatakan "diproses di perangkatmu dan tidak disimpan" (client-side), jadi hanya commit batch di server.
- **Ekspor**: "Dibuat di perangkatmu" → client-side; ZIP lampiran butuh unduh banyak file (bisa gagal parsial).
- **Purge soft-delete** setelah jendela undo [INFERENCE].
- **Pembersihan draf** [INFERENCE].

## 7. Komponen UI yang dipakai
Sheet/side-sheet, segmented tabs (Keluar/Masuk/Transfer, Acuan/Manual, Per hari/Per kategori/Rata), amount input + chip cepat, tile grid kategori + "Lainnya", searchable popover listbox bergrup (kategori/rekening/sumber, dengan meta sisa anggaran/saldo, item disabled, navigasi keyboard ↑↓ Esc), date-time picker dengan preset, tag input + autocomplete (counter 2/5), dropzone upload + progress + error, recurrence editor + preview jadwal, inline validation + summary, warning banner dengan aksi, toast dengan Urungkan, confirm dialog, kartu ringkasan, sparkline/bar chart harian, kartu rekening yang bisa diklik/disematkan, filter chip + popover checklist berhitung, sort menu, column config (drag), data table dengan grup + subtotal, bulk action bar, context menu dengan shortcut, detail panel + activity timeline, lightbox, stepper wizard (impor), stat tiles impor, skeleton, empty state, error state dengan kode, badge sumber/keyakinan (Gmail · agent · yakin 97%), kbd hint (⌘K, N, /, ⌘↵).

## 8. Pertanyaan terbuka / ambiguitas
1. Model transfer: satu baris dengan 2 rekening, atau dua leg (debit/kredit)? Apakah biaya transfer menjadi transaksi expense terpisah (teks "Catat Rp2.500 sebagai pengeluaran" mengarah ke sana)?
2. Selisih kurs dicatat sebagai expense "Selisih kurs" atau hanya metadata? Bagaimana jika efektif lebih baik dari acuan (keuntungan)?
3. Aturan pembulatan IDR (Rp112.488→112.490; 1.857.500→1.860.000; 789.000 vs 790.000) — bug desain atau memang pembulatan tampilan?
4. "Jadwalkan" di date picker: apakah transaksi bertanggal masa depan menjadi pending (tidak memotong saldo)?
5. Pemicu tile vs "Lainnya": apakah berdasarkan frekuensi pemakaian atau di-pin user?
6. Berakhir: selain "Tidak pernah" dan "Setelah N kali", apakah ada "Pada tanggal"? Mingguan menampilkan "Tiap hari" — maksudnya hari dalam seminggu?
7. Ketidakkonsistenan sumber: halaman menyebut "write.financial tidak pernah meminta login bank / Semua dicatat manual", padahal ada integrasi Gmail AI agent. Filter Sumber hanya Manual/Impor; apakah Gmail termasuk?
8. Undo window ("beberapa detik") berapa lama? Apakah server melakukan soft delete atau klien menunda request?
9. Draf: disimpan di server atau lokal? Bisa lebih dari satu?
10. Batas lampiran: 2 MB per gambar, tapi lightbox menampilkan "1 / 3". Berapa maksimal jumlah lampiran per transaksi?
11. Parsing impor di klien (PDF terkunci, XLSX) — apakah benar tanpa server? Ini berdampak pada keamanan dan library yang dipakai.
12. Status saldo saat item "Perlu ditinjau" dari jadwal transfer yang punya alokasi ke tujuan tabungan: transaksi transfer + alokasi goal dibuat atomik?
13. Kategori "fee" (BIAYA KEUANGAN) bertanda KEBUTUHAN — apakah grup ini ikut anggaran?
