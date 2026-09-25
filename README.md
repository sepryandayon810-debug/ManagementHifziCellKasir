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

- jenis transaksi: `type`
- identitas user: `userId`, fallback `cashierId` / `cashierID`
- metode bayar: `paymentMethod`, fallback `paymentType`
- nominal kas diterima: `paymentAmount`
- nominal utama: `total`, fallback `amount`, fallback `grandTotal`
- laba penjualan: `profit`
- biaya admin layanan: `adminFee`
- status transaksi: `status`
- kategori mutasi kas: `category`
- sumber transaksi: `source`
- tanggal: `date` (`YYYY-MM-DD`)
- waktu: `timestamp`
- fallback waktu tambahan: `createdAt`

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
