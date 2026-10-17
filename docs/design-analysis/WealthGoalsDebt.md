# Analisis: Investasi (09), Tabungan (13), Utang & Cicilan (18)

Sumber: `/tmp/digest/09-investasi.md`, `13-tabungan.md`, `18-utang-cicilan.md`. Angka contoh diambil dari desain. Persona: "Avtara K.", tanggal acuan 15–17 Okt 2026.

---

# A. Investasi (Section 09, [yEYn8])

## 1. Ringkasan & tujuan user
Pengguna mencatat portofolio di banyak platform (Gotrade, Indodax, Stockbit, Bibit, Pluang) **secara manual**, yaitu unit dan harga beli. Harga pasar dan kurs USD diperbarui otomatis lewat API ("Harga diambil dari penyedia data · transaksi tetap manual"; "Tidak menghubungkan akun broker"). Tujuannya: melihat nilai portofolio dalam IDR atau USD, modal, untung/rugi (belum terealisasi dan terealisasi), dividen, alokasi per kelas aset vs target (drift dan rebalancing), serta mengalokasikan aset ke tujuan tabungan.

## 2. Daftar layar & state
| Layar | Node | Isi/tujuan | State |
|---|---|---|---|
| write.financial — Investasi | bgmSP | Header (11 posisi · 5 platform · kurs USD Rp16.350 · harga 16.42 WIB), KPI, grafik pertumbuhan, alokasi aset, tabel Kepemilikan, kalkulator rebalancing, dividen, "Tempat aset disimpan" | default (IDR) |
| Mode USD | JBGq7 | Semua nilai dalam USD ("ditampilkan dalam USD · kurs Rp16.350", US$3.757 ≈ Rp61.420.000), rebalancing "Acuan USD" | toggle |
| Menyinkronkan harga | SNpaj | "Sinkron 3/5…", "Memperbarui harga pasar" | memuat (sync) |
| Gagal sinkron | TZxs4 | "1 platform gagal · Harga Stockbit belum diperbarui · BBCA, BBRI, TLKM memakai harga 16.15", "Coba lagi" | error parsial |
| Hover grafik | XZruO | Tooltip "Akhir September 2026 · Rp57.700.000 · Modal disetor Rp50.900.000 · +Rp6.800.000 +13,4% · Setoran bulan ini +Rp3.000.000 · vs Agustus +Rp4.200.000 (+7,9%)" | hover |
| Cari: yield | T9yDX | "5 hasil untuk “yield”", total hasil Rp3.100.000 −9,3% | pencarian |
| Kelompok: kelas aset | n6Wcnt | Tabel per kelas: "4 posisi · Rp31.220.000 · 51% · target 51%" | grouping |
| Kelompok: platform | p9ExJx | Per platform: "8 posisi · USD · 74% portofolio" | grouping |
| US individual dibuka | YNG6S | Kategori dibuka: NVDA, MSFT, AAPL, GOOGL, AMZN. Insight YieldMax "total return +6,2%" | expanded |
| Menu ⋮ aset | zxtp9 | Beli lagi, Jual, Catat dividen, Sesuaikan kepemilikan…, Ubah target alokasi (25%), Pindah ke kategori…, Atur alokasi ke tujuan…, Ubah detail aset…, Lihat detail, Hapus aset | menu |
| Detail aset: SPY | CtiSh / DZkbW | Unit, harga sekarang/rata-rata, modal, P/L, porsi vs target, alokasi ke tujuan, riwayat beli DCA, dividen | panel |
| Detail SPY — ubah alokasi | Oi44y | Mode edit alokasi ke tujuan | edit |
| Catat beli | KDF13 | Form Beli/Jual/Dividen/Top-up kas, pratinjau dampak | dialog |
| Catat jual | JejMv | Jual senilai Rp, cepat 25%/50%, hasil ke saldo IDR atau tarik ke bank, untung terealisasi | dialog |
| Atur target alokasi | w1jn3J | Target % per kelas, validasi total 101% | dialog + error validasi |
| Klik platform: Gotrade | CWLga | Filter "8 posisi di Gotrade · termasuk kas US$52 · Kas & detail di Rekening" | filter |
| Skeleton | wnYAv | "Memuat portofolio…" | memuat |
| Memperbarui data | FKPat | "Memperbarui portofolio…" | refresh |
| Harga pasar gagal diambil | KR0zN | "Yahoo Finance & CoinGecko tidak merespons… harga terakhir 16.42", "Buka log API · 429 · CoinGecko · retry-after 30 dtk" | error total |
| Pindah QQQ ke kategori | hP70H | Picker kategori "Daftar saya" | dialog |
| QQQ sudah dipindah | ZeE7F | Toast "QQQ dipindah ke US individual… Urungkan" | sukses + undo |
| Kelola kategori | MeRlb | Urutkan (drag), daftar kategori + aset tunggal | dialog |
| Ubah kategori YieldMax | OgLFo | Nama, kelas aset, pilih aset (maks. 1 kategori per aset) | dialog |
| Hapus kategori | C2WmM | "Kategorinya saja yang dihapus…" | konfirmasi |
| Sesuaikan kepemilikan (lebih) | j2SH8r | Unit tercatat 1,197 vs di Gotrade 1,215, pilih sebab | dialog |
| Sesuaikan kepemilikan (kurang) | oExkI | 1,150 → catat jual / koreksi | dialog |
| Ubah detail aset SGOV | aW8Nv | Ticker, nama, mata uang, kelas aset + pratinjau drift | dialog |
| Kosong | avPzM | "Belum ada portofolio", CTA "Tambah aset", "Atur API harga" | kosong |
| Jual SPY dipakai 2 tujuan | LcuPZ (sec 13) | Jual aset yang dialokasikan ke tujuan | dialog |

## 3. Alur user
- **Header & grafik**: toggle IDR↔USD → klik "Sinkronkan" → progres per platform (3/5) → bisa gagal sebagian (Stockbit tetap memakai harga 16.15) → "Coba lagi". Hover grafik menampilkan nilai akhir bulan, modal, untung, setoran bulan itu, dan selisih vs bulan lalu. Rentang: 1B · 3B · YTD · 1T · Semua.
- **Kepemilikan**: cari ticker/nama → ganti pengelompokan (Daftar saya / Kelas aset / Platform) → buka kategori → menu ⋮ → Lihat detail.
- **Aksi**: Catat Transaksi Investasi (Beli: pilih aset, jumlah US$ atau unit, bayar dari kas platform, biaya admin, pajak, kurs → pratinjau porsi dan sisa kas → Simpan beli). Jual: nilai atau % posisi → hasil ke saldo IDR platform atau tarik ke rekening bank → untung terealisasi. Atur target per kelas. Klik platform untuk memfilter.
- **Komposisi (1)**: Detail SPY → "DIALOKASIKAN KE TUJUAN · Ubah" → ubah %. Menu ⋮ → Pindah ke kategori → toast + Urungkan.
- **Komposisi (2)**: Kelola kategori (urutkan) → Ubah kategori (nama, kelas aset, anggota) → Hapus kategori (aset jadi aset tunggal).
- **Komposisi (3)**: Sesuaikan kepemilikan. Jika unit **lebih**, pilih sebab: pembelian belum dicatat (membuat transaksi Beli, modal naik), DRIP (dicatat dividen, modal tetap), atau koreksi tanpa modal. Jika unit **kurang**: "Catat sebagai penjualan" (lanjut ke Catat jual) atau "Koreksi salah input" (modal dikurangi proporsional). Lalu Ubah kelas aset dengan pratinjau dampak drift.
- **Kosong**: Tambah aset / Atur API harga (di Pengaturan).

## 4. Entitas data & field
- **InvestmentPlatform**: nama (Gotrade, Indodax, Stockbit, Bibit, Pluang), mata uang (USD/IDR), saldo kas (Kas USD US$52 / Saldo IDR Indodax), `lastSyncedAt` per platform ("sinkron 16.40", "16.15"), status sinkron. [INFERENCE] Platform adalah tipe *Rekening* (lihat "12 rekening · … 5 platform investasi"; "Kas & detail di Rekening").
- **Asset/Holding**: ticker (SPY, QQQ, VEA, SCHD, VWO, SGOV, BTC, XAU, BBCA, BBRI, TLKM, IDX30, ORI026, MSTY, NVDY, TSLY, CONY, NVDA, MSFT, AAPL, GOOGL, AMZN), nama, platformId, mata uang kuotasi (enum USD/IDR), kelas aset (enum: Saham AS, Internasional, Indonesia, Kripto, Kas & SGOV, Emas, Income), kategoriId nullable, unit (desimal presisi tinggi, mis. 0,0725 atau 1,197; kripto lebih banyak), harga rata-rata (US$582,45, desimal di mata uang asli), modal IDR (Rp11.400.000, bigint), metadata kupon (ORI "kupon 6,3%"), jadwal dividen ("tiap kuartal (Mar, Jun, Sep, Des) · berikutnya ±19 Des"), DCA ("DCA tiap tgl 1").
- **AssetCategory** ("Daftar saya"): nama, kelas aset (dipakai untuk target), urutan, anggota (satu aset hanya boleh di satu kategori).
- **InvestmentTransaction**: tipe enum (Beli, Jual, Dividen, Top-up kas, Penyesuaian/koreksi, DRIP), tanggal-waktu ("15 Okt, 19.50"), unit, harga per unit (mata uang asli), jumlah, biaya admin, pajak, kurs (Rp16.350), total keluar/diterima, sumber/tujuan kas (kas platform atau rekening bank), label DCA, untung terealisasi (hasil turunan). Juga membuat entri buku kas platform: "Pembelian SPY −US$50,00 · Biaya keuangan −US$0,15 · −US$0,02".
- **Dividend**: tanggal, aset, jumlah bersih, pajak ("pajak Rp20.000", "pajak final"), disposisi enum (Dibelikan aset (manual) / Masih di kas / Masuk ke BCA).
- **AllocationTarget**: kelas aset → target % (51/12/7/8/5/5…). Per aset ada juga target (SPY "target 25%", skala 0–40%).
- **GoalAllocation** (aset→tujuan): assetId, goalId, persentase (DP Rumah 60%, Dana Pensiun 40%), unit turunan (0,718 / 0,479), flag "ikut DCA". Lihat bagian Tabungan.
- **PriceQuote**: assetId/symbol, harga, mata uang, sumber (Yahoo Finance, CoinGecko, + IDX/reksa dana [INFERENCE]), fetchedAt, perubahan harian (+0,60%).
- **FxRate**: USD/IDR 16.350, fetchedAt.
- **PortfolioSnapshot** (bulanan, untuk grafik): nilai akhir bulan (28,5 … 61,4 juta), modal disetor, setoran bulan itu.
- **HoldingAdjustment** (riwayat koreksi): unit sebelum/sesudah, sebab, dampak modal ("Riwayat koreksi tersimpan di Detail aset").
- **ApiLog**: provider, kode HTTP (429), retry-after ("Buka log API").

Uang IDR disimpan sebagai bigint rupiah. USD sebagai bigint sen. Unit dan harga sebagai numeric presisi tinggi.

## 5. Aturan bisnis & perhitungan
- **Nilai posisi** = unit × harga terakhir (mata uang asli) × kurs → IDR. SPY: 1,197 × US$690,10 = US$826,05 (≈ US$825,69 di tabel) × 16.350 ≈ Rp13.500.000.
- **Modal** = Σ biaya beli (IDR pada kurs saat transaksi) − bagian yang dijual. SPY: 1,197 × US$582,45 ≈ US$697 → Rp11.400.000. Total modal Rp53.931.000.
- **Untung belum terealisasi** = nilai − modal. Portofolio: 61.420.000 − 53.931.000 = +Rp7.489.000 (+13,9% = 7,489/53,931). SPY +Rp2.100.000 (+18,4%) atau +US$128,44.
- **Untung terealisasi** dari Jual: BTC jual Rp1.200.000 → "Untung terealisasi +Rp352.000" (hasil − modal proporsional; metode biaya rata-rata [INFERENCE], karena yang ditampilkan "Harga rata-rata"). Kolom Realized total +Rp1.476.700.
- **Diterima** = jual − biaya admin − pajak: 1.200.000 − 3.500 − 1.200 = Rp1.195.300.
- **Beli**: unit = jumlah ÷ harga: 50 / 690,10 = 0,0725. Total keluar = 50 + 0,15 + 0,02 = US$50,17 × 16.350 = Rp820.280. Kas US$52,00 → US$1,83 (52 − 50,17).
- **Hari ini** = Σ unit × (harga sekarang − penutupan kemarin): +Rp312.000 (+0,51%).
- **Dividen 12 bulan** bersih Rp2.640.000. **Yield** = 2,64 / 61,42 = 4,3%. Yield per aset: SPY US$5,10 · yield 1,2%.
- **Total return** = untung harga + distribusi diterima: YieldMax "Harga turun −9,3%, tapi dengan distribusi Rp530.000… total return +6,2%".
- **Porsi** = nilai aset / total portofolio (SPY 22,0%). **Drift portofolio** = Σ|porsi − target| / 2. Contoh: (0,8+1,0+0,6+2,0+0,4+0,3+1,1)/2 = 3,1% ✓.
- **Rebalancing** (kalkulator, "tidak membuat transaksi"): kekurangan per aset = target% × (total + dana tambahan) − nilai. SPY: 25% × US$3.756,57 ≈ US$939 − 825,69 ≈ "+US$113,76". Hasil total "Beli Rp3.650.000 · jual Rp3.650.000 · Drift jadi 0%". Bisa memakai acuan Rupiah atau USD.
- **Validasi target**: total harus 100%. Jika "Total 101%", tampil "Total target lebih 1% · Ambil 1% dari Saham AS".
- **Kategori** hanya untuk pengelompokan: "Nilai & transaksi tidak berubah". Kelas aset kategori dipakai untuk target. Mengubah kelas aset satu aset menggeser porsi dan drift (SGOV ke Income: 7,0%→1,4%, 5,0%→10,6%, drift 3,1%→6,6%).
- **Sesuaikan kepemilikan**: selisih unit × harga × kurs = 0,018 × 690,10 × 16.350 ≈ Rp203.000. Dampak dibagi ke tujuan sesuai alokasi (DP 60% +Rp122.000, Pensiun 40% +Rp81.000). Untuk unit kurang yang dipakai 2 tujuan, user harus memilih tujuan yang berkurang (default proporsional −Rp318.000/−Rp212.000).
- **DCA** ke aset yang teralokasi: unit baru otomatis dibagi sesuai % tujuan ("ikut DCA"; "Pembelian SPY baru (DCA) otomatis dibagi 60/40").
- **Grafik**: nilai akhir bulan vs modal disetor. Return YTD dibandingkan dengan benchmark (Portofolio +11,2% · SPY +14,8% · IHSG +3,1%), jadi butuh harga indeks benchmark.
- **Peringatan konsentrasi**: "74% aset ada di satu platform. Pertimbangkan batas perlindungan dan risiko akun." [INFERENCE] dipicu ambang tertentu (>50%?).
- **Harga basi**: kalau sinkron gagal, valuasi memakai harga terakhir beserta cap waktunya (16.15 / 16.42) dan tetap tampil.

## 6. Job latar/scheduler & integrasi
- **Sinkronisasi harga pasar** (manual lewat "Sinkronkan" + periodik [INFERENCE]): per provider/platform. Yahoo Finance (saham/ETF AS dan IDX), CoinGecko (BTC), plus sumber untuk emas (XAU Pluang), NAB reksa dana (Bibit IDX30/RDPU "NAB 16 Okt") dan SBN. Progres per platform (3/5), status per platform, penanganan 429 dengan retry-after (30 dtk), log API. Antrean BullMQ dengan backoff per provider.
- **Sinkronisasi kurs USD/IDR** (Rp16.350). Dipakai untuk valuasi, mode USD, dan kurs default di form ("harga & kurs terisi dari data pasar terakhir").
- **Snapshot portofolio akhir bulan** untuk grafik (nilai, modal, setoran) dan snapshot harian untuk "Hari ini" dan YTD.
- **Benchmark** SPY dan IHSG untuk return YTD.
- **DCA terjadwal** "tiap tgl 1": [INFERENCE] membuat transaksi/pengingat untuk dikonfirmasi (Tabungan menampilkan "Top-up Gotrade — DCA · BCA · SPY Rp4.000.000 & SCHD Rp2.000.000 · Rp6.000.000" sebagai setoran). Riwayat menunjukkan DCA tercatat dengan harga hari itu (0,356 unit @ US$686,20).
- **Perkiraan dividen** ("berikutnya ±19 Des"): [INFERENCE] pengingat atau kalender, tanpa pencatatan otomatis.
- API key harga dikonfigurasi di Pengaturan ("Atur API harga").

## 7. Komponen UI
App shell (sidebar MENU, ⌘K, ⌘J), segmented toggle IDR/USD, tombol Sinkronkan dengan status, KPI card, area chart bertumpuk (modal vs keuntungan) dengan range tabs dan tooltip, bar drift alokasi (±poin), tabel kepemilikan grup/expandable dengan badge tujuan ("DP Rumah 60% · Pensiun 40%"), search, segmented grouping, menu ⋮, side panel detail aset, slider/skala porsi vs target, dialog form transaksi dengan tab (Beli/Jual/Dividen/Top-up kas) dan pratinjau "SETELAH DISIMPAN", chip cepat 25%/50%, picker rekening, input % dengan validasi total, list drag-to-reorder, toast dengan Urungkan, banner error dengan "Coba lagi"/"Buka log API", skeleton, empty state.

## 8. Pertanyaan terbuka
- Metode biaya: rata-rata atau FIFO? (desain hanya memperlihatkan "Harga rata-rata").
- Modal IDR untuk aset USD: memakai kurs historis per transaksi atau kurs saat ini? P/L kurs dipisah? (Tabungan menampilkan "Perubahan harga & kurs" terpisah.)
- Frekuensi sinkron otomatis dan provider untuk IDX, reksa dana, emas, dan SBN tidak dijelaskan (hanya Yahoo Finance & CoinGecko yang disebut).
- "data tetap di perangkatmu" bertentangan dengan arsitektur server (Postgres di VPS). Perlu klarifikasi copy.
- Jumlah aset tidak konsisten: "3 kategori berisi 14 aset" vs "15 aset" setelah QQQ dipindah, dan header "11 posisi" vs ±22 ticker.
- Apakah DCA otomatis membuat transaksi Beli, atau hanya transfer Top-up yang dikonfirmasi lalu Beli dicatat manual?
- Apakah ada target per aset (SPY 25%) selain target per kelas, dan bagaimana keduanya berinteraksi?

---

# B. Tabungan / Tujuan (Section 13, [EICCD])

## 1. Ringkasan & tujuan user
Pengguna membuat tujuan tabungan (target, tenggat, rekening penyimpanan, setoran rutin) yang **terhubung ke transaksi**. Setoran dan penarikan dicatat sebagai Transfer berlabel (#dana-darurat), bukan pengeluaran. Progres dihitung dari saldo rekening, transaksi berlabel, dan alokasi aset investasi pada nilai pasar. Uang tidak dipindah, hanya dialokasikan.

## 2. Daftar layar & state
| Layar | Node | Isi/tujuan | State |
|---|---|---|---|
| write.financial — Tabungan | qm7zi | KPI (Total terkumpul Rp39.725.000 · Rp22.400.000 di investasi; Setoran Oktober Rp3.500.000 dari rencana Rp4.650.000; Dana darurat 0,6 bulan), kartu 6 tujuan, timeline setoran rutin Okt, grafik "Ditabung per bulan" | default |
| Urutkan | JdZkw | Progres tertinggi/Sisa terbesar/Nama A–Z; Tampilkan dana tidak rutin; Kelompokkan per rekening | dropdown |
| Menu ⋮ Dana Darurat | D3nEd | Lihat detail, Setor manual (S), Tarik dana, Ubah setoran rutin, Jeda setoran rutin, Tandai selesai, Hapus tujuan | menu |
| Pilih bulan | WlXzb | Month picker 2026, "Angka = total ditabung per bulan" | popover |
| Tooltip grafik Okt | K53KpY | "Total Rp9.500.000 · 36,5% dari pemasukan" | hover |
| Tujuan baru | q0jRa | Form: nama, ikon & warna, target, tenggat, rekening, setoran rutin | dialog |
| Tujuan baru: pilih rekening | IsSRI | Daftar rekening (Bank/E-wallet) dan saldonya | dropdown |
| Setor manual | PCgK1 | Jumlah (chip 500.000/3.500.000 "Sisa bulan ini"), dari/ke, tanggal, catatan, pratinjau progres & estimasi | dialog |
| Setoran tercatat | vvQtO | Toast "Transfer BCA Tahapan → Bank Jago dibuat di Transaksi · Lihat" | sukses |
| Tarik dana | nVb1Q | Konfirmasi: progres 21%→17%, ketahanan 0,6→0,5, estimasi Nov→Des 2027 | konfirmasi |
| Detail Dana Darurat | q9T3oQ | Disimpan di (Kantong darurat 73% + RDPU "Diproses · NAB 16 Okt"), setoran rutin, riwayat dari transaksi | panel |
| Tab Selesai | QI76x | "Terbaru selesai" | tab |
| Setor terakhir STNK | biM3a | Chip "Pas target 170.000", "Tercapai setelah setoran ini" | dialog |
| STNK tercapai | rbvBr | "4 bulan lebih cepat", Hentikan setoran rutin / Lanjutkan sebagai cadangan, "Nanti saja / Tandai selesai" | dialog |
| Tab Selesai: STNK | JJuvW | Toast "setoran rutin Rp43.000 dihentikan · Urungkan", Aktif 5 · Selesai 2 | sukses |
| Bayar dari tujuan | itVPf | Catat pengeluaran Rp812.000 dengan toggle "Bayar dari tujuan Perpanjang STNK" | dialog |
| Terpakai, ada sisa | O4YIh2 | Kartu tujuan berstatus terpakai dengan sisa | state |
| Pindahkan sisa Rp38.000 | m535GI | Pilih tujuan lain (Servis motor 60%→63%, Liburan 35%→35%) atau "Lepas jadi saldo bebas" | dialog |
| Sisa dipindah | NsuNu | Toast + Urungkan | sukses |
| Kosong | a2uUH | Empty + template (Dana darurat ±Rp54.000.000, Liburan, Jangka panjang, Gadget), "Impor dari Anggaran" | kosong |
| Skeleton | f33cdP | "Memuat tabungan…" | memuat |
| Memperbarui (September) | OT6vQ | "Memuat data September 2026…" | refresh |
| Saldo disembunyikan | uYQwR | Rp•••••• , "Intip saldo ⌘ ." | privasi |
| Mode terang | hsxsB | Tema terang | tema |
| Gagal memuat | Dr2U1 | "harga investasi (SPY, SCHD, IDX30) belum tersedia… 502 · GET /goals?valuation=market", "Lihat saldo rekening saja" | error |
| Catat Transfer — pilih tujuan | aPqfw | Quick-add di Ringkasan: transfer ke tujuan | dialog |
| Terhubung ke Dana Darurat | Iia40 | Transfer tertaut ke tujuan | sukses |
| Transaksi — transfer ke tabungan | UEi5W | Halaman Transaksi terfilter (dari "Buka") | navigasi |
| Detail DP Rumah (campuran) | DeE0u | 3 sumber: SPY 60% Rp8.100.000, Bibit IDX30 Rp1.000.000, BCA nominal tetap Rp5.000.000; atribusi Oktober | panel |
| Atur sumber dana | UpO8Q / B2aDS7 / kcC3y | Mode alokasi: Persentase / Seluruh aset / Nominal tetap; Tambah sumber | dialog |
| Melebihi 100% | QCbeZ | "Melebihi 100% — Dana Pensiun sudah memakai 40%. Maks. 60%" | error validasi |
| Jual SPY dipakai 2 tujuan | LcuPZ | Jual aset yang teralokasi, pilih tujuan yang dikurangi | dialog |
| Saldo rekening terpakai & harga turun | F6SPeB | Banner "Belanja dari Bank Jago mengurangi Dana Darurat" (Servis AC Rp450.000 → Rp10.675.000), "SPY turun 3,1%: DP Rumah −Rp251.000, Dana Pensiun −Rp167.000" | peringatan |
| Catat Pengeluaran — rekening dialokasikan | BGCD8 | Peringatan saat memilih rekening yang terkunci untuk tujuan | peringatan |

## 3. Alur user
- **Dropdown & menu**: urutkan atau atur tampilan → menu ⋮ tujuan → pilih bulan (memuat ulang periode) → tooltip grafik.
- **Tujuan baru & setoran**: Tujuan baru → isi (Laptop kerja baru, Rp18.000.000, Juni 2027, rekening, setoran Rp2.250.000 tiap tgl 25 dari BCA Tahapan → "8× setoran (Nov 2026 – Jun 2027) · label #laptop-kerja") → pilih rekening → Buat. Setor manual → toast + transfer dibuat. Tarik dana → konfirmasi → Transfer balik.
- **Detail tujuan**: panel Dana Darurat → riwayat setoran dari Transaksi ("Buka di Transaksi") → tab Selesai.
- **Tujuan tercapai**: setor terakhir "Pas target" → dialog tercapai (hentikan setoran rutin atau lanjutkan sebagai cadangan) → Tandai selesai → pindah ke tab Selesai + Urungkan.
- **Pakai untuk tujuan**: Catat Pengeluaran Rp812.000 dari Bank Jago dengan toggle "Bayar dari tujuan" → tujuan berstatus *Terpakai* → Pindahkan sisa Rp38.000 ke tujuan lain atau lepas jadi saldo bebas → toast.
- **Terhubung ke transaksi**: Catat Transfer di Ringkasan → pilih tujuan → tertaut (label otomatis).
- **Sumber dana campuran**: Detail DP Rumah → Atur sumber → pilih mode (Persentase/Seluruh aset/Nominal tetap) → Tambah sumber → validasi >100% → menjual SPY meminta pilihan tujuan → transaksi belanja dari rekening teralokasi memunculkan banner "Ganti rekening transaksi / Tetap kurangi".
- **State**: kosong (template / Impor dari Anggaran), skeleton, memperbarui, saldo disembunyikan, mode terang, gagal memuat (502 valuasi pasar).

## 4. Entitas data & field
- **Goal**: nama, ikon, warna, target (bigint IDR), tenggat (bulan-tahun: "Juni 2027", "2030"), jenis/target dinamis ("Target 3× pengeluaran bulanan" untuk Dana Darurat), label/tag (#dana-darurat), status enum (aktif, selesai/tercapai, terpakai, dijeda [INFERENCE dari "Jeda setoran rutin"]), dibuat ("dibuat Agu 2026"), flag "dana tidak rutin" (grup Liburan/Servis/STNK), mode valuasi (tetap vs "Nilai pasar"), flag "Lanjutkan sebagai cadangan" (boleh melebihi target).
- **GoalFundingSource**: goalId, tipe enum (rekening | aset investasi), refId, mode enum (Persentase | Seluruh aset | Nominal tetap), nilai (% atau bigint), "ikut DCA". Batasan: Σ% per aset ≤ 100% lintas tujuan. Nominal tetap rekening ≤ saldo bebas ("Rp4.200.000 dipakai dana tidak rutin · bebas Rp33.610.000").
- **Sub-kantong/penyimpanan**: "Kantong darurat" (sub-rekening Bank Jago), "Bibit RDPU". [INFERENCE] Pocket adalah rekening anak atau aset.
- **RecurringContribution**: goalId, jumlah/bulan, tanggal (tgl 1, 14, 25), dari rekening → ke rekening/pocket, butuh konfirmasi ("perlu konfirmasi"; "masuk Perlu ditinjau tiap jatuh tempo, lalu tercatat sebagai Transfer"), status aktif/jeda/berhenti. Satu tujuan bisa punya beberapa setoran (Dana Darurat: Rp500.000 tgl 1 + Rp3.000.000 tgl 14). Bisa digabung ("Sisihkan dana tidak rutin · Liburan, Servis motor, STNK · Rp1.150.000").
- **Transaction** (milik Transaksi) dengan field `goalId`/tag; tipe Transfer ("Tidak dihitung pengeluaran"), catatan, tanggal. Pengeluaran bisa memiliki `paidFromGoalId` ("Pakai dana tujuan").
- **GoalEvent/riwayat**: saldo awal ("Saldo awal Rp5.125.000 (Agu) + 4 setoran"), setoran, tarik, pindah sisa, tandai selesai (dengan undo).
- **MonthlySavingsAggregate**: total ditabung per bulan (6,3/5,4/3,9/8,0/7,5/9,5 juta), persen dari pemasukan.

## 5. Aturan bisnis & perhitungan
- **Progres** = terkumpul / target. Dana Darurat 11.125.000 / 54.000.000 = 21%. Terkumpul = porsi saldo rekening yang dialokasikan + aset (8.125.000 Kantong + 3.000.000 RDPU).
- **Total terkumpul** = Σ tujuan: 11,125 + 2,8 + 0,72 + 0,68 + 14,1 + 10,3 = Rp39.725.000 ✓. Bagian investasi Rp22.400.000 = SPY 8,1 + IDX30 1,0 + SPY 5,4 + SCHD 4,9 + RDPU 3,0 ✓.
- **Tujuan berbasis investasi** = Σ (unit teralokasi × harga × kurs) + nominal tetap. DP Rumah = 8.100.000 + 1.000.000 + 5.000.000 = Rp14.100.000. Dana Pensiun = 5.400.000 + 4.900.000 = Rp10.300.000. Nilainya berubah ikut pasar (SPY −3,1% → DP −Rp251.000, Pensiun −Rp167.000).
- **Atribusi bulanan** (DP Rumah Okt): setoran (60% × DCA Rp4.000.000 = +Rp2.400.000) + perubahan harga & kurs (+Rp186.000). Untung belum terealisasi bagian tujuan +Rp1.260.000 (= 60% × 2.100.000 ✓).
- **Dana darurat (bulan)** = terkumpul / pengeluaran bulanan. Target 3× ≈ Rp54.000.000, jadi pengeluaran ≈ Rp18.000.000/bulan; 11,125/18 = 0,6. Setelah setor +1jt menjadi 12,125/18 ≈ 0,67 (desain: "0,5 bulan"/"selesai" pada layar setoran tercatat; lihat pertanyaan). Tarik 2jt: 9,125/18 = 0,5 ✓.
- **Setoran/bulan dari target** = (target − terkumpul) / sisa bulan sampai tenggat: 18.000.000 / 8 = Rp2.250.000 (Nov 2026–Jun 2027).
- **Estimasi tercapai** = sekarang + ceil(sisa / setoran rutin per bulan). Setor 1jt menggeser Nov 2027 → Okt 2027; tarik 2jt menggeser ke Des 2027. Status "Sesuai rencana / Hampir tercapai / 2 bulan lagi".
- **Setoran Oktober vs rencana**: Rp3.500.000 dari Rp4.650.000 (500.000 + 3.000.000 + 1.150.000 ✓); sisa tgl 25.
- **Ditabung per bulan** = Σ transfer ke tujuan + investasi. Okt Rp9.500.000 = 36,5% dari pemasukan Rp26.000.000 (sama dengan saving rate).
- **Tercapai lebih cepat**: "4 bulan lebih cepat dari rencana Feb 2027" (Okt vs Feb). Hentikan setoran menurunkan rencana bulanan Rp43.000.
- **Bayar dari tujuan**: tujuan ditandai *Terpakai* (bukan dihitung mundur). Sisa = 850.000 − 812.000 = Rp38.000, bisa dipindah ke tujuan lain atau dilepas.
- **Rekening yang dialokasikan**: pengeluaran dari rekening yang seluruhnya teralokasi mengurangi tujuan (Servis AC Rp450.000: 11.125.000 → 10.675.000). Pengguna bisa ganti rekening atau tetap mengurangi.
- **Saldo bebas rekening** = saldo − Σ alokasi nominal tujuan (Saldo tersedia Rp55.023.000, "Rp17.300.000 dialokasikan ke tabungan · bebas Rp37.700.000").
- **Validasi alokasi aset**: Σ% semua tujuan per aset ≤ 100% ("Maks. 60%"). Jual aset teralokasi → user memilih tujuan yang dikurangi. DCA baru dibagi otomatis sesuai %.
- **Template Dana darurat** = 3× pengeluaran bulanan ("±Rp54.000.000").

## 6. Job latar/scheduler & integrasi
- **Setoran rutin jatuh tempo** (tgl 1/14/25): job harian membuat item "Perlu ditinjau" (transaksi terjadwal menunggu konfirmasi), lalu dicatat sebagai Transfer setelah dikonfirmasi. Tampil di timeline ("terjadwal" vs "Tercatat") dan Kalender ("Setoran tabungan", "Dana tdk rutin" di tgl 24/25).
- **Valuasi pasar tujuan** bergantung pada job harga/kurs Investasi. Kalau harga belum tersedia → error 502 `GET /goals?valuation=market` dengan fallback "Lihat saldo rekening saja".
- **Notifikasi/banner** penurunan harga ("SPY turun 3,1% hari ini") dan tujuan hampir/sudah tercapai [INFERENCE untuk push].
- **Status RDPU "Diproses · NAB 16 Okt"**: menunggu NAB reksa dana (sinkron harga NAB).
- **Agregat bulanan** "Ditabung per bulan" (bisa dihitung on-the-fly atau sebagai rollup periode).
- Basis pengeluaran bulanan untuk target dana darurat (dari data Transaksi).

## 7. Komponen UI
KPI card, kartu tujuan dengan progress bar, badge status, chip sumber ("SPY 60% · IDX30 · BCA Rp5.000.000"), tab Aktif/Selesai dengan counter, dropdown urutkan dengan toggle tampilan, menu ⋮ dengan shortcut (S), month picker, bar chart dengan tooltip, timeline setoran rutin, dialog setor/tarik dengan chip nominal cepat dan pratinjau before→after, picker rekening, icon & color picker, side panel detail, input mode alokasi (segmented), toast dengan Undo/"Lihat", banner peringatan, empty state + kartu template, skeleton, privacy mask (⌘ .), tema terang/gelap, shortcut "⌘ ↵ untuk menyimpan".

## 8. Pertanyaan terbuka
- Inkonsistensi angka setelah setor: layar vvQtO memperlihatkan Rp16.325.000 dan "0,5 bulan", padahal setor +1jt seharusnya ≈0,67 bulan. Kemungkinan cuplikan berasal dari state lain; perlu konfirmasi.
- Target dinamis Dana Darurat (3× pengeluaran): dihitung ulang tiap bulan atau dikunci saat dibuat?
- Apakah "Kantong darurat" memerlukan entitas sub-rekening sendiri?
- Status "Terpakai" vs "Selesai": apakah keduanya masuk tab Selesai?
- Untuk mode "Seluruh aset" (Bibit IDX30): apakah unit hasil DCA baru otomatis ikut?
- "Impor dari Anggaran" belum dijelaskan perilakunya.

---

# C. Utang & Cicilan (Section 18, [ucFim])

## 1. Ringkasan & tujuan user
Pengguna melacak kewajiban: tagihan kartu kredit berjalan, cicilan (kartu, paylater, 0%), KPR/KPM, pinjaman pribadi, dan **piutang**. Fokus desain adalah kartu kredit: transaksi kartu bisa dipecah jadi cicilan, pembayaran ke kartu dialokasikan berdasarkan prioritas, dan jadwal cicilan dihitung ulang saat ada pelunasan dipercepat. Saat menambah utang ditampilkan simulasi dampak ke rasio cicilan, saving rate, dan kekayaan bersih.

## 2. Daftar layar & state
| Layar | Node | Isi/tujuan | State |
|---|---|---|---|
| write.financial — Utang & cicilan | exCE7 | KPI (Sisa utang Rp0, Harus dibayar, Jatuh tempo terdekat, Piutang), "Kamu bebas utang", jenis: Cicilan kartu kredit, Paylater, Cicilan 0%, KPR/KPM, Pinjaman pribadi; CTA Catat piutang, Tambah utang / cicilan | kosong |
| Tagihan kartu kredit (belum dicicil) | rHTMd | BCA Visa •• 7710: tagihan berjalan Rp1.250.000 (3 transaksi), sisa limit Rp13.750.000 dari Rp15.000.000, tagihan tgl 20 / bayar tgl 5, "21 hari lagi", Bayar tagihan / Ubah jadi cicilan, Prioritas pembayaran kartu | ada tagihan |
| Hasil: cicilan A sisa Rp1jt | A7ttc | Cicilan A Kulkas: sisa Rp1.000.000 dari Rp3.000.000 (67% lunas), jadwal dihitung ulang 10 Nov, riwayat | ada cicilan |
| Tambah cicilan (draf) | v3Igd | Form + SIMULASI DAMPAK | dialog draf |
| Ubah transaksi jadi cicilan (belum ada transaksi) | OEZIG | Halaman Akun/Rekening (konteks kartu kredit, belum ada transaksi) | kosong |
| Catat pakai kartu → pecah 3× | hNvip | Form transaksi dengan "Pecah jadi cicilan" (3/6/12/24 bulan, bunga, biaya admin, jadwal) | dialog |
| Catat pakai kartu → tanpa cicilan | x20Gf | Toggle mati → masuk tagihan berjalan | dialog |
| Transfer Rp2jt ke kartu → alokasi | qrRRV | Tabel alokasi prioritas (sebelum/dibayar/sisa), pilihan "Kurangi nominal" / "Persingkat tenor" | dialog |

## 3. Alur user
- **Halaman → bebas utang → tagihan kartu → ada cicilan**: kosong → tagihan berjalan muncul otomatis dari transaksi kartu ("tagihan dicatat sebagai utang") → setelah pecah dan pelunasan sebagian, tampil kartu Cicilan A dengan jadwal.
- **Tambah utang/cicilan**: pilih jenis (Cicilan kartu/KPR/Pinjaman) → nama (MacBook Air M4 — iBox), pokok Rp18.999.000, penyedia Kredivo, tenor 12, bunga 0%/bulan, cicilan pertama 25 Nov 2026, bayar dari BCA Tahapan → simulasi → Simpan cicilan. Alternatif: ubah transaksi kartu yang sudah ada jadi cicilan.
- **Catat pakai kartu kredit**: transaksi A Rp3.000.000 Tokopedia 2 Nov → "Pecah jadi cicilan" (muncul karena rekeningnya kartu kredit) → 3 bulan, bunga 0 → jadwal 20 Nov/20 Des/20 Jan @1.000.000 → Simpan. Transaksi B Rp1.000.000 Superindo 6 Nov tanpa cicilan → masuk tagihan berjalan. Transfer Rp2.000.000 BCA Tahapan → BCA Visa 10 Nov → alokasi prioritas: cicilan A menyerap 2.000.000 (sisa 1.000.000), tagihan B 0 → pilih "Kurangi nominal (3× Rp333.334, tenor tetap)" atau "Persingkat tenor (1× Rp1.000.000, lunas 20 Nov)".
- **Catat piutang**: CTA ada ("Pinjaman pribadi · teman / keluarga · uang ditalangi"), tetapi alurnya tidak didesain.

## 4. Entitas data & field
- **CreditCardAccount** (tipe Rekening): nama "BCA Visa", 4 digit (7710), limit (Rp15.000.000), tanggal cetak tagihan (tgl 20), tanggal jatuh tempo (tgl 5), urutan prioritas pembayaran, saldo kredit (lebih bayar).
- **CardStatement/siklus**: periode, tanggal rekening koran (20 Nov), tempo (5 Des), total (Rp1.333.334 = cicilan 333.334 + B 1.000.000), daftar transaksi, status.
- **Debt/Installment**: jenis enum (cicilan_kartu, paylater, cicilan_0, kpr, kpm, pinjaman_pribadi), nama, penyedia (Kredivo, BCA Visa), sumber transaksi (transactionId nullable: "dari transaksi 2 Nov"), pokok (bigint), tenor bulan (3/6/12/24), bunga % per bulan (desimal), biaya admin (bigint), tanggal cicilan pertama, rekening pembayar, sisa pokok, % lunas, status, mode rekalkulasi terakhir.
- **InstallmentSchedule**: debtId, ke-n (1/3), tanggal tagih (20 Nov), tanggal tempo (5 Des), nominal (333.334), status enum (Terjadwal, Tertagih di rekening koran, Lunas).
- **DebtPayment/Allocation**: transferId (BCA Tahapan → BCA Visa Rp2.000.000), alokasi per kewajiban (Cicilan A 2.000.000, Tagihan B 0, Lebih bayar 0).
- **DebtEvent/riwayat**: "Dibuat dari transaksi A", "Dilunasi sebagian Rp2.000.000 · 10 Nov", "Sebelumnya 3× Rp1.000.000 · pilihan: kurangi nominal, tenor tetap".
- **Receivable (Piutang)**: [INFERENCE] pihak, jumlah, tanggal, status. Hanya CTA dan KPI yang terlihat.

## 5. Aturan bisnis & perhitungan
- **Cicilan 0%** = pokok ÷ tenor: 18.999.000 / 12 = Rp1.583.250; 3.000.000 / 3 = 1.000.000. Pembulatan sisa ditaruh di cicilan pertama: 1.000.000 / 3 → 333.334 + 333.333 + 333.333.
- **Berbunga** (KPR/pinjaman): input "% per bulan". Rumus tidak didesain; [INFERENCE] anuitas (flat untuk paylater/kartu, efektif untuk KPR).
- **Pengeluaran tetap tercatat pada tanggal transaksi** (budget bulan transaksi), sedangkan cicilan adalah pembayaran utang: "Pengeluaran Rp3.000.000 tetap tercatat 2 Nov — masuk anggaran November". Nama di buku kas "Cicilan MacBook Air M4 (1/12)".
- **Cicilan tidak ikut tagihan berjalan**: masuk Utang & cicilan. Limit terpakai senilai pokok dan pulih tiap cicilan dibayar ("Cicilan ditahan di limit · sisa pokok A").
- **Sisa limit** = limit − tagihan berjalan − sisa pokok cicilan: 15.000.000 − 1.000.000 − 1.000.000 = 13.000.000 ✓. Sebelumnya 15.000.000 − 1.250.000 = 13.750.000 ✓ (8% terpakai).
- **Total kewajiban kartu** = sisa pokok cicilan + tagihan berjalan (3.000.000 + 1.000.000 = 4.000.000).
- **Prioritas pembayaran kartu** (bisa diubah, drag): 1 Utang cicilan (pelunasan dipercepat), 2 belanja non-cicilan, 3 lebih bayar → saldo kredit. "Kalau cicilan sudah lunas semua, sisa transfer otomatis ke prioritas berikutnya."
- **Rekalkulasi setelah pelunasan sebagian**: "Kurangi nominal" (tenor tetap) atau "Persingkat tenor". Catatan "bank menentukan; catat sesuai konfirmasi bank".
- **Bisa diubah** biasa↔cicilan "selama belum tertagih".
- **Hari menuju jatuh tempo** ("21 hari lagi" dari 15 Okt ke 5 Nov).
- **Simulasi**: rasio cicilan/pemasukan = 1.583.250 / 26.000.000 = 6,1% (batas sehat ≤ 30%). Saving rate 36,5% → 30,4% (dikurangi 6,1 poin; "masih di atas target 30%, sisa ruang 0,4 poin"). Kekayaan bersih Rp116.440.000 → Rp97.440.000 (−pokok 18.999.000 ≈ 19jt; "barang tidak dihitung sebagai aset").
- **Kekayaan bersih** = total aset − sisa utang (saat tanpa utang = total aset Rp116.443.000).
- **Header** "Sisa utang", "Harus dibayar" (bulan ini), "Jatuh tempo terdekat", "Piutang".

## 6. Job latar/scheduler & integrasi
- **Penutupan siklus kartu** (tgl cetak 20): pindahkan tagihan berjalan + cicilan ke-n ke status "Tertagih di rekening koran", buat statement.
- **Pengingat jatuh tempo** (tgl 5 / tempo cicilan pertama 25 Nov), dan tampil di Kalender ("Tagihan terjadwal").
- **Cicilan non-kartu** (Kredivo bayar dari BCA Tahapan): [INFERENCE] membuat transaksi terjadwal "Perlu ditinjau" tiap tanggal, seperti setoran rutin.
- **Rekalkulasi jadwal** saat pembayaran dicatat (sinkron dalam request; tidak perlu worker).
- Tidak ada integrasi bank. Semua dicatat manual dan disesuaikan dengan "konfirmasi bank".

## 7. Komponen UI
KPI card, empty state dengan chip jenis utang, kartu kartu kredit (limit bar, tagihan berjalan, tanggal), daftar transaksi tagihan, kartu cicilan (progress % lunas), tabel jadwal cicilan dengan badge status, timeline riwayat, list prioritas drag-to-reorder, form dialog dengan segmented jenis dan pilihan tenor (3/6/12/24), toggle "Pecah jadi cicilan", panel "SIMULASI DAMPAK" (before→after), tabel alokasi pembayaran (prioritas/sebelum/dibayar/sisa), pilihan radio rekalkulasi, banner "Draf belum disimpan".

## 8. Pertanyaan terbuka
- Rumus bunga KPR/pinjaman (flat vs efektif/anuitas), biaya admin (sekali atau per bulan?), denda keterlambatan: tidak didesain.
- Alur Piutang tidak didesain (hanya CTA dan KPI).
- Paylater non-kartu (Kredivo): apakah dicatat sebagai rekening kewajiban terpisah dengan limit?
- Apakah utang barang (MacBook) membuat transaksi pengeluaran penuh di awal (seperti kartu), atau pengeluaran per cicilan? Simulasi menurunkan saving rate per bulan sebesar cicilan, yang mengisyaratkan cicilan dihitung sebagai pengeluaran bulanan, bertentangan dengan alur kartu (pengeluaran penuh di tanggal transaksi).
- Pembulatan: kekayaan bersih Rp116.440.000 vs Rp116.443.000.
- Layar OEZIG berlabel "Ubah transaksi jadi cicilan (belum ada transaksi)" tetapi isinya halaman Akun. Titik masuk ke fitur ini belum jelas.

---

# D. Kebutuhan lintas fitur: data harga/kurs eksternal & valuasi
1. **Tabel `price_quotes`** (symbol, provider, harga, mata uang, as_of) dan **`fx_rates`** (USD/IDR). Simpan riwayat untuk perubahan harian, snapshot bulanan, dan YTD.
2. **Provider**: Yahoo Finance (ETF/saham AS, IDX, indeks SPY/IHSG), CoinGecko (BTC). Emas, NAB reksa dana, dan SBN butuh sumber yang belum disebut. API key di Pengaturan.
3. **Worker BullMQ**: job sync per platform/provider (progres "3/5"), rate limit dan backoff (429 retry-after), status per platform, log API yang dapat dibuka user. Sinkron manual memicu job dan UI melakukan polling status.
4. **Harga basi** tetap dipakai dengan cap waktu, ditampilkan per platform ("sinkron 16.15"). Error total tidak boleh memblokir halaman Investasi. Tabungan memiliki fallback "Lihat saldo rekening saja".
5. **Valuasi terpusat** (dipakai Investasi, Tabungan, Ringkasan, Akun "≈ Rp61.420.000", kekayaan bersih): nilai = unit × harga × kurs; alokasi tujuan = % × nilai aset + nominal tetap rekening.
6. **Snapshot**: nilai akhir bulan + modal + setoran (grafik pertumbuhan), harian (Hari ini).
