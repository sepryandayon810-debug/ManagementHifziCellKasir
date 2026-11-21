// Service Worker WebPOS — Cache halaman & aset agar pindah menu cepat & tetap jalan saat offline
const CACHE_NAME = 'webpos-hifzi-v2';  // ubah jadi v2, v3, v4 setiap rilis baru

const CORE_ASSETS = [
  './',
  './index.html',
  './login.html',
  './page-kasir.html',
  './page-produk.html',
  './page-riwayat.html',
  './page-kas.html',
  './page-modal-harian.html',
  './page-kas-masuk.html',
  './page-kas-keluar.html',
  './page-kas-shift.html',
  './page-closing.html',
  './page-kas-topup.html',
  './page-kas-tarik.html',
  './page-pembelian.html',
  './page-hutang.html',
  './page-laporan.html',
  './page-laporan-stok.html',
  './page-laporan-terlaris.html',
  './page-saldo-telegram.html',
  './page-data-pelanggan.html',
  './page-penggajian.html',
  './page-pengguna.html',
  './page-setting.html',
  './page-backup.html',
  './page-log-aktivitas.html',
  './page-printer.html',
  './js/firebase-config.js',
  './js/kas-core.js',
  './js/db-offline.js',
  './js/utils.js',
  './js/auth.js',
  './js/printer.js',
  './js/role-guard.js',
  './js/sidebar-filter.js',
  './js/cordova-shim.js',
  './js/sheets-sync.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-storage-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// 1. INSTALL: simpan halaman & SDK penting ke cache (aman walau ada 1 file gagal)
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        CORE_ASSETS.map(function(url) {
          return cache.add(url).catch(function() { return null; });
        })
      );
    })
  );
});

// 2. ACTIVATE: bersihkan cache versi lama jika nanti CACHE_NAME dinaikkan
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Helper: fetch dengan batas waktu agar sinyal lemot tidak bikin layar macet
function fetchWithTimeout(request, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      reject(new Error('timeout'));
    }, timeoutMs);
    fetch(request, { cache: 'no-cache' }).then(function(res) {
      clearTimeout(timer);
      resolve(res);
    }).catch(function(err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// 3. FETCH: atur strategi cache tanpa mengganggu API Firebase/Google Sheets
self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // JANGAN pernah intercept API database / auth / Google Sheets / Telegram
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('firebasestorage.googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('api.telegram.org')
  ) {
    return;
  }

  // A. File CDN statis (Firebase SDK, Font Awesome, Google Fonts) -> Cache-First (super cepat)
  var isStaticCdn =
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('fonts.googleapis.com');

  if (isStaticCdn) {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(res) {
          if (res && (res.ok || res.type === 'opaque')) {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  // B. Halaman HTML & JS toko kita sendiri -> Network-First (timeout 2.5 detik), fallback ke Cache saat offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetchWithTimeout(req, 2500).then(function(res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function() {
        return caches.match(req, { ignoreSearch: true }).then(function(cached) {
          if (cached) return cached;
          if (req.mode === 'navigate') {
            return caches.match('./page-kasir.html') || caches.match('./index.html');
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      })
    );
  }
});
