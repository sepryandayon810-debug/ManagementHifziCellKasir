(function() {
  "use strict";

  // State Modal Beli Barang
  window.beliMode = 'existing';
  window.beliSelectedProduct = null;
  window.beliItems = [];
  window.beliTotalKasEdited = false;

  // ===== KONTROL NAVIGASI PINTASAN CEPAT =====
  window.goToTopup = function() {
    localStorage.setItem('fromKasir', 'true');
    window.location.href = 'page-kas-topup.html';
  };

  window.goToTarik = function() {
    localStorage.setItem('fromKasir', 'true');
    window.location.href = 'page-kas-tarik.html';
  };

  window.openKasMasuk = function() {
    localStorage.setItem('fromKasir', 'true');
    window.location.href = 'page-kas-masuk.html';
  };

  window.openKasKeluar = function() {
    localStorage.setItem('fromKasir', 'true');
    window.location.href = 'page-kas-keluar.html';
  };

  window.openBayarHutang = function() {
    localStorage.setItem('fromKasir', 'true');
    window.location.href = 'page-hutang.html';
  };

  // ===== MODAL INPUT PRODUK MANUAL =====
  window.openManualModal = function() {
    const modal = document.getElementById('manualModal');
    if (!modal) return;
    modal.classList.add('active');
    
    const nameEl = document.getElementById('manualName');
    const costEl = document.getElementById('manualCost');
    const priceEl = document.getElementById('manualPrice');
    const unliEl = document.getElementById('manualUnlimited');

    if (nameEl) nameEl.value = '';
    if (costEl) costEl.value = '';
    if (priceEl) priceEl.value = '';
    if (unliEl) unliEl.checked = true;

    calculateProfit();
    setTimeout(() => { if (nameEl) nameEl.focus(); }, 100);
  };

  window.closeManualModal = function() {
    const modal = document.getElementById('manualModal');
    if (modal) modal.classList.remove('active');
  };

  window.calculateProfit = function() {
    const cost = parseInt(document.getElementById('manualCost')?.value) || 0;
    const price = parseInt(document.getElementById('manualPrice')?.value) || 0;
    const profit = price - cost;

    const profitEl = document.getElementById('profitDisplay');
    if (profitEl) {
      profitEl.textContent = `Laba: ${formatRupiah(profit)}`;
      profitEl.style.color = profit >= 0 ? 'var(--success)' : 'var(--danger)';
    }
    const sellDisplay = document.getElementById('sellPriceDisplay');
    if (sellDisplay) sellDisplay.textContent = formatRupiah(price);
  };

  window.confirmManualInput = function() {
    const name = document.getElementById('manualName')?.value.trim() || '';
    const cost = parseInt(document.getElementById('manualCost')?.value) || 0;
    const price = parseInt(document.getElementById('manualPrice')?.value) || 0;
    const unlimited = document.getElementById('manualUnlimited')?.checked ?? true;

    if (!name) { showToast('Nama produk wajib diisi', 'error'); return; }
    if (price <= 0) { showToast('Harga jual harus lebih dari 0', 'error'); return; }

    const manual = {
      id: 'manual_' + Date.now(),
      name: name,
      sellingPrice: price,
      costPrice: cost,
      stock: unlimited ? 999999 : 1,
      isUnlimited: unlimited,
      isManual: true
    };

    if (Array.isArray(window.products)) {
      window.products.unshift(manual);
    }
    if (typeof window.renderProducts === 'function') window.renderProducts();
    if (typeof window.addToCart === 'function') window.addToCart(manual.id);
    closeManualModal();
    showToast(`${name} ditambahkan ke keranjang`, 'success');
  };

  // ===== MODAL PEMBELIAN / RESTOCK BARANG (MULTI-ITEM) =====
  window.populateBeliCategoryOptions = function() {
    const select = document.getElementById('beliNewCategory');
    if (!select) return;
    const selected = select.value;
    select.innerHTML = '<option value="">Tanpa kategori</option>' +
      (window.categories || []).map(c => `<option value="${c.id}">${c.name || c.title || 'Kategori'}</option>`).join('');
    if ([...select.options].some(o => o.value === selected)) select.value = selected;
  };

  window.openModalBeli = function() {
    if (typeof window.populateBeliCategoryOptions === 'function') window.populateBeliCategoryOptions();
    const modal = document.getElementById('modalBeliBarang');
    if (modal) modal.classList.add('active');
    setTimeout(() => { document.getElementById('beliSearch')?.focus(); }, 100);
  };

  window.closeModalBeli = function() {
    const modal = document.getElementById('modalBeliBarang');
    if (modal) modal.classList.remove('active');
    resetBeliBarang();
  };

  window.setBeliMode = function(mode) {
    window.beliMode = mode;
    const btnEx = document.getElementById('btnModeExisting');
    const btnNew = document.getElementById('btnModeNew');
    const modeEx = document.getElementById('beliModeExisting');
    const modeNew = document.getElementById('beliModeNew');

    if (btnEx) btnEx.classList.toggle('active', mode === 'existing');
    if (btnNew) btnNew.classList.toggle('active', mode === 'new');
    if (modeEx) modeEx.style.display = mode === 'existing' ? 'block' : 'none';
    if (modeNew) modeNew.style.display = mode === 'new' ? 'block' : 'none';

    // Reset input satuan
    ['beliSearch', 'beliSelectedId', 'beliNewName', 'beliNewSellPrice', 'beliSupplier', 'beliResellerPrice', 'beliNormalPrice', 'beliQty', 'beliHarga'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const normGroup = document.getElementById('beliNormalPriceGroup');
    if (normGroup) normGroup.style.display = mode === 'existing' ? 'block' : 'none';

    window.beliTotalKasEdited = false;
    const searchList = document.getElementById('beliSearchList');
    if (searchList) searchList.style.display = 'none';
    window.beliSelectedProduct = null;
  };

  window.resetBeliBarang = function() {
    window.beliItems = [];
    setBeliMode('existing');
    const toggle = document.getElementById('toggleKurangiSaldo');
    if (toggle) toggle.checked = false;
    const listEl = document.getElementById('beliItemsList');
    if (listEl) { listEl.style.display = 'none'; listEl.innerHTML = ''; }
    updateBeliTotalPreview();
  };

  window.getBeliRounding = function() {
    const base = window.beliItems.reduce((sum, item) => sum + item.total, 0);
    const step = parseInt(document.getElementById('beliPembulatan')?.value, 10) || 0;
    const manual = parseInt(document.getElementById('beliTotalKas')?.value, 10) || 0;
    const rounded = step > 0 ? Math.ceil(base / step) * step : base;
    const total = window.beliTotalKasEdited && manual > 0 ? manual : rounded;
    return { base, step, amount: total - base, total };
  };

  window.applyBeliRounding = function() {
    const base = window.beliItems.reduce((sum, item) => sum + item.total, 0);
    const step = parseInt(document.getElementById('beliPembulatan')?.value, 10) || 0;
    const rounded = step > 0 ? Math.ceil(base / step) * step : base;
    const input = document.getElementById('beliTotalKas');
    if (input) input.value = rounded || '';
    window.beliTotalKasEdited = false;
    updateBeliTotalPreview();
  };

  window.updateBeliTotalPreview = function() {
    const rounding = getBeliRounding();
    const input = document.getElementById('beliTotalKas');
    if (input && !window.beliTotalKasEdited) input.value = rounding.total || '';
    const totalPrev = document.getElementById('beliTotalPreview');
    if (totalPrev) totalPrev.textContent = formatRupiah(rounding.total);
    const note = document.getElementById('beliRoundingPreview');
    if (note) note.textContent = `Pembulatan: ${rounding.amount > 0 ? '+' : ''}${formatRupiah(rounding.amount)}`;
  };

  window.addBeliItem = function() {
    const supplier = document.getElementById('beliSupplier')?.value.trim() || 'Supplier Umum';
    const qty = parseInt(document.getElementById('beliQty')?.value) || 0;
    const hargaBeli = parseInt(document.getElementById('beliHarga')?.value) || 0;
    const resellerPrice = parseInt(document.getElementById('beliResellerPrice')?.value) || 0;
    const normalPrice = parseInt(document.getElementById('beliNormalPrice')?.value) || 0;

    if (qty < 1 || hargaBeli < 1) {
      showToast('Qty dan harga beli harus lebih dari 0', 'error');
      return;
    }

    let itemData = {
      id: 'item_' + Date.now(),
      supplier: supplier,
      qty: qty,
      hargaBeli: hargaBeli,
      normalPrice: normalPrice,
      resellerPrice: resellerPrice,
      total: qty * hargaBeli,
      mode: window.beliMode
    };

    if (window.beliMode === 'existing') {
      if (!window.beliSelectedProduct) {
        showToast('Pilih produk terlebih dahulu', 'error');
        return;
      }
      itemData.productId = window.beliSelectedProduct.id;
      itemData.productName = window.beliSelectedProduct.name;
      itemData.isNewProduct = false;
    } else {
      const newName = document.getElementById('beliNewName')?.value.trim() || '';
      const newSellPrice = parseInt(document.getElementById('beliNewSellPrice')?.value) || 0;
      if (!newName) { showToast('Nama produk baru wajib diisi', 'error'); return; }
      if (newSellPrice < 1) { showToast('Harga jual produk baru wajib diisi', 'error'); return; }

      itemData.productName = newName;
      itemData.sellingPrice = newSellPrice;
      itemData.normalPrice = newSellPrice;
      itemData.categoryId = document.getElementById('beliNewCategory')?.value || null;
      const selectedCat = (window.categories || []).find(c => c.id === itemData.categoryId);
      itemData.categoryName = selectedCat ? (selectedCat.name || selectedCat.title || '') : '';
      itemData.isNewProduct = true;
    }

    window.beliItems.push(itemData);
    renderBeliItemsList();
    updateBeliTotalPreview();

    // Reset input satuan item
    ['beliQty', 'beliHarga', 'beliResellerPrice', 'beliNormalPrice'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    if (window.beliMode === 'existing') {
      const searchEl = document.getElementById('beliSearch');
      if (searchEl) searchEl.value = '';
      window.beliSelectedProduct = null;
    } else {
      const newNameEl = document.getElementById('beliNewName');
      const newSellEl = document.getElementById('beliNewSellPrice');
      if (newNameEl) newNameEl.value = '';
      if (newSellEl) newSellEl.value = '';
    }

    showToast(`${itemData.productName} ditambahkan (${qty} pcs)`, 'success');
  };

  window.renderBeliItemsList = function() {
    const container = document.getElementById('beliItemsList');
    if (!container) return;

    if (window.beliItems.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'block';
    container.innerHTML = window.beliItems.map((item, index) => `
      <div class="beli-item-row">
        <span class="bi-name">${item.productName}</span>
        <span class="bi-info">${item.qty} x ${formatRupiah(item.hargaBeli)}</span>
        <button class="bi-remove" onclick="removeBeliItem(${index})" title="Hapus"><i class="fas fa-times"></i></button>
      </div>`).join('');
  };

  window.removeBeliItem = function(index) {
    window.beliItems.splice(index, 1);
    renderBeliItemsList();
    updateBeliTotalPreview();
  };

  window.saveBeliBarang = async function() {
    if (window.beliItems.length === 0) { showToast('Belum ada item yang ditambahkan', 'error'); return; }
    if (!navigator.onLine) { showToast('Pembelian harus dilakukan saat online', 'error'); return; }

    const loadingEl = document.getElementById('loadingOverlay');
    if (loadingEl) loadingEl.classList.add('active');

    try {
      const db = createFirestoreCompat();
      const user = firebase.auth().currentUser;
      const timestamp = Date.now();
      const todayStr = new Date().toISOString().split('T')[0];
      const purchaseId = 'PUR' + timestamp;
      const kurangiSaldo = document.getElementById('toggleKurangiSaldo')?.checked || false;
      const rounding = getBeliRounding();
      const grandTotal = rounding.total;

      const savedItems = [];
      for (const item of window.beliItems) {
        let productId;
        if (item.mode === 'existing') {
          productId = item.productId;
          const prodRef = db.ref('products/' + productId);
          const snap = await prodRef.once('value');
          const prod = snap.val();
          if (prod) {
            const updates = { stock: (prod.stock || 0) + item.qty, costPrice: item.hargaBeli, updatedAt: timestamp };
            if (item.normalPrice > 0) updates.sellingPrice = item.normalPrice;
            if (item.resellerPrice > 0) updates.resellerPrice = item.resellerPrice;
            await prodRef.update(updates);
          }
        } else {
          const newRef = db.ref('products').push();
          productId = newRef.key;
          await newRef.set({
            name: item.productName,
            costPrice: item.hargaBeli,
            sellingPrice: item.normalPrice || item.sellingPrice,
            resellerPrice: item.resellerPrice || 0,
            stock: item.qty,
            createdAt: timestamp,
            updatedAt: timestamp,
            categoryId: item.categoryId || null,
            category: item.categoryName || 'Uncategorized',
            status: 'active'
          });
        }
        savedItems.push({
          productId: productId, productName: item.productName, qty: item.qty,
          harga: item.hargaBeli, sellingPrice: item.normalPrice || item.sellingPrice || 0,
          resellerPrice: item.resellerPrice || 0, total: item.total, isNewProduct: item.isNewProduct
        });
      }

      // Simpan ke purchases/
      await db.ref('purchases/' + todayStr + '/' + purchaseId).set({
        id: purchaseId, type: 'pembelian', supplier: window.beliItems[0].supplier,
        items: savedItems, subtotal: rounding.base, rounding: rounding.amount,
        totalItem: savedItems.reduce((sum, i) => sum + i.qty, 0), grandTotal: grandTotal,
        catatan: 'Input dari Kasir', timestamp: timestamp, date: todayStr,
        userId: user ? user.uid : 'unknown', userName: document.getElementById('userName')?.textContent || 'Kasir',
        status: 'completed'
      });

      // Jika opsi kurangi saldo aktif, catat ke kas_keluar
      if (kurangiSaldo) {
        const kasId = 'KASOUT' + timestamp;
        await db.ref('transactions/' + todayStr + '/' + kasId).set({
          type: 'kas_keluar', status: 'completed', amount: grandTotal,
          description: 'Pembelian: ' + savedItems.map(i => i.productName + ' (' + i.qty + ' pcs)').join(', '),
          category: 'pembelian', relatedPurchaseId: purchaseId, timestamp: timestamp,
          date: todayStr, userId: user ? user.uid : 'unknown', userName: document.getElementById('userName')?.textContent || 'Kasir'
        });
      }

      await Promise.all([loadProducts(), loadHeaderStats(), loadUangGlobal()]);
      closeModalBeli();
      if (loadingEl) loadingEl.classList.remove('active');
      showToast('Pembelian berhasil disimpan!', 'success');
    } catch (err) {
      console.error('Beli barang error:', err);
      if (loadingEl) loadingEl.classList.remove('active');
      showToast('Gagal menyimpan pembelian: ' + err.message, 'error');
    }
  };

  // Event Listeners Action Bar
  document.addEventListener("DOMContentLoaded", () => {
    const btnManual = document.getElementById('btnManual');
    if (btnManual) btnManual.addEventListener('click', openManualModal);

    const manualModal = document.getElementById('manualModal');
    if (manualModal) {
      manualModal.addEventListener('click', (e) => {
        if (e.target === manualModal) closeManualModal();
      });
    }

    // Search existing product di modal beli barang
    const beliSearchInput = document.getElementById('beliSearch');
    const beliSearchList = document.getElementById('beliSearchList');

    if (beliSearchInput && beliSearchList) {
      beliSearchInput.addEventListener('input', function() {
        const q = this.value.toLowerCase().trim();
        if (q.length < 1) { beliSearchList.style.display = 'none'; return; }
        const filtered = (window.products || []).filter(p => p.name.toLowerCase().includes(q));
        if (filtered.length > 0) {
          beliSearchList.innerHTML = filtered.map(p => `
            <div class="beli-search-item" data-id="${p.id}" data-name="${p.name}" data-cost="${p.costPrice || 0}" data-normal="${p.sellingPrice || 0}" data-reseller="${getResellerPrice(p) || 0}">
              <div class="bs-name">${p.name}</div>
              <div class="bs-info">Stok: ${p.stock || 0} | Beli: ${formatRupiah(p.costPrice || 0)}</div>
            </div>`).join('');
          beliSearchList.style.display = 'block';

          beliSearchList.querySelectorAll('.beli-search-item').forEach(item => {
            item.addEventListener('click', function() {
              window.beliSelectedProduct = {
                id: this.dataset.id, name: this.dataset.name,
                costPrice: parseInt(this.dataset.cost) || 0,
                normalPrice: parseInt(this.dataset.normal) || 0,
                resellerPrice: parseInt(this.dataset.reseller) || 0
              };
              beliSearchInput.value = this.dataset.name;
              document.getElementById('beliSelectedId').value = this.dataset.id;
              document.getElementById('beliHarga').value = window.beliSelectedProduct.costPrice;
              document.getElementById('beliNormalPrice').value = window.beliSelectedProduct.normalPrice || '';
              document.getElementById('beliResellerPrice').value = window.beliSelectedProduct.resellerPrice || '';
              beliSearchList.style.display = 'none';
              document.getElementById('beliQty')?.focus();
            });
          });
        } else {
          beliSearchList.innerHTML = '<div class="beli-search-item" style="color:var(--text-muted)">Produk tidak ditemukan</div>';
          beliSearchList.style.display = 'block';
        }
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.beli-search-wrap')) beliSearchList.style.display = 'none';
      });
    }
  });

})();
