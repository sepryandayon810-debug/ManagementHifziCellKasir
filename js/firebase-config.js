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

  // 1. AKTIFKAN OFFLINE PERSISTENCE + SMART CACHE-FIRST GLOBAL (SEMUA 28 HALAMAN INSTAN DI HP!)
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

  if (!window.__webposSmartFirestorePatched && window.db) {
    window.__webposSmartFirestorePatched = true;
    try {
      var FAST_CACHE_COLS = {
        users: 1, settings: 1, categories: 1, products: 1,
        saldo_tools_config: 1, customer_directory_v2: 1
      };

      function getColName(ref) {
        try {
          if (ref && typeof ref.path === 'string' && ref.path) {
            return ref.path.split('/')[0];
          }
          var segs = ref && ref._delegate && ref._delegate._query && ref._delegate._query.path && ref._delegate._query.path.segments;
          if (segs && segs.length) return segs[0];
        } catch (e) {}
        return '';
      }

      function wrapGet(proto, isDoc) {
        if (!proto || typeof proto.get !== 'function' || proto.__wposSmartGet) return;
        proto.__wposSmartGet = true;
        var origGet = proto.get;
        proto.get = function(options) {
          // Jika caller menentukan source eksplisit (cache/server), hormati langsung
          if (options && options.source) return origGet.call(this, options);
          var self = this;
          var col = getColName(self);

          // 1. Data master (produk, kategori, user, setting, pelanggan) -> Cache instan (< 0.03 dtk) + refresh diam-diam di background
          if (FAST_CACHE_COLS[col]) {
            return origGet.call(self, { source: 'cache' }).then(function(cacheSnap) {
              var hasData = isDoc ? (cacheSnap && cacheSnap.exists) : (cacheSnap && !cacheSnap.empty);
              if (hasData) {
                if (navigator.onLine) {
                  setTimeout(function() { origGet.call(self, { source: 'server' }).catch(function() {}); }, 250);
                }
                return cacheSnap;
              }
              return origGet.call(self);
            }).catch(function() {
              return origGet.call(self);
            });
          }

          // 2. Data live (transaksi, modal, hutang, kas) -> Coba server maks 1.8 detik, jika sinyal HP pelan langsung tampilkan cache lokal!
          if (!navigator.onLine) {
            return origGet.call(self, { source: 'cache' }).catch(function() { return origGet.call(self); });
          }

         return new Promise(function(resolve, reject) {
            var settled = false;
            var serverPromise = origGet.call(self);
            var fallbackTimer = setTimeout(function() {
              if (settled) return;
              origGet.call(self, { source: 'cache' }).then(function(cacheSnap) {
                var hasData = isDoc ? (cacheSnap && cacheSnap.exists) : (cacheSnap && !cacheSnap.empty);
                if (!settled && hasData) {
                  settled = true;
                  clearTimeout(hardTimer);
                  resolve(cacheSnap);
                }
              }).catch(function() {});
            }, 1800);

            // Hard fail-safe 5.5 detik: walau cache kosong & sinyal HP pelan, jangan biarkan halaman stuck di 95%
            var hardTimer = setTimeout(function() {
              if (settled) return;
              origGet.call(self, { source: 'cache' }).then(function(cacheSnap) {
                if (!settled) {
                  settled = true;
                  resolve(cacheSnap);
                }
              }).catch(function() {
                if (!settled) {
                  settled = true;
                  resolve(isDoc
                    ? { exists: false, id: self.id || '', data: function() { return undefined; } }
                    : { empty: true, size: 0, docs: [], forEach: function() {} }
                  );
                }
              });
            }, 5500);

            serverPromise.then(function(snap) {
              clearTimeout(fallbackTimer);
              clearTimeout(hardTimer);
              if (!settled) { settled = true; resolve(snap); }
            }).catch(function(err) {
              clearTimeout(fallbackTimer);
              clearTimeout(hardTimer);
              if (settled) return;
              origGet.call(self, { source: 'cache' }).then(function(cacheSnap) {
                settled = true;
                resolve(cacheSnap);
              }).catch(function() {
                settled = true;
                reject(err);
              });
            });
          });
        };
      }

      var sampleDoc = window.db.collection('_wpos').doc('_wpos');
      var sampleCol = window.db.collection('_wpos');
      var sampleQuery = sampleCol.limit(1);
      wrapGet(Object.getPrototypeOf(sampleDoc), true);
      wrapGet(Object.getPrototypeOf(sampleQuery), false);
      if (Object.getPrototypeOf(sampleCol) !== Object.getPrototypeOf(sampleQuery)) {
        wrapGet(Object.getPrototypeOf(sampleCol), false);
      }
    } catch (e) {}
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

    // FAST-BOOT AUTH + OFFLINE GUARD: Jangan bikin layar HP macet 20-40 detik menunggu verifikasi auth
    var _origOnAuthStateChanged = window.auth.onAuthStateChanged.bind(window.auth);
    var _isLoginPage = /login\.html$/i.test(window.location.pathname || '');
    window.auth.onAuthStateChanged = function(nextOrObserver, error, completed) {
      var cb = (typeof nextOrObserver === 'function')
        ? nextOrObserver
        : (nextOrObserver && typeof nextOrObserver.next === 'function' ? nextOrObserver.next.bind(nextOrObserver) : null);
      if (!cb) return _origOnAuthStateChanged(nextOrObserver, error, completed);

      var fastUid = null;
      if (!_isLoginPage) {
        var cachedUser = _getCachedOfflineUser();
        if (cachedUser && cachedUser.uid) {
          fastUid = cachedUser.uid;
          setTimeout(function() { cb(cachedUser); }, 0);
        }
      }

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
          // Jika halaman sudah jalan via Fast-Boot dengan UID yang sama, jangan render ulang 2x
          if (fastUid && fastUid === user.uid) return;
          cb(user);
          return;
        }
        if (!navigator.onLine) {
          var offlineUser = _getCachedOfflineUser();
          if (offlineUser) {
            if (fastUid && fastUid === offlineUser.uid) return;
            cb(offlineUser);
            return;
          }
        }
        try { localStorage.removeItem('webpos_session'); } catch (e) {}
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

    // Cek otomatis stempel deploy terbaru dari GitHub Pages (maksimal 1x per 5 menit agar pindah menu bebas request online)
    function checkGithubBuildUpdate(force) {
      if (!navigator.onLine) return;
      var now = Date.now();
      var savedLastChk = 0;
      try { savedLastChk = Number(localStorage.getItem('webpos_last_chk_ts') || 0); } catch (e) {}
      if (!force && ((now - lastCheckAt) < 300000 || (now - savedLastChk) < 300000)) return;
      lastCheckAt = now;
      try { localStorage.setItem('webpos_last_chk_ts', String(now)); } catch (e) {}
      
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

// 5. UNIVERSAL 3D ICON ENGINE v2 — ANTI-DOBEL, PRESISI DALAM KOTAK, + IKON 3D (< / > / ←)
(function() {
  if (window.__webpos3dGlobalUiInit) return;
  window.__webpos3dGlobalUiInit = true;

  var UI3D = {
    moon: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><path d="M36.5 29.8C34.2 31 31.5 31.7 28.6 31.7C19.6 31.7 12.3 24.4 12.3 15.4C12.3 12.5 13 9.8 14.2 7.5C8.9 10.6 5.5 16.5 5.5 23.2C5.5 33.4 13.8 41.7 24 41.7C30.7 41.7 36.6 38.3 39.7 33C38.7 31.8 37.7 30.6 36.5 29.8Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><circle cx="31" cy="14" r="2.8" fill="#FEF08A"/><circle cx="38" cy="20" r="1.8" fill="#FDE047"/></svg>',

    sun: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#EA580C"/></linearGradient></defs><circle cx="24" cy="24" r="11" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M24 5V10M24 38V43M5 24H10M38 24H43M10.6 10.6L14.2 14.2M33.8 33.8L37.4 37.4M37.4 10.6L33.8 14.2M14.2 33.8L10.6 37.4" stroke="#FBBF24" stroke-width="3.2" stroke-linecap="round"/></svg>',

    logout: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="28" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="55%" stop-color="#F43F5E"/><stop offset="100%" stop-color="#BE123C"/></linearGradient></defs><path d="M25 8H13C9.7 8 7 10.7 7 14V34C7 37.3 9.7 40 13 40H25C27.2 40 29 38.2 29 36V32H23V34H13V14H23V16H29V12C29 9.8 27.2 8 25 8Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.3"/><path d="M21 24H40M34 17.5L40.5 24L34 30.5" stroke="#F43F5E" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    menu: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><rect x="6" y="10" width="36" height="6.5" rx="3.2" fill="#10B981"/><rect x="6" y="21" width="28" height="6.5" rx="3.2" fill="#3B82F6"/><rect x="6" y="32" width="36" height="6.5" rx="3.2" fill="#F59E0B"/></svg>',

    chevleft: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="55%" stop-color="#4F46E5"/><stop offset="100%" stop-color="#312E81"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M27.5 15L18.5 24L27.5 33" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    chevright: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="55%" stop-color="#4F46E5"/><stop offset="100%" stop-color="#312E81"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M20.5 15L29.5 24L20.5 33" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    back: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#67E8F9"/><stop offset="55%" stop-color="#2563EB"/><stop offset="100%" stop-color="#1E3A8A"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M33 24H16M22.5 17L15.5 24L22.5 31" stroke="#FFFFFF" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    coins: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="6" x2="38" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><circle cx="20" cy="20" r="13.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="29" cy="29" r="13" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M29 23V35M25.8 26.2C25.8 24.8 27.2 24 29 24C30.8 24 32.2 24.8 32.2 26.2C32.2 27.7 30.8 28.2 29 28.6C27.2 29 25.8 29.6 25.8 31C25.8 32.5 27.2 33.4 29 33.4C30.8 33.4 32.2 32.5 32.2 31" stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round"/></svg>',

    wallet: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="10" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><rect x="7" y="9" width="30" height="12" rx="4.5" fill="#065F46"/><rect x="5" y="13" width="36" height="27" rx="7" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="29" y="22.5" width="14" height="9" rx="4.5" fill="#FACC15" stroke="#FFFFFF" stroke-width="1.4"/><circle cx="34" cy="27" r="2" fill="#FFFFFF"/></svg>',

    money: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="5" y1="10" x2="43" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#059669"/><stop offset="100%" stop-color="#065F46"/></linearGradient></defs><rect x="5" y="11" width="38" height="26" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="9" y="15" width="30" height="18" rx="3" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="1.4"/><circle cx="24" cy="24" r="6" fill="#FACC15" stroke="#FFFFFF" stroke-width="1.5"/></svg>',

    bank: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="55%" stop-color="#2563EB"/><stop offset="100%" stop-color="#1E3A8A"/></linearGradient></defs><path d="M24 6L43 16.5H5L24 6Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/><rect x="8" y="16.5" width="32" height="4" rx="1.5" fill="#60A5FA"/><rect x="10.5" y="21" width="5" height="14.5" rx="1.5" fill="#DBEAFE"/><rect x="21.5" y="21" width="5" height="14.5" rx="1.5" fill="#DBEAFE"/><rect x="32.5" y="21" width="5" height="14.5" rx="1.5" fill="#DBEAFE"/><rect x="5" y="36" width="38" height="6" rx="3" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.3"/></svg>',

    card: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="5" y1="10" x2="43" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#A78BFA"/><stop offset="55%" stop-color="#6366F1"/><stop offset="100%" stop-color="#3730A3"/></linearGradient></defs><rect x="5" y="10" width="38" height="28" rx="6.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="5" y="16.5" width="38" height="6" fill="#1E1B4B" fill-opacity="0.65"/><rect x="10" y="27" width="10" height="6.5" rx="2" fill="#FACC15" stroke="#FFFFFF" stroke-width="1.1"/><circle cx="34" cy="30.2" r="3.5" fill="#FB7185"/><circle cx="37.5" cy="30.2" r="3.5" fill="#FACC15" fill-opacity="0.88"/></svg>',

    qrcode: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#67E8F9"/><stop offset="55%" stop-color="#0EA5E9"/><stop offset="100%" stop-color="#0369A1"/></linearGradient></defs><rect x="6" y="6" width="36" height="36" rx="8" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="11" y="11" width="10" height="10" rx="2.5" fill="#FFFFFF"/><rect x="14" y="14" width="4" height="4" rx="1" fill="#0369A1"/><rect x="27" y="11" width="10" height="10" rx="2.5" fill="#FFFFFF"/><rect x="30" y="14" width="4" height="4" rx="1" fill="#0369A1"/><rect x="11" y="27" width="10" height="10" rx="2.5" fill="#FFFFFF"/><rect x="14" y="30" width="4" height="4" rx="1" fill="#0369A1"/><rect x="27" y="27" width="4.5" height="4.5" rx="1" fill="#FEF08A"/><rect x="33" y="27" width="4" height="10" rx="1.2" fill="#FFFFFF"/><rect x="27" y="33" width="4.5" height="4" rx="1" fill="#FFFFFF"/></svg>',

    barcode: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="10" x2="42" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#94A3B8"/><stop offset="55%" stop-color="#475569"/><stop offset="100%" stop-color="#1E293B"/></linearGradient></defs><rect x="5" y="10" width="38" height="28" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="10" y="15" width="3.5" height="18" rx="1" fill="#FFFFFF"/><rect x="15.5" y="15" width="2" height="18" rx="1" fill="#E2E8F0"/><rect x="19.5" y="15" width="4" height="18" rx="1" fill="#FFFFFF"/><rect x="25.5" y="15" width="2" height="18" rx="1" fill="#E2E8F0"/><rect x="29.5" y="15" width="3.5" height="18" rx="1" fill="#FFFFFF"/><rect x="35" y="15" width="3" height="18" rx="1" fill="#FEF08A"/></svg>',

    receipt: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><path d="M10 8C10 6.3 11.3 5 13 5H35C36.7 5 38 6.3 38 8V42.5L33.5 39L29 42.5L24 39L19 42.5L14.5 39L10 42.5V8Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/><rect x="16" y="13" width="16" height="3" rx="1.5" fill="#FFFFFF"/><rect x="16" y="20" width="12" height="2.8" rx="1.4" fill="#A7F3D0"/><rect x="16" y="27" width="16" height="2.8" rx="1.4" fill="#FEF08A"/></svg>',

    box: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><path d="M24 5L42 14.5L24 24L6 14.5L24 5Z" fill="#FEF08A"/><path d="M6 14.5L24 24V43L6 33.5V14.5Z" fill="#F59E0B"/><path d="M42 14.5L24 24V43L42 33.5V14.5Z" fill="#B45309"/><path d="M15 9.8L33 19.3V26.5L28 24V21.7L10 12.2L15 9.8Z" fill="#FFFFFF" fill-opacity="0.92"/></svg>',

    layers: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><path d="M24 6L42 15L24 24L6 15L24 6Z" fill="#60A5FA" stroke="#FFFFFF" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 23.5L24 32.5L42 23.5" stroke="#8B5CF6" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 32.5L24 41.5L42 32.5" stroke="#10B981" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    cart: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="12" x2="43" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60A5FA"/><stop offset="55%" stop-color="#2563EB"/><stop offset="100%" stop-color="#1E40AF"/></linearGradient></defs><rect x="17" y="7" width="16" height="13" rx="3.5" fill="#FACC15" stroke="#FFFFFF" stroke-width="1.4"/><path d="M6 12H11.5L15.2 30.5C15.6 32.4 17.2 33.8 19.2 33.8H36.8C38.6 33.8 40.2 32.5 40.6 30.7L43 19.5H13" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="19" cy="40" r="3.6" fill="#1E40AF" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="35.5" cy="40" r="3.6" fill="#1E40AF" stroke="#FFFFFF" stroke-width="1.5"/></svg>',

    basket: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="18" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDBA74"/><stop offset="55%" stop-color="#F97316"/><stop offset="100%" stop-color="#C2410C"/></linearGradient></defs><path d="M16 19L21 9M32 19L27 9" stroke="#F59E0B" stroke-width="3.6" stroke-linecap="round"/><path d="M6 20H42L38.5 37.5C38 39.8 36 41.5 33.6 41.5H14.4C12 41.5 10 39.8 9.5 37.5L6 20Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><path d="M16 26V35M24 26V35M32 26V35" stroke="#FFFFFF" stroke-opacity="0.88" stroke-width="2.6" stroke-linecap="round"/></svg>',

    debt: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="36" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FCD34D"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><rect x="7" y="7" width="28" height="34" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><rect x="13" y="16" width="16" height="2.8" rx="1.4" fill="#FFFFFF"/><rect x="13" y="23" width="12" height="2.6" rx="1.3" fill="#FEF3C7"/><circle cx="34" cy="33" r="9.5" fill="#FACC15" stroke="#FFFFFF" stroke-width="1.8"/></svg>',

    chart: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><rect x="7" y="23" width="9.5" height="17" rx="3.2" fill="#38BDF8" stroke="#FFFFFF" stroke-width="1.3"/><rect x="19.3" y="15" width="9.5" height="25" rx="3.2" fill="#10B981" stroke="#FFFFFF" stroke-width="1.3"/><rect x="31.5" y="7" width="9.5" height="33" rx="3.2" fill="#F59E0B" stroke="#FFFFFF" stroke-width="1.3"/><rect x="5" y="38.5" width="38" height="4" rx="2" fill="#334155"/></svg>',

    trophy: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="10" y1="6" x2="38" y2="34" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><path d="M13 8H35V20C35 26.2 30.1 31 24 31C17.9 31 13 26.2 13 20V8Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M13 12H7.5C7.5 18 10 21.5 13.5 22M35 12H40.5C40.5 18 38 21.5 34.5 22" stroke="#F59E0B" stroke-width="3" stroke-linecap="round"/><rect x="20.5" y="30" width="7" height="7" fill="#D97706"/><rect x="14" y="36.5" width="20" height="5.5" rx="2.7" fill="#B45309" stroke="#FFFFFF" stroke-width="1.3"/></svg>',

    star: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="10" y1="6" x2="38" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><path d="M24 5.5L29.6 16.9L42.2 18.7L33.1 27.6L35.2 40.1L24 34.2L12.8 40.1L14.9 27.6L5.8 18.7L18.4 16.9L24 5.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/></svg>',

    arrowdown: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M24 14V33M16.5 26.5L24 34L31.5 26.5" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    arrowup: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="55%" stop-color="#F43F5E"/><stop offset="100%" stop-color="#BE123C"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M24 34V15M16.5 21.5L24 14L31.5 21.5" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    plus: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M24 14V34M14 24H34" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/></svg>',

    minus: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="55%" stop-color="#F43F5E"/><stop offset="100%" stop-color="#BE123C"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M14 24H34" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round"/></svg>',

    ban: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="55%" stop-color="#EF4444"/><stop offset="100%" stop-color="#B91C1C"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M16.5 16.5L31.5 31.5M31.5 16.5L16.5 31.5" stroke="#FFFFFF" stroke-width="3.8" stroke-linecap="round"/></svg>',

    save: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60A5FA"/><stop offset="55%" stop-color="#2563EB"/><stop offset="100%" stop-color="#1E3A8A"/></linearGradient></defs><path d="M8 11C8 8.2 10.2 6 13 6H33L40 13V37C40 39.8 37.8 42 35 42H13C10.2 42 8 39.8 8 37V11Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="15" y="6" width="16" height="11" rx="2" fill="#E0F2FE"/><rect x="14" y="25" width="20" height="17" rx="2.5" fill="#FFFFFF" fill-opacity="0.92"/></svg>',

    clock: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#A5B4FC"/><stop offset="55%" stop-color="#6366F1"/><stop offset="100%" stop-color="#3730A3"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M24 14V24.5L31.5 28.5" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24.5" r="2.5" fill="#FEF08A"/></svg>',

    calendar: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="10" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#F8FAFC"/><stop offset="100%" stop-color="#CBD5E1"/></linearGradient></defs><rect x="6" y="10" width="36" height="32" rx="7" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M6 17C6 13.1 9.1 10 13 10H35C38.9 10 42 13.1 42 17V20H6V17Z" fill="#EF4444"/><rect x="14" y="6" width="4.5" height="9" rx="2.2" fill="#3B82F6" stroke="#FFFFFF" stroke-width="1.2"/><rect x="29.5" y="6" width="4.5" height="9" rx="2.2" fill="#3B82F6" stroke="#FFFFFF" stroke-width="1.2"/><rect x="13" y="25" width="6" height="5" rx="1.5" fill="#3B82F6"/><rect x="21" y="25" width="6" height="5" rx="1.5" fill="#10B981"/><rect x="29" y="25" width="6" height="5" rx="1.5" fill="#F59E0B"/><rect x="13" y="32" width="14" height="4.5" rx="1.5" fill="#94A3B8"/></svg>',

    check: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M15.5 24.5L21.5 30.5L33 18" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    warning: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="10" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#DC2626"/></linearGradient></defs><path d="M21.4 8.5C22.6 6.4 25.4 6.4 26.6 8.5L42.2 35.8C43.3 37.8 41.9 40.3 39.6 40.3H8.4C6.1 40.3 4.7 37.8 5.8 35.8L21.4 8.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><rect x="22" y="17.5" width="4" height="11" rx="2" fill="#FFFFFF"/><circle cx="24" cy="33.5" r="2.4" fill="#FFFFFF"/></svg>',

    trash: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="9" y1="13" x2="39" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="50%" stop-color="#F43F5E"/><stop offset="100%" stop-color="#BE123C"/></linearGradient></defs><rect x="17" y="6" width="14" height="5" rx="2.5" fill="#E11D48" stroke="#FFFFFF" stroke-width="1.3"/><rect x="8" y="10" width="32" height="5.5" rx="2.7" fill="#FB7185" stroke="#FFFFFF" stroke-width="1.3"/><path d="M11 16H37L34.8 39.2C34.6 41.3 32.8 43 30.6 43H17.4C15.2 43 13.4 41.3 13.2 39.2L11 16Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><path d="M19 22V36.5M24 22V36.5M29 22V36.5" stroke="#FFFFFF" stroke-opacity="0.85" stroke-width="2.4" stroke-linecap="round"/></svg>',

    users: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="36" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#F472B6"/><stop offset="55%" stop-color="#EC4899"/><stop offset="100%" stop-color="#9D174D"/></linearGradient></defs><circle cx="24" cy="16" r="8.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M8 38.5C8 30.8 14.5 26 24 26C33.5 26 40 30.8 40 38.5C40 40.7 38.2 42.5 36 42.5H12C9.8 42.5 8 40.7 8 38.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/></svg>',

    idcard: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="5" y1="10" x2="43" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#38BDF8"/><stop offset="55%" stop-color="#2563EB"/><stop offset="100%" stop-color="#1E3A8A"/></linearGradient></defs><rect x="5" y="10" width="38" height="28" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="16.5" cy="21" r="4" fill="#FEF08A"/><path d="M10.5 32C10.5 28.5 13 26.5 16.5 26.5C20 26.5 22.5 28.5 22.5 32" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/><rect x="26" y="18" width="12" height="3" rx="1.5" fill="#FFFFFF"/><rect x="26" y="24.5" width="9" height="2.8" rx="1.4" fill="#BAE6FD"/></svg>',

    whatsapp: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#4ADE80"/><stop offset="55%" stop-color="#16A34A"/><stop offset="100%" stop-color="#14532D"/></linearGradient></defs><path d="M24 6C14.1 6 6 14 6 23.8C6 27.3 7 30.6 8.8 33.4L6.2 42L15.1 39.5C17.8 41 20.8 41.8 24 41.8C33.9 41.8 42 33.8 42 23.9C42 14 33.9 6 24 6Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><path d="M18.2 16.5C17.5 16.5 16.3 17.2 16.1 18.6C15.9 20.1 16.6 23.1 19.6 26.3C22.6 29.5 26 30.8 28.2 31C29.7 31.1 31.1 29.9 31.4 28.8C31.6 28.1 31.4 27.6 30.9 27.3L28 25.9C27.5 25.6 27 25.7 26.6 26.1L25.5 27.3C24.2 26.7 21.8 24.6 20.8 22.7L21.9 21.5C22.3 21.1 22.4 20.5 22.1 20L20.8 17.2C20.5 16.7 19.9 16.5 18.2 16.5Z" fill="#FFFFFF"/></svg>',

    telegram: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#7DD3FC"/><stop offset="50%" stop-color="#0EA5E9"/><stop offset="100%" stop-color="#0369A1"/></linearGradient></defs><circle cx="24" cy="24" r="20" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M35.5 14.5L30.8 34.8C30.4 36.4 29.5 36.8 28.1 36L20.9 30.7L17.4 34C17 34.4 16.7 34.7 16 34.7L16.5 27.4L29.8 15.4C30.4 14.9 29.7 14.6 28.9 15.1L12.5 25.4L5.5 23.2C4 22.7 4 21.7 5.8 21L33.4 10.4C34.7 9.9 35.9 10.7 35.5 14.5Z" fill="#FFFFFF" transform="translate(2.5 2) scale(0.9)"/></svg>',

    mail: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="5" y1="10" x2="43" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="55%" stop-color="#3B82F6"/><stop offset="100%" stop-color="#1D4ED8"/></linearGradient></defs><rect x="5" y="10" width="38" height="28" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M8 14L24 26L40 14" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    excel: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#16A34A"/><stop offset="100%" stop-color="#14532D"/></linearGradient></defs><rect x="8" y="5" width="32" height="38" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M17 18L31 32M31 18L17 32" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round"/></svg>',

    pdf: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="55%" stop-color="#EF4444"/><stop offset="100%" stop-color="#991B1B"/></linearGradient></defs><rect x="8" y="5" width="32" height="38" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="13" y="18" width="22" height="12" rx="3" fill="#FFFFFF"/><rect x="16" y="22.5" width="16" height="3" rx="1.5" fill="#DC2626"/></svg>',

    folder: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="12" x2="42" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDE047"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><path d="M6 14C6 11.2 8.2 9 11 9H20L24 14H37C39.8 14 42 16.2 42 19V35C42 37.8 39.8 40 37 40H11C8.2 40 6 37.8 6 35V14Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><rect x="13" y="23" width="22" height="3" rx="1.5" fill="#FFFFFF" fill-opacity="0.85"/></svg>',

    copy: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="14" y1="12" x2="40" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#A5B4FC"/><stop offset="55%" stop-color="#6366F1"/><stop offset="100%" stop-color="#3730A3"/></linearGradient></defs><rect x="8" y="6" width="23" height="29" rx="5" fill="#93C5FD" stroke="#FFFFFF" stroke-width="1.3"/><rect x="17" y="13" width="23" height="29" rx="5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="22" y="22" width="13" height="2.8" rx="1.4" fill="#FFFFFF"/><rect x="22" y="29" width="9" height="2.8" rx="1.4" fill="#FEF08A"/></svg>',

    cloud: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="10" x2="42" y2="39" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#BAE6FD"/><stop offset="50%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0284C7"/></linearGradient></defs><path d="M14.5 38H35C39.7 38 43 34.6 43 30.2C43 26.2 40.1 23 36.2 22.4C35 15.5 29.1 10.5 22.2 10.5C15.1 10.5 9.4 15.8 8.6 22.6C6.4 24.1 5 26.7 5 29.6C5 34.3 9.2 38 14.5 38Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M24 33V20M19 25L24 19.5L29 25" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    print: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="16" x2="42" y2="36" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#94A3B8"/><stop offset="55%" stop-color="#475569"/><stop offset="100%" stop-color="#1E293B"/></linearGradient></defs><rect x="13" y="6" width="22" height="12" rx="2.5" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5"/><rect x="6" y="16" width="36" height="18" rx="5.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><circle cx="35.5" cy="22.5" r="2.2" fill="#4ADE80"/><rect x="13" y="27" width="22" height="15" rx="2.5" fill="#FFFFFF" stroke="#94A3B8" stroke-width="1.5"/><rect x="17" y="31.5" width="14" height="2.2" rx="1.1" fill="#3B82F6"/></svg>',

    store: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="5" y1="7" x2="43" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#EA580C"/></linearGradient></defs><rect x="9" y="20" width="30" height="22" rx="4.5" fill="#38BDF8" stroke="#FFFFFF" stroke-width="1.4"/><rect x="19" y="28" width="10" height="14" rx="2.5" fill="#FFFFFF"/><path d="M5.5 18.5L9.5 8.5C10.1 7.2 11.4 6.5 12.8 6.5H35.2C36.6 6.5 37.9 7.2 38.5 8.5L42.5 18.5C43 19.8 42.3 22 40.5 22H7.5C5.7 22 5 19.8 5.5 18.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/></svg>',

    settings: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="50%" stop-color="#3B82F6"/><stop offset="100%" stop-color="#1E3A8A"/></linearGradient></defs><circle cx="24" cy="24" r="17" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="24" cy="24" r="7" fill="#FEF08A" stroke="#FFFFFF" stroke-width="1.8"/></svg>',

    list: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="6" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#5EEAD4"/><stop offset="55%" stop-color="#14B8A6"/><stop offset="100%" stop-color="#0F766E"/></linearGradient></defs><rect x="9" y="7" width="30" height="35" rx="6.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.4"/><rect x="15" y="16" width="18" height="3" rx="1.5" fill="#FFFFFF"/><rect x="15" y="23.5" width="14" height="2.8" rx="1.4" fill="#CCFBF1"/><rect x="15" y="31" width="11" height="2.8" rx="1.4" fill="#FEF08A"/></svg>',

    grid: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><rect x="7" y="7" width="15" height="15" rx="4" fill="#3B82F6" stroke="#FFFFFF" stroke-width="1.4"/><rect x="26" y="7" width="15" height="15" rx="4" fill="#10B981" stroke="#FFFFFF" stroke-width="1.4"/><rect x="7" y="26" width="15" height="15" rx="4" fill="#F59E0B" stroke="#FFFFFF" stroke-width="1.4"/><rect x="26" y="26" width="15" height="15" rx="4" fill="#8B5CF6" stroke="#FFFFFF" stroke-width="1.4"/></svg>',

    edit: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><path d="M33.5 7.5L40.5 14.5C41.8 15.8 41.8 17.8 40.5 19.1L20 39.6L8 42.5L10.9 30.5L31.4 10C32.1 9.3 32.8 8.2 33.5 7.5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/><path d="M27.5 13.5L34.5 20.5" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/></svg>',

    image: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="8" x2="42" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C4B5FD"/><stop offset="55%" stop-color="#8B5CF6"/><stop offset="100%" stop-color="#5B21B6"/></linearGradient></defs><rect x="6" y="9" width="36" height="30" rx="6.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="16.5" cy="18" r="3.5" fill="#FEF08A"/><path d="M10 34L19 24L26 30L31.5 25L38 34H10Z" fill="#FFFFFF" fill-opacity="0.9"/></svg>',

    tag: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="7" y1="7" x2="41" y2="41" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#F472B6"/><stop offset="55%" stop-color="#EC4899"/><stop offset="100%" stop-color="#9D174D"/></linearGradient></defs><path d="M9 14C9 10.7 11.7 8 15 8H24.5L40.5 24C42.2 25.7 42.2 28.4 40.5 30.1L30.1 40.5C28.4 42.2 25.7 42.2 24 40.5L9 25.5V14Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/><circle cx="17.5" cy="16.5" r="3" fill="#FEF08A"/></svg>',

    mobile: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="12" y1="5" x2="36" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#67E8F9"/><stop offset="55%" stop-color="#0EA5E9"/><stop offset="100%" stop-color="#1E3A8A"/></linearGradient></defs><rect x="12" y="5" width="24" height="38" rx="6" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><rect x="16" y="11" width="16" height="22" rx="2.5" fill="#FFFFFF" fill-opacity="0.9"/><circle cx="24" cy="38" r="2.2" fill="#FEF08A"/></svg>',

    calc: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="9" y1="5" x2="39" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#94A3B8"/><stop offset="55%" stop-color="#475569"/><stop offset="100%" stop-color="#1E293B"/></linearGradient></defs><rect x="9" y="5" width="30" height="38" rx="6.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><rect x="14" y="10" width="20" height="8" rx="2.5" fill="#A7F3D0"/><circle cx="17" cy="25" r="2.6" fill="#FFFFFF"/><circle cx="24" cy="25" r="2.6" fill="#FFFFFF"/><circle cx="31" cy="25" r="2.6" fill="#FACC15"/><circle cx="17" cy="33" r="2.6" fill="#FFFFFF"/><circle cx="24" cy="33" r="2.6" fill="#FFFFFF"/><circle cx="31" cy="33" r="2.6" fill="#34D399"/></svg>',

    link: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60A5FA"/><stop offset="55%" stop-color="#2563EB"/><stop offset="100%" stop-color="#1E40AF"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M19 29L29 19M15.5 23.5L13.5 25.5C11.5 27.5 11.5 30.8 13.5 32.8L15.2 34.5C17.2 36.5 20.5 36.5 22.5 34.5L24.5 32.5M23.5 15.5L25.5 13.5C27.5 11.5 30.8 11.5 32.8 13.5L34.5 15.2C36.5 17.2 36.5 20.5 34.5 22.5L32.5 24.5" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round"/></svg>',

    bolt: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="12" y1="5" x2="36" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><path d="M27 5L10 27H23L20 43L38 20H25L27 5Z" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/></svg>',

    exchange: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C4B5FD"/><stop offset="55%" stop-color="#8B5CF6"/><stop offset="100%" stop-color="#5B21B6"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M14 19H33M28 14L33.5 19L28 24" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 29H15M20 24L14.5 29L20 34" stroke="#FEF08A" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    sync: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="55%" stop-color="#10B981"/><stop offset="100%" stop-color="#0284C7"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M33 20A10 10 0 0 0 15.5 17.5M15 28A10 10 0 0 0 32.5 30.5" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/><path d="M33 13V20H26M15 35V28H22" stroke="#FEF08A" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    lock: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="20" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FCD34D"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><path d="M15 21V15C15 10 19 6 24 6C29 6 33 10 33 15V21" stroke="#94A3B8" stroke-width="4.5" stroke-linecap="round"/><rect x="9" y="20" width="30" height="23" rx="6.5" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="24" cy="30" r="3" fill="#FFFFFF"/><rect x="22.6" y="31" width="2.8" height="6" rx="1.4" fill="#FFFFFF"/></svg>',

    info: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#7DD3FC"/><stop offset="55%" stop-color="#0EA5E9"/><stop offset="100%" stop-color="#0369A1"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="24" cy="15.5" r="2.6" fill="#FEF08A"/><rect x="21.8" y="21" width="4.4" height="14" rx="2.2" fill="#FFFFFF"/></svg>'
  };

  function mapGlobalUiKey(el) {
    var c = el.className || '';
    if (!c || /fa-spin|fa-spinner|fa-circle-notch|fa-chevron-down|fa-chevron-up|fa-angle-down|fa-angle-up|fa-caret|fa-backspace|fa-eye|fa-sort|fa-ellipsis|fa-grip/.test(c)) return null;
    if (/(?:^|\s)fa-(?:times|xmark|search|arrow-right)(?:\s|$)/.test(c)) return null;

    if (c.indexOf('fa-chevron-left') !== -1 || c.indexOf('fa-angle-left') !== -1) return 'chevleft';
    if (c.indexOf('fa-chevron-right') !== -1 || c.indexOf('fa-angle-right') !== -1) return 'chevright';
    if (c.indexOf('fa-arrow-left') !== -1) return 'back';
    if (c.indexOf('fa-sun') !== -1) return 'sun';
    if (c.indexOf('fa-moon') !== -1) return 'moon';
    if (c.indexOf('fa-sign-out') !== -1 || c.indexOf('fa-right-from-bracket') !== -1) return 'logout';
    if (c.indexOf('fa-qrcode') !== -1) return 'qrcode';
    if (c.indexOf('fa-barcode') !== -1) return 'barcode';
    if (c.indexOf('fa-credit-card') !== -1) return 'card';
    if (c.indexOf('fa-university') !== -1 || c.indexOf('fa-building-columns') !== -1 || c.indexOf('fa-landmark') !== -1) return 'bank';
    if (c.indexOf('fa-whatsapp') !== -1) return 'whatsapp';
    if (c.indexOf('fa-telegram') !== -1 || c.indexOf('fa-paper-plane') !== -1) return 'telegram';
    if (c.indexOf('fa-envelope') !== -1 || c.indexOf('fa-inbox') !== -1 || /(?:^|\s)fa-at(?:\s|$)/.test(c)) return 'mail';
    if (c.indexOf('fa-file-pdf') !== -1) return 'pdf';
    if (c.indexOf('fa-file-excel') !== -1 || c.indexOf('fa-file-csv') !== -1 || c.indexOf('fa-table') !== -1) return 'excel';
    if (c.indexOf('fa-file-archive') !== -1 || c.indexOf('fa-folder') !== -1) return 'folder';
    if (c.indexOf('fa-copy') !== -1 || c.indexOf('fa-paste') !== -1 || c.indexOf('fa-clone') !== -1) return 'copy';
    if (c.indexOf('fa-calendar') !== -1) return 'calendar';
    if (c.indexOf('fa-times-circle') !== -1 || c.indexOf('fa-circle-xmark') !== -1 || c.indexOf('fa-ban') !== -1) return 'ban';
    if (c.indexOf('fa-minus') !== -1) return 'minus';
    if (c.indexOf('fa-shopping-basket') !== -1 || c.indexOf('fa-basket-shopping') !== -1) return 'basket';
    if (c.indexOf('fa-cart') !== -1 || c.indexOf('fa-shopping-cart') !== -1) return 'cart';
    if (c.indexOf('fa-hand-holding-usd') !== -1 || c.indexOf('fa-hand-holding-dollar') !== -1) return 'debt';
    if (c.indexOf('fa-coins') !== -1) return 'coins';
    if (c.indexOf('fa-wallet') !== -1) return 'wallet';
    if (c.indexOf('fa-money') !== -1 || c.indexOf('fa-piggy-bank') !== -1) return 'money';
    if (c.indexOf('fa-receipt') !== -1 || c.indexOf('fa-file-invoice') !== -1) return 'receipt';
    if (c.indexOf('fa-layer-group') !== -1 || c.indexOf('fa-boxes') !== -1) return 'layers';
    if (c.indexOf('fa-box') !== -1 || c.indexOf('fa-cube') !== -1 || c.indexOf('fa-warehouse') !== -1) return 'box';
    if (c.indexOf('fa-chart') !== -1) return 'chart';
    if (c.indexOf('fa-trophy') !== -1 || c.indexOf('fa-crown') !== -1) return 'trophy';
    if (c.indexOf('fa-star') !== -1 || c.indexOf('fa-gem') !== -1) return 'star';
    if (c.indexOf('fa-arrow-down') !== -1 || c.indexOf('fa-arrow-circle-down') !== -1 || c.indexOf('fa-sign-in') !== -1 || c.indexOf('fa-download') !== -1 || c.indexOf('fa-file-download') !== -1 || c.indexOf('fa-file-import') !== -1) return 'arrowdown';
    if (c.indexOf('fa-arrow-up') !== -1 || c.indexOf('fa-upload') !== -1 || c.indexOf('fa-file-upload') !== -1 || c.indexOf('fa-file-export') !== -1) return 'arrowup';
    if (c.indexOf('fa-plus') !== -1) return 'plus';
    if (c.indexOf('fa-save') !== -1 || c.indexOf('fa-floppy') !== -1) return 'save';
    if (c.indexOf('fa-clock') !== -1 || c.indexOf('fa-history') !== -1) return 'clock';
    if (c.indexOf('fa-check') !== -1 || c.indexOf('fa-circle-check') !== -1) return 'check';
    if (c.indexOf('fa-exclamation') !== -1 || c.indexOf('fa-triangle') !== -1) return 'warning';
    if (c.indexOf('fa-trash') !== -1) return 'trash';
    if (c.indexOf('fa-id-card') !== -1 || c.indexOf('fa-handshake') !== -1) return 'idcard';
    if (c.indexOf('fa-user') !== -1 || c.indexOf('fa-address-book') !== -1) return 'users';
    if (c.indexOf('fa-google-drive') !== -1 || c.indexOf('fa-database') !== -1 || c.indexOf('fa-cloud') !== -1) return 'cloud';
    if (c.indexOf('fa-print') !== -1 || c.indexOf('fa-bluetooth') !== -1) return 'print';
    if (c.indexOf('fa-store') !== -1 || c.indexOf('fa-home') !== -1 || c.indexOf('fa-cash-register') !== -1 || c.indexOf('fa-briefcase') !== -1) return 'store';
    if (c.indexOf('fa-th-large') !== -1 || c.indexOf('fa-border-all') !== -1 || c.indexOf('fa-table-cells') !== -1 || c.indexOf('fa-shapes') !== -1) return 'grid';
    if (c.indexOf('fa-image') !== -1 || c.indexOf('fa-camera') !== -1 || c.indexOf('fa-palette') !== -1 || c.indexOf('fa-wand-magic') !== -1 || c.indexOf('fa-droplet') !== -1 || c.indexOf('fa-font') !== -1) return 'image';
    if (c.indexOf('fa-tag') !== -1 || c.indexOf('fa-percent') !== -1) return 'tag';
    if (c.indexOf('fa-mobile') !== -1 || c.indexOf('fa-laptop') !== -1 || c.indexOf('fa-desktop') !== -1) return 'mobile';
    if (c.indexOf('fa-calculator') !== -1) return 'calc';
    if (c.indexOf('fa-link') !== -1 || c.indexOf('fa-unlink') !== -1 || c.indexOf('fa-external-link') !== -1) return 'link';
    if (c.indexOf('fa-cog') !== -1 || c.indexOf('fa-tools') !== -1 || c.indexOf('fa-language') !== -1 || c.indexOf('fa-keyboard') !== -1 || c.indexOf('fa-shield') !== -1) return 'settings';
    if (c.indexOf('fa-list') !== -1 || c.indexOf('fa-filter') !== -1 || c.indexOf('fa-clipboard') !== -1 || c.indexOf('fa-search-minus') !== -1) return 'list';
    if (c.indexOf('fa-edit') !== -1 || c.indexOf('fa-pen') !== -1) return 'edit';
    if (c.indexOf('fa-robot') !== -1 || c.indexOf('fa-bolt') !== -1 || c.indexOf('fa-microchip') !== -1 || c.indexOf('fa-burst') !== -1 || c.indexOf('fa-mug-hot') !== -1 || c.indexOf('fa-tree') !== -1) return 'bolt';
    if (c.indexOf('fa-exchange') !== -1) return 'exchange';
    if (c.indexOf('fa-sync') !== -1 || c.indexOf('fa-redo') !== -1 || c.indexOf('fa-undo') !== -1 || c.indexOf('fa-rotate') !== -1) return 'sync';
    if (c.indexOf('fa-lock') !== -1 || c.indexOf('fa-key') !== -1) return 'lock';
    if (c.indexOf('fa-info') !== -1 || c.indexOf('fa-circle-info') !== -1 || c.indexOf('fa-circle-question') !== -1 || c.indexOf('fa-circle-dot') !== -1 || c.indexOf('fa-book') !== -1 || c.indexOf('fa-question') !== -1) return 'info';
    return null;
  }

  var seq = window.__webpos3dUiSeq || 0;
  var SKIP_SEL = [
    'aside .nav-link',
    'aside .nav-dropdown-toggle',
    '.mobile-bar',
    '.mobile-nav',
    '#ptrIndicator',
    '.ptr-indicator',
    '.modal-close',
    '.close-btn',
    '.search-input-wrapper',
    '.produk-search',
    '.search-box',
    '.password-toggle',
    '.toggle-password',
    '.qty-btn',
    '.cart-item-remove',
    '.numpad-btn',
    '.user-avatar',
    '.action-arrow',
    '#btnThemeToggle',
    '#btnTheme',
    '#btnLogout',
    '#mobileMenuToggle'
  ].join(',');

  // Hapus SVG 3D duplikat jika halaman (seperti Dashboard index.html) sudah punya SVG 3D sendiri
  function cleanupDuplicate3dSvgs() {
    try {
      var svgs = document.querySelectorAll('svg[data-u3d-for="1"]');
      for (var i = 0; i < svgs.length; i++) {
        var s = svgs[i];
        var parent = s.parentNode;
        if (!parent) continue;
        var prev = s.previousElementSibling;
        var hasCustom3d = parent.querySelector(':scope > svg.dash-3d-svg, :scope > svg.nav-3d-svg, :scope > svg.prod-3d-icon');
        if (hasCustom3d || !prev || prev.tagName !== 'I' || prev.dataset.upgraded3d !== '1') {
          s.remove();
        }
      }
    } catch (e) {}
  }

  function upgradeSingleIcon(el) {
    try {
      if (!el || el.id === 'shiftToggleIcon' || el.classList.contains('dropdown-arrow')) return;
      if (el.closest(SKIP_SEL)) return;

      var parent = el.parentNode;
      if (!parent) return;

      if (parent.querySelector(':scope > svg.dash-3d-svg, :scope > svg.nav-3d-svg, :scope > svg.prod-3d-icon')) {
        var oldDup = el.nextElementSibling;
        if (oldDup && oldDup.dataset && oldDup.dataset.u3dFor === '1') oldDup.remove();
        return;
      }

      var curClass = el.className || '';
      if (el.dataset.upgraded3d === '1' && el.dataset.u3dClass === curClass) return;

      var next = el.nextElementSibling;
      if (next && next.dataset && next.dataset.u3dFor === '1') {
        next.remove();
      }

      var key = mapGlobalUiKey(el);
      if (!key || !UI3D[key]) {
        if (el.dataset.upgraded3d === '1') {
          el.style.removeProperty('display');
          delete el.dataset.upgraded3d;
          delete el.dataset.u3dClass;
        }
        return;
      }

      seq++;
      var wrap = document.createElement('span');
      wrap.innerHTML = UI3D[key].replace(/__ID__/g, 'u3d_' + seq + '_');
      var svg = wrap.firstElementChild;
      if (svg) {
        svg.dataset.u3dFor = '1';
        var isInlineAbs = (el.style && el.style.position === 'absolute');
        var isFieldWrap = el.classList.contains('field-icon') ||
          (parent.classList && (
            parent.classList.contains('input-wrap') ||
            parent.classList.contains('barcode-input-wrap') ||
            parent.classList.contains('riwayat-search-box') ||
            parent.classList.contains('search-box') ||
            parent.classList.contains('produk-search') ||
            parent.classList.contains('search-input-wrapper')
          ));
        if (isInlineAbs || isFieldWrap) {
          svg.classList.add('ui-3d-abs');
          svg.style.setProperty('position', 'absolute', 'important');
          svg.style.setProperty('top', (el.style && el.style.top) || '50%', 'important');
          if (el.style && el.style.right && !el.style.left) {
            svg.style.setProperty('right', el.style.right, 'important');
            svg.style.setProperty('left', 'auto', 'important');
          } else {
            svg.style.setProperty('left', (el.style && el.style.left) || '0.85rem', 'important');
          }
          svg.style.setProperty('transform', (el.style && el.style.transform) || 'translateY(-50%)', 'important');
          svg.style.setProperty('width', '16px', 'important');
          svg.style.setProperty('height', '16px', 'important');
          svg.style.setProperty('margin', '0', 'important');
          svg.style.setProperty('pointer-events', 'none', 'important');
          svg.style.setProperty('z-index', '2', 'important');
        }
        el.style.setProperty('display', 'none', 'important');
        el.dataset.upgraded3d = '1';
        el.dataset.u3dClass = curClass;
        parent.insertBefore(svg, el.nextSibling);
      }
    } catch (e) {}
  }

  var batchQueue = [];
  var batchRaf = 0;

  function flushIconBatch() {
    batchRaf = 0;
    try {
      var limit = 55;
      while (batchQueue.length && limit-- > 0) {
        var node = batchQueue.shift();
        if (node && node.isConnected) upgradeSingleIcon(node);
      }
      window.__webpos3dUiSeq = seq;
      if (batchQueue.length) {
        batchRaf = requestAnimationFrame(flushIconBatch);
      }
    } catch (e) {
      batchQueue.length = 0;
    }
  }

  function upgradeNodesInDom(onlyPending) {
    try {
      if (!onlyPending) cleanupDuplicate3dSvgs();
      var sel = onlyPending ? 'i[class*="fa-"]:not([data-upgraded3d="1"])' : 'i[class*="fa-"]';
      var nodes = document.querySelectorAll(sel);
      var immediate = Math.min(nodes.length, 45);
      for (var i = 0; i < immediate; i++) {
        upgradeSingleIcon(nodes[i]);
      }
      if (nodes.length > immediate) {
        for (var j = immediate; j < nodes.length; j++) {
          batchQueue.push(nodes[j]);
        }
        if (!batchRaf) batchRaf = requestAnimationFrame(flushIconBatch);
      }
      window.__webpos3dUiSeq = seq;
    } catch (e) {}
  }

  function applyGlobalUi3D() {
    try {
      if (!document.getElementById('webpos3dGlobalUiStyle')) {
        var st = document.createElement('style');
        st.id = 'webpos3dGlobalUiStyle';
        st.textContent = [
          'i[data-upgraded3d="1"]{display:none !important;}',
          '.ui-3d-svg{width:1.2em;height:1.2em;max-width:100%;max-height:100%;display:inline-block;flex-shrink:0;vertical-align:-0.18em;filter:drop-shadow(0 2px 3px rgba(15,23,42,0.18));transition:transform .2s ease;}',
          '.ui-3d-abs,.input-wrap > .ui-3d-svg,.barcode-input-wrap > .ui-3d-svg,.riwayat-search-box > .ui-3d-svg{position:absolute !important;left:0.9rem !important;top:50% !important;transform:translateY(-50%) !important;width:18px !important;height:18px !important;margin:0 !important;pointer-events:none !important;z-index:2;}',
          '.stat-icon:has(> .ui-3d-svg),.summary-icon:has(> .ui-3d-svg),.action-icon:has(> .ui-3d-svg),.dialog-icon-wrap:has(> .ui-3d-svg),.kas-item-icon:has(> .ui-3d-svg){background:transparent !important;box-shadow:none !important;}',
          '.logo-badge > .ui-3d-svg{width:30px;height:30px;margin:0;}',
          '.logo-icon > .ui-3d-svg{width:24px;height:24px;margin:0;}',
          '.dialog-icon-wrap > .ui-3d-svg{width:34px;height:34px;margin:0;}',
          '.stat-icon > .ui-3d-svg,.summary-icon > .ui-3d-svg{width:36px;height:36px;margin:0;}',
          '.action-icon > .ui-3d-svg{width:30px;height:30px;margin:0;}',
          '.kas-item-icon > .ui-3d-svg{width:24px;height:24px;margin:0;}',
          '.modal-summary-item > .ui-3d-svg{width:32px;height:32px;margin:0;}',
          '.payment-method > .ui-3d-svg{width:22px;height:22px;margin:0 auto 3px;display:block;}',
          '#paymentModal .payment-method > .ui-3d-svg{width:18px;height:18px;margin:0 auto 2px;}',
          '.empty-state > .ui-3d-svg{width:42px;height:42px;margin:0 auto 8px;display:block;}',
          '.stat-card:hover .stat-icon > .ui-3d-svg{transform:scale(1.1);}',
          '.tab-btn > .ui-3d-svg,.viewer-tab-btn > .ui-3d-svg{width:18px;height:18px;}',
          '.card-title > .ui-3d-svg,.modal-title > .ui-3d-svg,.section-title > .ui-3d-svg{width:21px;height:21px;}',
          '.menu-toggle > .ui-3d-svg{width:20px;height:20px;margin:0;}',
          '.sidebar.collapsed .menu-toggle > .ui-3d-svg{transform:rotate(180deg);}',
          '.kas-date-btn > .ui-3d-svg,.page-btn > .ui-3d-svg,.btn-icon-box > .ui-3d-svg,.btn-icon-sm > .ui-3d-svg,.btn-icon > .ui-3d-svg,.floating-cart-btn > .ui-3d-svg{width:18px;height:18px;margin:0;}',
          '#btnThemeToggle .ui-3d-svg,#btnTheme .ui-3d-svg,#btnLogout .ui-3d-svg,#mobileMenuToggle .ui-3d-svg{width:20px;height:20px;margin:0;}',
          '#btnThemeToggle:hover .ui-3d-svg,#btnTheme:hover .ui-3d-svg,#btnLogout:hover .ui-3d-svg,#mobileMenuToggle:hover .ui-3d-svg,.menu-toggle:hover > .ui-3d-svg{transform:scale(1.12);}'
        ].join('\n');
        document.head.appendChild(st);
      }

      // 1. Tombol Header Dark Mode (#btnThemeToggle maupun #btnTheme)
      var themeBtn = document.getElementById('btnThemeToggle') || document.getElementById('btnTheme');
      if (themeBtn && !themeBtn.dataset.upgraded3d) {
        themeBtn.dataset.upgraded3d = '1';
        var hiddenThemeI = themeBtn.querySelector('i');
        if (!hiddenThemeI) {
          hiddenThemeI = document.createElement('i');
          hiddenThemeI.className = 'fas fa-moon';
          themeBtn.appendChild(hiddenThemeI);
        }
        hiddenThemeI.style.setProperty('display', 'none', 'important');
        hiddenThemeI.dataset.upgraded3d = '1';
        var themeSlot = document.createElement('span');
        themeSlot.className = 'u3d-theme-slot';
        themeSlot.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
        themeBtn.appendChild(themeSlot);

        function renderTheme3d() {
          var t = document.documentElement.getAttribute('data-theme') || 'light';
          var isDark = (t === 'dark' || t === 'midnight' || t === 'emerald' || t === 'oled');
          seq++;
          themeSlot.innerHTML = (isDark ? UI3D.sun : UI3D.moon).replace(/__ID__/g, 'u3d_' + seq + '_');
        }
        renderTheme3d();
        new MutationObserver(renderTheme3d).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      }

      // 2. Tombol Header Logout
      var logoutBtn = document.getElementById('btnLogout');
      if (logoutBtn && !logoutBtn.dataset.upgraded3d) {
        logoutBtn.dataset.upgraded3d = '1';
        var oldLogoutI = logoutBtn.querySelector('i');
        if (oldLogoutI) {
          oldLogoutI.style.setProperty('display', 'none', 'important');
          oldLogoutI.dataset.upgraded3d = '1';
        }
        seq++;
        var lw = document.createElement('span');
        lw.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
        lw.innerHTML = UI3D.logout.replace(/__ID__/g, 'u3d_' + seq + '_');
        logoutBtn.appendChild(lw);
      }

      // 3. Tombol Header Menu Mobile
      var menuBtn = document.getElementById('mobileMenuToggle');
      if (menuBtn && !menuBtn.dataset.upgraded3d) {
        menuBtn.dataset.upgraded3d = '1';
        var oldMenuI = menuBtn.querySelector('i');
        if (oldMenuI) {
          oldMenuI.style.setProperty('display', 'none', 'important');
          oldMenuI.dataset.upgraded3d = '1';
        }
        seq++;
        var mw = document.createElement('span');
        mw.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
        mw.innerHTML = UI3D.menu.replace(/__ID__/g, 'u3d_' + seq + '_');
        menuBtn.appendChild(mw);
      }

      // 4. Jalankan upgrade ringan & bersihkan duplikat
      upgradeNodesInDom(false);
      setTimeout(function() { cleanupDuplicate3dSvgs(); }, 100);

      var debounceTimer = null;
      var changedIcons = [];
      new MutationObserver(function(mutations) {
        var hasNewDom = false;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
            for (var k = 0; k < m.addedNodes.length; k++) {
              var n = m.addedNodes[k];
              if (n.nodeType === 1 && !n.classList.contains('ui-3d-svg') && !n.classList.contains('wpl-card')) {
                hasNewDom = true;
                break;
              }
            }
          } else if (m.type === 'attributes' && m.target && m.target.tagName === 'I') {
            changedIcons.push(m.target);
          }
        }
        if (!hasNewDom && !changedIcons.length) return;
        if (debounceTimer) return;
        debounceTimer = setTimeout(function() {
          debounceTimer = null;
          while (changedIcons.length) {
            upgradeSingleIcon(changedIcons.shift());
          }
          if (hasNewDom) upgradeNodesInDom(true);
        }, 160);
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyGlobalUi3D);
  } else {
    applyGlobalUi3D();
  }
})();

// 6. UNIFIED INTERACTIVE 3D PROGRESS LOADER (PINDAH HALAMAN & MUAT DATA SERAGAM DI SEMUA 28 HALAMAN)
(function() {
  if (window.__webpos3dLoaderInit) return;
  window.__webpos3dLoaderInit = true;

  var LOADER_SVG =
    '<svg viewBox="0 0 64 64" fill="none" class="wpl-3d-emblem">' +
      '<defs>' +
        '<linearGradient id="wplRoof" x1="8" y1="10" x2="56" y2="30" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FEF08A"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#EA580C"/></linearGradient>' +
        '<linearGradient id="wplBody" x1="12" y1="26" x2="52" y2="56" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60A5FA"/><stop offset="55%" stop-color="#4F46E5"/><stop offset="100%" stop-color="#312E81"/></linearGradient>' +
      '</defs>' +
      '<rect x="13" y="26" width="38" height="28" rx="7" fill="url(#wplBody)" stroke="#FFFFFF" stroke-width="2"/>' +
      '<rect x="26" y="36" width="12" height="18" rx="3.5" fill="#FFFFFF" fill-opacity="0.95"/>' +
      '<path d="M8 24.5L13.5 11.5C14.3 9.7 16 8.5 18 8.5H46C48 8.5 49.7 9.7 50.5 11.5L56 24.5C56.8 26.5 55.6 29 53.2 29H10.8C8.4 29 7.2 26.5 8 24.5Z" fill="url(#wplRoof)" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="46" cy="40" r="3" fill="#34D399"/>' +
    '</svg>';

  function injectLoaderStyles() {
    if (document.getElementById('webposUnifiedLoaderStyle')) return;
    var st = document.createElement('style');
    st.id = 'webposUnifiedLoaderStyle';
    st.textContent = [
      '@keyframes wplSpin{to{transform:rotate(360deg)}}',
      '@keyframes wplFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}',
      '@keyframes wplShine{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}',
      '@keyframes wplPop{from{opacity:0;transform:scale(0.94)}to{opacity:1;transform:scale(1)}}',
      '#webposTopProgress{position:fixed;top:0;left:0;height:3.5px;width:0;z-index:999999;background:linear-gradient(90deg,#10b981,#3b82f6,#8b5cf6,#f59e0b);box-shadow:0 0 10px rgba(59,130,246,0.6);pointer-events:none;opacity:0;transition:width .25s ease,opacity .2s ease;}',
      '#loadingOverlay.wpl-upgraded,#loadingVeil.wpl-upgraded,#webposGlobalLoader{position:fixed !important;inset:0 !important;z-index:99998 !important;background:rgba(15,23,42,0.52) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;flex-direction:column !important;align-items:center !important;justify-content:center !important;padding:1.25rem !important;}',
      '#webposGlobalLoader{display:none;}',
      '#webposGlobalLoader.active{display:flex !important;}',
      '#loadingOverlay.wpl-upgraded > .spinner,#loadingOverlay.wpl-upgraded > .loader,#loadingVeil.wpl-upgraded > div:not(.wpl-card){display:none !important;}',
      '.wpl-card{width:min(300px,86vw);background:var(--bg-surface,#ffffff);color:var(--text-main,#0f172a);border:1px solid var(--border,rgba(148,163,184,0.28));border-radius:22px;padding:1.35rem 1.3rem 1.2rem;box-shadow:0 20px 45px rgba(15,23,42,0.28);display:flex;flex-direction:column;align-items:center;text-align:center;gap:0.55rem;animation:wplPop .18s ease-out;}',
      '.wpl-orbit{position:relative;width:68px;height:68px;display:flex;align-items:center;justify-content:center;margin-bottom:0.1rem;}',
      '.wpl-ring{position:absolute;inset:0;border-radius:50%;padding:3.5px;background:conic-gradient(from 0deg,#10b981,#3b82f6,#8b5cf6,#f59e0b,#10b981);-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:wplSpin 1.1s linear infinite;will-change:transform;}',
      '.wpl-3d-emblem{width:40px;height:40px;filter:drop-shadow(0 4px 6px rgba(15,23,42,0.22));animation:wplFloat 1.7s ease-in-out infinite;will-change:transform;}',
      '.wpl-title{font-size:0.92rem !important;font-weight:800 !important;color:var(--text-main,#0f172a) !important;margin:0 !important;line-height:1.3 !important;}',
      '.wpl-meta-row{width:100%;display:flex;align-items:center;justify-content:space-between;font-size:0.72rem;font-weight:700;color:var(--text-muted,#64748b);margin-top:0.1rem;}',
      '.wpl-pct{color:var(--primary,#4f46e5);font-weight:800;font-variant-numeric:tabular-nums;}',
      '.wpl-bar{width:100%;height:8px;border-radius:999px;background:var(--bg-subtle,rgba(148,163,184,0.22));overflow:hidden;position:relative;}',
      '.wpl-bar-fill{position:relative;height:100%;width:15%;border-radius:999px;background:linear-gradient(90deg,#10b981,#3b82f6,#8b5cf6);transition:width .28s cubic-bezier(.22,1,.36,1);overflow:hidden;}',
      '.wpl-bar-fill::after{content:"";position:absolute;inset:0;width:45%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent);animation:wplShine 1.1s linear infinite;}',
      '.wpl-skip-btn{display:none;margin-top:0.25rem;padding:0.42rem 0.9rem;border-radius:10px;border:1px solid rgba(79,70,229,0.32);background:var(--primary-light,rgba(79,70,229,0.1));color:var(--primary,#4f46e5);font-size:0.74rem;font-weight:700;cursor:pointer;font-family:inherit;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function isOverlayVisible(el) {
    if (!el || !el.isConnected) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05;
  }

  function buildCard(existingMsg, defaultText) {
    var card = document.createElement('div');
    card.className = 'wpl-card';
    card.innerHTML =
      '<div class="wpl-orbit"><div class="wpl-ring"></div>' + LOADER_SVG + '</div>' +
      '<div class="wpl-msg-slot"></div>' +
      '<div class="wpl-meta-row"><span class="wpl-sub">Menyiapkan data...</span><span class="wpl-pct">12%</span></div>' +
      '<div class="wpl-bar"><div class="wpl-bar-fill"></div></div>' +
      '<button type="button" class="wpl-skip-btn">Tutup &amp; Lihat Halaman</button>';

    var msgSlot = card.querySelector('.wpl-msg-slot');
    if (existingMsg) {
      existingMsg.classList.add('wpl-title');
      existingMsg.removeAttribute('style');
      msgSlot.appendChild(existingMsg);
    } else {
      var p = document.createElement('p');
      p.className = 'wpl-title';
      p.textContent = defaultText || 'Memuat halaman...';
      msgSlot.appendChild(p);
    }
    return card;
  }

  function attachProgressController(overlay, card) {
    var subEl = card.querySelector('.wpl-sub');
    var pctEl = card.querySelector('.wpl-pct');
    var fillEl = card.querySelector('.wpl-bar-fill');
    var skipBtn = card.querySelector('.wpl-skip-btn');
    var progTimer = null;
    var currentPct = 12;

    function setVisual(pct, text) {
      currentPct = Math.max(5, Math.min(100, Math.round(pct)));
      if (fillEl) fillEl.style.width = currentPct + '%';
      if (pctEl) pctEl.textContent = currentPct + '%';
      if (text && subEl) subEl.textContent = text;
    }

    function stopProgress() {
      if (progTimer) { clearInterval(progTimer); progTimer = null; }
      if (skipBtn) skipBtn.style.display = 'none';
    }

    function startProgress(initialSub) {
      stopProgress();
      setVisual(14, initialSub || 'Menyiapkan tampilan...');
      var ticks = 0;
      progTimer = setInterval(function() {
        if (!isOverlayVisible(overlay)) { stopProgress(); return; }
        ticks++;
        if (currentPct < 45) {
          setVisual(currentPct + 11, ticks > 2 ? 'Mengambil data terbaru...' : null);
        } else if (currentPct < 78) {
          setVisual(currentPct + 6, 'Menyinkronkan dari server...');
        } else if (currentPct < 94) {
          setVisual(currentPct + 2, 'Hampir selesai...');
        }
        if (ticks >= 9 && skipBtn) {
          subEl.textContent = 'Koneksi agak lambat, bisa lanjut dulu';
          skipBtn.style.display = 'inline-block';
        }
      }, 450);
    }

    if (skipBtn) {
      skipBtn.onclick = function() {
        stopProgress();
        overlay.classList.remove('active');
        overlay.style.display = 'none';
        overlay.style.visibility = 'hidden';
        overlay.style.opacity = '0';
      };
    }

    overlay.__wplSet = setVisual;
    overlay.__wplStart = startProgress;
    overlay.__wplStop = stopProgress;
    return { setVisual: setVisual, startProgress: startProgress, stopProgress: stopProgress };
  }

  function enhanceOverlay(overlay) {
    if (!overlay || overlay.dataset.wplReady === '1') return;
    var preCs = window.getComputedStyle(overlay);
    // Cegah #loadingOverlay tanpa CSS tersembunyi (Restock, Data Pelanggan, Modal Harian) menutupi layar permanen
    if (overlay.id === 'loadingOverlay' && preCs.position !== 'fixed' && !overlay.classList.contains('active')) {
      overlay.style.display = 'none';
      return;
    }
    overlay.dataset.wplReady = '1';
    overlay.classList.add('wpl-upgraded');

    var existingMsg = overlay.querySelector('#loadingText, #loadingVeilMsg, p');
    var card = buildCard(existingMsg, 'Memuat data...');
    var kids = overlay.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] !== card) kids[i].style.display = 'none';
    }
    overlay.appendChild(card);

    var ctrl = attachProgressController(overlay, card);
    var wasVis = false;
    function syncVis() {
      var vis = isOverlayVisible(overlay);
      if (vis && !wasVis) {
        wasVis = true;
        ctrl.startProgress('Menyiapkan data...');
      } else if (!vis && wasVis) {
        wasVis = false;
        ctrl.setVisual(100, 'Selesai');
        ctrl.stopProgress();
      }
    }
    syncVis();
    new MutationObserver(syncVis).observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  // Upgrade otomatis semua teks/spinner "Memuat..." di dalam tabel/grid/kartu di SELURUH 28 halaman jadi 3D Progress Bar ber-%
  function createInlineProgressNode(labelText) {
    var wrap = document.createElement('div');
    wrap.className = 'wpl-inline-box';
    wrap.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.48rem;padding:2rem 1rem;text-align:center;width:100%;';
    wrap.innerHTML =
      '<div class="wpl-orbit" style="width:52px;height:52px;"><div class="wpl-ring"></div>' +
        LOADER_SVG.replace('class="wpl-3d-emblem"', 'class="wpl-3d-emblem" style="width:30px;height:30px;"') +
      '</div>' +
      '<div class="wpl-inline-title" style="font-size:0.85rem;font-weight:800;color:var(--text-main,#0f172a);"></div>' +
      '<div style="width:min(220px,78%);display:flex;align-items:center;justify-content:space-between;font-size:0.7rem;font-weight:700;color:var(--text-muted,#64748b);">' +
        '<span class="wpl-inline-sub">Menyiapkan data...</span>' +
        '<span class="wpl-inline-pct" style="color:var(--primary,#4f46e5);font-weight:800;">16%</span>' +
      '</div>' +
      '<div class="wpl-bar" style="max-width:220px;height:7px;"><div class="wpl-bar-fill" style="width:16%;"></div></div>';

    var titleEl = wrap.querySelector('.wpl-inline-title');
    var subEl = wrap.querySelector('.wpl-inline-sub');
    var pctEl = wrap.querySelector('.wpl-inline-pct');
    var fillEl = wrap.querySelector('.wpl-bar-fill');
    if (titleEl) titleEl.textContent = labelText || 'Memuat data...';

    var pct = 16;
    var timer = setInterval(function() {
      if (!wrap.isConnected) { clearInterval(timer); return; }
      if (pct < 48) {
        pct += 11;
      } else if (pct < 78) {
        pct += 6;
        if (subEl) subEl.textContent = 'Menyinkronkan data...';
      } else if (pct < 92) {
        pct += 2;
        if (subEl) subEl.textContent = 'Hampir selesai...';
      }
      if (pctEl) pctEl.textContent = pct + '%';
      if (fillEl) fillEl.style.width = pct + '%';
    }, 420);

    return wrap;
  }

  function upgradeInlineLoaders(scope) {
    try {
      var root = (scope && scope.querySelectorAll) ? scope : document;
      var candidates = root.querySelectorAll('main td, main div, .main-content td, .main-content div, .content-area td, .content-area div, #kategoriGrid, #produkGrid, #transactionList, #tbodyRiwayat td, #payrollTableBody td, #summaryTableBody td, #logBody td, #viewerTableBody td, #deviceHistoryList, #historyModalBody, #customerTableBody td');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (!el || !el.isConnected) continue;
        if (el.closest('button, a, select, option, .sidebar, .header, .top-header, .wpl-card, .wpl-inline-box, #loadingOverlay, #loadingVeil, #webposGlobalLoader')) continue;
        if (el.id === 'userName' || el.id === 'dateRangeInfo' || el.id === 'badgeTelegramKasir' || el.id === 'importProgressLabel' || el.id === 'gasCodeDisplay') continue;
        if (el.querySelector('.wpl-inline-box, button, input, select, textarea, table, a, form, .kategori-card, .produk-card')) continue;

        var txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        var hasSpinIcon = !!el.querySelector('.fa-spinner, .spinner');
        var isMemuatText = txt.length >= 6 && txt.length <= 68 && /^memuat\b/i.test(txt);
        var isSpinnerLoad = hasSpinIcon && txt.length > 0 && txt.length <= 68 && /(memuat|memproses|mengambil|sinkron)/i.test(txt);

        if (!isMemuatText && !isSpinnerLoad) continue;
        // Jika elemen ini pembungkus yang punya anak div/td lain yang juga cocok, biarkan anaknya yang di-upgrade
        if (el.tagName === 'DIV' && el.id !== 'kategoriGrid' && el.id !== 'produkGrid' && el.id !== 'transactionList' && el.querySelector('div, td')) {
          var innerTxt = (el.firstElementChild && el.firstElementChild.textContent || '').trim();
          if (innerTxt === txt) continue;
        }

        el.innerHTML = '';
        el.appendChild(createInlineProgressNode(txt));
      }
    } catch (e) {}
  }

  function initUnifiedLoader() {
    try {
      injectLoaderStyles();

      // 1. Top Progress Bar + Global Loader Overlay (untuk pindah halaman & halaman tanpa #loadingOverlay)
      var topBar = document.createElement('div');
      topBar.id = 'webposTopProgress';
      document.body.appendChild(topBar);

      var globalEl = document.createElement('div');
      globalEl.id = 'webposGlobalLoader';
      var globalCard = buildCard(null, 'Memuat halaman...');
      globalEl.appendChild(globalCard);
      document.body.appendChild(globalEl);
      var globalTitle = globalCard.querySelector('.wpl-title');
      var globalCtrl = attachProgressController(globalEl, globalCard);

      window.WebPOSLoader = {
        show: function(title, sub) {
          if (globalTitle && title) globalTitle.textContent = title;
          globalEl.style.display = 'flex';
          globalEl.style.visibility = 'visible';
          globalEl.style.opacity = '1';
          globalEl.classList.add('active');
          globalCtrl.startProgress(sub || 'Menyiapkan data...');
          topBar.style.opacity = '1';
          topBar.style.width = '78%';
        },
        setProgress: function(pct, sub) {
          globalCtrl.setVisual(pct, sub);
          topBar.style.width = Math.min(100, pct) + '%';
        },
        hide: function() {
          globalCtrl.setVisual(100, 'Selesai');
          globalCtrl.stopProgress();
          topBar.style.width = '100%';
          setTimeout(function() {
            globalEl.classList.remove('active');
            globalEl.style.display = 'none';
            topBar.style.opacity = '0';
            topBar.style.width = '0%';
          }, 140);
        }
      };

      // 2. Prefetch halus saat jari menyentuh / hover menu + Transisi Mulus Anti-Stuck
      var prefetchedUrls = {};
      function prefetchPage(e) {
        var link = e.target && e.target.closest ? e.target.closest('a[href$=".html"]') : null;
        if (!link) return;
        var href = link.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#' || prefetchedUrls[href]) return;
        prefetchedUrls[href] = 1;
        var pf = document.createElement('link');
        pf.rel = 'prefetch';
        pf.href = href;
        document.head.appendChild(pf);
      }
      document.addEventListener('touchstart', prefetchPage, { passive: true, capture: true });
      document.addEventListener('mouseenter', prefetchPage, true);

      var navDelayTimer = null;
      var navSafetyTimer = null;
      function clearNavLoaders() {
        if (navDelayTimer) { clearTimeout(navDelayTimer); navDelayTimer = null; }
        if (navSafetyTimer) { clearTimeout(navSafetyTimer); navSafetyTimer = null; }
        if (window.WebPOSLoader) window.WebPOSLoader.hide();
      }

      document.addEventListener('click', function(e) {
        if (e.defaultPrevented) return;
        var link = e.target && e.target.closest ? e.target.closest('a[href$=".html"]') : null;
        if (!link) return;
        var href = (link.getAttribute('href') || '').trim();
        if (!href || href.charAt(0) === '#' || link.target === '_blank' || e.ctrlKey || e.metaKey) return;

        // Jangan tampilkan loader jika klik menu halaman yang sedang terbuka saat ini
        try {
          var targetUrl = new URL(href, window.location.href);
          if (targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search) {
            return;
          }
        } catch (err) {}

        var labelEl = link.querySelector('span');
        var pageLabel = labelEl ? labelEl.textContent.trim() : 'Halaman';

        topBar.style.opacity = '1';
        topBar.style.width = '78%';

        if (navDelayTimer) clearTimeout(navDelayTimer);
        if (navSafetyTimer) clearTimeout(navSafetyTimer);
        navDelayTimer = setTimeout(function() {
          window.WebPOSLoader.show('Membuka ' + pageLabel + '...', 'Menyiapkan halaman...');
          navSafetyTimer = setTimeout(clearNavLoaders, 6000);
        }, 350);
      }, false);

      window.addEventListener('pageshow', clearNavLoaders);
      window.addEventListener('pagehide', clearNavLoaders);

      // 3. Percantik #loadingOverlay, #loadingVeil, dan SEMUA spinner/teks "Memuat..." di 28 halaman
      var mainOverlay = document.getElementById('loadingOverlay');
      if (mainOverlay) enhanceOverlay(mainOverlay);
      var existingVeil = document.getElementById('loadingVeil');
      if (existingVeil) enhanceOverlay(existingVeil);
      upgradeInlineLoaders(document);

      // 4. Pantau otomatis #loadingVeil baru dan loader "Memuat..." yang dirender dinamis oleh JS halaman
      var inlineScanTimer = null;
      new MutationObserver(function(muts) {
        var needInlineScan = false;
        for (var i = 0; i < muts.length; i++) {
          var nodes = muts[i].addedNodes;
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (!n || n.nodeType !== 1) continue;
            if (n.id === 'loadingVeil' || n.id === 'loadingOverlay') {
              enhanceOverlay(n);
            } else if (!n.classList.contains('wpl-inline-box') && !n.classList.contains('wpl-card')) {
              needInlineScan = true;
            }
          }
        }
        if (needInlineScan && !inlineScanTimer) {
          inlineScanTimer = setTimeout(function() {
            inlineScanTimer = null;
            upgradeInlineLoaders(document);
          }, 60);
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUnifiedLoader);
  } else {
    initUnifiedLoader();
  }
})();
