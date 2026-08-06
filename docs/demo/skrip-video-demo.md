# Skrip Video Demo — HRMS Aisahub

**Durasi target:** 5 menit (300 detik)
**Audiens:** sidang skripsi — dosen penguji
**Bahasa narasi:** Indonesia formal (voiceover). **Antarmuka sistem berbahasa Inggris**, jadi
label yang disebut di layar tetap dalam bahasa Inggris.
**URL:** https://hrms.muhammadfaza.com

---

## ⚠️ Baca dulu sebelum merekam

**Finalisasi payroll tidak dapat dibatalkan.** Segmen 8 memfinalisasi periode Juli. Begitu
tombol itu ditekan, tidak ada endpoint un-finalize. Kalau take gagal dan perlu diulang dari
awal, data harus di-reset ulang lebih dahulu:

```bash
# di VPS
docker exec hrms-app node dist/prisma/seed.js
docker exec -i hrms-db psql -U hrms -d hrms < cleanup.sql     # SQL ada di spec
docker exec hrms-app sh -c 'rm -f /app/uploads/*'
# dari laptop
pnpm --filter server exec tsx ../scripts/demo-data.ts \
  --base-url https://hrms.muhammadfaza.com --today 2026-08-06
```

**Jangan menekan `End Employment`** di segmen 2. Cukup tunjukkan tab dan riwayatnya.
Menekan tombol itu akan menghentikan hubungan kerja karyawan dan mengubah seluruh angka
payroll di segmen 8.

**Dua item pending yang disetujui di segmen 6 dan 7 aman.** Keduanya bertanggal 30 Juli dan
29 Juli, yang jatuh di jendela Agustus (26 Jul–25 Agu), bukan di periode Juli yang
difinalisasi. Jadi menyetujuinya tidak mengubah angka payslip Juli.

**Cek jumlah tes sebelum merekam** kalau ingin menyebut angkanya di penutup:
`pnpm test` — sesuaikan naskah dengan hasilnya.

**Persiapan teknis:** resolusi 1920×1080, zoom browser 100%, sembunyikan bookmark bar,
tutup tab lain, mode incognito supaya tidak ada autofill yang tidak diinginkan.

**Akun:** `hr@aisahub.com` dan `budi@aisahub.com`, kata sandi keduanya `password123`.

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

Segmen 8 sengaja diberi porsi lebih besar karena jumlah langkahnya memang paling banyak
(buka periode → finalisasi → unduh PDF → ekspor CSV). Sisanya rata di kisaran 15–30 detik.

---

## Segmen 0 — Pembuka · 0:00–0:20

**Layar:** halaman login.

> Assalamualaikum warahmatullahi wabarakatuh. Perkenalkan, saya Muhammad Faza. Pada video
> ini saya akan mendemonstrasikan hasil rancang bangun Sistem Human Resource Management
> menggunakan PERN Stack — yaitu PostgreSQL, Express, React, dan Node.js — yang seluruhnya
> ditulis dalam TypeScript. Sistem ini diimplementasikan untuk Aisahub Inc.

**Klik:** buka `hrms.muhammadfaza.com`, diamkan di halaman login selama narasi.

---

## Segmen 1 — Login & Dashboard · 0:20–0:38

> Sistem memiliki dua peran, yaitu HR dan Employee. Saya masuk sebagai HR. Perlu ditekankan,
> otorisasi tidak dibaca dari token, melainkan diambil ulang dari basis data pada setiap
> permintaan. Dashboard menampilkan ringkasan karyawan aktif, pengajuan yang menunggu, serta
> aktivitas terbaru.

**Klik:**
1. Isi `hr@aisahub.com` / `password123` → tombol masuk.
2. Berhenti di **Dashboard**, arahkan kursor ke kartu ringkasan.
3. Tunjuk lonceng notifikasi di kanan atas — badge menunjukkan angka **4**.

---

## Segmen 2 — Employees & siklus kerja · 0:38–1:05

> Modul Employees mengelola data karyawan. Terdapat empat karyawan: dua full-time dan dua
> part-time. Pada halaman detail, data dikelompokkan menjadi Personal, Employment, Education,
> dan Payment. Yang perlu digarisbawahi, status kepegawaian tidak disimpan sebagai kolom
> boolean, melainkan sebagai rangkaian riwayat Employment. Penghentian hubungan kerja
> dilakukan melalui End Employment dengan tanggal efektif, dan seluruh riwayatnya tersimpan.

**Klik:**
1. Sidebar → **Employees**. Tunjukkan tabel 4 karyawan.
2. Buka **Budi Santoso**.
3. Lewati tab **Personal** → **Employment**.
4. Tunjuk bagian **Employment History** dan badge **Current**.
5. Tunjuk tombol **End Employment** — **jangan diklik.**

---

## Segmen 3 — Cuti & akrual · 1:05–1:35

> Modul cuti. Kebijakan yang diterapkan bukan jatah tahunan, melainkan satu hari untuk setiap
> bulan masa kerja, yang kedaluwarsa delapan belas bulan setelah bulan perolehannya. Pada Budi
> terlihat tiga puluh hari terkumpul, enam terpakai, dua belas kedaluwarsa, dan dua belas
> tersisa. Pengambilan cuti berbayar memotong saldo yang paling cepat kedaluwarsa lebih dahulu.
> Cuti tidak memerlukan persetujuan — begitu diajukan, cuti langsung tercatat, karena yang
> dicatat memang cuti yang diambil, bukan permohonan.

**Klik:**
1. Sidebar → **All Leave**. Tunjukkan daftar 7 catatan dengan tipe PAID, SICK, UNPAID.
2. Tab **Balances** → tunjuk baris Budi: Accrued 30, Used 6, **Expired 12**, Balance 12.
3. Tab **Calendar** → tunjukkan bulan Agustus: cuti Sari 3–4 Agustus dan Budi 10–12 Agustus,
   berikut hari libur nasional 17 Agustus.

---

## Segmen 4 — Hari libur · 1:35–1:50

> Hari libur dikelola terpisah dan memengaruhi perhitungan hari kerja. Terdapat empat jenis.
> Yang penting, cuti bersama tetap dihitung sebagai hari kerja, sehingga cuti yang melewatinya
> tetap mengurangi saldo maupun gaji.

**Klik:**
1. Sidebar → **Holidays**.
2. Tunjuk **Aisahub Company Outing** (10 Juli, tipe COMPANY) dan salah satu baris
   **Cuti Bersama** (tipe JOINT_LEAVE) untuk membandingkan keduanya.

---

## Segmen 5 — Daily Logs · 1:50–2:10

> Karyawan part-time tidak menerima gaji bulanan, melainkan dibayar per jam melalui Daily
> Logs. Andi dan Dewi mencatat jam kerja harian beserta proyeknya. Catatan ini tidak melalui
> proses persetujuan dan langsung menjadi dasar perhitungan upah. Sistem membatasi satu
> catatan untuk setiap karyawan pada setiap tanggal.

**Klik:**
1. Sidebar → **Daily Logs**.
2. Filter bulan ke **Juli 2026**.
3. Tunjuk kartu **Total Hours This Month** dan **Logged Days**, lalu kolom project
   (*Mobile App*, *Marketing Site*).

---

## Segmen 6 — Lembur & persetujuan · 2:10–2:35

> Lembur hanya berlaku bagi karyawan full-time dan memerlukan persetujuan HR. Saat ini ada dua
> pengajuan yang menunggu. Saya setujui pengajuan Budi. Persetujuan ini langsung mengirimkan
> notifikasi kepada karyawan di dalam transaksi yang sama, sehingga sebuah keputusan tidak
> mungkin ada tanpa notifikasinya. Lembur yang ditolak tidak ikut dihitung dalam penggajian.

**Klik:**
1. Sidebar → **Overtime**.
2. Filter status → **PENDING**.
3. Pada baris **Budi, 30 Juli, 3 jam** → **Approve**.
4. Tunjukkan statusnya berubah menjadi APPROVED.
5. Ganti filter ke **REJECTED** sekilas untuk menunjukkan pengajuan Sari yang ditolak beserta
   alasannya.

---

## Segmen 7 — Reimbursement & bukti · 2:35–3:00

> Reimbursement dapat diajukan oleh seluruh karyawan, baik full-time maupun part-time, dan
> wajib menyertakan bukti. Berkas bukti hanya dapat diunduh oleh pemiliknya atau oleh HR. Saya
> buka buktinya, lalu saya setujui. Klaim yang disetujui otomatis masuk sebagai komponen
> penggajian pada periode yang bersesuaian, sedangkan klaim yang ditolak tidak ikut dihitung.

**Klik:**
1. Sidebar → **Reimbursements**.
2. Filter status → **PENDING**.
3. Pada baris **Sari, 29 Juli, Rp 600.000** → unduh/buka bukti PDF, tampilkan sebentar, tutup.
4. **Approve** baris tersebut.
5. Tunjuk sekilas klaim Dewi yang **REJECTED** berikut alasannya.

---

## Segmen 8 — Payroll & finalisasi · 3:00–3:55 ⭐

> Modul penggajian. Periode mengikuti tanggal potong, yaitu dari tanggal dua puluh enam sampai
> tanggal dua puluh lima bulan berikutnya. Periode Juni sudah difinalisasi, sedangkan periode
> Juli masih berstatus draft sehingga angkanya dihitung ulang setiap kali dibuka. Kurs dolar
> diambil dari API publik pada saat periode dibuat, lalu dibekukan agar nilainya tidak berubah.
>
> Perhatikan payslip Sari. Gaji pokok dua belas juta rupiah, lembur dua ratus delapan puluh
> lima ribu, reimbursement satu koma dua juta, dan potongan dua koma dua delapan juta yang
> berasal dari dua hari sakit dan dua hari cuti tanpa gaji.
>
> Sekarang saya finalisasi. Finalisasi menyimpan payslip sebagai snapshot, mengirim notifikasi
> kepada seluruh karyawan, dan mengunci seluruh rentang tanggal periode tersebut. Proses ini
> tidak dapat dibatalkan. Payslip dapat diunduh dalam bentuk PDF, dan periode dapat diekspor ke
> CSV untuk keperluan payment gateway.

**Klik:**
1. Sidebar → **Payroll**. Tunjukkan dua periode: Juni **FINALIZED**, Juli **DRAFT**.
2. **Open** periode **Juli 2026**. Tunjuk rentang `2026-06-26 → 2026-07-25` dan **Exchange rate**.
3. Tunjukkan tabel 4 karyawan. Buka rincian **Sari Wulandari** — tunjuk baris potongan sakit
   dan potongan cuti tanpa gaji secara terpisah.
4. Klik **Finalize** → konfirmasi pada dialog.
5. Tunjukkan status berubah menjadi **FINALIZED**.
6. **Download PDF** payslip Sari — tampilkan PDF-nya sebentar.
7. Klik **Export** → CSV, tunjukkan berkas terunduh.

---

## Segmen 9 — Users & notifikasi · 3:55–4:12

> Manajemen akun berada pada modul Users. Peran ditetapkan saat akun dibuat dan tidak dapat
> diubah setelahnya, untuk menutup celah otorisasi. Seluruh notifikasi bersifat in-app; sistem
> ini sama sekali tidak menggunakan surel.

**Klik:**
1. Sidebar → **Users**. Tunjukkan 5 akun beserta perannya.
2. Klik lonceng → halaman **Notifications**. Tunjukkan notifikasi payslip yang baru saja
   terkirim akibat finalisasi tadi.

---

## Segmen 10 — Tampilan karyawan · 4:12–4:45

> Selanjutnya dari sisi karyawan. Saya keluar, lalu masuk sebagai Budi. Menu yang tampil
> berbeda: karyawan hanya dapat melihat datanya sendiri. Notifikasi payslip sudah diterima.
> Pada My Payslips, Budi dapat mengunduh slip gajinya sendiri. Pada My Leave, ia melihat saldo
> cutinya dan dapat mengajukan cuti baru, dengan konfirmasi yang mengingatkan agar
> berkoordinasi lebih dahulu dengan tim dan manajer proyeknya.

**Klik:**
1. Logout → login `budi@aisahub.com` / `password123`.
2. Tunjuk sidebar yang lebih pendek (My Leave, Overtime, Reimbursements, My Payslips).
3. Klik lonceng — notifikasi payslip sudah ada.
4. **My Payslips** → **Download PDF**.
5. **My Leave** → tunjuk kartu **Balance**, lalu **Request Leave** → tampilkan form dan layar
   konfirmasi **Before you submit** → **Cancel** (jangan dikirim).

---

## Segmen 11 — Penutup · 4:45–5:00

> Demikian demonstrasi Sistem Human Resource Management berbasis PERN Stack ini. Seluruh aturan
> bisnis diuji melalui lebih dari dua ratus tujuh puluh pengujian otomatis, dan sistem telah
> di-deploy serta dapat diakses secara publik. Terima kasih atas perhatiannya. Wassalamualaikum
> warahmatullahi wabarakatuh.

**Klik:** kembali ke Dashboard, atau tahan di layar penutup.

---

## Batasan yang sebaiknya disiapkan untuk sesi tanya jawab

Bukan bagian dari narasi, tetapi kemungkinan besar ditanyakan:

- **Tidak ada PPh 21 dan BPJS.** Ini keputusan ruang lingkup yang disengaja, bukan kelalaian.
- **Lembur dibayar 1,0×**, tanpa premi Kepmenaker 102/2004.
- **THR** tersimpan sebagai penanda kelayakan, tetapi tidak ada perhitungannya.
- **Skema cuti 1 hari per bulan dengan masa kedaluwarsa 18 bulan** menggantikan ketentuan
  12 hari per tahun; ini keputusan perancangan yang diambil secara sadar.
- **Cuti bersama dihitung sebagai hari kerja**, berbeda dari praktik umum.

---

## Naskah lengkap untuk voiceover

Bagian di bawah ini adalah gabungan seluruh narasi tanpa instruksi klik — untuk dibaca
langsung saat merekam.

=== AWAL NASKAH ===

Assalamualaikum warahmatullahi wabarakatuh. Perkenalkan, saya Muhammad Faza. Pada video ini saya akan mendemonstrasikan hasil rancang bangun Sistem Human Resource Management menggunakan PERN Stack — yaitu PostgreSQL, Express, React, dan Node.js — yang seluruhnya ditulis dalam TypeScript. Sistem ini diimplementasikan untuk Aisahub Inc.

Sistem memiliki dua peran, yaitu HR dan Employee. Saya masuk sebagai HR. Perlu ditekankan, otorisasi tidak dibaca dari token, melainkan diambil ulang dari basis data pada setiap permintaan. Dashboard menampilkan ringkasan karyawan aktif, pengajuan yang menunggu, serta aktivitas terbaru.

Modul Employees mengelola data karyawan. Terdapat empat karyawan: dua full-time dan dua part-time. Pada halaman detail, data dikelompokkan menjadi Personal, Employment, Education, dan Payment. Yang perlu digarisbawahi, status kepegawaian tidak disimpan sebagai kolom boolean, melainkan sebagai rangkaian riwayat Employment. Penghentian hubungan kerja dilakukan melalui End Employment dengan tanggal efektif, dan seluruh riwayatnya tersimpan.

Modul cuti. Kebijakan yang diterapkan bukan jatah tahunan, melainkan satu hari untuk setiap bulan masa kerja, yang kedaluwarsa delapan belas bulan setelah bulan perolehannya. Pada Budi terlihat tiga puluh hari terkumpul, enam terpakai, dua belas kedaluwarsa, dan dua belas tersisa. Pengambilan cuti berbayar memotong saldo yang paling cepat kedaluwarsa lebih dahulu. Cuti tidak memerlukan persetujuan — begitu diajukan, cuti langsung tercatat, karena yang dicatat memang cuti yang diambil, bukan permohonan.

Hari libur dikelola terpisah dan memengaruhi perhitungan hari kerja. Terdapat empat jenis. Yang penting, cuti bersama tetap dihitung sebagai hari kerja, sehingga cuti yang melewatinya tetap mengurangi saldo maupun gaji.

Karyawan part-time tidak menerima gaji bulanan, melainkan dibayar per jam melalui Daily Logs. Andi dan Dewi mencatat jam kerja harian beserta proyeknya. Catatan ini tidak melalui proses persetujuan dan langsung menjadi dasar perhitungan upah. Sistem membatasi satu catatan untuk setiap karyawan pada setiap tanggal.

Lembur hanya berlaku bagi karyawan full-time dan memerlukan persetujuan HR. Saat ini ada dua pengajuan yang menunggu. Saya setujui pengajuan Budi. Persetujuan ini langsung mengirimkan notifikasi kepada karyawan di dalam transaksi yang sama, sehingga sebuah keputusan tidak mungkin ada tanpa notifikasinya. Lembur yang ditolak tidak ikut dihitung dalam penggajian.

Reimbursement dapat diajukan oleh seluruh karyawan, baik full-time maupun part-time, dan wajib menyertakan bukti. Berkas bukti hanya dapat diunduh oleh pemiliknya atau oleh HR. Saya buka buktinya, lalu saya setujui. Klaim yang disetujui otomatis masuk sebagai komponen penggajian pada periode yang bersesuaian, sedangkan klaim yang ditolak tidak ikut dihitung.

Modul penggajian. Periode mengikuti tanggal potong, yaitu dari tanggal dua puluh enam sampai tanggal dua puluh lima bulan berikutnya. Periode Juni sudah difinalisasi, sedangkan periode Juli masih berstatus draft sehingga angkanya dihitung ulang setiap kali dibuka. Kurs dolar diambil dari API publik pada saat periode dibuat, lalu dibekukan agar nilainya tidak berubah.

Perhatikan payslip Sari. Gaji pokok dua belas juta rupiah, lembur dua ratus delapan puluh lima ribu, reimbursement satu koma dua juta, dan potongan dua koma dua delapan juta yang berasal dari dua hari sakit dan dua hari cuti tanpa gaji.

Sekarang saya finalisasi. Finalisasi menyimpan payslip sebagai snapshot, mengirim notifikasi kepada seluruh karyawan, dan mengunci seluruh rentang tanggal periode tersebut. Proses ini tidak dapat dibatalkan. Payslip dapat diunduh dalam bentuk PDF, dan periode dapat diekspor ke CSV untuk keperluan payment gateway.

Manajemen akun berada pada modul Users. Peran ditetapkan saat akun dibuat dan tidak dapat diubah setelahnya, untuk menutup celah otorisasi. Seluruh notifikasi bersifat in-app; sistem ini sama sekali tidak menggunakan surel.

Selanjutnya dari sisi karyawan. Saya keluar, lalu masuk sebagai Budi. Menu yang tampil berbeda: karyawan hanya dapat melihat datanya sendiri. Notifikasi payslip sudah diterima. Pada My Payslips, Budi dapat mengunduh slip gajinya sendiri. Pada My Leave, ia melihat saldo cutinya dan dapat mengajukan cuti baru, dengan konfirmasi yang mengingatkan agar berkoordinasi lebih dahulu dengan tim dan manajer proyeknya.

Demikian demonstrasi Sistem Human Resource Management berbasis PERN Stack ini. Seluruh aturan bisnis diuji melalui lebih dari dua ratus tujuh puluh pengujian otomatis, dan sistem telah di-deploy serta dapat diakses secara publik. Terima kasih atas perhatiannya. Wassalamualaikum warahmatullahi wabarakatuh.

=== AKHIR NASKAH ===

**Jumlah kata:** 637. Pada tempo 140 kata per menit narasi murni ± 4 menit 30 detik; pada
tempo 150 kata per menit ± 4 menit 12 detik. Artinya tersedia sekitar 30 detik kelonggaran
untuk jeda saat mengklik dan menunggu halaman termuat — cukup, tetapi jangan membaca
terburu-buru.

Kalau ternyata masih lewat dari 5 menit, segmen 4 (hari libur) dan segmen 9 (users &
notifikasi) paling aman dipangkas — keduanya tidak dirujuk oleh segmen lain.
