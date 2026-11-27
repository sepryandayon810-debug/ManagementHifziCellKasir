// js/role-guard.js - Pengatur Hak Akses Menu Sidebar Berdasarkan Role
if (typeof window.RoleGuard === 'undefined') {
  window.RoleGuard = {
    apply: function(userRole) {
      const role = (userRole || 'kasir').toLowerCase();

      if (role === 'developer' || role === 'owner') {
        return;
      }

      if (role === 'admin') {
        this.hideMenu('[data-menu="penggajian"]');
        this.hideMenu('[data-menu="reset"]');
        this.hideMenu('[data-menu="log-aktivitas"]');
        this.hideMenu('[data-menu="backup"]');
        this.hideMenu('[data-menu="setting"]');
        return;
      }

      if (role === 'kasir') {
        this.hideMenu('[data-menu="pembelian"]');
        this.hideMenu('[data-menu="laporan"]');
        this.hideMenu('[data-menu="laporan-stok"]');
        this.hideMenu('[data-menu="laporan-terlaris"]');
        this.hideMenu('[data-menu="telegram"]');
        this.hideMenu('[data-menu="pelanggan"]');
        this.hideMenu('[data-menu="data-pelanggan"]');
        this.hideMenu('[data-menu="setting"]');
        this.hideMenu('[data-menu="penggajian"]');
        this.hideMenu('[data-menu="backup"]');
        this.hideMenu('[data-menu="reset"]');
        this.hideMenu('[data-menu="log-aktivitas"]');

        const btnTransfer = document.getElementById('btnTransferShift');
        if (btnTransfer) btnTransfer.style.display = 'none';

        const totalLabaCard = document.getElementById('totalLaba');
        if (totalLabaCard && totalLabaCard.closest('.stat-card')) totalLabaCard.closest('.stat-card').style.display = 'none';
        const headerLabaEl = document.getElementById('headerLaba');
        if (headerLabaEl && headerLabaEl.closest('.stat-item')) headerLabaEl.closest('.stat-item').style.display = 'none';
        
        const modalAwalCard = document.getElementById('modalAwal');
        if (modalAwalCard) modalAwalCard.closest('.stat-card').style.display = 'none';
      }
    },

    hideMenu: function(selector) {
      const el = document.querySelector(selector);
      if (el) {
        const item = el.closest('.nav-item') || el;
        item.style.display = 'none';
      }
    }
  };
}
var RoleGuard = window.RoleGuard;

// ==============================================================
// ⬇️ BUKA MENU YANG DIBERI IZIN (MENDUKUNG SEMUA MENU & CACHE)
// ==============================================================
(function() {
  const originalApply = window.RoleGuard.apply;

  function unhideAllowedMenus(perms) {
    if (!perms || typeof perms !== 'object') return;

    Object.keys(perms).forEach(menuKey => {
      if (perms[menuKey] === true) {
        // Cari elemen menu (toleran jika ada awalan data- atau tanpa data-)
        const selectors = [
          `[data-menu="${menuKey}"]`,
          `[data-menu="data-${menuKey}"]`
        ];
        if (menuKey === 'pelanggan') selectors.push('[data-menu="data-pelanggan"]');
        if (menuKey === 'data-pelanggan') selectors.push('[data-menu="pelanggan"]');

        const el = document.querySelector(selectors.join(', '));
        if (el) {
          const item = el.closest('.nav-item') || el;
          item.style.display = ''; // Munculkan menu
        }

        // Widget khusus Dashboard
        if (menuKey === 'total_laba') {
          const laba = document.getElementById('totalLaba');
          if (laba && laba.closest('.stat-card')) laba.closest('.stat-card').style.display = '';
          const headerLaba = document.getElementById('headerLaba');
          if (headerLaba && headerLaba.closest('.stat-item')) headerLaba.closest('.stat-item').style.display = '';
        }
        if (menuKey === 'modal_awal') {
          const modal = document.getElementById('modalAwal');
          if (modal) modal.closest('.stat-card').style.display = '';
        }
        if (menuKey === 'transfer_shift') {
          const btn = document.getElementById('btnTransferShift');
          if (btn) btn.style.display = '';
        }
      }
    });
  }

  window.RoleGuard.apply = function(userRole) {
    // 1. Jalankan penguncian standar terlebih dahulu
    originalApply.call(window.RoleGuard, userRole);

    const role = (userRole || 'kasir').toLowerCase();
    if (role === 'owner' || role === 'developer') return;

    // 2. Buka menu dari cache lokal langsung (lewati jika Developer sedang simulasi role)
    try {
      const isSimNow = (typeof window.isDevRoleSimActive === 'function' && window.isDevRoleSimActive());
      if (!isSimNow) {
        const cached = JSON.parse(localStorage.getItem('webpos_user_permissions') || '{}');
        unhideAllowedMenus(cached);
      }
    } catch (e) {}

    // 3. Tarik izin & validasi akses URL langsung dari Firestore secara real-time
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.firestore) {
      var ADMIN_BLOCKED_PAGES = {
        'page-penggajian.html': 'penggajian',
        'page-reset.html': 'reset',
        'page-log-aktivitas.html': 'log-aktivitas',
        'page-backup.html': 'backup',
        'page-setting.html': 'setting'
      };
      var KASIR_BLOCKED_PAGES = {
        'page-pembelian.html': 'pembelian',
        'page-laporan.html': 'laporan',
        'page-laporan-stok.html': 'laporan-stok',
        'page-laporan-terlaris.html': 'laporan-terlaris',
        'page-saldo-telegram.html': 'telegram',
        'page-data-pelanggan.html': 'data-pelanggan',
        'page-penggajian.html': 'penggajian',
        'page-backup.html': 'backup',
        'page-reset.html': 'reset',
        'page-log-aktivitas.html': 'log-aktivitas',
        'page-setting.html': 'setting'
      };

      if (!window.__webposRouteGuardBound) {
        window.__webposRouteGuardBound = true;
        firebase.auth().onAuthStateChanged(function(user) {
          if (!user) return;
          var pageName = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();

          firebase.firestore().collection('users').doc(user.uid).get().then(function(doc) {
            if (!doc.exists || !doc.data()) return;
            var uData = doc.data();
            var liveStatus = (uData.status || 'active').toLowerCase();
            if (liveStatus === 'inactive' || liveStatus === 'rejected' || liveStatus === 'pending') {
              firebase.auth().signOut().finally(function() {
                window.location.replace('login.html');
              });
              return;
            }

           var realRole = (uData.role || 'kasir').toLowerCase();
            var isSim = (realRole === 'developer' && typeof window.isDevRoleSimActive === 'function' && window.isDevRoleSimActive());
            var liveRole = (typeof window.getEffectiveUserRole === 'function') ? window.getEffectiveUserRole(realRole) : realRole;
            var livePerms = isSim ? {} : ((uData.permissions && typeof uData.permissions === 'object') ? uData.permissions : {});
            if (!isSim) {
              try { localStorage.setItem('webpos_user_permissions', JSON.stringify(livePerms)); } catch (e) {}
            }

            if (liveRole === 'owner' || liveRole === 'developer') return;

            unhideAllowedMenus(livePerms);

            var restrictedMap = liveRole === 'admin' ? ADMIN_BLOCKED_PAGES : KASIR_BLOCKED_PAGES;
            var requiredKey = restrictedMap[pageName];
            if (requiredKey) {
              var allowed = livePerms[requiredKey] === true ||
                (requiredKey === 'data-pelanggan' && livePerms.pelanggan === true);
              if (!allowed) {
                window.location.replace('index.html');
              }
            }
          }).catch(function(err) {
            console.warn("Gagal sync izin:", err);
            try {
              var cachedRole = String(localStorage.getItem('webpos_user_role') || 'kasir').toLowerCase();
              if (cachedRole === 'owner' || cachedRole === 'developer') return;
              var cachedPerms = JSON.parse(localStorage.getItem('webpos_user_permissions') || '{}');
              var restrictedMap = cachedRole === 'admin' ? ADMIN_BLOCKED_PAGES : KASIR_BLOCKED_PAGES;
              var requiredKey = restrictedMap[pageName];
              if (requiredKey) {
                var allowed = cachedPerms[requiredKey] === true ||
                  (requiredKey === 'data-pelanggan' && cachedPerms.pelanggan === true);
                if (!allowed) window.location.replace('index.html');
              }
            } catch (e) {}
          });
        });
      }
    }
  };
})();
