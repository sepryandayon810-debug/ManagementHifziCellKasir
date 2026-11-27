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
        [
          'webpos_session', 'webpos_user', 'webpos_user_role', 'webpos_user_name',
          'webpos_user_permissions', 'webpos_last_uid', 'webpos_last_username',
          'webpos_shift_status_cache', 'active_shift_id', 'wpos_return_after_modal',
          'header_uang_global', 'header_penjualan', 'header_transaksi', 'header_laba',
          'raw_header_uang_global', 'raw_header_penjualan', 'raw_header_transaksi',
          'raw_header_laba', 'raw_header_date', 'kasir_cart', 'kasir_note',
          'kasir_reseller_name', 'webpos_gas_webhook_url', 'webpos_spreadsheet_url',
          'webpos_gas_secret_key', 'webpos_latest_uang_kasir', 'webpos_debts_cache',
          'temp_hitung_kasir'
        ].forEach(function(k) { localStorage.removeItem(k); });
        sessionStorage.removeItem('webpos_backup_cache');
        if (window.indexedDB && typeof window.indexedDB.deleteDatabase === 'function') {
          window.indexedDB.deleteDatabase('webpos_riwayat_cache_v1');
        }
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
    var latestSwVersion = '';
    var lastCheckAt = 0;

    function extractSwVersion(text) {
      var m = String(text || '').match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
      if (!m || !m[1]) return '';
      var vMatch = m[1].match(/(v[0-9]+(?:\.[0-9]+)*)/i);
      return vMatch ? vMatch[1] : m[1];
    }

    function fetchLatestSwVersion() {
      return fetch('./sw.js?_v=' + Date.now(), { cache: 'no-store' })
        .then(function(res) { return (res && res.ok) ? res.text() : ''; })
        .then(function(txt) {
          var v = extractSwVersion(txt);
          if (v) latestSwVersion = v;
          return v;
        })
        .catch(function() { return latestSwVersion || ''; });
    }

    function showUpdatedVersionToast(verLabel) {
      if (!verLabel || document.getElementById('webposUpdatedToast')) return;
      var el = document.createElement('div');
      el.id = 'webposUpdatedToast';
      el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:82px', 'transform:translateX(-50%)',
        'z-index:99999', 'max-width:calc(100vw - 28px)', 'box-sizing:border-box',
        'background:linear-gradient(135deg,#065f46,#059669)', 'color:#ffffff',
        'padding:11px 16px', 'border-radius:14px',
        'display:flex', 'align-items:center', 'gap:9px',
        'box-shadow:0 14px 30px rgba(5,150,105,0.38)',
        'border:1px solid rgba(255,255,255,0.28)',
        'font-size:12.5px', 'font-weight:700', 'font-family:inherit',
        'transition:opacity .35s ease,transform .35s ease'
      ].join(';');
      el.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
        '<span>Aplikasi berhasil diperbarui ke versi <strong style="background:rgba(255,255,255,0.2);padding:2px 7px;border-radius:6px;">' + verLabel + '</strong></span>';
      document.body.appendChild(el);
      setTimeout(function() {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(function() { el.remove(); }, 360);
      }, 4500);
    }

    function renderSidebarVersionBadge(verLabel) {
      var v = String(verLabel || '').trim();
      if (!v) return;
      var roleEl = document.getElementById('userRole');
      if (!roleEl || !roleEl.parentNode) return;
      if (!document.getElementById('wposSidebarVerStyle')) {
        var st = document.createElement('style');
        st.id = 'wposSidebarVerStyle';
        st.textContent =
          '.wpos-role-ver-row{display:flex;align-items:center;gap:5px;flex-wrap:nowrap;margin-top:1px;min-width:0;}' +
          '.wpos-role-ver-row .user-role{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}' +
          '.wpos-ver-badge{display:inline-flex;align-items:center;font-size:0.58rem;font-weight:700;line-height:1.25;padding:1px 5px;border-radius:4px;background:rgba(99,102,241,0.12);color:var(--primary,#4f46e5);border:1px solid rgba(99,102,241,0.22);letter-spacing:0.02em;white-space:nowrap;flex-shrink:0;text-transform:none;}' +
          '[data-theme="dark"] .wpos-ver-badge{background:rgba(129,140,248,0.18);color:#a5b4fc;border-color:rgba(129,140,248,0.32);}';
        document.head.appendChild(st);
      }
      var badge = document.getElementById('webposSidebarVerBadge');
      if (!badge) {
        var row = roleEl.parentNode.classList && roleEl.parentNode.classList.contains('wpos-role-ver-row')
          ? roleEl.parentNode
          : null;
        if (!row) {
          row = document.createElement('div');
          row.className = 'wpos-role-ver-row';
          roleEl.parentNode.insertBefore(row, roleEl);
          row.appendChild(roleEl);
        }
        badge = document.createElement('span');
        badge.id = 'webposSidebarVerBadge';
        badge.className = 'wpos-ver-badge';
        row.appendChild(badge);
      }
      badge.textContent = v;
      badge.title = 'Versi aplikasi aktif: ' + v;
    }

    // Tampilkan versi kecil di samping info role sidebar langsung dari cache/localStorage
    try {
      var cachedAppVer = localStorage.getItem('webpos_app_version') || '';
      if (cachedAppVer) renderSidebarVersionBadge(cachedAppVer);
    } catch (e) {}

    // Jika halaman baru saja dimuat ulang dari tombol Refresh update (atau versi baru baru saja aktif), tampilkan info versi yang aktif
    try {
      var justUpdatedVer = sessionStorage.getItem('webpos_just_updated_ver');
      if (justUpdatedVer) {
        sessionStorage.removeItem('webpos_just_updated_ver');
        if (justUpdatedVer !== 'terbaru') renderSidebarVersionBadge(justUpdatedVer);
        setTimeout(function() {
          fetchLatestSwVersion().then(function(liveVer) {
            var finalVer = liveVer || justUpdatedVer;
            try {
              if (finalVer && finalVer !== 'terbaru') {
                localStorage.setItem('webpos_app_version', finalVer);
                localStorage.setItem('webpos_seen_toast_ver', finalVer);
              }
            } catch (e) {}
            if (finalVer && finalVer !== 'terbaru') renderSidebarVersionBadge(finalVer);
            showUpdatedVersionToast(finalVer);
          });
        }, 450);
      } else if (window.caches && caches.keys) {
        caches.keys().then(function(keys) {
          var verKeys = keys.filter(function(k) { return /^webpos-hifzi-v/i.test(k); });
          verKeys.sort(function(a, b) {
            var pa = a.replace(/^webpos-hifzi-v/i, '').split('.').map(Number);
            var pb = b.replace(/^webpos-hifzi-v/i, '').split('.').map(Number);
            for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
              var diff = (pb[i] || 0) - (pa[i] || 0);
              if (diff !== 0) return diff;
            }
            return 0;
          });
          var activeKey = verKeys[0] || '';
          var activeVer = activeKey ? activeKey.replace(/^webpos-hifzi-/i, '') : '';
          if (!activeVer) {
            if (!localStorage.getItem('webpos_app_version')) {
              fetchLatestSwVersion().then(function(v) {
                if (!v) return;
                try { localStorage.setItem('webpos_app_version', v); } catch (e) {}
                renderSidebarVersionBadge(v);
              });
            }
            return;
          }
          renderSidebarVersionBadge(activeVer);
          try { localStorage.setItem('webpos_app_version', activeVer); } catch (e) {}
          var lastSeenToast = localStorage.getItem('webpos_seen_toast_ver') || '';
          if (lastSeenToast !== activeVer) {
            try { localStorage.setItem('webpos_seen_toast_ver', activeVer); } catch (e) {}
            setTimeout(function() { showUpdatedVersionToast(activeVer); }, 600);
          }
        }).catch(function() {});
      }
    } catch (e) {}
    
    function showAppUpdateBanner(verHint) {
      if (verHint) latestSwVersion = verHint;
      var existingBadge = document.getElementById('webposUpdateVerBadge');
      var existingDesc = document.getElementById('webposUpdateVerText');
      if (existingBadge && latestSwVersion) {
        existingBadge.textContent = latestSwVersion;
        existingBadge.style.display = 'inline-block';
      }
      if (existingDesc && latestSwVersion) {
        existingDesc.innerHTML = 'Versi terbaru <strong>' + latestSwVersion + '</strong> sudah siap dipakai. Muat ulang sekarang agar fitur &amp; perbaikan langsung aktif — data transaksi tetap aman.';
      }
      if (updateNotifShown || document.getElementById('webposUpdateBanner')) return;
      updateNotifShown = true;

      var initialVer = latestSwVersion || '';
      var bar = document.createElement('div');
      bar.id = 'webposUpdateBanner';
      bar.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:78px', 'transform:translateX(-50%)',
        'z-index:99999', 'width:min(380px, calc(100vw - 24px))', 'box-sizing:border-box',
        'background:linear-gradient(145deg,#0f172a,#1e293b)', 'color:#f8fafc',
        'padding:14px 15px', 'border-radius:16px',
        'box-shadow:0 18px 40px rgba(2,6,23,0.45),0 2px 8px rgba(15,23,42,0.3)',
        'border:1px solid rgba(148,163,184,0.22)',
        'font-family:inherit'
      ].join(';');
      bar.innerHTML =
        '<div style="display:flex;align-items:flex-start;gap:12px;">' +
          '<div style="width:38px;height:38px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 25%,#6ee7b7 0%,#10b981 52%,#047857 100%);border:1.5px solid rgba(255,255,255,0.75);box-shadow:0 6px 14px rgba(16,185,129,0.38),inset 0 2px 4px rgba(255,255,255,0.5);">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>' +
          '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:3px;">' +
              '<span style="font-size:13.5px;font-weight:800;color:#ffffff;letter-spacing:0.01em;">Pembaruan Aplikasi Tersedia</span>' +
              '<span id="webposUpdateVerBadge" style="display:' + (initialVer ? 'inline-block' : 'none') + ';background:rgba(34,197,94,0.22);color:#86efac;border:1px solid rgba(74,222,128,0.4);font-size:11px;font-weight:800;padding:1px 7px;border-radius:6px;">' + initialVer + '</span>' +
            '</div>' +
            '<div id="webposUpdateVerText" style="font-size:12px;line-height:1.45;color:#cbd5e1;">' +
              (initialVer
                ? 'Versi terbaru <strong>' + initialVer + '</strong> sudah siap dipakai. Muat ulang sekarang agar fitur &amp; perbaikan langsung aktif — data transaksi tetap aman.'
                : 'Versi terbaru WebPOS sudah siap dipakai. Muat ulang sekarang agar fitur &amp; perbaikan langsung aktif — data transaksi tetap aman.') +
            '</div>' +
          '</div>' +
          '<button type="button" id="btnCloseWebposUpdate" aria-label="Tutup" style="background:transparent;border:none;width:28px;height:28px;padding:0;cursor:pointer;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;"><svg style="width:24px;height:24px;filter:drop-shadow(0 2px 5px rgba(225,29,72,0.45));" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="wpUpdCloseG" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FB7185"/><stop offset="100%" stop-color="#E11D48"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#wpUpdCloseG)" stroke="#FFFFFF" stroke-width="1.6"/><ellipse cx="24" cy="13" rx="11" ry="4.5" fill="#FFFFFF" fill-opacity="0.32"/><path d="M17 17L31 31M31 17L17 31" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round"/></svg></button>' +        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:12px;">' +
          '<button type="button" id="btnLaterWebposUpdate" style="flex:0 0 auto;background:rgba(148,163,184,0.14);color:#e2e8f0;border:1px solid rgba(148,163,184,0.22);padding:8px 14px;border-radius:10px;font-weight:600;font-size:12px;cursor:pointer;white-space:nowrap;">Nanti</button>' +
          '<button type="button" id="btnReloadWebposUpdate" style="flex:1;background:linear-gradient(135deg,#22c55e,#16a34a);color:#ffffff;border:none;padding:8px 14px;border-radius:10px;font-weight:700;font-size:12.5px;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(34,197,94,0.35);">Refresh' + (initialVer ? ' (' + initialVer + ')' : '') + '</button>' +
        '</div>';
      document.body.appendChild(bar);

      if (!initialVer) {
        fetchLatestSwVersion().then(function(v) {
          if (!v) return;
          var b = document.getElementById('webposUpdateVerBadge');
          var d = document.getElementById('webposUpdateVerText');
          var r = document.getElementById('btnReloadWebposUpdate');
          if (b) { b.textContent = v; b.style.display = 'inline-block'; }
          if (d) d.innerHTML = 'Versi terbaru <strong>' + v + '</strong> sudah siap dipakai. Muat ulang sekarang agar fitur &amp; perbaikan langsung aktif — data transaksi tetap aman.';
          if (r && !r.disabled) r.textContent = 'Refresh (' + v + ')';
        });
      }

      var btnReload = document.getElementById('btnReloadWebposUpdate');
      var btnClose = document.getElementById('btnCloseWebposUpdate');
      var btnLater = document.getElementById('btnLaterWebposUpdate');
      if (btnReload) {
        btnReload.onclick = function() {
          btnReload.disabled = true;
          var targetVer = latestSwVersion || 'terbaru';
          btnReload.textContent = 'Memuat ' + targetVer + '...';
          try {
            if (latestDetectedBuild) localStorage.setItem('webpos_last_build_ver', latestDetectedBuild);
            if (latestSwVersion) localStorage.setItem('webpos_app_version', latestSwVersion);
            sessionStorage.setItem('webpos_just_updated_ver', targetVer);
          } catch (e) {}
          if (window.caches && caches.keys) {
            caches.keys().then(function(keys) {
              var keepKey = latestSwVersion ? ('webpos-hifzi-' + latestSwVersion) : '';
              return Promise.all(keys.filter(function(k) { return !keepKey || k !== keepKey; }).map(function(k) { return caches.delete(k); }));
            }).catch(function() {}).finally(function() { window.location.reload(); });
          } else {
            window.location.reload();
          }
        };
      }
      if (btnClose) btnClose.onclick = function() { bar.remove(); };
      if (btnLater) btnLater.onclick = function() { bar.remove(); };
    }

    // Cek otomatis versi sw.js & stempel deploy terbaru dari GitHub Pages (maksimal 1x per 5 menit agar pindah menu bebas request online)
    function checkGithubBuildUpdate(force) {
      if (!navigator.onLine) return;
      var now = Date.now();
      var savedLastChk = 0;
      try { savedLastChk = Number(localStorage.getItem('webpos_last_chk_ts') || 0); } catch (e) {}
      if (!force && ((now - lastCheckAt) < 300000 || (now - savedLastChk) < 300000)) return;
      lastCheckAt = now;
      try { localStorage.setItem('webpos_last_chk_ts', String(now)); } catch (e) {}

      Promise.all([
        fetchLatestSwVersion(),
        fetch('./index.html?_chk=' + now, { method: 'HEAD', cache: 'no-store' }).catch(function() { return null; })
      ]).then(function(results) {
        var swVer = results[0] || '';
        var res = results[1];
        var serverBuild = (res && res.ok) ? (res.headers.get('last-modified') || res.headers.get('etag') || '') : '';

        var savedVer = '';
        var savedBuild = '';
        try {
          savedVer = localStorage.getItem('webpos_app_version') || '';
          savedBuild = localStorage.getItem('webpos_last_build_ver') || '';
        } catch (e) {}

        if (swVer && !savedVer) {
          try { localStorage.setItem('webpos_app_version', swVer); } catch (e) {}
        }
        if (serverBuild && !savedBuild) {
          try { localStorage.setItem('webpos_last_build_ver', serverBuild); } catch (e) {}
        }

        if ((swVer && savedVer && savedVer !== swVer) || (serverBuild && savedBuild && savedBuild !== serverBuild)) {
          if (serverBuild) latestDetectedBuild = serverBuild;
          showAppUpdateBanner(swVer);
        }
      }).catch(function() {});
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

    chevdown: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="50%" stop-color="#4F46E5"/><stop offset="100%" stop-color="#1E1B4B"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><ellipse cx="24" cy="13.5" rx="11.5" ry="5" fill="#FFFFFF" fill-opacity="0.32"/><path d="M15 21.8L24 30.8L33 21.8" stroke="#1E1B4B" stroke-opacity="0.35" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 20L24 29L33 20" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    chevup: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="50%" stop-color="#4F46E5"/><stop offset="100%" stop-color="#1E1B4B"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.6"/><ellipse cx="24" cy="13.5" rx="11.5" ry="5" fill="#FFFFFF" fill-opacity="0.32"/><path d="M15 29.8L24 20.8L33 29.8" stroke="#1E1B4B" stroke-opacity="0.35" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 28L24 19L33 28" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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

    info: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#7DD3FC"/><stop offset="55%" stop-color="#0EA5E9"/><stop offset="100%" stop-color="#0369A1"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__a)" stroke="#FFFFFF" stroke-width="1.5"/><circle cx="24" cy="15.5" r="2.6" fill="#FEF08A"/><rect x="21.8" y="21" width="4.4" height="14" rx="2.2" fill="#FFFFFF"/></svg>',
    close: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FB7185"/><stop offset="100%" stop-color="#E11D48"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><ellipse cx="24" cy="13" rx="11" ry="4.5" fill="#FFFFFF" fill-opacity="0.32"/><path d="M17 17L31 31M31 17L17 31" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round"/></svg>',
    search: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__g" x1="8" y1="8" x2="34" y2="34" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#67E8F9"/><stop offset="100%" stop-color="#0284C7"/></linearGradient></defs><circle cx="21" cy="21" r="13" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="2"/><circle cx="21" cy="21" r="7.5" fill="#E0F2FE"/><ellipse cx="18.5" cy="17.5" rx="3.5" ry="2" fill="#FFFFFF" fill-opacity="0.85"/><path d="M31 31L40 40" stroke="#0369A1" stroke-width="6" stroke-linecap="round"/><path d="M31 31L40 40" stroke="#38BDF8" stroke-width="3.2" stroke-linecap="round"/></svg>',
    eye: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__g" x1="6" y1="12" x2="42" y2="36" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60A5FA"/><stop offset="100%" stop-color="#2563EB"/></linearGradient></defs><path d="M4 24C8.8 15 15.8 11 24 11C32.2 11 39.2 15 44 24C39.2 33 32.2 37 24 37C15.8 37 8.8 33 4 24Z" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><circle cx="24" cy="24" r="8" fill="#FFFFFF"/><circle cx="24" cy="24" r="4.5" fill="#1E3A8A"/><circle cx="22.3" cy="22.2" r="1.6" fill="#FFFFFF"/></svg>',
    eyeoff: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__g" x1="6" y1="12" x2="42" y2="36" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#94A3B8"/><stop offset="100%" stop-color="#475569"/></linearGradient></defs><path d="M4 24C8.8 15 15.8 11 24 11C32.2 11 39.2 15 44 24C39.2 33 32.2 37 24 37C15.8 37 8.8 33 4 24Z" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><circle cx="24" cy="24" r="6.5" fill="#E2E8F0"/><path d="M10 10L38 38" stroke="#F43F5E" stroke-width="4.5" stroke-linecap="round"/></svg>',
    backspace: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__g" x1="6" y1="10" x2="42" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FBBF24"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><path d="M16 11H38C40.8 11 43 13.2 43 16V32C43 34.8 40.8 37 38 37H16L6 24L16 11Z" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M22 19L32 29M32 19L22 29" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round"/></svg>',
    arrowright: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#818CF8"/><stop offset="100%" stop-color="#4338CA"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><ellipse cx="24" cy="13" rx="10" ry="4" fill="#FFFFFF" fill-opacity="0.3"/><path d="M15 24H32M26 17L33 24L26 31" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sort: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#2563EB"/></linearGradient></defs><rect x="6" y="6" width="36" height="36" rx="11" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M17 31V16M12.5 20.5L17 16L21.5 20.5" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M31 17V32M26.5 27.5L31 32L35.5 27.5" stroke="#FDE047" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shield: '<svg class="ui-3d-svg" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="__ID__g" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="55%" stop-color="#059669"/><stop offset="100%" stop-color="#065F46"/></linearGradient></defs><path d="M24 5L39 11V23C39 33 32.5 40 24 43C15.5 40 9 33 9 23V11L24 5Z" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M17 24L22 29L32 18.5" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function mapGlobalUiKey(el) {
    var c = el.className || '';
    if (!c || /fa-spin|fa-spinner|fa-circle-notch|fa-caret|fa-ellipsis|fa-grip/.test(c)) return null;

    if (/(?:^|\s)fa-(?:times|xmark|close)(?:\s|$)/.test(c)) return 'close';
    if (/(?:^|\s)fa-search(?:\s|$)/.test(c)) return 'search';
    if (c.indexOf('fa-eye-slash') !== -1) return 'eyeoff';
    if (/(?:^|\s)fa-eye(?:\s|$)/.test(c)) return 'eye';
    if (c.indexOf('fa-backspace') !== -1) return 'backspace';
    if (c.indexOf('fa-arrow-right') !== -1) return 'arrowright';
    if (c.indexOf('fa-sort') !== -1) return 'sort';
    if (c.indexOf('fa-shield') !== -1) return 'shield';
    if (c.indexOf('fa-sliders') !== -1) return 'settings';
    if (c.indexOf('fa-shopping-bag') !== -1) return 'basket';
    if (c.indexOf('fa-dice') !== -1) return 'bolt';
    if (c.indexOf('fa-chevron-down') !== -1 || c.indexOf('fa-angle-down') !== -1) return 'chevdown';
    if (c.indexOf('fa-chevron-up') !== -1 || c.indexOf('fa-angle-up') !== -1) return 'chevup';
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
    '.user-avatar',
    '#btnThemeToggle',
    '#btnTheme',
    '#btnLogout',
    '#mobileMenuToggle',
    '.logo-icon.has-custom-logo',
    '.logo-badge.has-custom-logo',
    '#webposDateModal',
    '#webposSelectModal',
    '#webposReceiptImgModal',
    '#webposUnifiedPreviewModal',
    '#btnWpShareNotaImg',
    '#btnWpSaveNotaPdf',
    '.wp-3d-native-icon'
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
        var hasCustom3d = !s.classList.contains('u3d-dd-arrow') && parent.querySelector(':scope > svg.dash-3d-svg, :scope > svg.nav-3d-svg, :scope > svg.prod-3d-icon');
        if (hasCustom3d || !prev || prev.tagName !== 'I' || prev.dataset.upgraded3d !== '1') {
          s.remove();
        }
      }
    } catch (e) {}
  }

  function upgradeSingleIcon(el) {
    try {
      if (!el || el.id === 'shiftToggleIcon') return;
      var isDropdownArrow = el.classList.contains('dropdown-arrow');
      if (!isDropdownArrow && el.closest(SKIP_SEL)) return;

      var parent = el.parentNode;
      if (!parent) return;

      if (!isDropdownArrow && parent.querySelector(':scope > svg.dash-3d-svg, :scope > svg.nav-3d-svg, :scope > svg.prod-3d-icon')) {
        var oldDup = el.nextElementSibling;
        if (oldDup && oldDup.dataset && oldDup.dataset.u3dFor === '1') oldDup.remove();
        return;
      }

      var curClass = el.className || '';
      if (el.dataset.upgraded3d === '1' && el.dataset.u3dClass === curClass) {
        var exSvg = el.nextElementSibling;
        if (exSvg && exSvg.dataset && exSvg.dataset.u3dFor === '1' && !exSvg.classList.contains('ui-3d-abs') && !exSvg.classList.contains('u3d-dd-arrow')) {
          exSvg.style.transform = el.style.transform || '';
        }
        return;
      }
      
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
        if (isDropdownArrow) svg.classList.add('u3d-dd-arrow');
        else if (el.style && el.style.transform) svg.style.transform = el.style.transform;
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
        if (key === 'close' && parent.tagName === 'BUTTON' && !(parent.textContent || '').trim() && !parent.classList.contains('btn-mobile-cancel')) {
          parent.classList.add('u3d-close-btn');
        }
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
          '.expand-btn{display:inline-flex !important;align-items:center !important;justify-content:center !important;padding:0.2rem !important;border-radius:50% !important;transition:transform .24s cubic-bezier(.22,1,.36,1) !important;}',
          '.expand-btn > .ui-3d-svg{width:24px;height:24px;margin:0;filter:drop-shadow(0 3px 5px rgba(79,70,229,0.34));transition:transform .24s cubic-bezier(.22,1,.36,1),filter .2s ease;}',
          '.expand-btn:hover > .ui-3d-svg{transform:scale(1.12);filter:drop-shadow(0 4px 8px rgba(79,70,229,0.48));}',
          '.expand-btn:active > .ui-3d-svg{transform:scale(0.94);}',
          '.expand-btn.open > .ui-3d-svg{transform:rotate(180deg);}',
          '.cart-minimize:has(> .ui-3d-svg){background:transparent !important;box-shadow:none !important;}',
          '.cart-minimize > .ui-3d-svg{width:26px;height:26px;margin:0;filter:drop-shadow(0 3px 5px rgba(79,70,229,0.34));}',
          '.cart-minimize:hover > .ui-3d-svg{transform:scale(1.12);}',
          '#ntLogicChevron + .ui-3d-svg,#paymentItemsChevron + .ui-3d-svg{width:20px;height:20px;margin:0;filter:drop-shadow(0 2px 4px rgba(79,70,229,0.32));transition:transform .24s cubic-bezier(.22,1,.36,1);}',
          '.u3d-dd-arrow{width:19px !important;height:19px !important;margin:0 0 0 auto !important;filter:drop-shadow(0 2px 4px rgba(79,70,229,0.32));transition:transform .24s cubic-bezier(.22,1,.36,1),filter .2s ease !important;}',
          '.nav-dropdown-toggle:hover > .u3d-dd-arrow{filter:drop-shadow(0 3px 6px rgba(79,70,229,0.48));transform:scale(1.1);}',
          '.nav-dropdown.open .nav-dropdown-toggle > .u3d-dd-arrow{transform:rotate(180deg) !important;}',
          '.sidebar.collapsed .u3d-dd-arrow{display:none !important;}',
          '.kas-date-btn > .ui-3d-svg,.page-btn > .ui-3d-svg,.btn-icon-box > .ui-3d-svg,.btn-icon-sm > .ui-3d-svg,.btn-icon > .ui-3d-svg,.floating-cart-btn > .ui-3d-svg{width:18px;height:18px;margin:0;}',
         '.u3d-close-btn,.modal-close:has(> .ui-3d-svg),.close-btn:has(> .ui-3d-svg),.struk-modal-close:has(> .ui-3d-svg),.barcode-modal-close:has(> .ui-3d-svg),.undo-close:has(> .ui-3d-svg),.cart-item-remove:has(> .ui-3d-svg),.reseller-counter-clear:has(> .ui-3d-svg),.bi-remove:has(> .ui-3d-svg){background:transparent !important;border:none !important;box-shadow:none !important;padding:2px !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;}',
          '.u3d-close-btn > .ui-3d-svg,.modal-close > .ui-3d-svg,.close-btn > .ui-3d-svg,.struk-modal-close > .ui-3d-svg,.barcode-modal-close > .ui-3d-svg,.undo-close > .ui-3d-svg{width:26px !important;height:26px !important;margin:0 !important;filter:drop-shadow(0 3px 6px rgba(225,29,72,0.36)) !important;}',
          '.u3d-close-btn:hover > .ui-3d-svg,.modal-close:hover > .ui-3d-svg,.close-btn:hover > .ui-3d-svg,.struk-modal-close:hover > .ui-3d-svg,.barcode-modal-close:hover > .ui-3d-svg,.cart-item-remove:hover > .ui-3d-svg{transform:scale(1.14) !important;}',
          '.u3d-close-btn:active > .ui-3d-svg{transform:scale(0.94) !important;}',
          '.cart-item-remove.u3d-close-btn > .ui-3d-svg,.cart-item-remove > .ui-3d-svg,.reseller-counter-clear.u3d-close-btn > .ui-3d-svg,.bi-remove.u3d-close-btn > .ui-3d-svg{width:19px !important;height:19px !important;}',
          '.qty-btn > .ui-3d-svg{width:15px;height:15px;margin:0;}',
          '.numpad-btn > .ui-3d-svg{width:20px;height:20px;margin:0;}',
          '.password-toggle > .ui-3d-svg,.toggle-password > .ui-3d-svg{width:18px;height:18px;margin:0;}',
          '.action-arrow > .ui-3d-svg{width:16px;height:16px;margin:0;}',
          '#btnHealthGuard > .ui-3d-svg{width:22px;height:22px;margin:0;}',
          '#btnHealthGuard:hover > .ui-3d-svg{transform:scale(1.12);}',
          '#btnThemeToggle .ui-3d-svg,#btnTheme .ui-3d-svg,#btnLogout .ui-3d-svg,#mobileMenuToggle .ui-3d-svg{width:20px;height:20px;margin:0;}',
          '#btnThemeToggle:hover .ui-3d-svg,#btnTheme:hover .ui-3d-svg,#btnLogout:hover .ui-3d-svg,#mobileMenuToggle:hover .ui-3d-svg,.menu-toggle:hover > .ui-3d-svg{transform:scale(1.12);}',
          '.user-avatar{position:relative !important;overflow:hidden !important;border-radius:50% !important;background:radial-gradient(circle at 30% 25%,rgba(255,255,255,0.48) 0%,rgba(255,255,255,0.06) 38%,rgba(15,23,42,0.38) 100%),linear-gradient(145deg,var(--primary,#6366f1),#7c3aed) !important;border:2px solid rgba(255,255,255,0.85) !important;box-shadow:0 6px 14px rgba(79,70,229,0.38),0 2px 4px rgba(15,23,42,0.22),inset 0 2px 4px rgba(255,255,255,0.58),inset 0 -5px 8px rgba(15,23,42,0.34) !important;font-weight:800 !important;letter-spacing:0.03em !important;text-shadow:0 1px 2px rgba(15,23,42,0.45) !important;transition:transform .22s ease,box-shadow .22s ease !important;}',
          '.user-avatar::before{content:"" !important;position:absolute !important;top:2px !important;left:16% !important;width:68% !important;height:40% !important;border-radius:50% !important;background:linear-gradient(180deg,rgba(255,255,255,0.52) 0%,rgba(255,255,255,0.06) 72%,rgba(255,255,255,0) 100%) !important;pointer-events:none !important;}',
          '.user-avatar::after{content:"" !important;position:absolute !important;bottom:2px !important;left:24% !important;width:52% !important;height:18% !important;border-radius:50% !important;background:radial-gradient(ellipse at center,rgba(255,255,255,0.32) 0%,rgba(255,255,255,0) 75%) !important;pointer-events:none !important;}',
          '.user-profile:hover .user-avatar{transform:translateY(-2px) scale(1.06) !important;box-shadow:0 9px 18px rgba(79,70,229,0.46),0 3px 6px rgba(15,23,42,0.24),inset 0 2px 5px rgba(255,255,255,0.65),inset 0 -5px 8px rgba(15,23,42,0.36) !important;}',
          'select:not([multiple]){appearance:none !important;-webkit-appearance:none !important;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 48 48\' fill=\'none\'%3E%3Cdefs%3E%3ClinearGradient id=\'g\' x1=\'8\' y1=\'5\' x2=\'40\' y2=\'43\' gradientUnits=\'userSpaceOnUse\'%3E%3Cstop offset=\'0%25\' stop-color=\'%2393C5FD\'/%3E%3Cstop offset=\'50%25\' stop-color=\'%234F46E5\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%231E1B4B\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx=\'24\' cy=\'24\' r=\'19\' fill=\'url(%23g)\' stroke=\'%23FFFFFF\' stroke-width=\'1.6\'/%3E%3Cellipse cx=\'24\' cy=\'13.5\' rx=\'11.5\' ry=\'5\' fill=\'%23FFFFFF\' fill-opacity=\'0.32\'/%3E%3Cpath d=\'M15 21.8L24 30.8L33 21.8\' stroke=\'%231E1B4B\' stroke-opacity=\'0.35\' stroke-width=\'4.4\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3Cpath d=\'M15 20L24 29L33 20\' stroke=\'%23FFFFFF\' stroke-width=\'4.2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E") !important;background-repeat:no-repeat !important;background-position:right 0.6rem center !important;background-size:18px 18px !important;padding-right:2.25rem !important;}',
          '.filter-input-3d select{background-image:none !important;}',
          'input[type="date"]{appearance:none !important;-webkit-appearance:none !important;position:relative !important;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 48 48\' fill=\'none\'%3E%3Cdefs%3E%3ClinearGradient id=\'c\' x1=\'6\' y1=\'10\' x2=\'42\' y2=\'42\' gradientUnits=\'userSpaceOnUse\'%3E%3Cstop offset=\'0%25\' stop-color=\'%23F8FAFC\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23CBD5E1\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect x=\'6\' y=\'10\' width=\'36\' height=\'32\' rx=\'7\' fill=\'url(%23c)\' stroke=\'%23FFFFFF\' stroke-width=\'1.5\'/%3E%3Cpath d=\'M6 17C6 13.1 9.1 10 13 10H35C38.9 10 42 13.1 42 17V20H6V17Z\' fill=\'%23EF4444\'/%3E%3Crect x=\'14\' y=\'6\' width=\'4.5\' height=\'9\' rx=\'2.2\' fill=\'%233B82F6\' stroke=\'%23FFFFFF\' stroke-width=\'1.2\'/%3E%3Crect x=\'29.5\' y=\'6\' width=\'4.5\' height=\'9\' rx=\'2.2\' fill=\'%233B82F6\' stroke=\'%23FFFFFF\' stroke-width=\'1.2\'/%3E%3Crect x=\'13\' y=\'25\' width=\'6\' height=\'5\' rx=\'1.5\' fill=\'%233B82F6\'/%3E%3Crect x=\'21\' y=\'25\' width=\'6\' height=\'5\' rx=\'1.5\' fill=\'%2310B981\'/%3E%3Crect x=\'29\' y=\'25\' width=\'6\' height=\'5\' rx=\'1.5\' fill=\'%23F59E0B\'/%3E%3Crect x=\'13\' y=\'32\' width=\'14\' height=\'4.5\' rx=\'1.5\' fill=\'%2394A3B8\'/%3E%3C/svg%3E") !important;background-repeat:no-repeat !important;background-position:right 0.65rem center !important;background-size:18px 18px !important;padding-right:2.35rem !important;}',
          '.filter-input-3d input[type="date"]{background-image:none !important;padding-right:0.85rem !important;}',
          'input[type="date"]::-webkit-calendar-picker-indicator,input[type="date"]::-webkit-inner-spin-button,input[type="date"]::-webkit-clear-button{display:none !important;-webkit-appearance:none !important;appearance:none !important;opacity:0 !important;width:0 !important;height:0 !important;}'
        ].join('\n');
        document.head.appendChild(st);
      }

      if (!window.__webposDatePickerClickBound) {
        window.__webposDatePickerClickBound = true;
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
            if (m.attributeName === 'style') {
              if (m.target.dataset.upgraded3d === '1') {
                var sibSvg = m.target.nextElementSibling;
                if (sibSvg && sibSvg.dataset && sibSvg.dataset.u3dFor === '1' && !sibSvg.classList.contains('ui-3d-abs') && !sibSvg.classList.contains('u3d-dd-arrow')) {
                  sibSvg.style.transform = m.target.style.transform || '';
                }
              }
            } else {
              changedIcons.push(m.target);
            }
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
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
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

// 7. JAM LIVE MINIMALIS SESUAI DEVICE (MENYATU DI ATAS PROFIL SIDEBAR + CHIP RINGKAS HEADER HP)
(function() {
  if (window.__webposLiveClockInit) return;
  window.__webposLiveClockInit = true;

  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function getZoneLabel(date) {
    var off = -date.getTimezoneOffset();
    if (off === 420) return 'WIB';
    if (off === 480) return 'WITA';
    if (off === 540) return 'WIT';
    return '';
  }

  function initLiveClock() {
    try {
      if (window.location.pathname.indexOf('login.html') !== -1) return;

      if (!document.getElementById('webposLiveClockStyle')) {
        var st = document.createElement('style');
        st.id = 'webposLiveClockStyle';
        st.textContent = [
          '@keyframes wposDotPulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.45;transform:scale(.85);}}',
          '.webpos-sidebar-clock{padding:0.65rem 1rem 0.6rem;border-top:1px solid var(--border,var(--border-color,#e2e8f0));background:linear-gradient(180deg,rgba(99,102,241,0.045) 0%,transparent 100%);flex-shrink:0;transition:all .2s ease;}',
          '.webpos-clock-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
          '.webpos-clock-left{display:flex;align-items:center;gap:7px;min-width:0;}',
          '.webpos-clock-live-dot{width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,0.18);animation:wposDotPulse 2s ease-in-out infinite;flex-shrink:0;}',
          '.webpos-clock-hm{font-size:1.12rem;font-weight:800;letter-spacing:-0.01em;color:var(--text-main,var(--text-primary,#0f172a));font-variant-numeric:tabular-nums;line-height:1;}',
          '.webpos-clock-sec{font-size:0.78rem;font-weight:700;color:var(--primary,#6366f1);font-variant-numeric:tabular-nums;opacity:0.85;margin-left:1px;}',
          '.webpos-clock-tz{font-size:0.62rem;font-weight:700;letter-spacing:0.05em;color:var(--text-muted,#64748b);background:var(--bg-subtle,var(--bg-secondary,#f1f5f9));border:1px solid var(--border,var(--border-color,#e2e8f0));padding:2px 6px;border-radius:6px;flex-shrink:0;}',
          '.webpos-clock-date{font-size:0.71rem;font-weight:500;color:var(--text-muted,#64748b);margin-top:4px;padding-left:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
          '.sidebar.collapsed .webpos-sidebar-clock{padding:0.55rem 0.25rem;text-align:center;}',
          '.sidebar.collapsed .webpos-clock-top{justify-content:center;}',
          '.sidebar.collapsed .webpos-clock-live-dot,.sidebar.collapsed .webpos-clock-sec,.sidebar.collapsed .webpos-clock-tz,.sidebar.collapsed .webpos-clock-date{display:none !important;}',
          '.sidebar.collapsed .webpos-clock-hm{font-size:0.76rem;}',
          '.webpos-mobile-clock{display:none;align-items:center;gap:5px;padding:0 9px;height:34px;border-radius:10px;background:var(--bg-subtle,var(--bg-secondary,#f1f5f9));border:1px solid var(--border,var(--border-color,#e2e8f0));color:var(--text-main,var(--text-primary,#0f172a));font-size:0.74rem;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0;}',
          '.webpos-mobile-clock-dot{width:6px;height:6px;border-radius:50%;background:#10b981;box-shadow:0 0 6px rgba(16,185,129,0.55);animation:wposDotPulse 2s ease-in-out infinite;flex-shrink:0;}',
          '@media(max-width:768px){.webpos-mobile-clock{display:inline-flex;}}',
          '@media(max-width:400px){.webpos-mobile-clock{padding:0 7px;font-size:0.69rem;height:32px;}}'
        ].join('\n');
        document.head.appendChild(st);
      }

      // 1. Strip Jam Bersih & Elegan di Sidebar (menyatu tepat di atas .sidebar-footer / profil SE)
      var footer = document.querySelector('.sidebar-footer');
      if (footer && footer.parentNode && !document.getElementById('webposSidebarClock')) {
        var box = document.createElement('div');
        box.id = 'webposSidebarClock';
        box.className = 'webpos-sidebar-clock';
        box.innerHTML =
          '<div class="webpos-clock-top">' +
            '<div class="webpos-clock-left">' +
              '<span class="webpos-clock-live-dot" aria-hidden="true"></span>' +
              '<span class="webpos-clock-hm" id="wposClockHm">--:--</span><span class="webpos-clock-sec" id="wposClockSec">:--</span>' +
            '</div>' +
            '<span class="webpos-clock-tz" id="wposClockTz"></span>' +
          '</div>' +
          '<div class="webpos-clock-date" id="wposClockDate">Memuat waktu...</div>';
        footer.parentNode.insertBefore(box, footer);
      }

      // 2. Chip Jam Ringkas di Header Kanan (khusus tampilan HP saat sidebar tersembunyi)
      var actions = document.querySelector('.main-header .header-actions');
      if (actions && !document.getElementById('webposMobileClock')) {
        var chip = document.createElement('div');
        chip.id = 'webposMobileClock';
        chip.className = 'webpos-mobile-clock';
        chip.innerHTML = '<span class="webpos-mobile-clock-dot"></span><span id="wposMobClockTime">--:--:--</span>';
        actions.insertBefore(chip, actions.firstChild);
      }

      function tickClock() {
        var now = new Date();
        var hh = pad2(now.getHours());
        var mm = pad2(now.getMinutes());
        var ss = pad2(now.getSeconds());
        var hmStr = hh + ':' + mm;
        var timeStr = hmStr + ':' + ss;
        var dateStr = HARI[now.getDay()] + ', ' + now.getDate() + ' ' + BULAN[now.getMonth()] + ' ' + now.getFullYear();
        var tzStr = getZoneLabel(now);

        var elHm = document.getElementById('wposClockHm');
        var elSec = document.getElementById('wposClockSec');
        var elD = document.getElementById('wposClockDate');
        var elZ = document.getElementById('wposClockTz');
        var elM = document.getElementById('wposMobClockTime');
        if (elHm) elHm.textContent = hmStr;
        if (elSec) elSec.textContent = ':' + ss;
        if (elD) elD.textContent = dateStr;
        if (elZ) { elZ.textContent = tzStr; elZ.style.display = tzStr ? 'inline-block' : 'none'; }
        if (elM) { elM.textContent = timeStr; elM.parentNode.title = dateStr + (tzStr ? ' • ' + tzStr : ''); }
      }

      tickClock();
      setInterval(tickClock, 1000);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiveClock);
  } else {
    initLiveClock();
  }
})();

// =========================================================================
// GLOBAL MODERN IN-APP DIALOG (PENGGANTI POP-UP WINDOWS alert / confirm)
// =========================================================================
(function() {
  if (window.WebPOSDialog) return;

  function ensureDialogStyles() {
    if (document.getElementById('webpos-global-dialog-style')) return;
    var style = document.createElement('style');
    style.id = 'webpos-global-dialog-style';
    style.textContent =
      '#webposGlobalDialogBackdrop{position:fixed;inset:0;background:rgba(15,23,42,0.58);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:1rem;z-index:999999;animation:wpDlgFade .16s ease;}' +
      '#webposGlobalDialogBackdrop.open{display:flex;}' +
      '.wp-dlg-card{width:100%;max-width:390px;background:var(--bg-surface,#ffffff);color:var(--text-main,#0f172a);border:1px solid var(--border,#e2e8f0);border-radius:18px;padding:1.45rem 1.35rem 1.25rem;box-shadow:0 24px 48px rgba(15,23,42,0.28);text-align:center;animation:wpDlgPop .18s ease;}' +
      '.wp-dlg-icon{width:54px;height:54px;border-radius:16px;margin:0 auto .9rem;display:flex;align-items:center;justify-content:center;font-size:1.45rem;}' +
      '.wp-dlg-icon.info{background:rgba(79,70,229,0.12);color:#4f46e5;}' +
      '.wp-dlg-icon.danger{background:rgba(239,68,68,0.12);color:#dc2626;}' +
      '.wp-dlg-icon.warning{background:rgba(245,158,11,0.14);color:#d97706;}' +
      '.wp-dlg-title{font-size:1.05rem;font-weight:800;margin:0 0 .45rem;color:var(--text-main,#0f172a);}' +
      '.wp-dlg-msg{font-size:.87rem;line-height:1.5;color:var(--text-muted,#64748b);margin:0 0 1.25rem;white-space:pre-line;word-break:break-word;}' +
      '.wp-dlg-actions{display:flex;gap:.6rem;justify-content:center;}' +
      '.wp-dlg-btn{flex:1;padding:.68rem 1rem;border-radius:12px;font-weight:700;font-size:.85rem;cursor:pointer;border:1px solid transparent;transition:all .15s ease;}' +
      '.wp-dlg-btn.cancel{background:var(--bg-subtle,#f1f5f9);color:var(--text-main,#334155);border-color:var(--border,#cbd5e1);}' +
      '.wp-dlg-btn.cancel:hover{filter:brightness(0.95);}' +
      '.wp-dlg-btn.primary{background:var(--primary,#4f46e5);color:#ffffff;}' +
      '.wp-dlg-btn.danger{background:#dc2626;color:#ffffff;}' +
      '.wp-dlg-btn.primary:hover,.wp-dlg-btn.danger:hover{filter:brightness(1.06);}' +
      '@keyframes wpDlgFade{from{opacity:0}to{opacity:1}}' +
      '@keyframes wpDlgPop{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}';
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureDialogDOM() {
    ensureDialogStyles();
    var backdrop = document.getElementById('webposGlobalDialogBackdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'webposGlobalDialogBackdrop';
    backdrop.innerHTML =
      '<div class="wp-dlg-card" role="dialog" aria-modal="true">' +
        '<div class="wp-dlg-icon info" id="wpDlgIcon"><i class="fas fa-circle-question"></i></div>' +
        '<h3 class="wp-dlg-title" id="wpDlgTitle">Konfirmasi</h3>' +
        '<p class="wp-dlg-msg" id="wpDlgMsg"></p>' +
        '<div class="wp-dlg-actions">' +
          '<button type="button" class="wp-dlg-btn cancel" id="wpDlgCancel">Batal</button>' +
          '<button type="button" class="wp-dlg-btn primary" id="wpDlgConfirm">Ya, Lanjutkan</button>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(backdrop);
    return backdrop;
  }

  function showDialog(mode, message, onConfirm, opts) {
    opts = opts || {};
    return new Promise(function(resolve) {
      var backdrop = ensureDialogDOM();
      var iconEl = document.getElementById('wpDlgIcon');
      var titleEl = document.getElementById('wpDlgTitle');
      var msgEl = document.getElementById('wpDlgMsg');
      var cancelBtn = document.getElementById('wpDlgCancel');
      var confirmBtn = document.getElementById('wpDlgConfirm');

      var msgText = String(message == null ? '' : message);
      var isDanger = opts.danger === true || /hapus|keluar|logout|reset|permanen/i.test(msgText);

      titleEl.textContent = opts.title || (mode === 'alert' ? 'Informasi' : 'Konfirmasi');
      msgEl.textContent = msgText;

      iconEl.className = 'wp-dlg-icon ' + (mode === 'alert' ? (opts.type || 'info') : (isDanger ? 'danger' : 'warning'));
      iconEl.innerHTML = mode === 'alert'
        ? '<i class="fas fa-circle-info"></i>'
        : (isDanger ? '<i class="fas fa-triangle-exclamation"></i>' : '<i class="fas fa-circle-question"></i>');

      cancelBtn.style.display = mode === 'alert' ? 'none' : '';
      cancelBtn.textContent = opts.cancelText || 'Batal';
      confirmBtn.textContent = opts.confirmText || (mode === 'alert' ? 'Mengerti' : 'Ya, Lanjutkan');
      confirmBtn.className = 'wp-dlg-btn ' + (mode === 'alert' ? 'primary' : (isDanger ? 'danger' : 'primary'));

      function cleanup(result) {
        backdrop.classList.remove('open');
        backdrop.onclick = null;
        document.removeEventListener('keydown', onKeyDown);
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        resolve(result);
        if (result && typeof onConfirm === 'function') {
          try { onConfirm(); } catch (err) { console.error(err); }
        }
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') cleanup(false);
      }

      cancelBtn.onclick = function() { cleanup(false); };
      confirmBtn.onclick = function() { cleanup(true); };
      backdrop.onclick = function(e) { if (e.target === backdrop) cleanup(false); };
      document.addEventListener('keydown', onKeyDown);
      backdrop.classList.add('open');
      setTimeout(function() { try { confirmBtn.focus(); } catch (e) {} }, 30);
    });
  }

  window.WebPOSDialog = {
    alert: function(msg, opts) { return showDialog('alert', msg, null, opts); },
    confirm: function(msg, onConfirm, opts) { return showDialog('confirm', msg, onConfirm, opts); }
  };

  // Cegah pop-up native Windows alert() muncul di halaman mana pun
  window.alert = function(msg) {
    if (document.body) {
      window.WebPOSDialog.alert(msg);
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        window.WebPOSDialog.alert(msg);
      }, { once: true });
    }
  };
})();

// =========================================================================
// WEBPOS HEALTH GUARD — DETEKSI KEBOCORAN & AUTO-FIX (KHUSUS OWNER/DEVELOPER)
// =========================================================================
(function() {
  if (window.WebPOSHealthGuard) return;
  if (/login\.html|register\.html|offline\.html/i.test(window.location.pathname || '')) return;

  var ERR_STORAGE_KEY = 'webpos_detected_errors_v1';
  var DISMISSED_KEY = 'webpos_health_dismissed_v1';
  var currentIssues = [];
  var isOwnerOrDev = false;
  var activeAuthUser = null;

  function safeJsonParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }

  function getTodayYMD() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function escapeText(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function recordRuntimeError(source, message, detail) {
    try {
      var msg = String(message || 'Unknown error').slice(0, 220);
      if (/ResizeObserver|Script error\.?$|WebSocket|NetworkError/i.test(msg)) return;
      var list = safeJsonParse(localStorage.getItem(ERR_STORAGE_KEY), []);
      if (!Array.isArray(list)) list = [];
      var page = (window.location.pathname.split('/').pop() || 'index.html');
      var key = page + '|' + msg;
      var exists = list.find(function(x) { return x && x.key === key; });
      if (exists) {
        exists.count = (exists.count || 1) + 1;
        exists.lastAt = Date.now();
      } else {
        list.unshift({
          key: key,
          page: page,
          source: source,
          message: msg,
          detail: String(detail || '').slice(0, 260),
          count: 1,
          lastAt: Date.now()
        });
        if (list.length > 15) list = list.slice(0, 15);
      }
      localStorage.setItem(ERR_STORAGE_KEY, JSON.stringify(list));
      if (isOwnerOrDev) {
        runLocalHealthChecks();
      }
    } catch (e) {}
  }

  window.addEventListener('error', function(ev) {
    if (!ev) return;
    recordRuntimeError('JS Error', ev.message || 'Runtime error', (ev.filename || '') + ':' + (ev.lineno || 0));
  });

  window.addEventListener('unhandledrejection', function(ev) {
    if (!ev) return;
    var r = ev.reason;
    var msg = (r && r.message) ? r.message : String(r || 'Unhandled Promise Rejection');
    recordRuntimeError('Promise Error', msg, (r && r.code) ? String(r.code) : '');
  });

  function ensureGuardStyles() {
    if (document.getElementById('webpos-health-guard-style')) return;
    var st = document.createElement('style');
    st.id = 'webpos-health-guard-style';
    st.textContent =
      '.sidebar-footer .user-profile{display:flex;align-items:center;gap:.65rem;width:100%;}' +
      '.sidebar-footer .user-info{min-width:0;flex:1;}' +
      '#btnHealthGuard{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;margin-left:auto;border-radius:11px;border:1px solid var(--border,#e2e8f0);background:var(--bg-subtle,#f8fafc);color:#059669;cursor:pointer;transition:all .15s ease;flex-shrink:0;}' +
      '#btnHealthGuard:hover{transform:translateY(-1px);border-color:var(--primary,#4f46e5);background:var(--bg-surface,#fff);}' +
      '#btnHealthGuard.has-alert{color:#dc2626;border-color:rgba(220,38,38,0.45);background:rgba(239,68,68,0.1);}' +
      '.sidebar.collapsed .sidebar-footer .user-profile{flex-direction:column;gap:.45rem;justify-content:center;}' +
      '.sidebar.collapsed #btnHealthGuard{margin-left:0;width:34px;height:34px;}' +
      '#healthGuardBadge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#dc2626;color:#fff;font-size:10px;font-weight:800;display:none;align-items:center;justify-content:center;border:2px solid var(--bg-surface,#fff);}' +
      '#mobileMenuToggle{position:relative;}' +
      '#healthGuardMenuDot{position:absolute;top:-2px;right:-2px;width:9px;height:9px;border-radius:999px;background:#dc2626;border:2px solid var(--bg-surface,#fff);display:none;pointer-events:none;}' +
      '#webposHealthGuardModal{position:fixed;inset:0;background:rgba(15,23,42,0.58);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:1rem;z-index:999990;}' +
      '#webposHealthGuardModal.open{display:flex;}' +
      '.hg-card{width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;background:var(--bg-surface,#fff);color:var(--text-main,#0f172a);border:1px solid var(--border,#e2e8f0);border-radius:18px;box-shadow:0 24px 48px rgba(15,23,42,0.28);overflow:hidden;}' +
      '.hg-head{padding:1rem 1.25rem;border-bottom:1px solid var(--border,#e2e8f0);display:flex;align-items:center;justify-content:space-between;gap:.75rem;}' +
      '.hg-body{padding:1rem 1.25rem;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:.75rem;}' +
      '.hg-foot{padding:.85rem 1.25rem;border-top:1px solid var(--border,#e2e8f0);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;}' +
      '.hg-item{border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:.85rem 1rem;background:var(--bg-subtle,#f8fafc);}' +
      '.hg-item.critical{border-color:rgba(220,38,38,0.4);background:rgba(239,68,68,0.06);}' +
      '.hg-item.warning{border-color:rgba(245,158,11,0.45);background:rgba(245,158,11,0.07);}' +
      '.hg-tag{display:inline-block;font-size:.66rem;font-weight:800;padding:2px 7px;border-radius:6px;text-transform:uppercase;margin-right:6px;}' +
      '.hg-tag.critical{background:#fee2e2;color:#b91c1c;}' +
      '.hg-tag.warning{background:#fef3c7;color:#b45309;}' +
      '.hg-btn{padding:.48rem .85rem;border-radius:9px;font-size:.78rem;font-weight:700;cursor:pointer;border:1px solid transparent;display:inline-flex;align-items:center;gap:.35rem;}' +
      '.hg-btn-fix{background:var(--primary,#4f46e5);color:#fff;}' +
      '.hg-btn-sec{background:var(--bg-surface,#fff);color:var(--text-main,#334155);border-color:var(--border,#cbd5e1);}';
    (document.head || document.documentElement).appendChild(st);
  }

  function mountGuardUI() {
    if (!isOwnerOrDev) return;
    ensureGuardStyles();

    if (!document.getElementById('btnHealthGuard')) {
      var profileBox = document.querySelector('.sidebar-footer .user-profile') || document.querySelector('.sidebar-footer');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btnHealthGuard';
      btn.title = 'Penjaga Sistem: Deteksi Kebocoran & Auto-Fix (Owner/Developer)';
      btn.innerHTML = '<i class="fas fa-shield-halved"></i><span id="healthGuardBadge">0</span>';
      btn.onclick = function(ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        window.WebPOSHealthGuard.open();
      };
      if (profileBox) {
        profileBox.appendChild(btn);
      } else {
        var logoutBtn = document.getElementById('btnLogout');
        if (logoutBtn && logoutBtn.parentElement) logoutBtn.parentElement.insertBefore(btn, logoutBtn);
      }
    }

    var mobToggle = document.getElementById('mobileMenuToggle');
    if (mobToggle && !document.getElementById('healthGuardMenuDot')) {
      var dot = document.createElement('span');
      dot.id = 'healthGuardMenuDot';
      dot.title = 'Ada peringatan Penjaga Sistem di sidebar';
      mobToggle.appendChild(dot);
    }

    if (!document.getElementById('webposHealthGuardModal') && document.body) {
      var modal = document.createElement('div');
      modal.id = 'webposHealthGuardModal';
      modal.innerHTML =
        '<div class="hg-card" role="dialog" aria-modal="true">' +
          '<div class="hg-head">' +
            '<div>' +
              '<div style="font-weight:800;font-size:1rem;display:flex;align-items:center;gap:.5rem;"><i class="fas fa-shield-halved" style="color:var(--primary,#4f46e5);"></i> Penjaga Sistem &amp; Deteksi Kebocoran</div>' +
              '<div style="font-size:.74rem;color:var(--text-muted,#64748b);margin-top:2px;">Khusus Owner/Developer — Perbaikan otomatis hanya dijalankan jika Anda menyetujui.</div>' +
            '</div>' +
            '<button type="button" class="hg-btn hg-btn-sec" onclick="WebPOSHealthGuard.close()" style="padding:.35rem .6rem;"><i class="fas fa-times"></i></button>' +
          '</div>' +
          '<div class="hg-body" id="hgIssuesList"></div>' +
          '<div class="hg-foot">' +
            '<button type="button" class="hg-btn hg-btn-sec" id="btnHgDeepScan" onclick="WebPOSHealthGuard.runDeepServerScan()"><i class="fas fa-magnifying-glass"></i> Scan Mendalam Server</button>' +
            '<div style="display:flex;gap:.45rem;">' +
              '<button type="button" class="hg-btn hg-btn-sec" onclick="WebPOSHealthGuard.copyReport()"><i class="fas fa-copy"></i> Salin Laporan</button>' +
              '<button type="button" class="hg-btn hg-btn-sec" onclick="WebPOSHealthGuard.close()">Tutup</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      modal.onclick = function(e) { if (e.target === modal) window.WebPOSHealthGuard.close(); };
      document.body.appendChild(modal);
    }

    updateGuardBadge();
  }

  function updateGuardBadge() {
    var btn = document.getElementById('btnHealthGuard');
    var badge = document.getElementById('healthGuardBadge');
    var mobDot = document.getElementById('healthGuardMenuDot');
    var cnt = currentIssues.length;
    if (btn && badge) {
      if (cnt > 0) {
        btn.classList.add('has-alert');
        badge.textContent = cnt > 9 ? '9+' : String(cnt);
        badge.style.display = 'inline-flex';
      } else {
        btn.classList.remove('has-alert');
        badge.style.display = 'none';
      }
    }
    if (mobDot) {
      mobDot.style.display = cnt > 0 ? 'block' : 'none';
    }
  }

  function renderGuardModal() {
    var box = document.getElementById('hgIssuesList');
    if (!box) return;
    if (!currentIssues.length) {
      box.innerHTML =
        '<div style="text-align:center;padding:2rem 1rem;">' +
          '<div style="width:56px;height:56px;border-radius:16px;background:rgba(16,185,129,0.12);color:#059669;display:inline-flex;align-items:center;justify-content:center;font-size:1.6rem;margin-bottom:.75rem;"><i class="fas fa-circle-check"></i></div>' +
          '<div style="font-weight:800;font-size:.98rem;margin-bottom:.25rem;">Sistem 100% Aman &amp; Bersih</div>' +
          '<div style="font-size:.8rem;color:var(--text-muted,#64748b);">Tidak terdeteksi kebocoran cache, harga rugi, maupun error runtime lokal.<br>Klik <strong>Scan Mendalam Server</strong> untuk mengecek shift gantung, role transaksi, &amp; konfigurasi cloud.</div>' +
        '</div>';
      return;
    }

    box.innerHTML = currentIssues.map(function(it, idx) {
      return '<div class="hg-item ' + (it.severity || 'warning') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;margin-bottom:.35rem;">' +
          '<div style="font-weight:800;font-size:.86rem;"><span class="hg-tag ' + (it.severity || 'warning') + '">' + (it.severity === 'critical' ? 'Kritis' : 'Peringatan') + '</span>' + escapeText(it.title) + '</div>' +
        '</div>' +
        '<div style="font-size:.79rem;color:var(--text-muted,#64748b);line-height:1.45;margin-bottom:.65rem;white-space:pre-line;">' + escapeText(it.description) + '</div>' +
        '<div style="display:flex;gap:.45rem;flex-wrap:wrap;">' +
          (it.canAutoFix ? '<button type="button" class="hg-btn hg-btn-fix" onclick="WebPOSHealthGuard.approveFix(' + idx + ')"><i class="fas fa-wand-magic-sparkles"></i> ' + escapeText(it.fixLabel || 'Setujui & Perbaiki Otomatis') + '</button>' : '') +
          '<button type="button" class="hg-btn hg-btn-sec" onclick="WebPOSHealthGuard.dismissIssue(' + idx + ')">Abaikan</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function runLocalHealthChecks() {
    var issues = [];
    var dismissed = safeJsonParse(sessionStorage.getItem(DISMISSED_KEY), {});

    // 1. Cek kebocoran UID / Sesi lintas akun (0 read)
    try {
      var lastUid = localStorage.getItem('webpos_last_uid') || '';
      var sess = safeJsonParse(localStorage.getItem('webpos_session'), null);
      if (activeAuthUser && activeAuthUser.uid) {
        if ((lastUid && lastUid !== activeAuthUser.uid) || (sess && sess.uid && sess.uid !== activeAuthUser.uid)) {
          issues.push({
            id: 'uid_cache_mismatch',
            severity: 'critical',
            title: 'Terdeteksi Kebocoran Sesi / Cache Akun Lain',
            description: 'Data cache lokal di browser masih memuat UID akun sebelumnya. Jika dibiarkan, angka header atau riwayat akun lama bisa tercampur.',
            canAutoFix: true,
            fixLabel: 'Setujui & Bersihkan Cache Sesi',
            fix: async function() {
              [
                'webpos_shift_status_cache', 'active_shift_id', 'wpos_return_after_modal',
                'header_uang_global', 'header_penjualan', 'header_transaksi', 'header_laba',
                'raw_header_uang_global', 'raw_header_penjualan', 'raw_header_transaksi',
                'raw_header_laba', 'raw_header_date', 'kasir_cart', 'kasir_note', 'kasir_reseller_name'
              ].forEach(function(k) { localStorage.removeItem(k); });
              localStorage.setItem('webpos_last_uid', activeAuthUser.uid);
              if (window.indexedDB && window.indexedDB.deleteDatabase) {
                window.indexedDB.deleteDatabase('webpos_riwayat_cache_v1');
              }
              return 'Cache akun lama berhasil dibersihkan & UID disinkronkan!';
            }
          });
        }
      }
    } catch (e) {}

    // 2. Cek antrean transaksi offline macet saat online (0 read)
    try {
      var pending = safeJsonParse(localStorage.getItem('webpos_pending_transactions'), []);
      if (Array.isArray(pending) && pending.length > 0 && navigator.onLine) {
        issues.push({
          id: 'offline_pending_stuck',
          severity: 'warning',
          title: pending.length + ' Transaksi Offline Belum Tersinkron',
          description: 'Terdapat ' + pending.length + ' transaksi tersimpan di memori lokal padahal koneksi internet aktif.',
          canAutoFix: true,
          fixLabel: 'Setujui & Paksa Sinkron',
          fix: async function() {
            if (typeof window.syncPendingTransactions === 'function') {
              await window.syncPendingTransactions();
              return 'Sinkronisasi transaksi offline telah dijalankan!';
            }
            window.location.href = 'page-kasir.html';
            return 'Mengarahkan ke halaman Kasir untuk sinkronisasi otomatis...';
          }
        });
      }
    } catch (e) {}

    // 3. Cek cepat harga produk rugi / Rp 0 dari cache lokal (0 read)
    try {
      var cachedProds = safeJsonParse(localStorage.getItem('webpos_cache_products_v1'), []);
      if (Array.isArray(cachedProds) && cachedProds.length > 0) {
        var badProds = cachedProds.filter(function(p) {
          if (!p || p.status === 'inactive') return false;
          var c = Number(p.costPrice) || 0;
          var s = Number(p.sellingPrice) || 0;
          return s <= 0 || (c > 0 && s < c);
        });
        if (badProds.length > 0) {
          var sample = badProds.slice(0, 4).map(function(p) {
            return '• ' + (p.name || '-') + ' (Modal Rp ' + (Number(p.costPrice) || 0).toLocaleString('id-ID') + ' / Jual Rp ' + (Number(p.sellingPrice) || 0).toLocaleString('id-ID') + ')';
          }).join('\n');
          issues.push({
            id: 'local_bad_prices',
            severity: 'warning',
            title: badProds.length + ' Produk Terdeteksi Harga Jual Rp 0 / Rugi',
            description: 'Ditemukan produk aktif yang harga jualnya lebih rendah dari modal atau Rp 0:\n' + sample + (badProds.length > 4 ? '\n...dan ' + (badProds.length - 4) + ' lainnya.' : ''),
            canAutoFix: true,
            fixLabel: 'Buka Halaman Produk untuk Perbaiki',
            fix: async function() {
              window.location.href = 'page-produk.html';
              return 'Membuka halaman Produk...';
            }
          });
        }
      }
    } catch (e) {}

    // 4. Cek error runtime JavaScript yang terekam otomatis (0 read)
    try {
      var errs = safeJsonParse(localStorage.getItem(ERR_STORAGE_KEY), []);
      if (Array.isArray(errs) && errs.length > 0) {
        var summary = errs.slice(0, 4).map(function(x) {
          return '• [' + x.page + '] ' + x.message + (x.count > 1 ? ' (' + x.count + 'x)' : '');
        }).join('\n');
        issues.push({
          id: 'runtime_js_errors',
          severity: 'critical',
          title: errs.length + ' Error Program (JS) Terdeteksi Otomatis',
          description: 'Aplikasi mendeteksi error kode berikut:\n' + summary + '\n\nKlik "Salin Laporan" untuk dikirim agar kode diperbaiki permanen, atau klik tombol di bawah untuk menyalin & membersihkan log.',
          canAutoFix: true,
          fixLabel: 'Salin & Bersihkan Log Error',
          fix: async function() {
            await window.WebPOSHealthGuard.copyReport(true);
            localStorage.removeItem(ERR_STORAGE_KEY);
            return 'Laporan error disalin ke clipboard & log dibersihkan!';
          }
        });
      }
    } catch (e) {}

    currentIssues = issues.filter(function(it) { return !dismissed[it.id]; });
    updateGuardBadge();
    renderGuardModal();
    return currentIssues;
  }

  async function runDeepServerScan() {
    var btn = document.getElementById('btnHgDeepScan');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memindai Server...'; }
    try {
      runLocalHealthChecks();
      if (typeof window.db === 'undefined') throw new Error('Firestore belum siap');

      var todayStr = getTodayYMD();

      // 5. Cek shift lama yang masih menggantung status "open"
      try {
        var shiftSnap = await window.db.collection('shifts').where('status', '==', 'open').get();
        var stuckShifts = [];
        shiftSnap.forEach(function(doc) {
          var d = doc.data() || {};
          var sDate = String(d.date || d.date_key || '').slice(0, 10);
          if (sDate && sDate < todayStr) {
            stuckShifts.push({ id: doc.id, date: sDate, userName: d.userName || d.cashierName || '-' });
          }
        });
        if (stuckShifts.length > 0) {
          currentIssues.unshift({
            id: 'stuck_open_shifts',
            severity: 'warning',
            title: stuckShifts.length + ' Shift Hari Sebelumnya Masih Menggantung (Open)',
            description: stuckShifts.slice(0, 5).map(function(s) { return '• ' + s.date + ' — ' + s.userName; }).join('\n') + '\n\nShift lama yang belum ditutup dapat membingungkan status shift aktif.',
            canAutoFix: true,
            fixLabel: 'Setujui & Tutup Shift Lama Otomatis',
            fix: async function() {
              var batch = window.db.batch();
              stuckShifts.forEach(function(s) {
                batch.update(window.db.collection('shifts').doc(s.id), {
                  status: 'closed',
                  closedAt: Date.now(),
                  autoClosedNote: '[AUTO-FIX OWNER] Ditutup otomatis oleh Penjaga Sistem'
                });
              });
              await batch.commit();
              localStorage.removeItem('webpos_shift_status_cache');
              return stuckShifts.length + ' shift lama berhasil ditutup rapi!';
            }
          });
        }
      } catch (e) {}

      // 6. Cek transaksi hari ini tanpa userRole (perbaikan batch 1-klik)
      try {
        var txSnap = await window.db.collection('transactions').where('date', '==', todayStr).get();
        var missingRoleTxs = [];
        txSnap.forEach(function(doc) {
          var d = doc.data() || {};
          if (!d.userRole && d.userId) missingRoleTxs.push({ id: doc.id, userId: d.userId });
        });
        if (missingRoleTxs.length > 0) {
          currentIssues.push({
            id: 'missing_tx_user_role',
            severity: 'warning',
            title: missingRoleTxs.length + ' Transaksi Hari Ini Belum Memiliki Field userRole',
            description: 'Menyebabkan filter role di Riwayat harus menebak dari nama petugas. Bisa langsung dilengkapi otomatis dari database User.',
            canAutoFix: true,
            fixLabel: 'Setujui & Lengkapi Role Otomatis',
            fix: async function() {
              var uSnap = await window.db.collection('users').get();
              var roleMap = {};
              uSnap.forEach(function(u) { roleMap[u.id] = String((u.data() || {}).role || 'kasir').toLowerCase(); });
              var batch = window.db.batch();
              missingRoleTxs.slice(0, 400).forEach(function(t) {
                batch.update(window.db.collection('transactions').doc(t.id), { userRole: roleMap[t.userId] || 'kasir' });
              });
              await batch.commit();
              return missingRoleTxs.length + ' transaksi hari ini berhasil dilengkapi field userRole!';
            }
          });
        }
      } catch (e) {}

      // 7 & 8. Cek sinkronisasi URL Google Sheets & status PIN Rahasia di Cloud
      try {
        var localGas = (localStorage.getItem('webpos_gas_webhook_url') || '').trim();
        var localSheet = (localStorage.getItem('webpos_spreadsheet_url') || '').trim();
        var localSecret = (localStorage.getItem('webpos_gas_secret_key') || '').trim();
        var cfgDoc = await window.db.collection('backup').doc('sheetsConfig').get();
        var cfgData = (cfgDoc.exists && cfgDoc.data()) ? cfgDoc.data() : {};
        var cloudGas = String(cfgData.scriptUrl || '').trim();
        var cloudSecret = String(cfgData.secretKey || '').trim();
        if (localGas && !cloudGas) {
          currentIssues.push({
            id: 'sheets_url_not_in_cloud',
            severity: 'warning',
            title: 'URL Google Sheets Belum Tersinkron ke Cloud',
            description: 'URL Apps Script sudah ada di perangkat ini tetapi belum disimpan ke Cloud Firestore, sehingga perangkat lain masih harus input ulang.',
            canAutoFix: true,
            fixLabel: 'Setujui & Sinkron URL ke Cloud',
            fix: async function() {
              await window.db.collection('backup').doc('sheetsConfig').set({
                scriptUrl: localGas,
                sheetUrl: localSheet,
                secretKey: localSecret,
                updatedAt: Date.now(),
                updatedBy: activeAuthUser ? (activeAuthUser.email || activeAuthUser.uid) : 'owner'
              }, { merge: true });
              return 'URL & PIN Google Sheets berhasil disimpan ke Cloud untuk semua perangkat!';
            }
          });
        } else if (cloudGas && !cloudSecret) {
          currentIssues.push({
            id: 'sheets_pin_not_set',
            severity: 'warning',
            title: 'Koneksi Google Sheets Belum Dilindungi PIN Rahasia',
            description: 'URL Apps Script sudah aktif di Cloud, tetapi PIN Rahasia (SECRET_KEY) masih kosong. Disarankan atur PIN agar link Web App tidak bisa diakses pihak lain.',
            canAutoFix: true,
            fixLabel: 'Buka Halaman Backup untuk Atur PIN',
            fix: async function() {
              window.location.href = 'page-backup.html';
              return 'Membuka halaman Backup...';
            }
          });
        }
      } catch (e) {}

      updateGuardBadge();
      renderGuardModal();
    } catch (err) {
      if (window.WebPOSDialog) window.WebPOSDialog.alert('Gagal melakukan scan server: ' + err.message, { title: 'Scan Server Gagal' });
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magnifying-glass"></i> Scan Mendalam Server'; }
    }
  }

  window.WebPOSHealthGuard = {
    open: function() {
      mountGuardUI();
      runLocalHealthChecks();
      var m = document.getElementById('webposHealthGuardModal');
      if (m) m.classList.add('open');
    },
    close: function() {
      var m = document.getElementById('webposHealthGuardModal');
      if (m) m.classList.remove('open');
    },
    runDeepServerScan: runDeepServerScan,
    approveFix: async function(idx) {
      var item = currentIssues[idx];
      if (!item || typeof item.fix !== 'function') return;
      var ok = await window.WebPOSDialog.confirm(
        'Jalankan perbaikan otomatis untuk:\n"' + item.title + '"?',
        null,
        { title: 'Persetujuan Perbaikan Otomatis', confirmText: 'Ya, Setujui & Perbaiki' }
      );
      if (!ok) return;
      try {
        var msg = await item.fix();
        currentIssues.splice(idx, 1);
        updateGuardBadge();
        renderGuardModal();
        if (window.WebPOSDialog) window.WebPOSDialog.alert(msg || 'Perbaikan selesai dijalankan!', { title: 'Perbaikan Berhasil' });
      } catch (err) {
        if (window.WebPOSDialog) window.WebPOSDialog.alert('Perbaikan gagal: ' + (err.message || err), { title: 'Gagal Memperbaiki' });
      }
    },
    dismissIssue: function(idx) {
      var item = currentIssues[idx];
      if (!item) return;
      var dismissed = safeJsonParse(sessionStorage.getItem(DISMISSED_KEY), {});
      dismissed[item.id] = true;
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
      currentIssues.splice(idx, 1);
      updateGuardBadge();
      renderGuardModal();
    },
    copyReport: async function(silent) {
      var errs = safeJsonParse(localStorage.getItem(ERR_STORAGE_KEY), []);
      var lines = ['=== LAPORAN PENJAGA SISTEM WEBPOS ===', 'Tanggal: ' + new Date().toLocaleString('id-ID'), 'Halaman: ' + window.location.pathname, ''];
      if (currentIssues.length) {
        lines.push('--- TEMUAN AKTIF (' + currentIssues.length + ') ---');
        currentIssues.forEach(function(it, i) {
          lines.push((i + 1) + '. [' + it.severity + '] ' + it.title + ' — ' + it.description.replace(/\n/g, ' | '));
        });
      }
      if (errs.length) {
        lines.push('', '--- ERROR RUNTIME (' + errs.length + ') ---');
        errs.forEach(function(e, i) {
          lines.push((i + 1) + '. [' + e.page + '] ' + e.source + ': ' + e.message + ' (' + e.detail + ') x' + (e.count || 1));
        });
      }
      var text = lines.join('\n');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          if (!silent && window.WebPOSDialog) window.WebPOSDialog.alert('Laporan berhasil disalin! Anda bisa langsung tempel di chat untuk analisis cepat.', { title: 'Laporan Disalin' });
        }
      } catch (e) {}
    }
  };

  function bootHealthGuardForUser(user) {
    if (!user || !user.uid) return;
    activeAuthUser = user;
    var cachedRole = String(localStorage.getItem('webpos_user_role') || '').toLowerCase();
    if (cachedRole === 'owner' || cachedRole === 'developer') {
      isOwnerOrDev = true;
      mountGuardUI();
      runLocalHealthChecks();
      return;
    }
    if (typeof window.db !== 'undefined') {
      window.db.collection('users').doc(user.uid).get().then(function(doc) {
        if (!doc.exists || !doc.data()) return;
        var r = String(doc.data().role || 'kasir').toLowerCase();
        if (r === 'owner' || r === 'developer') {
          isOwnerOrDev = true;
          mountGuardUI();
          runLocalHealthChecks();
        }
      }).catch(function() {});
    }
  }

  function initGuardBoot() {
    if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
      window.auth.onAuthStateChanged(function(user) {
        if (user) bootHealthGuardForUser(user);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGuardBoot);
  } else {
    initGuardBoot();
  }
})();

// =========================================================================
// WEBPOS CUSTOM BRAND LOGO ENGINE (SIDEBAR, LOGIN & FAVICON — GLOBAL)
// =========================================================================
(function() {
  if (window.WebPOSBrandLogo) return;

  function ensureBrandLogoStyles() {
    if (document.getElementById('webpos-brand-logo-style')) return;
    var st = document.createElement('style');
    st.id = 'webpos-brand-logo-style';
    st.textContent =
      '.logo-icon.has-custom-logo{padding:0 !important;overflow:hidden !important;display:flex !important;align-items:center !important;justify-content:center !important;flex-shrink:0 !important;}' +
      '.logo-icon.has-custom-logo.logo-shape-rounded{border-radius:11px !important;background:transparent !important;box-shadow:0 2px 8px rgba(15,23,42,0.12) !important;}' +
      '.logo-icon.has-custom-logo.logo-shape-circle{border-radius:50% !important;background:transparent !important;box-shadow:0 2px 8px rgba(15,23,42,0.12) !important;}' +
      '.logo-icon.has-custom-logo.logo-shape-clean{border-radius:0 !important;background:transparent !important;box-shadow:none !important;border:none !important;}' +
      '.logo-icon.has-custom-logo img.webpos-custom-logo-img{width:100%;height:100%;display:block;object-fit:cover;}' +
      '.logo-icon.has-custom-logo.logo-shape-clean img.webpos-custom-logo-img{object-fit:contain;}' +
      '.logo-container.logo-banner-mode{gap:0 !important;min-width:0;flex:1;}' +
      '.logo-container.logo-banner-mode .logo-text{display:none !important;}' +
      '.logo-container.logo-banner-mode .logo-icon.has-custom-logo{width:auto !important;max-width:176px !important;height:40px !important;background:transparent !important;box-shadow:none !important;}' +
      '.logo-container.logo-banner-mode .logo-icon.has-custom-logo img.webpos-custom-logo-img{height:40px;width:auto;max-width:176px;object-fit:contain;}' +
      '.sidebar.collapsed .logo-container.logo-banner-mode .logo-icon.has-custom-logo{max-width:40px !important;height:36px !important;}' +
      '.sidebar.collapsed .logo-container.logo-banner-mode .logo-icon.has-custom-logo img.webpos-custom-logo-img{max-width:40px;height:36px;}' +
      '.logo-badge.has-custom-logo{padding:0 !important;overflow:hidden !important;background:transparent !important;}' +
      '.logo-badge.has-custom-logo img.webpos-custom-logo-img{width:100%;height:100%;object-fit:contain;display:block;}';
    (document.head || document.documentElement).appendChild(st);
  }

  function isValidLogoSrc(src) {
    return Boolean(src && /^(data:image\/|https?:\/\/|\.?\/)/i.test(String(src).trim()));
  }

  function applyFavicon(dataUrl) {
    if (!isValidLogoSrc(dataUrl)) return;
    try {
      var link = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        (document.head || document.documentElement).appendChild(link);
      }
      link.href = dataUrl;
    } catch (e) {}
  }

  function applyBrandLogo() {
    ensureBrandLogoStyles();
    var logoUrl = String(localStorage.getItem('webpos_store_logo') || '').trim();
    var mode = localStorage.getItem('webpos_store_logo_mode') || 'icon_text';
    var shape = localStorage.getItem('webpos_store_logo_shape') || 'rounded';
    var storeName = String(localStorage.getItem('webpos_store_name') || '').trim();
    var hasValidLogo = isValidLogoSrc(logoUrl);

    // 1. Sidebar Logo (semua 27 halaman aktif)
    var containers = document.querySelectorAll('.sidebar-header .logo-container');
    for (var i = 0; i < containers.length; i++) {
      var container = containers[i];
      var iconBox = container.querySelector('.logo-icon');
      var textEl = container.querySelector('.logo-text');
      if (textEl && storeName) textEl.textContent = storeName;
      if (!iconBox) continue;

      iconBox.classList.remove('has-custom-logo', 'logo-shape-rounded', 'logo-shape-circle', 'logo-shape-clean');
      container.classList.remove('logo-banner-mode');

      if (hasValidLogo) {
        iconBox.classList.add('has-custom-logo', 'logo-shape-' + (shape === 'circle' || shape === 'clean' ? shape : 'rounded'));
        if (mode === 'full_banner') container.classList.add('logo-banner-mode');
        iconBox.innerHTML = '';
        var img = document.createElement('img');
        img.className = 'webpos-custom-logo-img';
        img.alt = storeName || 'Logo Konter';
        img.src = logoUrl;
        iconBox.appendChild(img);
      } else {
        if (!iconBox.querySelector('i, svg')) {
          iconBox.innerHTML = '<i class="fas fa-store"></i>';
        }
      }
    }

    // 2. Halaman Login (.logo-badge & .brand-title)
    var loginBadge = document.querySelector('.logo-badge');
    if (loginBadge) {
      loginBadge.classList.remove('has-custom-logo');
      if (hasValidLogo) {
        loginBadge.classList.add('has-custom-logo');
        loginBadge.innerHTML = '';
        var lImg = document.createElement('img');
        lImg.className = 'webpos-custom-logo-img';
        lImg.alt = storeName || 'Logo Konter';
        lImg.src = logoUrl;
        loginBadge.appendChild(lImg);
      }
      var bTitle = document.querySelector('.brand-title');
      if (bTitle && storeName) bTitle.textContent = storeName;
    }

    // 3. Favicon browser & Sinkron Splash Screen APK Android
    if (hasValidLogo) applyFavicon(logoUrl);
    if (window.AndroidBrand && typeof window.AndroidBrand.saveBrand === 'function') {
      try { window.AndroidBrand.saveBrand(hasValidLogo ? logoUrl : '', storeName || 'HIFZI CELL'); } catch (e) {}
    }
  }

  function syncBrandFromCloud() {
    if (typeof window.db === 'undefined') return;
    try {
      if (sessionStorage.getItem('webpos_brand_synced_v1') === '1') return;
    } catch (e) {}
    window.db.collection('settings').doc('store').get().then(function(doc) {
      try { sessionStorage.setItem('webpos_brand_synced_v1', '1'); } catch (e) {}
      if (!doc.exists || !doc.data()) return;
      var s = doc.data();
      if (s.name) localStorage.setItem('webpos_store_name', String(s.name).trim());
      if (isValidLogoSrc(s.logoDataUrl)) {
        localStorage.setItem('webpos_store_logo', String(s.logoDataUrl));
      } else if (s.logoDataUrl === '') {
        localStorage.removeItem('webpos_store_logo');
      }
      if (s.logoMode) localStorage.setItem('webpos_store_logo_mode', String(s.logoMode));
      if (s.logoShape) localStorage.setItem('webpos_store_logo_shape', String(s.logoShape));
      applyBrandLogo();
    }).catch(function() {});
  }

  window.WebPOSBrandLogo = {
    apply: applyBrandLogo,
    sync: syncBrandFromCloud
  };

  function bootBrandLogo() {
    applyBrandLogo();
    if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
      window.auth.onAuthStateChanged(function(user) {
        if (user) syncBrandFromCloud();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootBrandLogo);
  } else {
    bootBrandLogo();
  }
})();

// =========================================================================
// WEBPOS 3D POPUP SYSTEM & UNIFIED RECEIPT ENGINE (PNG / PDF / THERMAL)
// =========================================================================
(function() {
  if (window.__webposUnifiedUiV1) return;
  window.__webposUnifiedUiV1 = true;

  var uidCounter = 0;
  function mk3d(svgBody, cls) {
    uidCounter++;
    var p = 'wp3d_' + uidCounter + '_';
    return '<svg class="wp-3d-native-icon ' + (cls || '') + '" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      svgBody.replace(/__ID__/g, p) + '</svg>';
  }

  var ICONS_3D = {
    calendar: function(cls) {
      return mk3d(
        '<defs>' +
          '<linearGradient id="__ID__bg" x1="6" y1="10" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#CBD5E1"/></linearGradient>' +
          '<linearGradient id="__ID__top" x1="6" y1="10" x2="42" y2="21" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FB7185"/><stop offset="100%" stop-color="#E11D48"/></linearGradient>' +
          '<linearGradient id="__ID__pin" x1="14" y1="5" x2="18" y2="15" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60A5FA"/><stop offset="100%" stop-color="#2563EB"/></linearGradient>' +
        '</defs>' +
        '<rect x="6" y="10" width="36" height="32" rx="8" fill="url(#__ID__bg)" stroke="#FFFFFF" stroke-width="1.6"/>' +
        '<path d="M6 18C6 13.6 9.6 10 14 10H34C38.4 10 42 13.6 42 18V21H6V18Z" fill="url(#__ID__top)"/>' +
        '<ellipse cx="24" cy="14" rx="13" ry="2.6" fill="#FFFFFF" fill-opacity="0.28"/>' +
        '<rect x="13.5" y="5.5" width="5" height="9.5" rx="2.5" fill="url(#__ID__pin)" stroke="#FFFFFF" stroke-width="1.2"/>' +
        '<rect x="29.5" y="5.5" width="5" height="9.5" rx="2.5" fill="url(#__ID__pin)" stroke="#FFFFFF" stroke-width="1.2"/>' +
        '<rect x="12" y="25" width="6.5" height="5.5" rx="1.8" fill="#3B82F6"/>' +
        '<rect x="20.75" y="25" width="6.5" height="5.5" rx="1.8" fill="#10B981"/>' +
        '<rect x="29.5" y="25" width="6.5" height="5.5" rx="1.8" fill="#F59E0B"/>' +
        '<rect x="12" y="33" width="15" height="4.5" rx="1.6" fill="#94A3B8"/>',
        cls
      );
    },
    list: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#818CF8"/><stop offset="55%" stop-color="#4F46E5"/><stop offset="100%" stop-color="#312E81"/></linearGradient></defs>' +
        '<rect x="6" y="6" width="36" height="36" rx="11" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.5"/>' +
        '<ellipse cx="24" cy="13" rx="12" ry="4.5" fill="#FFFFFF" fill-opacity="0.26"/>' +
        '<circle cx="15" cy="18" r="2.4" fill="#A5F3FC"/><rect x="20.5" y="16" width="14" height="4" rx="2" fill="#FFFFFF"/>' +
        '<circle cx="15" cy="25" r="2.4" fill="#6EE7B7"/><rect x="20.5" y="23" width="14" height="4" rx="2" fill="#FFFFFF"/>' +
        '<circle cx="15" cy="32" r="2.4" fill="#FDE68A"/><rect x="20.5" y="30" width="10.5" height="4" rx="2" fill="#FFFFFF"/>',
        cls
      );
    },
    search: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="8" y1="8" x2="34" y2="34" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#67E8F9"/><stop offset="100%" stop-color="#0284C7"/></linearGradient></defs>' +
        '<circle cx="21" cy="21" r="13" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="2"/>' +
        '<circle cx="21" cy="21" r="7.5" fill="#E0F2FE"/>' +
        '<ellipse cx="18.5" cy="17.5" rx="3.5" ry="2" fill="#FFFFFF" fill-opacity="0.85"/>' +
        '<path d="M31 31L40 40" stroke="#0369A1" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="M31 31L40 40" stroke="#38BDF8" stroke-width="3.2" stroke-linecap="round"/>',
        cls
      );
    },
    check: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="100%" stop-color="#059669"/></linearGradient></defs>' +
        '<circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/>' +
        '<ellipse cx="24" cy="13" rx="11" ry="4.5" fill="#FFFFFF" fill-opacity="0.32"/>' +
        '<path d="M15.5 24.5L21.5 30.5L33 18.5" stroke="#FFFFFF" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>',
        cls
      );
    },
    close: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FB7185"/><stop offset="100%" stop-color="#E11D48"/></linearGradient></defs>' +
        '<circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/>' +
        '<ellipse cx="24" cy="13" rx="11" ry="4.5" fill="#FFFFFF" fill-opacity="0.3"/>' +
        '<path d="M17 17L31 31M31 17L17 31" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round"/>',
        cls
      );
    },
    chevLeft: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="100%" stop-color="#4F46E5"/></linearGradient></defs>' +
        '<circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.5"/>' +
        '<ellipse cx="24" cy="13" rx="10" ry="4" fill="#FFFFFF" fill-opacity="0.3"/>' +
        '<path d="M27 15L18 24L27 33" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>',
        cls
      );
    },
    chevRight: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93C5FD"/><stop offset="100%" stop-color="#4F46E5"/></linearGradient></defs>' +
        '<circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.5"/>' +
        '<ellipse cx="24" cy="13" rx="10" ry="4" fill="#FFFFFF" fill-opacity="0.3"/>' +
        '<path d="M21 15L30 24L21 33" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>',
        cls
      );
    },
    today: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDE047"/><stop offset="100%" stop-color="#F59E0B"/></linearGradient></defs>' +
        '<circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/>' +
        '<ellipse cx="24" cy="13" rx="10" ry="4" fill="#FFFFFF" fill-opacity="0.35"/>' +
        '<path d="M24 13L27.2 19.8L34.6 20.8L29.2 26L30.5 33.4L24 29.8L17.5 33.4L18.8 26L13.4 20.8L20.8 19.8Z" fill="#FFFFFF"/>',
        cls
      );
    },
    clear: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDA4AF"/><stop offset="100%" stop-color="#E11D48"/></linearGradient></defs>' +
        '<rect x="7" y="10" width="34" height="30" rx="8" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.5"/>' +
        '<path d="M18 19L30 31M30 19L18 31" stroke="#FFFFFF" stroke-width="3.8" stroke-linecap="round"/>',
        cls
      );
    },
    image: function(cls) {
      return mk3d(
        '<defs>' +
          '<linearGradient id="__ID__g" x1="6" y1="8" x2="42" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="100%" stop-color="#059669"/></linearGradient>' +
          '<linearGradient id="__ID__m" x1="10" y1="22" x2="38" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#A7F3D0"/><stop offset="100%" stop-color="#10B981"/></linearGradient>' +
        '</defs>' +
        '<rect x="6" y="8" width="36" height="32" rx="9" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/>' +
        '<ellipse cx="24" cy="14" rx="12" ry="3.6" fill="#FFFFFF" fill-opacity="0.28"/>' +
        '<circle cx="16.5" cy="18.5" r="3.6" fill="#FDE047"/>' +
        '<path d="M10 35L20 24L27.5 31.5L32.5 26.5L38 35H10Z" fill="url(#__ID__m)"/>',
        cls
      );
    },
    pdf: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="9" y1="5" x2="39" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FB7185"/><stop offset="100%" stop-color="#BE123C"/></linearGradient></defs>' +
        '<path d="M13 6H29L39 16V38C39 40.8 36.8 43 34 43H13C10.2 43 8 40.8 8 38V11C8 8.2 10.2 6 13 6Z" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/>' +
        '<path d="M29 6V14C29 15.1 29.9 16 31 16H39L29 6Z" fill="#FECDD3"/>' +
        '<rect x="13" y="24" width="22" height="10" rx="4" fill="#FFFFFF" fill-opacity="0.94"/>' +
        '<text x="24" y="31.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="7.5" fill="#BE123C">PDF</text>',
        cls
      );
    },
    download: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0284C7"/></linearGradient></defs>' +
        '<circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/>' +
        '<ellipse cx="24" cy="13" rx="10" ry="4" fill="#FFFFFF" fill-opacity="0.32"/>' +
        '<path d="M24 14V28M17.5 23L24 29.5L30.5 23" stroke="#FFFFFF" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M15 34H33" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round"/>',
        cls
      );
    },
    receipt: function(cls) {
      return mk3d(
        '<defs>' +
          '<linearGradient id="__ID__g" x1="10" y1="5" x2="38" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#E2E8F0"/></linearGradient>' +
          '<linearGradient id="__ID__t" x1="10" y1="5" x2="38" y2="15" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6366F1"/><stop offset="100%" stop-color="#4338CA"/></linearGradient>' +
        '</defs>' +
        '<path d="M11 8C11 6.3 12.3 5 14 5H34C35.7 5 37 6.3 37 8V42L33 39L29 42L24 39L19 42L15 39L11 42V8Z" fill="url(#__ID__g)" stroke="#CBD5E1" stroke-width="1.4"/>' +
        '<path d="M11 8C11 6.3 12.3 5 14 5H34C35.7 5 37 6.3 37 8V14H11V8Z" fill="url(#__ID__t)"/>' +
        '<rect x="15" y="19" width="18" height="3" rx="1.5" fill="#6366F1"/>' +
        '<rect x="15" y="25" width="14" height="2.8" rx="1.4" fill="#94A3B8"/>' +
        '<rect x="15" y="31" width="18" height="3.2" rx="1.6" fill="#10B981"/>',
        cls
      );
    },
    
    rounding: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDE047"/><stop offset="50%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs>' +
        '<circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/>' +
        '<ellipse cx="24" cy="13" rx="11" ry="4.5" fill="#FFFFFF" fill-opacity="0.34"/>' +
        '<text x="24" y="29.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="14" fill="#FFFFFF">Rp</text>',
        cls
      );
    },
    whatsapp: function(cls) {
      return mk3d(
        '<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#4ADE80"/><stop offset="55%" stop-color="#16A34A"/><stop offset="100%" stop-color="#15803D"/></linearGradient></defs>' +
        '<path d="M24 6C14.1 6 6 14 6 23.8C6 27.3 7 30.6 8.8 33.4L6.2 42L15.1 39.5C17.8 41 20.8 41.8 24 41.8C33.9 41.8 42 33.8 42 23.9C42 14 33.9 6 24 6Z" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M18.2 16.5C17.5 16.5 16.3 17.2 16.1 18.6C15.9 20.1 16.6 23.1 19.6 26.3C22.6 29.5 26 30.8 28.2 31C29.7 31.1 31.1 29.9 31.4 28.8C31.6 28.1 31.4 27.6 30.9 27.3L28 25.9C27.5 25.6 27 25.7 26.6 26.1L25.5 27.3C24.2 26.7 21.8 24.6 20.8 22.7L21.9 21.5C22.3 21.1 22.4 20.5 22.1 20L20.8 17.2C20.5 16.7 19.9 16.5 18.2 16.5Z" fill="#FFFFFF"/>',
       cls
      );
    }
  };

  window.WebPOS3DIcons = ICONS_3D;

  function ensureUnifiedStyles() {
    if (document.getElementById('webpos-unified-ui-style')) return;
    var st = document.createElement('style');
    st.id = 'webpos-unified-ui-style';
    st.textContent = [
      '.wp-3d-native-icon{width:20px;height:20px;display:inline-block;vertical-align:middle;flex-shrink:0;filter:drop-shadow(0 2px 4px rgba(15,23,42,0.22));}',
      '.wp-pop-backdrop{position:fixed;inset:0;z-index:100025;background:rgba(15,23,42,0.58);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:1rem;box-sizing:border-box;animation:wpPopFade .16s ease;}',
      '.wp-pop-backdrop.open{display:flex;}',
      '.wp-pop-card{width:100%;max-width:368px;background:var(--bg-surface,var(--bg-card,#ffffff));color:var(--text-main,var(--text-primary,#0f172a));border:1px solid var(--border,var(--border-color,#e2e8f0));border-radius:20px;box-shadow:0 24px 60px rgba(15,23,42,0.34);overflow:hidden;display:flex;flex-direction:column;max-height:86vh;animation:wpPopIn .2s cubic-bezier(.16,1,.3,1);}',
      '[data-theme="dark"] .wp-pop-card,[data-theme="midnight"] .wp-pop-card,[data-theme="oled"] .wp-pop-card,[data-theme="emerald"] .wp-pop-card{background:var(--bg-surface,#1e293b);color:var(--text-main,#f8fafc);border-color:rgba(148,163,184,0.22);}',
      '.wp-pop-head{display:flex;align-items:center;justify-content:space-between;gap:0.6rem;padding:0.85rem 1rem;border-bottom:1px solid var(--border,var(--border-color,#e2e8f0));background:linear-gradient(135deg,rgba(99,102,241,0.08),rgba(14,165,233,0.06));}',
      '.wp-pop-title{display:flex;align-items:center;gap:0.55rem;font-size:0.94rem;font-weight:800;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wp-pop-title .wp-3d-native-icon{width:24px;height:24px;}',
      '.wp-pop-close{border:none;background:transparent;padding:2px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;transition:transform .16s ease;}',
      '.wp-pop-close:hover{transform:scale(1.1);}',
      '.wp-pop-close .wp-3d-native-icon{width:26px;height:26px;}',
      '.wp-pop-body{padding:0.9rem 1rem;overflow-y:auto;flex:1;min-height:0;}',
      '.wp-pop-foot{display:flex;align-items:center;gap:0.5rem;padding:0.75rem 1rem;border-top:1px solid var(--border,var(--border-color,#e2e8f0));background:var(--bg-subtle,var(--bg-secondary,rgba(148,163,184,0.07)));}',
      '.wp-pop-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:0.4rem;padding:0.58rem 0.75rem;border-radius:12px;border:1px solid var(--border,var(--border-color,#cbd5e1));background:var(--bg-surface,var(--bg-card,#ffffff));color:var(--text-main,var(--text-primary,#1e293b));font-size:0.8rem;font-weight:700;cursor:pointer;transition:all .15s ease;font-family:inherit;}',
      '.wp-pop-btn:hover{transform:translateY(-1px);border-color:var(--primary,#6366f1);}',
      '.wp-pop-btn.primary{background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;border-color:transparent;box-shadow:0 6px 16px rgba(79,70,229,0.28);}',
      '.wp-pop-btn.emerald{background:linear-gradient(135deg,#059669,#10b981);color:#fff;border-color:transparent;box-shadow:0 6px 16px rgba(5,150,105,0.28);}',
      '.wp-pop-btn.rose{background:linear-gradient(135deg,#e11d48,#f43f5e);color:#fff;border-color:transparent;box-shadow:0 6px 16px rgba(225,29,72,0.26);}',
      '.wp-pop-btn .wp-3d-native-icon{width:19px;height:19px;}',
      '.wp-cal-nav{display:flex;align-items:center;justify-content:space-between;gap:0.4rem;margin-bottom:0.75rem;}',
      '.wp-cal-nav-btn{border:none;background:transparent;padding:2px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;transition:transform .15s;}',
      '.wp-cal-nav-btn:hover{transform:scale(1.1);}',
      '.wp-cal-nav-btn .wp-3d-native-icon{width:30px;height:30px;}',
      '.wp-cal-ym{display:flex;align-items:center;gap:0.35rem;flex:1;justify-content:center;}',
      '.wp-cal-ym-pill{border:1px solid var(--border,var(--border-color,#cbd5e1));background:var(--bg-subtle,var(--bg-secondary,#f1f5f9));color:inherit;border-radius:10px;padding:0.36rem 0.65rem;font-size:0.84rem;font-weight:800;cursor:pointer;transition:all .15s;}',
      '.wp-cal-ym-pill:hover{border-color:var(--primary,#6366f1);color:var(--primary,#6366f1);}',
      '.wp-cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;text-align:center;}',
      '.wp-cal-weekdays span{font-size:0.7rem;font-weight:800;color:var(--text-muted,#64748b);padding:4px 0;text-transform:uppercase;}',
      '.wp-cal-weekdays span:first-child{color:#f43f5e;}',
      '.wp-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}',
      '.wp-cal-day{height:38px;border:none;border-radius:11px;background:transparent;color:inherit;font-size:0.83rem;font-weight:700;cursor:pointer;transition:all .14s;display:flex;align-items:center;justify-content:center;}',
      '.wp-cal-day:hover:not(:disabled){background:rgba(99,102,241,0.14);color:var(--primary,#4f46e5);transform:scale(1.06);}',
      '.wp-cal-day.other{opacity:0.34;font-weight:500;}',
      '.wp-cal-day.sun:not(.selected){color:#f43f5e;}',
      '.wp-cal-day.today{box-shadow:inset 0 0 0 2px var(--primary,#6366f1);color:var(--primary,#6366f1);}',
      '.wp-cal-day.selected{background:linear-gradient(135deg,#4f46e5,#6366f1) !important;color:#fff !important;box-shadow:0 6px 14px rgba(79,70,229,0.38);}',
      '.wp-cal-day:disabled{opacity:0.22;cursor:not-allowed;}',
      '.wp-cal-months{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}',
      '.wp-cal-month-btn{padding:0.6rem 0.4rem;border-radius:11px;border:1px solid var(--border,var(--border-color,#e2e8f0));background:var(--bg-subtle,var(--bg-secondary,#f8fafc));color:inherit;font-size:0.8rem;font-weight:700;cursor:pointer;transition:all .14s;}',
      '.wp-cal-month-btn.active,.wp-cal-month-btn:hover{background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;border-color:transparent;}',
      '.wp-sel-search-wrap{display:flex;align-items:center;gap:0.5rem;padding:0.48rem 0.72rem;border-radius:12px;border:1.5px solid var(--border,var(--border-color,#cbd5e1));background:var(--bg-subtle,var(--bg-secondary,#f8fafc));margin-bottom:0.65rem;}',
      '.wp-sel-search-wrap:focus-within{border-color:var(--primary,#6366f1);box-shadow:0 0 0 3px rgba(99,102,241,0.14);}',
      '.wp-sel-search{border:none;background:transparent;outline:none;color:inherit;width:100%;font-size:0.85rem;font-weight:600;font-family:inherit;}',
      '.wp-sel-list{display:flex;flex-direction:column;gap:4px;max-height:52vh;overflow-y:auto;padding-right:2px;}',
      '.wp-sel-group{font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted,#64748b);padding:0.5rem 0.6rem 0.2rem;}',
      '.wp-sel-opt{width:100%;text-align:left;display:flex;align-items:center;justify-content:space-between;gap:0.6rem;padding:0.68rem 0.8rem;border-radius:12px;border:1px solid transparent;background:transparent;color:inherit;font-size:0.86rem;font-weight:600;cursor:pointer;transition:all .13s;font-family:inherit;}',
      '.wp-sel-opt:hover:not(:disabled){background:rgba(99,102,241,0.1);border-color:rgba(99,102,241,0.22);}',
      '.wp-sel-opt.selected{background:linear-gradient(135deg,rgba(79,70,229,0.14),rgba(99,102,241,0.1));border-color:var(--primary,#6366f1);color:var(--primary,#4f46e5);font-weight:800;}',
      '[data-theme="dark"] .wp-sel-opt.selected,[data-theme="midnight"] .wp-sel-opt.selected,[data-theme="oled"] .wp-sel-opt.selected{color:#a5b4fc;}',
      '.wp-sel-opt:disabled{opacity:0.4;cursor:not-allowed;}',
      '.wp-sel-empty{text-align:center;padding:1.5rem 0.75rem;font-size:0.84rem;color:var(--text-muted,#64748b);}',
      '.wp-rcpt-actions-bar{display:flex !important;flex-wrap:wrap !important;gap:0.45rem !important;align-items:center !important;justify-content:stretch !important;}',
      '.wp-rcpt-actions-bar > button,.wp-rcpt-actions-bar > .btn{flex:1 1 44% !important;min-width:120px !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;gap:0.4rem !important;border-radius:11px !important;font-weight:700 !important;padding:0.55rem 0.7rem !important;font-size:0.78rem !important;cursor:pointer !important;}',
      '.wp-rcpt-btn-img{background:linear-gradient(135deg,#059669,#10b981) !important;color:#fff !important;border:none !important;box-shadow:0 5px 14px rgba(5,150,105,0.28) !important;}',
      '.wp-rcpt-btn-pdf{background:linear-gradient(135deg,#e11d48,#f43f5e) !important;color:#fff !important;border:none !important;box-shadow:0 5px 14px rgba(225,29,72,0.26) !important;}',
      '.wp-rcpt-btn-wa,.wp-pop-btn.wa{background:linear-gradient(135deg,#16a34a,#22c55e) !important;color:#fff !important;border:none !important;box-shadow:0 5px 14px rgba(22,163,74,0.28) !important;}',
      '.wp-rcpt-img-stage{background:#e2e8f0;border-radius:14px;padding:0.75rem;display:flex;justify-content:center;align-items:flex-start;max-height:60vh;overflow:auto;}',
      '[data-theme="dark"] .wp-rcpt-img-stage,[data-theme="midnight"] .wp-rcpt-img-stage,[data-theme="oled"] .wp-rcpt-img-stage{background:#0f172a;}',
      '.wp-rcpt-img-stage img{max-width:100%;height:auto;border-radius:10px;box-shadow:0 12px 30px rgba(15,23,42,0.26);}',
      '@keyframes wpPopFade{from{opacity:0}to{opacity:1}}',
      '@keyframes wpPopIn{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function findFieldLabel(el, fallback) {
    try {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      if (el.id) {
        var lbl = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]');
        if (lbl && lbl.textContent.trim()) return lbl.textContent.replace(/\*/g, '').trim();
      }
      var grp = el.closest('.form-group,.filter-group,.input-group,.filter-item,.date-group');
      if (grp) {
        var gl = grp.querySelector('label');
        if (gl && gl.textContent.trim()) return gl.textContent.replace(/\*/g, '').trim();
      }
      if (el.title) return el.title.trim();
    } catch (e) {}
    return fallback;
  }

  function fireInputEvents(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  }

  // ===== 1. WEBPOS 3D CALENDAR PICKER =====
  var MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  var activeDateInput = null;
  var calViewYear = new Date().getFullYear();
  var calViewMonth = new Date().getMonth();
  var calMode = 'days';

  function pad2(n) { return String(n).padStart(2, '0'); }
  function toYMD(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }
  function parseYMD(val) {
    if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
    var p = val.split('-');
    return { y: parseInt(p[0], 10), m: parseInt(p[1], 10) - 1, d: parseInt(p[2], 10) };
  }

  function ensureDateModal() {
    ensureUnifiedStyles();
    var bd = document.getElementById('webposDateModal');
    if (bd) return bd;
    bd = document.createElement('div');
    bd.id = 'webposDateModal';
    bd.className = 'wp-pop-backdrop';
    bd.innerHTML =
      '<div class="wp-pop-card" role="dialog" aria-modal="true">' +
        '<div class="wp-pop-head">' +
          '<h3 class="wp-pop-title" id="wpDateTitle">' + ICONS_3D.calendar() + '<span>Pilih Tanggal</span></h3>' +
          '<button type="button" class="wp-pop-close" id="wpDateClose" aria-label="Tutup">' + ICONS_3D.close() + '</button>' +
        '</div>' +
        '<div class="wp-pop-body">' +
          '<div class="wp-cal-nav">' +
            '<button type="button" class="wp-cal-nav-btn" id="wpCalPrev" aria-label="Sebelumnya">' + ICONS_3D.chevLeft() + '</button>' +
            '<div class="wp-cal-ym">' +
              '<button type="button" class="wp-cal-ym-pill" id="wpCalMonthBtn"></button>' +
              '<button type="button" class="wp-cal-ym-pill" id="wpCalYearBtn"></button>' +
            '</div>' +
            '<button type="button" class="wp-cal-nav-btn" id="wpCalNext" aria-label="Berikutnya">' + ICONS_3D.chevRight() + '</button>' +
          '</div>' +
          '<div id="wpCalStage"></div>' +
        '</div>' +
        '<div class="wp-pop-foot">' +
          '<button type="button" class="wp-pop-btn" id="wpCalClear">' + ICONS_3D.clear() + '<span>Hapus</span></button>' +
          '<button type="button" class="wp-pop-btn primary" id="wpCalToday">' + ICONS_3D.today() + '<span>Hari Ini</span></button>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(bd);

    bd.addEventListener('click', function(e) { if (e.target === bd) closeDateModal(); });
    document.getElementById('wpDateClose').onclick = closeDateModal;
    document.getElementById('wpCalPrev').onclick = function() {
      if (calMode === 'months') { calViewYear--; }
      else if (calMode === 'years') { calViewYear -= 12; }
      else { calViewMonth--; if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; } }
      renderCalendar();
    };
    document.getElementById('wpCalNext').onclick = function() {
      if (calMode === 'months') { calViewYear++; }
      else if (calMode === 'years') { calViewYear += 12; }
      else { calViewMonth++; if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; } }
      renderCalendar();
    };
    document.getElementById('wpCalMonthBtn').onclick = function() {
      calMode = (calMode === 'months') ? 'days' : 'months';
      renderCalendar();
    };
    document.getElementById('wpCalYearBtn').onclick = function() {
      calMode = (calMode === 'years') ? 'days' : 'years';
      renderCalendar();
    };
    document.getElementById('wpCalToday').onclick = function() {
      var now = new Date();
      selectCalendarDate(toYMD(now.getFullYear(), now.getMonth(), now.getDate()));
    };
    document.getElementById('wpCalClear').onclick = function() {
      if (activeDateInput) {
        activeDateInput.value = '';
        fireInputEvents(activeDateInput);
      }
      closeDateModal();
    };
    return bd;
  }

  function closeDateModal() {
    var bd = document.getElementById('webposDateModal');
    if (bd) bd.classList.remove('open');
    activeDateInput = null;
  }

  function selectCalendarDate(ymd) {
    if (!activeDateInput) { closeDateModal(); return; }
    var target = activeDateInput;
    if (target.min && ymd < target.min) ymd = target.min;
    if (target.max && ymd > target.max) ymd = target.max;
    target.value = ymd;
    closeDateModal();
    fireInputEvents(target);
  }

  function renderCalendar() {
    var monthBtn = document.getElementById('wpCalMonthBtn');
    var yearBtn = document.getElementById('wpCalYearBtn');
    var stage = document.getElementById('wpCalStage');
    if (!stage) return;
    monthBtn.textContent = MONTHS_ID[calViewMonth];
    yearBtn.textContent = String(calViewYear);

    if (calMode === 'months') {
      var mh = '<div class="wp-cal-months">';
      for (var m = 0; m < 12; m++) {
        mh += '<button type="button" class="wp-cal-month-btn' + (m === calViewMonth ? ' active' : '') + '" data-m="' + m + '">' + MONTHS_SHORT[m] + '</button>';
      }
      mh += '</div>';
      stage.innerHTML = mh;
      stage.querySelectorAll('.wp-cal-month-btn').forEach(function(b) {
        b.onclick = function() { calViewMonth = parseInt(b.dataset.m, 10); calMode = 'days'; renderCalendar(); };
      });
      return;
    }

    if (calMode === 'years') {
      var startY = calViewYear - 5;
      var yh = '<div class="wp-cal-months">';
      for (var y = startY; y < startY + 12; y++) {
        yh += '<button type="button" class="wp-cal-month-btn' + (y === calViewYear ? ' active' : '') + '" data-y="' + y + '">' + y + '</button>';
      }
      yh += '</div>';
      stage.innerHTML = yh;
      stage.querySelectorAll('.wp-cal-month-btn').forEach(function(b) {
        b.onclick = function() { calViewYear = parseInt(b.dataset.y, 10); calMode = 'days'; renderCalendar(); };
      });
      return;
    }

    var now = new Date();
    var todayYMD = toYMD(now.getFullYear(), now.getMonth(), now.getDate());
    var selVal = activeDateInput ? activeDateInput.value : '';
    var minVal = activeDateInput ? (activeDateInput.min || '') : '';
    var maxVal = activeDateInput ? (activeDateInput.max || '') : '';

    var firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
    var daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
    var prevMonthDays = new Date(calViewYear, calViewMonth, 0).getDate();

    var html = '<div class="wp-cal-weekdays"><span>Min</span><span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span></div><div class="wp-cal-grid">';
    var totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    if (totalCells < 35) totalCells = 35;

    for (var i = 0; i < totalCells; i++) {
      var cellY = calViewYear, cellM = calViewMonth, dayNum = 0, isOther = false;
      if (i < firstDay) {
        dayNum = prevMonthDays - (firstDay - 1 - i);
        cellM = calViewMonth - 1;
        if (cellM < 0) { cellM = 11; cellY--; }
        isOther = true;
      } else if (i >= firstDay + daysInMonth) {
        dayNum = i - (firstDay + daysInMonth) + 1;
        cellM = calViewMonth + 1;
        if (cellM > 11) { cellM = 0; cellY++; }
        isOther = true;
      } else {
        dayNum = i - firstDay + 1;
      }
      var ymd = toYMD(cellY, cellM, dayNum);
      var disabled = (minVal && ymd < minVal) || (maxVal && ymd > maxVal);
      var cls = 'wp-cal-day';
      if (isOther) cls += ' other';
      if (i % 7 === 0) cls += ' sun';
      if (ymd === todayYMD) cls += ' today';
      if (ymd === selVal) cls += ' selected';
      html += '<button type="button" class="' + cls + '" data-ymd="' + ymd + '"' + (disabled ? ' disabled' : '') + '>' + dayNum + '</button>';
    }
    html += '</div>';
    stage.innerHTML = html;
    stage.querySelectorAll('.wp-cal-day').forEach(function(b) {
      b.onclick = function() { selectCalendarDate(b.dataset.ymd); };
    });
  }

  window.WebPOSDatePicker = {
    open: function(inputEl) {
      if (!inputEl || inputEl.disabled || inputEl.readOnly) return;
      activeDateInput = inputEl;
      calMode = 'days';
      var parsed = parseYMD(inputEl.value);
      var base = parsed ? new Date(parsed.y, parsed.m, parsed.d) : new Date();
      calViewYear = base.getFullYear();
      calViewMonth = base.getMonth();
      var bd = ensureDateModal();
      var titleEl = document.getElementById('wpDateTitle');
      if (titleEl) {
        var sp = titleEl.querySelector('span');
        if (sp) sp.textContent = findFieldLabel(inputEl, 'Pilih Tanggal');
      }
      var clearBtn = document.getElementById('wpCalClear');
      if (clearBtn) clearBtn.style.display = inputEl.required ? 'none' : '';
      renderCalendar();
      try { inputEl.blur(); } catch (e) {}
      bd.classList.add('open');
    },
    close: closeDateModal
  };

  try {
    var origShowPicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function() {
      if (this && this.type === 'date' && !this.disabled && !this.readOnly && this.dataset.nativeDate !== 'true') {
        window.WebPOSDatePicker.open(this);
        return;
      }
      if (typeof origShowPicker === 'function') return origShowPicker.apply(this, arguments);
    };
  } catch (e) {}

  // ===== 2. WEBPOS 3D SELECT PICKER =====
  var activeSelectEl = null;

  function ensureSelectModal() {
    ensureUnifiedStyles();
    var bd = document.getElementById('webposSelectModal');
    if (bd) return bd;
    bd = document.createElement('div');
    bd.id = 'webposSelectModal';
    bd.className = 'wp-pop-backdrop';
    bd.innerHTML =
      '<div class="wp-pop-card" role="dialog" aria-modal="true">' +
        '<div class="wp-pop-head">' +
          '<h3 class="wp-pop-title" id="wpSelTitle">' + ICONS_3D.list() + '<span>Pilih Opsi</span></h3>' +
          '<button type="button" class="wp-pop-close" id="wpSelClose" aria-label="Tutup">' + ICONS_3D.close() + '</button>' +
        '</div>' +
        '<div class="wp-pop-body">' +
          '<div class="wp-sel-search-wrap" id="wpSelSearchWrap" style="display:none;">' +
            ICONS_3D.search() +
            '<input type="text" class="wp-sel-search" id="wpSelSearch" placeholder="Cari pilihan..." autocomplete="off">' +
          '</div>' +
          '<div class="wp-sel-list" id="wpSelList"></div>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(bd);

    bd.addEventListener('click', function(e) { if (e.target === bd) closeSelectModal(); });
    document.getElementById('wpSelClose').onclick = closeSelectModal;
    document.getElementById('wpSelSearch').addEventListener('input', function() {
      renderSelectOptions(this.value || '');
    });
    return bd;
  }

  function closeSelectModal() {
    var bd = document.getElementById('webposSelectModal');
    if (bd) bd.classList.remove('open');
    activeSelectEl = null;
  }

  function renderSelectOptions(filterText) {
    var listEl = document.getElementById('wpSelList');
    if (!listEl || !activeSelectEl) return;
    var q = String(filterText || '').trim().toLowerCase();
    var curVal = activeSelectEl.value;
    var frag = document.createDocumentFragment();
    var countRendered = 0;

    function addOptionBtn(opt) {
      var txt = (opt.textContent || opt.label || '').trim();
      if (q && txt.toLowerCase().indexOf(q) === -1) return;
      var isSel = opt.selected || (opt.value === curVal);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wp-sel-opt' + (isSel ? ' selected' : '');
      if (opt.disabled) btn.disabled = true;
      var span = document.createElement('span');
      span.textContent = txt;
      btn.appendChild(span);
      if (isSel) {
        var chk = document.createElement('span');
        chk.innerHTML = ICONS_3D.check();
        btn.appendChild(chk);
      }
      btn.onclick = function() {
        if (opt.disabled || !activeSelectEl) return;
        var target = activeSelectEl;
        var prev = target.value;
        target.value = opt.value;
        opt.selected = true;
        closeSelectModal();
        if (target.value !== prev) {
          fireInputEvents(target);
        } else {
          try { target.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        }
      };
      frag.appendChild(btn);
      countRendered++;
    }

    var children = activeSelectEl.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.tagName === 'OPTGROUP') {
        var groupOpts = child.querySelectorAll('option');
        var matched = [];
        for (var j = 0; j < groupOpts.length; j++) {
          var t = (groupOpts[j].textContent || '').trim();
          if (!q || t.toLowerCase().indexOf(q) !== -1) matched.push(groupOpts[j]);
        }
        if (matched.length > 0) {
          var hdr = document.createElement('div');
          hdr.className = 'wp-sel-group';
          hdr.textContent = child.label || '';
          frag.appendChild(hdr);
          matched.forEach(addOptionBtn);
        }
      } else if (child.tagName === 'OPTION') {
        addOptionBtn(child);
      }
    }

    listEl.innerHTML = '';
    if (countRendered === 0) {
      var empty = document.createElement('div');
      empty.className = 'wp-sel-empty';
      empty.textContent = 'Pilihan tidak ditemukan';
      listEl.appendChild(empty);
    } else {
      listEl.appendChild(frag);
    }
  }

  window.WebPOSSelectPicker = {
    open: function(selEl) {
      if (!selEl || selEl.disabled || selEl.multiple || (selEl.size && selEl.size > 1)) return;
      if (selEl.dataset.nativeSelect === 'true') return;
      activeSelectEl = selEl;
      var bd = ensureSelectModal();
      var titleEl = document.getElementById('wpSelTitle');
      if (titleEl) {
        var sp = titleEl.querySelector('span');
        if (sp) sp.textContent = findFieldLabel(selEl, 'Pilih Opsi');
      }
      var searchWrap = document.getElementById('wpSelSearchWrap');
      var searchInput = document.getElementById('wpSelSearch');
      var totalOpts = selEl.options ? selEl.options.length : 0;
      if (searchWrap && searchInput) {
        searchInput.value = '';
        searchWrap.style.display = totalOpts > 6 ? 'flex' : 'none';
      }
      renderSelectOptions('');
      try { selEl.blur(); } catch (e) {}
      bd.classList.add('open');
      setTimeout(function() {
        var cur = document.querySelector('#wpSelList .wp-sel-opt.selected');
        if (cur && cur.scrollIntoView) {
          try { cur.scrollIntoView({ block: 'center' }); } catch (e) {}
        }
      }, 40);
    },
    close: closeSelectModal
  };

  var touchStartPt = null;
  document.addEventListener('touchstart', function(e) {
    if (e.touches && e.touches.length === 1) {
      touchStartPt = { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target };
    }
  }, { capture: true, passive: true });

  document.addEventListener('touchend', function(e) {
    if (!touchStartPt || !e.changedTouches || !e.changedTouches.length) return;
    var dx = Math.abs(e.changedTouches[0].clientX - touchStartPt.x);
    var dy = Math.abs(e.changedTouches[0].clientY - touchStartPt.y);
    var t = e.target;
    touchStartPt = null;
    if (dx > 10 || dy > 10 || !t) return;
    if (t.tagName === 'INPUT' && t.type === 'date' && !t.disabled && !t.readOnly && t.dataset.nativeDate !== 'true') {
      e.preventDefault();
      e.stopPropagation();
      window.WebPOSDatePicker.open(t);
    } else if (t.tagName === 'SELECT' && !t.disabled && !t.multiple && !(t.size > 1) && t.dataset.nativeSelect !== 'true') {
      e.preventDefault();
      e.stopPropagation();
      window.WebPOSSelectPicker.open(t);
    }
  }, true);

  document.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    var t = e.target;
    if (!t) return;
    if (t.tagName === 'INPUT' && t.type === 'date' && !t.disabled && !t.readOnly && t.dataset.nativeDate !== 'true') {
      e.preventDefault();
      e.stopPropagation();
      window.WebPOSDatePicker.open(t);
    } else if (t.tagName === 'SELECT' && !t.disabled && !t.multiple && !(t.size > 1) && t.dataset.nativeSelect !== 'true') {
      e.preventDefault();
      e.stopPropagation();
      window.WebPOSSelectPicker.open(t);
    }
  }, true);

  document.addEventListener('click', function(e) {
    var t = e.target;
    if (!t) return;
    if (t.tagName === 'INPUT' && t.type === 'date' && !t.disabled && !t.readOnly && t.dataset.nativeDate !== 'true') {
      e.preventDefault();
      window.WebPOSDatePicker.open(t);
    }
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeDateModal();
      closeSelectModal();
      var rm = document.getElementById('webposReceiptImgModal');
      if (rm) rm.classList.remove('open');
      var pm = document.getElementById('webposUnifiedPreviewModal');
      if (pm) pm.classList.remove('open');
      return;
    }
    var t = e.target;
    if (!t) return;
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') && t.tagName === 'SELECT' && !t.disabled && !t.multiple && !(t.size > 1) && t.dataset.nativeSelect !== 'true') {
      e.preventDefault();
      window.WebPOSSelectPicker.open(t);
    } else if ((e.key === 'Enter' || e.key === ' ') && t.tagName === 'INPUT' && t.type === 'date' && !t.disabled && !t.readOnly && t.dataset.nativeDate !== 'true') {
      e.preventDefault();
      window.WebPOSDatePicker.open(t);
    }
  }, true);

  // ===== 3. WEBPOS UNIFIED RECEIPT ENGINE (THERMAL + NOTA PNG + PDF) =====
  var currentReceiptTx = null;
  var currentReceiptText = '';
  var lastRenderedPng = null;
  var lastRenderedName = 'Nota-WebPOS.png';

  function fmtRp(n) {
    var num = Math.round(Number(n) || 0);
    var sign = num < 0 ? '-' : '';
    return sign + 'Rp ' + Math.abs(num).toLocaleString('id-ID');
  }

  function fmtSignedRp(n) {
    var num = Math.round(Number(n) || 0);
    if (num > 0) return '+' + fmtRp(num);
    if (num < 0) return '-' + fmtRp(Math.abs(num));
    return 'Rp 0';
  }

  function loadStoreHeader() {
    var hdr = {};
    try { hdr = JSON.parse(localStorage.getItem('receiptHeader')) || {}; } catch (e) {}
    if (!hdr.storeName && !hdr.address && !hdr.phone && !hdr.note) {
      try { hdr = JSON.parse(localStorage.getItem('webpos_receipt_header')) || {}; } catch (e) {}
    }
    return {
      storeName: (hdr.storeName || localStorage.getItem('webpos_store_name') || 'HIFZI CELL').trim(),
      address: (hdr.address || localStorage.getItem('webpos_store_address') || '').trim(),
      phone: (hdr.phone || localStorage.getItem('webpos_store_phone') || '').trim(),
      note: (hdr.note || localStorage.getItem('webpos_store_footer_note') || 'Terima kasih telah berbelanja').trim(),
      logo: localStorage.getItem('webpos_store_logo') || ''
    };
  }

  function normalizeTx(tx) {
    if (!tx || typeof tx !== 'object') return null;
    var hdr = loadStoreHeader();
    var items = Array.isArray(tx.items) ? tx.items.map(function(it) {
      var qty = Number(it.quantity != null ? it.quantity : (it.qty != null ? it.qty : 1)) || 1;
      var price = Number(it.price != null ? it.price : (it.harga != null ? it.harga : 0)) || 0;
      var sub = Number(it.total != null ? it.total : (qty * price)) || 0;
      return {
        name: String(it.name || it.productName || 'Barang'),
        quantity: qty,
        price: price,
        total: sub,
        priceType: it.priceType || ''
      };
    }) : [];

    var totalQty = items.reduce(function(acc, i) { return acc + i.quantity; }, 0);
    var itemsSum = items.reduce(function(acc, i) { return acc + i.total; }, 0);
    var isReseller = Boolean(
      tx.resellerMode ||
      tx.priceMode === 'reseller' ||
      tx.resellerName ||
      items.some(function(i) { return i.priceType === 'reseller'; })
    );
    var rawMethod = String(tx.paymentMethod || tx.metode_pembayaran || tx.metode || 'tunai').toLowerCase();
    var isHutang = (rawMethod === 'hutang' || rawMethod === 'utang' || (Number(tx.remainingPiutang) || 0) > 0);
    var methodLabel = rawMethod === 'cash' ? 'TUNAI'
      : (rawMethod === 'utang' || rawMethod === 'hutang') ? 'HUTANG'
      : rawMethod.toUpperCase();

    var discount = Number(tx.discount != null ? tx.discount : (tx.diskon || 0)) || 0;
    var tax = Number(tx.tax || 0) || 0;
    var rounding = Number(tx.rounding != null ? tx.rounding : (tx.pembulatan || 0)) || 0;
    var subtotal = Number(tx.subtotal != null ? tx.subtotal : (itemsSum || tx.total || tx.nominal || 0)) || 0;
    var total = Number(tx.total != null ? tx.total : (tx.nominal != null ? tx.nominal : Math.max(0, subtotal - discount + tax + rounding))) || 0;
    var paid = tx.paymentAmount != null ? Number(tx.paymentAmount) : (isHutang ? Number(tx.bayar_sekarang || 0) : total);
    var change = tx.change != null ? Number(tx.change) : Math.max(0, paid - total);
    var remaining = tx.remainingPiutang != null ? Number(tx.remainingPiutang) : (isHutang ? Math.max(0, total - paid) : 0);

    var ts = tx.timestamp || tx.waktu || tx.created_at || Date.now();
    if (ts && typeof ts === 'object' && typeof ts.toMillis === 'function') ts = ts.toMillis();
    var dObj = new Date(ts);
    if (isNaN(dObj.getTime())) dObj = new Date();
    var dateStr = dObj.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
    var timeStr = dObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    var konter = isReseller ? String(tx.resellerName || tx.customerName || 'Reseller Umum') : '';
    var customer = !isReseller ? String(tx.customerName || '') : '';
    var docTitle = tx.docTitle || (
      isReseller && isHutang ? 'NOTA RESELLER (HUTANG)' :
      isReseller ? 'NOTA PENJUALAN RESELLER' :
      isHutang ? 'NOTA PENJUALAN HUTANG' :
      'NOTA PENJUALAN'
    );

    return {
      id: String(tx.id || ('TRX' + Date.now())),
      seqNo: tx.inputSequence ? String(tx.inputSequence) : '',
      dateTime: dateStr + ' ' + timeStr,
      cashier: String(tx.cashierName || tx.userName || '-'),
      isReseller: isReseller,
      isHutang: isHutang,
      statusLabel: isHutang && remaining > 0 ? 'BELUM LUNAS' : 'LUNAS',
      konter: konter,
      customer: customer,
      docTitle: docTitle,
      items: items,
      totalQty: totalQty,
      subtotal: subtotal,
      discount: discount,
      tax: tax,
      rounding: rounding,
      total: total,
      paid: paid,
      change: change,
      remaining: remaining,
      methodLabel: methodLabel,
      noteText: String(tx.receiptNote || hdr.note),
      store: hdr
    };
  }

  function buildPlain(tx) {
    var n = normalizeTx(tx);
    if (!n) return '';
    var L = [];
    L.push('================================');
    L.push('  ' + n.store.storeName.toUpperCase());
    if (n.store.address) L.push('  ' + n.store.address);
    if (n.store.phone) L.push('  HP: ' + n.store.phone);
    L.push('================================');
    L.push(n.docTitle);
    L.push('No     : ' + n.id);
    if (n.seqNo) L.push('Urut   : #' + n.seqNo);
    L.push('Tgl    : ' + n.dateTime);
    L.push('Kasir  : ' + n.cashier);
    if (n.isReseller) {
      L.push('Konter : ' + n.konter);
      L.push('Tipe   : RESELLER');
    } else if (n.customer) {
      L.push('Plgn   : ' + n.customer);
    }
    L.push('Status : ' + n.statusLabel);
    L.push('--------------------------------');
    if (n.items.length > 0) {
      n.items.forEach(function(item) {
        L.push(item.name);
        L.push('  ' + item.quantity + ' x ' + fmtRp(item.price) + ' = ' + fmtRp(item.total));
      });
    } else {
      L.push(n.docTitle);
    }
    L.push('--------------------------------');
    if (n.totalQty > 0) L.push('Total Item : ' + n.totalQty + ' pcs');
    L.push('Subtotal   : ' + fmtRp(n.subtotal));
    if (n.discount > 0) L.push('Diskon     : -' + fmtRp(n.discount));
    if (n.tax > 0) L.push('PPN        : ' + fmtRp(n.tax));
    if (n.rounding !== 0) L.push('Pembulatan : ' + fmtSignedRp(n.rounding));
    L.push('TOTAL      : ' + fmtRp(n.total));
    L.push('--------------------------------');
    if (n.isHutang) {
      L.push('Bayar Awal : ' + fmtRp(n.paid));
      L.push('Sisa Hutang: ' + fmtRp(n.remaining));
    } else {
      L.push('Bayar      : ' + fmtRp(n.paid));
      L.push('Kembali    : ' + fmtRp(n.change));
    }
    L.push('Metode     : ' + n.methodLabel);
    L.push('================================');
    L.push(n.noteText);
    return L.join('\n');
  }

  function buildEscPos(tx) {
    var n = normalizeTx(tx);
    if (!n) return '';
    var ESC = '\x1B', GS = '\x1D', FEED = '\x0A';
    var INIT = ESC + '\x40', CENTER = ESC + '\x61\x01', LEFT = ESC + '\x61\x00';
    var BOLD_ON = ESC + '\x45\x01', BOLD_OFF = ESC + '\x45\x00';
    var SIZE2 = ESC + '\x21\x10', SIZE1 = ESC + '\x21\x00', CUT = GS + '\x56\x41\x03';

    var c = INIT;
    c += CENTER + BOLD_ON + SIZE2 + n.store.storeName.toUpperCase() + SIZE1 + BOLD_OFF + FEED;
    if (n.store.address) c += CENTER + n.store.address + FEED;
    if (n.store.phone) c += CENTER + 'HP: ' + n.store.phone + FEED;
    c += CENTER + '------------------------------' + FEED;
    c += CENTER + BOLD_ON + n.docTitle + BOLD_OFF + FEED;
    c += LEFT;
    c += 'No     : ' + n.id + FEED;
    if (n.seqNo) c += 'Urut   : #' + n.seqNo + FEED;
    c += 'Tgl    : ' + n.dateTime + FEED;
    c += 'Kasir  : ' + n.cashier + FEED;
    if (n.isReseller) {
      c += BOLD_ON + 'Konter : ' + n.konter + BOLD_OFF + FEED;
      c += 'Tipe   : RESELLER' + FEED;
    } else if (n.customer) {
      c += 'Plgn   : ' + n.customer + FEED;
    }
    c += 'Status : ' + n.statusLabel + FEED;
    c += '------------------------------' + FEED;
    if (n.items.length > 0) {
      n.items.forEach(function(item) {
        c += item.name + FEED;
        c += '  ' + item.quantity + ' x ' + fmtRp(item.price) + ' = ' + fmtRp(item.total) + FEED;
      });
    } else {
      c += n.docTitle + FEED;
    }
    c += '------------------------------' + FEED;
    if (n.totalQty > 0) c += 'Total Item : ' + n.totalQty + ' pcs' + FEED;
    c += 'Subtotal   : ' + fmtRp(n.subtotal) + FEED;
    if (n.discount > 0) c += 'Diskon     : -' + fmtRp(n.discount) + FEED;
    if (n.tax > 0) c += 'PPN        : ' + fmtRp(n.tax) + FEED;
    if (n.rounding !== 0) c += 'Pembulatan : ' + fmtSignedRp(n.rounding) + FEED;
    c += BOLD_ON + 'TOTAL      : ' + fmtRp(n.total) + BOLD_OFF + FEED;
    c += '------------------------------' + FEED;
    if (n.isHutang) {
      c += 'Bayar Awal : ' + fmtRp(n.paid) + FEED;
      c += BOLD_ON + 'Sisa Hutang: ' + fmtRp(n.remaining) + BOLD_OFF + FEED;
    } else {
      c += 'Bayar      : ' + fmtRp(n.paid) + FEED;
      c += 'Kembali    : ' + fmtRp(n.change) + FEED;
    }
    c += 'Metode     : ' + n.methodLabel + FEED;
    c += '==============================' + FEED;
    c += CENTER + n.noteText + FEED + FEED + FEED + FEED + CUT;
    return c;
  }

  var cachedLogoSrc = '';
  var cachedLogoImg = null;

  function testImageClean(img) {
    try {
      var tc = document.createElement('canvas');
      tc.width = 2; tc.height = 2;
      tc.getContext('2d').drawImage(img, 0, 0, 2, 2);
      tc.toDataURL('image/png');
      return true;
    } catch (e) { return false; }
  }

  function preloadStoreLogo(src) {
    var cleanSrc = String(src || '').trim();
    if (!cleanSrc) { cachedLogoSrc = ''; cachedLogoImg = null; return; }
    if (cleanSrc === cachedLogoSrc && cachedLogoImg) return;
    cachedLogoSrc = cleanSrc;
    cachedLogoImg = null;
    try {
      var img = new Image();
      if (cleanSrc.indexOf('data:') !== 0) img.crossOrigin = 'anonymous';
      img.onload = function() {
        if (cachedLogoSrc === cleanSrc && testImageClean(img)) cachedLogoImg = img;
      };
      img.onerror = function() {
        if (cachedLogoSrc === cleanSrc) cachedLogoImg = null;
      };
      img.src = cleanSrc;
    } catch (e) {}
  }

  try { preloadStoreLogo(loadStoreHeader().logo); } catch (e) {}

  function loadImageSafe(src) {
    return new Promise(function(resolve) {
      if (!src) { resolve(null); return; }
      if (src === cachedLogoSrc && cachedLogoImg) { resolve(cachedLogoImg); return; }
      var done = false;
      function finish(val) { if (!done) { done = true; resolve(val); } }
      var timer = setTimeout(function() { finish(null); }, 2000);
      var img = new Image();
      if (String(src).indexOf('data:') !== 0) img.crossOrigin = 'anonymous';
      img.onload = function() {
        clearTimeout(timer);
        if (testImageClean(img)) { cachedLogoSrc = String(src); cachedLogoImg = img; finish(img); }
        else finish(null);
      };
      img.onerror = function() { clearTimeout(timer); finish(null); };
      img.src = src;
    });
  }

  function wrapLines(ctx, text, maxW) {
    var words = String(text || '').split(/\s+/);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? (cur + ' ' + words[i]) : words[i];
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = words[i];
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function drawRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function renderReceiptSync(txOrText, customTitle, forceNoLogo) {
    var isStruct = txOrText && typeof txOrText === 'object';
    var n = isStruct ? normalizeTx(txOrText) : null;
    var hdr = n ? n.store : loadStoreHeader();
    if (hdr.logo && hdr.logo !== cachedLogoSrc) preloadStoreLogo(hdr.logo);
    var logoImg = (!forceNoLogo && cachedLogoImg && cachedLogoSrc === hdr.logo) ? cachedLogoImg : null;
    
    var W = 760;
    var CARD_X = 28;
    var CARD_W = W - CARD_X * 2;
    var INNER_X = CARD_X + 34;
    var INNER_W = CARD_W - 68;

    var measureCanvas = document.createElement('canvas');
    measureCanvas.width = W;
    measureCanvas.height = 100;
    var mctx = measureCanvas.getContext('2d');

    var rows = [];
    var plainLines = [];
    if (n) {
      mctx.font = '700 22px "Segoe UI", Arial, sans-serif';
      n.items.forEach(function(it) {
        var wrapped = wrapLines(mctx, it.name, INNER_W - 200);
        rows.push({ item: it, wrapped: wrapped });
      });
    } else {
      var raw = String(txOrText || '').replace(/\r/g, '').split('\n');
      for (var r = 0; r < raw.length; r++) {
        var ln = raw[r].trim();
        if (!ln) continue;
        if (/^[=\-_*]{4,}$/.test(ln)) {
          plainLines.push({ type: 'div' });
        } else {
          plainLines.push({ type: 'text', text: ln });
        }
      }
    }

    var H = 56;
    H += logoImg ? 104 : 68;
    H += 36;
    if (hdr.address) H += 26;
    if (hdr.phone) H += 24;
    H += 66;

    if (n) {
      var metaCount = 3 + (n.seqNo ? 1 : 0) + ((n.isReseller || n.customer) ? 1 : 0) + (n.isReseller ? 1 : 0) + 1;
      H += metaCount * 30 + 28;
      H += 44;
      rows.forEach(function(row) {
        H += (row.wrapped.length * 26) + 34;
      });
      H += 24 + 34 + 32;
      if (n.discount > 0) H += 32;
      if (n.tax > 0) H += 32;
      if (n.rounding !== 0) H += 32;
      H += 74 + (34 * 3 + 22) + 74 + 72;
    } else {
      plainLines.forEach(function(pl) {
        H += pl.type === 'div' ? 20 : 30;
      });
      H += 110;
    }

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = Math.max(540, H);
    var ctx = canvas.getContext('2d');

    var bgGrad = ctx.createLinearGradient(0, 0, W, canvas.height);
    bgGrad.addColorStop(0, '#eef2ff');
    bgGrad.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, canvas.height);

    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.14)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    drawRoundRect(ctx, CARD_X, 24, CARD_W, canvas.height - 54, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    var accentA = n && n.isReseller ? '#4f46e5' : (n && n.isHutang ? '#d97706' : '#2563eb');
    var accentB = n && n.isReseller ? '#7c3aed' : (n && n.isHutang ? '#f59e0b' : '#4f46e5');
    ctx.save();
    drawRoundRect(ctx, CARD_X, 24, CARD_W, 12, 6);
    var topGrad = ctx.createLinearGradient(CARD_X, 24, CARD_X + CARD_W, 24);
    topGrad.addColorStop(0, accentA);
    topGrad.addColorStop(1, accentB);
    ctx.fillStyle = topGrad;
    ctx.fill();
    ctx.restore();

    var y = 60;
    if (logoImg) {
      var sz = 78;
      var lx = (W - sz) / 2;
      ctx.save();
      drawRoundRect(ctx, lx, y, sz, sz, 18);
      ctx.clip();
      ctx.drawImage(logoImg, lx, y, sz, sz);
      ctx.restore();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      drawRoundRect(ctx, lx, y, sz, sz, 18);
      ctx.stroke();
      y += sz + 18;
    } else {
      var msz = 52;
      var mx = (W - msz) / 2;
      var mGrad = ctx.createLinearGradient(mx, y, mx + msz, y + msz);
      mGrad.addColorStop(0, accentA);
      mGrad.addColorStop(1, accentB);
      drawRoundRect(ctx, mx, y, msz, msz, 14);
      ctx.fillStyle = mGrad;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 24px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((hdr.storeName || 'H').slice(0, 2).toUpperCase(), W / 2, y + msz / 2 + 1);
      y += msz + 16;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 28px "Segoe UI", Arial, sans-serif';
    ctx.fillText(hdr.storeName.toUpperCase(), W / 2, y + 18);
    y += 32;

    ctx.fillStyle = '#475569';
    ctx.font = '500 17px "Segoe UI", Arial, sans-serif';
    if (hdr.address) {
      ctx.fillText(hdr.address, W / 2, y + 14);
      y += 24;
    }
    if (hdr.phone) {
      ctx.fillText('Telp / WA: ' + hdr.phone, W / 2, y + 14);
      y += 24;
    }

    y += 10;
    var bannerTitle = n ? n.docTitle : (customTitle || 'BUKTI TRANSAKSI');
    var banW = Math.min(INNER_W, Math.max(320, bannerTitle.length * 14 + 64));
    var banX = (W - banW) / 2;
    var bGrad = ctx.createLinearGradient(banX, y, banX + banW, y);
    bGrad.addColorStop(0, accentA);
    bGrad.addColorStop(1, accentB);
    drawRoundRect(ctx, banX, y, banW, 40, 20);
    ctx.fillStyle = bGrad;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 17px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(bannerTitle, W / 2, y + 26);
    y += 58;

    function drawKV(label, value, opts) {
      opts = opts || {};
      ctx.textAlign = 'left';
      ctx.fillStyle = opts.labelColor || '#64748b';
      ctx.font = (opts.bold ? '700 ' : '600 ') + (opts.size || 18) + 'px "Segoe UI", Arial, sans-serif';
      ctx.fillText(label, INNER_X, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = opts.valColor || '#0f172a';
      ctx.font = (opts.valBold !== false ? '700 ' : '600 ') + (opts.size || 18) + 'px "Segoe UI", Arial, sans-serif';
      ctx.fillText(String(value || '-'), INNER_X + INNER_W, y);
      y += opts.step || 29;
    }

    function drawDash(padTop, padBot) {
      y += padTop || 6;
      ctx.save();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(INNER_X, y);
      ctx.lineTo(INNER_X + INNER_W, y);
      ctx.stroke();
      ctx.restore();
      y += padBot || 18;
    }

    if (n) {
      drawKV('No. Nota', n.id);
      if (n.seqNo) drawKV('No. Urut', '#' + n.seqNo);
      drawKV('Tanggal', n.dateTime);
      drawKV('Kasir', n.cashier);
      if (n.isReseller) {
        drawKV('Konter Reseller', n.konter, { valColor: '#4f46e5', bold: true });
        drawKV('Tipe Harga', 'RESELLER', { valColor: '#7c3aed' });
      } else if (n.customer) {
        drawKV('Pelanggan', n.customer);
      }
      drawKV('Metode Bayar', n.methodLabel);

      y += 4;
      drawRoundRect(ctx, INNER_X, y, INNER_W, 36, 10);
      ctx.fillStyle = '#f1f5f9';
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.font = '800 15px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('NAMA BARANG / QTY', INNER_X + 14, y + 23);
      ctx.textAlign = 'right';
      ctx.fillText('SUBTOTAL', INNER_X + INNER_W - 14, y + 23);
      y += 54;

      rows.forEach(function(row, idx) {
        var it = row.item;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#0f172a';
        ctx.font = '700 20px "Segoe UI", Arial, sans-serif';
        row.wrapped.forEach(function(wline, wi) {
          ctx.fillText(wline, INNER_X + 6, y);
          if (wi === 0) {
            ctx.textAlign = 'right';
            ctx.fillStyle = '#0f172a';
            ctx.font = '800 20px "Segoe UI", Arial, sans-serif';
            ctx.fillText(fmtRp(it.total), INNER_X + INNER_W - 6, y);
            ctx.textAlign = 'left';
            ctx.font = '700 20px "Segoe UI", Arial, sans-serif';
          }
          y += 25;
        });
        ctx.fillStyle = '#64748b';
        ctx.font = '500 16px "Segoe UI", Arial, sans-serif';
        ctx.fillText(it.quantity + ' x ' + fmtRp(it.price), INNER_X + 6, y);
        y += 14;
        if (idx < rows.length - 1) {
          ctx.strokeStyle = '#f1f5f9';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(INNER_X, y);
          ctx.lineTo(INNER_X + INNER_W, y);
          ctx.stroke();
        }
        y += 22;
      });

      drawDash(2, 22);

      if (n.totalQty > 0) drawKV('Total Item', n.totalQty + ' pcs', { step: 30 });
      drawKV('Subtotal', fmtRp(n.subtotal), { step: 30 });
      if (n.discount > 0) drawKV('Diskon', '-' + fmtRp(n.discount), { valColor: '#e11d48', step: 30 });
      if (n.tax > 0) drawKV('PPN', fmtRp(n.tax), { step: 30 });
      if (n.rounding !== 0) {
        drawKV('Pembulatan', fmtSignedRp(n.rounding), {
          valColor: n.rounding > 0 ? '#059669' : '#d97706',
          step: 30
        });
      }

      y += 4;
      drawRoundRect(ctx, INNER_X, y, INNER_W, 56, 14);
      var totGrad = ctx.createLinearGradient(INNER_X, y, INNER_X + INNER_W, y);
      totGrad.addColorStop(0, '#0f172a');
      totGrad.addColorStop(1, '#1e293b');
      ctx.fillStyle = totGrad;
      ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '800 18px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('TOTAL TAGIHAN', INNER_X + 20, y + 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 26px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(fmtRp(n.total), INNER_X + INNER_W - 20, y + 36);
      y += 80;

      if (n.isHutang) {
        drawKV('Bayar Awal', fmtRp(n.paid), { step: 30 });
        drawKV('Sisa Hutang', fmtRp(n.remaining), { valColor: '#d97706', bold: true, step: 30 });
      } else {
        drawKV('Jumlah Diterima', fmtRp(n.paid), { step: 30 });
        drawKV('Kembalian', fmtRp(n.change), { valColor: '#059669', bold: true, step: 30 });
      }

      y += 8;
      var stOk = n.statusLabel === 'LUNAS';
      var stText = stOk ? 'LUNAS' : 'BELUM LUNAS (HUTANG)';
      var stW = stOk ? 180 : 280;
      var stX = (W - stW) / 2;
      drawRoundRect(ctx, stX, y, stW, 40, 20);
      ctx.fillStyle = stOk ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.14)';
      ctx.fill();
      ctx.strokeStyle = stOk ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = stOk ? '#047857' : '#b45309';
      ctx.font = '900 17px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(stText, W / 2, y + 26);
      y += 62;
    } else {
      plainLines.forEach(function(pl) {
        if (pl.type === 'div') {
          drawDash(4, 14);
          return;
        }
        var line = pl.text;
        var colonIdx = line.indexOf(':');
        if (colonIdx > 0 && colonIdx < 24 && !/^https?:/i.test(line)) {
          var k = line.slice(0, colonIdx).trim();
          var v = line.slice(colonIdx + 1).trim();
          var isBig = /total|grand|nominal|selisih|saldo akhir/i.test(k);
          drawKV(k, v, {
            bold: isBig,
            size: isBig ? 20 : 17,
            valColor: isBig ? '#4f46e5' : '#0f172a',
            step: isBig ? 34 : 28
          });
        } else {
          ctx.textAlign = 'center';
          ctx.fillStyle = '#1e293b';
          ctx.font = '700 18px "Segoe UI", Arial, sans-serif';
          ctx.fillText(line, W / 2, y);
          y += 28;
        }
      });
      y += 16;
    }

    drawDash(2, 22);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#475569';
    ctx.font = '600 16px "Segoe UI", Arial, sans-serif';
    ctx.fillText(n ? n.noteText : hdr.note, W / 2, y);

    var safeId = n ? n.id.replace(/[^a-zA-Z0-9_-]/g, '') : ('Nota_' + Date.now());
    var pngUrl = '';
    var jpgUrl = '';
    try {
      jpgUrl = canvas.toDataURL('image/jpeg', 0.94);
      pngUrl = canvas.toDataURL('image/png');
    } catch (e) {
      console.error('WebPOSReceipt canvas export error:', e);
      if (!forceNoLogo && logoImg) {
        cachedLogoImg = null;
        return renderReceiptSync(txOrText, customTitle, true);
      }
    }
    return {
      dataUrl: jpgUrl || pngUrl,
      pngDataUrl: pngUrl || jpgUrl,
      jpegDataUrl: jpgUrl || pngUrl,
      width: canvas.width,
      height: canvas.height,
      fileName: 'Nota-' + safeId + '.jpg',
      jpgFileName: 'Nota-' + safeId + '.jpg',
      pdfFileName: 'Nota-' + safeId + '.pdf'
    };
  }

  async function renderCanvasPng(txOrText, customTitle) {
    var hdr = loadStoreHeader();
    if (hdr.logo && (!cachedLogoImg || cachedLogoSrc !== hdr.logo)) {
      await loadImageSafe(hdr.logo);
    }
    return renderReceiptSync(txOrText, customTitle, false);
  }

  function rcptToast(msg, type) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg, type || 'success'); return; }
      if (window.Utils && typeof window.Utils.showToast === 'function') { window.Utils.showToast(msg, type || 'success'); return; }
    } catch (e) {}
  }

  function isAndroidWebView() {
    if (window.AndroidBT || window.AndroidBridge || window.AndroidShare || window.AndroidBrand) return true;
    return /;\s*wv\)/i.test(navigator.userAgent || '');
  }

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  function copyTextSafe(text) {
    var str = String(text || '');
    if (!str) return false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(str).catch(function() {});
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, str.length);
      var ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) { return false; }
  }

  function base64ToUint8(b64) {
    var bstr = atob(b64 || '');
    var len = bstr.length;
    var u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = bstr.charCodeAt(i);
    return u8;
  }

  function uint8ToBase64(u8) {
    var parts = [];
    var chunk = 0x2000;
    for (var i = 0; i < u8.length; i += chunk) {
      var end = Math.min(i + chunk, u8.length);
      var s = '';
      for (var j = i; j < end; j++) s += String.fromCharCode(u8[j]);
      parts.push(s);
    }
    return btoa(parts.join(''));
  }

  function dataUrlToBlob(dataUrl, fallbackMime) {
    var arr = String(dataUrl || '').split(',');
    var mime = (arr[0].match(/:(.*?);/) || [])[1] || fallbackMime || 'image/jpeg';
    return new Blob([base64ToUint8(arr[1] || '')], { type: mime });
  }

  function dataUrlToFile(dataUrl, fileName) {
    var blob = dataUrlToBlob(dataUrl, 'image/jpeg');
    try { return new File([blob], fileName || 'Nota-WebPOS.jpg', { type: blob.type }); }
    catch (e) { return blob; }
  }

  function triggerBlobDownload(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'Nota-WebPOS.jpg';
    a.rel = 'noopener';
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(function() {
      try { a.remove(); } catch (e) {}
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 60000);
  }

  function buildRealPdfFromJpeg(jpegDataUrl, imgW, imgH) {
    var b64 = String(jpegDataUrl || '').split(',')[1] || '';
    var jpgBytes = base64ToUint8(b64);
    if (jpgBytes.length < 4 || jpgBytes[0] !== 0xFF || jpgBytes[1] !== 0xD8) {
      throw new Error('Format gambar JPG tidak valid untuk PDF');
    }
    var w = Math.max(1, Math.round(imgW || 760));
    var h = Math.max(1, Math.round(imgH || 1000));
    var drawW = 320;
    var drawH = Math.max(120, Math.round(drawW * (h / w)));
    var margin = 20;
    var pageW = drawW + margin * 2;
    var pageH = drawH + margin * 2;
    var contentStr = 'q\n' + drawW + ' 0 0 ' + drawH + ' ' + margin + ' ' + margin + ' cm\n/Im0 Do\nQ\n';

    function strU8(str) {
      var out = new Uint8Array(str.length);
      for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
      return out;
    }
    var chunks = [];
    var offset = 0;
    function pushBytes(u8) { chunks.push(u8); offset += u8.length; }
    function pushStr(s) { pushBytes(strU8(s)); }

    pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
    var offsets = [0];
    offsets.push(offset);
    pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    offsets.push(offset);
    pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    offsets.push(offset);
    pushStr('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
    offsets.push(offset);
    pushStr('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpgBytes.length + ' >>\nstream\n');
    pushBytes(jpgBytes);
    pushStr('\nendstream\nendobj\n');
    offsets.push(offset);
    pushStr('5 0 obj\n<< /Length ' + contentStr.length + ' >>\nstream\n' + contentStr + 'endstream\nendobj\n');

    var xrefPos = offset;
    pushStr('xref\n0 6\n0000000000 65535 f \n');
    for (var idx = 1; idx <= 5; idx++) {
      var offStr = String(offsets[idx]);
      while (offStr.length < 10) offStr = '0' + offStr;
      pushStr(offStr + ' 00000 n \n');
    }
    pushStr('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

    var total = new Uint8Array(offset);
    var p = 0;
    for (var k = 0; k < chunks.length; k++) { total.set(chunks[k], p); p += chunks[k].length; }
    return total;
  }

  var lastRenderedMeta = null;

  function ensureReceiptImgModal() {
    ensureUnifiedStyles();
    var bd = document.getElementById('webposReceiptImgModal');
    if (bd) return bd;
    bd = document.createElement('div');
    bd.id = 'webposReceiptImgModal';
    bd.className = 'wp-pop-backdrop';
    bd.innerHTML =
      '<div class="wp-pop-card" style="max-width:430px;" role="dialog" aria-modal="true">' +
        '<div class="wp-pop-head">' +
          '<h3 class="wp-pop-title">' + ICONS_3D.image() + '<span>Nota Digital (JPG / PDF / WA)</span></h3>' +
          '<button type="button" class="wp-pop-close" id="wpRcptImgClose" aria-label="Tutup">' + ICONS_3D.close() + '</button>' +
        '</div>' +
        '<div class="wp-pop-body">' +
          '<div id="wpRcptImgHint" style="display:none;margin-bottom:0.65rem;padding:0.55rem 0.75rem;border-radius:10px;background:#eef2ff;color:#3730a3;font-size:0.76rem;font-weight:600;line-height:1.4;"></div>' +
          '<div class="wp-rcpt-img-stage"><img id="wpRcptImgPreview" alt="Nota Digital"></div>' +
        '</div>' +
        '<div class="wp-pop-foot wp-rcpt-actions-bar">' +
          '<button type="button" class="wp-pop-btn emerald" id="wpRcptImgDownload">' + ICONS_3D.download() + '<span>Simpan JPG</span></button>' +
          '<button type="button" class="wp-pop-btn rose" id="wpRcptImgPdf">' + ICONS_3D.pdf() + '<span>Simpan PDF</span></button>' +
          '<button type="button" class="wp-pop-btn wa" id="wpRcptImgWa">' + ICONS_3D.whatsapp() + '<span>Share WA</span></button>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(bd);
    bd.addEventListener('click', function(e) { if (e.target === bd) bd.classList.remove('open'); });
    document.getElementById('wpRcptImgClose').onclick = function() { bd.classList.remove('open'); };
    document.getElementById('wpRcptImgDownload').onclick = function() { saveJpg(null, null, true); };
    document.getElementById('wpRcptImgPdf').onclick = function() { exportPdf(); };
    document.getElementById('wpRcptImgWa').onclick = function() { shareWhatsApp(); };
    return bd;
  }

  function openReceiptImagePreview(rendered, hintText) {
    var bd = ensureReceiptImgModal();
    var imgEl = document.getElementById('wpRcptImgPreview');
    var hintEl = document.getElementById('wpRcptImgHint');
    if (imgEl && rendered && rendered.jpegDataUrl) imgEl.src = rendered.jpegDataUrl;
    if (hintEl) {
      hintEl.textContent = hintText || '';
      hintEl.style.display = hintText ? 'block' : 'none';
    }
    bd.classList.add('open');
  }

  function ensureWaShareSheet() {
    ensureUnifiedStyles();
    var bd = document.getElementById('webposWaSheet');
    if (bd) return bd;
    bd = document.createElement('div');
    bd.id = 'webposWaSheet';
    bd.className = 'wp-pop-backdrop';
    bd.innerHTML =
      '<div class="wp-pop-card" style="max-width:420px;" role="dialog" aria-modal="true">' +
        '<div class="wp-pop-head">' +
          '<h3 class="wp-pop-title">' + ICONS_3D.whatsapp() + '<span>Kirim Nota ke WhatsApp</span></h3>' +
          '<button type="button" class="wp-pop-close" id="wpWaClose" aria-label="Tutup">' + ICONS_3D.close() + '</button>' +
        '</div>' +
        '<div class="wp-pop-body" style="display:flex;flex-direction:column;gap:0.65rem;">' +
          '<div style="font-size:0.78rem;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;padding:0.5rem 0.7rem;border-radius:10px;font-weight:600;">Teks nota sudah disalin otomatis! Pilih cara kirim di bawah atau langsung tempel (Paste) di WhatsApp.</div>' +
          '<div>' +
            '<label style="display:block;font-size:0.74rem;font-weight:700;color:#475569;margin-bottom:0.25rem;">Nomor WhatsApp Tujuan (Opsional)</label>' +
            '<input type="tel" id="wpWaPhoneInput" placeholder="Contoh: 081234567890" style="width:100%;padding:0.55rem 0.75rem;border:1px solid #cbd5e1;border-radius:10px;font-size:0.86rem;box-sizing:border-box;">' +
          '</div>' +
          '<pre id="wpWaTextPreview" style="margin:0;max-height:175px;overflow:auto;padding:0.65rem;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;font-family:\'Courier New\',monospace;font-size:0.72rem;line-height:1.4;white-space:pre-wrap;color:#0f172a;"></pre>' +
        '</div>' +
        '<div class="wp-pop-foot" style="display:flex;flex-wrap:wrap;gap:0.45rem;justify-content:stretch;">' +
          '<a id="wpWaAppLink" href="#" rel="noopener" class="wp-pop-btn wa" style="flex:1 1 46%;text-decoration:none;justify-content:center;">' + ICONS_3D.whatsapp() + '<span>Buka App WA</span></a>' +
          '<a id="wpWaWebLink" href="#" target="_blank" rel="noopener noreferrer" class="wp-pop-btn emerald" style="flex:1 1 46%;text-decoration:none;justify-content:center;"><span>Link wa.me</span></a>' +
          '<button type="button" id="wpWaCopyBtn" class="wp-pop-btn" style="flex:1 1 46%;background:#e2e8f0;color:#0f172a;"><span>Salin Teks Nota</span></button>' +
          '<button type="button" id="wpWaShowImgBtn" class="wp-pop-btn rose" style="flex:1 1 46%;">' + ICONS_3D.image() + '<span>Lihat Gambar</span></button>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(bd);
    bd.addEventListener('click', function(e) { if (e.target === bd) bd.classList.remove('open'); });
    document.getElementById('wpWaClose').onclick = function() { bd.classList.remove('open'); };
    return bd;
  }

  function openWaShareSheet(plainText, waPhone, rendered) {
    var bd = ensureWaShareSheet();
    var phoneInp = document.getElementById('wpWaPhoneInput');
    var prevEl = document.getElementById('wpWaTextPreview');
    var appLink = document.getElementById('wpWaAppLink');
    var webLink = document.getElementById('wpWaWebLink');
    var copyBtn = document.getElementById('wpWaCopyBtn');
    var imgBtn = document.getElementById('wpWaShowImgBtn');
    var safeText = String(plainText || '').slice(0, 3200);
    if (prevEl) prevEl.textContent = safeText;
    if (phoneInp) phoneInp.value = waPhone || '';

    function syncLinks() {
      var ph = normalizeWaPhone(phoneInp ? phoneInp.value : waPhone);
      var enc = encodeURIComponent(safeText);
      if (appLink) appLink.href = 'whatsapp://send?' + (ph ? ('phone=' + ph + '&') : '') + 'text=' + enc;
      if (webLink) webLink.href = 'https://wa.me/' + (ph || '') + '?text=' + enc;
    }
    syncLinks();
    if (phoneInp) phoneInp.oninput = syncLinks;
    if (copyBtn) copyBtn.onclick = function() {
      copyTextSafe(safeText);
      rcptToast('Teks nota berhasil disalin! Tinggal tempel di WhatsApp.', 'success');
    };
    if (imgBtn) imgBtn.onclick = function() {
      bd.classList.remove('open');
      if (rendered && rendered.jpegDataUrl) {
        openReceiptImagePreview(rendered, 'Tekan & tahan gambar nota untuk simpan/kirim ke WhatsApp.');
      }
    };
    bd.classList.add('open');
  }

  function getActiveReceiptSource() {
    var paper = document.getElementById('strukPaper');
    var paperText = paper ? (paper.textContent || '').trim() : '';
    if (currentReceiptTx && (!paperText || paperText === currentReceiptText)) {
      return { src: currentReceiptTx, title: null, plain: currentReceiptText || buildPlain(currentReceiptTx) };
    }
    if (paperText) {
      var titleEl = document.querySelector('#strukModal .struk-modal-title, #strukModal .modal-title, #strukModal .struk-header h3');
      var titleTxt = titleEl ? titleEl.textContent.trim().toUpperCase() : 'BUKTI TRANSAKSI';
      return { src: paperText, title: titleTxt, plain: paperText };
    }
    if (currentReceiptTx) return { src: currentReceiptTx, title: null, plain: buildPlain(currentReceiptTx) };
    if (currentReceiptText) return { src: currentReceiptText, title: 'BUKTI TRANSAKSI', plain: currentReceiptText };
    return null;
  }

  function buildReceiptPlainText(target) {
    if (!target) return '';
    if (target.plain) return target.plain;
    if (target.src && typeof target.src === 'object') return buildPlain(target.src);
    return String(target.src || '');
  }

  function normalizeWaPhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('0') === 0) d = '62' + d.slice(1);
    return d.length >= 10 ? d : '';
  }

  function isBridgeSuccess(res) {
    if (res === true || res === 'OK' || res === undefined) return true;
    if (res === false) return false;
    var s = String(res).trim().toUpperCase();
    return s === 'OK' || s.indexOf('OK') === 0 || s === 'SUCCESS' || s === 'TRUE';
  }

  function saveJpg(txOrText, customTitle, forceDirectDownload) {
    var target = txOrText != null ? { src: txOrText, title: customTitle } : getActiveReceiptSource();
    if (!target) { rcptToast('Data nota tidak ditemukan', 'error'); return; }
    try {
      var rendered = renderReceiptSync(target.src, target.title, false);
      lastRenderedPng = rendered.jpegDataUrl;
      lastRenderedName = rendered.jpgFileName;
      lastRenderedMeta = rendered;
      if (!rendered.jpegDataUrl) { rcptToast('Gagal membuat gambar JPG nota', 'error'); return; }

      var b64 = rendered.jpegDataUrl.split(',')[1] || '';
      if (window.AndroidBT && typeof window.AndroidBT.saveImage === 'function') {
        if (isBridgeSuccess(window.AndroidBT.saveImage(b64, rendered.jpgFileName))) {
          rcptToast('Nota JPG tersimpan di HP (' + rendered.jpgFileName + ')', 'success');
          return;
        }
      }
      if (window.AndroidBT && typeof window.AndroidBT.saveFile === 'function') {
        if (isBridgeSuccess(window.AndroidBT.saveFile(b64, rendered.jpgFileName, 'image/jpeg'))) {
          rcptToast('Nota JPG tersimpan di HP (' + rendered.jpgFileName + ')', 'success');
          return;
        }
      }
      if (window.AndroidShare && typeof window.AndroidShare.shareImage === 'function') {
        window.AndroidShare.shareImage(rendered.jpegDataUrl, rendered.jpgFileName);
        rcptToast('Membuka penyimpanan / share JPG...', 'success');
        return;
      }

      var blob = dataUrlToBlob(rendered.jpegDataUrl, 'image/jpeg');
      if (isAndroidWebView() && !forceDirectDownload) {
        if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
          var jpgFile = dataUrlToFile(rendered.jpegDataUrl, rendered.jpgFileName);
          if (navigator.canShare({ files: [jpgFile] })) {
            navigator.share({ files: [jpgFile], title: rendered.jpgFileName }).catch(function(err) {
              if (!err || err.name !== 'AbortError') {
                openReceiptImagePreview(rendered, 'Di APK Android, tekan & tahan gambar untuk Simpan ke Galeri HP — atau klik Simpan PDF untuk langsung masuk folder Downloads.');
              }
            });
            return;
          }
        }
        openReceiptImagePreview(rendered, 'Di APK Android, tekan & tahan gambar untuk Simpan ke Galeri HP — atau klik Simpan PDF untuk langsung masuk folder Downloads.');
        return;
      }

      triggerBlobDownload(blob, rendered.jpgFileName);
      rcptToast('Mengunduh ' + rendered.jpgFileName + '...', 'success');
    } catch (err) {
      console.error('saveJpg error:', err);
      rcptToast('Gagal menyimpan JPG: ' + (err && err.message ? err.message : 'Error'), 'error');
    }
  }

  function shareImage(txOrText, customTitle) {
    return saveJpg(txOrText, customTitle);
  }

  function exportPdf(txOrText, customTitle) {
    var target = txOrText != null ? { src: txOrText, title: customTitle } : getActiveReceiptSource();
    if (!target) { rcptToast('Data nota tidak ditemukan', 'error'); return; }
    try {
      var rendered = renderReceiptSync(target.src, target.title, false);
      lastRenderedPng = rendered.jpegDataUrl;
      lastRenderedName = rendered.pdfFileName;
      lastRenderedMeta = rendered;
      if (!rendered.jpegDataUrl) { rcptToast('Gagal membuat file PDF nota', 'error'); return; }

      var pdfBytes = buildRealPdfFromJpeg(rendered.jpegDataUrl, rendered.width, rendered.height);
      if (window.AndroidBT && typeof window.AndroidBT.savePdf === 'function') {
        var pdfB64 = uint8ToBase64(pdfBytes);
        var res = window.AndroidBT.savePdf(pdfB64, rendered.pdfFileName);
        if (isBridgeSuccess(res)) {
          rcptToast('Nota PDF tersimpan di folder Downloads HP (' + rendered.pdfFileName + ')', 'success');
          return;
        }
        rcptToast('Gagal simpan PDF di APK: ' + String(res), 'error');
      }

      var pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      if (isAndroidWebView() && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
        try {
          var pdfFile = new File([pdfBlob], rendered.pdfFileName, { type: 'application/pdf' });
          if (navigator.canShare({ files: [pdfFile] })) {
            navigator.share({ files: [pdfFile], title: rendered.pdfFileName }).catch(function() {});
            return;
          }
        } catch (e) {}
      }

      triggerBlobDownload(pdfBlob, rendered.pdfFileName);
      rcptToast('Mengunduh ' + rendered.pdfFileName + '...', 'success');
    } catch (err) {
      console.error('exportPdf error:', err);
      rcptToast('Gagal menyimpan PDF: ' + (err && err.message ? err.message : 'Error'), 'error');
    }
  }

  function openWhatsAppFallback(plainText, waPhone, rendered) {
    var safeText = String(plainText || '').slice(0, 3200);
    copyTextSafe(safeText);
    if (isAndroidWebView()) { openWaShareSheet(safeText, waPhone, rendered); return; }

    var waMeUrl = 'https://wa.me/' + (waPhone || '') + '?text=' + encodeURIComponent(safeText);
    if (isMobileDevice()) {
      window.location.href = waMeUrl;
      rcptToast('Membuka WhatsApp...', 'success');
      return;
    }

    var a = document.createElement('a');
    a.href = waMeUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(function() { try { a.remove(); } catch (e) {} }, 1000);
    rcptToast('Membuka WhatsApp dengan rincian nota...', 'success');
  }

  function shareWhatsApp(txOrText, customTitle) {
    var target = txOrText != null ? { src: txOrText, title: customTitle } : getActiveReceiptSource();
    if (!target) { rcptToast('Data nota tidak ditemukan', 'error'); return; }
    var plainText = buildReceiptPlainText(target);
    var rawPhone = (target.src && typeof target.src === 'object')
      ? (target.src.customerPhone || target.src.phone || target.src.noHp || target.src.whatsapp || '')
      : '';
    var waPhone = normalizeWaPhone(rawPhone);
    copyTextSafe(plainText);

    var rendered = null;
    try {
      rendered = renderReceiptSync(target.src, target.title, false);
      lastRenderedPng = rendered.jpegDataUrl;
      lastRenderedName = rendered.jpgFileName;
      lastRenderedMeta = rendered;
    } catch (e) { console.error('shareWhatsApp render error:', e); }

    if (rendered && rendered.jpegDataUrl) {
      var b64 = rendered.jpegDataUrl.split(',')[1] || '';
      if (window.AndroidShare && typeof window.AndroidShare.shareImage === 'function') {
        try { window.AndroidShare.shareImage(rendered.jpegDataUrl, rendered.jpgFileName); rcptToast('Pilih WhatsApp untuk kirim nota JPG', 'success'); return; } catch (e) {}
      }
      if (window.AndroidBT && typeof window.AndroidBT.shareImage === 'function') {
        try { window.AndroidBT.shareImage(b64, rendered.jpgFileName); rcptToast('Pilih WhatsApp untuk kirim nota JPG', 'success'); return; } catch (e) {}
      }
    }
    if (window.AndroidBT && typeof window.AndroidBT.shareWhatsApp === 'function') {
      try { window.AndroidBT.shareWhatsApp(plainText, waPhone); return; } catch (e) {}
    }

    if (rendered && rendered.jpegDataUrl && typeof navigator.share === 'function') {
      try {
        var jpgFile = dataUrlToFile(rendered.jpegDataUrl, rendered.jpgFileName);
        if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [jpgFile] })) {
          navigator.share({ files: [jpgFile], title: 'Nota Transaksi' })
            .then(function() { rcptToast('Nota JPG berhasil dibagikan!', 'success'); })
            .catch(function(err) {
              if (err && err.name === 'AbortError') return;
              openWhatsAppFallback(plainText, waPhone, rendered);
            });
          return;
        }
      } catch (e) {}
    }

    openWhatsAppFallback(plainText, waPhone, rendered);
  }
  
  function openPreview(txOrText, titleText) {
    ensureUnifiedStyles();
    var isObj = txOrText && typeof txOrText === 'object';
    var plain = isObj ? buildPlain(txOrText) : String(txOrText || '');
    if (isObj) {
      currentReceiptTx = txOrText;
      currentReceiptText = plain.trim();
    } else {
      currentReceiptTx = null;
      currentReceiptText = plain.trim();
    }

    var bd = document.getElementById('webposUnifiedPreviewModal');
    if (!bd) {
      bd = document.createElement('div');
      bd.id = 'webposUnifiedPreviewModal';
      bd.className = 'wp-pop-backdrop';
      bd.innerHTML =
        '<div class="wp-pop-card" style="max-width:420px;" role="dialog" aria-modal="true">' +
          '<div class="wp-pop-head">' +
            '<h3 class="wp-pop-title" id="wpPrevTitle">' + ICONS_3D.receipt() + '<span>Preview Struk</span></h3>' +
            '<button type="button" class="wp-pop-close" id="wpPrevClose" aria-label="Tutup">' + ICONS_3D.close() + '</button>' +
          '</div>' +
          '<div class="wp-pop-body" style="background:var(--bg-subtle,#f8fafc);">' +
            '<pre id="wpPrevPaper" style="margin:0;padding:1rem;background:#fff;color:#0f172a;border-radius:12px;border:1px dashed #cbd5e1;font-family:\'Courier New\',monospace;font-size:0.78rem;line-height:1.45;white-space:pre-wrap;overflow-x:auto;"></pre>' +
          '</div>' +
          '<div class="wp-pop-foot wp-rcpt-actions-bar">' +
            '<button type="button" class="wp-pop-btn emerald" id="wpPrevImgBtn">' + ICONS_3D.image() + '<span>Simpan JPG</span></button>' +
            '<button type="button" class="wp-pop-btn rose" id="wpPrevPdfBtn">' + ICONS_3D.pdf() + '<span>Simpan PDF</span></button>' +
            '<button type="button" class="wp-pop-btn wa" id="wpPrevWaBtn">' + ICONS_3D.whatsapp() + '<span>Share WA</span></button>' +
          '</div>' +
        '</div>';
      (document.body || document.documentElement).appendChild(bd);
      bd.addEventListener('click', function(e) { if (e.target === bd) bd.classList.remove('open'); });
      document.getElementById('wpPrevClose').onclick = function() { bd.classList.remove('open'); };
      document.getElementById('wpPrevImgBtn').onclick = function() {
        saveJpg(currentReceiptTx || currentReceiptText, bd.dataset.rcptTitle || 'BUKTI TRANSAKSI');
      };
      document.getElementById('wpPrevPdfBtn').onclick = function() {
        exportPdf(currentReceiptTx || currentReceiptText, bd.dataset.rcptTitle || 'BUKTI TRANSAKSI');
      };
      document.getElementById('wpPrevWaBtn').onclick = function() {
        shareWhatsApp(currentReceiptTx || currentReceiptText, bd.dataset.rcptTitle || 'BUKTI TRANSAKSI');
      };
    }
    bd.dataset.rcptTitle = titleText || 'BUKTI TRANSAKSI';
    var tSpan = document.querySelector('#wpPrevTitle span');
    if (tSpan) tSpan.textContent = titleText || 'Preview Struk';
    var paperEl = document.getElementById('wpPrevPaper');
    if (paperEl) paperEl.textContent = plain;
    bd.classList.add('open');
  }

  function enhanceStrukModals() {
    ensureUnifiedStyles();
    var modal = document.getElementById('strukModal');
    if (!modal || modal.dataset.wpReceiptEnhanced === '1') return;
    var footer = modal.querySelector('.struk-actions, .struk-footer, .modal-footer');
    if (!footer) return;
    modal.dataset.wpReceiptEnhanced = '1';
    footer.classList.add('wp-rcpt-actions-bar');

    var btnImg = document.createElement('button');
    btnImg.type = 'button';
    btnImg.className = 'btn btn-sm wp-rcpt-btn-img';
    btnImg.id = 'btnWpShareNotaImg';
    btnImg.innerHTML = ICONS_3D.image() + '<span>Simpan JPG</span>';
    btnImg.onclick = function() { saveJpg(); };

    var btnPdf = document.createElement('button');
    btnPdf.type = 'button';
    btnPdf.className = 'btn btn-sm wp-rcpt-btn-pdf';
    btnPdf.id = 'btnWpSaveNotaPdf';
    btnPdf.innerHTML = ICONS_3D.pdf() + '<span>Simpan PDF</span>';
    btnPdf.onclick = function() { exportPdf(); };

    var btnWa = document.createElement('button');
    btnWa.type = 'button';
    btnWa.className = 'btn btn-sm wp-rcpt-btn-wa';
    btnWa.id = 'btnWpShareNotaWa';
    btnWa.innerHTML = ICONS_3D.whatsapp() + '<span>Share WA</span>';
    btnWa.onclick = function() { shareWhatsApp(); };

    footer.appendChild(btnImg);
    footer.appendChild(btnPdf);
    footer.appendChild(btnWa);
  }

  window.WebPOSReceipt = {
    setCurrentTx: function(tx, plainText) {
      currentReceiptTx = tx || null;
      currentReceiptText = plainText ? String(plainText).trim() : (tx ? buildPlain(tx).trim() : '');
    },
    clearCurrentTx: function() {
      currentReceiptTx = null;
      currentReceiptText = '';
    },
    normalizeTx: normalizeTx,
    buildPlain: buildPlain,
    buildEscPos: buildEscPos,
    renderCanvasPng: renderCanvasPng,
    saveJpg: saveJpg,
    shareImage: shareImage,
    exportPdf: exportPdf,
    shareWhatsApp: shareWhatsApp,
    openPreview: openPreview,
    enhanceStrukModals: enhanceStrukModals
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceStrukModals);
  } else {
    enhanceStrukModals();
  }
})();

// 11. GLOBAL 3D SIDEBAR USER PROFILE POPUP (KLIK AVATAR / NAMA DI SIDEBAR KIRI)
(function() {
  if (window.__webposUserProfileInit) return;
  window.__webposUserProfileInit = true;

  var profSeq = 0;
  function mkProf3d(svgInner, size) {
    profSeq++;
    var sz = size || 20;
    return '<svg class="wp-3d-native-icon" style="width:' + sz + 'px;height:' + sz + 'px;flex-shrink:0;" viewBox="0 0 48 48" fill="none">' +
      svgInner.replace(/__ID__/g, 'wpp_' + profSeq + '_') + '</svg>';
  }
  var P_ICONS = {
    shield: function(sz) { return mkProf3d('<defs><linearGradient id="__ID__g" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34D399"/><stop offset="100%" stop-color="#059669"/></linearGradient></defs><path d="M24 5L39 11V23C39 33 32.5 40 24 43C15.5 40 9 33 9 23V11L24 5Z" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M17 24L22 29L32 18.5" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>', sz); },
    mail: function(sz) { return mkProf3d('<defs><linearGradient id="__ID__g" x1="6" y1="10" x2="42" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60A5FA"/><stop offset="100%" stop-color="#2563EB"/></linearGradient></defs><rect x="5" y="10" width="38" height="28" rx="7" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M8 14L24 26L40 14" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>', sz); },
    phone: function(sz) { return mkProf3d('<defs><linearGradient id="__ID__g" x1="10" y1="5" x2="38" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#4ADE80"/><stop offset="100%" stop-color="#16A34A"/></linearGradient></defs><rect x="12" y="5" width="24" height="38" rx="6" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><rect x="16" y="10" width="16" height="22" rx="2.5" fill="#DCFCE7"/><circle cx="24" cy="37" r="2.2" fill="#FFFFFF"/>', sz); },
    badge: function(sz) { return mkProf3d('<defs><linearGradient id="__ID__g" x1="6" y1="8" x2="42" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FBBF24"/><stop offset="100%" stop-color="#D97706"/></linearGradient></defs><rect x="6" y="10" width="36" height="28" rx="7" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><circle cx="17" cy="24" r="4.5" fill="#FFFFFF"/><rect x="25" y="19" width="12" height="3.2" rx="1.6" fill="#FFFFFF"/><rect x="25" y="25.5" width="9" height="3" rx="1.5" fill="#FEF3C7"/>', sz); },
    clock: function(sz) { return mkProf3d('<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#A78BFA"/><stop offset="100%" stop-color="#6D28D9"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><path d="M24 14V24L31 28" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>', sz); },
    edit: function(sz) { return mkProf3d('<defs><linearGradient id="__ID__g" x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0284C7"/></linearGradient></defs><rect x="6" y="6" width="36" height="36" rx="10" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.5"/><path d="M16 32L18 25L29 14L34 19L23 30L16 32Z" fill="#FFFFFF"/>', sz); },
    close: function(sz) { return mkProf3d('<defs><linearGradient id="__ID__g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FB7185"/><stop offset="100%" stop-color="#E11D48"/></linearGradient></defs><circle cx="24" cy="24" r="19" fill="url(#__ID__g)" stroke="#FFFFFF" stroke-width="1.6"/><ellipse cx="24" cy="13" rx="11" ry="4.5" fill="#FFFFFF" fill-opacity="0.32"/><path d="M17 17L31 31M31 17L17 31" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round"/>', sz || 25); }
  };

  function ensureProfileStyles() {
    if (document.getElementById('webpos-user-profile-style')) return;
    var st = document.createElement('style');
    st.textContent = [
      '.user-profile{cursor:pointer !important;border-radius:12px;transition:background .18s ease,transform .15s ease;}',
      '.user-profile:hover{background:var(--primary-light,rgba(99,102,241,0.09));}',
      '.user-profile:active{transform:scale(0.98);}',
      '#webposUserProfileModal{position:fixed;inset:0;z-index:100020;background:rgba(15,23,42,0.58);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;padding:16px;}',
      '#webposUserProfileModal.open{display:flex;}',
      '.wpp-card{width:100%;max-width:410px;background:var(--bg-surface,var(--bg-card,#ffffff));color:var(--text-main,var(--text-primary,#0f172a));border:1px solid var(--border,var(--border-color,rgba(148,163,184,0.28)));border-radius:20px;box-shadow:0 24px 55px rgba(15,23,42,0.34);overflow:hidden;font-family:inherit;animation:wppPop .18s ease-out;}',
      '@keyframes wppPop{from{opacity:0;transform:scale(0.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}',
      '.wpp-head{position:relative;padding:20px 18px 16px;background:linear-gradient(135deg,var(--primary,#4f46e5) 0%,var(--primary-hover,var(--primary-dark,#4338ca)) 100%);color:#fff;display:flex;align-items:center;gap:14px;}',
      '.wpp-avatar{width:56px;height:56px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.35rem;font-weight:800;color:#fff;background:radial-gradient(circle at 30% 25%,rgba(255,255,255,0.42),rgba(15,23,42,0.28));border:2.5px solid rgba(255,255,255,0.88);box-shadow:0 8px 18px rgba(15,23,42,0.28);}',
      '.wpp-close{position:absolute;top:12px;right:12px;background:transparent;border:none;padding:2px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:transform .16s ease;}',
      '.wpp-close:hover{transform:scale(1.12);}',
      '.wpp-status-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:0.7rem;font-weight:800;letter-spacing:0.02em;margin-top:5px;}',
      '.wpp-body{padding:14px 16px;display:flex;flex-direction:column;gap:9px;max-height:62vh;overflow-y:auto;}',
      '.wpp-row{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:12px;background:var(--bg-subtle,var(--bg-secondary,#f8fafc));border:1px solid var(--border,var(--border-color,rgba(148,163,184,0.22)));}',
      '.wpp-lbl{font-size:0.68rem;color:var(--text-muted,#64748b);font-weight:600;line-height:1.2;}',
      '.wpp-val{font-size:0.83rem;font-weight:700;color:var(--text-main,var(--text-primary,#0f172a));word-break:break-word;margin-top:1px;}',
      '.wpp-edit-box{padding:11px;border-radius:12px;background:var(--bg-subtle,var(--bg-secondary,#f8fafc));border:1.5px solid var(--primary,#4f46e5);display:none;flex-direction:column;gap:8px;}',
      '.wpp-edit-box.open{display:flex;}',
      '.wpp-input{width:100%;padding:8px 10px;border-radius:9px;border:1px solid var(--border,var(--border-color,#cbd5e1));background:var(--bg-surface,var(--bg-card,#ffffff));color:var(--text-main,var(--text-primary,#0f172a));font-size:0.83rem;font-family:inherit;box-sizing:border-box;outline:none;}',
      '.wpp-input:focus{border-color:var(--primary,#4f46e5);}',
      '.wpp-foot{padding:11px 16px 14px;border-top:1px solid var(--border,var(--border-color,rgba(148,163,184,0.22)));display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--bg-surface,var(--bg-card,#ffffff));}',
      '.wpp-btn{border:none;border-radius:11px;padding:8px 13px;font-size:0.8rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;transition:transform .15s ease,filter .15s ease;}',
      '.wpp-btn:active{transform:scale(0.97);}',
      '.wpp-btn-sec{background:var(--bg-subtle,var(--bg-secondary,#f1f5f9));color:var(--text-main,var(--text-primary,#0f172a));border:1px solid var(--border,var(--border-color,rgba(148,163,184,0.3)));}',
      '.wpp-btn-pri{background:linear-gradient(135deg,var(--primary,#4f46e5),var(--primary-hover,var(--primary-dark,#4338ca)));color:#fff;box-shadow:0 4px 12px rgba(15,23,42,0.2);}',
      '.wpp-btn-pri:hover{filter:brightness(1.06);}',
      '[data-theme="dark"] .wpp-card,[data-theme="midnight"] .wpp-card,[data-theme="oled"] .wpp-card{background:var(--bg-surface,var(--bg-card,#111827));color:var(--text-main,var(--text-primary,#f8fafc));border-color:var(--border,var(--border-color,#2e384d));}',
      '[data-theme="dark"] .wpp-row,[data-theme="dark"] .wpp-edit-box,[data-theme="dark"] .wpp-btn-sec,[data-theme="midnight"] .wpp-row,[data-theme="oled"] .wpp-row{background:var(--bg-subtle,var(--bg-secondary,#1e293b));}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDateVal(v) {
    if (!v) return '-';
    try {
      var d = (typeof v.toDate === 'function') ? v.toDate() : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return '-'; }
  }

  function closeProfileModal() {
    var m = document.getElementById('webposUserProfileModal');
    if (m) m.classList.remove('open');
  }

  async function openProfileModal() {
    ensureProfileStyles();
    var m = document.getElementById('webposUserProfileModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'webposUserProfileModal';
      m.addEventListener('click', function(e) { if (e.target === m) closeProfileModal(); });
      document.body.appendChild(m);
    }

    var authUser = (window.firebase && firebase.auth) ? firebase.auth().currentUser : null;
    var domName = (document.getElementById('userName') && document.getElementById('userName').textContent || '').trim();
    var domRole = (document.getElementById('userRole') && document.getElementById('userRole').textContent || '').trim();
    var appVer = '';
    try { appVer = localStorage.getItem('webpos_app_version') || ''; } catch (e) {}

    var uData = {};
    if (authUser && authUser.uid && window.firebase && firebase.firestore) {
      try {
        var snap = await firebase.firestore().collection('users').doc(authUser.uid).get();
        if (snap.exists) uData = snap.data() || {};
      } catch (e) {}
    }

    var fullName = uData.name || uData.fullName || (authUser && authUser.displayName) || domName || 'Pengguna';
    var username = uData.username || '';
    var role = String(uData.role || domRole || 'kasir').toUpperCase();
    var rawStatus = String(uData.status || 'active').toLowerCase();
    var statusLabel = rawStatus === 'active' ? 'Aktif' : (rawStatus === 'pending' ? 'Menunggu Persetujuan' : rawStatus.toUpperCase());
    var statusBg = rawStatus === 'active' ? 'rgba(16,185,129,0.22)' : 'rgba(245,158,11,0.24)';
    var statusClr = rawStatus === 'active' ? '#a7f3d0' : '#fde68a';
    var email = uData.email || (authUser && authUser.email) || '-';
    var phone = uData.phone || uData.noHp || uData.no_hp || uData.hp || uData.whatsapp || (authUser && authUser.phoneNumber) || '';
    var uid = (authUser && authUser.uid) || '-';
    var lastLogin = (authUser && authUser.metadata && authUser.metadata.lastSignInTime) ? fmtDateVal(authUser.metadata.lastSignInTime) : fmtDateVal(uData.lastLogin);
    var initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(function(w) { return w[0]; }).join('').toUpperCase() || 'U';

    m.innerHTML =
      '<div class="wpp-card" role="dialog" aria-modal="true">' +
        '<div class="wpp-head">' +
          '<div class="wpp-avatar">' + esc(initials) + '</div>' +
          '<div style="min-width:0;flex:1;padding-right:28px;">' +
            '<div style="font-size:1.02rem;font-weight:800;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(fullName) + '</div>' +
            (username ? '<div style="font-size:0.74rem;opacity:0.86;margin-top:1px;">@' + esc(username) + '</div>' : '') +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
              '<span class="wpp-status-pill" style="background:rgba(255,255,255,0.2);color:#fff;">' + esc(role) + '</span>' +
              '<span class="wpp-status-pill" style="background:' + statusBg + ';color:' + statusClr + ';">● ' + esc(statusLabel) + '</span>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="wpp-close" id="wppCloseBtn" aria-label="Tutup">' + P_ICONS.close(26) + '</button>' +
        '</div>' +
        '<div class="wpp-body">' +
          '<div class="wpp-row">' + P_ICONS.mail(22) + '<div style="min-width:0;flex:1;"><div class="wpp-lbl">Email Akun</div><div class="wpp-val">' + esc(email) + '</div></div></div>' +
          '<div class="wpp-row">' + P_ICONS.phone(22) + '<div style="min-width:0;flex:1;"><div class="wpp-lbl">Nomor HP / WhatsApp</div><div class="wpp-val" id="wppPhoneText">' + esc(phone || 'Belum diisi') + '</div></div></div>' +
          '<div class="wpp-row">' + P_ICONS.shield(22) + '<div style="min-width:0;flex:1;"><div class="wpp-lbl">Status &amp; Hak Akses</div><div class="wpp-val">' + esc(statusLabel + ' • ' + role) + '</div></div></div>' +
          '<div class="wpp-row">' + P_ICONS.badge(22) + '<div style="min-width:0;flex:1;"><div class="wpp-lbl">UID Akun' + (appVer ? ' • Versi ' + esc(appVer) : '') + '</div><div class="wpp-val" style="font-family:monospace;font-size:0.74rem;">' + esc(uid) + '</div></div></div>' +
          '<div class="wpp-row">' + P_ICONS.clock(22) + '<div style="min-width:0;flex:1;"><div class="wpp-lbl">Login Terakhir</div><div class="wpp-val">' + esc(lastLogin) + '</div></div></div>' +
          '<div class="wpp-edit-box" id="wppEditBox">' +
            '<div style="font-size:0.75rem;font-weight:800;color:var(--primary,#4f46e5);">Perbarui Data Profil</div>' +
            '<input type="text" class="wpp-input" id="wppEditName" placeholder="Nama Lengkap" value="' + esc(fullName) + '">' +
            '<input type="tel" class="wpp-input" id="wppEditPhone" placeholder="Nomor HP / WA (contoh: 0812xxxx)" value="' + esc(phone) + '">' +
            '<div style="display:flex;justify-content:flex-end;gap:6px;">' +
              '<button type="button" class="wpp-btn wpp-btn-sec" id="wppCancelEdit">Batal</button>' +
              '<button type="button" class="wpp-btn wpp-btn-pri" id="wppSaveEdit">Simpan Profil</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="wpp-foot">' +
          (authUser ? '<button type="button" class="wpp-btn wpp-btn-sec" id="wppToggleEdit">' + P_ICONS.edit(17) + '<span>Edit HP / Nama</span></button>' : '<span></span>') +
          '<button type="button" class="wpp-btn wpp-btn-pri" id="wppFooterClose">Tutup</button>' +
        '</div>' +
      '</div>';

    m.classList.add('open');

    var cBtn = document.getElementById('wppCloseBtn');
    var fClose = document.getElementById('wppFooterClose');
    if (cBtn) cBtn.onclick = closeProfileModal;
    if (fClose) fClose.onclick = closeProfileModal;

    var tEdit = document.getElementById('wppToggleEdit');
    var eBox = document.getElementById('wppEditBox');
    var cEdit = document.getElementById('wppCancelEdit');
    var sEdit = document.getElementById('wppSaveEdit');
    if (tEdit && eBox) tEdit.onclick = function() { eBox.classList.toggle('open'); };
    if (cEdit && eBox) cEdit.onclick = function() { eBox.classList.remove('open'); };
    if (sEdit && authUser) {
      sEdit.onclick = async function() {
        var newName = (document.getElementById('wppEditName').value || '').trim();
        var newPhone = (document.getElementById('wppEditPhone').value || '').trim();
        if (!newName) return;
        sEdit.disabled = true;
        sEdit.textContent = 'Menyimpan...';
        try {
          await firebase.firestore().collection('users').doc(authUser.uid).set({
            name: newName,
            phone: newPhone,
            noHp: newPhone,
            updatedAt: Date.now()
          }, { merge: true });
          var unEl = document.getElementById('userName');
          if (unEl) unEl.textContent = newName;
          openProfileModal();
        } catch (err) {
          sEdit.disabled = false;
          sEdit.textContent = 'Simpan Profil';
        }
      };
    }
  }

  function bindSidebarProfileClick() {
    ensureProfileStyles();
    document.querySelectorAll('.user-profile').forEach(function(el) {
      if (el.dataset.wppBound === '1') return;
      el.dataset.wppBound = '1';
      el.title = 'Klik untuk lihat profil akun';
      el.addEventListener('click', function(e) {
        if (e.target && e.target.closest && e.target.closest('button, a')) return;
        openProfileModal();
      });
    });
  }

  window.WebPOSUserProfile = { open: openProfileModal, close: closeProfileModal };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSidebarProfileClick);
  } else {
    bindSidebarProfileClick();
  }
})();

// 12. SIMULASI ROLE KHUSUS DEVELOPER (CEK TAMPILAN OWNER / ADMIN / KASIR TANPA LOGOUT)
(function() {
  if (window.__webposDevRoleSimInit) return;
  window.__webposDevRoleSimInit = true;

  var SIM_KEY = 'webpos_dev_sim_role';
  var VALID_SIM = { owner: 1, admin: 1, kasir: 1 };

  window.getDevSimRole = function() {
    try {
      var r = String(sessionStorage.getItem(SIM_KEY) || '').toLowerCase();
      return VALID_SIM[r] ? r : '';
    } catch (e) { return ''; }
  };

  window.isDevRoleSimActive = function() {
    return !!window.getDevSimRole();
  };

  window.getEffectiveUserRole = function(realRole) {
    var rr = String(realRole || 'kasir').toLowerCase();
    if (rr !== 'developer') {
      try { sessionStorage.removeItem(SIM_KEY); } catch (e) {}
      return rr;
    }
    var sim = window.getDevSimRole();
    return sim || 'developer';
  };

  window.setDevSimRole = function(targetRole) {
    if (window.__webposRealRole !== 'developer') return;
    var r = String(targetRole || '').toLowerCase();
    try {
      if (VALID_SIM[r]) {
        sessionStorage.setItem(SIM_KEY, r);
      } else {
        sessionStorage.removeItem(SIM_KEY);
      }
    } catch (e) {}
    window.location.reload();
  };

  function injectSimStyles() {
    if (document.getElementById('webpos-dev-sim-style')) return;
    var st = document.createElement('style');
    st.id = 'webpos-dev-sim-style';
    st.textContent = [
      '#webposDevRoleSimBar{position:fixed;right:0;top:42%;transform:translateY(-50%);z-index:950;font-family:inherit;display:flex;align-items:center;gap:8px;touch-action:none;}',
      '.wds-toggle{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:7px 6px 7px 8px;border-radius:14px 0 0 14px;border:1.5px solid var(--primary,#4f46e5);border-right:none;background:var(--bg-surface,var(--bg-card,#ffffff));color:var(--text-main,var(--text-primary,#0f172a));font-size:0.62rem;font-weight:800;letter-spacing:0.03em;cursor:pointer;box-shadow:-4px 4px 16px rgba(15,23,42,0.18);opacity:0.86;transition:opacity .16s ease,padding .16s ease;user-select:none;}',
      '.wds-toggle:hover{opacity:1;padding-right:9px;}',
      '.wds-toggle.sim-on{opacity:1;background:linear-gradient(135deg,var(--primary,#4f46e5),var(--primary-hover,var(--primary-dark,#4338ca)));color:#fff;border-color:rgba(255,255,255,0.45);}',
      '.wds-badge-mini{font-size:0.56rem;line-height:1;font-weight:900;letter-spacing:0.04em;}',
      '.wds-panel{display:none;flex-direction:column;gap:7px;padding:10px 11px;border-radius:16px;background:var(--bg-surface,var(--bg-card,#ffffff));color:var(--text-main,var(--text-primary,#0f172a));border:1.5px solid var(--border,var(--border-color,rgba(148,163,184,0.32)));box-shadow:0 16px 38px rgba(15,23,42,0.28);min-width:214px;}',
      '.wds-panel.open{display:flex;}',
      '.wds-title{font-size:0.7rem;font-weight:800;color:var(--text-muted,#64748b);display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      '.wds-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}',
      '.wds-role-btn{border:1px solid var(--border,var(--border-color,#cbd5e1));background:var(--bg-subtle,var(--bg-secondary,#f8fafc));color:var(--text-main,var(--text-primary,#0f172a));border-radius:10px;padding:7px 9px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .14s ease;}',
      '.wds-role-btn:hover{border-color:var(--primary,#4f46e5);}',
      '.wds-role-btn.active{background:linear-gradient(135deg,var(--primary,#4f46e5),var(--primary-hover,var(--primary-dark,#4338ca)));color:#fff;border-color:transparent;box-shadow:0 4px 10px rgba(15,23,42,0.2);}',
      '.wds-hint{font-size:0.62rem;color:var(--text-muted,#64748b);text-align:center;opacity:0.85;}',
      '[data-theme="dark"] .wds-panel,[data-theme="midnight"] .wds-panel,[data-theme="oled"] .wds-panel{background:var(--bg-surface,var(--bg-card,#111827));color:var(--text-main,#f8fafc);}',
      '[data-theme="dark"] .wds-role-btn:not(.active){background:var(--bg-subtle,var(--bg-secondary,#1e293b));color:#f8fafc;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function renderDevSimWidget() {
    if (window.__webposRealRole !== 'developer') return;
    if (/login\.html$/i.test(window.location.pathname || '')) return;
    injectSimStyles();

    if (typeof window.__webposDevSimDragCleanup === 'function') {
      window.__webposDevSimDragCleanup();
    }
    var old = document.getElementById('webposDevRoleSimBar');
    if (old) old.remove();

    var activeSim = window.getDevSimRole();
    var currentEffective = activeSim || 'developer';
    var shortTag = activeSim ? ({ owner: 'OWN', admin: 'ADM', kasir: 'KSR' }[activeSim] || 'SIM') : '';
    var shieldSvg = '<svg style="width:18px;height:18px;flex-shrink:0;" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="wdsG" x1="8" y1="5" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#4F46E5"/></linearGradient></defs><path d="M24 5L39 11V23C39 33 32.5 40 24 43C15.5 40 9 33 9 23V11L24 5Z" fill="url(#wdsG)" stroke="#FFFFFF" stroke-width="1.8"/><path d="M17 24L22 29L32 18.5" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var wrap = document.createElement('div');
    wrap.id = 'webposDevRoleSimBar';
    try {
      var savedTop = parseFloat(localStorage.getItem('webpos_dev_sim_top'));
      if (!isNaN(savedTop) && savedTop >= 12 && savedTop <= 84) {
        wrap.style.top = savedTop + '%';
      }
    } catch (e) {}
    wrap.innerHTML =
      '<div class="wds-panel" id="wdsPanel">' +
        '<div class="wds-title"><span>Simulasi Role</span><span style="color:var(--primary,#4f46e5);">' + currentEffective.toUpperCase() + '</span></div>' +
        '<div class="wds-grid">' +
          '<button type="button" class="wds-role-btn' + (currentEffective === 'developer' ? ' active' : '') + '" data-sim-role="developer">Developer</button>' +
          '<button type="button" class="wds-role-btn' + (currentEffective === 'owner' ? ' active' : '') + '" data-sim-role="owner">Owner</button>' +
          '<button type="button" class="wds-role-btn' + (currentEffective === 'admin' ? ' active' : '') + '" data-sim-role="admin">Admin</button>' +
          '<button type="button" class="wds-role-btn' + (currentEffective === 'kasir' ? ' active' : '') + '" data-sim-role="kasir">Kasir</button>' +
        '</div>' +
        '<div class="wds-hint">Tahan & geser tombol ke atas/bawah bila perlu</div>' +
      '</div>' +
      '<button type="button" class="wds-toggle' + (activeSim ? ' sim-on' : '') + '" id="wdsToggleBtn" title="Simulasi Role (klik untuk buka, geser atas/bawah untuk pindah posisi)">' +
        shieldSvg + (shortTag ? '<span class="wds-badge-mini">' + shortTag + '</span>' : '') +
      '</button>';

    document.body.appendChild(wrap);

    var tBtn = document.getElementById('wdsToggleBtn');
    var panel = document.getElementById('wdsPanel');
    if (tBtn && panel) {
      var dragging = false, moved = false, startY = 0;
      function onDragStart(clientY) { dragging = true; moved = false; startY = clientY; }
      function onDragMove(clientY) {
        if (!dragging) return;
        if (Math.abs(clientY - startY) > 6) moved = true;
        if (!moved) return;
        var pct = Math.max(14, Math.min(82, (clientY / Math.max(window.innerHeight, 1)) * 100));
        wrap.style.top = pct.toFixed(1) + '%';
        try { localStorage.setItem('webpos_dev_sim_top', pct.toFixed(1)); } catch (e) {}
      }
      function onDragEnd() { dragging = false; }
      function onDocMouseMove(e) { if (dragging) onDragMove(e.clientY); }

      tBtn.addEventListener('mousedown', function(e) { onDragStart(e.clientY); });
      document.addEventListener('mousemove', onDocMouseMove);
      document.addEventListener('mouseup', onDragEnd);
      tBtn.addEventListener('touchstart', function(e) {
        if (e.touches && e.touches[0]) onDragStart(e.touches[0].clientY);
      }, { passive: true });
      tBtn.addEventListener('touchmove', function(e) {
        if (e.touches && e.touches[0]) onDragMove(e.touches[0].clientY);
      }, { passive: true });
      tBtn.addEventListener('touchend', onDragEnd);

      window.__webposDevSimDragCleanup = function() {
        document.removeEventListener('mousemove', onDocMouseMove);
        document.removeEventListener('mouseup', onDragEnd);
      };

      tBtn.onclick = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (moved) { moved = false; return; }
        panel.classList.toggle('open');
      };
    }
    
    wrap.querySelectorAll('[data-sim-role]').forEach(function(btn) {
      btn.onclick = function() { window.setDevSimRole(btn.getAttribute('data-sim-role')); };
    });

    if (!window.__webposDevSimOutsideBound) {
      window.__webposDevSimOutsideBound = true;
      function closeDevSimPanelIfOutside(target) {
        var bar = document.getElementById('webposDevRoleSimBar');
        var pnl = document.getElementById('wdsPanel');
        if (!bar || !pnl || !pnl.classList.contains('open')) return;
        if (!target || !bar.contains(target)) {
          pnl.classList.remove('open');
        }
      }
      document.addEventListener('click', function(e) {
        closeDevSimPanelIfOutside(e.target);
      }, true);
      document.addEventListener('focusin', function(e) {
        closeDevSimPanelIfOutside(e.target);
      }, true);
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          var pnl = document.getElementById('wdsPanel');
          if (pnl) pnl.classList.remove('open');
        } else {
          closeDevSimPanelIfOutside(e.target);
        }
      }, true);
    }
  }

  function initDevSimAuthCheck() {
    if (!window.firebase || !firebase.auth || !firebase.firestore) return;
    firebase.auth().onAuthStateChanged(function(user) {
      if (!user) {
        window.__webposRealRole = '';
        var bar = document.getElementById('webposDevRoleSimBar');
        if (bar) bar.remove();
        return;
      }
      firebase.firestore().collection('users').doc(user.uid).get().then(function(snap) {
        var r = (snap.exists && snap.data() && snap.data().role) ? String(snap.data().role).toLowerCase() : 'kasir';
        window.__webposRealRole = r;
        if (r === 'developer') {
          renderDevSimWidget();
        } else {
          try { sessionStorage.removeItem(SIM_KEY); } catch (e) {}
          var bar = document.getElementById('webposDevRoleSimBar');
          if (bar) bar.remove();
        }
      }).catch(function() {});
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDevSimAuthCheck);
  } else {
    initDevSimAuthCheck();
  }
})();
