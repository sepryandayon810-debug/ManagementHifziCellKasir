// js/role-guard.js - Pengatur Hak Akses Menu Sidebar
const RoleGuard = {
  apply: function(userRole) {
    const role = (userRole || 'kasir').toLowerCase();

    // Developer & Owner memiliki akses ke semua menu
    if (role === 'developer' || role === 'owner') {
      return;
    }

    // Pembatasan untuk Admin
    if (role === 'admin') {
      this.hideMenu('[data-menu="penggajian"]');
      this.hideMenu('[data-menu="reset"]');
      this.hideMenu('[data-menu="pengguna"]');
      this.hideMenu('[data-menu="setting"]');
      return;
    }

    // Pembatasan ketat untuk Kasir
    if (role === 'kasir') {
      this.hideMenu('[data-menu="pembelian"]');
      this.hideMenu('[data-menu="laporan"]');
      this.hideMenu('[data-menu="laporan-stok"]');
      this.hideMenu('[data-menu="laporan-terlaris"]');
      this.hideMenu('[data-menu="telegram"]');
      this.hideMenu('[data-menu="penggajian"]');
      this.hideMenu('[data-menu="pengguna"]');
      this.hideMenu('[data-menu="setting"]');
      this.hideMenu('[data-menu="backup"]');
      this.hideMenu('[data-menu="reset"]');

      // Sembunyikan tombol transfer shift & rahasia laba di dashboard
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
