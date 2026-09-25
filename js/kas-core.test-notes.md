# KasCore manual test notes

## Skenario yang dicek

1. Muat `index.html` dan pastikan kartu:
   - Total Penjualan
   - Total Transaksi
   - Total Laba
   - Total Kas Fisik di Laci
   memakai hasil `KasCore`.
2. Muat `page-laporan.html`, pilih rentang tanggal multi-hari, lalu pastikan:
   - data tetap tampil
   - transaksi `voided` dan `cancelled` tidak ikut ringkasan/chart/export
   - query tidak lagi loop per tanggal di kode halaman.
3. Muat `page-kasir.html` dan `page-kasirv2.html`, lalu cek header:
   - penjualan
   - transaksi
   - laba
   - uang global
   sinkron dengan data harian user aktif.
4. Muat `page-kas.html`, `page-kas-shift.html`, dan `page-closing.html`, lalu cek rumus kas fisik:
   - modal awal
   - kas masuk
   - kas keluar
   - penjualan tunai / pembayaran hutang yang sudah diterima
   - top up + admin
   - tarik - admin
5. Muat `page-modal-harian.html` dan cek total ringkasan modal tetap sesuai role filter.

## Validasi teknis

- `js/kas-core.js` diecek sintaks dengan `node --check`.
- Script inline pada halaman yang diubah diekstrak lalu dicek sintaks dengan `node --check`.
- Tidak ada perubahan UI yang disengaja; refactor hanya mengganti sumber perhitungan.
