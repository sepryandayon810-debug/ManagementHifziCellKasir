# kas-core manual verification notes

- Valid `penjualan` transaction is counted in dashboard, kasir header, kas page, and laporan.
- `cancelled` sale is excluded from all shared totals.
- `voided` sale is excluded from all shared totals.
- `kas_masuk` and `kas_keluar` entries are counted with the same shared summary rules.
- `topup` and `tarik` entries include `adminFee` consistently in profit and physical drawer cash calculations.
- Purchase/restock only affects shared cash-out totals when it is recorded as `transactions.type = kas_keluar` (for example `source: pembelian`, `category: pembelian`).
- Daily modal, shift summary, and closing totals reconcile through the same `KasCore.getKasFisikLaci()` / `KasCore.getShiftSummary()` path.
- Dashboard, cashier, and laporan totals should match for the same date scope and valid transaction set.
- Empty datasets should render zero values / empty states without uncaught exceptions.
- Simulated Firebase permission or network failures should degrade gracefully with contextual `console.error(...)` logging and existing toast/error UI behavior.
