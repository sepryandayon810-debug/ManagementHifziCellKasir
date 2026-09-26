# ManagementHifziCellKasir

## Shared cash calculation source

`js/kas-core.js` is the single source of truth for shared cash and financial calculations in this static HTML + Firebase compat project.

It centralizes:

- valid transaction filtering (`cancelled` and `voided` are excluded)
- numeric fallbacks such as `total` vs `amount` and `paymentMethod` vs `paymentType`
- daily and period summaries
- physical drawer cash (`kas fisik laci`)
- shift/closing summaries
- staff performance and daily modal aggregation

Pages currently consuming `KasCore`:

- `index.html`
- `page-kasir.html`
- `page-kasirv2.html`
- `page-laporan.html`
- `page-kas.html`
- `page-kas-shift.html`
- `page-closing.html`
- `page-modal-harian.html`
- `page-kas-masuk.html`
- `page-kas-keluar.html`
- `page-kas-topup.html`
- `page-kas-tarik.html`

When adding a new financial page, prefer calling `window.KasCore` instead of rewriting transaction, kas, modal, or closing formulas inline.
