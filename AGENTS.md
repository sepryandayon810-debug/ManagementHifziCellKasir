# AGENTS.md

## Project Overview
WebPOS / "And POS" — a static HTML/JS Point of Sale web application (Indonesian language). No build step, no backend server, no package.json.

## Architecture
- **Frontend only**: plain HTML pages + vanilla JavaScript, served as static files.
- **Backend**: Firebase (Firestore, Auth, Storage) loaded from CDN (`firebasejs/9.22.0` compat SDK). Config is hardcoded in `js/firebase-config.js`.
- **Auth**: Firebase Auth (email/password). `js/auth.js` redirects unauthenticated users to `login.html`. Login page looks up users in Firestore by username, then signs in with `signInWithEmailAndPassword`.
- **Offline support**: `js/db-offline.js` caches products and pending transactions in localStorage.

## Running the App
```
docker compose -f docker-compose.base44.yml up -d
```
Serves static files via nginx on port 3000. No build step, no migrations, no seeds.

## Key Files
- `index.html` — main dashboard
- `login.html` — login page
- `page-*.html` — individual feature pages (kasir, kas, produk, laporan, etc.)
- `js/firebase-config.js` — Firebase initialization (config hardcoded)
- `js/auth.js` — auth guard
- `js/kasir-*.js` — POS cashier logic

## Notes
- The repo directory has restrictive (700) permissions; nginx must run as root (configured in `nginx.base44.conf`).
- No external secrets needed — Firebase config is embedded in the source.
- No live-reload dev server; edits to static files are visible immediately since nginx serves them directly. Call `reload_preview` after changes if needed.
