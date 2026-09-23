(function() {
  "use strict";

  // State Keranjang Global
  window.cart = [];
  let currentEditProductId = null;

  // ===== NORMALISASI & KALKULASI KERANJANG =====
  window.normalizeCart = function() {
    window.cart = Array.isArray(window.cart) ? window.cart.map(function(i) {
      var price = toMoney(i.price), cost = toMoney(i.cost), quantity = Math.max(1, toMoney(i.quantity) || 1);
      return Object.assign({}, i, { price: price, cost: cost, quantity: quantity, total: price * quantity });
    }) : [];
  };

  window.getCartSubtotal = function() {
    return window.cart.reduce(function(s, i) {
      return s + toMoney(i.price) * Math.max(0, toMoney(i.quantity));
    }, 0);
  };

  window.getCartProfit = function() {
    return window.cart.reduce(function(s, i) {
      return s + (toMoney(i.price) - toMoney(i.cost)) * Math.max(0, toMoney(i.quantity));
    }, 0);
  };

  window.calculateTotal = function() {
    return window.getCartSubtotal();
  };

  // ===== AKSI KERANJANG (TAMBAH, UPDATE, HAPUS) =====
  window.addToCart = function(productId) {
    const product = window.products.find(p => p.id === productId);
    if (!product) return;

    const isUnlimited = product.isUnlimited === true;
    if (!isUnlimited && product.stock <= 0) {
      showToast('Produk habis', 'warning');
      return;
    }

    const existing = window.cart.find(i => i.productId === productId);
    if (existing) {
      if (!isUnlimited && existing.quantity + 1 > product.stock) {
        showToast('Stok tidak mencukupi', 'warning');
        return;
      }
      existing.quantity++;
      existing.total = existing.quantity * existing.price;
    } else {
      window.cart.push({
        productId: product.id,
        name: product.name,
        price: getProductPrice(product),
        regularPrice: toMoney(product.sellingPrice),
        resellerPrice: getResellerPrice(product),
        priceType: window.resellerMode ? 'reseller' : 'regular',
        cost: toMoney(product.costPrice || 0),
        quantity: 1,
        total: getProductPrice(product),
        image: getProductImage(product),
        isUnlimited: isUnlimited
      });
    }

    saveCart();
    renderCart();
    updateSummary();
    showToast(`${product.name} ditambahkan`, 'success');
  };

  window.updateQty = function(productId, delta) {
    const item = window.cart.find(i => i.productId === productId);
    if (!item) return;

    const product = window.products.find(p => p.id === productId);
    const newQty = item.quantity + delta;

    if (newQty <= 0) {
      removeFromCart(productId);
      return;
    }

    if (!item.isUnlimited && product && newQty > product.stock) {
      showToast('Stok tidak mencukupi', 'warning');
      return;
    }

    item.quantity = newQty;
    item.total = toMoney(item.quantity) * toMoney(item.price);
    saveCart();
    renderCart();
    updateSummary();
  };

  window.editQtyDirect = function(productId, rawValue) {
    const item = window.cart.find(i => i.productId === productId);
    if (!item) return;

    let newQty = parseInt(rawValue.toString().replace(/\D/g, '')) || 0;
    if (newQty < 1) newQty = 1;

    const product = window.products.find(p => p.id === productId);
    if (!item.isUnlimited && product && newQty > product.stock) {
      showToast('Stok tidak mencukupi (tersisa ' + product.stock + ')', 'warning');
      newQty = product.stock;
    }

    item.quantity = newQty;
    item.total = toMoney(item.quantity) * toMoney(item.price);
    saveCart();
    renderCart();
    updateSummary();
  };

  window.removeFromCart = function(productId) {
    window.cart = window.cart.filter(i => i.productId !== productId);
    saveCart();
    renderCart();
    updateSummary();
  };

  // ===== RENDER TAMPILAN KERANJANG =====
  window.renderCart = function() {
    const container = document.getElementById('cartItems');
    if (!container) return;

    const totalItems = window.cart.reduce((s, i) => s + toMoney(i.quantity), 0);
    const badgeCount = document.getElementById('cartCount');
    const badgeFloat = document.getElementById('cartBadge');
    if (badgeCount) badgeCount.textContent = totalItems;
    if (badgeFloat) badgeFloat.textContent = totalItems;

    if (window.cart.length === 0) {
      container.innerHTML = `<div class="cart-empty">
                               <i class="fas fa-shopping-basket" style="font-size:2.5rem; margin-bottom:0.5rem; opacity:0.4;"></i>
                               <p>Keranjang masih kosong</p>
                               <p style="font-size:.75rem; margin-top:.25rem; color:var(--text-muted);">Klik produk untuk menambahkan</p>
                             </div>`;
      return;
    }

    container.innerHTML = window.cart.map(item => `
      <div class="cart-item">
        <button class="cart-item-edit" onclick="openEditCartModal('${item.productId}')" title="Edit Item">
          <i class="fas fa-pen"></i>
        </button>
        <div class="cart-item-image">
          ${item.image ? `<img src="${item.image}" alt="${item.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><i class="fas fa-box" style="display:none;"></i>` : '<i class="fas fa-box"></i>'}
        </div>
        <div class="cart-item-details">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">${formatRupiah(item.price)}</div>
          <div class="cart-item-actions">
            <button class="qty-btn" onclick="updateQty('${item.productId}', -1)">-</button>
            <input type="text" class="qty-input" value="${item.quantity}" onchange="editQtyDirect('${item.productId}', this.value)" onclick="this.select()">
            <button class="qty-btn" onclick="updateQty('${item.productId}', 1)">+</button>
          </div>
        </div>
        <div class="cart-item-total">${formatRupiah(item.total)}</div>
        <button class="cart-item-remove" onclick="removeFromCart('${item.productId}')" title="Hapus">
          <i class="fas fa-times"></i>
        </button>
      </div>`).join('');
  };

  window.updateSummary = function() {
    const subtotal = getCartSubtotal();
    const subtotalEl = document.getElementById('subtotal');
    const totalEl = document.getElementById('total');
    if (subtotalEl) subtotalEl.textContent = formatRupiah(subtotal);
    if (totalEl) totalEl.textContent = formatRupiah(subtotal);
  };

  window.saveCart = function() {
    try { localStorage.setItem('kasir_cart', JSON.stringify(window.cart)); } catch (e) {}
  };

  window.loadCart = function() {
    try {
      const savedCart = JSON.parse(localStorage.getItem('kasir_cart') || '[]');
      if (Array.isArray(savedCart)) window.cart = savedCart;
      normalizeCart();
    } catch (e) { window.cart = []; }
    renderCart();
    updateSummary();
  };

  // ===== MODAL EDIT ITEM KERANJANG =====
  window.openEditCartModal = function(productId) {
    const item = window.cart.find(i => i.productId === productId);
    if (!item) return;
    currentEditProductId = productId;

    document.getElementById('editCartName').value = item.name;
    document.getElementById('editCartCost').value = item.cost || 0;
    document.getElementById('editCartPrice').value = item.price;
    document.getElementById('editCartQty').value = item.quantity;

    calculateEditProfit();
    const modal = document.getElementById('editCartModal');
    if (modal) modal.classList.add('active');
  };

  window.closeEditCartModal = function() {
    const modal = document.getElementById('editCartModal');
    if (modal) modal.classList.remove('active');
    currentEditProductId = null;
  };

  window.calculateEditProfit = function() {
    const cost = parseInt(document.getElementById('editCartCost').value) || 0;
    const price = parseInt(document.getElementById('editCartPrice').value) || 0;
    const qty = parseInt(document.getElementById('editCartQty').value) || 1;

    const profitPerItem = price - cost;
    const totalProfit = profitPerItem * qty;
    const totalPrice = price * qty;

    const profitEl = document.getElementById('editProfitDisplay');
    if (profitEl) {
      profitEl.textContent = `Laba per item: ${formatRupiah(profitPerItem)} | Total: ${formatRupiah(totalProfit)}`;
      profitEl.style.color = profitPerItem >= 0 ? 'var(--success)' : 'var(--danger)';
    }
    const totalEl = document.getElementById('editTotalDisplay');
    if (totalEl) totalEl.textContent = formatRupiah(totalPrice);
  };

  window.confirmEditCart = function() {
    if (!currentEditProductId) return;
    const cost = parseInt(document.getElementById('editCartCost').value) || 0;
    const price = parseInt(document.getElementById('editCartPrice').value) || 0;
    const qty = parseInt(document.getElementById('editCartQty').value) || 1;

    if (price <= 0) { showToast('Harga jual harus > 0', 'error'); return; }
    if (qty <= 0) { showToast('Quantity minimal 1', 'error'); return; }

    const itemIndex = window.cart.findIndex(i => i.productId === currentEditProductId);
    if (itemIndex === -1) return;

    window.cart[itemIndex].cost = cost;
    window.cart[itemIndex].price = price;
    window.cart[itemIndex].quantity = qty;
    window.cart[itemIndex].total = price * qty;

    saveCart();
    renderCart();
    updateSummary();
    closeEditCartModal();
    showToast(`${window.cart[itemIndex].name} berhasil diupdate`, 'success');
  };

  // Event Listeners Keranjang
  document.addEventListener("DOMContentLoaded", () => {
    const btnClear = document.getElementById('btnClearCart');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (window.cart.length === 0) return;
        if (confirm('Yakin ingin mengosongkan keranjang?')) {
          window.cart = [];
          saveCart();
          renderCart();
          updateSummary();
          showToast('Keranjang dikosongkan', 'info');
        }
      });
    }

    const cartToggle = document.getElementById('cartToggle');
    const minimizeCart = document.getElementById('btnMinimizeCart');
    const cartSection = document.getElementById('cartSection');

    if (cartToggle && cartSection) {
      cartToggle.addEventListener('click', () => cartSection.classList.add('open'));
    }
    if (minimizeCart && cartSection) {
      minimizeCart.addEventListener('click', () => cartSection.classList.remove('open'));
    }
  });

})();
