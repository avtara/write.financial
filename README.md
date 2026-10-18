# write.financial

Aplikasi web open source untuk **mencatat keuangan dan aset pribadi**, berbahasa Indonesia dengan mata uang utama IDR. Bisa di-host sendiri (self-host) atau dipakai lewat layanan terkelola di [write.financial](https://write.financial) bagi yang tidak sempat mengurus server.

> **Status: tahap perencanaan.** PRD, desain, dan rencana implementasi sudah selesai; kode aplikasi belum ada. Progres ada di [TODO.md](TODO.md).

## Prinsip

- **Dicatat manual, tanpa login bank.** Tidak ada koneksi ke bank, broker, atau open banking.
- **Tidak ada yang otomatis mengubah data keuanganmu tanpa konfirmasi.** Langganan jatuh tempo, setoran rutin, hasil AI, email dari Gmail, impor mutasi, dan usulan tutup buku masuk antrean **Perlu ditinjau** dulu.
- **Data milikmu.** Data keuangan tiap user terisolasi (Row-Level Security), rahasia dan file dienkripsi per user, tanpa telemetri.
- **Satu kode untuk semua.** Tidak ada fitur yang dikunci khusus versi cloud.

## Fitur (rencana v1)

- **Buku kas:** rekening (bank, e-wallet, tunai, kartu kredit, platform investasi, multi-mata uang), transaksi, transfer dengan biaya dan selisih kurs, pisah transaksi, tag, lampiran struk, rekonsiliasi saldo.
- **Periode gajian:** tanggal mulai periode 1–28, laporan bulanan final yang tidak berubah.
- **Anggaran:** batas per kategori (Kebutuhan/Keinginan), batas aman harian, proyeksi, pindah sisa, dana tidak rutin.
- **Langganan & kalender:** pengingat tagihan, deteksi langganan dari transaksi, kalender pengeluaran dan jadwal.
- **Tabungan:** tujuan yang terhubung ke saldo rekening dan porsi unit investasi.
- **Utang, cicilan, piutang:** kartu kredit, pecah cicilan, prioritas pembayaran, piutang dari pisah tagihan.
- **Investasi:** holding multi-platform IDR/USD, untung/rugi, alokasi vs target. Harga dari sumber gratis, API key milikmu (BYOK), atau diisi manual.
- **Laporan:** PDF/Excel/CSV, impor mutasi CSV/XLSX.
- **Opsional:** Asisten AI dan baca struk (BYOK: OpenRouter/OpenAI-compatible), baca email transaksi dari Gmail.
- **Keamanan:** verifikasi dua langkah (TOTP, passkey, kode cadangan), mode privasi untuk menyembunyikan nominal.
- **Perangkat:** desktop dan tablet. Ponsel menyusul.

## Stack

| Bagian | Teknologi |
|---|---|
| Web | TanStack Start (React), TanStack Router/Query/Form/Table, Tailwind CSS v4, shadcn/ui |
| Data | PostgreSQL (Drizzle ORM, RLS), Redis |
| Worker & jadwal | BullMQ (proses terpisah) |
| File & gambar | SeaweedFS (API S3, bisa diganti S3 lain) |
| Auth | Better Auth (Google, email/password, 2FA, passkey) |
| Deploy | Docker Compose (self-host), satu image untuk self-host dan cloud |

## Self-host

Belum tersedia. Target rilis open source v1.0 (milestone M9a): cukup `docker compose up` lalu ikuti wizard setup, dalam waktu kurang dari 15 menit. Panduan lengkapnya akan ada di `docs/self-host/`.

## Dokumentasi

- [PRD](docs/PRD.md): kebutuhan produk, aturan perhitungan, keamanan, dan keputusan (D1–D25)
- [Rencana implementasi](docs/IMPLEMENTATION_PLAN.md): arsitektur, model data, worker, milestone M0–M9b
- [Riset sumber data pasar](docs/research/market-data.md): API gratis, BYOK, dan yang dilarang
- [Analisis desain](docs/design-analysis/) dan [digest layar](design/digest/)

## Kontribusi

Kontribusi diterima setelah fondasi (M0) selesai. Setiap commit wajib ditandatangani dengan DCO (`git commit -s`).

## Keamanan

Laporkan kerentanan secara privat ke **security@write.financial**. Jangan buka issue publik untuk masalah keamanan.

## Lisensi

[AGPL-3.0-only](LICENSE). Nama dan logo write.financial tidak termasuk dalam lisensi kode. Logo bank, e-wallet, dan aset di `images/logos/` adalah merek milik pemiliknya masing-masing dan hanya dipakai sebagai penanda rekening.
