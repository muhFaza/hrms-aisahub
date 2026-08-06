# Skrip Video Demo — HRMS Aisahub

**Durasi target:** 5 menit (300 detik)
**Audiens:** sidang skripsi — dosen penguji
**Gaya narasi:** Indonesia natural, seperti orang menjelaskan kerjaannya sendiri. Sopan,
tapi tidak kaku. **Antarmuka sistem berbahasa Inggris**, jadi label yang disebut di layar
tetap dalam bahasa Inggris.
**URL:** https://hrms.muhammadfaza.com

---

## ⚠️ Baca dulu sebelum merekam

**Finalisasi payroll tidak bisa dibatalkan.** Segmen 8 memfinalisasi periode Juli. Begitu
tombol itu ditekan, tidak ada endpoint un-finalize. Kalau take-nya gagal dan harus diulang
dari awal, datanya perlu di-reset dulu:

```bash
# di VPS
docker exec hrms-app node dist/prisma/seed.js
docker exec -i hrms-db psql -U hrms -d hrms < cleanup.sql     # SQL-nya ada di spec
docker exec hrms-app sh -c 'rm -f /app/uploads/*'
# dari laptop
pnpm --filter server exec tsx ../scripts/demo-data.ts \
  --base-url https://hrms.muhammadfaza.com --today 2026-08-06
```

**Jangan menekan `End Employment`** di segmen 2. Cukup ditunjuk saja. Kalau diklik, hubungan
kerja karyawannya benar-benar berhenti dan semua angka payroll di segmen 8 ikut berubah.

**Dua item pending yang disetujui di segmen 6 dan 7 aman.** Tanggalnya 30 Juli dan 29 Juli,
jadi masuk jendela Agustus (26 Jul–25 Agu), bukan periode Juli yang difinalisasi. Menyetujui
keduanya tidak menggeser angka payslip mana pun.

**Cek jumlah test dulu** kalau mau menyebut angkanya di penutup: `pnpm test`, lalu sesuaikan
naskahnya.

**Persiapan teknis:** resolusi 1920×1080, zoom browser 100%, bookmark bar disembunyikan, tab
lain ditutup, pakai incognito supaya tidak ada autofill yang mengganggu.

**Akun:** `hr@aisahub.com` dan `budi@aisahub.com`, kata sandinya sama — `password123`.

---

## Peta waktu

| # | Segmen | Mulai | Durasi |
| --- | --- | --- | --- |
| 0 | Pembuka | 0:00 | 20 dtk |
| 1 | Login & Dashboard | 0:20 | 18 dtk |
| 2 | Employees & siklus kerja | 0:38 | 27 dtk |
| 3 | Cuti & akrual | 1:05 | 30 dtk |
| 4 | Hari libur | 1:35 | 15 dtk |
| 5 | Daily Logs (part-time) | 1:50 | 20 dtk |
| 6 | Lembur + persetujuan | 2:10 | 25 dtk |
| 7 | Reimbursement + bukti | 2:35 | 25 dtk |
| 8 | **Payroll & finalisasi** | 3:00 | 55 dtk |
| 9 | Users & notifikasi | 3:55 | 17 dtk |
| 10 | Tampilan karyawan | 4:12 | 33 dtk |
| 11 | Penutup | 4:45 | 15 dtk |
| | **Total** | | **5:00** |

Segmen 8 sengaja dapat porsi paling besar karena langkahnya memang paling banyak — buka
periode, finalisasi, unduh PDF, ekspor CSV. Sisanya rata di 15–30 detik.

---

## Segmen 0 — Pembuka · 0:00–0:20

**Layar:** halaman login.

> Assalamualaikum warahmatullahi wabarakatuh. Perkenalkan, saya Muhammad Faza. Di video ini
> saya akan mendemokan sistem Human Resource Management yang saya bangun pakai PERN Stack —
> PostgreSQL, Express, React, dan Node.js — semuanya ditulis dengan TypeScript. Sistem ini
> dibuat untuk Aisahub Inc.

**Klik:** buka `hrms.muhammadfaza.com`, diamkan di halaman login selama narasi.

---

## Segmen 1 — Login & Dashboard · 0:20–0:38

> Sistemnya punya dua peran: HR dan Employee. Sekarang saya masuk sebagai HR. Satu hal yang
> penting di sini — hak akses tidak diambil dari token, tapi dibaca ulang dari database setiap
> kali ada request. Jadi begitu sebuah akun dinonaktifkan, aksesnya langsung tertutup. Di
> dashboard kelihatan ringkasan karyawan aktif, pengajuan yang masih menunggu, dan aktivitas
> terakhir.

**Klik:**
1. Isi `hr@aisahub.com` / `password123` → tombol masuk.
2. Berhenti di **Dashboard**, arahkan kursor ke kartu ringkasan.
3. Tunjuk lonceng notifikasi di kanan atas — badge-nya menunjukkan angka **4**.

---

## Segmen 2 — Employees & siklus kerja · 0:38–1:05

> Ini modul Employees. Ada empat karyawan: dua full-time, dua part-time. Kalau detailnya
> dibuka, datanya dikelompokkan jadi Personal, Employment, Education, dan Payment. Yang menarik
> ada di bagian Employment — status karyawan tidak disimpan sebagai kolom aktif atau tidak
> aktif, tapi sebagai riwayat. Jadi kalau ada yang berhenti lalu masuk lagi, keduanya tercatat
> terpisah dan tidak saling menimpa.

**Klik:**
1. Sidebar → **Employees**. Tunjukkan tabel 4 karyawan.
2. Buka **Budi Santoso**.
3. Lewati tab **Personal** → **Employment**.
4. Tunjuk bagian **Employment History** dan badge **Current**.
5. Tunjuk tombol **End Employment** — **jangan diklik.**

---

## Segmen 3 — Cuti & akrual · 1:05–1:35

> Masuk ke modul cuti. Aturannya bukan jatah tahunan, tapi satu hari untuk tiap bulan kerja,
> dan hangus delapan belas bulan setelahnya. Di Budi ini kelihatan jelas: tiga puluh hari
> terkumpul, enam terpakai, dua belas sudah hangus, sisanya dua belas. Kalau ambil cuti
> berbayar, yang dipotong duluan saldo yang paling dekat masa hangusnya. Dan cuti di sini tidak
> pakai persetujuan — begitu diajukan langsung tercatat, karena yang dicatat memang cuti yang
> diambil, bukan permintaan izin.

**Klik:**
1. Sidebar → **All Leave**. Tunjukkan 7 catatan dengan tipe PAID, SICK, UNPAID.
2. Tab **Balances** → tunjuk baris Budi: Accrued 30, Used 6, **Expired 12**, Balance 12.
3. Tab **Calendar** → tunjukkan bulan Agustus: cuti Sari 3–4 Agustus, Budi 10–12 Agustus, dan
   libur nasional 17 Agustus.

---

## Segmen 4 — Hari libur · 1:35–1:50

> Hari libur dikelola terpisah, dan ini berpengaruh ke hitungan hari kerja. Ada empat jenis.
> Yang perlu diperhatikan, cuti bersama tetap dihitung sebagai hari kerja — jadi kalau ada yang
> cuti melewati tanggal itu, tetap kepotong.

**Klik:**
1. Sidebar → **Holidays**.
2. Tunjuk **Aisahub Company Outing** (10 Juli, tipe COMPANY) dan salah satu baris
   **Cuti Bersama** (tipe JOINT_LEAVE) untuk membandingkan keduanya.

---

## Segmen 5 — Daily Logs · 1:50–2:10

> Karyawan part-time tidak digaji bulanan, tapi dibayar per jam lewat Daily Logs. Andi dan Dewi
> mencatat sendiri jam kerja hariannya, lengkap dengan proyeknya. Catatan ini tidak lewat
> persetujuan dan langsung jadi dasar hitungan upah. Satu karyawan cuma bisa punya satu catatan
> per tanggal.

**Klik:**
1. Sidebar → **Daily Logs**.
2. Filter bulan ke **Juli 2026**.
3. Tunjuk kartu **Total Hours This Month** dan **Logged Days**, lalu kolom project
   (*Mobile App*, *Marketing Site*).

---

## Segmen 6 — Lembur & persetujuan · 2:10–2:35

> Lembur cuma berlaku untuk karyawan full-time, dan harus disetujui HR. Sekarang ada dua
> pengajuan yang menunggu. Saya setujui punya Budi. Begitu disetujui, notifikasi ke karyawannya
> langsung dikirim di transaksi yang sama — jadi tidak mungkin ada keputusan yang karyawannya
> sendiri tidak tahu. Lembur yang ditolak tidak ikut dihitung waktu penggajian.

**Klik:**
1. Sidebar → **Overtime**.
2. Filter status → **PENDING**.
3. Baris **Budi, 30 Juli, 3 jam** → **Approve**.
4. Tunjukkan statusnya berubah jadi APPROVED.
5. Ganti filter ke **REJECTED** sekilas, tunjukkan pengajuan Sari yang ditolak dan alasannya.

---

## Segmen 7 — Reimbursement & bukti · 2:35–3:00

> Reimbursement bisa diajukan semua karyawan, full-time maupun part-time, dan wajib pakai
> bukti. File buktinya cuma bisa diunduh pemiliknya atau HR. Saya buka dulu buktinya, lalu saya
> setujui. Yang disetujui otomatis masuk ke komponen gaji di periode yang sesuai; yang ditolak
> tidak dihitung sama sekali.

**Klik:**
1. Sidebar → **Reimbursements**.
2. Filter status → **PENDING**.
3. Baris **Sari, 29 Juli, Rp 600.000** → buka bukti PDF-nya, tampilkan sebentar, tutup.
4. **Approve** baris itu.
5. Tunjuk sekilas klaim Dewi yang **REJECTED** dan alasannya.

---

## Segmen 8 — Payroll & finalisasi · 3:00–3:55 ⭐

> Sekarang penggajian. Periodenya ikut tanggal potong, dari tanggal dua puluh enam sampai dua
> puluh lima bulan berikutnya. Juni sudah difinalisasi, Juli masih draft — jadi angkanya
> dihitung ulang tiap kali dibuka. Kurs dolarnya diambil dari API publik waktu periode dibuat,
> lalu dikunci supaya tidak berubah-ubah.
>
> Coba lihat payslip Sari. Gaji pokok dua belas juta, lembur dua ratus delapan puluh lima ribu,
> reimbursement satu koma dua juta, dan potongan dua koma dua delapan juta — itu datang dari
> dua hari sakit dan dua hari cuti tanpa gaji.
>
> Sekarang saya finalisasi. Waktu difinalisasi, payslip-nya disimpan jadi snapshot, semua
> karyawan dapat notifikasi, dan seluruh rentang tanggalnya dikunci. Ini tidak bisa dibatalkan.
> Setelah itu payslip bisa diunduh PDF-nya, dan satu periode bisa diekspor ke CSV buat payment
> gateway.

**Klik:**
1. Sidebar → **Payroll**. Tunjukkan dua periode: Juni **FINALIZED**, Juli **DRAFT**.
2. **Open** periode **Juli 2026**. Tunjuk rentang `2026-06-26 → 2026-07-25` dan **Exchange rate**.
3. Tunjukkan tabel 4 karyawan. Buka rincian **Sari Wulandari** — tunjuk baris potongan sakit
   dan potongan cuti tanpa gaji yang terpisah.
4. Klik **Finalize** → konfirmasi di dialog.
5. Tunjukkan statusnya berubah jadi **FINALIZED**.
6. **Download PDF** payslip Sari — tampilkan PDF-nya sebentar.
7. Klik **Export** → CSV, tunjukkan file yang terunduh.

---

## Segmen 9 — Users & notifikasi · 3:55–4:12

> Akun dikelola di modul Users. Perannya ditentukan waktu akun dibuat dan tidak bisa diubah
> setelahnya — ini sengaja, supaya tidak ada celah hak akses. Semua notifikasi sifatnya in-app;
> sistem ini sama sekali tidak pakai email.

**Klik:**
1. Sidebar → **Users**. Tunjukkan 5 akun dan perannya.
2. Klik lonceng → halaman **Notifications**. Tunjukkan notifikasi payslip yang barusan terkirim
   gara-gara finalisasi tadi.

---

## Segmen 10 — Tampilan karyawan · 4:12–4:45

> Sekarang dari sisi karyawan. Saya keluar, lalu masuk sebagai Budi. Menunya langsung beda —
> karyawan cuma bisa lihat datanya sendiri. Notifikasi payslip-nya sudah masuk. Di My Payslips,
> Budi bisa mengunduh slip gajinya sendiri. Di My Leave ada saldo cutinya, dan dia bisa
> mengajukan cuti baru — ada konfirmasi yang mengingatkan untuk koordinasi dulu dengan tim dan
> manajer proyeknya.

**Klik:**
1. Logout → login `budi@aisahub.com` / `password123`.
2. Tunjuk sidebar yang lebih pendek (My Leave, Overtime, Reimbursements, My Payslips).
3. Klik lonceng — notifikasi payslip sudah ada.
4. **My Payslips** → **Download PDF**.
5. **My Leave** → tunjuk kartu **Balance**, lalu **Request Leave** → tampilkan form dan layar
   konfirmasi **Before you submit** → **Cancel** (jangan dikirim).

---

## Segmen 11 — Penutup · 4:45–5:00

> Sekian demo sistem HRMS berbasis PERN Stack ini. Semua aturan bisnisnya diuji lewat lebih
> dari dua ratus tujuh puluh test otomatis, dan sistemnya sudah di-deploy serta bisa diakses
> publik. Terima kasih. Wassalamualaikum warahmatullahi wabarakatuh.

**Klik:** kembali ke Dashboard, atau tahan di layar penutup.

---

## Batasan yang sebaiknya disiapkan untuk sesi tanya jawab

Bukan bagian dari narasi, tapi kemungkinan besar ditanyakan:

- **Tidak ada PPh 21 dan BPJS.** Ini keputusan ruang lingkup yang disengaja, bukan kelalaian.
- **Lembur dibayar 1,0×**, tanpa premi Kepmenaker 102/2004.
- **THR** hanya tersimpan sebagai penanda kelayakan, tidak ada perhitungannya.
- **Skema cuti satu hari per bulan dengan masa hangus 18 bulan** menggantikan ketentuan 12 hari
  per tahun — ini keputusan perancangan yang diambil sadar.
- **Cuti bersama dihitung sebagai hari kerja**, beda dari praktik umum.

---

## Naskah lengkap untuk voiceover

Gabungan semua narasi tanpa instruksi klik — untuk dibaca langsung waktu merekam.

=== AWAL NASKAH ===

Assalamualaikum warahmatullahi wabarakatuh. Perkenalkan, saya Muhammad Faza. Di video ini saya akan mendemokan sistem Human Resource Management yang saya bangun pakai PERN Stack — PostgreSQL, Express, React, dan Node.js — semuanya ditulis dengan TypeScript. Sistem ini dibuat untuk Aisahub Inc.

Sistemnya punya dua peran: HR dan Employee. Sekarang saya masuk sebagai HR. Satu hal yang penting di sini — hak akses tidak diambil dari token, tapi dibaca ulang dari database setiap kali ada request. Jadi begitu sebuah akun dinonaktifkan, aksesnya langsung tertutup. Di dashboard kelihatan ringkasan karyawan aktif, pengajuan yang masih menunggu, dan aktivitas terakhir.

Ini modul Employees. Ada empat karyawan: dua full-time, dua part-time. Kalau detailnya dibuka, datanya dikelompokkan jadi Personal, Employment, Education, dan Payment. Yang menarik ada di bagian Employment — status karyawan tidak disimpan sebagai kolom aktif atau tidak aktif, tapi sebagai riwayat. Jadi kalau ada yang berhenti lalu masuk lagi, keduanya tercatat terpisah dan tidak saling menimpa.

Masuk ke modul cuti. Aturannya bukan jatah tahunan, tapi satu hari untuk tiap bulan kerja, dan hangus delapan belas bulan setelahnya. Di Budi ini kelihatan jelas: tiga puluh hari terkumpul, enam terpakai, dua belas sudah hangus, sisanya dua belas. Kalau ambil cuti berbayar, yang dipotong duluan saldo yang paling dekat masa hangusnya. Dan cuti di sini tidak pakai persetujuan — begitu diajukan langsung tercatat, karena yang dicatat memang cuti yang diambil, bukan permintaan izin.

Hari libur dikelola terpisah, dan ini berpengaruh ke hitungan hari kerja. Ada empat jenis. Yang perlu diperhatikan, cuti bersama tetap dihitung sebagai hari kerja — jadi kalau ada yang cuti melewati tanggal itu, tetap kepotong.

Karyawan part-time tidak digaji bulanan, tapi dibayar per jam lewat Daily Logs. Andi dan Dewi mencatat sendiri jam kerja hariannya, lengkap dengan proyeknya. Catatan ini tidak lewat persetujuan dan langsung jadi dasar hitungan upah. Satu karyawan cuma bisa punya satu catatan per tanggal.

Lembur cuma berlaku untuk karyawan full-time, dan harus disetujui HR. Sekarang ada dua pengajuan yang menunggu. Saya setujui punya Budi. Begitu disetujui, notifikasi ke karyawannya langsung dikirim di transaksi yang sama — jadi tidak mungkin ada keputusan yang karyawannya sendiri tidak tahu. Lembur yang ditolak tidak ikut dihitung waktu penggajian.

Reimbursement bisa diajukan semua karyawan, full-time maupun part-time, dan wajib pakai bukti. File buktinya cuma bisa diunduh pemiliknya atau HR. Saya buka dulu buktinya, lalu saya setujui. Yang disetujui otomatis masuk ke komponen gaji di periode yang sesuai; yang ditolak tidak dihitung sama sekali.

Sekarang penggajian. Periodenya ikut tanggal potong, dari tanggal dua puluh enam sampai dua puluh lima bulan berikutnya. Juni sudah difinalisasi, Juli masih draft — jadi angkanya dihitung ulang tiap kali dibuka. Kurs dolarnya diambil dari API publik waktu periode dibuat, lalu dikunci supaya tidak berubah-ubah.

Coba lihat payslip Sari. Gaji pokok dua belas juta, lembur dua ratus delapan puluh lima ribu, reimbursement satu koma dua juta, dan potongan dua koma dua delapan juta — itu datang dari dua hari sakit dan dua hari cuti tanpa gaji.

Sekarang saya finalisasi. Waktu difinalisasi, payslip-nya disimpan jadi snapshot, semua karyawan dapat notifikasi, dan seluruh rentang tanggalnya dikunci. Ini tidak bisa dibatalkan. Setelah itu payslip bisa diunduh PDF-nya, dan satu periode bisa diekspor ke CSV buat payment gateway.

Akun dikelola di modul Users. Perannya ditentukan waktu akun dibuat dan tidak bisa diubah setelahnya — ini sengaja, supaya tidak ada celah hak akses. Semua notifikasi sifatnya in-app; sistem ini sama sekali tidak pakai email.

Sekarang dari sisi karyawan. Saya keluar, lalu masuk sebagai Budi. Menunya langsung beda — karyawan cuma bisa lihat datanya sendiri. Notifikasi payslip-nya sudah masuk. Di My Payslips, Budi bisa mengunduh slip gajinya sendiri. Di My Leave ada saldo cutinya, dan dia bisa mengajukan cuti baru — ada konfirmasi yang mengingatkan untuk koordinasi dulu dengan tim dan manajer proyeknya.

Sekian demo sistem HRMS berbasis PERN Stack ini. Semua aturan bisnisnya diuji lewat lebih dari dua ratus tujuh puluh test otomatis, dan sistemnya sudah di-deploy serta bisa diakses publik. Terima kasih. Wassalamualaikum warahmatullahi wabarakatuh.

=== AKHIR NASKAH ===

**Jumlah kata:** 648. Di tempo 140 kata per menit narasi murninya ± 4 menit 38 detik; di tempo
150 kata per menit ± 4 menit 19 detik. Sisanya buat jeda waktu mengklik dan menunggu halaman
termuat — jangan dibaca terburu-buru.

Kalau ternyata masih lewat dari 5 menit, segmen 4 (hari libur) dan segmen 9 (users &
notifikasi) paling aman dipangkas — keduanya tidak dirujuk segmen lain.
