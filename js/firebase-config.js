// Konfigurasi Firebase WebPOS (Firestore)
if (!window.firebaseConfigInitialized) {
  window.firebaseConfigInitialized = true;

 const firebaseConfig = {
  apiKey: "AIzaSyCKU4LAF4sEaIMvsvNDTf_kU-7JmprsdMM",
  authDomain: "managementhifzicell.firebaseapp.com",
  projectId: "managementhifzicell",
  storageBucket: "managementhifzicell.firebasestorage.app",
  messagingSenderId: "275855765943",
  appId: "1:275855765943:web:93ed6975a3417fb3c73832"
};

  window.firebaseConfig = firebaseConfig;

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  window.auth = firebase.auth();
  window.db = firebase.firestore();

  // Pastikan sesi login tersimpan lokal permanen di HP/WebView
  try {
    window.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  } catch (e) {}

  // 1. AKTIFKAN OFFLINE PERSISTENCE (Bisa baca data saat tanpa sinyal)
  if (!window.firestorePersistenceEnabled) {
    window.firestorePersistenceEnabled = true;
    window.db.enablePersistence({ synchronizeTabs: true })
      .then(function() {
        console.log("Firestore Offline Persistence: AKTIF");
      })
      .catch(function(err) {
        console.warn("Firestore Persistence warning:", err.code);
      });
  }

  // 1b. PENJAGA SESI LOGIN SAAT OFFLINE (Untuk semua 29 halaman agar pindah menu offline tidak ke-logout)
  function _getCachedOfflineUser() {
    try {
      var raw = localStorage.getItem('webpos_session');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.uid) {
        return {
          uid: parsed.uid,
          email: parsed.email || 'kasir@offline.local',
          displayName: parsed.displayName || '',
          isOfflineSession: true
        };
      }
    } catch (e) {}
    return null;
  }

  if (window.auth && typeof window.auth.signOut === 'function' && !window.auth.__offlineGuardWrapped) {
    window.auth.__offlineGuardWrapped = true;

    // Jika user klik Logout asli -> bersihkan sesi lokal
    var _origSignOut = window.auth.signOut.bind(window.auth);
    window.auth.signOut = function() {
      try {
        localStorage.removeItem('webpos_session');
        localStorage.removeItem('webpos_last_uid');
        localStorage.removeItem('webpos_last_username');
      } catch (e) {}
      return _origSignOut.apply(window.auth, arguments);
    };

    // Jika offline dan masih ada sesi login tersimpan -> jangan lempar ke login.html
    var _origOnAuthStateChanged = window.auth.onAuthStateChanged.bind(window.auth);
    window.auth.onAuthStateChanged = function(nextOrObserver, error, completed) {
      var cb = (typeof nextOrObserver === 'function')
        ? nextOrObserver
        : (nextOrObserver && typeof nextOrObserver.next === 'function' ? nextOrObserver.next.bind(nextOrObserver) : null);
      if (!cb) return _origOnAuthStateChanged(nextOrObserver, error, completed);

      return _origOnAuthStateChanged(function(user) {
        if (user && user.uid) {
          try {
            localStorage.setItem('webpos_session', JSON.stringify({
              uid: user.uid,
              email: user.email || '',
              displayName: user.displayName || ''
            }));
            localStorage.setItem('webpos_last_uid', user.uid);
            if (user.displayName) localStorage.setItem('webpos_last_username', user.displayName);
          } catch (e) {}
          cb(user);
          return;
        }
        if (!navigator.onLine) {
          var offlineUser = _getCachedOfflineUser();
          if (offlineUser) {
            cb(offlineUser);
            return;
          }
        }
        cb(null);
      }, error, completed);
    };

    // Simpan sesi begitu auth siap saat online
    window.auth.onAuthStateChanged(function() {});
  }

  // 2. OTOMATIS UPLOAD SEMUA TRANSAKSI PENDING KE FIRESTORE SAAT ONLINE (SATU PINTU UNTUK SEMUA HALAMAN)
  function _getPendingOfflineList() {
    try {
      var list = JSON.parse(localStorage.getItem('webpos_pending_transactions') || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function _removePendingOfflineById(localId) {
    try {
      var list = _getPendingOfflineList().filter(function(x) { return x && x.localId !== localId; });
      localStorage.setItem('webpos_pending_transactions', JSON.stringify(list));
    } catch (e) {}
  }

  window.syncPendingTransactionsToFirestore = async function() {
    if (!navigator.onLine || !window.db) return { total: 0, synced: 0, failed: 0 };
    if (window.__isSyncingOfflineTx) return { total: 0, synced: 0, failed: 0, busy: true };

    var pending = _getPendingOfflineList();
    if (!pending || pending.length === 0) return { total: 0, synced: 0, failed: 0 };

    window.__isSyncingOfflineTx = true;
    var synced = 0;
    var failed = 0;

    try {
      console.log("Ada " + pending.length + " transaksi offline. Memulai upload ke Firestore...");
      var currentUser = (window.auth && window.auth.currentUser) ? window.auth.currentUser : null;
      var fallbackUid = (currentUser && currentUser.uid) || localStorage.getItem('webpos_last_uid') || 'unknown';

      for (var i = 0; i < pending.length; i++) {
        var item = pending[i];
        if (!item || !item.data) continue;

        try {
          var raw = item.data;
          var nowMs = Number(raw.waktu || raw.timestamp || Date.now());
          var dObj = new Date(nowMs);
          var fallbackDate = dObj.getFullYear() + '-' +
            String(dObj.getMonth() + 1).padStart(2, '0') + '-' +
            String(dObj.getDate()).padStart(2, '0');

          var docId = String(item.localId || raw.localId || ('local_' + nowMs + '_' + i));
          var txRef = window.db.collection('transactions').doc(docId);

          // Cek apakah sudah pernah masuk agar tidak dobel & stok tidak terpotong 2x
          var existingSnap = await txRef.get();

          if (!existingSnap.exists) {
            var dataKirim = Object.assign({}, raw);
            delete dataKirim.localId;
            delete dataKirim.id;

            dataKirim.userId = dataKirim.userId || fallbackUid;
            dataKirim.waktu = nowMs;
            dataKirim.created_at = dataKirim.created_at || nowMs;
            dataKirim.timestamp = dataKirim.timestamp || nowMs;
            dataKirim.date = dataKirim.date || dataKirim.date_key || fallbackDate;
            dataKirim.date_key = dataKirim.date_key || dataKirim.date || fallbackDate;
            dataKirim.status = 'completed';
            dataKirim.syncedFromOffline = true;
            dataKirim.syncedAt = firebase.firestore.FieldValue.serverTimestamp();

            // 1. Upload ke koleksi yang BENAR: 'transactions' dengan ID tetap (anti dobel)
            await txRef.set(dataKirim, { merge: true });

            // 2. Kurangi stok & tambah soldCount di Firestore untuk produk non-manual & non-unlimited
            if (Array.isArray(dataKirim.items)) {
              for (var j = 0; j < dataKirim.items.length; j++) {
                var prodItem = dataKirim.items[j];
                if (!prodItem || !prodItem.productId || prodItem.isManual || prodItem.isUnlimited) continue;
                var qty = Number(prodItem.quantity || 0);
                if (qty <= 0) continue;
                try {
                  var prodRef = window.db.collection('products').doc(String(prodItem.productId));
                  var prodSnap = await prodRef.get();
                  if (prodSnap.exists) {
                    var prodData = prodSnap.data() || {};
                    if (!prodData.isUnlimited) {
                      await prodRef.update({
                        stock: Math.max(0, (Number(prodData.stock) || 0) - qty),
                        soldCount: (Number(prodData.soldCount) || 0) + qty
                      });
                    }
                  }
                } catch (stockErr) {
                  console.warn("Gagal potong stok saat sync untuk produk:", prodItem.productId, stockErr);
                }
              }
            }
          }

          // 3. Hapus dari antrean lokal setelah sukses di Firestore
          _removePendingOfflineById(item.localId);
          synced++;
        } catch (itemErr) {
          failed++;
          console.error("Gagal sync 1 transaksi offline:", item.localId, itemErr);
        }
      }

      if (synced > 0) {
        console.log(synced + " transaksi offline berhasil tersinkron ke Firestore!");
        window.dispatchEvent(new CustomEvent('webpos:offline-synced', { detail: { total: pending.length, synced: synced, failed: failed } }));
      }
      return { total: pending.length, synced: synced, failed: failed };
    } finally {
      window.__isSyncingOfflineTx = false;
    }
  };

  // Deteksi otomatis saat sinyal internet kembali masuk (di semua halaman)
  window.addEventListener('online', function() {
    window.syncPendingTransactionsToFirestore();
  });
  // Cek juga saat halaman baru dibuka (jika masih ada antrean offline tertinggal)
  setTimeout(function() {
    window.syncPendingTransactionsToFirestore();
  }, 4000);
  
  try {
    window.storage = firebase.storage();
  } catch(e) {
    window.storage = null;
  }
}

// Gunakan window agar tidak terjadi error "already been declared"
var auth = window.auth;
var db = window.db;
var storage = window.storage;

// 3. DAFTARKAN SERVICE WORKER + AUTO-DETECT UPDATE GITHUB OTOMATIS (Tanpa perlu ganti v1/v2 manual)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', function() {
    var hadController = Boolean(navigator.serviceWorker.controller);
    var updateNotifShown = false;
    var latestDetectedBuild = '';
    var lastCheckAt = 0;

    function showAppUpdateBanner() {
      if (updateNotifShown || document.getElementById('webposUpdateBanner')) return;
      updateNotifShown = true;
      var bar = document.createElement('div');
      bar.id = 'webposUpdateBanner';
      bar.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:76px', 'transform:translateX(-50%)',
        'z-index:99999', 'background:#0f172a', 'color:#fff',
        'padding:10px 14px', 'border-radius:12px',
        'box-shadow:0 10px 25px rgba(0,0,0,0.28)',
        'display:flex', 'align-items:center', 'gap:10px',
        'font-family:inherit', 'font-size:13px', 'max-width:92vw',
        'border:1px solid rgba(255,255,255,0.15)'
      ].join(';');
      bar.innerHTML =
        '<span style="line-height:1.3;">✨ <b>Aplikasi diperbarui</b> ke versi terbaru!</span>' +
        '<button type="button" id="btnReloadWebposUpdate" style="background:#22c55e;color:#fff;border:none;padding:6px 12px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap;">Muat Ulang</button>' +
        '<button type="button" id="btnCloseWebposUpdate" style="background:transparent;color:#94a3b8;border:none;font-size:16px;line-height:1;cursor:pointer;padding:0 4px;">&times;</button>';
      document.body.appendChild(bar);

      var btnReload = document.getElementById('btnReloadWebposUpdate');
      var btnClose = document.getElementById('btnCloseWebposUpdate');
      if (btnReload) {
        btnReload.onclick = function() {
          if (latestDetectedBuild) {
            try { localStorage.setItem('webpos_last_build_ver', latestDetectedBuild); } catch (e) {}
          }
          window.location.reload();
        };
      }
      if (btnClose) btnClose.onclick = function() { bar.remove(); };
    }

    // Cek otomatis stempel deploy terbaru dari GitHub Pages (tanpa perlu edit sw.js!)
    function checkGithubBuildUpdate(force) {
      if (!navigator.onLine) return;
      var now = Date.now();
      if (!force && (now - lastCheckAt) < 60000) return; // maksimal cek 1x per menit agar hemat kuota
      lastCheckAt = now;

      fetch('./index.html?_chk=' + now, { method: 'HEAD', cache: 'no-store' })
        .then(function(res) {
          if (!res || !res.ok) return;
          var serverBuild = res.headers.get('last-modified') || res.headers.get('etag') || '';
          if (!serverBuild) return;

          var savedBuild = '';
          try { savedBuild = localStorage.getItem('webpos_last_build_ver') || ''; } catch (e) {}

          if (!savedBuild) {
            // Pertama kali simpan versi dasar tanpa munculkan popup
            try { localStorage.setItem('webpos_last_build_ver', serverBuild); } catch (e) {}
          } else if (savedBuild !== serverBuild) {
            latestDetectedBuild = serverBuild;
            showAppUpdateBanner();
          }
        })
        .catch(function() {});
    }

    navigator.serviceWorker.register('./sw.js').then(function(reg) {
      console.log('Service Worker: AKTIF');

      window.addEventListener('online', function() {
        try { reg.update(); } catch (e) {}
        checkGithubBuildUpdate(true);
      });

      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
          checkGithubBuildUpdate(false);
        }
      });

      reg.addEventListener('updatefound', function() {
        var newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'installed' && hadController) {
            showAppUpdateBanner();
          }
        });
      });
    }).catch(function(err) {
      console.warn('Service Worker gagal daftar:', err);
    });

    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (hadController) showAppUpdateBanner();
    });

    // Cek otomatis 2 detik setelah halaman terbuka
    setTimeout(function() { checkGithubBuildUpdate(true); }, 2000);
  });
}


// 4. AUTO-UPGRADE IKON SIDEBAR & BOTTOM BAR MENJADI 3D GLOSSY BERWARNA (OTOMATIS UNTUK SEMUA 29 HALAMAN)
(function() {
  if (window.__webpos3dNavInit) return;
  window.__webpos3dNavInit = true;

  var ICON_TEMPLATES = {
    home: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#D97706"/></linearGradient><linearGradient id="__ID__b" x1="10" y1="18" x2="38" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><path d="M10 22V39C10 41.2 11.8 43 14 43H34C36.2 43 38 41.2 38 39V22L24 11L10 22Z" fill="url(#__ID__b)"/><rect x="19.5" y="29" width="9" height="14" rx="4.5" fill="#FEF08A" stroke="#FFFFFF" stroke-width="1.4"/><path d="M6 23.5L22.2 9.4C23.2 8.5 24.8 8.5 25.8 9.4L42 23.5C43 24.4 42.4 26 41 26H38L24 13.8L10 26H7C5.6 26 5 24.4 6 23.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/></svg>',

    calculator: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="5" x2="40" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#38BDF8"/><stop offset="55%" stop-color="#0284C7"/><stop offset="100%" stop-color="#0369A1"/></linearGradient><linearGradient id="__ID__b" x1="14" y1="10" x2="34" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#E0F2FE"/><stop offset="100%" stop-color="#7DD3FC"/></linearGradient><linearGradient id="__ID__c" x1="28" y1="28" x2="36" y2="39" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="100%" stop-color="#F59E0B"/></linearGradient></defs><rect x="9" y="5" width="30" height="38" rx="7" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><rect x="14" y="10" width="20" height="8.5" rx="2.8" fill="url(#__ID__b)"/><circle cx="16.5" cy="24.5" r="2.6" fill="#FFFFFF" fill-opacity="0.9"/><circle cx="24" cy="24.5" r="2.6" fill="#FFFFFF" fill-opacity="0.9"/><circle cx="31.5" cy="24.5" r="2.6" fill="#FFFFFF" fill-opacity="0.9"/><circle cx="16.5" cy="31.5" r="2.6" fill="#FFFFFF" fill-opacity="0.9"/><circle cx="24" cy="31.5" r="2.6" fill="#FFFFFF" fill-opacity="0.9"/><circle cx="16.5" cy="37.8" r="2.4" fill="#BAE6FD"/><circle cx="24" cy="37.8" r="2.4" fill="#BAE6FD"/><rect x="28.8" y="29" width="5.4" height="11" rx="2.7" fill="url(#__ID__c)"/></svg>',

    box: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><path d="M24 5L42 14.5L24 24L6 14.5L24 5Z" fill="#FEF08A"/><path d="M6 14.5L24 24V43L6 33.5V14.5Z" fill="#F59E0B"/><path d="M42 14.5L24 24V43L42 33.5V14.5Z" fill="#B45309"/><path d="M15 9.8L33 19.3V26.5L28 24V21.7L10 12.2L15 9.8Z" fill="#FFFFFF" fill-opacity="0.92"/><path d="M24 5L42 14.5L24 24L6 14.5L24 5Z" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="1.2" stroke-linejoin="round"/></svg>',

    boxes: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><path d="M24 4L35 9.8L24 15.6L13 9.8L24 4Z" fill="#93C5FD"/><path d="M13 9.8L24 15.6V26L13 20.2V9.8Z" fill="#3B82F6"/><path d="M35 9.8L24 15.6V26L35 20.2V9.8Z" fill="#1D4ED8"/><path d="M15 21L25 26.2L15 31.4L5 26.2L15 21Z" fill="#FEF08A"/><path d="M5 26.2L15 31.4V42.5L5 37.3V26.2Z" fill="#F59E0B"/><path d="M25 26.2L15 31.4V42.5L25 37.3V26.2Z" fill="#B45309"/><path d="M33 21L43 26.2L33 31.4L23 26.2L33 21Z" fill="#6EE7B7"/><path d="M23 26.2L33 31.4V42.5L23 37.3V26.2Z" fill="#10B981"/><path d="M43 26.2L33 31.4V42.5L43 37.3V26.2Z" fill="#047857"/></svg>',

    history: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#A5B4FC"/><stop offset="50%" stop-color="#6366F1"/><stop offset="100%" stop-color="#3730A3"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M11 16C14.5 10 21 8 28 9C33 9.8 36.5 12.5 38 16C31 13 18.5 13 11 16Z" fill="#FFFFFF" fill-opacity="0.26"/><circle cx="24" cy="24" r="13.5" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M24 14.5V24.5L31 28.5" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24.5" r="2.6" fill="#FEF08A"/></svg>',

    log: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="6" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#5EEAD4"/><stop offset="55%" stop-color="#14B8A6"/><stop offset="100%" stop-color="#0F766E"/></linearGradient></defs><rect x="9" y="8" width="30" height="35" rx="6.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><rect x="17" y="4.5" width="14" height="6.5" rx="3" fill="#FEF08A" stroke="#FFFFFF" stroke-width="1.4"/><rect x="15" y="18" width="18" height="3" rx="1.5" fill="#FFFFFF" fill-opacity="0.92"/><rect x="15" y="25" width="14" height="2.8" rx="1.4" fill="#CCFBF1"/><rect x="15" y="32" width="11" height="2.8" rx="1.4" fill="#FFFFFF" fill-opacity="0.7"/></svg>',

    wallet: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="10" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient><linearGradient id="__ID__b" x1="28" y1="20" x2="43" y2="33" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><rect x="7" y="9" width="30" height="12" rx="4.5" fill="#065F46"/><rect x="5" y="13" width="36" height="27" rx="7" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M10 15.5H36C38 15.5 39 16.8 39 18.8V19.4C31 17.5 16 17.5 7 19.4V18.8C7 16.8 8 15.5 10 15.5Z" fill="#FFFFFF" fill-opacity="0.24"/><rect x="29" y="22.5" width="14" height="9" rx="4.5" fill="url(#__ID__b)" stroke="#FFFFFF" stroke-width="1.4"/><circle cx="34" cy="27" r="2" fill="#FFFFFF"/></svg>',

    cart: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="16" y1="6" x2="34" y2="21" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="100%" stop-color="#D97706"/></linearGradient><linearGradient id="__ID__b" x1="6" y1="14" x2="43" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60A5FA"/><stop offset="55%" stop-color="#2563EB"/><stop offset="100%" stop-color="#1E40AF"/></linearGradient></defs><rect x="17" y="7" width="16" height="13" rx="3.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><path d="M6 12H11.5L15.2 30.5C15.6 32.4 17.2 33.8 19.2 33.8H36.8C38.6 33.8 40.2 32.5 40.6 30.7L43 19.5H13" fill="url(#__ID__b)" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="19" cy="40" r="3.6" fill="#1E40AF" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="35.5" cy="40" r="3.6" fill="#1E40AF" stroke="#FFFFFF" stroke-width="1.5"/></svg>',

    debt: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="36" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FCD34D"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient><linearGradient id="__ID__b" x1="25" y1="22" x2="43" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="100%" stop-color="#CA8A04"/></linearGradient></defs><rect x="7" y="7" width="28" height="34" rx="6" fill="url(#__ID__a)"/><rect x="13" y="16" width="16" height="2.8" rx="1.4" fill="#FFFFFF" fill-opacity="0.9"/><rect x="13" y="22.5" width="12" height="2.6" rx="1.3" fill="#FEF3C7"/><circle cx="34" cy="33" r="9.5" fill="url(#__ID__b)" stroke="#FFFFFF" stroke-width="1.7"/><path d="M34 28.5V37.5M31.3 31.2C31.3 30 32.5 29.3 34 29.3C35.5 29.3 36.7 30 36.7 31.2C36.7 32.5 35.5 32.8 34 33.1C32.5 33.4 31.3 33.8 31.3 35C31.3 36.2 32.5 36.8 34 36.8C35.5 36.8 36.7 36.2 36.7 35" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round"/></svg>',

    chart: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="22" x2="17" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#7DD3FC"/><stop offset="100%" stop-color="#0284C7"/></linearGradient><linearGradient id="__ID__b" x1="20" y1="14" x2="29" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="100%" stop-color="#059669"/></linearGradient><linearGradient id="__ID__c" x1="32" y1="7" x2="41" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><rect x="7" y="23" width="9.5" height="17" rx="3.2" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.3"/><rect x="19.3" y="15" width="9.5" height="25" rx="3.2" fill="url(#__ID__b)" stroke="#FFFFFF" stroke-width="1.3"/><rect x="31.5" y="7" width="9.5" height="33" rx="3.2" fill="url(#__ID__c)" stroke="#FFFFFF" stroke-width="1.3"/><rect x="5" y="38.5" width="38" height="4" rx="2" fill="#334155"/></svg>',

    crown: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="10" x2="42" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="50%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><path d="M7 16L16.5 23.5L24 10L31.5 23.5L41 16L37.5 37C37.2 38.7 35.7 40 34 40H14C12.3 40 10.8 38.7 10.5 37L7 16Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><circle cx="24" cy="10" r="3" fill="#FEF9C3" stroke="#FFFFFF" stroke-width="1.2"/><circle cx="7" cy="15.5" r="2.6" fill="#FDE047" stroke="#FFFFFF" stroke-width="1.1"/><circle cx="41" cy="15.5" r="2.6" fill="#FDE047" stroke="#FFFFFF" stroke-width="1.1"/><circle cx="24" cy="31" r="3" fill="#F43F5E" stroke="#FFFFFF" stroke-width="1.2"/><circle cx="15.5" cy="32" r="2" fill="#38BDF8"/><circle cx="32.5" cy="32" r="2" fill="#34D399"/></svg>',

    telegram: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#7DD3FC"/><stop offset="50%" stop-color="#0EA5E9"/><stop offset="100%" stop-color="#0369A1"/></linearGradient></defs><circle cx="24" cy="24" r="20" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M11 16C14.5 9.5 21 7.5 28.5 8.5C33.5 9.2 37.5 12 39 16C31.5 12.8 18.5 12.8 11 16Z" fill="#FFFFFF" fill-opacity="0.28"/><path d="M35.5 14.5L30.8 34.8C30.4 36.4 29.5 36.8 28.1 36L20.9 30.7L17.4 34C17 34.4 16.7 34.7 16 34.7L16.5 27.4L29.8 15.4C30.4 14.9 29.7 14.6 28.9 15.1L12.5 25.4L5.5 23.2C4 22.7 4 21.7 5.8 21L33.4 10.4C34.7 9.9 35.9 10.7 35.5 14.5Z" fill="#FFFFFF" transform="translate(2.5 2) scale(0.9)"/></svg>',

    users: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="22" y1="10" x2="43" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#F9A8D4"/><stop offset="100%" stop-color="#DB2777"/></linearGradient><linearGradient id="__ID__b" x1="5" y1="8" x2="33" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#F472B6"/><stop offset="55%" stop-color="#EC4899"/><stop offset="100%" stop-color="#9D174D"/></linearGradient></defs><circle cx="33.5" cy="18.5" r="5.5" fill="url(#__ID__a)"/><path d="M26 37.5C26 31.8 29.4 28 34.5 28C39.6 28 43 31.8 43 37.5C43 39.2 41.6 40.5 40 40.5H28.5C27.1 40.5 26 39.2 26 37.5Z" fill="url(#__ID__a)"/><circle cx="19" cy="16.5" r="7.5" fill="url(#__ID__b)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M6 37.5C6 30.2 11.4 25.5 19 25.5C26.6 25.5 32 30.2 32 37.5C32 39.7 30.2 41.5 28 41.5H10C7.8 41.5 6 39.7 6 37.5Z" fill="url(#__ID__b)" stroke="#FFFFFF" stroke-width="1.5"/></svg>',

    payroll: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="5" y1="10" x2="43" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#059669"/><stop offset="100%" stop-color="#065F46"/></linearGradient><linearGradient id="__ID__b" x1="18" y1="17" x2="30" y2="31" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><rect x="5" y="11" width="38" height="26" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="9" y="15" width="30" height="18" rx="3" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="1.4"/><circle cx="24" cy="24" r="6.5" fill="url(#__ID__b)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M24 20.8V27.2M22.2 22.8C22.2 22 23 21.6 24 21.6C25 21.6 25.8 22 25.8 22.8C25.8 23.6 25 23.9 24 24.1C23 24.3 22.2 24.6 22.2 25.4C22.2 26.2 23 26.6 24 26.6C25 26.6 25.8 26.2 25.8 25.4" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round"/></svg>',

    usercog: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="34" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C4B5FD"/><stop offset="55%" stop-color="#8B5CF6"/><stop offset="100%" stop-color="#5B21B6"/></linearGradient><linearGradient id="__ID__b" x1="27" y1="25" x2="43" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="100%" stop-color="#2563EB"/></linearGradient></defs><circle cx="20" cy="15.5" r="7.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M7 37C7 30 12.5 25.5 20 25.5C27.5 25.5 33 30 33 37C33 39.2 31.2 41 29 41H11C8.8 41 7 39.2 7 37Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="35" cy="34" r="7.5" fill="url(#__ID__b)" stroke="#FFFFFF" stroke-width="1.6"/><circle cx="35" cy="34" r="2.8" fill="#FEF08A"/></svg>',

    cog: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="50%" stop-color="#3B82F6"/><stop offset="100%" stop-color="#1E3A8A"/></linearGradient><linearGradient id="__ID__b" x1="17" y1="17" x2="31" y2="31" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="100%" stop-color="#F59E0B"/></linearGradient></defs><path d="M21 5.5H27L28.6 10.6C29.9 11 31.1 11.5 32.2 12.2L37 9.8L41.2 14L38.8 18.8C39.5 19.9 40 21.1 40.4 22.4L45.5 24V30L40.4 31.6C40 32.9 39.5 34.1 38.8 35.2L41.2 40L37 44.2L32.2 41.8C31.1 42.5 29.9 43 28.6 43.4L27 48.5H21L19.4 43.4C18.1 43 16.9 42.5 15.8 41.8L11 44.2L6.8 40L9.2 35.2C8.5 34.1 8 32.9 7.6 31.6L2.5 30V24L7.6 22.4C8 21.1 8.5 19.9 9.2 18.8L6.8 14L11 9.8L15.8 12.2C16.9 11.5 18.1 11 19.4 10.6L21 5.5Z" transform="translate(0 -3) scale(0.92) translate(2 2)" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/><circle cx="24" cy="24" r="7" fill="url(#__ID__b)" stroke="#FFFFFF" stroke-width="1.8"/></svg>',

    cloud: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="10" x2="42" y2="39" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#BAE6FD"/><stop offset="50%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0284C7"/></linearGradient></defs><path d="M14.5 38H35C39.7 38 43 34.6 43 30.2C43 26.2 40.1 23 36.2 22.4C35 15.5 29.1 10.5 22.2 10.5C15.1 10.5 9.4 15.8 8.6 22.6C6.4 24.1 5 26.7 5 29.6C5 34.3 9.2 38 14.5 38Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><path d="M24 33V20M19 25L24 19.5L29 25" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    print: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="16" x2="42" y2="36" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#94A3B8"/><stop offset="55%" stop-color="#475569"/><stop offset="100%" stop-color="#1E293B"/></linearGradient></defs><rect x="13" y="6" width="22" height="12" rx="2.5" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5"/><rect x="6" y="16" width="36" height="18" rx="5.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><circle cx="35.5" cy="22.5" r="2.2" fill="#4ADE80"/><rect x="13" y="27" width="22" height="15" rx="2.5" fill="#FFFFFF" stroke="#94A3B8" stroke-width="1.5"/><rect x="17" y="31.5" width="14" height="2.2" rx="1.1" fill="#3B82F6"/><rect x="17" y="36" width="10" height="2.2" rx="1.1" fill="#94A3B8"/></svg>',

    trash: '<svg class="nav-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="9" y1="13" x2="39" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="50%" stop-color="#F43F5E"/><stop offset="100%" stop-color="#BE123C"/></linearGradient></defs><rect x="17" y="6" width="14" height="5" rx="2.5" fill="#E11D48" stroke="#FFFFFF" stroke-width="1.3"/><rect x="8" y="10" width="32" height="5.5" rx="2.7" fill="#FB7185" stroke="#FFFFFF" stroke-width="1.3"/><path d="M11 16H37L34.8 39.2C34.6 41.3 32.8 43 30.6 43H17.4C15.2 43 13.4 41.3 13.2 39.2L11 16Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><path d="M19 22V36.5M24 22V36.5M29 22V36.5" stroke="#FFFFFF" stroke-opacity="0.85" stroke-width="2.4" stroke-linecap="round"/></svg>'
  };

  function resolveIconKey(el) {
    var cls = el.className || '';
    var parentLink = el.closest ? el.closest('a') : null;
    var menuAttr = parentLink ? (parentLink.getAttribute('data-menu') || '').toLowerCase() : '';
    var hrefAttr = parentLink ? (parentLink.getAttribute('href') || '').toLowerCase() : '';

    if (menuAttr === 'log-aktivitas' || hrefAttr.indexOf('log-aktivitas') !== -1) return 'log';
    if (cls.indexOf('fa-home') !== -1) return 'home';
    if (cls.indexOf('fa-calculator') !== -1 || cls.indexOf('fa-cash-register') !== -1) return 'calculator';
    if (cls.indexOf('fa-boxes') !== -1) return 'boxes';
    if (cls.indexOf('fa-box') !== -1) return 'box';
    if (cls.indexOf('fa-history') !== -1) return 'history';
    if (cls.indexOf('fa-wallet') !== -1) return 'wallet';
    if (cls.indexOf('fa-shopping-cart') !== -1) return 'cart';
    if (cls.indexOf('fa-hand-holding-usd') !== -1) return 'debt';
    if (cls.indexOf('fa-chart-bar') !== -1) return 'chart';
    if (cls.indexOf('fa-crown') !== -1) return 'crown';
    if (cls.indexOf('fa-telegram') !== -1) return 'telegram';
    if (cls.indexOf('fa-user-cog') !== -1) return 'usercog';
    if (cls.indexOf('fa-users') !== -1) return 'users';
    if (cls.indexOf('fa-money-check-alt') !== -1) return 'payroll';
    if (cls.indexOf('fa-cog') !== -1) return 'cog';
    if (cls.indexOf('fa-cloud-upload-alt') !== -1) return 'cloud';
    if (cls.indexOf('fa-print') !== -1) return 'print';
    if (cls.indexOf('fa-trash-alt') !== -1) return 'trash';
    return null;
  }

  function apply3DNavIcons() {
    if (!document.getElementById('webpos3dNavStyle')) {
      var st = document.createElement('style');
      st.id = 'webpos3dNavStyle';
      st.textContent = [
        '.nav-3d-svg{display:inline-block;flex-shrink:0;transition:transform .18s ease,filter .18s ease;filter:drop-shadow(0 2px 3px rgba(15,23,42,0.18));}',
        'aside .nav-link .nav-3d-svg,aside .nav-dropdown-toggle .nav-3d-svg{width:20px;height:20px;}',
        'aside .nav-link:hover .nav-3d-svg,aside .nav-dropdown-toggle:hover .nav-3d-svg{transform:scale(1.12);}',
        'aside .nav-link.active .nav-3d-svg{filter:drop-shadow(0 2px 5px rgba(255,255,255,0.45));transform:scale(1.06);}',
        '.mobile-bar a .nav-3d-svg,.mobile-nav a .nav-3d-svg{width:22px;height:22px;margin-bottom:2px;}',
        '.mobile-bar a.active .nav-3d-svg,.mobile-nav a.active .nav-3d-svg{transform:translateY(-2px) scale(1.12);filter:drop-shadow(0 3px 6px rgba(16,185,129,0.35));}'
      ].join('\n');
      document.head.appendChild(st);
    }

    var seq = window.__webpos3dNavSeq || 0;
    var targets = document.querySelectorAll(
      'aside .nav-link > i:not(.dropdown-arrow),' +
      'aside .nav-dropdown-toggle > i:not(.dropdown-arrow),' +
      '.mobile-bar a > i,' +
      '.mobile-nav a > i'
    );

    for (var i = 0; i < targets.length; i++) {
      var iconEl = targets[i];
      if (!iconEl || iconEl.dataset.upgraded3d === '1') continue;
      var key = resolveIconKey(iconEl);
      if (!key || !ICON_TEMPLATES[key]) continue;

      seq++;
      var tpl = ICON_TEMPLATES[key].replace(/__ID__/g, 'n3d_' + seq + '_');
      var wrap = document.createElement('span');
      wrap.innerHTML = tpl;
      var svgNode = wrap.firstElementChild;
      if (svgNode && iconEl.parentNode) {
        iconEl.dataset.upgraded3d = '1';
        iconEl.parentNode.replaceChild(svgNode, iconEl);
      }
    }
    window.__webpos3dNavSeq = seq;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply3DNavIcons);
  } else {
    apply3DNavIcons();
  }
})();

// 5. TAHAP 3: AUTO-UPGRADE HEADER (DARK MODE & LOGOUT) + KARTU STATISTIK, TAB, & JUDUL KARTU DI SEMUA 29 HALAMAN
(function() {
  if (window.__webpos3dGlobalUiInit) return;
  window.__webpos3dGlobalUiInit = true;

  var UI3D = {
    moon: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><path d="M36.5 29.8C34.2 31 31.5 31.7 28.6 31.7C19.6 31.7 12.3 24.4 12.3 15.4C12.3 12.5 13 9.8 14.2 7.5C8.9 10.6 5.5 16.5 5.5 23.2C5.5 33.4 13.8 41.7 24 41.7C30.7 41.7 36.6 38.3 39.7 33C38.7 31.8 37.7 30.6 36.5 29.8Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><circle cx="31" cy="14" r="2.8" fill="#FEF08A"/><circle cx="38" cy="20" r="1.8" fill="#FDE047"/></svg>',

    sun: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#EA580C"/></linearGradient></defs><circle cx="24" cy="24" r="11" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M24 5V10M24 38V43M5 24H10M38 24H43M10.6 10.6L14.2 14.2M33.8 33.8L37.4 37.4M37.4 10.6L33.8 14.2M14.2 33.8L10.6 37.4" stroke="#FBBF24" stroke-width="3.2" stroke-linecap="round"/></svg>',

    logout: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="28" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="55%" stop-color="#F43F5E"/><stop offset="100%" stop-color="#BE123C"/></linearGradient></defs><path d="M25 8H13C9.7 8 7 10.7 7 14V34C7 37.3 9.7 40 13 40H25C27.2 40 29 38.2 29 36V32H23V34H13V14H23V16H29V12C29 9.8 27.2 8 25 8Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.3"/><path d="M21 24H40M34 17.5L40.5 24L34 30.5" stroke="#F43F5E" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    coins: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="6" x2="38" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><circle cx="20" cy="20" r="13.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="29" cy="29" r="13" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M29 23V35M25.8 26.2C25.8 24.8 27.2 24 29 24C30.8 24 32.2 24.8 32.2 26.2C32.2 27.7 30.8 28.2 29 28.6C27.2 29 25.8 29.6 25.8 31C25.8 32.5 27.2 33.4 29 33.4C30.8 33.4 32.2 32.5 32.2 31" stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round"/></svg>',

    wallet: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="10" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><rect x="7" y="9" width="30" height="12" rx="4.5" fill="#065F46"/><rect x="5" y="13" width="36" height="27" rx="7" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="29" y="22.5" width="14" height="9" rx="4.5" fill="#FACC15" stroke="#FFFFFF" stroke-width="1.4"/><circle cx="34" cy="27" r="2" fill="#FFFFFF"/></svg>',

    money: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="5" y1="10" x2="43" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#059669"/><stop offset="100%" stop-color="#065F46"/></linearGradient></defs><rect x="5" y="11" width="38" height="26" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="9" y="15" width="30" height="18" rx="3" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="1.4"/><circle cx="24" cy="24" r="6" fill="#FACC15" stroke="#FFFFFF" stroke-width="1.5"/></svg>',

    receipt: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><path d="M10 8C10 6.3 11.3 5 13 5H35C36.7 5 38 6.3 38 8V42.5L33.5 39L29 42.5L24 39L19 42.5L14.5 39L10 42.5V8Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/><rect x="16" y="13" width="16" height="3" rx="1.5" fill="#FFFFFF"/><rect x="16" y="20" width="12" height="2.8" rx="1.4" fill="#A7F3D0"/><rect x="16" y="27" width="16" height="2.8" rx="1.4" fill="#FEF08A"/></svg>',

    box: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><path d="M24 5L42 14.5L24 24L6 14.5L24 5Z" fill="#FEF08A"/><path d="M6 14.5L24 24V43L6 33.5V14.5Z" fill="#F59E0B"/><path d="M42 14.5L24 24V43L42 33.5V14.5Z" fill="#B45309"/><path d="M15 9.8L33 19.3V26.5L28 24V21.7L10 12.2L15 9.8Z" fill="#FFFFFF" fill-opacity="0.92"/></svg>',

    layers: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><path d="M24 6L42 15L24 24L6 15L24 6Z" fill="#60A5FA" stroke="#FFFFFF" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 23.5L24 32.5L42 23.5" stroke="#8B5CF6" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 32.5L24 41.5L42 32.5" stroke="#10B981" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    cart: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="12" x2="43" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60A5FA"/><stop offset="55%" stop-color="#2563EB"/><stop offset="100%" stop-color="#1E40AF"/></linearGradient></defs><rect x="17" y="7" width="16" height="13" rx="3.5" fill="#FACC15" stroke="#FFFFFF" stroke-width="1.4"/><path d="M6 12H11.5L15.2 30.5C15.6 32.4 17.2 33.8 19.2 33.8H36.8C38.6 33.8 40.2 32.5 40.6 30.7L43 19.5H13" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="19" cy="40" r="3.6" fill="#1E40AF" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="35.5" cy="40" r="3.6" fill="#1E40AF" stroke="#FFFFFF" stroke-width="1.5"/></svg>',

    debt: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="36" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FCD34D"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><rect x="7" y="7" width="28" height="34" rx="6" fill="url(#__ID__a)"/><rect x="13" y="16" width="16" height="2.8" rx="1.4" fill="#FFFFFF"/><rect x="13" y="23" width="12" height="2.6" rx="1.3" fill="#FEF3C7"/><circle cx="34" cy="33" r="9.5" fill="#FACC15" stroke="#FFFFFF" stroke-width="1.8"/></svg>',

    chart: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><rect x="7" y="23" width="9.5" height="17" rx="3.2" fill="#38BDF8" stroke="#FFFFFF" stroke-width="1.3"/><rect x="19.3" y="15" width="9.5" height="25" rx="3.2" fill="#10B981" stroke="#FFFFFF" stroke-width="1.3"/><rect x="31.5" y="7" width="9.5" height="33" rx="3.2" fill="#F59E0B" stroke="#FFFFFF" stroke-width="1.3"/><rect x="5" y="38.5" width="38" height="4" rx="2" fill="#334155"/></svg>',

    trophy: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="10" y1="6" x2="38" y2="34" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><path d="M13 8H35V20C35 26.2 30.1 31 24 31C17.9 31 13 26.2 13 20V8Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M13 12H7.5C7.5 18 10 21.5 13.5 22M35 12H40.5C40.5 18 38 21.5 34.5 22" stroke="#F59E0B" stroke-width="3" stroke-linecap="round"/><rect x="20.5" y="30" width="7" height="7" fill="#D97706"/><rect x="14" y="36.5" width="20" height="5.5" rx="2.7" fill="#B45309" stroke="#FFFFFF" stroke-width="1.3"/></svg>',

    arrowdown: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M24 14V33M16.5 26.5L24 34L31.5 26.5" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    arrowup: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="55%" stop-color="#F43F5E"/><stop offset="100%" stop-color="#BE123C"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M24 34V15M16.5 21.5L24 14L31.5 21.5" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    clock: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#A5B4FC"/><stop offset="55%" stop-color="#6366F1"/><stop offset="100%" stop-color="#3730A3"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M24 14V24.5L31.5 28.5" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24.5" r="2.5" fill="#FEF08A"/></svg>',

    check: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M15.5 24.5L21.5 30.5L33 18" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    warning: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="10" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#DC2626"/></linearGradient></defs><path d="M21.4 8.5C22.6 6.4 25.4 6.4 26.6 8.5L42.2 35.8C43.3 37.8 41.9 40.3 39.6 40.3H8.4C6.1 40.3 4.7 37.8 5.8 35.8L21.4 8.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><rect x="22" y="17.5" width="4" height="11" rx="2" fill="#FFFFFF"/><circle cx="24" cy="33.5" r="2.4" fill="#FFFFFF"/></svg>',

    users: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="36" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#F472B6"/><stop offset="55%" stop-color="#EC4899"/><stop offset="100%" stop-color="#9D174D"/></linearGradient></defs><circle cx="24" cy="16" r="8.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M8 38.5C8 30.8 14.5 26 24 26C33.5 26 40 30.8 40 38.5C40 40.7 38.2 42.5 36 42.5H12C9.8 42.5 8 40.7 8 38.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/></svg>',

    excel: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#16A34A"/><stop offset="100%" stop-color="#14532D"/></linearGradient></defs><rect x="8" y="5" width="32" height="38" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M17 18L31 32M31 18L17 32" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round"/></svg>',

    cloud: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="10" x2="42" y2="39" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#BAE6FD"/><stop offset="50%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0284C7"/></linearGradient></defs><path d="M14.5 38H35C39.7 38 43 34.6 43 30.2C43 26.2 40.1 23 36.2 22.4C35 15.5 29.1 10.5 22.2 10.5C15.1 10.5 9.4 15.8 8.6 22.6C6.4 24.1 5 26.7 5 29.6C5 34.3 9.2 38 14.5 38Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M24 33V20M19 25L24 19.5L29 25" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    print: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="16" x2="42" y2="36" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#94A3B8"/><stop offset="55%" stop-color="#475569"/><stop offset="100%" stop-color="#1E293B"/></linearGradient></defs><rect x="13" y="6" width="22" height="12" rx="2.5" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5"/><rect x="6" y="16" width="36" height="18" rx="5.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><circle cx="35.5" cy="22.5" r="2.2" fill="#4ADE80"/><rect x="13" y="27" width="22" height="15" rx="2.5" fill="#FFFFFF" stroke="#94A3B8" stroke-width="1.5"/><rect x="17" y="31.5" width="14" height="2.2" rx="1.1" fill="#3B82F6"/></svg>',

    store: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="5" y1="7" x2="43" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#EA580C"/></linearGradient></defs><rect x="9" y="20" width="30" height="22" rx="4.5" fill="#38BDF8" stroke="#FFFFFF" stroke-width="1.4"/><rect x="19" y="28" width="10" height="14" rx="2.5" fill="#FFFFFF"/><path d="M5.5 18.5L9.5 8.5C10.1 7.2 11.4 6.5 12.8 6.5H35.2C36.6 6.5 37.9 7.2 38.5 8.5L42.5 18.5C43 19.8 42.3 22 40.5 22H7.5C5.7 22 5 19.8 5.5 18.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/></svg>',

    settings: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="50%" stop-color="#3B82F6"/><stop offset="100%" stop-color="#1E3A8A"/></linearGradient></defs><circle cx="24" cy="24" r="17" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="24" cy="24" r="7" fill="#FEF08A" stroke="#FFFFFF" stroke-width="1.8"/></svg>',

    list: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="6" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#5EEAD4"/><stop offset="55%" stop-color="#14B8A6"/><stop offset="100%" stop-color="#0F766E"/></linearGradient></defs><rect x="9" y="7" width="30" height="35" rx="6.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><rect x="15" y="16" width="18" height="3" rx="1.5" fill="#FFFFFF"/><rect x="15" y="23.5" width="14" height="2.8" rx="1.4" fill="#CCFBF1"/><rect x="15" y="31" width="11" height="2.8" rx="1.4" fill="#FEF08A"/></svg>',

    edit: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><path d="M33.5 7.5L40.5 14.5C41.8 15.8 41.8 17.8 40.5 19.1L20 39.6L8 42.5L10.9 30.5L31.4 10C32.1 9.3 32.8 8.2 33.5 7.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/><path d="M27.5 13.5L34.5 20.5" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/></svg>',

    telegram: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#7DD3FC"/><stop offset="50%" stop-color="#0EA5E9"/><stop offset="100%" stop-color="#0369A1"/></linearGradient></defs><circle cx="24" cy="24" r="20" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M35.5 14.5L30.8 34.8C30.4 36.4 29.5 36.8 28.1 36L20.9 30.7L17.4 34C17 34.4 16.7 34.7 16 34.7L16.5 27.4L29.8 15.4C30.4 14.9 29.7 14.6 28.9 15.1L12.5 25.4L5.5 23.2C4 22.7 4 21.7 5.8 21L33.4 10.4C34.7 9.9 35.9 10.7 35.5 14.5Z" fill="#FFFFFF" transform="translate(2.5 2) scale(0.9)"/></svg>',

    bolt: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="12" y1="5" x2="36" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><path d="M27 5L10 27H23L20 43L38 20H25L27 5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/></svg>',

    exchange: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C4B5FD"/><stop offset="55%" stop-color="#8B5CF6"/><stop offset="100%" stop-color="#5B21B6"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M14 19H33M28 14L33.5 19L28 24" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 29H15M20 24L14.5 29L20 34" stroke="#FEF08A" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function mapGlobalUiKey(el) {
    var c = el.className || '';
    if (c.indexOf('fa-spinner') !== -1) return null;
    if (c.indexOf('fa-coins') !== -1) return 'coins';
    if (c.indexOf('fa-wallet') !== -1) return 'wallet';
    if (c.indexOf('fa-money') !== -1 || c.indexOf('fa-piggy-bank') !== -1) return 'money';
    if (c.indexOf('fa-receipt') !== -1 || c.indexOf('fa-file-invoice') !== -1) return 'receipt';
    if (c.indexOf('fa-layer-group') !== -1 || c.indexOf('fa-boxes') !== -1) return 'layers';
    if (c.indexOf('fa-box') !== -1 || c.indexOf('fa-cube') !== -1 || c.indexOf('fa-warehouse') !== -1) return 'box';
    if (c.indexOf('fa-cart') !== -1) return 'cart';
    if (c.indexOf('fa-hand-holding-usd') !== -1) return 'debt';
    if (c.indexOf('fa-chart') !== -1) return 'chart';
    if (c.indexOf('fa-trophy') !== -1 || c.indexOf('fa-crown') !== -1) return 'trophy';
    if (c.indexOf('fa-arrow-down') !== -1 || c.indexOf('fa-sign-in') !== -1) return 'arrowdown';
    if (c.indexOf('fa-arrow-up') !== -1) return 'arrowup';
    if (c.indexOf('fa-clock') !== -1 || c.indexOf('fa-history') !== -1) return 'clock';
    if (c.indexOf('fa-check-circle') !== -1) return 'check';
    if (c.indexOf('fa-exclamation') !== -1 || c.indexOf('fa-times-circle') !== -1) return 'warning';
    if (c.indexOf('fa-user') !== -1 || c.indexOf('fa-address-book') !== -1) return 'users';
    if (c.indexOf('fa-file-excel') !== -1 || c.indexOf('fa-file-export') !== -1 || c.indexOf('fa-table') !== -1) return 'excel';
    if (c.indexOf('fa-google-drive') !== -1 || c.indexOf('fa-database') !== -1 || c.indexOf('fa-cloud') !== -1) return 'cloud';
    if (c.indexOf('fa-print') !== -1 || c.indexOf('fa-bluetooth') !== -1) return 'print';
    if (c.indexOf('fa-store') !== -1 || c.indexOf('fa-cash-register') !== -1 || c.indexOf('fa-briefcase') !== -1) return 'store';
    if (c.indexOf('fa-cog') !== -1 || c.indexOf('fa-tools') !== -1 || c.indexOf('fa-palette') !== -1 || c.indexOf('fa-language') !== -1 || c.indexOf('fa-keyboard') !== -1 || c.indexOf('fa-shield') !== -1) return 'settings';
    if (c.indexOf('fa-list') !== -1 || c.indexOf('fa-filter') !== -1 || c.indexOf('fa-clipboard') !== -1) return 'list';
    if (c.indexOf('fa-edit') !== -1 || c.indexOf('fa-pen') !== -1 || c.indexOf('fa-plus-circle') !== -1 || c.indexOf('fa-camera') !== -1) return 'edit';
    if (c.indexOf('fa-telegram') !== -1) return 'telegram';
    if (c.indexOf('fa-robot') !== -1 || c.indexOf('fa-bolt') !== -1) return 'bolt';
    if (c.indexOf('fa-exchange') !== -1) return 'exchange';
    return null;
  }

  function applyGlobalUi3D() {
    if (!document.getElementById('webpos3dGlobalUiStyle')) {
      var st = document.createElement('style');
      st.id = 'webpos3dGlobalUiStyle';
      st.textContent = [
        '.ui-3d-svg{display:inline-block;flex-shrink:0;vertical-align:middle;filter:drop-shadow(0 2px 4px rgba(15,23,42,0.2));transition:transform .18s ease;}',
        '.stat-icon:has(> .ui-3d-svg){background:transparent !important;box-shadow:none !important;}',
        '.stat-icon > .ui-3d-svg{width:36px;height:36px;}',
        '.stat-card:hover .stat-icon > .ui-3d-svg{transform:scale(1.1);}',
        '.tab-btn > .ui-3d-svg{width:19px;height:19px;margin-right:4px;}',
        '.card-title > .ui-3d-svg{width:22px;height:22px;margin-right:5px;}',
        '#btnThemeToggle .ui-3d-svg,#btnLogout .ui-3d-svg{width:20px;height:20px;}',
        '#btnThemeToggle:hover .ui-3d-svg,#btnLogout:hover .ui-3d-svg{transform:scale(1.12);}'
      ].join('\n');
      document.head.appendChild(st);
    }

    var seq = window.__webpos3dUiSeq || 0;

    // 1. Tombol Header Dark Mode (Otomatis Bulan 3D <-> Matahari 3D)
    var themeBtn = document.getElementById('btnThemeToggle');
    if (themeBtn && !themeBtn.dataset.upgraded3d) {
      themeBtn.dataset.upgraded3d = '1';
      function renderTheme3d() {
        var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        seq++;
        themeBtn.innerHTML = (isDark ? UI3D.sun : UI3D.moon).replace(/__ID__/g, 'u3d_' + seq + '_');
      }
      renderTheme3d();
      new MutationObserver(renderTheme3d).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    // 2. Tombol Header Logout
    var logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn && !logoutBtn.dataset.upgraded3d) {
      logoutBtn.dataset.upgraded3d = '1';
      seq++;
      logoutBtn.innerHTML = UI3D.logout.replace(/__ID__/g, 'u3d_' + seq + '_');
    }

    // 3. Semua Kartu Statistik, Tab Menu, & Judul Kartu di seluruh 29 halaman
    var icons = document.querySelectorAll('.stat-icon > i, .tab-btn > i, .card-title > i');
    for (var i = 0; i < icons.length; i++) {
      var el = icons[i];
      if (!el || el.id === 'shiftToggleIcon') continue;
      var key = mapGlobalUiKey(el);
      if (!key || !UI3D[key]) continue;
      seq++;
      var wrap = document.createElement('span');
      wrap.innerHTML = UI3D[key].replace(/__ID__/g, 'u3d_' + seq + '_');
      var svg = wrap.firstElementChild;
      if (svg && el.parentNode) el.parentNode.replaceChild(svg, el);
    }

    window.__webpos3dUiSeq = seq;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyGlobalUi3D);
  } else {
    applyGlobalUi3D();
  }
})();
