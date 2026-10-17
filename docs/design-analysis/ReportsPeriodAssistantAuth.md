# Analisis: Laporan, Periode Bulanan, Notifikasi/Pencarian/Asisten, Masuk & Onboarding, Mobile

Sumber: `/tmp/digest/10-laporan.md`, `14-periode-bulanan.md`, `15-notifikasi-pencarian-asisten.md`, `16-masuk-onboarding.md`, `17-mobile.md`. Semua angka dikutip dari desain (user contoh: Avtara K., "hari ini" = Kam, 15 Okt 2026).

---

## A. Laporan (Section 10 [onBoC])

### 1. Ringkasan & tujuan user
User melihat laporan keuangan per periode yang sudah ditutup ("Laporan September 2026 · Final · 1–30 Sep · dibandingkan dengan Agustus 2026 · 121 transaksi"), lengkap dengan KPI, narasi otomatis, grafik, dan tabel per kategori, rekening, tag, tujuan, transaksi terbesar, dan langganan. Laporan bisa diekspor ke PDF, CSV, atau Excel, dan dikirim otomatis via email. Tujuannya: evaluasi bulanan ("Catatan untuk Oktober") dan arsip, misalnya "Rekap SPT Tahunan 2025".

### 2. Daftar layar & state
| Layar | Node id | Isi/tujuan | State |
|---|---|---|---|
| write.financial — Laporan | ogfhy (1440x3671) | Laporan bulanan lengkap, 7 bagian | default |
| Laporan — Ekspor PDF | yLlRY | Dialog "Ekspor laporan": format, periode, bagian, tampilan, kertas, samarkan, pratinjau | dialog |
| PDF Hal. 1 — Ringkasan | TAU0h (794x1123, A4) | KPI, kekayaan bersih, isi laporan, tabungan | output PDF |
| PDF Hal. 2 — Arus uang | t3PQGb | Sankey masuk → ke mana, tabel sumber, pengeluaran harian | output PDF |
| PDF Hal. 3 — Pengeluaran | STgHg | Kategori Sep vs Agu + anggaran, merchant, tag, rekening | output PDF |
| PDF Hal. 4 — Transaksi & langganan | ZWRR8 | Transaksi terbesar, langganan, "Catatan untuk Oktober", disclaimer | output PDF |
| Laporan — Skeleton (memuat) | r6w3vW | "Menyusun laporan…" | memuat |
| Laporan — Memperbarui data (ganti periode) | yISo5 | "Menghitung ulang…" | memuat parsial |
| Laporan — Gagal menyusun | fOodO | "Laporan September gagal disusun", "Ekspor PDF dinonaktifkan sementara", "Coba lagi · Hubungi bantuan", kode "500 · POST /reports/2026-09" | error |
| Laporan — Kosong (pengguna baru) | gyfhQ | Timeline "15 Okt Mulai mencatat → 31 Okt Periode pertama ditutup → 1 Nov Laporan Oktober terbit"; CTA "Catat transaksi", "Atur tanggal mulai" | kosong |
| Laporan — September tetap 1–30 Sep | IvIWD (Section 14) | Banner "Laporan lama tidak berubah" | info |

### 3. Alur user
- **Halaman**: buka Laporan → pilih jenis "Bulanan · Kuartal · Tahunan · Kustom" → pembanding "vs Agustus" → navigasi tab "Arus uang · Pengeluaran · Pemasukan · Rekening & tag" ("Halaman 1 dari 1 · 7 bagian").
- **Ekspor PDF → opsi ekspor → hasil PDF (A4, 4 halaman)**: klik "Ekspor PDF" → pilih Format (CSV "semua aplikasi" / Excel "sheet per bulan" / PDF "siap dicetak") → Periode ("September 2026 · final", Agustus, Q3 2026, Tahun ini, Kustom…; "Laporan final tersedia s.d. Sep 2026") → Bagian ("5 dari 6": Ringkasan & kekayaan bersih hal. 1, Arus uang & pemasukan hal. 2, [Pengeluaran] hal. 3, Transaksi terbesar & langganan hal. 4, "Daftar 121 transaksi lengkap +5 hal." yang tidak dicentang) → Tampilan Terang ("hemat tinta")/Gelap → Kertas A4/Letter → "Samarkan nomor rekening" ("•• 4821 tetap disamarkan, nominal tetap terlihat") → pratinjau "4 halaman · A4" → unduh.
- **Memuat → skeleton → memperbarui data**: muat pertama memakai skeleton; saat ganti periode, data lama tetap tampil dengan indikator "Menghitung ulang…"; kalau gagal, tampil layar error dengan Coba lagi.
- **Kosong — pengguna baru**: ditampilkan timeline sampai laporan pertama terbit; user diarahkan untuk mencatat transaksi atau mengatur tanggal mulai periode.

### 4. Entitas data & field
- **Report** (snapshot per periode): `period_id`, `type` enum(bulanan, kuartal, tahunan, kustom), `range_start/end` (date), `status` enum(final, berjalan?) ["Final"], `compare_to_period_id`, `tx_count` int (121), `generated_at` timestamp ("Dibuat 15 Okt 2026, 19.45"), `summary_text` (narasi "dibuat otomatis dari transaksimu"), serta KPI (bigint minor): income 25.800.000, expense 18.300.000, net 7.500.000, savings_rate (decimal 29,1%), net_worth 112.200.000 "per 30 Sep".
- **ReportExport / SavedReport** ("Laporan tersimpan · Diunduh atau dikirim otomatis"): `name` ("Laporan Agustus 2026", "Q2 2026 Apr–Jun", "Rekap SPT Tahunan 2025"), `format` enum(PDF, XLSX, CSV), `size_bytes` (1,2 MB / 86 KB / 2,4 MB), `file_url`, opsi: `sections[]`, `theme` enum(terang, gelap), `paper` enum(A4, Letter), `mask_account_numbers` bool.
- **ReportAutoSend**: "Kirim otomatis tiap tanggal 1 · PDF ke email terdaftar" → `enabled` bool, `day` (1), `format` (PDF), `to` = email user.
- Data turunan yang dibaca: Transaction (tanggal, deskripsi, kategori, merchant, rekening, tag, jumlah), Category (+ kelompok Kebutuhan/Keinginan/Tabungan, batas anggaran), Account (BCA Tahapan "debit & transfer", Bank Jago "kartu virtual", GoPay "QRIS & ojek", Tunai), IncomeSource (Gaji "PT Kinarya", Freelance "3 klien · 4 invoice", "Studio Arunika 62%", Penjualan & lainnya, Dividen & bunga "6 aset · bersih setelah pajak"), SavingsGoal (31 Agu, setoran Sep, harga, 30 Sep, progres), Subscription, NetWorthSnapshot bulanan (Apr–Sep: 85,2 · 91,0 · 95,5 · 98,1 · 105,5 · 112,2 juta), FX rate ("kurs Rp16.350/USD"), harga investasi per 30 Sep.
- **Catatan untuk periode berikutnya** (hal. 4): daftar teks, misalnya "Belanja Online lewat Rp600.000 — batas Oktober tetap Rp2.000.000…". [INFERENCE] dihasilkan otomatis dari aturan/AI, atau ditulis user.

### 5. Aturan bisnis & perhitungan
- Arus kas bersih = pemasukan − pengeluaran: 25.800.000 − 18.300.000 = **+7.500.000**. Agustus: 24.900.000 − 16.900.000 = 8.000.000; perubahan −6,3%.
- Saving rate = ditabung / pemasukan: 7.500.000 / 25.800.000 = **29,1%** (Agu 32,1%, ditulis "−3,0 poin", jadi selisih dalam poin persentase, bukan persen relatif).
- % perubahan = (sekarang − lalu)/lalu: pemasukan (25,8−24,9)/24,9 = +3,6%; pengeluaran (18,3−16,9)/16,9 = +8,3%.
- Kekayaan bersih = investasi 57.700.000 + kas & tabungan 54.500.000 = 112.200.000. "+32% sejak Apr" = 112,2/85,2 − 1.
- Arus uang memakai pembagian pemasukan: Kebutuhan 11.200.000 (43%), Keinginan 7.100.000 (28%), Tabungan 7.500.000 (29%) dari total 25.800.000. Persentase kategori juga dihitung terhadap pemasukan (Sewa Kos 4.500.000 = 17%).
- Kolom ANGGARAN: terpakai/batas, misalnya Belanja Online 2.600.000/2.000.000 = 130% ("lewat Rp600.000"); "9 dari 10 anggaran terpenuhi".
- Rata-rata harian = pengeluaran / jumlah hari: 18.300.000/30 = **Rp610.000** (Agu Rp545.000). "Minggu terboros 7–13 Sep Rp5.200.000"; "Akhir pekan … 41% dari pengeluaran variabel" (variabel = tanpa biaya TETAP seperti sewa).
- Transaksi terbesar: porsi = jumlah / total pengeluaran (Sewa 4.500.000/18.300.000 = 24,6%); "6 transaksi = 40% dari pengeluaran".
- Langganan: total bulanan 329.000 + 199.000 + 186.000 + 86.900 + 45.000 = **Rp845.900**; setara per tahun ×12 = Rp10.150.000 (dibulatkan); "4,6% dari pengeluaran".
- Tujuan: progres = saldo/target (Dana Darurat 7.625.000/54.000.000 = 14,1%); nilai akhir = awal + setoran + perubahan harga (9.504.000 + 1.800.000 + 210.000 = 11.514.000).
- "Disisihkan dana tidak rutin*" Rp1.150.000 "tidak dihitung di saving rate".
- Transfer antar rekening tidak dihitung sebagai pemasukan/pengeluaran.
- Laporan bulan yang sudah final bersifat **immutable** ("Laporan lama tidak berubah") walaupun pengaturan periode berubah.
- Laporan terbit setelah periode penuh tertutup ("Laporan dibuat setelah satu periode penuh tercatat", periode Okt ditutup 31 Okt, laporan terbit 1 Nov).
- Nilai investasi dalam laporan memakai harga dan kurs pada tanggal akhir periode ("harga 30 Sep 2026 dan kurs Rp16.350/USD").

### 6. Job latar/scheduler & integrasi
- **Tutup buku periode / generate report snapshot** pada hari pertama periode baru (1 Nov untuk Oktober). Endpoint yang terlihat: `POST /reports/2026-09`.
- **Kirim otomatis tiap tanggal 1**: render PDF lalu kirim ke email terdaftar.
- **Render PDF/XLSX/CSV** di worker (ukuran besar, 4+5 halaman).
- Snapshot harga investasi dan kurs di akhir periode (bergantung pada job sinkron harga/kurs).
- Narasi "Ringkasan September · dibuat otomatis" [INFERENCE] dibuat oleh aturan deterministik atau AI saat tutup buku.

### 7. Komponen UI
Sidebar app + search "Cari… ⌘K", segmented control (Bulanan/Kuartal/Tahunan/Kustom), dropdown pembanding, tombol "Ekspor PDF", tabs, KPI card dengan delta dan nilai pembanding ("Agu Rp24.900.000"), badge "Final", line/area chart kekayaan bersih, Sankey arus uang, bar chart harian (sorot akhir pekan, anotasi "sewa", "9.9"), tabel kategori dengan progress anggaran + "Unduh CSV", daftar ranking merchant, bar persentase rekening, chip tag `#akhir-pekan`, tabel tujuan, list langganan dengan avatar huruf, list file tersimpan, toggle kirim otomatis, dialog ekspor (radio card, checklist bagian dengan nomor halaman, toggle samarkan, pratinjau), skeleton, error state dengan kode, empty state berbentuk timeline.

### 8. Pertanyaan terbuka
- Kuartal/Tahunan/Kustom: apakah juga berupa snapshot final, atau dihitung on-the-fly? Ada "Q3 2026" di ekspor, tetapi hanya laporan bulanan yang punya label "Final".
- Isi tab "Pemasukan" dan bagian Rekening & tag di PDF: dialog menulis "5 dari 6" bagian, tetapi hanya 4 halaman yang terlihat. Bagian yang tidak tercantum adalah daftar 121 transaksi.
- Format Excel "sheet per bulan" untuk rentang multi-bulan: struktur kolomnya tidak ada di desain.
- "Catatan untuk Oktober": dibuat AI, aturan, atau user?
- Status laporan untuk periode berjalan (Oktober): bisa dilihat sebagai draf atau tidak? Desain hanya menunjukkan "Laporan final tersedia s.d. Sep 2026".
- Error 500 ditampilkan ke user ("POST /reports/2026-09"): apakah memang dimaksudkan begitu?

---

## B. Periode bulanan & tutup buku (Section 14 [Db5FC])

### 1. Ringkasan & tujuan user
User memilih tanggal mulai periode bulanan (1–28, default tgl 1, idealnya mengikuti gajian), sehingga anggaran, saving rate, laporan, kalender, dan tabungan dihitung per "bulan gajian". Saat mengubah tanggal mulai, user memilih apakah perubahan berlaku mulai periode berikutnya (dengan periode transisi yang diprorata) atau periode berjalan dihitung ulang. Laporan yang sudah final tidak pernah berubah.

### 2. Daftar layar & state
| Layar | Node id | Isi/tujuan | State |
|---|---|---|---|
| Pengaturan — Periode bulanan | kNL3D | Pengaturan periode, default tgl 1 | default |
| … — pilih tanggal | WpMpY | Picker "Mulai tiap tanggal" / "Ikuti gajian"; "Tanggal 29–31 tidak tersedia…" | dropdown terbuka |
| … — ubah ke tanggal 25 | hvzfS | Peringatan "Gaji PT Kinarya biasanya masuk tgl 1, bukan tgl 25 · Tidak sejalan gajian"; pratinjau periode; radio "TERAPKAN PERUBAHAN"; "Ada perubahan belum disimpan" | edit dirty + warning |
| Periode bulanan — konfirmasi hitung ulang | d2ztG3 | Dialog "Hitung ulang periode Oktober?" | dialog konfirmasi |
| Dashboard — pilih periode | DLnov | Dropdown periode: Des 2026 (25 Nov–24 Des, 30 hari, "Mulai tgl 25"), Nov transisi (1–24 Nov, 24 hari), Okt Berjalan, Sep, Agu, "Atau pilih rentang kustom…" | dropdown |
| Anggaran — Oktober + info transisi | Gb4iH | Banner prorata November | info |
| Tabungan — Oktober + rencana transisi | w61TJ | Rencana setoran Nov Rp3.500.000 (bukan Rp4.650.000) | info |
| Laporan — September tetap | IvIWD | "Laporan lama tidak berubah" | info |
| Kalender — November (transisi) | ufSoF | "Periode transisi 1–24 Nov · periode Desember mulai 25 Nov (garis biru)", "Bulan belum dimulai · yang tampil adalah jadwal & proyeksi" | masa depan/proyeksi |

### 3. Alur user
**Pengaturan → default tgl 1 → pilih tanggal → ubah ke tgl 25 → konfirmasi hitung ulang**
1. Buka Pengaturan → Periode bulanan (default tgl 1).
2. Pilih mode "Mulai tiap tanggal" (1–28) atau "Ikuti gajian".
3. Pilih 25. Sistem memberi peringatan bila tanggal tidak sejalan dengan pemasukan gaji yang terdeteksi, lalu menampilkan pratinjau: "25 Sep – 24 Okt disebut “Oktober”" (periode diberi nama sesuai bulan tempat periode berakhir).
4. Pilih cara menerapkan perubahan:
   - **Mulai periode berikutnya**: "Oktober tetap 1–31 Okt, lalu transisi 1–24 Nov: batas anggaran Rp18.750.000 → Rp15.000.000 (24/30 hari)", kemudian Desember 25 Nov – 24 Des.
   - **Hitung ulang periode berjalan**: "Oktober jadi 25 Sep – 24 Okt. Transaksi 25–30 Sep ikut pindah". Muncul dialog konfirmasi: "Anggaran & saving rate Oktober dihitung ulang · Laporan September yang sudah final tidak berubah · Setoran rutin & tagihan tetap di tanggalnya" → tombol "Hitung ulang".

**Diterapkan di semua halaman** (skenario "Mulai periode berikutnya"): Dashboard menampilkan "periode tgl 25 mulai Des." dan daftar periode; Anggaran menampilkan banner transisi; Tabungan menyesuaikan rencana setoran; Laporan September tidak berubah; Kalender November menandai periode transisi dan awal periode Desember.

### 4. Entitas data & field
- **UserSettings.period**: `start_day` int 1–28, `mode` enum(fixed_day, follow_payday) ["Ikuti gajian"], `effective_from_period` (date), `apply_mode` enum(next_period, recalc_current).
- **Period** (materialisasi): `id`, `user_id`, `label` ("Oktober 2026", dinamai sesuai bulan akhir), `start_date`, `end_date`, `days` int (24/30/31), `kind` enum(normal, transisi), `status` enum(berjalan, final, akan datang), `closed_at`. [INFERENCE] tabel `periods` diperlukan supaya riwayat periode lama (1–30 Sep) tetap stabil setelah pengaturan berubah.
- **PeriodSettingChange** (audit) [INFERENCE]: `old_day`, `new_day`, `apply_mode`, `created_at`.
- Relasi: Budget (batas per kategori per periode, terkena prorata), RecurringDeposit/SavingsPlan (tgl 1 & 14, tgl 25), Report (per Period, immutable), IncomeSource gaji (untuk mendeteksi tanggal gajian "PT Kinarya … tgl 1").

### 5. Aturan bisnis & perhitungan
- Tanggal mulai dibatasi 1–28: "Tanggal 29–31 tidak tersedia supaya periode selalu ada di setiap bulan" (juga "maks. tanggal 28" di empty state Laporan).
- Penamaan periode: periode 25 Sep – 24 Okt disebut "Oktober".
- Prorata periode transisi: batas = batas normal × hari_transisi / 30. Contoh 18.750.000 × 24/30 = **15.000.000**. Pembaginya 30, bukan jumlah hari kalender.
- Rencana tabungan transisi: setoran yang tanggalnya jatuh di luar periode transisi pindah ke periode berikutnya. "Sisihkan dana tidak rutin tiap tgl 25 jatuh di awal periode Desember, jadi rencana November Rp3.500.000 (Dana Darurat tgl 1 & 14) — bukan Rp4.650.000".
- Recalc periode berjalan: transaksi dipindah antar periode berdasarkan tanggal (Tokopedia Rp449.000 27 Sep masuk Oktober); anggaran dan saving rate dihitung ulang; periode final tidak diubah; jadwal setoran rutin dan tagihan tetap pada tanggal kalendernya.
- Anggaran hari ke-N (Gb4iH): "Hari ke-15 dari 31"; ideal = 15/31 = **48%**; terpakai 16.500.000/18.750.000 = **88%**; sisa 2.250.000; "Batas aman harian Rp140.000 · sisa ÷ 16 hari" (2.250.000/16 = 140.625, dibulatkan ke bawah ke ribuan). "Proyeksi akhir bulan Rp24.200.000 · lewat Rp5.400.000" (rumusnya tidak eksplisit, lihat pertanyaan terbuka).
- "16 hari lagi menuju gajian berikutnya" = sisa hari periode.
- Deteksi gajian: tanggal pemasukan gaji yang berulang dibandingkan dengan tanggal mulai yang dipilih, untuk menampilkan peringatan.

### 6. Job latar/scheduler & integrasi
- **Tutup buku periode** saat `end_date` lewat (zona waktu user, Asia/Jakarta): tandai Period final, buat periode berikutnya (normal/transisi), salin anggaran (ada tombol "Salin dari September", jadi [INFERENCE] salinan bisa manual atau otomatis), prorata untuk periode transisi, lalu enqueue pembuatan laporan.
- **Job hitung ulang** setelah konfirmasi "Hitung ulang": reassign periode transaksi, hitung ulang agregat anggaran dan saving rate. [INFERENCE] dijalankan sebagai job async ("Menghitung ulang…").
- Proyeksi kalender untuk bulan mendatang (tagihan terjadwal, "Gajian 1 Nov · diperkirakan Rp18.500.000").

### 7. Komponen UI
Settings row dengan picker tanggal (grid 1–28), segmented "Mulai tiap tanggal / Ikuti gajian", warning callout, timeline pratinjau periode (tetap → Transisi → normal), radio card "TERAPKAN PERUBAHAN", sticky bar "Ada perubahan belum disimpan", dialog konfirmasi dengan checklist dampak, period switcher dropdown dengan badge (Berjalan/Transisi/Mulai tgl 25) dan "rentang kustom", info banner di halaman Anggaran/Tabungan/Laporan, penanda garis biru di kalender.

### 8. Pertanyaan terbuka
- Mode "Ikuti gajian": tanggal diambil dari transaksi gaji yang terdeteksi secara otomatis? Bagaimana jika gaji jatuh di akhir pekan atau tanggal > 28?
- Prorata selalu dibagi 30, atau dibagi jumlah hari periode normal?
- Arah transisi ketika tanggal dimundurkan (misalnya dari 25 ke 1): apakah periode transisinya lebih panjang dari sebulan?
- Rumus "Proyeksi akhir bulan Rp24.200.000": run-rate linear 16,5 jt/15×31 ≈ 34,1 jt tidak cocok. Kemungkinan biaya tetap + run-rate variabel [INFERENCE].
- Laporan Kuartal/Tahunan setelah start day berubah: batasnya mengikuti periode atau kalender?

---

## C. Notifikasi (Section 15 [ZEmNI])

### 1. Ringkasan & tujuan user
Panel notifikasi (lonceng) berisi peringatan anggaran, saldo rendah, tagihan langganan, konfirmasi setoran, kuota API, dan ringkasan mingguan. Item dikelompokkan per hari dan punya tombol aksi. User bisa menandai semua sebagai dibaca.

### 2. Daftar layar & state
| Layar | Node id | Isi/tujuan | State |
|---|---|---|---|
| Notifikasi — terbuka | JdcJD | Popover "Notifikasi · 4 baru · Tandai dibaca", tab "Anggaran & tagihan · Sistem" | default/unread |
| Notifikasi — semua sudah dibaca | h5aPn2 | "Semua sudah dibaca · Pengingat berikutnya: Netflix ditagih 18 Okt (Rp186.000), dikirim H-1 jam 09.00." | kosong |
| Mobile — Notifikasi | JRmIg | Versi layar penuh mobile | mobile |

### 3. Alur user
Klik lonceng → daftar (HARI INI 15 OKT / KEMARIN 14 OKT / SENIN 12 OKT) → aksi per item ("Lihat anggaran", "Isi saldo", "Buka Tabungan") → "Tandai dibaca" → empty state yang menampilkan pengingat berikutnya → "Lihat semua notifikasi".

### 4. Entitas data & field
**Notification**: `id`, `user_id`, `type` enum(budget_exceeded, budget_threshold, low_balance, bill_due, goal_deposit_recorded, api_quota, weekly_summary), `category` enum(anggaran_tagihan, sistem), `title`, `body`, `created_at` (14.12, 09.00, 07.00), `read_at` nullable, `action` {label, route}, `ref_entity` (budget/account/subscription/goal). Contoh payload: "Rp2.400.000 dari Rp2.000.000 (120%) · Erafone Rp2.150.000 & Shopee Rp250.000"; "OVO Rp86.000 dan GoPay Rp412.000 di bawah batas Rp500.000"; "CoinGecko 80% kuota · 8.012 dari 10.000 permintaan bulan ini"; "Setoran … Rp3.000.000 ke Bibit RDPU · pembelian diproses, NAB 16 Okt".
**NotificationPreference** [INFERENCE]: ambang (90%, 100%, batas saldo rendah Rp500.000 per rekening), waktu kirim ("H-1 jam 09.00").

### 5. Aturan bisnis & perhitungan
- Budget threshold: notifikasi saat ≥ ~90% ("Makan & Dapur 91%") dan > 100% ("lewat batas", 120%). Teks sisa per hari: 300.000/16 hari.
- Saldo rendah: saldo < batas rekening (Rp500.000), digabung jadi satu item untuk beberapa rekening.
- Pengingat tagihan langganan: H-1 jam 09.00 (empty state); item list menulis "3 hari lagi", jadi [INFERENCE] ada pengingat H-3 juga.
- Kuota API eksternal: notifikasi pada 80% (8.012/10.000).
- Ringkasan mingguan dikirim Senin untuk minggu Sen–Min sebelumnya (5–11 Okt: Rp8.490.000, terbesar Erafone Rp2.150.000).
- Badge "4 baru" = jumlah item dengan `read_at` null.

### 6. Job latar/scheduler & integrasi
Evaluator anggaran (dipicu saat transaksi disimpan + cron 09.00), cek saldo rendah (07.00), pengingat tagihan (09.00 H-1/H-3), job ringkasan mingguan (Senin), pemantau kuota CoinGecko (integrasi harga kripto), status pembelian reksa dana (NAB). Kanal: in-app; [INFERENCE] push/email belum terlihat.

### 7. Komponen UI
Popover notifikasi, tab filter, group header per tanggal, notification item (ikon, judul, waktu, isi, tombol aksi), link "Tandai dibaca", empty state dengan info pengingat berikutnya, badge unread.

### 8. Pertanyaan terbuka
- Halaman "Lihat semua notifikasi" belum didesain.
- Pengaturan preferensi notifikasi (ambang, jam, kanal email/push) tidak ada di section ini.
- Apakah notifikasi push mobile/web didukung?

---

## D. Pencarian global ⌘K (Section 15)

### 1. Ringkasan & tujuan user
Command palette untuk mencari transaksi, halaman, langganan, kalender, dan perintah. Saat palette kosong, ditampilkan aksi cepat dan item yang baru dibuka. Bila tidak ada hasil, user diarahkan ke Asisten dengan Tab atau ke aksi pembuatan entitas. Pencarian tetap berfungsi tanpa AI.

### 2. Daftar layar & state
| Layar | Node id | Isi | State |
|---|---|---|---|
| ⌘K — terbuka | Z6JVby | "Cari transaksi, halaman, atau perintah…"; AKSI CEPAT; BARU DIBUKA; HALAMAN dengan shortcut "G R", "G T" | default |
| ⌘K — hasil "netflix" | hLRXP | Grup LANGGANAN, TRANSAKSI (2), KALENDER, TANYA ASISTEN | hasil |
| ⌘K — tanpa hasil | nK8wJ | "Tidak ada hasil untuk “cicilan motor”" + saran COBA | kosong |

### 3. Alur user
⌘K → ketik query → navigasi ↑↓, Enter untuk buka, Esc untuk tutup → hasil dikelompokkan per tipe → Tab mengirim query ke Asisten ("“Berapa total Netflix tahun ini?” · Dijawab dari transaksimu · claude-sonnet-5.5"). Jika tidak ada hasil: "Tanya Asisten: “cicilan motor”", "Tambah “Cicilan motor” di Utang & cicilan", "Buat tujuan tabungan “Motor baru”".

### 4. Entitas data & field
Index pencarian yang mencakup: Transaction (merchant/deskripsi, tanggal, kategori, rekening, jumlah), Subscription ("Premium 4K · tiap tgl 18 · BCA Tahapan"), CalendarEvent/Bill ("Tagihan Netflix · Min, 18 Okt · 3 hari lagi"), SavingsGoal (progres "Rp11.125.000 dari Rp54.000.000 · 21%"), Investment ("SPY · Gotrade · DP Rumah 60% · Pensiun 40% · Rp13.500.000"), Page, Command. **RecentItem**: `user_id`, `entity_type`, `entity_id`, `opened_at`.

### 5. Aturan bisnis
- Hasil dikelompokkan per tipe beserta jumlahnya (TRANSAKSI 2).
- Query yang tidak cocok diteruskan sebagai prompt ke Asisten. Saran "Asisten bisa mencari dari catatan & tag transaksi" menunjukkan pencarian ⌘K [INFERENCE] tidak menelusuri catatan/tag secara full-text, atau memang tidak menemukan apa pun di sana.
- Aksi cepat: Catat transaksi, Catat transfer, Setor ke tujuan tabungan.

### 6. Job latar/scheduler
Tidak ada. [INFERENCE] Bisa memakai Postgres full-text/trigram secara langsung.

### 7. Komponen UI
Command palette modal, input dengan hint Esc, grouped result list, shortcut chips (G R, ⌘K, Tab), footer hint "↑↓ pilih · ↵ buka · Tab untuk tanya Asisten", item hasil dengan meta dan jumlah, progress kecil untuk tujuan.

### 8. Pertanyaan terbuka
Daftar lengkap shortcut "G x" untuk halaman lain; field apa saja yang diindeks; apakah ⌘K dapat menjalankan perintah langsung (misalnya "Catat transfer" membuka form).

---

## E. Tanya Asisten ⌘J (AI, BYOK) (Section 15)

### 1. Ringkasan & tujuan user
Panel chat AI yang memakai API key milik user (BYOK: OpenRouter, ZenMux, atau endpoint OpenAI-compatible). Asisten bisa menjawab pertanyaan berdasarkan data transaksi/anggaran, mencatat transaksi lewat chat, dan membaca struk (gambar/PDF). Asisten "selalu minta konfirmasi sebelum menyimpan transaksi". Biaya dan token per pesan ditampilkan, bersama pemakaian bulanan terhadap batas ("$1,24 dari $5 bulan ini").

### 2. Daftar layar & state
| Layar | Node id | Isi | State |
|---|---|---|---|
| Asisten — tanya sisa anggaran | xvTmH | Jawaban + kartu anggaran "Makan & Dapur", chip sumber, saran aksi | default/jawaban |
| Asisten — catat lewat chat | I3S0A | "Draft transaksi · belum disimpan" + dampak; Ubah/Batal | menunggu konfirmasi |
| Asisten — struk duplikat | wBIPB | "Sepertinya transaksi ini sudah ada"; "Lampirkan ke transaksi itu / Tetap catat baru" | duplikat |
| Asisten — belum terhubung (BYOK) | QGATc | "Belum ada penyedia AI · Hubungkan AI agent dulu"; "Buka Pengaturan → AI agent" | belum dikonfigurasi |
| Asisten — gagal terhubung | wpx0t | "OpenRouter tidak merespons · Timeout 30 detik · tidak ada biaya yang terpakai"; "Coba lagi · Ganti ke ZenMux" | error |
| Baca struk — seret file | FqH1q | "Lepas untuk membaca struk · JPG, PNG, PDF · maks. 10 MB" | drag-over |
| Baca struk — sedang membaca | mD6sJ | "Membaca struk… mengenali 4 item · perkiraan $0,009" | memuat |
| Baca struk — draft dari struk | Q8bxz | Item per baris, satu harga ditandai kurang jelas, kategori disarankan, rekening "dari “Debit BCA”" | draft |
| Baca struk — tersimpan | nTDON | "Tersimpan … struk terlampir · Buka di Transaksi"; toast "Urungkan"; "dicatat oleh Asisten, dikonfirmasi olehmu" | sukses |
| Baca struk — gagal dibaca | D1VXq | "buram & terpotong · Total dan tanggal tidak terbaca"; "Unggah ulang · Isi manual" | error |
| Mobile — Asisten | SNuu2 | Versi mobile | mobile |

### 3. Alur user
- **Tanya**: ⌘J → "Berapa sisa anggaran Makan bulan ini?" → jawaban teks + kartu data + chip konteks ("Anggaran Oktober · Transaksi 1–15 Okt") + saran ("Bandingkan dengan Sep", "Pasang pengingat").
- **Catat lewat chat**: "Catat makan siang tadi 45.000 pakai GoPay" → kartu draft (kategori, rekening, waktu "Kam, 15 Okt · 12.10", dampak) → konfirmasi / Ubah / Batal.
- **Struk**: seret atau unggah file → membaca → (a) duplikat terdeteksi: lampirkan ke transaksi yang ada atau tetap catat baru; (b) draft multi-item dengan field yang ragu ditandai → user mengoreksi ("Plester luka dikoreksi: Rp12.500 ✓") → Simpan → toast dengan Urungkan; (c) gagal dibaca → unggah ulang atau isi manual.
- **Belum terhubung** → arahkan ke Pengaturan → AI agent. **Gagal** → coba lagi atau ganti provider; pertanyaan tetap tersimpan.

### 4. Entitas data & field
- **AiProviderConfig**: `provider` enum(openrouter, zenmux, openai_compatible), `base_url`, `api_key` (terenkripsi; desain menulis "disimpan terenkripsi di perangkat"), `model` ("claude-sonnet-5.5"), `monthly_budget_usd` ($5), `fallback_provider`.
- **AiConversation / AiMessage**: `role`, `content`, `created_at` (16.38), `status` enum(sent, pending_confirmation, failed), `tokens_in`/`tokens_out` (2,1k → 180), `cost_usd` (decimal, $0,008), `model`, `attachments[]`, `context_refs[]` (chip sumber), `tool_calls`.
- **AiUsage** (bulanan): `spent_usd` 1,24 / `limit_usd` 5.
- **TransactionDraft** (dari agent): `merchant`, `amount` bigint, `category_id` (+ "disarankan"), `account_id` (dipetakan dari teks struk "Debit BCA"), `occurred_at`, `note`, `line_items[]` {name, qty, price, `low_confidence` bool}, `attachment_id`, `source` = assistant. Transaction menyimpan `created_by` = assistant dan `confirmed_by` = user ("dicatat oleh Asisten, dikonfirmasi olehmu").
- **Attachment/Receipt**: `filename`, `mime` (JPG/PNG/PDF), `size` (≤10 MB; 2,1 MB), `ocr_status` enum(uploaded, reading, parsed, unreadable), `parsed_total`, `parsed_date`, `items_count`, `transaction_id`.
- **Reminder** (dari "Pasang pengingat"): kategori, ambang 100%.

### 5. Aturan bisnis & perhitungan
- Agent tidak pernah menulis data tanpa konfirmasi user. Penyimpanan dilakukan lewat draft, lalu disimpan, dan bisa di-undo.
- Pratinjau dampak sebelum menyimpan: Makan & Dapur (3.200.000 + 45.000)/3.500.000 = 92,7% → **93%**; GoPay 412.000 − 45.000 = **367.000** "(di bawah batas Rp500.000)". Struk: Kesehatan 96.500/500.000 = **19%**; pengeluaran Okt 16.500.000 + 96.500 ≈ **16.600.000**.
- Jawaban anggaran: sisa 300.000 / 16 hari ≈ **Rp19.000/hari**; ideal hari ke-15 = 3.500.000 × 15/31 = **Rp1.690.000**; "18× · rata² Rp178.000" (3.200.000/18).
- Deteksi duplikat: merchant + waktu + jumlah sama (Indomaret 15 Okt 07.55 Rp110.000) sudah tercatat, jadi tidak dicatat ulang.
- Validasi struk: wajib ada total dan tanggal. Jumlah item harus konsisten dengan total (harga yang kurang jelas ditandai).
- Kontrol biaya: estimasi biaya ditampilkan sebelum dan sesudah request; batas bulanan $5; tidak ada biaya saat timeout; timeout 30 detik.
- Pencarian ⌘K tetap berfungsi tanpa AI.

### 6. Job latar/scheduler & integrasi
LLM via OpenRouter/ZenMux/OpenAI-compatible (vision untuk struk). Upload file ke storage. Proses baca struk bisa sinkron dengan streaming atau [INFERENCE] dijalankan sebagai job BullMQ. Agregasi usage dan biaya bulanan; reset tiap bulan. Pengingat yang dipasang dari chat ditangani oleh evaluator notifikasi.

### 7. Komponen UI
Side panel chat (header model, provider, meter biaya), bubble user/assistant dengan timestamp, kartu data anggaran (progress + garis ideal), chip konteks, chip saran aksi, kartu draft transaksi (field dapat diedit, dampak, Simpan/Ubah/Batal), kartu struk (thumbnail, item, flag ragu), kartu duplikat, dropzone overlay, progress membaca, error card, empty state konfigurasi, meta token/biaya, input "Tanya atau minta catat transaksi…" + lampiran, toast dengan Urungkan.

### 8. Pertanyaan terbuka
- "Key disimpan terenkripsi di perangkat" bertentangan dengan arsitektur server (worker/VPS). Apakah key disimpan di browser (dan request LLM dari client), atau disimpan terenkripsi di server?
- Daftar tool agent yang lengkap: baca, catat transaksi, pasang pengingat, bandingkan. Apakah agent bisa mengubah anggaran atau tujuan?
- Ketika batas $5 tercapai: blokir atau peringatan?
- Riwayat percakapan: disimpan per sesi atau permanen?

---

## F. Masuk & Onboarding (Section 16 [k5aeOF])

### 1. Ringkasan & tujuan user
Autentikasi memakai Google OAuth atau email + kata sandi, dilengkapi "Ingat perangkat ini selama 30 hari", lupa kata sandi lewat tautan email, dan kunci aplikasi dengan PIN setelah 5 menit tidak aktif. Onboarding 5 langkah mengatur profil dan mata uang, periode dan pemasukan, saldo awal rekening, dan tujuan tabungan pertama. Pesan utama: "Dicatat manual, tanpa login ke bank. Data dienkripsi dan hanya milikmu."

### 2. Daftar layar & state
| Layar | Node id | Isi | State |
|---|---|---|---|
| Masuk | GNOjT | Google, email, kata sandi, ingat 30 hari | default |
| Masuk — kata sandi salah | D0gWC | "Kata sandi salah · sisa 3 percobaan sebelum dikunci 15 menit" | error |
| Daftar | zPHkt | Nama, Email, Kata sandi "Min. 10 karakter · kuat", persetujuan Syarat & Privasi | default |
| Lupa kata sandi — email terkirim | L4tjTX | "Tautan berlaku 30 menit", "Kirim ulang dalam 0:42" | sukses/cooldown |
| Aplikasi terkunci (PIN) | z6Ce7 | Keypad, "Terkunci otomatis setelah 5 menit tidak aktif", "Lupa PIN? Masuk dengan kata sandi" | terkunci |
| Masuk — Google: pilih akun | j8qhCU | Account chooser; "Akses Gmail tidak termasuk — itu diminta terpisah di Pengaturan." | OAuth |
| Masuk — email terdaftar via Google | uoHuu | "Akun ini dibuat dengan Google … belum punya kata sandi"; "Kirim tautan atur kata sandi" | info |
| Onboarding 1 — profil & mata uang | CsGVt | Nama, nama sapaan, mata uang utama, mata uang tambahan, kurs, bahasa, zona waktu | langkah 1/5 |
| Onboarding 2 — periode & pemasukan | N1A49s | Tanggal gaji (1/25/28/Pilih 1–28), pemasukan rata-rata | 2/5 |
| Onboarding 3 — rekening | VE8Zf | Rekening + saldo hari ini | 3/5 |
| Onboarding 4 — tujuan pertama | RRyTG | Preset tujuan, target, simpan di, setoran rutin; Lewati | 4/5 |
| Onboarding 5 — selesai | S53M66 | Ringkasan setup + opsi Asisten AI & kata sandi | 5/5 |

### 3. Alur user
- **Masuk → kata sandi salah → daftar → lupa kata sandi → terkunci (PIN)**: login email (salah → hitung percobaan → kunci 15 menit) / Daftar / Lupa → email reset → cooldown kirim ulang. PIN lock setelah idle 5 menit; fallback ke kata sandi.
- **Google → pilih akun → email Google tanpa kata sandi**: OAuth (nama, email, foto; tanpa Gmail) → bila user mencoba login dengan email milik akun Google yang belum punya kata sandi, tampilkan opsi Google atau "Kirim tautan atur kata sandi".
- **Onboarding**: 1 Profil (diisi otomatis dari Google; "Email terverifikasi otomatis") → 2 Periode ("Dipakai sebagai awal periode bulanan · Okt 2026 = 1–31 Okt"; pemasukan 25.800.000) → 3 Rekening (BCA Tahapan 42.810.000, Bank Jago 8.125.000, GoPay 412.000; "+ Mandiri · + OVO · + Tunai · + Lainnya…") → 4 Tujuan (Dana Darurat target 54.000.000 di Bank Jago, setoran Rp500.000 tiap tgl 1 dari BCA Tahapan; bisa Lewati) → 5 Selesai → "Ke Ringkasan" ("catat transaksi pertama — tekan N di mana saja").

### 4. Entitas data & field
- **User**: `name` ("Avtara K."), `nickname` ("Avtara", dipakai di sapaan "Selamat sore, Avtara"), `email`, `email_verified_at`, `avatar_url`, `password_hash` nullable, `plan` ("Paket Pribadi"), `base_currency` (IDR), `locale` (id), `timezone` (Asia/Jakarta, dari perangkat), `onboarding_step`/`completed_at`.
- **OAuthAccount**: `provider` (google), `provider_user_id`, scope (profil; Gmail terpisah).
- **Session/TrustedDevice**: `remember_until` (+30 hari), `device`.
- **LoginAttempt/Lockout**: `failed_count`, `locked_until` (+15 menit).
- **PasswordResetToken**: `expires_at` (+30 menit), throttle kirim ulang.
- **AppLock**: `pin_hash`, `idle_timeout` (5 menit). [INFERENCE] Panjang PIN tidak terlihat (keypad 0–9).
- **UserCurrency**: `code` (USD, SGD), **FxSettings**: `mode` enum(otomatis, manual), `source` (Bank Indonesia JISDOR), **FxRate**: `pair`, `rate` (1 USD = Rp16.350, 1 SGD = Rp12.640), `as_of` ("hari ini 09.00").
- **Settings.period**: `start_day` dari langkah 2; `avg_monthly_income` bigint (untuk saran anggaran, privat).
- **Account**: `name`, `type` enum(bank, e-wallet, tunai, lainnya), `purpose`/catatan ("dipakai sehari-hari", "untuk dana darurat"), `currency`, `opening_balance` bigint, `opening_date` (hari ini).
- **SavingsGoal**: `name`, `preset` enum(dana_darurat, liburan, dp_rumah), `target` bigint, `account_id` (Simpan di), **RecurringDeposit**: `amount` 500.000, `day` 1, `from_account_id`, status butuh review ("Perlu ditinjau tiap bulan dan tercatat setelah kamu konfirmasi").

### 5. Aturan bisnis & perhitungan
- Kata sandi minimal 10 karakter, dengan indikator kekuatan.
- Setelah beberapa kali gagal ("sisa 3 percobaan"), akun dikunci 15 menit. [INFERENCE] Batasnya 5 percobaan total.
- Link reset berlaku 30 menit; ada cooldown kirim ulang (0:42 tersisa, [INFERENCE] 60 detik).
- Akun Google tanpa kata sandi: email dianggap sudah terverifikasi, sehingga bisa langsung dikirim link untuk mengatur kata sandi.
- Saldo tersedia = jumlah saldo rekening: 42.810.000 + 8.125.000 + 412.000 = **Rp51.347.000**. Transaksi lama tidak perlu dimasukkan.
- Target dana darurat = 3 × pengeluaran bulanan ≈ Rp54.000.000 (pengeluaran ≈ Rp18 jt/bulan; [INFERENCE] berasal dari batas anggaran atau dari pemasukan yang diisi).
- Tanggal mulai periode dibatasi 1–28.
- Semua total, anggaran, dan laporan dihitung dalam mata uang utama; valas dikonversi dengan kurs.
- Setoran rutin tidak diposting otomatis: perlu ditinjau dan dikonfirmasi.

### 6. Job latar/scheduler & integrasi
Google OAuth; pengiriman email (reset, verifikasi); sinkron kurs otomatis harian (JISDOR BI, "09.00"); pengingat/review setoran rutin pada tanggalnya; pembersihan token/lockout kedaluwarsa.

### 7. Komponen UI
Layout auth split (panel brand dengan kartu metrik contoh + form), tombol Google, divider "atau", input dengan error inline, checkbox ingat perangkat, password strength meter, success card dengan countdown, PIN keypad, stepper 5 langkah, chip pilihan tanggal, input uang "Rp", daftar rekening yang bisa diedit + chip tambah cepat, kartu preset tujuan, ringkasan checklist di langkah Selesai, tombol Lanjut/Kembali/Lewati.

### 8. Pertanyaan terbuka
- Apakah ada verifikasi email untuk pendaftaran via email (bukan Google)?
- Kapan PIN diatur? Tidak ada langkah setup PIN di onboarding. Apakah PIN opsional?
- Onboarding untuk user non-Google (langkah 1 tanpa data dari Google) belum didesain.
- Row label lama "1 preferensi → 2 rekening → 3 tujuan → 4 selesai" tidak konsisten dengan 5 langkah yang sebenarnya; anggap 5 langkah sebagai versi final.
- "Data dienkripsi": enkripsi at-rest saja atau end-to-end?

---

## G. Versi Mobile (Section 17 [HtRXc])

### 1. Ringkasan & tujuan user
Versi mobile (390x844) dengan tab bar 4 item "Ringkasan · Transaksi · Tabungan · Lainnya" dan form catat transaksi bergaya keypad. Halaman lain diakses lewat menu "Lainnya". Tersedia state notifikasi, skeleton, offline, serta tema terang dan gelap.

### 2. Daftar layar & state
| Layar | Node id | Isi | State |
|---|---|---|---|
| Mobile Tab Bar | XI2Pw | Ringkasan · Transaksi · Tabungan · Lainnya | komponen |
| Mobile — Ringkasan | dwg18 | KPI, Rekening & dompet, Anggaran (3 teratas), Transaksi terbaru | default (gelap) |
| Mobile — Ringkasan (terang) | R2bkF | Sama, tema terang | tema |
| Mobile — Transaksi | ULYTm | Cari "merchant, catatan, #tag", filter Keluar/Masuk/Transfer, total, grup per hari | default |
| Mobile — Catat transaksi | K2Blg | Tipe, nominal, dampak, chip kategori, rekening, waktu, keypad dengan "000", "Simpan pengeluaran" | form |
| Mobile — Tabungan | GFTyB | Total terkumpul, kartu tujuan | default |
| Mobile — Asisten | SNuu2 | Chat ringkas, "$1,24/$5" | default |
| Mobile — Lainnya | b17pqN | Profil, menu KEUANGAN (Anggaran sisa Rp2.250.000, Langganan 7, Kalender, Investasi Rp61.400.000, Laporan, Utang & cicilan Rp0), ALAT (Tanya Asisten, Sembunyikan saldo), AKUN (Pengaturan, Keluar) | menu |
| Mobile — Notifikasi | JRmIg | Daftar notifikasi layar penuh | default |
| Mobile — Ringkasan skeleton | EheUc | Skeleton | memuat |
| Mobile — Offline | ugGfr | "Kamu offline · Data terakhir 15 Okt 16.40 · catatan baru disimpan di perangkat" | offline |

### 3. Alur user
Ringkasan → Transaksi → Catat (FAB/tombol tengah [INFERENCE]) → Tabungan → Asisten → Ringkasan (terang); Lainnya membuka halaman sekunder. Saat offline, user tetap bisa mencatat; data disimpan lokal lalu disinkronkan ketika kembali online.

### 4. Entitas data & field
Sama dengan web. Tambahan: preferensi `hide_balances` bool ("Sembunyikan saldo"), `theme` enum(gelap, terang); **OfflineQueue** [INFERENCE] (draft transaksi lokal + `last_synced_at` "15 Okt 16.40").

### 5. Aturan bisnis
- Pratinjau dampak saat mencatat: "Makan & Dapur jadi 93% · GoPay sisa Rp367.000" (rumus sama dengan Asisten).
- Total header Transaksi: +Rp26.000.000 / −Rp16.500.000 untuk periode 1–15 Okt. Subtotal per hari ("Kamis, 15 Okt · −Rp180.000").
- Transfer ditampilkan netral ("Ke Bibit RDPU · Transfer · #dana-darurat · Rp3.000.000").
- Lainnya menampilkan meta "periode mulai tgl 1".

### 6. Job latar/scheduler & integrasi
Sinkronisasi antrian offline (client → server, dedup idempotency key [INFERENCE]); [INFERENCE] PWA service worker. Push notification belum terlihat.

### 7. Komponen UI
Bottom tab bar, KPI grid 2×2, kartu rekening, progress anggaran ringkas, list transaksi dikelompokkan per hari, segmented filter, search bar, keypad numerik, chip kategori, bottom sheet/form catat, kartu tujuan dengan progress, menu list berkelompok dengan nilai di kanan, banner offline, skeleton, varian tema terang/gelap.

### 8. Pertanyaan terbuka
- Aplikasi native atau PWA/web responsif? Desain tidak menyebutkan.
- Cara membuka Catat dan Asisten di mobile: tab bar hanya punya 4 item (FAB?).
- Cakupan offline: hanya mencatat transaksi, atau termasuk edit? Bagaimana konflik ditangani?
- Halaman Anggaran, Kalender, Investasi, Laporan versi mobile tidak didesain (hanya link di Lainnya).
- Cara memicu ⌘K/pencarian global di mobile.
