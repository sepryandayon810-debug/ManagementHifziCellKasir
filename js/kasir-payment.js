(function() {
  "use strict";

  // State Pembayaran Global
  window.paymentAmount = 0;
  window.paymentMethod = 'cash';

  // ===== RESET & KONTROL MODAL PEMBAYARAN =====
  window.resetPaymentModal = function() {
    window.paymentMethod = 'cash';
    window.paymentAmount = 0;

    document.querySelectorAll('.payment-method').forEach(x => x.classList.remove('active'));
    const defaultCash = document.querySelector('.payment-method[data-method="cash"]');
    if (defaultCash) defaultCash.classList.add('active');

    const piutangSec = document.getElementById('piutangSection');
    if (piutangSec) piutangSec.classList.remove('active');
    
    const piutangPay = document.getElementById('piutangPayment');
    if (piutangPay) piutangPay.value = '0';
    
    const sisaVal = document.getElementById('sisaPiutangValue');
    if (sisaVal) sisaVal.textContent = 'Rp 0';

    const newCustForm = document.getElementById('newCustomerForm');
    if (newCustForm) newCustForm.style.display = 'none';

    document.querySelectorAll('.quick-amounts, .numpad').forEach(el => {
      if (el) el.style.display = 'grid';
    });
    
    const payInput = document.getElementById('paymentInput');
    const payChange = document.getElementById('paymentChange');
    if (payInput && payInput.parentElement) payInput.parentElement.style.display = 'block';
    if (payChange && payChange.parentElement) payChange.parentElement.style.display = 'block';

    if (payInput) payInput.textContent = 'Rp 0';
    if (payChange) payChange.textContent = 'Rp 0';
    updatePaymentDisplay();
  };

  // ===== UPDATE TAMPILAN PEMBAYARAN & KEMBALIAN =====
  window.updatePaymentDisplay = function() {
    const total = calculateTotal();
    const payInputEl = document.getElementById('paymentInput');
    if (payInputEl) payInputEl.textContent = formatRupiah(window.paymentAmount);

    const difference = window.paymentAmount - total;
    const changeDisplay = document.getElementById('paymentChange');
    if (!changeDisplay) return;

    const changeBox = changeDisplay.closest('.amount-display');
    const changeLabel = changeBox ? changeBox.querySelector('.amount-label') : null;

    if (difference < 0) {
      if (changeLabel) changeLabel.textContent = 'Kurang Bayar';
      changeDisplay.textContent = formatRupiah(Math.abs(difference));
      if (changeBox) changeBox.classList.add('is-shortage');
    } else {
      if (changeLabel) changeLabel.textContent = 'Kembalian';
      changeDisplay.textContent = formatRupiah(difference);
      if (changeBox) changeBox.classList.remove('is-shortage');
    }
  };

  window.updatePiutangDisplay = function() {
    const total = calculateTotal();
    const payInput = document.getElementById('piutangPayment');
    const paid = payInput ? parseInt(payInput.value.replace(/\D/g, '')) || 0 : 0;
    const remaining = total - paid;
    const sisaVal = document.getElementById('sisaPiutangValue');
    if (sisaVal) sisaVal.textContent = formatRupiah(remaining > 0 ? remaining : 0);
  };

  // ===== PROSES EKsekusi PEMBAYARAN =====
  window.processPayment = async function() {
    const total = calculateTotal();
    if (window.cart.length === 0) {
      showToast('Keranjang masih kosong', 'warning');
      return;
    }

    // ⭐ PENANGANAN MODE OFFLINE
    if (!navigator.onLine) {
      if (window.paymentMethod === 'hutang') {
        showToast('Piutang tidak dapat dicatat saat offline. Gunakan Tunai/Transfer.', 'error');
        return;
      }
      if (window.paymentAmount < total) {
        showToast(`Pembayaran kurang ${formatRupiah(total - window.paymentAmount)}. Masukkan nominal penuh saat offline.`, 'error');
        return;
      }
      try {
        const transactionData = {
          type: 'penjualan',
          items: JSON.parse(JSON.stringify(window.cart)),
          subtotal: getCartSubtotal(),
          total: total,
          profit: getCartProfit(),
          paymentMethod: window.paymentMethod,
          paymentAmount: total,
          change: 0,
          discount: 0,
          note: localStorage.getItem('kasir_note') || '',
          timestamp: Date.now(),
          cashierName: document.getElementById('userName')?.textContent || 'Kasir',
          status: 'pending_sync',
          priceMode: window.resellerMode ? 'reseller' : 'regular'
        };

        if (typeof window.saveOfflineTransaction === 'function') {
          await window.saveOfflineTransaction(transactionData);
        }

        // Kurangi stok produk secara lokal
        for (const item of window.cart) {
          const prod = window.products.find(p => p.id === item.productId);
          if (prod && !prod.isUnlimited) {
            prod.stock = Math.max(0, (prod.stock || 0) - item.quantity);
          }
        }
        if (typeof window.saveProductsToCache === 'function') {
          await window.saveProductsToCache(window.products);
        }

        window.cart = [];
        localStorage.removeItem('kasir_note');
        saveCart(); renderCart(); updateSummary();
        document.getElementById('paymentModal').classList.remove('active');
        showToast('Transaksi tersimpan offline. Akan disinkronkan saat online.', 'warning');

        const printToggle = document.getElementById('printReceiptToggle');
        if (printToggle && printToggle.checked && typeof window.showStrukModal === 'function') {
          showStrukModal(transactionData);
        }
        loadHeaderStats();
        return;
      } catch (err) {
        console.error('Offline save error:', err);
        showToast('Gagal menyimpan transaksi offline', 'error');
        return;
      }
    }

    // ⭐ PENANGANAN MODE PIUTANG / HUTANG
    if (window.paymentMethod === 'hutang') {
      const piutangNameEl = document.getElementById('piutangName');
      const piutangName = piutangNameEl ? piutangNameEl.value.trim() : '';
      if (!piutangName) {
        showToast('Nama pelanggan wajib diisi untuk transaksi piutang', 'error');
        return;
      }

      const piutangPayEl = document.getElementById('piutangPayment');
      const piutangPayment = piutangPayEl ? parseInt(piutangPayEl.value.replace(/\D/g, '')) || 0 : 0;
      const remainingDebt = total - piutangPayment;

      if (piutangPayment > total) {
        showToast('Jumlah pembayaran tidak boleh melebihi total transaksi', 'error');
        return;
      }

      try {
        const loadingEl = document.getElementById('loadingOverlay');
        if (loadingEl) loadingEl.classList.add('active');

        const user = firebase.auth().currentUser;
        const transactionId = 'TRX' + Date.now();
        const todayStr = new Date().toISOString().split('T')[0];

        const transaction = {
          id: transactionId,
          type: 'penjualan',
          items: window.cart,
          subtotal: getCartSubtotal(),
          tax: 0,
          discount: 0,
          total: total,
          profit: getCartProfit(),
          paymentMethod: 'hutang',
          paymentAmount: piutangPayment,
          change: 0,
          remainingPiutang: remainingDebt > 0 ? remainingDebt : 0,
          cashierId: user ? user.uid : 'unknown',
          cashierName: document.getElementById('userName')?.textContent || 'Kasir',
          timestamp: Date.now(),
          status: 'completed',
          isHutang: true,
          hutangName: piutangName,
          source: 'kasir',
          flowType: remainingDebt > 0 ? 'penjualan_kredit' : 'penjualan_lunas'
        };

        const db = createFirestoreCompat();

        // Auto-save customer baru jika belum ada
        const customerExists = Object.values(window.customers || {}).some(c => 
          c.name && c.name.toLowerCase() === piutangName.toLowerCase()
        );
        if (!customerExists) {
          const newCustomerId = 'cust_' + Date.now();
          await db.ref('customers/' + newCustomerId).set({
            name: piutangName, phone: null, createdAt: Date.now(), updatedAt: Date.now()
          });
          window.customers[newCustomerId] = { name: piutangName, phone: null };
        }

        await db.ref(`transactions/${todayStr}/${transactionId}`).set(transaction);

        // Catat ke koleksi debts/ (piutang aktif)
        const debtId = 'debt_' + Date.now();
        const dueDate = document.getElementById('piutangDueDate')?.value || null;
        await db.ref(`debts/${debtId}`).set({
          id: debtId,
          type: 'piutang',
          date: todayStr,
          name: piutangName,
          amount: remainingDebt > 0 ? remainingDebt : 0,
          remaining: remainingDebt > 0 ? remainingDebt : 0,
          dueDate: dueDate,
          note: `Piutang transaksi ${transactionId}`,
          status: 'active',
          userId: user ? user.uid : 'unknown',
          userName: document.getElementById('userName')?.textContent || 'Kasir',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          affectKas: piutangPayment > 0,
          source: 'kasir',
          flowType: 'piutang_penjualan',
          kasRecorded: true,
          sourceTransactionId: transactionId
        });

        // Jika ada pembayaran muka (DP), catat sebagai kas masuk
        if (piutangPayment > 0) {
          const kasId = 'kas_' + Date.now();
          await db.ref(`transactions/${todayStr}/${kasId}`).set({
            id: kasId,
            type: 'kas_masuk',
            category: 'penerimaan_piutang_penjualan',
            source: 'penjualan',
            cashDirection: 'in',
            relatedTransactionId: transactionId,
            amount: piutangPayment,
            note: `DP Piutang dari ${piutangName}`,
            userId: user ? user.uid : 'unknown',
            userName: document.getElementById('userName')?.textContent || 'Kasir',
            timestamp: Date.now(),
            date: todayStr,
            status: 'completed'
          });
        }

        // Update stok produk di database
        for (const item of window.cart) {
          const ref = db.ref(`products/${item.productId}`);
          const snap = await ref.once('value');
          const prod = snap.val();
          if (prod) {
            await ref.update({
              stock: Math.max(0, (prod.stock || 0) - item.quantity),
              soldCount: (prod.soldCount || 0) + item.quantity
            });
          }
        }

        window.cart = [];
        saveCart(); renderCart(); updateSummary();
        document.getElementById('paymentModal').classList.remove('active');
        const cartSec = document.getElementById('cartSection');
        if (cartSec) cartSec.classList.remove('open');

        if (loadingEl) loadingEl.classList.remove('active');
        showToast('Piutang berhasil dicatat!', 'success');

        const printToggle = document.getElementById('printReceiptToggle');
        if (printToggle && printToggle.checked && typeof window.showStrukModal === 'function') {
          showStrukModal(transaction);
        }

        await Promise.all([loadProducts(), loadHeaderStats(), loadUangGlobal()]);
        return;
      } catch (e) {
        console.error('Piutang error:', e);
        const loadingEl = document.getElementById('loadingOverlay');
        if (loadingEl) loadingEl.classList.remove('active');
        showToast('Gagal mencatat piutang: ' + e.message, 'error');
        return;
      }
    }

    // ⭐ PENANGANAN PEMBAYARAN NORMAL (TUNAI / TRANSFER / QRIS)
    if (window.paymentAmount < total) {
      showToast(`Pembayaran kurang ${formatRupiah(total - window.paymentAmount)}. Gunakan mode Hutang jika bayar sebagian.`, 'error');
      return;
    }

    try {
      const loadingEl = document.getElementById('loadingOverlay');
      if (loadingEl) loadingEl.classList.add('active');

      const user = firebase.auth().currentUser;
      const transactionId = 'TRX' + Date.now();
      const todayStr = new Date().toISOString().split('T')[0];

      const transaction = {
        id: transactionId,
        type: 'penjualan',
        items: window.cart,
        subtotal: getCartSubtotal(),
        tax: 0,
        discount: 0,
        total: total,
        profit: getCartProfit(),
        paymentMethod: window.paymentMethod,
        paymentAmount: window.paymentAmount,
        change: window.paymentAmount - total,
        cashierId: user ? user.uid : 'unknown',
        cashierName: document.getElementById('userName')?.textContent || 'Kasir',
        note: localStorage.getItem('kasir_note') || '',
        timestamp: Date.now(),
        status: 'completed'
      };

      const db = createFirestoreCompat();
      await db.ref(`transactions/${todayStr}/${transactionId}`).set(transaction);

      // Update stok produk
      for (const item of window.cart) {
        const ref = db.ref(`products/${item.productId}`);
        const snap = await ref.once('value');
        const prod = snap.val();
        if (prod) {
          await ref.update({
            stock: Math.max(0, (prod.stock || 0) - item.quantity),
            soldCount: (prod.soldCount || 0) + item.quantity
          });
        }
      }

      window.cart = [];
      saveCart(); renderCart(); updateSummary();
      document.getElementById('paymentModal').classList.remove('active');
      const cartSec = document.getElementById('cartSection');
      if (cartSec) cartSec.classList.remove('open');

      if (loadingEl) loadingEl.classList.remove('active');
      showToast('Transaksi berhasil!', 'success');

      const printToggle = document.getElementById('printReceiptToggle');
      if (printToggle && printToggle.checked && typeof window.showStrukModal === 'function') {
        showStrukModal(transaction);
      }

      await Promise.all([loadProducts(), loadHeaderStats(), loadUangGlobal()]);
    } catch (e) {
      console.error('Payment error:', e);
      const loadingEl = document.getElementById('loadingOverlay');
      if (loadingEl) loadingEl.classList.remove('active');
      showToast('Gagal memproses transaksi: ' + e.message, 'error');
    }
  };

  // ===== AUTOCOMPLETE & CUSTOMER INLINE FORM =====
  window.loadCustomers = async function() {
    try {
      const snap = await createFirestoreCompat().ref('customers').once('value');
      window.customers = snap.val() || {};
    } catch (e) {
      console.error('Error loading customers:', e);
    }
  };

  window.toggleAddCustomerForm = function() {
    const form = document.getElementById('newCustomerForm');
    if (!form) return;
    const isVisible = form.style.display === 'block';
    form.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      const drop = document.getElementById('customerAutocomplete');
      if (drop) drop.style.display = 'none';
      const nameInput = document.getElementById('newCustomerName');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      const phoneInput = document.getElementById('newCustomerPhone');
      if (phoneInput) phoneInput.value = '';
    }
  };

  window.saveNewCustomerFromKasir = async function() {
    const nameInput = document.getElementById('newCustomerName');
    const phoneInput = document.getElementById('newCustomerPhone');
    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';

    if (!name) { showToast('Nama pelanggan wajib diisi', 'error'); return; }

    try {
      const db = createFirestoreCompat();
      const newId = 'cust_' + Date.now();
      await db.ref('customers/' + newId).set({
        name: name, phone: phone || null, createdAt: Date.now(), updatedAt: Date.now()
      });

      window.customers[newId] = { name, phone: phone || null };
      const piutangNameEl = document.getElementById('piutangName');
      if (piutangNameEl) piutangNameEl.value = name;
      toggleAddCustomerForm();
      showToast(`Pelanggan "${name}" berhasil ditambahkan`, 'success');
    } catch (e) {
      showToast('Gagal menyimpan pelanggan', 'error');
    }
  };

  // ===== EVENT LISTENERS MODAL PEMBAYARAN =====
  document.addEventListener("DOMContentLoaded", () => {
    const btnBayar = document.getElementById('btnBayar');
    const paymentModal = document.getElementById('paymentModal');
    const closePay = document.getElementById('closePaymentModal');
    const cancelPay1 = document.getElementById('btnCancelPayment');
    const cancelPay2 = document.getElementById('btnCancelPaymentDesktop');

    if (btnBayar && paymentModal) {
      btnBayar.addEventListener('click', () => {
        if (window.cart.length === 0) { showToast('Keranjang masih kosong', 'warning'); return; }
        resetPaymentModal();
        const total = calculateTotal();
        const totalEl = document.getElementById('paymentTotal');
        if (totalEl) totalEl.textContent = formatRupiah(total);
        paymentModal.classList.add('active');
      });
    }

    [closePay, cancelPay1, cancelPay2].forEach(btn => {
      if (btn && paymentModal) btn.addEventListener('click', () => paymentModal.classList.remove('active'));
    });

    // Metode Pembayaran
    document.querySelectorAll('.payment-method').forEach(m => {
      m.addEventListener('click', () => {
        document.querySelectorAll('.payment-method').forEach(x => x.classList.remove('active'));
        m.classList.add('active');
        window.paymentMethod = m.dataset.method;

        const piutangSec = document.getElementById('piutangSection');
        const quickAmounts = document.querySelector('.quick-amounts');
        const numpad = document.querySelector('.numpad');
        const diterima = document.getElementById('paymentInput')?.parentElement;
        const kembalian = document.getElementById('paymentChange')?.parentElement;

        if (window.paymentMethod === 'hutang') {
          if (piutangSec) piutangSec.classList.add('active');
          if (quickAmounts) quickAmounts.style.display = 'none';
          if (numpad) numpad.style.display = 'grid';
          if (diterima) diterima.style.display = 'none';
          if (kembalian) kembalian.style.display = 'none';
          loadCustomers();
          updatePiutangDisplay();
        } else {
          if (piutangSec) piutangSec.classList.remove('active');
          if (quickAmounts) quickAmounts.style.display = 'flex';
          if (numpad) numpad.style.display = 'grid';
          if (diterima) diterima.style.display = 'block';
          if (kembalian) kembalian.style.display = 'block';
          updatePaymentDisplay();
        }
      });
    });

    // Numpad Kalkulator
    document.querySelectorAll('.numpad-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const num = btn.dataset.num;
        const action = btn.dataset.action;

        if (window.paymentMethod === 'hutang') {
          const piutangPay = document.getElementById('piutangPayment');
          if (!piutangPay) return;
          let currentVal = parseInt(piutangPay.value.replace(/\D/g, '')) || 0;
          if (num !== undefined) currentVal = currentVal * 10 + parseInt(num);
          else if (action === 'clear') currentVal = 0;
          else if (action === 'backspace') currentVal = Math.floor(currentVal / 10);
          piutangPay.value = currentVal.toLocaleString('id-ID');
          updatePiutangDisplay();
        } else {
          if (num !== undefined) window.paymentAmount = window.paymentAmount * 10 + parseInt(num);
          else if (action === 'clear') window.paymentAmount = 0;
          else if (action === 'backspace') window.paymentAmount = Math.floor(window.paymentAmount / 10);
          updatePaymentDisplay();
        }
      });
    });

    // Quick Amounts
    document.querySelectorAll('.quick-amount').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.amount === 'exact') window.paymentAmount = Math.ceil(calculateTotal());
        else window.paymentAmount = parseInt(btn.dataset.amount);
        updatePaymentDisplay();
      });
    });

    // Tombol Konfirmasi Proses Bayar
    const confirmPay1 = document.getElementById('btnConfirmPayment');
    const confirmPay2 = document.getElementById('btnConfirmPaymentDesktop');
    if (confirmPay1) confirmPay1.addEventListener('click', processPayment);
    if (confirmPay2) confirmPay2.addEventListener('click', processPayment);

    // Autocomplete Piutang Input Listener
    const piutangNameInput = document.getElementById('piutangName');
    const autocompleteBox = document.getElementById('customerAutocomplete');
    if (piutangNameInput && autocompleteBox) {
      piutangNameInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if (val.length < 2) { autocompleteBox.style.display = 'none'; return; }
        const matches = Object.values(window.customers || {}).filter(c => c.name && c.name.toLowerCase().includes(val));
        if (matches.length > 0) {
          autocompleteBox.innerHTML = matches.map(c => `
            <div class="autocomplete-item" onclick="window.selectCustomer('${c.name.replace(/'/g, "\\'")}')">
              <div style="font-weight:600;">${c.name}</div>
              ${c.phone ? `<div style="font-size:0.7rem; color:var(--text-muted);">${c.phone}</div>` : ''}
            </div>`).join('');
          autocompleteBox.style.display = 'block';
        } else {
          autocompleteBox.style.display = 'none';
        }
      });

      document.addEventListener('click', (e) => {
        if (!piutangNameInput.contains(e.target) && !autocompleteBox.contains(e.target)) {
          autocompleteBox.style.display = 'none';
        }
      });
    }

    window.selectCustomer = (name) => {
      if (piutangNameInput) piutangNameInput.value = name;
      if (autocompleteBox) autocompleteBox.style.display = 'none';
    };
  });

})();
