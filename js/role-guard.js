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
        this.hideMenu('[data-menu="pengguna"]');
        this.hideMenu('[data-menu="log-aktivitas"]');
        this.hideMenu('[data-menu="backup"]');
        return;
      }

      if (role === 'kasir') {
        this.hideMenu('[data-menu="pembelian"]');
        this.hideMenu('[data-menu="laporan"]');
        this.hideMenu('[data-menu="laporan-stok"]');
        this.hideMenu('[data-menu="laporan-terlaris"]');
        this.hideMenu('[data-menu="telegram"]');
        this.hideMenu('[data-menu="data-pelanggan"]');
        this.hideMenu('[data-menu="penggajian"]');
        this.hideMenu('[data-menu="pengguna"]');
        this.hideMenu('[data-menu="backup"]');
        this.hideMenu('[data-menu="reset"]');
        this.hideMenu('[data-menu="log-aktivitas"]');

        const btnTransfer = document.getElementById('btnTransferShift');
        if (btnTransfer) btnTransfer.style.display = 'none';

        const totalLabaCard = document.getElementById('totalLaba');
        if (totalLabaCard) totalLabaCard.closest('.stat-card').style.display = 'none';
        
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
          if (laba) laba.closest('.stat-card').style.display = '';
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

    // 2. Buka menu dari cache lokal langsung
    try {
      const cached = JSON.parse(localStorage.getItem('webpos_user_permissions') || '{}');
      unhideAllowedMenus(cached);
    } catch (e) {}

    // 3. Tarik izin user dari database Firestore secara real-time
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.firestore) {
      firebase.auth().onAuthStateChanged(function(user) {
        if (user) {
          firebase.firestore().collection('users').doc(user.uid).get().then(function(doc) {
            if (doc.exists && doc.data() && doc.data().permissions) {
              const livePerms = doc.data().permissions;
              localStorage.setItem('webpos_user_permissions', JSON.stringify(livePerms));
              unhideAllowedMenus(livePerms);
            }
          }).catch(function(err) {
            console.warn("Gagal sync izin:", err);
          });
        }
      });
    }
  };
})();
