# Analisis Section 02 — Dashboard, Catat Cepat & Pengaturan (termasuk Gmail)

Sumber: `/tmp/digest/02-dashboard.md` (Section n1V9y). Semua angka dikutip dari desain. Tebakan ditandai [INFERENCE].

---

## A. Dashboard (Ringkasan) — periode Bulan / Minggu / Tahun

### 1. Ringkasan & tujuan user
Halaman beranda ("Ringkasan") menampilkan kondisi keuangan untuk satu periode: KPI (Pemasukan, Pengeluaran, Ditabung & Investasi, Saving Rate), saldo rekening, Arus Uang (Sankey), pengeluaran per kategori, tren 6 bulan, anggaran, kalender pengeluaran, dan langganan. User bisa mengganti periode (Minggu/Bulan/Tahun), menata ulang kartu, dan mencatat transaksi langsung dari bar Catat Cepat.

### 2. Daftar layar & state
| Layar | Node id | Isi/tujuan | State |
|---|---|---|---|
| write.financial — Dashboard (Bulan) | iUqiN | Periode "1–15 Oktober 2026", semua kartu | default |
| Dashboard — Minggu | tBbvD | "12–18 Oktober 2026", anggaran mingguan, kalender per hari, komposisi minggu | default (periode minggu) |
| Dashboard — Tahun | g9BK2 | "Januari–Oktober 2026", grafik per bulan Jan–Des, kalender 2026 per bulan, insight tahunan | default (periode tahun) |
| Dashboard — Pilih Periode | FCcZd | popover grid bulan 2026 + total pengeluaran (juta) per bulan; shortcut Bulan ini/Bulan lalu/Rentang khusus… | popover |
| Dashboard — Menu Pengguna (terbuka) | zm4dg | email, "Pribadi", Pengaturan ⌘, , Keluar | dropdown |
| Dashboard — Konfirmasi keluar | LpVa1 | dialog keluar + opsi "Keluar dari semua perangkat" | dialog |
| Dashboard — Menu Pengguna (mode terang) | GiHqy | sama, tema terang | dropdown (light) |
| Arus Uang — Filter Kebutuhan/Keinginan/Tabungan | UOdxM / ue2v6 / E8xo3g | Sankey difilter satu kelompok | filter aktif |
| Arus Uang — Menu ⋯ | q1pusQ | Buka di Laporan, Unduh PNG, Salin gambar ⌘C, Tampilkan nilai Rupiah/Persen, Tampilkan sumber <1%, Hitung transfer antar rekening | menu |
| Arus Uang — Hover aliran | fqzal | tooltip "Kebutuhan → Makan & Dapur" | hover |
| Pemasukan vs Pengeluaran — Hover Sep | SGcTm | tooltip bulan | hover |
| Kalender — Navigasi ke September | jXuuE | kalender bulan lain + ringkasan | navigasi |
| Dashboard — Kosong (pengguna baru) | olRpH | onboarding 3 langkah | kosong |
| Dashboard — Memuat | CdNBN | "Memuat ringkasan 1–15 Oktober 2026…" | memuat (skeleton) |
| Dashboard — Memperbarui data (ganti periode) | IKIBD | "Memperbarui ringkasan…" di atas data lama | memuat parsial |
| Dashboard — Gagal memuat (offline) | I2SEfl | "Kamu sedang offline", kode `NETWORK_OFFLINE` | error |
| Dashboard — Mode atur | iBCvF | atur tata letak, 1 kartu tersembunyi | edit |
| Dashboard — Seret kartu | e1r8q | drag Langganan ke kiri Kalender | drag |
| Dashboard — Kelola kartu | GcXr5 | panel daftar kartu, toggle tampil, lebar ⅓/⅔/Penuh | dialog |
| Dashboard — Tata letak tersimpan | R1aqQ | toast + Urungkan | sukses |

### 3. Alur user
- **Ganti periode**: klik Minggu/Bulan/Tahun → state "Memperbarui ringkasan…" → semua kartu dihitung ulang. Klik label "Okt 2026" → popover Pilih Periode (grid bulan dengan total belanja, "Nov · —" belum ada data) → Bulan ini / Bulan lalu (Sep 2026) / Rentang khusus….
- **Menu pengguna → keluar**: klik avatar "AK Avtara K. · Paket Pribadi" → menu (email, Pribadi, Pengaturan ⌘,) → Keluar → dialog "Keluar dari write.financial?" dengan checkbox "Keluar dari semua perangkat · Aktif di 2 perangkat lain · iPhone, MacBook" → Batal/Keluar.
- **Interaksi Arus Uang**: chip Semua/Kebutuhan/Keinginan/Tabungan → filter; hover pita → tooltip; klik → "lihat 18 transaksi"; menu ⋯ → ekspor/opsi tampilan.
- **Kalender**: navigasi bulan; klik tanggal → panel rincian ("Minggu, 11 Oktober · 5 transaksi · Rp3.380.000 · 3× rata-rata") berisi daftar transaksi dengan tag & jam.
- **Atur dashboard**: Atur → mode atur (seret ⋮⋮, klik mata untuk sembunyikan) → seret kartu ("Lepas untuk memindah Langganan ke kiri Kalender Pengeluaran") → Kelola kartu (toggle, urutan, lebar) → Simpan tata letak → toast "Langganan dipindah ke kiri · Pemasukan vs Pengeluaran disembunyikan · Urungkan". Ada "Reset ke default".
- **Pengguna baru**: Kosong → Langkah 1 Tambah rekening (± 1 menit) → Langkah 2 Catat transaksi (terkunci: "Butuh rekening dulu") → Langkah 3 Atur anggaran; opsi "Impor mutasi CSV · Bisa dilewati".
- **Offline**: "Coba lagi" atau "Lihat data terakhir · 15 Okt 16.40".

### 4. Entitas data & field
- **User/Profil**: display_name ("Avtara K."), nickname ("Avtara"), plan ("Paket Pribadi"), workspace ("Pribadi"; [INFERENCE] ada konsep workspace/ruang, hanya satu terlihat).
- **Account (rekening)**: name ("BCA Tahapan"), type enum (Bank, E-Wallet, Tunai, Investasi), masked_number ("•• 4821", "0812•• 18"), currency (IDR/USD), balance bigint, delta periode ("+Rp1.200.000 bulan ini"), linked goals ("4 tujuan", "Dana Darurat"), platform count untuk investasi ("IDR + USD · 5 platform · dalam IDR · Rp61.420.000 · +Rp6.000.000 disetor Okt").
- **Transaction**: type enum keluar/masuk/transfer, amount bigint, category_id, account_id (from/to untuk transfer), occurred_at (tanggal+jam, mis. "14.12"), note, merchant/deskripsi ("Erafone — Headphone"), tags[] ("gadget", "kerja"), status ("Perlu ditinjau" — dari Langganan/Gmail).
- **Category**: name, kelompok enum (Kebutuhan/Keinginan/Tabungan; pemasukan: Gaji, Freelance, Penjualan & lainnya, Dividen & bunga, THR), flag "TETAP" (Sewa Kos "lunas 1 Okt"), monthly_budget bigint.
- **Subscription** (kartu Langganan): name, plan ("Premium 4K", "Family", "Individu", "Plus", "Gym bulanan", "200 GB"), price bigint, next_bill_date, status ("Lunas"), usage ("dibuka 2× dalam 30 hari" [INFERENCE] sumber data pemakaian tidak jelas).
- **DashboardLayout** (per user): daftar kartu {key, visible bool, order int, width enum ⅓/⅔/Penuh}; kartu yang tersedia: Bar Catat Cepat (tetap paling atas), Ringkasan KPI (tetap di atas), Rekening & dompet, Arus Uang, Pengeluaran per Kategori, Pemasukan vs Pengeluaran, Anggaran Kategori, Langganan, Kalender Pengeluaran; bisa ditambah: Investasi ringkas, Tujuan tabungan, Pengingat tagihan ("7 hari ke depan"). "Tersimpan di akunmu".
- **Onboarding progress**: langkah selesai (0/3).

### 5. Aturan bisnis & perhitungan
- **Ditabung & Investasi = Pemasukan − Pengeluaran**: 26.000.000 − 16.500.000 = 9.500.000 (Okt); tahun 262,5 jt − 187,7 jt = 74,8 jt.
- **Saving rate = ditabung / pemasukan**: 9,5/26 = 36,5% (target 30%); minggu 4,41/6,2 = 71,1%; tahun 74,8/262,5 = 28,5%.
- **Perbandingan**: Bulan "vs Sep" (+4,1%, −9,8%, +27%); Minggu "vs mgg lalu" dan pengeluaran "vs Sen–Kam lalu" (periode berjalan dibandingkan rentang hari yang sama, like-for-like); Tahun "vs 2025".
- **Arus Uang (Sankey)**: sumber pemasukan → Kebutuhan/Keinginan/Tabungan → kategori. Persen = nilai/pemasukan (Kebutuhan 10,4 jt = 40%, Keinginan 6,1 jt = 23%, Tabungan 9,5 jt = 37%). Hover: porsi kelompok (Makan 3,2/10,4 = 31%), rata-rata transaksi 3.200.000/18 = Rp178.000, progres anggaran "3.200.000 / 3.500.000". Sumber < 1% disembunyikan default ("Dividen & bunga <1%"). **Transfer antar rekening tidak dihitung** (opsional di menu). Minggu: "Belum dialokasikan Rp1.410.000, tetap di rekening" (pemasukan belum terpakai/disetor).
- **Sisa anggaran per hari** = (batas − terpakai) / sisa hari periode termasuk hari ini: Makan (3.500.000 − 3.200.000)/16 hari (16–31 Okt) ≈ Rp19.000; Hiburan 400.000/16 = Rp25.000; Transportasi 600.000/16 ≈ Rp38.000. Kategori tetap: "lunas". Lewat: 2.400.000/2.000.000 = 120% "lewat Rp400.000".
- **Proyeksi lewat anggaran**: "akan lewat Rp566.000" (90%, 900.000/1.000.000) — rumus proyeksi tidak dapat direkonstruksi dari angka (laju linear 900k/15×31 ≈ 1,86 jt → lewat 860k) [INFERENCE: mungkin memperhitungkan tagihan terjadwal]; lihat pertanyaan terbuka.
- **Anggaran mingguan = batas bulanan / 4,4**: 3.500.000→795.000, 2.000.000→455.000, 2.500.000→568.000, 1.000.000→227.000. Status "1 hampir habis". Anggaran tahunan = batas bulanan × 10 bulan berjalan (Jan–Okt): 3,5 jt→35 jt.
- **Rata-rata harian kalender** = pengeluaran periode / jumlah hari: Okt 16,5 jt/15 = 1,1 jt; Sep 18,3 jt/30 = 610.000; 2026 187,7 jt/304 hari ≈ 617.000. Penanda "3× rata-rata", "Hari terboros", hari surplus (pemasukan > pengeluaran, mis. "+13.650.000" 1 Okt), "tanpa belanja", legenda Sedikit/Banyak/Surplus/Setoran tabungan/Tagihan terjadwal. Tahun: "Hari hemat 41 hari di bawah Rp300.000", "Akhir pekan 2,4× lebih boros dari hari kerja".
- **Pemasukan vs Pengeluaran (6 bulan)**: rata-rata menabung Rp6.800.000/bulan; tooltip Sep: selisih +7,5 jt, rasio tabung 7,5/25,8 = 29%, "+8,3% belanja vs Agustus"; "Tren pengeluaran −7,3% / 3 bulan".
- **Langganan**: Per bulan = jumlah langganan bulanan = 186.000 + 86.900 + 59.000 + 329.000 + 199.000 + 45.000 = Rp904.900; Per tahun = 904.900×12 + langganan tahunan Rp660.900 = Rp11.520.000. Hitung mundur "3 hari lagi". Saran hemat: YouTube 59.000×12 = Rp708.000/tahun. Grafik biaya langganan 6 bulan "+24%".
- **Sapaan berbasis waktu**: "Selamat sore" [INFERENCE: dari jam lokal zona waktu user].
- **Mata uang**: saldo IDR+USD ditampilkan "dalam IDR" memakai kurs Pengaturan. "Saldo tersedia · tanpa investasi Rp55.023.000".

### 6. Job latar/scheduler & integrasi
- Agregasi ringkasan per periode ("Diperbarui 15 Okt 2026, 16.42") — [INFERENCE] bisa dihitung on-demand atau di-cache/materialized; tanda waktu menyiratkan snapshot.
- Offline queue di klien: "Transaksi yang kamu catat tetap disimpan di perangkat dan dikirim saat online lagi" (sinkron dari klien, bukan worker).
- Kurs untuk konversi saldo USD (lihat Pengaturan kurs).
- Insight langganan "hanya dibuka 2× dalam 30 hari" [INFERENCE: tidak ada sumber data pemakaian di desain].

### 7. Komponen UI
Sidebar navigasi (badge Transaksi 128, Langganan 7; Cari ⌘K; Tanya Asisten ⌘J), segmented control periode, popover pemilih bulan, KPI card dengan delta badge, account card, Sankey chart dengan chip filter + tooltip + menu ⋯, progress bar anggaran, bar/line chart dengan tooltip, heatmap kalender + panel detail hari, list langganan dengan avatar huruf, banner saran, user menu dropdown, confirm dialog, skeleton, banner offline, toast dengan Urungkan, mode edit drag-and-drop, panel Kelola kartu (toggle + pilihan lebar), empty-state onboarding stepper.

### 8. Pertanyaan terbuka
- Rumus "akan lewat Rp566.000".
- Apakah periode "Bulan" mengikuti "Periode bulanan" (menu Pengaturan ada tapi tidak ada layarnya) — mis. awal bulan = tanggal gajian?
- "Rentang khusus…" tidak ada layarnya.
- Anggaran mingguan pakai faktor 4,4 tetap atau hari aktual?
- Sumber data "dibuka 2× dalam 30 hari".
- Workspace "Pribadi" di menu: apakah ada multi-workspace?

---

## B. Catat Cepat (bar di Dashboard)

### 1. Ringkasan
Bar input satu baris di atas Dashboard (shortcut **N**) untuk mencatat Keluar/Masuk/Transfer cepat: jumlah, kategori, tanggal, catatan, Simpan (↵).

### 2. Layar & state
| Layar | Node | Isi | State |
|---|---|---|---|
| Bar default (Keluar) | iUqiN | "Rp 85.000 · Makan & Dapur · Hari ini · Catatan, mis. makan siang · Simpan ↵" | default |
| Catat Cepat: Masuk | g7ND9q | "+Rp 6.200.000 · Dari · Ke · Catatan" | tab Masuk |
| Catat Cepat: Transfer | V7jC0w | "Dari · Ke · Bibit RDPU · Catatan" | tab Transfer |
| Pilih Kategori | BOkCJ | pencarian, grup KEBUTUHAN/KEINGINAN, info sisa anggaran per kategori, "Buat kategori pengeluaran", navigasi ↑↓ | popover |
| Pilih Tanggal | xALG8 | shortcut Hari ini/Kemarin/2 hari lalu/Sabtu lalu/Awal bulan, Jadwalkan, kalender (titik "ada transaksi"), Jam + "Sekarang" | popover |
| Tersimpan | XZ54L | toast "Transaksi tersimpan · Makan & Dapur · −Rp85.000 · BCA Tahapan · Urungkan" | sukses |
| Jumlah kosong | p4AWD | "Isi jumlah dulu sebelum menyimpan" | error validasi |

### 3. Alur
Ketik jumlah → pilih kategori (keyboard ↑↓, Esc) → pilih tanggal/jam (opsional, bisa "Jadwalkan" ke masa depan) → catatan → ↵ → toast + Urungkan. Masuk: Dari (sumber/kategori pemasukan [INFERENCE]) dan Ke (rekening). Transfer: Dari rekening → Ke rekening (mis. "Bibit RDPU", akun investasi).

### 4. Entitas
Transaction {type, amount bigint, category_id (keluar/masuk), from_account_id, to_account_id, occurred_at timestamptz, note, is_scheduled [INFERENCE dari "Jadwalkan"]}. Rekening default ("BCA Tahapan") [INFERENCE: rekening default/terakhir dipakai].

### 5. Aturan bisnis
- Amount wajib > 0.
- Popover kategori menampilkan status anggaran: "sisa anggaran Rp300.000", "lewat anggaran Rp400.000", "akan lewat anggaran Rp566.000" (dengan jumlah yang sedang diketik ditambahkan [INFERENCE]).
- Aturan otomatis dijalankan saat menyimpan lewat Catat Cepat (lihat Pengaturan › Aturan otomatis).
- Transfer tidak dihitung sebagai pemasukan/pengeluaran.

### 6. Job
Transaksi terjadwal ("Jadwalkan") butuh job untuk memposting/menandai saat jatuh tempo [INFERENCE].

### 7. Komponen
Segmented tab Keluar/Masuk/Transfer, amount input berprefiks Rp, combobox kategori dengan keyboard hints, date-time picker dengan shortcut, kbd hint (N, ↵, Esc), toast undo, inline validation.

### 8. Pertanyaan
Pemilihan rekening untuk Keluar tidak terlihat di bar (toast menyebut BCA Tahapan) — dari mana? "Jadwalkan" punya perilaku apa (masuk Perlu ditinjau?).

---

## C. Langganan Baru (dialog dari Dashboard)

### 1. Ringkasan
Dialog membuat tagihan rutin; muncul di kalender dan masuk "Perlu ditinjau" saat jatuh tempo; mendukung masa uji coba gratis.

### 2. Layar & state
| Layar | Node | Isi | State |
|---|---|---|---|
| Tambah Langganan | AzWY9 | form standar | dialog default |
| uji coba gratis aktif | oEASr | trial 14 hari + timeline | toggle on |
| uji coba — Lainnya | fYcJR | input hari kustom (21) | input kustom |

### 3. Alur
Isi Layanan (ketik bebas, "Disney+ Hotstar") → logo (Unggah PNG / Pakai ikon) → Harga → Siklus (Bulanan/Tahunan/Mingguan) → Tagihan berikutnya → Bayar dari (rekening) → Kategori → Deskripsi (opsional) → Ingatkan (3 hari sebelumnya, notifikasi) → opsional Masa uji coba (7 hari/14 hari/1 bulan/Lainnya) → Simpan langganan.

### 4. Entitas
Subscription {service_name text, logo (upload|icon), price bigint, cycle enum(weekly, monthly, yearly), next_bill_date date (label berubah jadi "Tagihan pertama" saat trial), pay_from_account_id, category_id, description?, remind_days_before int (3), remind_channel (notifikasi), trial_days int?, trial_start date}.

### 5. Aturan
- Tagihan pertama = mulai + durasi trial, ditagih hari berikutnya: 17 Okt + 14 hari → "Min, 1 Nov 2026"; 21 hari → "Min, 8 Nov 2026". Pengingat = tagihan − 3 hari (29 Okt; 5 Nov). Ringkasan "Gratis 14 hari · lalu Rp39.000/bulan".
- Saat jatuh tempo → transaksi status "Perlu ditinjau"; **saldo baru dipotong setelah ditandai sudah dibayar**.

### 6. Job
Pengingat H-N; pembuatan tagihan "Perlu ditinjau" saat jatuh tempo; rollover next_bill_date sesuai siklus.

### 7. Komponen
Modal form, uploader logo, segmented siklus, date picker, select rekening/kategori, toggle + chip durasi, timeline trial (17 Okt → 🔔 Diingatkan → Ditagih).

### 8. Pertanyaan
Apakah "Tagihan berikutnya" default dihitung otomatis? Perilaku pembatalan saat trial?

---

## D. Pengaturan (sub-fitur)

Layout umum: header "Pengaturan · Akun, mata uang & kurs, tampilan, notifikasi, dan data — tersinkron di semua perangkat"; nav kiri: AKUN (Profil & akun), PREFERENSI (Mata uang & kurs, Periode bulanan, Tampilan, Notifikasi, Kategori, Tag, Aturan otomatis), DATA (Data & cadangan, Keamanan), INTEGRASI (AI agent (BYOK), API kurs & pasar, Gmail), LAINNYA (Pintasan keyboard, Bantuan & tentang). Footer sticky: "Tersinkron ke semua perangkat · Batal · Simpan perubahan" (state "Ada perubahan belum disimpan" / "Belum disimpan"). Dibuka dari menu pengguna atau ⌘, .

### 1. Ringkasan
Pusat preferensi akun dan aplikasi yang disimpan di server per user dan tersinkron lintas perangkat; perubahan diedit sebagai draft lalu disimpan eksplisit.

### 2. Daftar layar & state
| Layar | Node | Isi | State |
|---|---|---|---|
| Profil & akun | bcBrM | foto, nama, sapaan, bahasa, zona waktu, email, metode masuk | default (kata sandi diatur) |
| Profil — Google, kata sandi belum diatur | zAsMe | banner "Atur kata sandi sebagai cadangan · Nanti" | default akun Google-only |
| Profil — atur kata sandi | yPz2Z | form inline kata sandi baru + ulangi, meter "13 karakter · kuat" | edit |
| Profil — kata sandi tersimpan | S0XrWl | toast/dialog "Kata sandi diatur … Oke" | sukses |
| Mata uang & kurs | cqz0s | mata uang utama, mata uang lain, mode kurs Otomatis | default |
| — pilih mata uang utama | T67Pn | dropdown mata uang | dropdown |
| — kurs manual | BkgXr | mode Manual, berlaku sejak, input kurs | edit, belum disimpan |
| Tampilan | ODH9k | tema, format angka/tanggal, awal minggu, sembunyikan saldo | default |
| Tampilan — sembunyikan saldo aktif | Trbov | toggle on + penjelasan Intip | dirty |
| Notifikasi | HNPLN | pengingat & ringkasan, kanal | default |
| — pilih waktu pengingat tagihan | gK5Rk | H-3 / H-1 / Hari H, jam 09.00 | popover |
| — ubah jam pengingat | punnX | 07.00…20.00 / Jam lain | popover |
| — ambang peringatan anggaran | PIDcm | 50% / 80% (+100%) | popover |
| Kategori | YnLF6 | list Pengeluaran (12) / Pemasukan (4), drag urutan | default |
| — menu ⋯ Belanja Online | iHweD | Edit (E), Pindah ke Kebutuhan, Lihat transaksi, Gabungkan dengan…, Arsipkan, Hapus | menu |
| — hapus (konfirmasi) | g8bxL | dampak penghapusan | dialog destruktif |
| — dihapus (toast) | fDbls | "12 transaksi perlu ditinjau · Tinjau"; jumlah jadi 11 | sukses |
| — kategori baru | zGTve | form kategori + pratinjau | dialog |
| — pilih warna | h4zLb8 | palet + hex "14B8A6", "Terakhir dipakai" | popover |
| Tag | k2GrzG | tabel tag, saran gabung | default |
| Tag — gabungkan 3 tag | Q283b | dialog merge | dialog |
| Aturan otomatis | HXDL7 | daftar aturan berurutan, saran | default |
| — edit "Berangkat ke kantor" | evJtJ | editor JIKA/MAKA + pratinjau | edit |
| — tersimpan | RjTTZ | toast + Urungkan | sukses |
| — gagal menyimpan | h7hnWe | toast "Koneksi terputus… Coba lagi" | error |
| Data & cadangan | Svmyv | ekspor/impor, cadangan, zona berbahaya | default |
| Keamanan | pdmek | kunci aplikasi, kata sandi, perangkat aktif | default |
| Pintasan keyboard | MoQlc | daftar shortcut | default |
| Bantuan & tentang | R4rZFa | bantuan, versi | default |
| AI agent (BYOK) | MXnjE | provider, API key, model, izin & batas | terhubung |
| AI agent — ZenMux gagal | l1nyC | error 401 | error |
| AI agent — log | GpdeI | tabel aktivitas agent | log |
| AI agent — log detail baca struk | OJaxo | detail permintaan + tool call | detail |
| API kurs & pasar | W6ThPJ | 3 penyedia data harga | default (peringatan kuota) |
| API kurs — log | iCbPR | log permintaan | log |
| API kurs — log detail 429 | eDyYC | detail respons rate limit | detail error |
| Gmail (4 layar + toast) | bCdNA, kHEuC, D6NOl8, DS1LC, ukKey | lihat bagian E | — |

### 3. Alur user
- **Profil & akun → kata sandi**: akun daftar via Google → banner saran → "Atur kata sandi" → isi kata sandi baru + ulangi ("tidak perlu verifikasi email lagi") → Simpan kata sandi → "Sekarang kamu bisa masuk dengan Google atau avtara.k@gmail.com + kata sandi" → status "Diatur · baru saja".
- **Mata uang & kurs**: pilih mata uang utama (dropdown) → mode Otomatis (BI JISDOR, "Perbarui sekarang") atau Manual (isi kurs, "Berlaku sejak 1 Okt 2026", banding vs BI) → Simpan.
- **Tampilan**: pilih tema Terang/Gelap/Sistem, format angka (Rp1.234.567 atau Rp1,2jt), format tanggal, awal minggu (Senin), toggle Sembunyikan saldo → Simpan.
- **Notifikasi**: atur pengingat tagihan (H-3/H-1/Hari H + jam), ambang anggaran, saldo rendah (500.000), ringkasan mingguan, kanal Push/Email/Keduanya.
- **Kategori**: drag urutan → ⋯ → Hapus → dialog dampak → toast "Tinjau"; atau Kategori baru → Jenis, Nama, Kelompok, Ikon, Warna, Anggaran → Buat kategori.
- **Tag**: lihat statistik → banner "3 tag terlihat sama" → Tinjau & gabungkan → pilih tag tujuan ("paling sering") → Gabungkan 3 tag.
- **Aturan otomatis**: lihat daftar (Aktif 9 / Nonaktif 1) → saran dari koreksi ("Buat aturan"/"Abaikan") → edit aturan → pratinjau Oktober → opsi "Terapkan ke transaksi lama" → Simpan → toast sukses/gagal.
- **Data**: Ekspor…, Impor…, Pilih cadangan untuk pulihkan, Hapus transaksi.
- **Keamanan**: toggle kunci aplikasi, kunci otomatis, ubah kata sandi, keluarkan perangkat / semua perangkat lain.
- **AI agent BYOK**: pilih provider (OpenRouter/ZenMux/Custom) → API key → Tes → pilih model → izin & batas biaya → lihat log → detail.
- **API kurs & pasar**: atur penyedia per kelas aset → lihat log → detail error.

### 4. Entitas data & field
- **UserProfile**: avatar_url (dari Google, upload JPG/PNG ≤ 2 MB), full_name text ("dipakai di laporan PDF"), nickname text, language enum (id), timezone text IANA ("Asia/Jakarta (WIB)"), email (immutable, verified bool).
- **AuthIdentity**: provider enum (google, password), email, linked_at ("terhubung sejak Apr 2026"), is_primary ("Utama"), password_set bool, password_changed_at ("terakhir diubah 3 bulan lalu").
- **Session/Device**: device_name ("MacBook Pro", "iPhone 15", "iPad Air"), browser ("Chrome"), location (Jakarta/Bandung), last_active_at, is_current.
- **CurrencySettings**: base_currency (IDR), other_currencies[] (USD, SGD — "terdeteksi dari rekening & investasimu"), rate_mode enum(auto, manual).
- **FxRate**: base, quote, rate numeric (Rp16.350 per USD), source ("Bank Indonesia · JISDOR"), fetched_at ("15 Okt 2026, 09.00 WIB"), change_pct (+0,4%), is_manual, effective_from date ("1 Okt 2026"). Rate disimpan sebagai numeric/decimal, bukan minor unit.
- **DisplaySettings**: theme enum(light, dark, system), number_format enum(full, compact), date_format ("15 Okt 2026"), week_start enum (Senin), hide_balances bool.
- **NotificationSettings**: bill_reminder {enabled, offset enum(H-3, H-1, H), time time (09.00)}, budget_alert {enabled, thresholds int[] (80, 100; opsi 50)}, low_balance {enabled, threshold bigint 500.000}, weekly_summary {enabled, Senin pagi}, channel enum(push, email, both).
- **Category**: type enum(expense, income), name varchar(24), group enum(Kebutuhan, Keinginan, Tabungan) [untuk pengeluaran], icon, color hex, monthly_budget bigint? , sort_order int, archived bool, is_fixed [INFERENCE dari "TETAP"].
- **Tag**: name, usage_count (142×), usage_this_month (21×), last_used_at, is_system ("otomatis · SISTEM"), aliases[] ("nama lamanya tetap dikenali saat kamu mengetik").
- **AutoRule**: name, order int (urutan 6), active bool, conditions[] {field enum(deskripsi, hari, jam, rekening, arah masuk/keluar, langganan terdaftar), operator (berisi salah satu, salah satu, sebelum), values[]}, logic "semua harus terpenuhi" (AND), actions[] {set_category, add_tag}, match_count_month ("14×"). RuleSuggestion {pattern "Kopi Kenangan", from_category, to_category, count 4}.
- **Backup**: created_at, size ("2,4 MB"), retention 30, frequency "Setiap hari" 03.00 WIB.
- **SecuritySettings**: app_lock bool (PIN/Face ID), auto_lock_after enum ("Setelah 5 menit").
- **AiProviderConnection**: provider enum(openrouter, zenmux, custom OpenAI-compatible), api_key (terenkripsi, ditampilkan "sk-or-v1-••••3f9a"), added_at, status (Terhubung/Gagal + kode 401), model ("anthropic/claude-sonnet-5.5"), allow_read_financial bool, allow_write_transactions bool, require_confirmation bool, monthly_cost_limit_usd numeric (5,00), usage (312 permintaan, $1,24).
- **AiAgentLog**: time, feature enum(Chat, Baca struk, Kategorisasi, Tes koneksi), detail, model, provider, tokens_in/out, cost_usd, duration, status (OK, 401, Dikonfirmasi), data_sent summary, tool_call ("buat_transaksi_draft {merchant, jumlah, kategori, rekening, tanggal}"). "Isi prompt & respons hanya disimpan di perangkat ini".
- **MarketDataProvider**: asset_class enum(fx, stocks/ETF, crypto), provider (BI JISDOR, Yahoo Finance, CoinGecko), api_key? (opsional), frequency (Harian 09.00, 15 menit, 5 menit), active, last_run, quota_used/limit (8.000/10.000), alert "Batas 80%".
- **MarketDataLog**: time, source, request ("GET /simple/price btc,eth,sol → idr"), status (200, 429, 504), duration, retry attempt (1/3), fallback ("pakai harga 15.57"), response body; retensi 30 hari, key dimasking.

### 5. Aturan bisnis & perhitungan
- Mata uang utama dipakai untuk semua total; saldo lain dikonversi pakai kurs. Manual: "Kurs tetap dipakai sampai kamu mengubahnya"; selisih vs BI = (16.200 − 16.350)/16.350 = −0,9%.
- Format angka kompak: Rp1.234.567 → "Rp1,2jt".
- Sembunyikan saldo: semua nominal jadi "Rp ••••"; tombol Intip di header untuk lihat sebentar.
- Peringatan anggaran saat terpakai mencapai 80% & 100% (opsi 50%), "Berlaku untuk semua kategori".
- Hapus kategori: transaksi tetap ada (saldo/laporan tidak berubah), semua transaksi masuk "Perlu ditinjau", anggaran kategori ikut dihapus (Belanja Online Rp2.000.000/bulan). Tidak bisa dibatalkan.
- Nama kategori maks 24 karakter.
- Gabung tag: transaksi dipindah ke tag tujuan (16 = 12+3+1), tag lain dihapus, nama lama jadi alias, laporan per tag Juli–September dihitung ulang. Deteksi tag mirip ("3 tag terlihat sama").
- Aturan otomatis: dijalankan berurutan saat transaksi dicatat lewat Catat Cepat, Asisten, struk, atau impor mutasi (dan Gmail). **Kategori: aturan teratas yang cocok menang; Tag: gabungan dari semua aturan yang cocok.** Kondisi dalam satu aturan = AND. Pratinjau menjelaskan alasan tidak cocok ("bukan gojek/krl", "hari Minggu"). Default berlaku untuk transaksi baru; "Terapkan ke transaksi lama" opsional. Saran aturan dari ≥N koreksi manual (contoh 4×).
- Kata sandi: meter kekuatan; akun Google sudah terverifikasi → kata sandi langsung aktif.
- Hapus semua transaksi: rekening, kategori & anggaran tetap.
- AI: batas biaya bulanan dalam USD; "Selalu minta konfirmasi sebelum menyimpan" (agent membuat draft).
- Kuota API: peringatan saat ≥ 80% (8.000/10.000); retry otomatis hingga 3× untuk 429 (patuh `retry-after: 30`); timeout 10 dtk → fallback harga terakhir.

### 6. Job latar/scheduler & integrasi
- Sinkron kurs harian 09.00 WIB dari BI JISDOR (+ "Perbarui sekarang" manual).
- Harga saham/ETF (Yahoo Finance) tiap 15 menit; kripto (CoinGecko) tiap 5 menit; retry/backoff, pencatatan log, pemantauan kuota.
- Pengingat tagihan (H-3/H-1/Hari H pada jam pilihan, timezone user).
- Peringatan anggaran (event-driven saat transaksi masuk) dan saldo rendah.
- Ringkasan mingguan setiap Senin pagi via push/email.
- Cadangan otomatis harian 03.00 WIB, retensi 30; restore.
- Ekspor (CSV/Excel/PDF) dan impor mutasi CSV — [INFERENCE] dijalankan sebagai job asinkron.
- Rekalkulasi laporan setelah gabung tag; penerapan aturan ke transaksi lama.
- Revoke sesi perangkat. Log retensi 30 hari (pembersihan berkala).

### 7. Komponen UI
Settings shell (nav kiri bergrup + footer simpan sticky dengan state dirty), form row (label + hint + kontrol), toggle, segmented control, select/dropdown, popover pilihan waktu/ambang, input uang & kurs, color picker (palet + hex + terakhir dipakai), icon picker, sortable list (drag), menu ⋯ dengan shortcut, confirm dialog destruktif dengan ringkasan dampak, toast dengan aksi (Tinjau/Urungkan/Coba lagi), tabel tag, rule builder JIKA/MAKA dengan chip nilai, panel pratinjau cocok/tidak, kartu provider dengan status badge, input secret dimasking + Tes, usage meter, tabel log dengan filter + panel detail JSON + Salin + Ekspor CSV, banner info (Atur kata sandi), daftar perangkat.

### 8. Pertanyaan terbuka
- **Periode bulanan** ada di nav tapi tidak ada layarnya (tanggal mulai bulan custom?).
- Jenis notifikasi push: web push / mobile app? Ada aplikasi native (iPhone, iPad disebut sebagai perangkat)?
- Kunci aplikasi (PIN/Face ID) "di perangkat ini" — tapi footer "Tersinkron ke semua perangkat"; mana yang lokal?
- Pintasan "G" + R/T/A/L/I/P: pemetaan huruf ke halaman tidak eksplisit [INFERENCE: R=Ringkasan, T=Transaksi, A=Anggaran, L=Langganan/Laporan?, I=Investasi, P=?]. Shortcut lain: N catat, ⌘K cari, ⌘, pengaturan, ? daftar pintasan, ⇧↵ simpan & tambah lagi, Esc tutup.
- "Arsipkan" kategori: efeknya ke anggaran dan form?
- Isi prompt AI hanya di perangkat — bagaimana server menyimpan log tanpa isi?
- Mata uang utama bisa diganti dari IDR? Efek ke anggaran historis?

---

## E. Integrasi Gmail — catat otomatis (sub-fitur)

### 1. Ringkasan & tujuan user
User menghubungkan Gmail agar email notifikasi transaksi (bank, e-wallet, toko online, tagihan) dicatat otomatis. Email diterima via Gmail push (Pub/Sub), disaring pengirim + kata kunci, lalu diekstrak oleh AI agent BYOK; keyakinan ≥ 90% langsung dicatat, sisanya masuk "Perlu ditinjau".

### 2. Daftar layar & state
| Layar | Node | Isi | State |
|---|---|---|---|
| Gmail (belum terhubung) | bCdNA | penjelasan, "Lanjutkan dengan Google", Cara kerjanya 1–4, izin gmail.readonly | kosong/belum terhubung |
| Gmail — izin Google (OAuth) | kHEuC | consent accounts.google.com "Melihat pesan dan setelan email Anda · Lanjutkan" | OAuth |
| Gmail (terhubung, filter kata kunci) | D6NOl8 | status, statistik, filter, opsi | terhubung |
| Gmail — uji filter dengan email | DS1LC | 5 email terakhir + hasil AI | uji (dry run) |
| Gmail — izin dicabut (toast) | ukKey | status "Terputus", toast "Gmail terputus … Hubungkan" | error/terputus |

### 3. Alur user
1. Belum terhubung → "Lanjutkan dengan Google" → consent OAuth scope `gmail.readonly` → kembali, status Terhubung.
2. Terhubung: atur Dari pengirim, Berisi kata kunci, Abaikan jika berisi, opsi pencatatan → Simpan perubahan.
3. Uji dengan email → pilih salah satu dari 5 email terakhir → lihat status filter (Lolos/Diabaikan/Tidak cocok + alasan) dan hasil ekstraksi AI per field. "tidak ada yang disimpan".
4. Izin dicabut di Google → status "Terputus · Izin dicabut dari akun Google 16.20 · email setelahnya belum dibaca" → toast → "Hubungkan lagi".
5. "Putuskan" untuk memutus manual; "Lihat log Gmail" (layar log tidak ada).

### 4. Entitas data & field
- **GmailConnection**: user_id, google_email ("avtara.k@gmail.com"), oauth tokens (terenkripsi), scope ("gmail.readonly"), status enum(not_connected, connected, disconnected/revoked), push_active bool, watch_expires_at ("watch diperbarui otomatis tiap 6 hari"), history_id [INFERENCE kebutuhan Gmail API], last_email_at ("email terakhir 16.38"), revoked_at ("16.20").
- **GmailFilter**: sender_allowlist[] (domain/alamat: bca.co.id, gojek.com, pln.co.id, tokopedia.com, shopee.co.id), include_keywords[] (subjek atau isi, "salah satu": transaksi, pembayaran, e-receipt, dana masuk, tagihan), exclude_keywords[] ("menang atas kata kunci": promo, OTP, kode verifikasi, newsletter), auto_record_high_confidence bool (≥ 90%), run_auto_rules bool, skip_if_manually_recorded bool.
- **GmailStats (per bulan)**: email masuk 212, lolos filter 38, dicatat otomatis, perlu ditinjau, diabaikan agent (angka per kategori tidak terbaca di digest).
- **GmailMessageLog** [INFERENCE untuk "Lihat log Gmail" & uji]: message_id, from, subject, received_at, filter_result enum(lolos, diabaikan, tidak_cocok), matched_keyword, reason ("pengirim tidak ada"), extraction {amount, merchant, account (dari no. rek ••4821), date, per-field confidence}, overall_confidence (97%), outcome (dicatat/perlu ditinjau/diabaikan), transaction_id. Isi email **tidak disimpan**, hanya hasil ekstraksi.

### 5. Aturan bisnis & perhitungan
- Urutan pipeline: pengirim ∈ allowlist **dan** subjek/isi berisi salah satu kata kunci **dan tidak** berisi kata kunci abaikan (abaikan menang). Contoh: Shopee "Flash sale 10.10" → Diabaikan (promo); "Kode verifikasi KlikBCA" → Diabaikan; email tanpa pengirim terdaftar → "Tidak cocok · pengirim tidak ada".
- Ekstraksi AI per field dengan keyakinan: Nominal −350.000 dari "Rp 350.000,00" (99%), Merchant "PLN Token Listrik" dari "PLN PRABAYAR" (98%), Rekening dari no. rek ••4821 (96%), Tanggal 14 Okt 2026 18.02; keyakinan total 97% → "catat otomatis".
- Ambang: ≥ 90% → dicatat langsung (khusus Gmail; setelan AI agent umum tetap "selalu minta konfirmasi"); < 90% → "Perlu ditinjau".
- Jika opsi aktif, Aturan otomatis & tag dijalankan ("Utilitas rumah" → Tagihan & Utilitas + #rumah).
- Dedup: lewati jika sudah dicatat manual — cocok bila nominal ± 1% dan waktu ± 2 jam. Juga idempoten per email ("Email ini sudah dicatat … uji tidak mencatat ulang").
- Model dari pengaturan AI agent (OpenRouter · claude-sonnet-5.5); biaya ikut batas bulanan BYOK [INFERENCE].
- write.financial tidak bisa mengirim/menghapus/mengubah email.

### 6. Job latar/scheduler & integrasi
- Endpoint webhook Pub/Sub untuk notifikasi push Gmail → enqueue job (BullMQ) per history change: ambil metadata/isi email, jalankan filter, panggil LLM, buat transaksi / item Perlu ditinjau, terapkan aturan, dedup.
- Job berkala memperbarui `users.watch` sebelum kedaluwarsa (desain: tiap 6 hari; watch Gmail berlaku 7 hari).
- Deteksi pencabutan izin (error invalid_grant/401 saat refresh token) → status Terputus + notifikasi/toast "Gmail terputus"; email setelahnya tidak dibaca sampai dihubungkan lagi [INFERENCE: backfill dari history_id saat reconnect tidak disebut].
- Statistik bulanan (212/38/…) diagregasi dari log.

### 7. Komponen UI
Kartu status koneksi (badge Terhubung/Terputus, Push aktif), stepper "Cara kerjanya", chip input daftar (domain/kata kunci + "tambah"), toggle dengan subjudul, stat tiles, list email dengan badge Lolos/Diabaikan/Tidak cocok, panel hasil ekstraksi dengan confidence per field, tiruan halaman consent Google, toast error dengan aksi "Hubungkan".

### 8. Pertanyaan terbuka
- Layar "Lihat log Gmail" tidak ada.
- Pencocokan rekening dari email (no. rek ••4821) — butuh field nomor rekening masked di Account.
- Apakah email dari periode terputus di-backfill saat reconnect?
- Apakah pemakaian Gmail OAuth `gmail.readonly` (restricted scope) memerlukan verifikasi Google/CASA — berdampak ke peluncuran.
- Akun Gmail yang dihubungkan harus sama dengan akun login? (desain memakai email yang sama).
- Apakah item "Perlu ditinjau" dari Gmail menyimpan referensi ke email (tanpa isi)?
