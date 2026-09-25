# ManagementHifziCellKasir

## KasCore

Logika perhitungan kas sekarang dipusatkan di `/js/kas-core.js` sebagai single source of truth untuk:

- filter transaksi valid (`cancelled` dan `voided` dikecualikan)
- ringkasan harian (`getDailySummary`)
- ringkasan periode (`getPeriodSummary`)
- kas fisik laci (`getKasFisikLaci`)
- ringkasan shift (`getShiftSummary`)
- performa staf harian (`getStaffPerformanceToday`)
- ringkasan modal harian (`getModalSummary`)

Field transaksi yang distandarkan oleh modul ini:

- identitas user: `userId`, fallback `cashierId` / `cashierID`
- metode bayar: `paymentMethod`, fallback `paymentType`
- nominal utama: `total`, fallback `amount`, fallback `grandTotal`
- laba penjualan: `profit`
- biaya admin layanan: `adminFee`
- tanggal: `date` (`YYYY-MM-DD`)
- waktu: `timestamp`

Halaman yang sudah memakai `KasCore`:

- `index.html`
- `page-laporan.html`
- `page-kasir.html`
- `page-kasirv2.html`
- `page-kas.html`
- `page-kas-shift.html`
- `page-closing.html`
- `page-modal-harian.html`

Untuk halaman baru yang menampilkan angka kas, saldo, penjualan, atau ringkasan shift, gunakan `window.KasCore` dan jangan menulis ulang rumus kas langsung di file HTML.
