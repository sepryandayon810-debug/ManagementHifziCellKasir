(function() {
  "use strict";

  // State Produk & Kategori Global
  window.products = [];
  window.categories = [];
  window.currentCategory = 'all';
  window.currentSort = 'az';
  window.currentView = localStorage.getItem('webpos_kasir_view') || 'list';
  window.resellerMode = false;
  window.selectedResellerName = '';

  // ===== HELPER HARGA & GAMBAR =====
  window.getResellerPrice = function(product) {
    if (!product) return null;
    var candidates = [
      product.resellerPrice, product.priceReseller, product.hargaReseller, 
      product.reseller_price, product.prices && product.prices.reseller, 
      product.reseller && (product.reseller.price || product.reseller.sellingPrice || product.reseller.hargaJual)
    ];
    for (var i = 0; i < candidates.length; i++) {
      var price = toMoney(candidates[i]);
      if (price > 0) return price;
    }
    return null;
  };

  window.getProductPrice = function(product) {
    var rp = getResellerPrice(product);
    return window.resellerMode && rp !== null ? rp : toMoney(product && product.sellingPrice);
  };

  window.getProductImage = function(product) {
    if (!product) return null;
    var value = product.image || product.imageUrl || product.imageURL || product.photoUrl || product.photoURL || product.photo || product.foto || product.gambar || product.thumbnail || product.imageBase64;
    if (value && typeof value === 'object') value = value.url || value.downloadURL || value.src || value.path || null;
    return value ? String(value) : null;
  };

  // ===== RESELLER MODE UI =====
  window.updateResellerModeUI = function() {
    var normal = document.getElementById('btnNormalMode');
    var reseller = document.getElementById('btnResellerMode');
    if (!normal || !reseller) return;
    normal.classList.toggle('active', !window.resellerMode);
    reseller.classList.toggle('active', window.resellerMode);
    normal.setAttribute('aria-pressed', window.resellerMode ? 'false' : 'true');
    reseller.setAttribute('aria-pressed', window.resellerMode ? 'true' : 'false');
  };

  window.setResellerMode = function(nextMode) {
    if (nextMode && !window.products.some(function(p) { return getResellerPrice(p) !== null; })) {
      showToast('Belum ada harga reseller', 'warning');
      return;
    }
    if (window.cart && window.cart.length > 0) {
      showToast('Kosongkan keranjang dulu', 'warning');
      return;
    }
    window.resellerMode = !!nextMode;
    updateResellerModeUI();
    renderProducts();
  };

  // ===== LOAD DATA KATEGORI & PRODUK =====
  window.loadCategories = async function() {
    if (!navigator.onLine) {
      try {
        const saved = localStorage.getItem('kasir_categories');
        if (saved) window.categories = JSON.parse(saved);
      } catch (e) {}
      renderCategoryGrid();
      if (typeof window.populateBeliCategoryOptions === 'function') window.populateBeliCategoryOptions();
      return;
    }

    try {
      const snap = await createFirestoreCompat().ref('categories').once('value');
      const data = snap.val() || {};
      window.categories = Object.entries(data).map(([id, d]) => ({ id, ...d }));
      try { localStorage.setItem('kasir_categories', JSON.stringify(window.categories)); } catch (err) {}
      renderCategoryGrid();
      if (typeof window.populateBeliCategoryOptions === 'function') window.populateBeliCategoryOptions();
    } catch (e) {
      console.error('Error loading categories:', e);
    }
  };

  window.loadProducts = async function() {
    if (!navigator.onLine) {
      if (typeof window.getProductsFromCache === 'function') {
        const cached = await window.getProductsFromCache();
        if (cached.length > 0) {
          window.products = cached;
          renderProducts();
          showToast('Produk dari cache offline', 'warning');
          return;
        }
      }
      renderProducts();
      return;
    }

    try {
      const snap = await createFirestoreCompat().ref('products').once('value');
      const data = snap.val() || {};
      window.products = Object.entries(data)
        .map(([id, d]) => ({ id, ...d }))
        .filter(p => p.status !== 'inactive');
      renderProducts();
      if (typeof window.saveProductsToCache === 'function') {
        try { await window.saveProductsToCache(window.products); } catch (err) {}
      }
    } catch (e) {
      console.error('Error loading products:', e);
      if (typeof window.getProductsFromCache === 'function') {
        const cached = await window.getProductsFromCache();
        if (cached.length > 0) {
          window.products = cached;
          renderProducts();
          showToast('Produk dari cache offline', 'warning');
        }
      }
    }
  };

  // ===== LAYERED NAVIGATION & RENDER GRID/LIST =====
  window.renderCategoryGrid = function() {
    const grid = document.getElementById('categoryGrid');
    const countEl = document.getElementById('categoryCount');
    if (!grid) return;
    if (countEl) countEl.textContent = window.categories.length + ' kategori';

    const countByCategory = {};
    window.products.forEach(function(p) {
      if (p.categoryId) countByCategory[p.categoryId] = (countByCategory[p.categoryId] || 0) + 1;
    });

    var allCount = window.products.length;
    var html = `<button class="cat-grid-btn" onclick="showLayerProduk('all','Semua Produk','📦')">
                  <div class="cat-grid-icon">📦</div>
                  <span class="cat-grid-name">Semua</span>
                  <span class="cat-grid-badge">${allCount}</span>
                </button>`;

    window.categories.forEach(function(cat) {
      var count = countByCategory[cat.id] || 0;
      var icon = cat.icon || '🏷️';
      var safeName = cat.name.replace(/'/g, "\\'");
      html += `<button class="cat-grid-btn" onclick="showLayerProduk('${cat.id}','${safeName}','${icon}')">
                 <div class="cat-grid-icon">${icon}</div>
                 <span class="cat-grid-name">${cat.name}</span>
                 ${count > 0 ? `<span class="cat-grid-badge">${count}</span>` : ''}
               </button>`;
    });

    grid.innerHTML = html;
  };

  window.showLayerProduk = function(categoryId, categoryName, icon) {
    window.currentCategory = categoryId;
    var iconEl = document.getElementById('activeCatIcon');
    var nameEl = document.getElementById('activeCatName');
    if (iconEl) iconEl.textContent = icon + ' ';
    if (nameEl) nameEl.textContent = categoryName;
    document.getElementById('layerKategori').style.display = 'none';
    document.getElementById('layerProduk').style.display = 'block';
    renderProducts();
  };

  window.showLayerKategori = function() {
    document.getElementById('layerProduk').style.display = 'none';
    document.getElementById('layerKategori').style.display = 'block';
    var s = document.getElementById('productSearch');
    if (s) s.value = '';
    window.currentCategory = 'all';
  };

  window.applyCurrentView = function() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    grid.classList.toggle('list-view', window.currentView === 'list');
    document.querySelectorAll('.view-btn').forEach(btn => {
      const active = btn.dataset.view === window.currentView;
      btn.classList.toggle('active', active);
    });
  };

  window.renderProducts = function() {
    const container = document.getElementById('productsGrid');
    if (!container) return;
    let filtered = [...window.products];

    if (window.currentCategory !== 'all') {
      filtered = filtered.filter(p => p.categoryId === window.currentCategory);
    }

    const searchInput = document.getElementById('productSearch');
    const q = searchInput ? searchInput.value.toLowerCase() : '';
    if (q) {
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) || (p.code && p.code.toLowerCase().includes(q))
      );
    }

    if (window.currentSort === 'az') {
      filtered.sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
    } else if (window.currentSort === 'za') {
      filtered.sort((a, b) => b.name.localeCompare(a.name, 'id', { sensitivity: 'base' }));
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">
                               <i class="fas fa-search" style="font-size:2.5rem;margin-bottom:0.75rem;opacity:.4;display:block;"></i>
                               <p>Produk tidak ditemukan</p>
                             </div>`;
      return;
    }

    container.innerHTML = filtered.map(p => {
      const isUnlimited = p.isUnlimited === true;
      const displayPrice = getProductPrice(p);
      const imageUrl = getProductImage(p);
      const hasResellerPrice = getResellerPrice(p) !== null;

      let stockClass = '', stockText = isUnlimited ? '∞' : p.stock;
      if (!isUnlimited) {
        if (p.stock <= 0) { stockClass = 'empty'; stockText = 'Habis'; }
        else if (p.stock <= 5) { stockClass = 'low'; }
      }

      return `<div class="product-card" onclick="addToCart('${p.id}')" style="${p.stock <= 0 && !isUnlimited ? 'opacity:0.6;pointer-events:none;' : ''}">
                <div class="product-card-image">
                  ${imageUrl ? `<img src="${imageUrl}" alt="${p.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><i class="fas fa-box" style="display:none;"></i>` : '<i class="fas fa-box"></i>'}
                  <span class="product-stock-badge ${stockClass}">${stockText}</span>
                </div>
                <div class="product-card-info">
                  <div class="product-card-name">${p.name}</div>
                  <div class="product-card-price">${formatRupiah(displayPrice)}${window.resellerMode && hasResellerPrice ? '<small class="reseller-price-note">Reseller</small>' : ''}</div>
                  ${p.code ? `<div class="product-card-code">${p.code}</div>` : ''}
                </div>
              </div>`;
    }).join('');
    applyCurrentView();
  };

  // ===== LONG PRESS QUICK EDIT =====
  let longPressTimer = null;
  let currentQuickEditId = null;

  window.initLongPressOnProducts = function() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    const triggerEdit = (targetEl) => {
      const card = targetEl.closest('.product-card');
      if (!card || card.classList.contains('skeleton')) return;
      const m = card.getAttribute('onclick')?.match(/addToCart\('([^']+)'\)/);
      if (m) openProductQuickModal(m[1]);
    };

    grid.addEventListener('mousedown', (e) => {
      const card = e.target.closest('.product-card');
      if (!card) return;
      const m = card.getAttribute('onclick')?.match(/addToCart\('([^']+)'\)/);
      if (m) longPressTimer = setTimeout(() => openProductQuickModal(m[1]), 800);
    });
    grid.addEventListener('mouseup', () => clearTimeout(longPressTimer));
    grid.addEventListener('mouseleave', () => clearTimeout(longPressTimer));

    grid.addEventListener('touchstart', (e) => {
      const card = e.target.closest('.product-card');
      if (!card) return;
      const m = card.getAttribute('onclick')?.match(/addToCart\('([^']+)'\)/);
      if (m) longPressTimer = setTimeout(() => openProductQuickModal(m[1]), 800);
    }, {passive: true});
    grid.addEventListener('touchend', () => clearTimeout(longPressTimer));
    grid.addEventListener('touchmove', () => clearTimeout(longPressTimer));
  };

  window.openProductQuickModal = function(productId) {
    const p = window.products.find(x => x.id === productId);
    if (!p) return;
    currentQuickEditId = productId;

    document.getElementById('quickEditName').value = p.name || '';
    document.getElementById('quickEditCost').value = p.costPrice || 0;
    document.getElementById('quickEditPrice').value = p.sellingPrice || 0;

    const isUnlimited = p.isUnlimited === true;
    const stockInput = document.getElementById('quickEditStock');
    const unlimitedLabel = document.getElementById('quickEditUnlimitedLabel');

    if (isUnlimited) {
      stockInput.value = 999999; stockInput.disabled = true;
      if (unlimitedLabel) unlimitedLabel.style.display = 'block';
    } else {
      stockInput.value = p.stock || 0; stockInput.disabled = false;
      if (unlimitedLabel) unlimitedLabel.style.display = 'none';
    }

    const modal = document.getElementById('productQuickModal');
    if (modal) modal.classList.add('active');
  };

  window.closeProductQuickModal = function() {
    const modal = document.getElementById('productQuickModal');
    if (modal) modal.classList.remove('active');
    currentQuickEditId = null;
  };

  window.saveProductQuickEdit = async function() {
    if (!currentQuickEditId) return;
    const cost = parseInt(document.getElementById('quickEditCost').value) || 0;
    const price = parseInt(document.getElementById('quickEditPrice').value) || 0;
    const stock = parseInt(document.getElementById('quickEditStock').value) || 0;
    const name = document.getElementById('quickEditName').value.trim();

    if (price <= 0) { showToast('Harga jual harus > 0', 'error'); return; }

    try {
      document.getElementById('loadingOverlay').classList.add('active');
      const db = createFirestoreCompat();
      const updates = { name: name, costPrice: cost, sellingPrice: price, updatedAt: Date.now() };

      const p = window.products.find(x => x.id === currentQuickEditId);
      if (p && p.isUnlimited !== true) updates.stock = stock;

      await db.ref('products/' + currentQuickEditId).update(updates);
      if (p) {
        p.name = name; p.costPrice = cost; p.sellingPrice = price;
        if (p.isUnlimited !== true) p.stock = stock;
      }

      renderProducts();
      closeProductQuickModal();
      document.getElementById('loadingOverlay').classList.remove('active');
      showToast('Produk diperbarui & tersinkron', 'success');
    } catch (e) {
      document.getElementById('loadingOverlay').classList.remove('active');
      showToast('Gagal simpan: ' + e.message, 'error');
    }
  };

  // Event Listeners Toolbar
  document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById('productSearch');
    if (searchInput) {
      let searchTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderProducts, 300);
      });
    }

    const normalBtn = document.getElementById('btnNormalMode');
    const resellerBtn = document.getElementById('btnResellerMode');
    if (normalBtn) normalBtn.addEventListener('click', () => setResellerMode(false));
    if (resellerBtn) resellerBtn.addEventListener('click', () => setResellerMode(true));

    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window.currentView = btn.dataset.view;
        localStorage.setItem('webpos_kasir_view', window.currentView);
        applyCurrentView();
      });
    });

    initLongPressOnProducts();
  });

})();
