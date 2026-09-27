# Base44 Dev Environment

This is a **static HTML + Firebase (compat SDK)** app — no build step, no bundler.
All pages are standalone `.html` files loaded via CDN scripts (Firebase, Font Awesome, Google Fonts).

## Running locally

```
docker compose -f docker-compose.base44.yml up -d
```

Serves the repo root via `nginx:alpine` on host port **3000**. Edits to any `.html`/`.js`
file are reflected on the next browser refresh (no rebuild, no live-reload dev server —
call `reload_preview` after changes if needed).

> The repo root dir must be world-traversable (`chmod 755 .`) so the nginx worker can
> read the bind-mounted files. If you ever see `403 Forbidden`, re-run `chmod 755 .`.

## Architecture notes

- `js/kas-core.js` — **single source of truth** for all cash/financial calculations
  (`window.KasCore`). It is loaded by `index.html`, `page-kasir.html`, `page-kasirv2.html`.
  The approval rules it implements are documented in its header comment block.
- Firebase config/auth is in `js/firebase-config.js` + `js/auth.js`. Pages redirect to
  `login.html` when unauthenticated, so the preview usually lands on the login screen.
- Receipt/struk header settings live in **two** menus and use **different** localStorage keys:
  - `page-setting.html` ("Identitas & Struk Toko") → `webpos_store_*` + Firestore `settings/store`
    + unified `receiptHeader` (added so the kasir struk picks it up).
  - `page-printer.html` ("Printer & Struk") → `webpos_receipt_header`.
  - `page-kasir.html` `loadReceiptHeader()` reads `receiptHeader` → falls back to
    `webpos_receipt_header` → falls back to individual `webpos_store_*` keys.

## Tests

`tests/kas-core.test.js` is **stale** — it targets an older `KasCore` API (`summarizeTransactions`
with `profit` field, `salesServiceTransactionCount`, `cashMutationCount`) that no longer
matches `js/kas-core.js`. It currently fails (`18500 !== 5200`). The current `kas-core.js`
logic is consistent with the approval table; the test file needs rewriting to match the
current API before it can pass.
