# write.financial — Product Requirements Document

| | |
|---|---|
| Status | Draft v1.1 — diturunkan dari desain `dompetku.pen` (Section 00–18) + layar tambahan Section 19 (17 Okt 2026) |
| Tanggal | 17 Okt 2026 |
| Keputusan pemilik produk (17 Okt) | **Open source** + hosting terkelola di write.financial untuk yang tidak sempat self-host · tanpa budget API (sumber gratis + BYOK) · **semua yang otomatis wajib dikonfirmasi** · layar yang belum ada didesain dulu (Section 19) · v1 hanya **desktop & tablet**, mobile ditunda · subscriber = bayar untuk hosting terkelola, menyusul |
| Sumber bukti | `design/html/*.html` (export Tailwind), `design/digest/*.md` (outline + teks per layar dengan node id), `docs/design-analysis/*.md` (analisis per modul) |
| Dokumen terkait | `docs/IMPLEMENTATION_PLAN.md` |

Konvensi: **FR-xx** = kebutuhan fungsional, **P0/P1/P2** = prioritas, `[node]` = id node Pencil untuk dicek di desain. Keputusan yang tidak tertulis di desain ditandai **[Keputusan]**; semuanya dikumpulkan di §12.

---

## 1. Ringkasan produk

write.financial adalah aplikasi web pencatat keuangan pribadi berbahasa Indonesia dengan mata uang utama IDR. Semua data dicatat manual: user tidak perlu login ke bank dan aplikasi tidak membaca mutasi. Untuk mempercepat pencatatan, tersedia Catat Cepat (`N`), foto struk (OCR), impor mutasi CSV/XLSX, Asisten AI (BYOK), dan pembacaan email transaksi dari Gmail.

**Distribusi.** Kode sumber terbuka (AGPL-3.0, D21). Satu codebase dijalankan dalam dua mode (D22): **self-host** (siapa pun menjalankan instance sendiri lewat Docker Compose, datanya sepenuhnya milik pengelola instance) dan **cloud** (instance terkelola di `write.financial` untuk yang tidak sempat hosting sendiri). Tidak ada fitur yang dikunci khusus cloud; yang dibayar di cloud adalah layanan hosting, cadangan, dan pembaruan.

Data yang dicatat dan dianalisis: rekening (bank, e-wallet, tunai, kartu kredit, platform investasi; multi-mata uang), transaksi, anggaran per periode gajian, langganan, tujuan tabungan, investasi, utang/cicilan, dan laporan bulanan final.

Pembeda produk:
1. **Periode mengikuti gajian.** Tanggal mulai bisa 1–28 dan laporan periode yang sudah final bersifat immutable.
2. **"Perlu ditinjau".** Langganan, setoran rutin, dan hasil AI tidak pernah memotong saldo sebelum dikonfirmasi user.
3. **Tujuan tabungan terhubung ke aset nyata.** Saldo rekening dan porsi unit investasi dialokasikan ke tujuan, dan nilainya mengikuti harga pasar.
4. **Angka jujur.** Rupiah selalu ditulis lengkap, tanda selalu eksplisit, ada mode privasi, dan semua aksi destruktif bisa di-undo.

## 2. Tujuan, non-goal, metrik

**Tujuan**
- G1: Mencatat satu transaksi dalam ≤ 5 detik dari mana saja (shortcut `N`, bar Catat Cepat, sheet Catat).
- G2: User tahu "boleh belanja berapa hari ini" (batas aman harian) dan arah akhir periode.
- G3: Satu tempat untuk kekayaan bersih: kas + investasi (IDR/USD) − utang.
- G4: Tutup buku bulanan otomatis dengan laporan final yang bisa diekspor dan dikirim ke email.
- G5: Self-host dalam ≤ 15 menit: `docker compose up` + wizard setup pertama, tanpa langkah manual di database.
- G6: Pindah antara self-host dan cloud tanpa kehilangan data (ekspor/impor penuh, FR-A11).

**Non-goal (v1)**
- Koneksi langsung ke bank, broker, atau open banking. Desain menegaskan "Tidak perlu login bank".
- Multi-user dalam satu workspace (berbagi keuangan pasangan). Menu "Pribadi" disiapkan, tapi hanya satu workspace per user.
- **Ponsel (< 768 px).** v1 hanya desktop (≥ 1280 px) dan tablet (768–1279 px). Section 17 (Mobile) ditunda. Di layar < 768 px tampilkan halaman "Gunakan tablet atau desktop" dengan tetap mengizinkan mencatat transaksi lewat sheet Catat.
- **Subscriber/billing.** Belum ada paket berbayar. Label "Paket Pribadi" hanya tampilan, tapi model data sudah menyiapkan `plan` + entitlement (§12, D17) supaya fitur subscriber bisa ditambah tanpa migrasi besar.
- Penasihat investasi. Kalkulator rebalancing "tidak membuat transaksi".

**Metrik keberhasilan**
- Median waktu simpan transaksi via Catat Cepat < 5 detik (diukur di klien).
- ≥ 80% item "Perlu ditinjau" diselesaikan ≤ 3 hari setelah jatuh tempo.
- Selisih rekonsiliasi rata-rata per rekening < 1% saldo setelah 30 hari pemakaian.
- 0 kasus job terjadwal yang membuat transaksi ganda (idempotensi).

## 3. Persona

**Avtara K.** (data seed di desain): karyawan bergaji Rp18,5 jt (tanggal 1) sekaligus freelancer, dengan 7 rekening (BCA, Jago, Mandiri, GoPay, OVO, tunai, kartu kredit) dan 5 platform investasi (Gotrade USD, Bibit, Stockbit, Indodax, Pluang). Ia punya 6 tujuan tabungan dan 7 langganan. Ia memakai keyboard di laptop dan iPad (landscape & portrait).

## 4. Prinsip produk (mengikat semua modul)

1. **Tidak ada yang otomatis mengubah data keuanganmu tanpa konfirmasi.** Semua yang dibuat oleh sistem masuk antrean **Perlu ditinjau** dan baru berlaku setelah user menekan "Catat / Sudah dibayar / Terapkan". Ini mencakup kejadian terjadwal (langganan, setoran rutin, transaksi berulang, cicilan), hasil AI (Gmail, Asisten, struk) **berapa pun tingkat keyakinannya**, impor mutasi, dan efek tutup buku (pindah sisa anggaran, rollover). Yang boleh berjalan otomatis hanya hal yang tidak mengubah saldo, anggaran, atau transaksi: pengingat, notifikasi, sinkron harga/kurs, snapshot, kunci periode, dan penyusunan laporan.
2. **Transfer bukan pengeluaran.** Perpindahan antar rekening sendiri, setoran tabungan, top-up investasi, dan pembayaran tagihan kartu kredit tidak dihitung di Pemasukan atau Pengeluaran.
3. **Undo di mana-mana.** Hapus, pindah, gabung, dan simpan menampilkan toast "Urungkan" (soft delete + jendela undo).
4. **Format angka tunggal** (panduan `LSwUS`): lihat §7.1.
5. **Keyboard-first:** `N` catat, `⌘K` cari, `⌘J` asisten, `⌘,` pengaturan, `⌘.` intip saldo, `G`+huruf navigasi, `E/D/⌫` pada baris, `?` daftar pintasan.
6. **Aksesibilitas WCAG 2.2 AA:** kontras token sesuai tabel panduan, focus ring 2 px + celah 2 px hanya saat `:focus-visible`, dan setiap makna warna punya penanda kedua (tanda ±, teks status, pola batang).
7. **Setiap halaman punya state lengkap:** memuat (skeleton), memperbarui (data lama + indikator), gagal (pesan + kode + Coba lagi + data terakhir bila ada), kosong (CTA onboarding), offline (hanya-baca + banner).
8. **Aman secara default untuk aplikasi publik:** data keuangan setiap user terisolasi, rahasia (API key, token, secret 2FA) dienkripsi terpisah, dan aksi sensitif butuh verifikasi dua langkah (§9).

## 5. Lingkup & prioritas

| Modul | Prioritas | Milestone | Section desain |
|---|---|---|---|
| Auth + 2FA/passkey, onboarding, app shell, design system, privasi, tema | P0 | M0–M1 | 01, 11, 12, 16, 19 |
| Rekening & dompet (non-investasi) | P0 | M1 | 05 |
| Kategori, tag | P0 | M1 | 01, 02 (Pengaturan) |
| Catat Transaksi + halaman Transaksi | P0 | M1 | 02 (Catat Cepat), 03, 04 |
| Periode bulanan & tutup buku | P0 | M2 | 14 |
| Anggaran | P0 | M2 | 06 |
| Dashboard (Ringkasan) | P0 | M2 | 02 |
| Mesin jadwal + Perlu ditinjau + Langganan + Kalender + Notifikasi (popover + halaman) | P0 | M3 | 04, 07, 08, 15, 19 |
| Tabungan (tujuan) | P1 | M4 | 13 |
| Utang & cicilan, kartu kredit, **piutang** | P1 | M4 | 05, 18, 19 |
| Investasi + data pasar (bawaan gratis + BYOK + manual) | P1 | M5 | 09, 19 |
| Laporan + ekspor/impor + rentang khusus | P1 | M6 | 04, 10, 19 |
| Aturan otomatis, Asisten AI (BYOK), OCR struk | P2 | M7 | 02, 03, 15 |
| Integrasi Gmail (semua lewat Perlu ditinjau) + log Gmail | P2 | M7 | 02, 19 |
| Layout tablet, Atur dashboard, cadangan & pulihkan | P1 | M8 | 02, 19 |
| Kesiapan rilis publik: audit keamanan, verifikasi Google, kebijakan privasi (UU PDP) | P0 | M9 | — |

## 6. Kebutuhan fungsional

### 6.1 Auth, onboarding, akun (Section 16, Pengaturan › Profil/Keamanan)
- **FR-A1** Masuk via Google OAuth (scope profil saja; "Akses Gmail tidak termasuk") atau email + kata sandi (min. 10 karakter, meter kekuatan). Ada opsi "Ingat perangkat ini 30 hari". `[GNOjT, zPHkt, j8qhCU]`
- **FR-A2** Salah kata sandi atau kode 2FA: tampilkan sisa percobaan; akun dikunci 15 menit setelah 5 kali gagal. Rate limit juga per IP. `[D0gWC]`
- **FR-A3** Lupa kata sandi: tautan berlaku 30 menit, dengan cooldown kirim ulang. Akun Google tanpa kata sandi bisa menerima tautan "atur kata sandi". `[L4tjTX, uoHuu, zAsMe, yPz2Z]`
- **FR-A4** Onboarding 5 langkah: profil & mata uang (+ mata uang tambahan dan kurs) → tanggal gajian/periode dan pemasukan rata-rata → rekening dan saldo hari ini → tujuan pertama (bisa dilewati) → selesai. `[CsGVt…S53M66]`
- **FR-A5** Daftar perangkat aktif, keluar dari satu perangkat atau semua perangkat lain, dan dialog keluar dengan opsi "Keluar dari semua perangkat". `[LpVa1, pdmek]`
- **FR-A6** Kunci aplikasi dengan PIN per perangkat, aktif otomatis setelah N menit tidak aktif (default 5). Fallback: masuk dengan kata sandi. `[z6Ce7]`
- **FR-A8** **Verifikasi dua langkah**: aplikasi autentikator (TOTP, 6 digit, 30 detik), passkey (WebAuthn), dan 10 kode cadangan sekali pakai. Setup: pindai QR atau ketik kunci manual → verifikasi kode → simpan kode cadangan. Saat masuk: tantangan kode, alternatif kode cadangan/passkey, opsi "Percayai perangkat ini 30 hari". `[kKAEZ, NKmY8, ZAD9u]`
- **FR-A9** 2FA **wajib** sebelum: menyimpan API key (AI, pasar), menghubungkan Gmail, ekspor semua data, dan hapus akun. Aksi sensitif juga meminta re-autentikasi bila sesi > 15 menit.
- **FR-A10** Riwayat keamanan: masuk baru, 2FA diubah, kata sandi diubah, key ditambah/dihapus, Gmail dihubungkan/diputus. Email pemberitahuan untuk masuk dari perangkat baru.
- **FR-A11** Hak data user (UU PDP No. 27/2022): ekspor seluruh data (JSON + CSV), hapus akun (jeda 7 hari, lalu penghapusan permanen termasuk cadangan setelah masa retensi), persetujuan eksplisit untuk Gmail dan AI.
- **FR-A7** Profil: foto (≤ 2 MB), nama lengkap (dipakai di PDF), nama sapaan (dipakai di salam "Selamat sore, …"), bahasa, zona waktu IANA.

### 6.2 App shell & lintas modul (Section 01, 02, 11, 12, 15)
- **FR-S1** Sidebar: Ringkasan, Transaksi (badge jumlah), Anggaran, Langganan (badge), Kalender, Investasi, Laporan, Tabungan, Utang & cicilan, Tanya Asisten `⌘J`, Cari `⌘K`, menu pengguna. Header halaman: salam, ringkasan periode, segmen Minggu/Bulan/Tahun, pemilih periode, "Atur", "Catat Transaksi N".
- **FR-S2** Tema gelap (default), terang, dan sistem; preferensi tersinkron ke akun.
- **FR-S3** Mode privasi: semua nominal (termasuk dalam kalimat, notifikasi, chat AI, kurs, sumbu grafik) diganti `Rp••••••`, sedangkan persen dan tanggal tetap tampil. "Intip saldo" dengan tahan tombol atau `⌘.` menampilkan nominal selama 5 detik dengan badge hitung mundur. Toggle permanen ada di Pengaturan › Tampilan. `[L44CMl, VBOGr, uZheE, Trbov]`
- **FR-S4** Command palette `⌘K`: aksi cepat, baru dibuka, halaman (`G R`, `G T`, …), hasil dikelompokkan (Langganan, Transaksi, Kalender, Tujuan, Investasi). Bila tanpa hasil, tawarkan "Tanya Asisten" (Tab) dan aksi buat entitas. Harus tetap berfungsi tanpa AI. `[Z6JVby, hLRXP, nK8wJ]`
- **FR-S5** Notifikasi in-app: popover di sidebar (tab "Anggaran & tagihan" / "Sistem", item dikelompokkan per hari dengan tombol aksi, "Tandai dibaca", empty state berisi "Pengingat berikutnya") **dan halaman Semua notifikasi** (filter Semua / Belum dibaca / per jenis dengan jumlah, cari, rentang 30 hari, muat lebih lama, retensi 90 hari). Notifikasi hanya mengajak bertindak; tombolnya membuka Perlu ditinjau, bukan langsung mencatat. `[JdcJD, h5aPn2, dzA5V]`
- **FR-S7** Rentang khusus: popover dengan preset (7/30 hari terakhir, periode ini/lalu, kuartal, tahun, sejak mulai), input mulai/selesai, dua kalender bulan, tanggal masa depan nonaktif, ringkasan "N hari · melintasi N periode", pembanding = rentang sama sebelumnya. Dipakai di Dashboard, Transaksi, dan Laporan Kustom. `[WLyvf]`
- **FR-S6** Toast dengan aksi (Urungkan/Tinjau/Coba lagi/Lihat), tooltip multi-baris, alert dialog destruktif dengan ringkasan dampak.

### 6.3 Rekening & dompet (Section 05)
- **FR-R1** Jenis rekening: Bank, E-Wallet (nomor HP sebagai pengganti 4 digit), Tunai, Investasi (platform), Kartu kredit (limit, tanggal cetak tagihan, tanggal jatuh tempo). Field: nama penyedia (logo dicari otomatis dari katalog, atau unggah PNG, atau pakai ikon), nama tampilan, 4 digit akhir, mata uang (ISO), saldo awal dan tanggalnya, warna. `[A4n8Tw, C016z, BSYfj, rmT6r, RcdFp, FkWkq]`
- **FR-R2** Flag per rekening: "Hitung dalam saldo tersedia", "Tampilkan sebagai kartu" (maks. 3 kartu; sisanya digabung jadi "N lainnya"), "Default Catat Cepat" (satu per user), batas saldo rendah. `[amsm2, I3a8q]`
- **FR-R3** Mata uang dan saldo awal terkunci setelah rekening punya transaksi. `[a7r2RK]`
- **FR-R4** Sesuaikan saldo (rekonsiliasi). User mengisi saldo sebenarnya, sistem menampilkan selisihnya, lalu user memilih cara mencatatnya: (a) transaksi pengeluaran/pemasukan berkategori, (b) cari transaksi yang terlewat, (c) koreksi tanpa transaksi (tidak masuk laporan). Ada versi massal untuk rekening yang belum dicek > 14 hari. `[lAmFr, F6sIL, r3WDF7]`
- **FR-R5** Arsipkan rekening: saldo opsional ditransfer dulu, lalu pilih default baru. Transaksi tetap ada di laporan. Tab Diarsipkan menyediakan Pulihkan dan Hapus permanen (ikut menghapus transaksinya, dengan konfirmasi). `[wkqih, oed7u]`
- **FR-R6** Urutkan kartu dengan drag. Panel detail berisi grafik 6 bulan, arus masuk/keluar/transfer, transaksi terakhir, dan alokasi ke tabungan.
- **FR-R7** Kartu kredit: timeline siklus (tanggal cetak + 1 → tanggal cetak), tagihan berjalan, sisa limit, dan pengingat bayar H-3. Bayar tagihan dicatat sebagai transfer. `[YFgrE, U64Fs4]`

### 6.4 Kategori & tag (Section 01, Pengaturan)
- **FR-K1** Kategori pengeluaran (kelompok Kebutuhan/Keinginan, plus grup sistem "Biaya keuangan": Biaya bank, Biaya platform, Admin bulanan, Pajak & meterai, Selisih kurs). Kategori pemasukan (Aktif/Pasif/Lainnya). Field: nama ≤ 24 karakter, ikon (lucide), warna (palet + hex), anggaran bulanan (pengeluaran) atau target bulanan (pemasukan), urutan. `[PKbl5, noHtC, l3toE, YnLF6]`
- **FR-K2** Menu kategori: Edit, Pindah kelompok, Lihat transaksi, Gabungkan dengan…, Arsipkan, Hapus. Saat dihapus, transaksinya tetap ada tetapi masuk antrean "Perlu kategori", dan anggaran kategori itu ikut terhapus. `[iHweD, g8bxL, fDbls, Ju8vG]`
- **FR-K3** Tag: slug huruf kecil (`dana-darurat`), maks. 5 per transaksi, autocomplete `#` dengan jumlah pemakaian. Deteksi tag yang mirip, lalu gabungkan: nama lama menjadi alias dan laporan per tag dihitung ulang. `[MFm6o, k2GrzG, Q283b]`

### 6.5 Catat Transaksi (Section 02 Catat Cepat, Section 03)
- **FR-T1** Dua titik masuk: bar Catat Cepat di Dashboard (satu baris) dan sheet Catat Transaksi (`N`, dari mana saja, juga di tablet). Tab: Keluar / Masuk / Transfer, ditambah varian Dividen & bunga.
- **FR-T2** Field: jumlah (chip +10.000/+50.000/+100.000/+500.000), kategori (tile + "Lainnya" + popover cari yang menampilkan sisa/lewat/akan lewat anggaran), rekening (popover bergrup dengan saldo dan tanda "saldo kurang"), tanggal + jam (preset Hari ini/Kemarin/2 hari lalu/Sabtu lalu/Awal bulan, kalender dengan penanda "ada transaksi", "Jadwalkan" untuk tanggal mendatang), catatan, tag, lampiran struk, ulangi.
- **FR-T3** Pratinjau dampak sebelum simpan: "Anggaran Transportasi jadi 73% · Rp1.460.000 / 2.000.000" dan "Saldo Bank Jago jadi Rp14.325.000".
- **FR-T4** Transfer: Dari ≠ Ke (pilihan yang sama di-disable). Biaya transfer opsional dicatat sebagai pengeluaran terpisah berkategori biaya. Lintas mata uang: kurs acuan otomatis (tampilkan waktu pembaruan) atau Manual (tampilkan deviasi % dari acuan). User mengisi jumlah "Diterima" aktual, lalu **selisih kurs dicatat otomatis** ke kategori "Selisih kurs". State kurs memuat dan gagal memakai kurs terakhir. `[qB5s3, TyPAn, CpDml, N1CG8, KynJj, Y9v7p]`
- **FR-T5** Dividen/bunga: sumber berupa aset atau bunga rekening, rincian kotor − pajak (contoh: "Pajak AS 15% (W-8BEN)", "pajak final 20%") = bersih, dalam mata uang aset dengan konversi ≈ IDR. `[SiIkP, b94mvI]`
- **FR-T6** Ulangi: Mingguan (hari), Bulanan (tanggal), Tahunan. Berakhir: tidak pernah atau setelah N kali. Pratinjau 3 jadwal berikutnya dan pengingat H-1. Setiap kejadian masuk Perlu ditinjau. `[ifafu, i9gG9u, ETzDc, lsV22]`
- **FR-T7** Struk: seret atau pilih file JPG/PNG/PDF (≤ 2 MB per gambar; HEIC/WEBP ditolak dengan pesan jelas). OCR mengisi jumlah, tanggal, dan merchant, dengan badge "dari struk". `[vKspl, eXSk4, IVy2Y, Q1VXMY]`
- **FR-T8** Validasi inline: jumlah > 0, kategori wajib untuk keluar/masuk, asal ≠ tujuan. Saldo tidak cukup hanya **peringatan**, bukan blokir, dengan aksi "Catat pemasukan dulu / Sesuaikan saldo / Tetap simpan". `[jSYxL, szrvO, Ud5ju]`
- **FR-T9** Setelah simpan: toast dengan "Urungkan", dan opsi "Tambah lagi setelah simpan" (`⇧↵`). Menutup form yang sudah terisi memunculkan pilihan "Buang / Simpan draf / Lanjut mengisi". `[m56kp, J9HC1]`

### 6.6 Halaman Transaksi (Section 04)
- **FR-L1** Ringkasan periode: kartu Masuk/Keluar/Transfer (transfer "tidak dihitung"), grafik pengeluaran harian dengan rata-rata, dan kartu rekening yang bisa diklik untuk filter (plus popover "N lainnya"). `[t7l0Cj, NCqkQ, h26Rk]`
- **FR-L2** Tabel dengan tampilan Per hari (grup + subtotal), Per kategori (% + subtotal), dan Rata. Pencarian (`/`) atas merchant, catatan, dan `#tag`. Filter: Tanggal, Jenis, Kategori, Rekening, Tag (Salah satu/Semua), serta + Filter (rentang jumlah, ada lampiran, tagihan rutin, sumber, mata uang, belum dikategorikan). Urutkan. Atur kolom (urutan, tampil/sembunyi, kepadatan Nyaman/Padat). `[wi4p2…q1t7n8]`
- **FR-L3** Pilih banyak + aksi massal: ubah kategori, pindah rekening, tambah tag, hapus. Menu baris: Edit (E), Duplikat (D), Pisah transaksi, Ubah kategori, Pindah rekening, Tambah tag, Salin jumlah, Hapus (⌫). `[n71CLe, OveDm]`
- **FR-L4** Panel detail: edit langsung, lampiran dengan lightbox (← → Esc, unduh, hapus, maks. N per transaksi), timeline aktivitas (dibuat via, diulang, dihentikan, dibaca AI…), dan tombol "Bukan transaksi" untuk hasil Gmail. `[fnn3m, jibQf, ryUf2]`
- **FR-L5** Pisah transaksi: Σ bagian = total ("Sisa Rp0 · pas"), tag dan lampiran ikut ke setiap bagian. **Pisah tagihan** dengan orang lain (sama rata/nominal/persen/per item): bagian orang lain menjadi **piutang** dengan tanggal jatuh tempo. Dampak ke anggaran dan batas aman harian dipratinjau. `[GJppz, IGHyP]`
- **FR-L6** Hapus: konfirmasi yang menampilkan dampak saldo ("Rp42.810.000 → Rp43.199.000"), lampiran ikut terhapus, dan toast Urungkan. Duplikat: salin semua field kecuali lampiran, tanggal di-set ke sekarang. `[NkXhx, pERdi, XOoye]`
- **FR-L7** Antrean **Perlu ditinjau** dengan alasan: (1) hasil AI (Gmail, Asisten, struk) **berapa pun keyakinannya** (keyakinan hanya ditampilkan dan dipakai untuk urutan), (2) kategori dihapus (set massal atau per baris), (3) langganan jatuh tempo (Belum/Sudah dibayar, "Tandai semua dibayar"), (4) setoran rutin/transfer berulang/cicilan (Ubah nominal, Belum/Sudah ditransfer, dengan alokasi ke tujuan), (5) usulan tutup buku (pindah sisa anggaran, rollover). Selama item belum dikonfirmasi, saldo dan anggaran tidak berubah. Konfirmasi massal tersedia, tetapi selalu tindakan user. `[N4J73r, Ju8vG, dIS46, yNnG3]`
- **FR-L8** Hentikan pengulangan: konfirmasi bahwa jadwal mendatang dan pengingatnya dihapus, sedangkan transaksi lama tetap. Toast Urungkan. `[r892Xi, j51Sw]`
- **FR-L9** Impor mutasi: pilih rekening → unggah CSV/XLSX (PDF e-statement = P2), maks. 10 MB, format bank dikenali otomatis, tersedia template CSV umum → Tinjau (ditemukan / akan diimpor / duplikat dilewati / gagal dibaca beserta alasan per baris; kategori ditebak dari riwayat; transfer ke rekening sendiri dikenali) → "Impor N transaksi" (tombol ini adalah konfirmasinya). Error ditangani: format, ukuran, PDF terkunci, dan rekening tidak cocok. `[e56WO, Z0eAyw, El2vm]`
- **FR-L10** Ekspor: CSV / Excel (sheet per bulan) / PDF. Periode, opsi "ikuti filter aktif", pilihan kolom (11 kolom), ZIP lampiran opsional. Hasil berhasil atau gagal dengan Coba lagi. `[eiqas, QhAUq, yidyU]`

### 6.7 Periode bulanan & tutup buku (Section 14)
- **FR-P1** Tanggal mulai periode 1–28 (29–31 tidak tersedia) atau mode "Ikuti gajian" (tanggal diambil dari pemasukan berulang kategori Gaji). Nama periode mengikuti bulan tempat periode berakhir (25 Sep – 24 Okt = "Oktober"). `[kNL3D, WpMpY]`
- **FR-P2** Mengubah tanggal mulai menawarkan dua pilihan. (a) **Mulai periode berikutnya:** ada periode transisi dengan anggaran diprorata `batas × hari_transisi / 30`, contoh 18.750.000 × 24/30 = 15.000.000. (b) **Hitung ulang periode berjalan:** transaksi dipindah antar periode, anggaran dan saving rate dihitung ulang. Opsi (b) wajib dikonfirmasi lewat dialog. Peringatan muncul bila tanggal tidak sejalan dengan gajian yang terdeteksi. `[hvzfS, d2ztG3]`
- **FR-P3** Periode yang sudah ditutup bersifat **final dan read-only**, dan laporannya tidak berubah walaupun pengaturan diganti. Jadwal setoran dan tagihan tetap mengikuti tanggal kalendernya. `[IvIWD, Z8qibf]`
- **FR-P4** Tutup buku di awal periode baru: **otomatis** mengunci periode, menghitung hasil, membuat periode berikutnya dari versi anggaran terakhir, dan menyusun laporan. **Usulan** yang mengubah angka (pindahkan sisa anggaran ke tujuan tabungan, rollover per kategori) masuk Perlu ditinjau dan baru diterapkan setelah dikonfirmasi.

### 6.8 Anggaran (Section 06)
- **FR-B1** Batas per kategori yang berlaku mulai periode tertentu sampai diubah (berversi), dengan riwayat perubahan. "Isi dari rata-rata 3 bulan". Atur anggaran menampilkan Dialokasikan vs pemasukan (sisa pemasukan). `[F0xibH, Cb4oT]`
- **FR-B2** Halaman: hero sisa, % terpakai vs **ideal hari ke-N** (garis penanda), batas aman harian, proyeksi akhir periode, kategori lewat batas, kelompok Kebutuhan/Keinginan, panel "Perlu perhatian", tab, urutkan, ubah batas inline (↵/Esc), detail kategori (grafik harian, 3 bulan, transaksi). `[E86u2e, U4jwnw, IACml]`
- **FR-B3** Pindahkan sisa antar kategori dengan total anggaran tetap; sumber disarankan dari kategori dengan sisa terbesar. Ada toast Urungkan. `[FgYBA, wV9IH]`
- **FR-B4** Opsi per kategori: Bawa sisa ke bulan depan (rollover), Anggaran tetap (biaya tetap: tidak memakai laju harian, statusnya "lunas"), dan ambang peringatan (default 85%, bisa diubah). `[WdceE, o2VZw4]`
- **FR-B5** Peringatan bisa diabaikan sampai akhir periode. `[NpMMC]`
- **FR-B6** **Dana tidak rutin** (sinking fund): target, jatuh tempo, sudah terkumpul. Setoran per bulan dihitung otomatis. "Sisihkan tiap gajian" membuat setoran terjadwal ke Perlu ditinjau. Dana ini disimpan sebagai tujuan tabungan bertipe `sinking` ([Keputusan]: satu entitas dengan Tabungan). `[j6G7bA, McGzv]`

### 6.9 Dashboard / Ringkasan (Section 02)
- **FR-D1** Periode Minggu / Bulan / Tahun. Perbandingan like-for-like: minggu dibanding rentang hari yang sama minggu lalu, bulan dibanding bulan lalu, tahun dibanding tahun lalu. `[iUqiN, tBbvD, g9BK2]`
- **FR-D2** Kartu: KPI (Pemasukan, Pengeluaran, Ditabung & Investasi, Saving Rate vs target 30%), Rekening & dompet, **Arus Uang (Sankey)** pemasukan → kelompok → kategori (filter kelompok; menu: buka di Laporan, unduh PNG, salin gambar, tampilkan Rp/%, tampilkan sumber < 1%, hitung transfer antar rekening), pengeluaran per kategori (small multiples), pemasukan vs pengeluaran 6 bulan, anggaran, kalender pengeluaran (klik hari → rincian), langganan.
- **FR-D3** Atur dashboard: seret urutan, sembunyikan kartu, lebar ⅓/⅔/penuh, tambah kartu (Investasi ringkas, Tujuan tabungan, Pengingat tagihan 7 hari). Tata letak disimpan di akun, dengan Reset ke default dan Urungkan. `[iBCvF, e1r8q, GcXr5, R1aqQ]`
- **FR-D4** State: kosong (stepper 3 langkah: rekening → catat → anggaran), memuat, memperbarui, offline ("Lihat data terakhir"). `[olRpH, CdNBN, IKIBD, I2SEfl]`

### 6.10 Langganan (Section 07)
- **FR-SUB1** Field: layanan (logo/ikon), paket, harga + mata uang, siklus mingguan/bulanan/tahunan, tagihan berikutnya, bayar dari (rekening IDR untuk langganan USD akan "dikonversi saat ditagih" dengan estimasi), kategori, deskripsi, pengingat H-N (default 3), masa uji coba (7/14 hari/1 bulan/kustom; tagihan pertama = mulai + durasi). `[ofF4z, sN6Eh, yuefQ, oEASr]`
- **FR-SUB2** Halaman: KPI Per bulan / Per tahun / Sisa tagihan bulan ini, grafik 6 bulan dengan anotasi, timeline jadwal bulan (Akan ditagih/Sudah dibayar/Belum dikonfirmasi), tabel, tab Aktif/Dijeda/Dibatalkan, Per kategori. `[CZmJm]`
- **FR-SUB3** Aksi: Tandai sudah dibayar, Ganti rekening (berlaku mulai tagihan berikutnya, dengan peringatan saldo kurang), Jeda (1 bulan/2 bulan/tanggal kustom + pengingat sebelum aktif lagi), Batalkan (setelah tagihan berikutnya / sekarang), Aktifkan lagi, Riwayat tagihan, deteksi kenaikan harga. `[WaS25, x5B5f, QO7La, VtfuA, UONDi]`
- **FR-SUB4** Deteksi langganan dari transaksi: merchant dengan ≥ 3 tagihan di tanggal serupa, aktif setelah 2 bulan data. Pilihan: Tambahkan / Bukan langganan / Tambah semua, dengan pratinjau dampak total. `[DIcp7]`
- **FR-SUB5** Review pemakaian bulanan (Sering/Kadang/Jarang). Rating "Jarang" atau fungsi dobel memunculkan kartu "Bisa dihemat". `[u8sjx]`
- **FR-SUB6** Peringatan: pengingat H-1 dengan saran jeda, tagihan lewat yang belum dikonfirmasi ("Ya, catat / Belum ditagih"), saldo rekening pembayar tidak cukup (Top-up / ganti rekening). `[C861Ys, Lu10H, IFaSb]`

### 6.11 Kalender (Section 08)
- **FR-C1** Mode Bulan (heatmap + total mingguan M1–M6 + ringkasan + pola per hari), Minggu (kolom per hari dengan transaksi per jam, batas aman sisa minggu), Tahun (12 mini heatmap, tren, % ditabung). `[zEWoe, qYzQD, Ncucu]`
- **FR-C2** Event terjadwal di sel: tagihan langganan, tagihan rutin, gajian (perkiraan), setoran tabungan/dana tidak rutin, kupon, siklus kartu kredit, cicilan. Event terjadwal tidak memengaruhi saldo.
- **FR-C3** Klik hari menampilkan panel rincian. "Catat di tanggal ini" membuka form dengan tanggal terisi (jam 12.00). Bulan mendatang menampilkan jadwal + proyeksi ("Perkiraan dari pola Okt"). Legenda bisa dipakai untuk filter. `[sYRh0, V0mbHr, q3o9L, z6baj, Z0Mxk]`

### 6.12 Tabungan / tujuan (Section 13)
- **FR-G1** Tujuan: nama, ikon, warna, target (tetap, atau dinamis "3× pengeluaran bulanan" untuk dana darurat), tenggat (bulan-tahun), label `#tag`, setoran rutin (beberapa per tujuan; tanggal, dari → ke; selalu lewat Perlu ditinjau). `[q0jRa]`
- **FR-G2** **Sumber dana campuran**: rekening (nominal tetap ≤ saldo bebas) dan/atau aset investasi (persentase unit atau seluruh aset). Total % per aset lintas tujuan ≤ 100%. Unit baru dari DCA ikut dibagi sesuai %. `[DeE0u, UpO8Q, QCbeZ]`
- **FR-G3** Setor manual / Tarik dana dibuat sebagai Transfer berlabel di Transaksi, dengan pratinjau progres, ketahanan dana darurat (bulan), dan estimasi tercapai. `[PCgK1, vvQtO, nVb1Q]`
- **FR-G4** Tujuan tercapai: hentikan setoran rutin atau lanjutkan sebagai cadangan, lalu Tandai selesai (tab Selesai, Urungkan). **Bayar dari tujuan**: pengeluaran dengan toggle mengubah status tujuan menjadi *Terpakai*; sisanya bisa dipindah ke tujuan lain atau dilepas jadi saldo bebas. `[biM3a, rbvBr, itVPf, m535GI]`
- **FR-G5** Peringatan saat belanja dari rekening yang dialokasikan ("mengurangi Dana Darurat") dan dampak penurunan harga aset terhadap tujuan. Jual aset yang dialokasikan ke ≥ 2 tujuan mengharuskan user memilih tujuan yang berkurang. `[F6SPeB, BGCD8, LcuPZ]`
- **FR-G6** Fallback valuasi: bila harga pasar tidak tersedia, halaman tetap tampil dengan opsi "Lihat saldo rekening saja". `[Dr2U1]`

### 6.13 Utang & cicilan, kartu kredit (Section 18)
- **FR-U1** Jenis: cicilan kartu kredit, paylater, cicilan 0%, KPR/KPM, pinjaman pribadi, dan **piutang**. KPI: Sisa utang, Harus dibayar bulan ini, Jatuh tempo terdekat, Piutang. `[exCE7]`
- **FR-U7** Piutang: tab Piutang di halaman Utang & cicilan dengan daftar aktif (orang, sumber: pisah tagihan atau pinjaman tunai, jatuh tempo + hitung mundur, progres kembali, sisa), riwayat lunas 90 hari, panel "Cara write.financial menghitung". **Catat piutang**: siapa (dengan saran nama), jumlah, dari rekening, tanggal, jatuh tempo (1/2 minggu, akhir bulan, tanpa tenggat), catatan, pengingat H-1 hanya ke user, pratinjau dampak. **Terima pembayaran**: jumlah (chip lunas / sebagian), masuk ke rekening, tanggal, pratinjau. Aturan: memberi pinjaman = transfer ke piutang (bukan pengeluaran), pembayaran diterima = transfer masuk (bukan pemasukan), piutang masuk kekayaan bersih tapi tidak masuk saldo tersedia, "Hapuskan" piutang = pengeluaran kategori "Piutang tak tertagih" setelah konfirmasi. write.financial tidak pernah menghubungi pihak lain; "Salin pengingat" hanya menyalin teks. `[KZZZy, H7g1A, ivnWw]`
- **FR-U2** Transaksi dari rekening kartu kredit ≥ Rp500.000 bisa dipecah jadi cicilan 3/6/12/24 bulan (bunga % per bulan dan biaya admin). Pengeluaran penuh tetap tercatat di tanggal transaksi dan masuk anggaran periode itu, sedangkan cicilan ditahan di limit. `[hNvip, x20Gf]`
- **FR-U3** Cicilan 0% = pokok ÷ tenor, sisa pembulatan ditaruh di cicilan pertama (1.000.000/3 = 333.334 + 333.333 + 333.333).
- **FR-U4** Pembayaran ke kartu (transfer) dialokasikan menurut **prioritas yang bisa diatur**: 1) cicilan (pelunasan dipercepat), 2) belanja non-cicilan, 3) lebih bayar menjadi saldo kredit. Setelah pelunasan sebagian, user memilih "Kurangi nominal (tenor tetap)" atau "Persingkat tenor". `[qrRRV, A7ttc]`
- **FR-U5** Tambah utang menampilkan **simulasi dampak**: rasio cicilan/pemasukan (sehat ≤ 30%), saving rate setelah cicilan, kekayaan bersih. `[v3Igd]`
- **FR-U6** Cicilan non-kartu membuat kejadian terjadwal di Perlu ditinjau dan di Kalender.

### 6.14 Investasi (Section 09)
- **FR-I1** Platform = rekening bertipe investasi, dengan kas (IDR/USD). Aset/holding: ticker, nama, platform, mata uang kuotasi, kelas aset (Saham AS, Internasional, Indonesia, Kripto, Kas & SGOV, Emas, Income), kategori "Daftar saya" (satu aset hanya di satu kategori), unit (presisi tinggi), harga rata-rata.
- **FR-I2** Transaksi investasi: Beli (jumlah atau unit, bayar dari kas platform, biaya, pajak, kurs), Jual (nilai atau %, hasil ke kas atau tarik ke bank, untung terealisasi), Dividen (dibelikan lagi / masih di kas / masuk rekening), Top-up kas, **Sesuaikan kepemilikan** (pembelian belum dicatat / DRIP / koreksi; jika unit kurang → jual atau koreksi). `[KDF13, JejMv, j2SH8r, oExkI]`
- **FR-I3** Valuasi IDR/USD (toggle), KPI (nilai, modal, untung belum terealisasi, hari ini, dividen 12 bulan, yield), grafik pertumbuhan (1B/3B/YTD/1T/Semua; nilai vs modal) dengan benchmark YTD (SPY, IHSG), alokasi vs target per kelas (validasi total 100%), drift, kalkulator rebalancing acuan IDR/USD yang tidak membuat transaksi. `[bgmSP, JBGq7, w1jn3J]`
- **FR-I4** Tabel kepemilikan: cari, kelompokkan (Daftar saya / Kelas aset / Platform), menu aset, panel detail (riwayat beli/DCA, dividen, alokasi ke tujuan). `[CtiSh, zxtp9]`
- **FR-I5** Sinkronkan harga: progres per sumber, gagal sebagian tetap memakai harga terakhir beserta cap waktu dan nama sumbernya, "Buka log API". Label wajib "tertunda/penutupan", tidak pernah "real-time". `[SNpaj, TZxs4, KR0zN]`
- **FR-I6** Sumber harga per kelas aset (detail di `docs/research/market-data.md`):

  | Kelas | Bawaan server (gratis, cache global) | BYOK (key milik user, hasil hanya untuk user itu) | Manual |
  |---|---|---|---|
  | Kurs | Frankfurter (kurs transaksi BI) → fawazahmed0 → open.er-api (atribusi) | — | Kurs per tanggal |
  | Saham/ETF AS + SPY | — | Tiingo (15 menit) → Finnhub → Massive/Alpha Vantage (harian) | Harga per simbol |
  | Saham IDX + IHSG | — | EODHD (penutupan + 3×/hari) → Marketstack | Harga penutupan |
  | Kripto | CoinMarketCap Basic (key operator) | CoinMarketCap / CoinGecko milik user | Harga |
  | Emas | Spot XAU harian (fawazahmed0); Antam = spot × (1 + premium isian user), berlabel estimasi | GoldAPI.io / metals.dev | Harga per gram |
  | Reksa dana | — | — | NAB + tanggal; RDPU opsi estimasi akrual |
  | SBN (ORI) | Dihitung dari nominal + kupon tetap | — | Harga pasar opsional |

  Dilarang: Yahoo Finance unofficial, Stooq, Twelve Data/FMP free, scraping Pasardana/Bareksa/Bibit/Logam Mulia/IDX/BI, Indodax sebagai sumber data, dan memakai hasil BYOK satu user untuk user lain. Tidak ada lisensi data yang akan diajukan (D20): write.financial adalah alat pencatat, bukan penyedia data pasar, jadi harga hanya pendukung valuasi dan selalu bisa diisi manual.

### 6.15 Laporan (Section 10)
- **FR-LP1** Laporan bulanan final per periode: KPI dengan pembanding, ringkasan naratif otomatis, kekayaan bersih (grafik 6 bulan), arus uang (Sankey + tabel sumber), pengeluaran per kategori vs anggaran, merchant, tag, rekening, tujuan, transaksi terbesar, langganan, "Catatan untuk periode berikutnya". `[ogfhy]`
- **FR-LP2** Jenis laporan: Bulanan (snapshot final), Kuartal/Tahunan/Kustom (agregasi dari snapshot bulanan final + periode berjalan, ditandai "sementara") ([Keputusan]).
- **FR-LP3** Ekspor PDF A4/Letter, tema terang/gelap, pilih bagian (dengan nomor halaman), samarkan nomor rekening, pratinjau jumlah halaman. Juga CSV dan Excel. `[yLlRY, TAU0h…ZWRR8]`
- **FR-LP4** Kirim laporan via email setiap awal periode (**opt-in**, PDF ke email terdaftar, nomor rekening disamarkan) dan daftar "Laporan tersimpan".
- **FR-LP5** State: memuat, menghitung ulang, gagal (ekspor dinonaktifkan sementara), kosong (timeline sampai laporan pertama terbit).

### 6.16 Aturan otomatis, Asisten AI, OCR, Gmail (Section 02 Pengaturan, 03, 15)
- **FR-AI1** Aturan otomatis JIKA (deskripsi berisi salah satu, hari, jam, rekening, arah, langganan terdaftar; kondisi digabung dengan AND) MAKA (set kategori, tambah tag). Aturan hanya **mengisi saran** di form/draft yang tetap dikonfirmasi user (Catat Cepat, Asisten, struk, impor, Gmail). Kategori diambil dari aturan teratas yang cocok; tag adalah gabungan dari semua aturan yang cocok. Pratinjau menunjukkan cocok/tidak cocok beserta alasannya. "Terapkan ke transaksi lama" menampilkan daftar perubahan untuk dikonfirmasi. Saran aturan muncul dari ≥ 4 koreksi manual yang sama. `[HXDL7, evJtJ]`
- **FR-AI2** BYOK: provider OpenRouter / ZenMux / OpenAI-compatible (base URL), API key (masked, tombol Tes), model, izin (baca data keuangan, buat draft transaksi, selalu minta konfirmasi), batas biaya bulanan dalam USD dan meter pemakaian, log aktivitas (fitur, model, token, biaya, durasi, status, tool call). `[MXnjE, l1nyC, GpdeI, OJaxo]`
- **FR-AI3** Asisten `⌘J`: menjawab dari data (kartu data + chip sumber + saran aksi), mencatat lewat chat dalam bentuk **draft** dengan dampak lalu konfirmasi (Ubah/Batal/Urungkan), membaca struk multi-item (field ragu ditandai, deteksi duplikat merchant+waktu+jumlah). State: belum terhubung, timeout 30 detik ("tidak ada biaya yang terpakai"), ganti provider. Agen tidak pernah menulis data tanpa konfirmasi. `[xvTmH, I3S0A, wBIPB, QGATc, wpx0t, Q8bxz]`
- **FR-AI4** Gmail: hubungkan lewat OAuth terpisah (`gmail.readonly`, butuh 2FA aktif), filter pengirim (allowlist) + kata kunci + kata kunci abaikan (yang terakhir menang), ekstraksi AI per field dengan keyakinan. **Semua hasil masuk Perlu ditinjau**; setelan "Selalu minta konfirmasi sebelum dicatat" terkunci (Wajib). Lewati bila sudah dicatat manual (nominal ±1%, waktu ±2 jam) dan idempoten per email. Ada uji filter dengan 5 email terakhir (dry run), statistik bulanan (masuk, lolos filter, menunggu, dikonfirmasi, diabaikan), **Log Gmail** (waktu, pengirim·subjek, hasil filter, hasil AI + keyakinan, status Menunggu/Dikonfirmasi/Diabaikan/Duplikat, ekspor CSV, retensi 30 hari), deteksi izin dicabut, dan "Hubungkan lagi". Isi email tidak disimpan, hanya pengirim, subjek, kutipan, dan hasil ekstraksi. `[bCdNA, kHEuC, Axylg, h7iA2I, DS1LC, ukKey]`

### 6.17 Pengaturan (Section 02)
Navigasi: Akun (Profil & akun) · Preferensi (Mata uang & kurs, Periode bulanan, Tampilan, Notifikasi, Kategori, Tag, Aturan otomatis) · Data (Data & cadangan, Keamanan) · Integrasi (AI agent, API kurs & pasar, Gmail) · Lainnya (Pintasan keyboard, Bantuan & tentang). Footer sticky "Simpan perubahan" muncul dengan state dirty.
- **FR-ST1** Mata uang utama (IDR; mengganti mata uang utama setelah ada data = di luar v1), mata uang lain (terdeteksi dari rekening), mode kurs Otomatis (Frankfurter, jenis kurs ditampilkan: "kurs transaksi BI", + "Perbarui sekarang") / Manual (kurs + berlaku sejak + selisih vs acuan).
- **FR-ST2** Tampilan: tema, format angka (lengkap/ringkas untuk tampilan non-tabel), format tanggal, awal minggu, sembunyikan saldo.
- **FR-ST3** Notifikasi: pengingat tagihan (H-3/H-1/Hari H + jam), ambang anggaran (50/80/100%), saldo rendah, ringkasan mingguan (Senin), kanal (in-app selalu; email opsional). Web push ditunda bersama mobile.
- **FR-ST4** API kurs & pasar: daftar sumber per kelas aset dengan mode (Bawaan / BYOK / Manual) dan status (Aktif · jam, Terhubung, Atur key, Estimasi, Kuota habis s.d. …). Baris BYOK: penyedia, API key (masked, hanya 4 karakter terakhir setelah disimpan), frekuensi yang dibatasi agar muat kuota gratis, meter kuota, link "Dapatkan key gratis", **Tes koneksi** dengan hasil per simbol, catatan lisensi ("key pribadi, data hanya untukmu", "tertunda, bukan real-time"). Saat kuota habis: jeda sampai reset dan turun ke sumber berikutnya. Butuh 2FA aktif. Log permintaan (retensi 30 hari, key dimasking). `[JtnsQ, PhHg9, iCbPR]`
- **FR-ST5** Data & cadangan: ekspor seluruh data, impor, cadangan harian otomatis (retensi 30), pulihkan dari cadangan, hapus semua transaksi (rekening, kategori, dan anggaran tetap ada).

### 6.18 Tablet (Section 19)
- **FR-TB1** Breakpoint: desktop ≥ 1280 px (sidebar penuh 248 px), tablet 768–1279 px (sidebar menjadi **rail ikon 64 px** dengan tooltip; logo, cari, notifikasi, menu, asisten, avatar), < 768 px tidak didukung di v1 (layar "Gunakan tablet atau desktop" + tetap bisa Catat). `[F5zMBH, aMmPV]`
- **FR-TB2** Tablet 1024 (landscape): grid satu kolom untuk kartu yang di desktop berdampingan (Pemasukan vs Pengeluaran, Anggaran, Kalender, Langganan), Sankey menampilkan 2 level (sumber → kelompok; ketuk kelompok untuk rincian), Rekening menampilkan maks. 3 kartu + "N lainnya", bar Catat Cepat tanpa field catatan.
- **FR-TB3** Tablet 768 (portrait): aksi sekunder header masuk menu ⋯, ringkasan tanpa grafik harian, tabel Transaksi tanpa kolom Rekening, panel detail menjadi **sheet** dari kanan di atas daftar, chip filter bisa digulir horizontal.
- **FR-TB4** Input sentuh: target sentuh ≥ 40 px di rail dan baris tabel, semua aksi hover juga tersedia lewat tekan-lama atau menu ⋯, pintasan keyboard tetap jalan untuk keyboard eksternal.

### 6.19 Instance, self-host, dan admin (D22)
- **FR-OP1** Wizard setup pertama (hanya muncul saat instance belum punya admin): buat akun admin + 2FA wajib, nama instance, URL publik, zona waktu default, SMTP (opsional, dengan tombol kirim tes), dan pilihan pendaftaran: **tertutup** (default self-host; hanya undangan), **terbuka**, atau **dengan undangan**.
- **FR-OP2** Pengaturan instance (khusus admin, butuh 2FA): Google OAuth client (login dan Gmail, opsional), key operator untuk sumber bawaan (CoinMarketCap Basic, opsional; tanpa key, kripto jatuh ke BYOK/manual), batas upload, retensi log, feature flag (Gmail, Asisten), banner pemeliharaan.
- **FR-OP3** Admin hanya mengelola instance dan akun (undang, nonaktifkan, reset 2FA dengan verifikasi email, hapus). **Admin tidak bisa melihat data keuangan user lain** dari UI, dan data `_enc` tidak bisa dibaca tanpa sesi user (DEK hanya dibuka dalam konteks sesi/job milik user tersebut).
- **FR-OP4** Halaman status instance: versi, migrasi terakhir, status worker/dispatcher, antrean, kuota sumber bawaan, umur cadangan terakhir, dan pemberitahuan versi baru (cek rilis GitHub, bisa dimatikan; tidak mengirim data apa pun selain versi).
- **FR-OP5** Tanpa telemetri secara default di kedua mode. Error tracking hanya aktif bila pengelola instance mengisi DSN sendiri.
- **FR-OP6** Mode cloud saja: halaman paket/langganan hosting, batas sumber daya per akun (penyimpanan lampiran, jumlah request AI lewat key user tidak dibatasi), kebijakan privasi & syarat layanan write.financial, dan alur "Pindah ke self-host" (ekspor penuh + panduan).

## 7. Aturan perhitungan kanonik

Semua modul memakai fungsi yang sama dari paket `domain`. Angka contoh berasal dari seed desain dan menjadi **golden test**.

### 7.1 Format angka
| Konteks | Format | Contoh |
|---|---|---|
| Tabel, buku kas | Tanpa "Rp", rata kanan, Geist Mono tabular | `42.810.000` |
| Angka utama | Dengan Rp | `Rp55.023.000` |
| Kalimat, grafik | Lengkap, titik ribuan, **tanpa jt/rb** | `Rp2.250.000` |
| Arus, selisih | Selalu bertanda; minus pakai U+2212 | `+9.500.000`, `−2.277.000` |
| Persen | Koma desimal | `36,5%`, `87%` |
| Valas | Dengan kurs | `US$690,10` · `Rp16.350 per US$1` |
| Privasi | 6 titik | `Rp••••••` |

Input menerima singkatan ("25rb", "1,5jt").

### 7.2 Rumus
| Besaran | Rumus | Contoh seed |
|---|---|---|
| Saldo rekening | saldo awal + Σ posting terkonfirmasi + Σ penyesuaian | — |
| Saldo tersedia | Σ saldo rekening `include_in_available` (dikonversi ke IDR) | Rp55.023.000 |
| Investasi | Σ unit × harga terakhir × kurs + kas platform | Rp61.420.000 |
| Total aset / kekayaan bersih | tersedia + investasi − sisa utang | Rp116.443.000 |
| Pemasukan / Pengeluaran | Σ transaksi bertipe income / expense dalam periode (transfer dikecualikan) | 26.000.000 / 16.500.000 |
| Ditabung & investasi | pemasukan − pengeluaran | 9.500.000 |
| Saving rate | ditabung ÷ pemasukan | 36,5% |
| Ideal hari ke-N | N ÷ jumlah hari periode | 15/31 = 48% |
| Batas aman harian | (batas − terpakai) ÷ sisa hari periode termasuk hari ini, dibulatkan **ke bawah** ke Rp1.000 ([Keputusan]) | 2.250.000/16 → Rp140.000 |
| Anggaran mingguan | batas bulanan × 7 ÷ hari periode ([Keputusan], menggantikan faktor 4,4) | — |
| Proyeksi akhir periode | Σ anggaran tetap (nilai penuh) + (pengeluaran variabel ÷ hari berjalan × hari periode) + tagihan terjadwal yang belum dibayar ([Keputusan]) | — |
| "Akan lewat anggaran" | terpakai + jumlah yang sedang diketik + tagihan terjadwal kategori itu − batas > 0 | — |
| Prorata periode transisi | batas × hari_transisi ÷ 30 | 18,75 jt × 24/30 = 15 jt |
| Kurs efektif / selisih kurs | dikirim ÷ diterima; (diterima − dikirim/acuan) × acuan | Rp16.474; −Rp22.660 |
| Modal (aset) | metode **biaya rata-rata** dengan kurs saat transaksi ([Keputusan]) | SPY Rp11.400.000 |
| Untung belum terealisasi | nilai − modal | +Rp7.489.000 (+13,9%) |
| Drift portofolio | Σ\|porsi − target\| ÷ 2 | 3,1% |
| Progres tujuan | terkumpul ÷ target; terkumpul = Σ nominal rekening + Σ (% unit × harga × kurs) | 11.125.000/54.000.000 = 21% |
| Setoran per bulan tujuan | (target − terkumpul) ÷ sisa bulan ke tenggat | 18.000.000/8 = 2.250.000 |
| Ketahanan dana darurat | terkumpul ÷ rata-rata pengeluaran 3 bulan | 0,6 bulan |
| Sisa limit kartu | limit − tagihan berjalan − sisa pokok cicilan | 13.000.000 |
| Langganan per tahun | Σ bulanan × 12 + Σ tahunan (+ mingguan × 52) | Rp11.520.000 |

## 8. Model domain (ringkas)

User · Session/Device · Preference · **Account** (bank/ewallet/cash/investment/credit_card) · **Category** · Tag · **Transaction** (header) + **Posting** (baris per rekening; transfer = 2 posting; biaya/selisih kurs = posting expense) · Attachment · Recurrence · **ScheduledOccurrence** (sumber antrean Perlu ditinjau) · Subscription + SubscriptionCharge · **Period** · BudgetVersion + BudgetLine + BudgetTransfer · Goal + GoalFundingSource + GoalContributionPlan · Debt + InstallmentSchedule + DebtAllocation · Receivable · Asset/Holding + InvestmentTrade + PriceQuote + FxRate + PortfolioSnapshot · Report (snapshot JSON) · Notification · AutoRule · AiProviderConfig + AiUsageLog · GmailConnection + EmailIngestLog · ImportBatch · Backup.

Skema rinci ada di rencana implementasi §4.

## 9. Kebutuhan non-fungsional

- **Keamanan & privasi:** lihat §9.1. Ini syarat rilis publik, bukan tambahan.
- **Integritas uang:** semua nilai uang disimpan sebagai `bigint` dalam minor unit mata uangnya (IDR eksponen 0, USD 2). Unit dan harga `numeric(28,10)`, kurs `numeric(20,8)`. Tidak ada `float` di jalur uang. Saldo diturunkan dari posting, bukan disimpan sebagai angka yang dimutasi.
- **Idempotensi:** setiap kejadian terjadwal unik per `(sumber, tanggal_jatuh_tempo)`, setiap email unik per `message_id`, setiap pengiriman form unik per `client_id` (aman di-retry).
- **Kinerja:** Dashboard dan Transaksi (≤ 10.000 transaksi/tahun/user) TTFB < 300 ms p95 di VPS 2 vCPU. Perpindahan periode < 500 ms. Agregat per periode boleh di-cache di Redis dan diinvalidasi saat ada tulis.
- **Ketersediaan:** pengingat terjadwal tetap terkirim walau UI gagal (worker terpisah dari web).
- **Zona waktu:** semua batas hari dan periode memakai zona waktu user (default Asia/Jakarta). Disimpan sebagai `timestamptz` + `date` lokal untuk kunci periode.
- **Aksesibilitas:** WCAG 2.2 AA, navigasi keyboard penuh, `prefers-reduced-motion`.
- **i18n:** v1 hanya Bahasa Indonesia, tapi semua string dikumpulkan di satu katalog.
- **Cadangan:** `pg_dump` harian 03.00 WIB, **terenkripsi** (age, kunci publik di server, kunci privat offline), retensi 30 hari, salinan off-site. Restore diuji setiap rilis. Data akun yang dihapus ikut hilang dari cadangan setelah retensi berakhir.

### 9.1 Keamanan penyimpanan data (aplikasi publik)

Model ancaman yang dijaga: (1) user A membaca/mengubah data user B, (2) database, disk, atau cadangan bocor, (3) log/telemetri membocorkan rahasia atau data keuangan, (4) akun diambil alih, (5) pihak ketiga (LLM, penyedia data) menerima data lebih dari perlu.

| Lapisan | Kebutuhan |
|---|---|
| Isolasi tenant | Setiap tabel milik user punya `user_id`. Akses lewat satu lapisan repository yang mewajibkan `userId` dari sesi (tidak pernah dari input). **Row-Level Security Postgres** aktif di semua tabel milik user sebagai lapisan kedua: koneksi aplikasi memakai role tanpa `BYPASSRLS` dan men-set `app.user_id` per transaksi. Tes otomatis mencoba akses silang untuk setiap server function. ID publik memakai UUID v7, tidak berurutan. |
| Enkripsi saat transit | TLS 1.2+ (Caddy, HSTS preload), koneksi Postgres/Redis hanya di `localhost`/jaringan privat atau dengan TLS. |
| Enkripsi saat disimpan (disk) | Volume data Postgres, Redis, dan object storage (SeaweedFS, D25) di partisi terenkripsi (LUKS). Cadangan terenkripsi (age). |
| Enkripsi tingkat aplikasi (envelope) | Setiap user punya **data key** (DEK, AES-256-GCM) yang dibungkus **master key** (KEK) dari env/file rahasia di luar DB dan luar repo. Dienkripsi dengan DEK: API key BYOK (AI, pasar), token OAuth Gmail, secret TOTP, kode cadangan (di-hash, bukan dienkripsi), catatan transaksi, kutipan email, hasil OCR, nama orang di piutang, dan semua file lampiran/struk. Kolom angka, tanggal, kategori, merchant tetap plaintext agar bisa diagregasi dan dicari; kolom ini dilindungi RLS + enkripsi disk. Rotasi KEK tanpa re-enkripsi data (re-wrap DEK). Hapus akun = hapus DEK (*crypto-shredding*). |
| Rahasia tidak pernah keluar | API key/token tidak pernah dikirim balik ke browser (hanya 4 karakter terakhir), tidak masuk log, error tracking, atau payload job (job hanya membawa ID; worker mendekripsi saat dipakai). Redaksi otomatis pola key/token/nomor kartu di logger. |
| Autentikasi | Argon2id untuk kata sandi, cek kata sandi bocor (k-anonymity HIBP), 2FA TOTP/passkey/kode cadangan, lockout + rate limit per akun dan IP, sesi httpOnly + Secure + SameSite=Lax, rotasi ID sesi setelah login/2FA, sesi kedaluwarsa (30 hari "ingat", 12 jam tanpa), re-auth untuk aksi sensitif, notifikasi masuk dari perangkat baru. |
| Aplikasi web | CSRF token untuk semua mutasi, Content-Security-Policy ketat (tanpa inline script), `X-Frame-Options: DENY`, validasi input Zod di server, upload: cek MIME (magic bytes) + ukuran + re-encode gambar + hapus metadata EXIF/GPS. Gambar & file **selalu lewat server aplikasi** (unggah: enkripsi lalu simpan ke object storage; unduh: ambil, dekripsi, kirim dengan `Content-Disposition` dan `Cache-Control: private, no-store`). Object storage tidak pernah terekspos ke internet dan tidak memakai URL presigned publik, karena isinya ciphertext per user. |
| Pihak ketiga | LLM hanya menerima data minimum untuk tugasnya (bukan seluruh buku kas). Prompt/respons tidak disimpan di server, hanya metadata. Penyedia harga hanya menerima simbol, tidak pernah identitas user. |
| Audit | Log keamanan tak-terubah (append-only) untuk login, 2FA, key, Gmail, ekspor, hapus akun; terlihat oleh user (FR-A10). |
| Kepatuhan | UU PDP No. 27/2022: kebijakan privasi, dasar pemrosesan (persetujuan untuk Gmail/AI), hak akses/ekspor/hapus, pemberitahuan insiden. Gmail restricted scope: verifikasi Google + penilaian keamanan pihak ketiga sebelum Gmail dibuka untuk umum. |
| Operasional | Dependensi dipindai (CI), patch OS otomatis, firewall (hanya 80/443/SSH kunci), SSH tanpa kata sandi, akses admin ke DB produksi tercatat, tidak ada data produksi di lingkungan dev. Uji penetrasi sebelum rilis cloud publik (M9). |
| Open source | Repo publik tidak boleh berisi rahasia (pemindaian rahasia di CI + pre-commit). `SECURITY.md` dengan alamat `security@write.financial` dan kebijakan pengungkapan bertanggung jawab. Rilis bertanda tangan; image Docker dengan digest + SBOM. Default aman untuk self-host: pendaftaran tertutup, 2FA admin wajib, KEK dibuat otomatis saat setup dan pengguna diminta mencadangkannya. |

## 10. Design system

- **Token:** 133 variabel dark/light dari `dompetku.pen` (permukaan `bg/card/muted/surface-2..5/dialog/popover/input`, teks `fg/text-strong/text-secondary/muted-fg/subtle/text-faint/text-disabled`, aksen `blue/green/red/amber/violet/cyan/yellow/orange/rose` beserta varian `-fg`, `-fg-soft`, `-tint-1..5`, heat, scrim, shadow, ring, warna brand). Token diekspor otomatis ke CSS variables + tema Tailwind.
- **Tipografi:** Geist (UI) dan Geist Mono (angka). Skala dominan 10–15 px (11,5/12/12,5/13/13,5), judul 17/20/24. Padat, mirip aplikasi pro.
- **Bentuk:** radius 2–12 (dominan 3/4/6/8), gap 2–20, kanvas desktop 1440 px, tablet 1024 & 768 px (Section 19).
- **Ikon:** lucide (239 ikon terpakai). Logo: 26 logo bank/e-wallet/aset di `images/logos/`.
- **Brand (Section 20 `bnGdw`):** nama produk **write.financial**, selalu huruf kecil dengan titik, termasuk di awal kalimat. Logo mark = mata pena yang celahnya naik menjadi garis grafik. Komponen `Logo Mark / 12 (putih)`, `/15`, `/16`, `/18`, `/24` menggantikan ikon dompet lama di sidebar, rail tablet, login, onboarding, dan header PDF. Di dalam tile: tile `$fg` + mark `$primary-fg` (otomatis terbalik di mode terang). Wordmark Geist 600, "write" `$fg` + ".financial" `$muted-fg`. App icon 180/64/32/16 px; favicon dan apple-touch-icon diekspor dari komponen ini.
- **Komponen inti:** Wallet Card (default, valas, gabungan), Dialog/Sheet (header, footer), Popover pilih kategori/tanggal/periode/rekening/rentang khusus, Toast, Tooltip, Menu Item, Alert Dialog, Dialog Ekspor, Sidebar, **Rail ikon (tablet)**, Page Header, Quick Add, KPI Strip, Sankey Card, Small multiples, Calendar heatmap, input kode 6 digit.

## 11. Integrasi eksternal & risiko produk

| Integrasi | Kebutuhan | Risiko | Mitigasi |
|---|---|---|---|
| Google OAuth (login) | Profil, email | Rendah | — |
| Gmail API `gmail.readonly` + Pub/Sub push | Membaca email transaksi (semua lewat Perlu ditinjau) | Scope **restricted**: produksi publik butuh verifikasi Google + penilaian keamanan pihak ketiga. Status "Testing" dibatasi 100 test user dan refresh token kedaluwarsa 7 hari | Rilis publik v1 **tanpa Gmail** (feature flag) sampai verifikasi selesai di M9; polling `history.list` sebagai fallback push |
| Kurs (Frankfurter, fawazahmed0, open.er-api) | Harian | Free tier bisa berubah; rate limit per IP | Cache global 1–2 call/hari, fallback berurutan, kurs manual, tampilkan jenis kurs + waktu |
| Saham AS/IDX (BYOK: Tiingo, Finnhub, EODHD, …) | 15 menit (AS), penutupan + 3×/hari (IDX) | Lisensi gratis = pribadi; kuota kecil | Hanya BYOK per user, tidak pernah dibagikan; interval dibatasi kuota; manual sebagai cadangan |
| Kripto (CoinMarketCap Basic, key operator) | 5 menit | 15.000 kredit/bulan, batas ≤100k user | Satu call untuk semua simbol unik, cache global; pantau `credit_count`; fallback cache + manual |
| Emas, NAB reksa dana, SBN | Harian | Tidak ada API gratis legal untuk Antam/NAB | Spot XAU + premium user (estimasi), NAB manual, ORI dihitung dari kupon |
| LLM BYOK (OpenRouter/ZenMux/compatible) | Chat, OCR vision, ekstraksi | Biaya user, latency | Batas biaya bulanan, timeout 30 detik, tanpa biaya saat gagal |
| Email keluar (SMTP/Resend) | Reset, pengingat, laporan | Deliverability | SPF/DKIM, domain sendiri |

## 12. Keputusan default & pertanyaan untuk pemilik produk

Keputusan berikut saya ambil supaya pengerjaan bisa jalan. Semuanya bisa diubah sebelum milestone terkait.

| # | Topik | Keputusan | Alasan | Status |
|---|---|---|---|---|
| D1 | Model transfer | Ledger: 1 transaksi + N posting | Transfer, biaya, selisih kurs, pisah, kartu kredit konsisten; saldo = Σ posting | Default |
| D2 | Perangkat | **Desktop + tablet** (rail ikon di 768–1279 px). Ponsel ditunda | Keputusan pemilik produk 17 Okt | **Diputuskan** |
| D3 | API key BYOK | Disimpan terenkripsi **di server** dengan DEK per user | Worker butuh key; copy desain "di perangkat" sudah diganti di Section 19 | Default |
| D4 | Parsing impor | CSV/XLSX di-parse di browser, hanya baris hasil yang dikirim. PDF e-statement = P2 | Privasi; PDF butuh parser per bank | Default |
| D5 | Ekspor | CSV di klien; Excel/PDF/ZIP di worker | PDF dan kirim email butuh server | Default |
| D6 | Modal investasi | Biaya rata-rata, kurs historis per transaksi | Desain hanya menampilkan "harga rata-rata" | Default |
| D7 | Batas aman harian | Dibulatkan ke bawah ke Rp1.000 | Konservatif; desain tidak konsisten | Default |
| D8 | Proyeksi akhir periode | Tetap + laju variabel + tagihan terjadwal (§7.2) | Angka desain 24,2 jt tidak bisa direproduksi | Default |
| D9 | Dana tidak rutin | Satu entitas dengan Tujuan (`kind = sinking`) | Muncul di Anggaran **dan** Tabungan | Default |
| D10 | Kuartal/Tahunan | Agregasi snapshot bulanan + periode berjalan "sementara" | Hanya bulanan yang punya label "Final" | Default |
| D11 | PIN kunci aplikasi | Per perangkat, disimpan di klien (hash di IndexedDB) | Desain: "di perangkat ini" | Default |
| D12 | Bunga KPR/pinjaman | Anuitas efektif; paylater/kartu flat | Desain tidak mendefinisikan | Default |
| D13 | Kanal notifikasi | In-app + email; web push ditunda bersama mobile | Push hanya berguna di ponsel | Default |
| D14 | Otomatisasi | **Semua yang dibuat sistem wajib dikonfirmasi** (Gmail ≥ 90% tidak lagi dicatat otomatis; tutup buku hanya mengusulkan) | Keputusan pemilik produk 17 Okt | **Diputuskan** |
| D15 | Data pasar | Sumber bawaan gratis untuk kurs, kripto, spot emas; BYOK untuk saham AS/IDX; manual untuk NAB/Antam | Tanpa budget; lisensi free tier saham hanya pribadi | **Diputuskan** |
| D16 | Rilis publik | Wajib: RLS + enkripsi envelope + 2FA untuk aksi sensitif + cadangan terenkripsi + audit keamanan; Gmail menunggu verifikasi Google | Dibuka untuk umum | **Diputuskan** |
| D17 | Subscriber | Subscriber = pelanggan **hosting terkelola** (mode cloud). Tidak ada fitur premium di kode: tabel `plans`/`user_plans` hanya dipakai mode cloud untuk kuota sumber daya dan penagihan; di self-host semua fitur aktif. Billing menyusul setelah M9 | Open source; yang dijual adalah layanan hosting | **Diputuskan** |
| D18 | Domain & email | Domain **write.financial**: aplikasi di `app.write.financial` (atau root), email transaksional dari `no-reply@write.financial`, kontak `halo@write.financial`, keamanan `security@write.financial`, privasi `privasi@write.financial`. SPF, DKIM, DMARC (`p=quarantine`) wajib sebelum M3 (email pengingat). Domain yang sama dipakai di OAuth consent screen Google dan URL kebijakan privasi/syarat layanan | Jawaban pemilik produk 17 Okt | **Diputuskan** |
| D19 | Penanggung jawab data | **Self-host:** pengelola instance masing-masing (write.financial hanya penyedia perangkat lunak, tidak menerima data). **Cloud:** write.financial dikelola oleh [nama pemilik] sebagai pengendali data; sebelum cloud dibuka untuk umum (M9) dibuat PT Perorangan + NIB dan didaftarkan PSE Lingkup Privat [perlu konfirmasi konsultan]. Kebijakan privasi cloud memakai identitas ini | Model open source + hosting | **Diputuskan** |
| D20 | Lisensi data pasar | **Tidak mengajukan** izin Indodax maupun lisensi Pasardana. Fokus produk: mencatat keuangan dan aset. Kripto memakai CoinMarketCap Basic (bawaan) atau BYOK; emas spot memakai sumber bawaan + premium manual; NAB reksa dana dan harga Antam **diisi manual** (dengan estimasi akrual RDPU opsional) | Jawaban pemilik produk 17 Okt | **Diputuskan** |
| D21 | Lisensi kode | **AGPL-3.0-only** (teks resmi di `LICENSE`). Siapa pun boleh memakai, memodifikasi, dan meng-host; bila menawarkan versi modifikasi sebagai layanan, kode modifikasinya wajib dibuka. Kontribusi memakai **DCO** (`Signed-off-by` di setiap commit, dicek CI). Hak cipta pemilik proyek tetap memungkinkan instance cloud resmi. Logo & nama "write.financial" tidak termasuk lisensi kode (`TRADEMARK.md`). Logo bank/e-wallet di `images/logos/` adalah merek pihak ketiga: hanya dipakai sebagai penanda rekening, dengan catatan merek di README. Setiap file sumber diberi header `SPDX-License-Identifier: AGPL-3.0-only` | Model open source + jual hosting; melindungi dari layanan tertutup berbasis kode ini | **Diputuskan** |
| D22 | Mode deployment | `DEPLOYMENT_MODE=selfhost` (default) atau `cloud`. Perbedaan hanya di konfigurasi: pendaftaran, halaman paket, kebijakan privasi, kuota sumber daya. Satu image Docker untuk keduanya | Satu codebase, tanpa fork | **Diputuskan** |
| D23 | Sumber data per instance | Sumber bawaan dijalankan oleh setiap instance dengan key milik pengelola instance (CMC Basic opsional). Cloud memakai key operator write.financial. BYOK & manual sama di kedua mode | Lisensi gratis berlaku per produk/pemilik key | **Diputuskan** |
| D24 | Gmail | **Self-host:** pengelola membuat Google Cloud project sendiri dan memasang client ID di FR-OP2; untuk pemakaian pribadi/keluarga app dipublikasikan tanpa verifikasi (layar "aplikasi belum diverifikasi", maks. 100 user) agar refresh token tidak kedaluwarsa tiap 7 hari seperti status Testing [perlu diuji saat M7]. **Cloud:** Gmail tetap dimatikan sampai verifikasi + penilaian keamanan selesai | Membuat Gmail bisa dipakai lebih awal lewat self-host | **Diputuskan** |
| D25 | Penyimpanan gambar & file | **SeaweedFS** (Apache-2.0, `weed server -s3`) sebagai object storage S3-compatible untuk struk, lampiran, foto profil, logo rekening/langganan unggahan, PDF/Excel laporan, dan ekspor. Aplikasi hanya bicara API S3 standar (`@aws-sdk/client-s3`), jadi pengelola instance bisa menggantinya dengan S3 lain (Garage, RustFS, AWS S3, Cloudflare R2, Backblaze B2) lewat `.env`. Bucket: `wf-attachments`, `wf-avatars`, `wf-reports`, `wf-exports`; kunci objek `u/{userId}/{uuid}` tanpa nama file asli. MinIO **tidak dipakai**: repo komunitasnya di-archive (Apr 2026) dan image resminya sudah ditarik dari Docker Hub, jadi tidak ada patch keamanan | Permintaan pemilik produk (object storage) + status MinIO | **Diputuskan** |

Semua pertanyaan terbuka sudah dijawab.

## 13. Inkonsistensi desain yang perlu diperbaiki desainer

| Lokasi | Masalah |
|---|---|
| Wallet Card `ALH0W` | BCA "−Rp11.200.000 bulan ini" vs sumber data +1.200.000 |
| Anggaran `E86u2e` vs Atur `F0xibH` | Total 18.750.000 vs 18.950.000; Kebutuhan 12,0 vs 12,2 jt |
| Anggaran | Proyeksi Rp24.200.000 tidak dapat diturunkan |
| Popover kategori | "akan lewat Rp566.000"; hitungan 560.900 |
| Catat `XOoye` | "lewat Rp789.000"; hitungan 790.000 |
| Pisah tagihan `IGHyP` | 1.857.500 tampil 1.860.000 |
| Langganan | Total bulanan 904.900 / 905.000 / 859.900 / 845.900 (laporan Sep); "6 aktif" vs tab "Aktif 7"; Hiburan 37% vs 34% |
| Kalender Minggu | Rata-rata 448.000 (hitungan 412.500); "−26%" (hitungan −31,5%) |
| Kekayaan bersih | +4.220.000 vs 4.243.000; 116.440.000 vs 116.443.000 |
| Tabungan `vvQtO` | "0,5 bulan" setelah setor +1 jt (seharusnya ≈ 0,67) |
| Investasi | "11 posisi" vs ±22 ticker; "14 aset" vs "15 aset" |
| Format | "Rp18,75jt" di judul kartu melanggar panduan larangan jt/rb |
| Mode privasi | Nominal masih bocor di Anggaran, Tabungan, Langganan, sumbu grafik Investasi |
| Copy | ~~"write.financial tidak pernah meminta login bank / Semua dicatat manual" vs Gmail~~ — diperbarui: layar Gmail kini "baca email transaksi", hasil wajib dikonfirmasi. Masih perlu: "data tetap di perangkatmu" (Investasi, BYOK) → "dienkripsi di server" |
| Gmail (Section 02/04) | ~~"Catat tanpa konfirmasi jika yakin ≥ 90%"~~ dan "Tercatat otomatis" — **sudah diubah** di desain (toggle terkunci "Wajib", status "Dikonfirmasi olehmu") |
| API kurs & pasar `W6ThPJ` | Memakai BI JISDOR + Yahoo Finance (dilarang) — **diganti** oleh Section 19 `JtnsQ`/`PhHg9`; layar lama ditandai "[Usang]" |
| Onboarding | Tidak ada langkah setup PIN; tidak ada varian non-Google |
| Rekening `oed7u` | Jenius arsip memakai •• 4821 (sama dengan BCA) |

## 14. Layar tambahan v1.1 (Section 19 di `dompetku.pen`)

| Row | Layar | Node | FR |
|---|---|---|---|
| Notifikasi | Halaman semua notifikasi | `dzA5V` | FR-S5 |
| Gmail | Gmail terhubung (wajib konfirmasi), Log Gmail | `Axylg`, `h7iA2I` | FR-AI4 |
| Periode | Popover rentang khusus | `WLyvf` | FR-S7 |
| Piutang | Daftar piutang, Catat piutang, Terima pembayaran sebagian | `KZZZy`, `H7g1A`, `ivnWw` | FR-U7 |
| Keamanan | Keamanan (2FA belum aktif), Atur autentikator, Masuk dengan 2FA | `kKAEZ`, `NKmY8`, `ZAD9u` | FR-A8–A10 |
| Tablet | Ringkasan 1024, Transaksi 768 | `F5zMBH`, `aMmPV` | FR-TB1–TB4 |
| API kurs & pasar | Sumber bawaan + BYOK + manual, Atur key IDX + tes koneksi | `JtnsQ`, `PhHg9` | FR-ST4, FR-I6 |
| Brand (Section 20) | Logo mark, lockup gelap/terang, app icon, aturan pemakaian, komponen logo | `bnGdw` | §10 |
