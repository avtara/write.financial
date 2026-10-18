# TODO

Rincian dan syarat lulus tiap milestone ada di [rencana implementasi](docs/IMPLEMENTATION_PLAN.md) §8. Nomor FR/D merujuk ke [PRD](docs/PRD.md).

## Persiapan

- [x] PRD v1.1 dan rencana implementasi
- [x] Desain lengkap, termasuk layar tambahan (Section 19) dan brand write.financial (Section 20)
- [x] Riset sumber data pasar gratis + BYOK
- [x] Repo publik, lisensi AGPL-3.0, secret scanning + push protection, Dependabot
- [x] Google Cloud project `write-financial`: OAuth client, Gmail API, Pub/Sub topic `gmail-push`
- [ ] Konfirmasi versi runtime: Node 22 + pnpm 10
- [ ] Info VPS: spesifikasi, versi Postgres, Redis khusus atau bersama, Docker, enkripsi disk
- [ ] DNS `write.financial` dan penyedia email (SPF/DKIM/DMARC) — sebelum staging
- [ ] Bucket cadangan off-site (Backblaze B2 / Cloudflare R2)
- [ ] Tempat cadangan offline untuk kunci enkripsi utama (KEK)
- [ ] Export logo ke `images/brand/`

## M0 — Fondasi aman

- [ ] Monorepo pnpm + Turborepo, header SPDX, `.nvmrc`, `.env.example`
- [ ] CI: lint, typecheck, test, gitleaks, pengecekan DCO
- [ ] Branch protection `main` (wajib PR + lulus CI)
- [ ] `docker-compose` dev: Postgres, Redis, SeaweedFS, Mailpit
- [ ] Drizzle + migrasi awal dengan RLS dan role DB terpisah
- [ ] `packages/crypto`: KEK/DEK per user, redaksi log
- [ ] Better Auth: email/password, Google, 2FA (TOTP, kode cadangan, passkey), lockout, daftar perangkat
- [ ] Object storage terenkripsi (`integrations/objectstore`) + upload gambar aman
- [ ] Token desain, tema gelap/terang, app shell desktop + rail tablet, `<Money>` + mode privasi
- [ ] Domain `money`, `period`, `ledger` + golden test
- [ ] Worker skeleton (dispatcher, Bull Board, maintenance)
- [ ] Image Docker + compose self-host + wizard setup pertama
- [ ] SECURITY.md, CONTRIBUTING.md, TRADEMARK.md
- [ ] Staging cloud dengan cadangan terenkripsi

## M1 — Buku kas

- [ ] Onboarding 5 langkah
- [ ] Rekening + rekonsiliasi saldo
- [ ] Kategori + tag
- [ ] Catat Transaksi (sheet + bar Catat Cepat), transfer dengan kurs
- [ ] Halaman Transaksi: filter, tampilan, aksi massal, detail, pisah, hapus + urungkan
- [ ] Command palette ⌘K

## M2 — Periode, anggaran, dashboard

- [ ] Periode gajian 1–28, periode transisi, hitung ulang
- [ ] Anggaran berversi, pindah sisa, rollover, peringatan
- [ ] Dashboard Minggu/Bulan/Tahun + rentang khusus

## M3 — Jadwal, Perlu ditinjau, langganan, kalender, notifikasi

- [ ] Transaksi berulang + mesin jadwal di worker
- [ ] Halaman Perlu ditinjau
- [ ] Tutup buku otomatis + usulan yang dikonfirmasi
- [ ] Langganan, kalender, notifikasi (popover, halaman, email)

## M4 — Tabungan, utang, kartu kredit, piutang

- [ ] Tujuan tabungan + dana tidak rutin
- [ ] Kartu kredit, cicilan, prioritas pembayaran
- [ ] Piutang: catat, terima pembayaran, hapuskan

## M5 — Investasi & data pasar

- [ ] Aset, transaksi investasi, valuasi, alokasi, rebalancing
- [ ] Sumber harga bawaan, BYOK, manual + layar API kurs & pasar

## M6 — Laporan, ekspor, impor

- [ ] Laporan bulanan final + kuartal/tahunan/kustom
- [ ] Ekspor PDF/Excel/CSV, impor CSV/XLSX
- [ ] Ekspor semua data + hapus akun

## M7 — Otomasi & AI

- [ ] Aturan otomatis (saran)
- [ ] Asisten AI + baca struk (BYOK)
- [ ] Gmail (feature flag) + log Gmail

## M8 — Tablet & kualitas

- [ ] Penyempurnaan tablet semua halaman
- [ ] Atur dashboard, PIN kunci aplikasi
- [ ] Audit aksesibilitas dan performa

## M9a — Rilis open source v1.0

- [ ] Panduan self-host lengkap
- [ ] Halaman admin & status instance
- [ ] Uji upgrade antar versi di CI
- [ ] Audit keamanan kode

## M9b — Peluncuran cloud

- [ ] PT Perorangan + NIB + PSE
- [ ] Kebijakan privasi & syarat layanan
- [ ] Uji penetrasi
- [ ] Verifikasi Google (login; Gmail menyusul)
