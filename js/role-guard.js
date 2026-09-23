// js/role-guard.js - Pengatur Hak Akses Menu Sidebar Berdasarkan Role
const RoleGuard = {
  apply: function(userRole) {
    const role = (userRole || 'kasir').toLowerCase();

    // 1. DEVELOPER & OWNER: Memiliki akses penuh ke seluruh menu (tidak ada yang disembunyikan)
    if (role === 'developer' || role === 'owner') {
      return;
    }

    // 2. ADMIN: Mengelola operasional harian, transaksi, kas, dan laporan, tanpa akses sistem sensitif
    if (role === 'admin') {
      this.hideMenu('[data-menu="penggajian"]');
      this.hideMenu('[data-menu="reset"]');
      this.hideMenu('[data-menu="pengguna"]');
      this.hideMenu('[data-menu="setting"]');
      this.hideMenu('[data-menu="log-aktivitas"]'); // Khusus dipantau Owner/Developer
      this.hideMenu('[data-menu="backup"]');
      return;
    }

    // 3. KASIR: Fokus pada mesin kasir, transaksi pribadi, mutasi kas laci sendiri, dan printer struk
    if (role === 'kasir') {
      // Sembunyikan menu manajemen dan laporan tingkat lanjut
      this.hideMenu('[data-menu="pembelian"]');
      this.hideMenu('[data-menu="laporan"]');
      this.hideMenu('[data-menu="laporan-stok"]');
      this.hideMenu('[data-menu="laporan-terlaris"]');
      this.hideMenu('[data-menu="telegram"]');
      this.hideMenu('[data-menu="data-pelanggan"]');
      this.hideMenu('[data-menu="penggajian"]');
      this.hideMenu('[data-menu="pengguna"]');
      this.hideMenu('[data-menu="setting"]');
      this.hideMenu('[data-menu="backup"]');
      this.hideMenu('[data-menu="reset"]');
      this.hideMenu('[data-menu="log-aktivitas"]');

      // Sembunyikan elemen sensitif di dalam halaman (seperti tombol transfer shift & rahasia finansial/laba)
      const btnTransfer = document.getElementById('btnTransferShift');
      if (btnTransfer) btnTransfer.style.display = 'none';

      const totalLabaCard = document.getElementById('totalLaba');
      if (totalLabaCard) totalLabaCard.closest('.stat-card').style.display = 'none';
      
      const modalAwalCard = document.getElementById('modalAwal');
      if (modalAwalCard) modalAwalCard.closest('.stat-card').style.display = 'none';
    }
  },

  // Fungsi pembantu untuk menyembunyikan item menu pada sidebar
  hideMenu: function(selector) {
    const el = document.querySelector(selector);
    if (el) {
      const item = el.closest('.nav-item') || el;
      item.style.display = 'none';
    }
  }
};
