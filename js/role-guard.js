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
