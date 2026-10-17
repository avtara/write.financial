# Analisis: Rekening & dompet · Anggaran · Langganan · Kalender

Sumber: `/tmp/digest/05-rekening-dompet.md`, `06-anggaran.md`, `07-langganan.md`, `08-kalender.md`. Data contoh: user "Avtara K.", hari ini **15 Okt 2026** (hari ke-15 dari 31).

---

# A. Rekening & dompet (Section 05 [Vmofv])

## 1. Ringkasan & tujuan user
User mencatat semua tempat uangnya secara manual: bank, e-wallet, tunai, platform investasi, dan kartu kredit. Halaman ini menampilkan saldo tersedia, total aset, dan rekening yang perlu disesuaikan. User bisa merekonsiliasi saldo dengan aplikasi bank tanpa harus login ke bank ("Tidak perlu login bank", "Tanpa login bank · tanpa akses mutasi"). Multi-mata uang didukung: Gotrade dicatat dalam USD dan dikonversi dengan "kurs Rp16.350".

## 2. Daftar layar & state
| Layar | Node id | Isi/tujuan | State |
|---|---|---|---|
| Rekening & dompet (halaman) | ycP7T | KPI (Saldo tersedia, Investasi, Total aset, Perlu disesuaikan), daftar per grup BANK/E-WALLET/TUNAI/INVESTASI, panel detail BCA (grafik 6 bulan, toggle, transaksi terakhir, alokasi tabungan) | default |
| Sesuaikan saldo | lAmFr | Rekonsiliasi 1 rekening: tercatat vs sebenarnya, ada 3 cara mencatat selisih | dialog |
| Sesuaikan beberapa rekening | F6sIL | Rekonsiliasi massal untuk rekening yang lama tidak dicek | dialog |
| Tambah rekening: Bank | C016z | Form bank (logo, 4 digit, mata uang, saldo awal, warna) | dialog (logo tidak ditemukan) |
| Tambah: E-Wallet | BSYfj | Nomor HP sebagai pengganti 4 digit | dialog |
| Tambah: Tunai | rmT6r | Form minimal | dialog |
| Tambah: Investasi | RcdFp | Jenis aset, "Nilai saat ini" | dialog |
| Tambah: Kartu kredit | FkWkq | Limit, tanggal tagihan, batas bayar | dialog |
| Edit rekening | a7r2RK | "Mata uang & saldo awal terkunci" | dialog |
| Edit: warna kustom | Bl7ke | Color picker hex "#14B8A6", "Terakhir dipakai" | popover |
| Arsipkan rekening | wkqih | Transfer saldo (opsional) lalu arsipkan, pilih default baru | dialog konfirmasi |
| Menu ⋮ (bank) | Ik3il | Edit, Lihat transaksi, Transfer dari sini, Tampil sebagai kartu, Hitung di saldo tersedia, Arsipkan | menu |
| Menu ⋮ (investasi) | b2Rb6T | Perbarui nilai pasar, Atur kurs USD, Tarik ke rekening bank, Gabung di kartu Investasi | menu |
| Seret untuk urutkan | UiCq6 | "Lepas di atas Bank Jago · urutan kartu ikut berubah" | drag |
| Batas kartu tercapai | amsm2 | "Maks 3 rekening jadi kartu" | error inline/toast |
| Tab Diarsipkan | oed7u | Jenius: Pulihkan / Hapus permanen | tab |
| Filter perlu disesuaikan | r3WDF7 | "Belum dicek lebih dari 14 hari", "Sesuaikan sekaligus" | filter |
| Saldo rendah (OVO) | I3a8q | "Saldo di bawah batas Rp100.000", estimasi habis | peringatan |
| Panel investasi (Gotrade) | Va1Jx | Nilai USD, grafik 6 bulan, Setoran/Dividen/Ditarik | default |
| Memperbarui nilai pasar | GHdic | "memperbarui 2 / 5…", "Diperbarui 19.41" | memuat (parsial) |
| Kartu kredit: detail siklus | YFgrE | Timeline siklus, aturan perhitungan | default |
| Kartu kredit: ubah limit & tanggal | U64Fs4 | Edit inline limit, tanggal cetak dan tempo | edit |
| Skeleton | RVgMr | "Memuat rekening…" | memuat |
| Memperbarui data | z9IPq6 | "Memperbarui saldo…" | memuat (refresh) |
| Gagal memuat | nSLCl | "504 · GET /accounts", tampilkan saldo terakhir tersimpan | error |
| Kosong | M9WVC | "Tambahkan rekening pertamamu", "Tambah dompet tunai" | kosong |

## 3. Alur user
- **Dialog → sesuaikan saldo**: buka rekening → "Sesuaikan saldo" → isi "Saldo sebenarnya" (42.795.000) → sistem menampilkan "Selisih −Rp15.000" → pilih salah satu cara mencatat selisih:
  - (a) catat sebagai transaksi pengeluaran (contoh: "Biaya keuangan → Admin bulanan −Rp15.000"),
  - (b) "Ada transaksi yang terlewat": buka daftar transaksi BCA sejak 1 Okt,
  - (c) "Koreksi tanpa transaksi" (tidak masuk laporan pengeluaran).
  
  Tanggal penyesuaian bisa diubah ("Per 15 Okt 2026, 19.40 · Ubah"). Riwayat penyesuaian terakhir ditampilkan: "Terakhir disesuaikan 1 Okt · −Rp12.500".
- **Sesuaikan beberapa**: dari KPI "Perlu disesuaikan" atau tombol "Sesuaikan sekaligus" → muncul daftar rekening dengan label "dicek N hari lalu" → isi saldo sebenarnya per baris → kategori selisih bisa dipilih per baris (OVO → "Biaya platform", Dompet → "Makan & Dapur") → "total −Rp52.500".
- **Tambah rekening**: pilih jenis (Bank/E-Wallet/Tunai/Kartu kredit; Investasi juga tersedia) → isi penyedia ("ketik bebas", logo dicari otomatis atau user unggah PNG/pakai ikon) → nama tampilan → 4 digit/nomor HP → mata uang → saldo awal + tanggal → warna → toggle → pratinjau kartu.
- **Edit → warna kustom → arsipkan**: saat arsip, user bisa memindahkan saldo ke rekening lain (opsional; contoh "Rp8.125.000 → Rp50.935.000") dan memilih rekening default baru → "Transfer & arsipkan".
- **Daftar → menu ⋮ → menu investasi → seret urutan → batas kartu → diarsipkan → perlu disesuaikan** (sesuai urutan layar di atas). Di tab Diarsipkan ada Pulihkan atau Hapus permanen (ikut menghapus 87 transaksi dari laporan).
- **Panel → investasi → perbarui nilai pasar → saldo rendah**: refresh harga per platform berjalan bertahap ("2 / 5"). Untuk saldo rendah tersedia CTA "Top-up dari BCA" dan "Ubah batas".
- **Kartu kredit → detail siklus → ubah limit & tanggal**.
- **Memuat / gagal / kosong**.

## 4. Entitas data & field
**Account**
- id, user_id
- type: enum `bank|ewallet|cash|investment|credit_card`
- provider_name: text bebas ("Bank Central Asia", "SeaBank")
- logo: auto | upload PNG | icon
- display_name
- last4: char(4), nullable ("•• 4821")
- phone: untuk e-wallet ("0812 3456 7818", ditampilkan "0812•• 18")
- currency: ISO (IDR/USD); terkunci setelah dibuat
- opening_balance: bigint minor; opening_date ("Sejak 12 Jan 2025"); terkunci
- color: hex
- include_in_available: bool ("Hitung dalam saldo tersedia" / "Hitung dalam total saldo")
- include_in_net_worth: bool [INFERENCE: untuk Investasi teksnya "Masuk kekayaan bersih · tidak masuk saldo tersedia"]
- show_as_card: bool (maks 3)
- is_default_quick_entry: bool ("Default Catat Cepat"; unik per user)
- sort_order: int
- status: `active|archived`; archived_at; label "ditutup Mar 2026"
- low_balance_threshold: bigint, nullable (Rp100.000)
- last_reconciled_at
- created_at ("dibuat 12 Jan 2025")
- turunan: transaction_count (214)

**Investment fields**
- asset_type: enum/teks ("Reksa dana & SBN", "ETF AS", "Bitcoin", "Saham ID", "Emas")
- current_value
- cash_balance ("kas US$52")
- market_value_updated_at
- fx_rate_override ("Atur kurs USD")
- merge_into_investment_card: bool ("Gabung di kartu Investasi")
- sub-label RDN

**Credit card fields**
- issuer
- credit_limit (15.000.000)
- statement_day (20)
- due_day (5)
- current_bill (turunan)
- deduct_bill_from_available: bool

**BalanceAdjustment** (riwayat rekonsiliasi)
- account_id, as_of (datetime)
- recorded_balance, actual_balance, diff
- mode: enum `expense_txn|missing_txn|silent_correction`
- category_id (nullable)
- transaction_id (nullable)

**SavingsAllocation** (dari panel "DIALOKASIKAN KE TABUNGAN"): account_id, goal_id, nominal ("DP Rumah · Nominal tetap Rp5.000.000"; "Dana tidak rutin … Rp4.200.000"). Relasi ke Tabungan/Goals, dikerjakan oleh section lain.

**FxRate**: currency, rate (16.350), source auto/manual, updated_at.

**CreditCardCycle** [INFERENCE]: period_start/end ("21 Sep – 20 Okt"), statement_date, due_date, amount, payment_status `lunas penuh|sebagian|minimum|belum bayar`.

## 5. Aturan bisnis & perhitungan
- **Saldo tersedia** = Σ saldo rekening dengan include_in_available (non-investasi): bank 54.175.000 + e-wallet 498.000 + tunai 350.000 = **Rp55.023.000** ✔. Jika toggle kartu kredit aktif, tagihan berjalan kartu kredit ikut dikurangi.
- **Bebas** = tersedia − dialokasikan ke tabungan: 55.023.000 − 17.300.000 = 37.723.000. Desain menampilkan "Rp37.700.000", jadi ada pembulatan ke ratusan ribu [INFERENCE]. Per rekening: BCA 42.810.000 − 5.000.000 − 4.200.000 = "Bebas dipakai Rp33.610.000" ✔.
- **Investasi** = Σ nilai platform (dikonversi ke IDR): 45.420.000 + 5.500.000 + 4.300.000 + 3.700.000 + 2.500.000 = 61.420.000 ✔. Gotrade: US$2.778 × 16.350 = 45.420.300 → "≈ Rp45.420.000".
- **Total aset / kekayaan bersih** = tersedia + investasi = **116.443.000** ✔. Perbandingan "+Rp4.220.000 sejak 30 Sep" memerlukan snapshot di akhir bulan. Di kekayaan bersih, tagihan kartu kredit dikurangi dan limit tidak dihitung sebagai aset.
- **Saldo rekening** = opening_balance + Σ transaksi (masuk − keluar ± transfer) + Σ penyesuaian.
- **Rekonsiliasi**: selisih = sebenarnya − tercatat (42.795.000 − 42.810.000 = −15.000). Rekening ditandai "Perlu disesuaikan" bila belum dicek **> 14 hari** (OVO 34 hari, Dompet 21 hari). Penyesuaian massal: −14.500 + −38.000 = "total −Rp52.500" ✔.
- **Saldo rendah**: saldo < threshold. Estimasi "cukup ±7 minggu lagi" = saldo ÷ rata-rata pemakaian (86.000 ÷ 50.000/bln ≈ 1,7 bln ≈ 7 minggu).
- **Batas kartu tampil**: maksimal 3 rekening dengan show_as_card. Rekening lain digabung ke "3 lainnya".
- **Arsip**: transaksi tetap muncul di laporan. Hapus permanen ikut menghapus transaksinya. Jika rekening default diarsipkan, user wajib memilih default baru.
- **Edit**: mata uang dan saldo awal terkunci setelah rekening punya transaksi [INFERENCE: dikunci selalu].
- **Kartu kredit** (teks "CARA WRITE.FINANCIAL MENGHITUNG"):
  - Belanja dengan kartu dicatat sebagai pengeluaran pada tanggal transaksi dan langsung mengurangi anggaran.
  - Pemakaian otomatis tercatat sebagai utang di Utang & cicilan.
  - Bayar tagihan dicatat sebagai **transfer** agar tidak terhitung dua kali.
  - Utilisasi sehat ≤ 30%.
  - Pengingat bayar H-3 (2 Nov untuk tempo 5 Nov).
  - Siklus berjalan dari statement_day+1 sampai statement_day (21 Sep–20 Okt).
  - Opsi "Ubah transaksi jadi cicilan" untuk transaksi ≥ Rp500.000.
- **Nilai investasi**: persentase return "+15,2% sejak beli" dan "+18,4%" untuk 6 bulan. Grafik 6 bulan BCA "+12,1%". Arus masuk/keluar per bulan: Masuk +24,7jt, Keluar −14jt, Transfer keluar −9,5jt.

## 6. Job latar/scheduler & integrasi
- **Refresh nilai pasar & kurs**: "Kurs USD otomatis · Kurs acuan Rp16.350" dan "memperbarui 2 / 5…" menunjukkan job per platform (harga ETF/saham/emas/kripto) plus job kurs harian [INFERENCE: sumber harga belum ditentukan].
- **Snapshot kekayaan bersih** akhir bulan ("sejak 30 Sep") dan saldo bulanan untuk grafik 6 bulan.
- **Pengecekan "perlu disesuaikan"** (>14 hari) dan **saldo rendah**, termasuk notifikasi [INFERENCE: notifikasi tidak terlihat eksplisit, hanya badge].
- **Siklus kartu kredit**: job tanggal cetak tagihan (20), pengingat bayar H-3 ("notifikasi & muncul di Halaman berikutnya"), dan konfirmasi pembayaran saat jatuh tempo.
- Tidak ada integrasi bank. Logo penyedia "ditemukan otomatis" dari katalog logo (statis atau layanan eksternal) [INFERENCE].

## 7. Komponen UI
Sidebar + topbar (Cari ⌘K, Tanya Asisten ⌘J), KPI card, list rekening bergrup dengan subtotal, panel detail kanan, sparkline/area chart ("Sumbu dimulai dari Rp…"), toggle row, dialog/modal form, segmented control jenis rekening, input uang dengan prefix "Rp/US$", date picker, color swatch + hex picker, logo uploader, pratinjau kartu, menu ⋮, drag handle "⋮⋮", tabs Aktif/Diarsipkan, badge "default", skeleton, banner error dengan kode, empty state, timeline siklus.

## 8. Pertanyaan terbuka
- Opsi jenis di form hanya Bank/E-Wallet/Tunai/Kartu kredit, padahal ada layar "Tambah: Investasi". Bagaimana Investasi dipilih?
- Pembulatan "bebas Rp37.700.000" vs hasil hitung 37.723.000: apa aturan pembulatannya?
- Jenius yang diarsipkan menampilkan "•• 4821", sama dengan BCA. Kemungkinan data dummy yang tertukar.
- Perbedaan "Hitung dalam total saldo" vs "Hitung dalam saldo tersedia" vs "kekayaan bersih": apakah ini 1 atau 2 flag?
- "Investasi tidak dihitung" di panel Gotrade, apakah maksudnya tidak dihitung di saldo tersedia?
- Apakah "Atur kurs USD" (manual) mengalahkan kurs otomatis, dan berlaku per rekening atau global?
- Hapus permanen: apakah perlu soft-delete/grace period?
- Penyesuaian pertama kali saat rekening dibuat: apakah opening_balance = penyesuaian?

---

# B. Anggaran (Section 06 [M9Yf5])

## 1. Ringkasan & tujuan user
User menetapkan batas bulanan per kategori yang dikelompokkan menjadi **Kebutuhan** dan **Keinginan**. User memantau laju pengeluaran terhadap "ideal hari ini" dan batas aman harian, lalu menutup kategori yang kelebihan dengan memindahkan sisa dari kategori lain. Anggaran berlaku setiap bulan sampai diubah (versi berdasarkan "berlaku mulai"), bulan yang sudah ditutup bersifat hanya baca, dan ada "Dana tidak rutin" (sinking fund) untuk biaya tahunan.

## 2. Daftar layar & state
| Layar | Node id | Isi/tujuan | State |
|---|---|---|---|
| Anggaran (halaman) | E86u2e | Hero sisa, Batas aman harian, Proyeksi, Lewat batas, Kebutuhan & Keinginan, daftar 10 kategori, panel "Perlu perhatian", dana tidak rutin | default |
| Tanpa catatan (daftar melebar) | pyk2Z | Layout tanpa panel kanan | varian |
| September (selesai) | Z8qibf | "Hanya baca · bulan sudah ditutup", hasil, catatan September | read-only |
| Atur anggaran | F0xibH | Sheet atur batas per kategori, "Isi dari rata-rata 3 bulan" | sheet |
| Riwayat perubahan | Cb4oT | Timeline versi total per bulan | sheet |
| Tab Kebutuhan | p4FGEL | Filter grup | tab |
| Urutkan | KHy8x | Lewat batas dulu / Sisa terbanyak / Nama A–Z / Urutan sendiri / Kelompokkan | dropdown |
| Menu ⋮ kategori | WdceE | Ubah batas, Pindahkan sisa ke…, Lihat detail, Bawa sisa ke bulan depan, Anggaran tetap, Ingatkan di 85%, Hapus | menu |
| Ubah batas langsung | U4jwnw | Inline edit, "↵ simpan · Esc batal", dampak ke total | edit inline |
| Detail kategori | IACml | Makan & Dapur: grafik harian, 3 bulan, transaksi | panel/sheet |
| Tambah kategori anggaran | I7KGD | Cari kategori tanpa anggaran, "Buat kategori baru" | popover |
| Pindahkan sisa | FgYBA | Tutup kekurangan Belanja Online | dialog |
| Sisa sudah dipindah | wV9IH | Toast "Urungkan" | sukses/toast |
| Peringatan diabaikan | NpMMC | "1 diabaikan sampai akhir bulan · Tampilkan" | state panel |
| Dana tidak rutin baru | j6G7bA | Form sinking fund | dialog |
| Detail dana: Liburan Bali | McGzv | Progress, riwayat setoran | panel |
| Toast peringatan 85% | o2VZw4 | "Hiburan sudah 86%" | toast |
| Skeleton / Memperbarui / Gagal | tb5ji / c5qKe / a1IpXc | "500 · GET /budgets/2026-10" | memuat/error |

(Tidak ada layar kosong khusus di section ini.)

## 3. Alur user
- **Header → September selesai → atur anggaran → riwayat**: navigasi bulan ke bulan lalu yang hanya baca ("ditutup 30 Sep, sisa dipindah ke tabungan", "Sisa dipindah ke Dana Darurat"). Di halaman Atur anggaran, user mengisi batas per kategori, bisa memakai "Isi dari rata-rata 3 bulan", lalu menyimpan ("1 perubahan · berlaku mulai Oktober 2026"). Di Riwayat, perubahan bisa difilter "Semua kategori".
- **Daftar kategori → tab → urutkan → menu ⋮ → ubah batas → detail → tambah kategori**: ubah batas inline menampilkan "−Rp200.000 → total Rp18.550.000". Tambah kategori anggaran memilih dari kategori yang belum punya anggaran (misalnya "Biaya platform Rp22.660 bulan ini") atau membuat kategori baru.
- **Kartu kanan → pindahkan sisa → sudah dipindah → abaikan**: CTA "Pindahkan Rp400.000" membuka dialog dengan sumber yang sudah terisi (Hobi 300.000, Perawatan Diri 100.000) → simpan → toast dengan Urungkan. "Abaikan" menyembunyikan peringatan sampai akhir bulan.
- **Dana tidak rutin baru → detail dana**: isi nama, target, jatuh tempo, dan "Sudah terkumpul" → nominal per bulan dihitung → toggle "Sisihkan tiap gajian" (setoran masuk Perlu ditinjau tiap tgl 25, lalu dicatat sebagai transfer ke Bank Jago setelah dikonfirmasi).
- **Peringatan anggaran**: transaksi baru melewati 85% memicu toast.

## 4. Entitas data & field
**BudgetPlan / BudgetVersion**
- user_id
- effective_from_month (YYYY-MM)
- created_at
- expected_income (Rp26.000.000; "pemasukan")
- total turunan

**BudgetLine**
- version_id
- category_id
- group: enum `kebutuhan|keinginan` [INFERENCE: properti kategori, bukan baris]
- limit_amount: bigint
- rollover: bool ("Bawa sisa ke bulan depan")
- fixed: bool ("Anggaran tetap"; contoh Sewa Kos "lunas 1 Okt")
- alert_threshold_pct (85)
- sort_order

**BudgetChangeLog**
- category_id
- old → new amount
- delta
- effective_month
- changed_at (contoh "15 Okt · 14.32")
- type: `create|update|new_category`

**BudgetMonth (periode)**
- month
- status: `open|closed`
- closed_at
- leftover_amount
- leftover_destination (goal/Dana Darurat)

**BudgetTransfer** (pindahkan sisa)
- month
- from_category, to_category
- amount
- created_at
- undoable

**AlertDismissal**: category_id, month, dismissed_until (akhir bulan).

**Category** (dimiliki modul Transaksi): name, group (Kebutuhan/Keinginan/Biaya keuangan…), parent ("Biaya keuangan → Admin bulanan").

**SinkingFund (Dana tidak rutin)**
- name
- target_amount
- due_month
- collected_amount
- monthly_amount (turunan)
- schedule_day (25 / "tiap gajian")
- needs_confirmation: bool
- storage_account_id (Bank Jago)
- source_account (BCA)
- contributions[]: date, amount, status scheduled/confirmed, type "Setoran awal"/"Transfer terjadwal"

Relasi ke Tabungan/rekening.

## 5. Aturan bisnis & perhitungan
- **% terpakai** = terpakai ÷ batas: 16.500.000 ÷ 18.750.000 = **88%** ✔. **Sisa** = 2.250.000.
- **Ideal hari ke-N** = N ÷ jumlah hari bulan: 15/31 = **48%** ✔ (ditampilkan sebagai "garis putih = posisi ideal hari ini"). Status "Lebih cepat dari rencana" muncul bila % terpakai > ideal.
- **Batas aman harian** = sisa ÷ hari tersisa: 2.250.000 ÷ 16 = 140.625 → "Rp140.000". Per kategori: Makan 300.000/16 = 18.750 → "Rp19.000"; Transportasi 600.000/16 = 37.500 → "Rp38.000"; Hiburan 400.000/16 = "Rp25.000". Pembulatannya tidak konsisten (lihat §8).
- **Hari tersisa** dihitung sampai akhir bulan ("÷ 16 hari"), sementara subjudul menyebut "16 hari lagi menuju gajian berikutnya". Untuk Oktober keduanya kebetulan sama.
- **Proyeksi akhir bulan**: "Rp24.200.000 · lewat Rp5.400.000" (24,2 − 18,75 ≈ 5,45). Hasil ini tidak sama dengan ekstrapolasi linear 16,5jt ÷ 15 × 31 = 34,1jt. Kemungkinan memisahkan biaya tetap (Sewa lunas) dari variabel [INFERENCE]. Makan & Dapur: proyeksi 6.400.000 (linear = 6,61jt).
- **Kelompok**: Kebutuhan 10.400.000/12.000.000 = 87%, Keinginan 6.100.000/6.750.000 = 90%. Total 18.750.000 = 12.000.000 + 6.750.000 ✔.
- **Lewat batas**: Belanja Online 2.400.000/2.000.000 = 120% → "lewat Rp400.000". Peringatan prediktif "akan lewat Rp566.000" juga ada.
- **Pindahkan sisa**: total anggaran tetap ("Total anggaran tetap Rp18.750.000"). Batas tujuan bertambah (2.000.000 → 2.400.000), batas sumber berkurang (Hobi 700.000 → sisa 0; Perawatan Diri 250.000 → 150.000). Saran sumber diambil dari kategori dengan sisa terbesar [INFERENCE].
- **Peringatan 85%**: toast saat terpakai ≥ threshold ("Hiburan sudah 86% … Sisa Rp350.000 untuk 16 hari (Rp22.000/hari)": 350.000/16 = 21.875 → 22.000).
- **Atur anggaran**: Dialokasikan 18.950.000; Sisa pemasukan = 26.000.000 − 18.950.000 = **7.050.000** ✔. Saran diambil dari "rata-rata 3 bulan" per kategori.
- **Versi**: perubahan "berlaku mulai <bulan>" dan "berlaku sampai diubah lagi". Bulan depan (Nov) ditandai "otomatis" mewarisi versi terakhir. Total per bulan: Jul 18,3jt, Agu 18,0jt, Sep 18,75jt, Okt 18,95jt.
- **Tutup bulan**: bulan selesai jadi read-only, sisanya dipindah ke tabungan (Sep: sisa 1.150.000 → Dana Darurat). Pengeluaran tanpa anggaran tetap dilaporkan ("+Rp700.000 tanpa anggaran"). Perbandingan "vs Agustus +8,3%".
- **Rollover** per kategori ("Bawa sisa ke bulan depan"): menambah batas bulan berikutnya [INFERENCE].
- **Dana tidak rutin**: per bulan = (target − terkumpul) ÷ jumlah bulan sampai tempo. Contoh: 1.500.000 ÷ 6 (Nov–Apr) = **250.000** ✔; total dana tidak rutin 1.150.000 → 1.400.000. Liburan Bali: kurang 8.000.000 − 2.800.000 = 5.200.000; 5.200.000 ÷ 6 setoran ≈ **867.000** ✔ (progress 35%). Bila target naik, setoran dihitung ulang ("naik jadi Rp867.000 mulai Okt karena target dinaikkan").
- Tren "−7,3% / 3 bulan" dan insight seperti "62% pengeluaran Hiburan terjadi di akhir pekan" serta "Stok dapur … menyumbang 74%" adalah analitik turunan.

## 6. Job latar/scheduler & integrasi
- **Tutup bulan** (akhir bulan, 30 Sep): kunci periode, hitung hasil, pindahkan sisa ke tabungan, terapkan rollover, buat periode baru dari versi terakhir ("Nov · otomatis"), dan reset dismissal peringatan.
- **Peringatan threshold** (85%) dipicu event setelah transaksi tercatat, lalu toast/notifikasi.
- **Setoran dana tidak rutin terjadwal** tiap tgl 25/gajian: buat item di "Perlu ditinjau", lalu transfer dicatat setelah dikonfirmasi.
- **Catatan/insight bulanan** ("Catatan September") untuk rekap periode [INFERENCE: dihasilkan oleh job atau asisten].
- Rata-rata 3 bulan per kategori bisa dihitung on-demand atau di-cache.

## 7. Komponen UI
Progress bar dengan penanda ideal (garis putih), KPI card, daftar kategori dengan bar + label sisa/harian, tabs Semua/Kebutuhan/Keinginan, dropdown urutkan, menu ⋮, inline number edit dengan hint keyboard, side sheet (Atur, Riwayat), timeline perubahan, bar chart harian dengan garis batas, mini chart 3 bulan, dialog pindah sisa (input multi sumber + ringkasan HASIL), toast + Urungkan, panel "Perlu perhatian" dengan CTA, form dana tidak rutin dengan chip bulan, badge "Hanya baca", skeleton, error banner.

## 8. Pertanyaan terbuka
- Total header **18.750.000** vs Atur anggaran/Riwayat **18.950.000** "berlaku mulai Oktober 2026". Apakah perubahan di tengah bulan langsung berlaku di bulan berjalan?
- Atur anggaran Kebutuhan "Rp12.200.000", padahal halaman utama Rp12.000.000 (efek perubahan Makan 3,5 → 3,7jt).
- Rumus proyeksi akhir bulan tidak jelas (24,2jt).
- Pembulatan batas harian: floor ke ribuan (140.000) atau round (19.000/38.000)?
- Hari tersisa dihitung sampai akhir bulan atau sampai gajian berikutnya (periode anggaran berbasis gajian)?
- Apakah "sisa dipindah ke Dana Darurat" otomatis atau dikonfirmasi user? Bagaimana interaksinya dengan rollover per kategori?
- Grup "Biaya keuangan" muncul di Tambah kategori, berarti grup tidak hanya Kebutuhan/Keinginan.
- Menu "Anggaran tetap": arti persisnya (batas = tagihan tetap, tanpa pace harian?).
- Apakah transfer anggaran (pindahkan sisa) hanya berlaku bulan ini atau mengubah versi?

---

# C. Langganan (Section 07 [CjvCu])

## 1. Ringkasan & tujuan user
User mencatat langganan dan tagihan rutin (bulanan/tahunan/mingguan, IDR/USD). Sistem menampilkan jadwal tagihan bulan ini, mengingatkan sebelum ditagih, dan mengecek kecukupan saldo rekening pembayar. Saat jatuh tempo, tagihan masuk **Perlu ditinjau** dan saldo baru dipotong setelah user menandai sudah dibayar. Ada juga deteksi tagihan berulang dari transaksi, review pemakaian bulanan, jeda, dan batal.

## 2. Daftar layar & state
| Layar | Node id | Isi/tujuan | State |
|---|---|---|---|
| Langganan (halaman) | CZmJm | KPI Per bulan/Per tahun/Sisa tagihan Okt, chart 6 bulan, timeline jadwal Oktober, tabel, Review bulanan, Bisa dihemat, Per kategori | default |
| Deteksi dari transaksi | DIcp7 | 2 kandidat (Vidio, Google One), Tambahkan/Bukan langganan/Tambah semua | popover/panel |
| Tambah langganan | sN6Eh | Form | dialog |
| Tooltip tagihan | OWkue | Netflix: dari rekening, saldo setelah, pengingat, status | hover |
| Tambah: USD → Bayar dari | yuefQ | Dropdown rekening dikelompokkan MATA UANG SAMA / DIKONVERSI SAAT DITAGIH | dropdown |
| Tab Dijeda | k1FvrG | Headspace, "Lanjut 1 Des 2026", hemat | tab |
| Tab Dibatalkan | W9vmme | 3 dibatalkan, total dihemat | tab |
| Menu ⋮ | WaS25 | Edit, Tandai sudah dibayar, Ganti rekening, Riwayat tagihan, Jeda, Batalkan | menu |
| Ganti rekening | x5B5f | Submenu rekening + peringatan kekurangan | submenu |
| Detail: ChatGPT | UONDi | Total dibayar, kenaikan harga, rating pemakaian, riwayat tagihan | panel |
| Edit: ChatGPT | JZBFF | Form + "Harga naik dari tagihan lalu" | dialog |
| Jeda: Netflix | QO7La | Pilih durasi, pengingat sebelum aktif lagi | dialog |
| Batalkan: YouTube | VtfuA | Berhenti setelah tagihan / sekarang | dialog |
| Review dijawab | u8sjx | "6 / 6 dinilai", "Pertimbangkan berhenti" | state kartu |
| Filter kategori Hiburan | UZLdT | "3 langganan Hiburan · 37% … Rp331.900/bulan" | filter |
| Pengingat H-1 | C861Ys | Banner "Besok: Netflix Rp186.000 … Mau dijeda dulu?" | notifikasi |
| Tagihan belum dikonfirmasi | Lu10H | iCloud+ lewat 9 Okt: "Ya, catat / Belum ditagih" | peringatan |
| Saldo tidak cukup | IFaSb | OVO kurang Rp243.000, "Top-up dari BCA" / "Kembali ke Jago" | peringatan |
| Skeleton / Memperbarui / Gagal | M5E6R / E68KO1 / BEzz9 | "500 · GET /subscriptions", "Pengingat Netflix 18 Okt tetap akan dikirim" | memuat/error |
| Kosong | Jo4sL | "Deteksi otomatis aktif setelah 2 bulan transaksi tercatat" | kosong |

## 3. Alur user
- **Header & jadwal → deteksi → tambah → tooltip → USD & bayar dari**:
  - Deteksi: user meninjau kandidat (nama, "tiap ±tgl 12", tanggal terakhir, nominal, rekening, kategori) → Tambahkan atau Bukan langganan. Dampak ditampilkan: "Jika ditambahkan: Rp970.800/bulan (+Rp65.900)".
  - Tambah: nama (ketik bebas + logo) → harga + mata uang → siklus + tanggal tagihan berikutnya ("Sen, 2 Nov 2026") → Bayar dari → kategori (Kebutuhan/Keinginan) → deskripsi → pengingat ("3 hari sebelumnya · notifikasi") → toggle "Masa uji coba gratis" ("Tagihan pertama setelah uji coba berakhir").
  - USD: rekening USD tampil di grup "MATA UANG SAMA". Rekening IDR "DIKONVERSI SAAT DITAGIH ≈ Rp163.500 per tagihan · kurs Rp16.350", dan "Nominal rupiah dikonfirmasi di Perlu ditinjau".
- **Tabel → dijeda → dibatalkan → menu ⋮ → ganti rekening → detail → edit → jeda → batalkan**:
  - Jeda: pilihan 1 bulan (aktif lagi 18 Nov, −Rp186.000), 2 bulan, atau tanggal kustom, plus pengingat 3 hari sebelum aktif lagi (15 Nov). Catatan: "Jeda juga di aplikasi Netflix — write.financial hanya mencatat."
  - Batalkan: "Berhenti setelah tagihan 22 Okt" (tagihan tetap masuk Perlu ditinjau) atau "Berhenti sekarang" (tagihan dihapus dari jadwal), plus checkbox "Sudah dibatalkan di aplikasi YouTube". Langganan yang dibatalkan bisa diaktifkan lagi dari menu ⋮.
  - Ganti rekening: "Berlaku mulai tagihan 28 Okt" dan menandai rekening dengan saldo kurang.
- **Kartu & peringatan → review dijawab → filter kategori → pengingat H-1 → belum dikonfirmasi → saldo kurang**:
  - Review bulanan: "Seberapa sering kamu pakai YouTube Premium?" dengan rating Sering/Kadang/Jarang/Belum dinilai. Hasil "Jarang" memunculkan saran "Pertimbangkan berhenti … Rp708.000/tahun" → Batalkan… / Tanya lagi bulan depan.
  - Tagihan lewat tanggal yang belum dicatat: "Ya, catat" atau "Belum ditagih".
- **Memuat / gagal / kosong**.

## 4. Entitas data & field
**Subscription**
- id, user_id
- name ("Netflix")
- plan ("Premium 4K", "Family · 4 akun")
- logo/icon
- price: bigint minor
- currency (IDR/USD)
- cycle: enum `weekly|monthly|yearly`
- next_billing_date
- pay_from_account_id
- category_id (Hiburan/Produktivitas/Kesehatan/Penyimpanan/Transportasi)
- group (Kebutuhan/Keinginan)
- description
- reminder_days_before (3; contoh tooltip "H-1" untuk Netflix, jadi bisa diatur per langganan)
- reminder_channel (notifikasi)
- trial: bool + trial_end_date [INFERENCE]
- status: enum `active|paused|cancelled`
- paused_since, resume_date, resume_reminder: bool
- cancelled_at/ends_at, cancel_mode `after_next|now`, replaced_by ("diganti Spotify")
- started_at ("aktif sejak Mar 2025")
- usage_rating: enum `sering|kadang|jarang|null` + rated_at + next_ask_at ("ditanya lagi 1 Nov")

**SubscriptionCharge (tagihan)**
- subscription_id
- due_date
- amount_expected
- currency
- fx_rate
- amount_idr_confirmed
- status: enum `scheduled|due_review|paid|unconfirmed|skipped`
- account_id
- transaction_id (setelah dikonfirmasi)
- confirmed_at

Status di jadwal: "Akan ditagih · Sudah dibayar · Belum dikonfirmasi".

**PriceChange**: old 299.000 → new 329.000, from_charge (Sep), reason (kurs USD).

**DetectedRecurring**: merchant, day_of_month (±12), last_date, amount, account, category, occurrences (3×), status `new|added|dismissed`.

Relasi: Account (pembayar), Transaction (hasil konfirmasi di Perlu ditinjau), Category, event Kalender.

## 5. Aturan bisnis & perhitungan
- **Per bulan** = Σ harga langganan bulanan aktif: 186.000 + 86.900 + 59.000 + 329.000 + 199.000 + 45.000 = **904.900** ✔. Tahunan dipisah ("Rp904.900/bulan + Rp660.900/tahun"). Niagahoster 660.900/12 = 55.075 ✔ sebagai ekuivalen bulanan.
- **Per tahun** = 904.900 × 12 + 660.900 = 11.519.700 → "Rp11.520.000" ✔. "≈ 44% pemasukan sebulan" = 11,52jt ÷ 26jt ✔. "5,5% dari pengeluaran" = 904.900 ÷ 16.500.000 ✔.
- **Sisa tagihan bulan ini** = Σ tagihan berstatus terjadwal sampai akhir bulan: 186.000 + 86.900 + 59.000 + 329.000 = **660.900** (4 tagihan, 18–28 Okt) ✔. Bila Netflix dijeda: 660.900 − 186.000 = **474.900** ✔.
- **Deteksi**: +39.000 + 26.900 = +65.900 → 970.800 ✔. Deteksi baru aktif setelah 2 bulan data. Kriteria kandidat: ≥3× ditagih dengan tanggal mirip ("tiap ±tgl 12").
- **Konversi USD**: US$10 × 16.350 = Rp163.500 (estimasi), nominal final dikonfirmasi di Perlu ditinjau.
- **Saldo setelah** = saldo rekening − tagihan (tooltip Netflix: "Saldo setelah Rp42.624.000" = 42.810.000 − 186.000 ✔). Saldo kurang: OVO 86.000 vs 329.000 → "kurang Rp243.000" ✔. Saran top-up "Rp244.000" [INFERENCE: dibulatkan/ditambah buffer].
- **Hemat** saat dijeda/dibatalkan = harga × bulan tidak ditagih: Headspace 70.000 × 2 = 140.000; Canva 95.000 × 7 = 665.000; Apple Music 55.000 × 6 = 330.000; Gojek Plus 25.000 × 8 = 200.000; total **1.195.000** ✔.
- **Kenaikan harga** dideteksi dengan membandingkan tagihan terakhir: +30.000 (+10%).
- **Bisa dihemat** "≤ Rp708.000/tahun" = YouTube 59.000 × 12, dari rating "Jarang" dan "Fungsi dobel: musik" (Spotify Family). write.financial tidak membaca aktivitas aplikasi lain.
- **Per kategori**: Hiburan 331.900/904.900 = 37% (filter). Kartu Per kategori menyebut "34%", kemungkinan karena denominator memasukkan tahunan (lihat §8).
- **Konfirmasi**: transaksi dan potongan saldo baru dibuat setelah user "Tandai sudah dibayar"/konfirmasi di Perlu ditinjau. Tagihan yang lewat tanggal tanpa konfirmasi berstatus "belum dikonfirmasi" (iCloud+ 9 Okt).
- Langganan aktif ikut mengurangi **batas aman harian** (teks empty state "memasukkannya ke batas aman harian").

## 6. Job latar/scheduler & integrasi
- **Pengingat H-N** sebelum tagihan (default 3 hari, Netflix H-1 17 Okt). Tetap berjalan walau UI gagal ("Pengingat Netflix 18 Okt tetap akan dikirim").
- **Jatuh tempo**: buat SubscriptionCharge `due_review` di Perlu ditinjau, lalu majukan next_billing_date sesuai siklus.
- **Tagihan lewat tanpa konfirmasi**: tandai `unconfirmed` dan tampilkan peringatan.
- **Cek kecukupan saldo** rekening pembayar sebelum jatuh tempo (berjalan setelah saldo berubah atau harian).
- **Akhir uji coba** → tagihan pertama.
- **Akhir jeda**: pengingat 3 hari sebelum aktif lagi, lalu otomatis aktif di resume_date.
- **Cancel after_next**: ubah status setelah tagihan terakhir.
- **Deteksi berulang** dari transaksi (batch harian/mingguan).
- **Review bulanan** tanggal 1 ("Dinilai 1 Okt · ditanya lagi 1 Nov").
- **Kurs** USD untuk estimasi (memakai job kurs yang sama dengan Rekening).

## 7. Komponen UI
KPI card, bar chart 6 bulan dengan anotasi ("+ Spotify", "ChatGPT naik"), timeline jadwal bulan dengan avatar huruf + marker "Hari ini" + legenda status, tabel langganan (Layanan/Tagihan berikutnya/Rekening/Pemakaian/Harga), tabs Aktif/Dijeda/Dibatalkan, tooltip, menu ⋮ + submenu rekening, dialog form (segmented siklus, input harga multi-currency, toggle trial, select pengingat), dropdown rekening bergrup, kartu review (rating chip), kartu insight "Bisa dihemat", donut/bar per kategori, banner peringatan (H-1, belum dikonfirmasi, saldo kurang), skeleton, error, empty state.

## 8. Pertanyaan terbuka
- Header "6 aktif" vs tab "Aktif 7" dan "Total 7 langganan aktif" (Niagahoster tahunan dihitung terpisah?). Review "6 / 7 dinilai".
- Spotify Rp86.900 (tabel) vs 87.000 (jadwal/kalender), dan Google One 26.900 vs "Rp27.000": pembulatan tampilan?
- Persentase Hiburan 34% vs 37%: denominatornya apa?
- Headspace "Tahunan dibayar bulanan": apakah perlu siklus/tipe khusus?
- Detail ChatGPT "Rp3.950.000/tahun" = 329.000 × 12 = 3.948.000 ✔, tetapi rekening di tabel Bank Jago sementara peringatan saldo menyebut OVO. Skenario ganti rekening?
- Saat siklus tahunan berbayar, apakah anggaran dibebankan sekaligus atau diamortisasi?
- Ruang lingkup "tagihan rutin" (Sewa Kos tiap tgl 1 muncul di Kalender sebagai "Tagihan rutin"): apakah Sewa disimpan sebagai Subscription atau sebagai recurring transaction?
- Trial: field tanggal akhir trial tidak terlihat eksplisit.

---

# D. Kalender (Section 08 [plVAA])

## 1. Ringkasan & tujuan user
Kalender adalah tampilan "Pengeluaran harian, pemasukan, dan tagihan terjadwal dalam satu tampilan" dengan mode Minggu/Bulan/Tahun. Isinya heatmap pengeluaran per hari, total mingguan (M1–M6), event terjadwal (langganan, gajian, setoran dana tidak rutin/tabungan), dan proyeksi untuk bulan mendatang. User bisa membuka rincian hari atau mencatat transaksi langsung di tanggal tertentu.

## 2. Daftar layar & state
| Layar | Node id | Isi/tujuan | State |
|---|---|---|---|
| Kalender (Bulan) | zEWoe | KPI (Rata-rata harian, Hari termahal, Hari hemat, Akhir pekan), grid bulan + kolom Total mingguan, ringkasan bulan, detail 11 Okt, Pola per hari | default |
| Kalender (Minggu) | qYzQD | 12–18 Okt: keluar minggu ini, pemasukan, terjadwal, batas aman sisa minggu, kolom per hari dengan transaksi per jam, komposisi | default |
| Kalender (Tahun) | Ncucu | 12 bulan dengan mini heatmap, KPI tahun, Tren bulanan + % ditabung | default |
| Pilih bulan | BLMk2 | Picker 12 bulan + pengeluaran (jt), preset Bulan ini/Bulan lalu/Rentang khusus | popover |
| Detail 1 Okt (gajian) | sYRh0 | 4 transaksi, surplus +13.650.000 | panel |
| Detail 18 Okt (terjadwal) | V0mbHr | Tagihan Netflix terjadwal, "Buka di Langganan" | panel |
| Catat di tanggal ini | q3o9L | Form transaksi dengan tanggal terisi 11 Okt | dialog |
| Tooltip tanggal | aXUNE | 9 Okt: 0,85× rata-rata, split Kebutuhan/Keinginan, terbesar | hover |
| Sembunyikan pemasukan | Z0Mxk | Hanya pengeluaran | filter |
| November (mendatang) | z6baj | Jadwal & proyeksi, 9 tagihan, gajian diperkirakan | future |
| Minggu: pilih hari | oELDK | Hari terpilih di mode minggu | selected |
| Tahun: hover bulan | cQI15 | Tooltip bulan | hover |
| Skeleton Bulan/Minggu/Tahun | CQlVn / e7PlO / F8HnZ | "Memuat kalender…" | memuat |
| Memperbarui (pindah bulan) | C1zLi | "Memuat data November 2026…" | memuat |
| Gagal memuat | tFQbo | "504 · GET /calendar/2026-10", CTA "Buka Transaksi" | error |
| Kosong | oYpYJ | "Kalender masih kosong", Catat transaksi / Tambah langganan | kosong |

## 3. Alur user
- **Bulan → Minggu → Tahun**: switch mode. Di mode Tahun, klik bulan membuka tampilan bulanan.
- **Navigasi & detail hari**: pilih bulan via picker. Klik 1 Okt (hari gajian) → rincian transaksi dengan sumber rekening, jam, tag, dan item recurring "Sewa Kos — Oktober · tiap tgl 1 · perlu konfirmasi". Klik 18 Okt (masa depan) → tagihan terjadwal + "Belum ada transaksi — pengeluaran baru tercatat saat kamu mencatatnya". Dari detail 11 Okt, pilih "Catat di tanggal ini" → form Catat Transaksi dengan "Tanggal terisi dari kalender · 11 Okt 2026, 12.00" dan konteks "11 Okt sudah 5 transaksi (Rp3.380.000)". Hover tanggal menampilkan tooltip.
- **Filter & periode**: toggle legenda (Kebutuhan/Keinginan, Pemasukan, Setoran tabungan) untuk menyembunyikan pemasukan. November menampilkan proyeksi ("Perkiraan dari pola Okt"). Di mode Minggu user memilih hari, di mode Tahun hover bulan.
- **Memuat / gagal / kosong**.

## 4. Entitas data & field
Kalender adalah **read model/agregasi**, tidak punya entitas sendiri:
- **DayCell**: date, total_expense, total_income, net (surplus), split kebutuhan/keinginan, intensity bucket (Sedikit→Banyak), tx_count, largest_merchant, ratio_vs_avg, is_weekend, scheduled_events[].
- **WeekRow**: M1..M6, expense, net, scheduled_amount ("+186.000 terjadwal").
- **ScheduledEvent** (union):
  - SubscriptionCharge ("Netflix 186.000", "pengingat 17 Okt")
  - RecurringTransaction/Tagihan rutin (Sewa Kos tiap tgl 1, perlu konfirmasi)
  - Pemasukan rutin (Gaji — PT Kinarya, "diperkirakan Rp18.500.000", BCA)
  - Transfer/setoran ("Bibit ↔ 3.000.000", "Dana tdk rutin" tgl 25, "ORI026 +7.900" kupon)
  - Tagihan kartu kredit [INFERENCE]
  
  Field: date, title, amount, kind enum `bill|income|transfer|savings|coupon`, status `scheduled|confirmed|unconfirmed`, source_id.
- **MonthSummary**: Keluar sejauh ini, Masuk, Terjadwal sisa bulan, Batas aman harian, rata-rata harian, hari termahal, hari hemat (< Rp300.000), rasio akhir pekan.
- **YearSummary**: keluar/masuk/ditabung, % ditabung per bulan, bulan termahal + event besar ("Lebaran · 18 Mar · Rp6.200.000 · tiket mudik"), surplus months.
- Transaction (dari modul Transaksi): tanggal+jam, merchant, kategori, rekening, tag ("#gadget · kerja"), catatan, foto struk, "Ulangi setiap bulan".

## 5. Aturan bisnis & perhitungan
- **Rata-rata harian** = keluar ÷ hari berjalan: 16.500.000 ÷ 15 = **1.100.000** ✔.
- **Hari termahal**: 11 Okt 3.380.000 → "3× rata-rata" (3,07). Tooltip 9 Okt 940.000/1.100.000 = **0,85×** ✔.
- **Hari hemat** = jumlah hari dengan pengeluaran < Rp300.000 ("3 hari").
- **Akhir pekan** = rata-rata Sab–Min ÷ rata-rata Sen–Jum = "2,8×" (Rp1.550.000/hari akhir pekan). Pola per hari: rata-rata per weekday (Sen 860.000 … Min 1.900.000).
- **Surplus hari** = masuk − keluar: 1 Okt 18.500.000 − 4.500.000 − 250.000 − 100.000 = **+13.650.000** ✔.
- **Total mingguan**: M1 keluar 6.360.000 / net +12.100.000; M3 keluar 1.650.000 + "+186.000 terjadwal".
- **Terjadwal sisa bulan** = 660.900 (sama dengan Langganan). Batas aman harian 140.000 (dari Anggaran).
- **Mode Minggu**: "Batas aman sisa minggu" = 140.000 × 3 hari = **420.000** ✔. "vs Sen–Kam lalu −26%" membandingkan 1.650.000 dengan 5–8 Okt 2.410.000 (≈ −31,5%; tidak cocok, lihat §8). Transaksi dalam kolom hari diurutkan berdasarkan jam. Transfer (Ke Bibit RDPU Rp3.000.000) dipisah dari pengeluaran.
- **Mode Tahun**: Ditabung = masuk − keluar = 262.500.000 − 187.700.000 = **74.800.000** ✔; 74,8 ÷ 262,5 = **28,5%** ✔. Rata-rata 187,7jt ÷ 10 ≈ 18,8jt/bulan ✔. Hijau = bulan surplus.
- **Bulan mendatang**: tampilkan jadwal + proyeksi ("Masuk (proyeksi) +Rp18.500.000", "9 tagihan · Rp5.400.000 + transfer Rp3.870.000"). 1 Nov net = 18.500.000 − 4.500.000 = +14.000.000 ✔. Proyeksi pemasukan diambil dari pola Okt. Tagihan tetap ditampilkan walau anggaran Nov belum diatur ("atur anggaran dulu").
- Pengeluaran baru tercatat hanya setelah dicatat atau dikonfirmasi user. Event terjadwal tidak memengaruhi saldo.
- Form Catat: tag maksimal 5, quick amount +10.000/+50.000/+100.000/+500.000, jam default 12.00 bila dibuat dari kalender.

## 6. Job latar/scheduler & integrasi
Kalender tidak punya job sendiri. Ia membaca jadwal yang dihasilkan modul lain:
- materialisasi tagihan langganan, recurring transaction (Sewa, Gaji), dan setoran dana tidak rutin/tabungan untuk N bulan ke depan [INFERENCE: atau dihitung on-the-fly dari aturan RRULE];
- **proyeksi gajian** dari pola bulan lalu.

Agregat harian/bulanan/tahunan bisa di-cache (materialized view atau Redis) dan diinvalidasi saat transaksi berubah [INFERENCE].

## 7. Komponen UI
Segmented Minggu/Bulan/Tahun, month picker popover dengan preset, heatmap calendar grid + kolom total mingguan, legenda filter (toggle kategori), chip event terjadwal pada sel, tooltip hari, panel detail hari (ringkasan kategori + list transaksi + CTA), kolom minggu per hari, mini heatmap bulan (mode tahun), chart tren pemasukan vs pengeluaran + % ditabung, bar pola per hari, KPI cards, form Catat Transaksi (komponen bersama dengan Transaksi), skeleton per mode, error, empty state.

## 8. Pertanyaan terbuka
- "rata-rata Rp448.000" untuk 4 hari dengan total 1.650.000 (seharusnya 412.500), dan "−26%" vs hasil hitung −31,5%: pakai rumus apa?
- Picker bulan menulis Okt "16,5" (jt) sebagai pengeluaran berjalan, sementara mode Tahun menampilkan Oktober "berjalan" tanpa angka.
- Minggu dimulai Senin (header "Sen … Min"): apakah bisa diatur?
- Event apa saja yang wajib muncul: kartu kredit (cetak/tempo), cicilan utang, setoran tabungan? Legenda menyebut "Setoran tabungan". Hari "25 · Dana tdk rutin" ada tetapi nominal "Rp0" untuk M4.
- "+146.000 terjadwal" di M4 = Spotify 87.000 + YouTube 59.000 ✔. Dana tidak rutin tgl 25 tidak dihitung, apakah karena dianggap transfer?
- "Ulangi setiap bulan" di form Catat: apakah membuat recurring transaction yang sama dengan "Tagihan rutin"?
- Zona waktu dan batas hari (WIB) untuk agregasi harian.
