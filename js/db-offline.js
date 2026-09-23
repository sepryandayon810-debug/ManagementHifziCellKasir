(function() {
  "use strict";

  // ===== CACHE PRODUK UNTUK OFFLINE =====
  window.saveProductsToCache = async function(productsArray) {
    try {
      localStorage.setItem('webpos_offline_products', JSON.stringify(productsArray));
      localStorage.setItem('webpos_cache_timestamp', Date.now());
    } catch (e) {
      console.error('Gagal menyimpan cache produk offline:', e);
    }
  };

  window.getProductsFromCache = async function() {
    try {
      const data = localStorage.getItem('webpos_offline_products');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Gagal membaca cache produk offline:', e);
      return [];
    }
  };

  // ===== TRANSAKSI PENDING (SAAT OFFLINE) =====
  window.saveOfflineTransaction = async function(txData) {
    try {
      let pending = JSON.parse(localStorage.getItem('webpos_pending_transactions') || '[]');
      txData.localId = 'local_' + Date.now();
      pending.push({ localId: txData.localId, data: txData });
      localStorage.setItem('webpos_pending_transactions', JSON.stringify(pending));
      return true;
    } catch (e) {
      console.error('Gagal simpan transaksi offline:', e);
      throw e;
    }
  };

  window.getPendingTransactions = async function() {
    try {
      return JSON.parse(localStorage.getItem('webpos_pending_transactions') || '[]');
    } catch (e) {
      return [];
    }
  };

  window.removeSyncedTransaction = async function(localId) {
    try {
      let pending = JSON.parse(localStorage.getItem('webpos_pending_transactions') || '[]');
      pending = pending.filter(item => item.localId !== localId);
      localStorage.setItem('webpos_pending_transactions', JSON.stringify(pending));
    } catch (e) {}
  };

})();
