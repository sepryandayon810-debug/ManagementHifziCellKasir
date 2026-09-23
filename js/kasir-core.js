(function() {
  "use strict";

  // ===== 1. FIRESTORE COMPATIBILITY LAYER =====
  window.createFirestoreCompat = function() {
    const firestore = firebase.firestore();
    function makeRef(path) {
      const clean = String(path).replace(/^\/+|\/+$\vert{}\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
      const parts = clean.split('/');
      let target;
      if (parts[0] === 'transactions' && parts.length === 2) target = firestore.collection('transactions').where('date', '==', parts[1]);
      else if (parts[0] === 'modal' && parts.length === 3) target = firestore.collection('modal').doc(parts[1] + '_' + parts[2]);
      else if ((parts[0] === 'transactions' || parts[0] === 'purchases') && parts.length === 3) target = firestore.collection(parts[0]).doc(parts[2]);
      else if (parts.length === 1) target = firestore.collection(parts[0]);
      else target = firestore.collection(parts[0]).doc(parts[1]);
      
      function withPathFields(data) {
        const copy = Object.assign({}, data || {});
        if ((parts[0] === 'transactions' || parts[0] === 'purchases') && parts[1] && parts.length >= 3 && !copy.date) copy.date = parts[1];
        if (parts[0] === 'modal' && parts.length === 3 && !copy.date) copy.date = parts[1];
        return copy;
      }

      return {
        once: async function() {
          const snap = await target.get();
          if (snap.docs) { 
            const values = {}; 
            snap.docs.forEach(function(doc) { values[doc.id] = Object.assign({id:doc.id}, doc.data()); }); 
            return {val: function(){return values}}; 
          }
          return {val: function(){return snap.exists ? Object.assign({id:snap.id}, snap.data()) : null}};
        },
        set: function(data, options) { return target.set(withPathFields(data), options || undefined); },
        update: function(data) { return target.update(data); },
        push: function() { 
          const newDoc = firestore.collection(parts[0]).doc(); 
          return {key: newDoc.id, set: function(data){return newDoc.set(withPathFields(data))}}; 
        }
      };
    }
    return {ref: makeRef};
  };

  // ===== 2. UTILITIES GLOBAL =====
  window.formatRupiah = function(num) {
    return 'Rp ' + Math.round(num || 0).toLocaleString('id-ID');
  };

  window.toMoney = function(value) {
    const n = Number(String(value == null ? 0 : value).replace(/[^0-9-]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : 0;
  };

  window.showToast = function(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : type === 'warning' ? 'exclamation-circle' : 'info-circle'}"></i><span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  };

  window.toggleDropdown = function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const isOpen = el.classList.contains('open');
    document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!isOpen) el.classList.add('open');
  };

  // ===== 3. SINKRONISASI PENGATURAN & TEMA =====
  window.applyKasirSettings = function(data) {
    if (!data || typeof data !== 'object') return;
    var storeName = data.storeName || data.name || data.brandName || data.webName;
    var theme = data.theme || data.appearanceTheme || data.themeMode || data.mode;
    var color = data.themeColor || data.color || data.primaryColor || data.colorTheme || data.palette;

    if (storeName) {
      document.querySelectorAll('.logo-text').forEach(function(e) { e.textContent = storeName; });
      document.title = storeName + ' - Kasir';
      try { localStorage.setItem('webpos_store_name', storeName); } catch (e) {}
    }
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
      try { localStorage.setItem('webpos_theme', theme); } catch (e) {}
    }
    var colors = ['indigo','blue','green','orange','purple','red','pink','teal','sunset'];
    if (colors.indexOf(color) >= 0) {
      document.documentElement.setAttribute('data-theme-color', color);
      try { localStorage.setItem('webpos_theme_color', color); } catch (e) {}
    }
  };

  window.syncKasirSettings = async function() {
    try {
      applyKasirSettings({
        storeName: localStorage.getItem('webpos_store_name'),
        theme: localStorage.getItem('webpos_theme'),
        themeColor: localStorage.getItem('webpos_theme_color')
      });
    } catch (e) {}

    try {
      var settingDocs = await Promise.all(['store', 'general', 'theme', 'appearance'].map(function(id) {
        return firebase.firestore().collection('settings').doc(id).get();
      }));
      settingDocs.forEach(function(doc) { if (doc.exists) applyKasirSettings(doc.data()); });
    } catch (e) {}
  };

  // ===== 4. LOAD USER & SIDEBAR EVENTS =====
  window.loadUserData = function() {
    try {
      firebase.auth().onAuthStateChanged(user => {
        if (user) {
          createFirestoreCompat().ref('users/' + user.uid).once('value').then(snap => {
            const data = snap.val() || {};
            const name = data.name || user.email || 'Kasir';
            const role = data.role || 'kasir';
            const nameEl = document.getElementById('userName');
            const roleEl = document.getElementById('userRole');
            const avatarEl = document.getElementById('userAvatar');
            if (nameEl) nameEl.textContent = name;
            if (roleEl) roleEl.textContent = role.toUpperCase();
            if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
          });
        }
      });
    } catch (e) {}
  };

  document.addEventListener("DOMContentLoaded", () => {
    // Setup UI Sidebar Toggle & Logout
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebarBackdrop");
    const menuToggle = document.getElementById("menuToggle");
    const mobileMenuToggle = document.getElementById("mobileMenuToggle");

    if (menuToggle && sidebar) menuToggle.onclick = () => sidebar.classList.toggle("collapsed");
    if (mobileMenuToggle && sidebar && backdrop) {
      mobileMenuToggle.onclick = (e) => {
        e.stopPropagation();
        sidebar.classList.add("mobile-open");
        backdrop.classList.add("active");
      };
    }
    if (backdrop && sidebar) {
      backdrop.onclick = () => {
        sidebar.classList.remove("mobile-open");
        backdrop.classList.remove("active");
      };
    }

    const btnLogout = document.getElementById("btnLogout");
    if (btnLogout) {
      btnLogout.onclick = () => {
        if (confirm("Keluar dari sistem WebPOS?")) {
          firebase.auth().signOut().then(() => { window.location.href = "login.html"; });
        }
      };
    }
  });

})();
