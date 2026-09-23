(function() {
  "use strict";

  // ===== STATE STRUK & PRINT =====
  window.lastTransactionData = null;

  window.loadReceiptHeader = function() {
    try {
      return JSON.parse(localStorage.getItem('receiptHeader')) || {};
    } catch (e) {
      return {};
    }
  };

  // Format ESC/POS untuk Printer Thermal Bluetooth
  window.generateEscPosKasir = function(tx) {
    const hdr = loadReceiptHeader();
    const storeName = hdr.storeName || localStorage.getItem('webpos_store_name') || 'NAMA TOKO';
    const address = hdr.address || '';
    const phone = hdr.phone || '';
    const note = hdr.note || 'Terima kasih atas kunjungan Anda';
    const date = new Date(tx.timestamp).toLocaleDateString('id-ID');
    const time = new Date(tx.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    const ESC = '\x1B';
    const GS = '\x1D';
    const INIT = ESC + '\x40';
    const CENTER = ESC + '\x61\x01';
    const LEFT = ESC + '\x61\x00';
    const BOLD_ON = ESC + '\x45\x01';
    const BOLD_OFF = ESC + '\x45\x00';
    const SIZE2 = ESC + '\x21\x10';
    const SIZE1 = ESC + '\x21\x00';
    const CUT = GS + '\x56\x41\x03';
    const FEED = '\x0A';

    let c = INIT;
    c += CENTER + BOLD_ON + SIZE2 + storeName.toUpperCase() + SIZE1 + BOLD_OFF + FEED;
    if (address) c += CENTER + address + FEED;
    if (phone) c += CENTER + 'HP: ' + phone + FEED;
    c += CENTER + '------------------------------' + FEED;
    c += LEFT;
    c += 'No   : ' + tx.id + FEED;
    c += 'Tgl  : ' + date + ' ' + time + FEED;
    c += 'Kasir: ' + (tx.cashierName || '-') + FEED;
    c += '------------------------------' + FEED;

    (tx.items || []).forEach(item => {
      c += item.name + FEED;
      c += '  ' + item.quantity + ' x ' + formatRupiah(item.price) + ' = ' + formatRupiah(item.total) + FEED;
    });

    c += '------------------------------' + FEED;
    c += 'Subtotal : ' + formatRupiah(tx.subtotal) + FEED;
    if (tx.discount > 0) c += 'Diskon   : -' + formatRupiah(tx.discount) + FEED;
    c += BOLD_ON + 'TOTAL    : ' + formatRupiah(tx.total) + BOLD_OFF + FEED;
    c += '------------------------------' + FEED;
    c += 'Bayar    : ' + formatRupiah(tx.paymentAmount || tx.total) + FEED;
    c += 'Kembali  : ' + formatRupiah(tx.change || 0) + FEED;
    c += 'Metode   : ' + (tx.paymentMethod || 'Tunai').toUpperCase() + FEED;
    c += '==============================';
    c += FEED + CENTER + note + FEED;
    c += FEED + FEED + FEED + CUT;

    return c;
  };

  window.generateStrukPlain = function(tx) {
    const hdr = loadReceiptHeader();
    const storeName = hdr.storeName || localStorage.getItem('webpos_store_name') || 'NAMA TOKO';
    const address = hdr.address || '';
    const phone = hdr.phone || '';
    const note = hdr.note || 'Terima kasih';
    const date = new Date(tx.timestamp).toLocaleDateString('id-ID');
    const time = new Date(tx.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    let lines = [];
    lines.push('================================');
    lines.push('    ' + storeName.toUpperCase());
    if (address) lines.push(address);
    if (phone) lines.push('HP: ' + phone);
    lines.push('================================');
    lines.push('BUKTI PENJUALAN');
    lines.push('No   : ' + tx.id);
    lines.push('Tgl  : ' + date + ' ' + time);
    lines.push('Kasir: ' + (tx.cashierName || '-'));
    lines.push('--------------------------------');

    (tx.items || []).forEach(item => {
      lines.push(item.name);
      lines.push('  ' + item.quantity + ' x ' + formatRupiah(item.price) + ' = ' + formatRupiah(item.total));
    });

    lines.push('--------------------------------');
    lines.push('Subtotal : ' + formatRupiah(tx.subtotal));
    if (tx.discount > 0) lines.push('Diskon   : -' + formatRupiah(tx.discount));
    lines.push('TOTAL    : ' + formatRupiah(tx.total));
    lines.push('--------------------------------');
    lines.push('Bayar    : ' + formatRupiah(tx.paymentAmount || tx.total));
    lines.push('Kembali  : ' + formatRupiah(tx.change || 0));
    lines.push('Metode   : ' + (tx.paymentMethod || 'Tunai').toUpperCase());
    lines.push('==============================');
    lines.push(note);

    return lines.join('\n');
  };

  window.showStrukModal = function(tx) {
    window.lastTransactionData = tx;
    const paper = document.getElementById('strukPaper');
    if (paper) paper.textContent = generateStrukPlain(tx);

    const btnPrint = document.getElementById('btnPrintStruk');
    if (btnPrint) {
      if (!window.bluetoothSerial) {
        btnPrint.disabled = true;
        btnPrint.innerHTML = '<i class="fas fa-print"></i> Bluetooth (APK Only)';
      } else {
        btnPrint.disabled = false;
        btnPrint.innerHTML = '<i class="fas fa-print"></i> Cetak Thermal';
      }
    }

    const modal = document.getElementById('strukModal');
    if (modal) modal.classList.add('active');
  };

  window.closeStrukModal = function() {
    const modal = document.getElementById('strukModal');
    if (modal) modal.classList.remove('active');
    window.lastTransactionData = null;
  };

  window.printStrukBluetooth = async function() {
    if (!window.lastTransactionData) {
      showToast('Tidak ada struk untuk dicetak', 'warning');
      return;
    }
    if (!window.bluetoothSerial) {
      showToast('Bluetooth hanya tersedia di APK Android', 'error');
      return;
    }

    const mac = localStorage.getItem('webpos_printer_mac');
    if (!mac) {
      showToast('Pilih printer dulu di menu Printer & Struk', 'warning');
      return;
    }

    if (!window.lastTransactionData.items || !Array.isArray(window.lastTransactionData.items)) {
      showToast('Data transaksi tidak lengkap', 'error');
      return;
    }

    showToast('Menghubungkan ke printer...', 'info');

    try {
      await new Promise((resolve, reject) => {
        bluetoothSerial.connect(mac, resolve, reject);
      });

      const data = generateEscPosKasir(window.lastTransactionData);
      if (!data || data.length === 0) throw new Error('Data struk kosong');

      await new Promise((resolve, reject) => {
        bluetoothSerial.write(data, resolve, reject);
      });

      await new Promise((resolve) => {
        bluetoothSerial.disconnect(resolve, resolve);
      });

      showToast('Struk berhasil dicetak!', 'success');
    } catch (error) {
      console.error('Print error:', error);
      showToast('Gagal print: ' + error, 'error');
    }
  };

  // ===== INISIALISASI UTAMA HALAMAN KASIR =====
  function runInit() {
    if (typeof syncKasirSettings === 'function') syncKasirSettings();
    if (typeof loadUserData === 'function') loadUserData();
    if (typeof loadCategories === 'function') loadCategories();
    if (typeof loadProducts === 'function') loadProducts();
    if (typeof loadCart === 'function') loadCart();
    if (typeof loadHeaderStats === 'function') loadHeaderStats();
    if (typeof loadUangGlobal === 'function') loadUangGlobal();
    if (typeof applyCurrentView === 'function') applyCurrentView();
    if (typeof initLongPressOnProducts === 'function') initLongPressOnProducts();

    const loadingEl = document.getElementById('loadingOverlay');
    if (loadingEl) loadingEl.classList.remove('active');
  }

  // Listener Autentikasi dan Inisialisasi Saat Halaman Dimuat
  document.addEventListener("DOMContentLoaded", () => {
    // Auto-sync saat kembali online
    window.addEventListener('online', async () => {
      showToast('Internet kembali! Menyinkronkan...', 'info');
      if (typeof getPendingTransactions === 'function' && typeof removeSyncedTransaction === 'function') {
        const pending = await getPendingTransactions();
        if (pending.length === 0) return;

        const loadingEl = document.getElementById('loadingOverlay');
        if (loadingEl) loadingEl.classList.add('active');
        let synced = 0;
        const db = createFirestoreCompat();
        const todayStr = new Date().toISOString().split('T')[0];

        for (const item of pending) {
          try {
            const tx = item.data;
            tx.id = tx.id || ('TRX_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
            tx.syncedAt = Date.now();
            tx.status = 'completed';
            await db.ref('transactions/' + todayStr + '/' + tx.id).set(tx);
            await removeSyncedTransaction(item.localId);
            synced++;
          } catch (e) {
            console.error('Sync failed:', e);
          }
        }
        if (loadingEl) loadingEl.classList.remove('active');
        showToast(`${synced}/${pending.length} transaksi tersinkronkan`, synced > 0 ? 'success' : 'warning');
        await Promise.all([loadProducts(), loadHeaderStats(), loadUangGlobal()]);
      }
    });

    // Keyboard Shortcuts (Ctrl+K untuk cari, F2 untuk bayar, Esc untuk tutup modal)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('productSearch')?.focus();
      }
      if (e.key === 'F2' && window.cart && window.cart.length > 0) {
        e.preventDefault();
        document.getElementById('btnBayar')?.click();
      }
      if (e.key === 'Escape') {
        document.getElementById('paymentModal')?.classList.remove('active');
        document.getElementById('manualModal')?.classList.remove('active');
        document.getElementById('modalBeliBarang')?.classList.remove('active');
      }
    });

    // Jalankan inisialisasi utama kasir
    if (!navigator.onLine) {
      const user = firebase.auth().currentUser;
      if (user) { runInit(); } else { window.location.href = 'login.html'; }
    } else {
      firebase.auth().onAuthStateChanged(user => {
        if (!user) { window.location.href = 'login.html'; return; }
        runInit();
      });
    }

    // Safety fallback timeout
    setTimeout(() => {
      const overlay = document.getElementById('loadingOverlay');
      if (overlay && overlay.classList.contains('active')) {
        console.warn('Safety init triggered - forcing init');
        runInit();
      }
    }, 5000);
  });

})();
