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
