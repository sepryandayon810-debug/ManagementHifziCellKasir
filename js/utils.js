// Utilitas Global & Manajemen UI WebPOS
const Utils = {
  escapeHtml: function(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  formatRupiah: function(num) {
    const val = Math.round(Number(num) || 0);
    return "Rp " + val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  },

  getTodayString: function() {
    const d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  },

  showToast: function(msg, type = "info") {
    let box = document.getElementById("toastContainer");
    if (!box) {
      box = document.createElement("div");
      box.id = "toastContainer";
      box.style.cssText = "position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;max-width:350px;";
      document.body.appendChild(box);
    }
    const t = document.createElement("div");
    t.style.cssText = `padding:0.85rem 1.25rem;background:#fff;border-radius:10px;box-shadow:0 10px 20px rgba(0,0,0,0.1);border-left:4px solid ${type === 'success' ? '#059669' : type === 'error' ? '#dc2626' : '#4f46e5'};font-size:0.85rem;font-weight:600;color:#0f172a;animation:fadeIn 0.2s ease;`;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  },

  showLoading: function(msg = "Memproses...") {
    let veil = document.getElementById("loadingVeil");
    if (!veil) {
      veil = document.createElement("div");
      veil.id = "loadingVeil";
      veil.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(3px);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9998;color:#fff;font-size:0.85rem;";
      veil.innerHTML = '<div style="width:40px;height:40px;border:4px solid #fff;border-top-color:#4f46e5;border-radius:50%;animation:spin 0.8s linear infinite;"></div><p style="margin-top:1rem;" id="loadingVeilMsg"></p>';
      document.body.appendChild(veil);
    }
    document.getElementById("loadingVeilMsg").textContent = msg;
    veil.style.display = "flex";
  },

  hideLoading: function() {
    const veil = document.getElementById("loadingVeil");
    if (veil) veil.style.display = "none";
  },

  confirm: function(msg, callback, opts) {
    if (window.WebPOSDialog && typeof window.WebPOSDialog.confirm === "function") {
      return window.WebPOSDialog.confirm(msg, callback, opts);
    }
    if (typeof callback === "function") callback();
  }
};

// ==============================================================
// 🛡️ PENCATAT LOG AUDIT (SUDAH DIPERBAIKI DETEKSI ROLE)
// ==============================================================
window.AuditLogger = {
  log: async function(action, detail, module = 'Kasir', targetDoc = '') {
    try {
      if (typeof firebase === 'undefined' || !firebase.firestore) return;
      const dbInstance = window.db || firebase.firestore();
      const user = (firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser : null;

      // 1. Ambil Nama User
      const userNameEl = document.getElementById('userName');
      const userName = (userNameEl && userNameEl.textContent !== 'Memuat...' && userNameEl.textContent !== 'Loading...') 
        ? userNameEl.textContent 
        : (user ? (user.displayName || user.email.split('@')[0]) : 'Sistem');

      // 2. Ambil Role User yang Akurat (Cek variabel -> Cek sidebar -> Cek Firestore)
      let userRole = window.currentUserRole || localStorage.getItem('webpos_user_role');
      
      // Jika belum ada, baca dari teks role di sidebar bawah
      if (!userRole) {
        const userRoleEl = document.getElementById('userRole');
        if (userRoleEl && userRoleEl.textContent && userRoleEl.textContent !== '-') {
          userRole = userRoleEl.textContent.trim().toLowerCase();
        }
      }

      // Jika masih belum dapat, tarik langsung dari Firestore
      if ((!userRole || userRole === 'kasir') && user) {
        try {
          const uDoc = await dbInstance.collection('users').doc(user.uid).get();
          if (uDoc.exists && uDoc.data() && uDoc.data().role) {
            userRole = uDoc.data().role.toLowerCase();
            window.currentUserRole = userRole;
            localStorage.setItem('webpos_user_role', userRole);
          }
        } catch (e) {}
      }

      userRole = userRole || 'kasir';

      // 3. Simpan ke koleksi audit_logs
      await dbInstance.collection('audit_logs').add({
        action: action,            
        detail: detail,            
        module: module,            
        targetDoc: targetDoc,      
        userName: userName,
        userEmail: user ? user.email : '',
        userId: user ? user.uid : '',
        userRole: userRole,        // Sekarang role akan benar: 'developer' / 'owner' / 'admin'
        timestamp: Date.now(),
        date: Utils.getTodayString(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
     console.log('🛡️ Log Audit berhasil disimpan sebagai:', userRole, action);
    } catch (err) {
      console.warn('Gagal mencatat log audit:', err);
    }
  }
};

// ==============================================================
// 👑 RIWAYAT & KONTROL KAS OWNER / DEVELOPER (EDIT & BATALKAN)
// ==============================================================
window.OwnerKasHistory = (function() {
  let _cfg = null;
  let _period = 'today';
  let _items = [];
  let _role = '';
  let _user = null;
  let _editingItem = null;
  let _deletingItem = null;

  function isOwnerDev() {
    return _role === 'owner' || _role === 'developer';
  }

  function isPrivilegedViewer() {
    return _role === 'owner' || _role === 'developer' || _role === 'admin';
  }

  function formatDateKey(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function getDateKeysForPeriod(period) {
    const now = new Date();
    if (period === 'today') return [formatDateKey(now)];
    if (period === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return [formatDateKey(y)];
    }
    const keys = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      keys.push(formatDateKey(d));
    }
    return keys;
  }

  function parseTxTime(tx) {
    const raw = tx.waktu || tx.timestamp || tx.createdAt;
    if (!raw) return 0;
    if (typeof raw === 'number') return raw;
    if (raw.seconds !== undefined) return raw.seconds * 1000;
    if (typeof raw.toDate === 'function') return raw.toDate().getTime();
    const t = new Date(raw).getTime();
    return isNaN(t) ? 0 : t;
  }

  function formatTxTimeLabel(tx) {
    const ms = parseTxTime(tx);
    if (!ms) return tx.date_key || tx.date || '-';
    const d = new Date(ms);
    const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const tgl = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    return jam + ' WIB • ' + tgl;
  }

  async function resolveRole() {
    const dbInst = window.db || (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);
    const authInst = window.auth || (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null);
    _user = authInst ? authInst.currentUser : null;

    let r = String(window.currentUserRole || localStorage.getItem('webpos_user_role') || '').trim().toLowerCase();
    const roleEl = document.getElementById('userRole');
    if (!r && roleEl && roleEl.textContent && roleEl.textContent.trim() !== '-') {
      r = roleEl.textContent.trim().toLowerCase();
    }
    if ((!r || r === 'kasir') && _user && dbInst) {
      try {
        const uDoc = await dbInst.collection('users').doc(_user.uid).get();
        if (uDoc.exists && uDoc.data() && uDoc.data().role) {
          r = String(uDoc.data().role).trim().toLowerCase();
          window.currentUserRole = r;
          localStorage.setItem('webpos_user_role', r);
        }
      } catch (e) {}
    }
    _role = r || 'kasir';
  }

  function injectStyles() {
    if (document.getElementById('ownerKasHistoryStyle')) return;
    const style = document.createElement('style');
    style.id = 'ownerKasHistoryStyle';
    style.textContent = `
      .okh-card { margin-top: 1.15rem; background: var(--bg-surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: var(--radius-lg, 14px); box-shadow: var(--shadow-sm, 0 2px 8px rgba(15,23,42,0.05)); overflow: hidden; }
      .okh-header { padding: 0.9rem 1.05rem; border-bottom: 1px solid var(--border, #e2e8f0); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
      .okh-title { font-size: 0.92rem; font-weight: 800; color: var(--text-main, #0f172a); display: flex; align-items: center; gap: 0.45rem; }
      .okh-owner-tag { font-size: 0.62rem; font-weight: 800; text-transform: uppercase; padding: 0.16rem 0.5rem; border-radius: 99px; background: rgba(79,70,229,0.12); color: var(--primary, #4f46e5); letter-spacing: 0.03em; }
      .okh-count-pill { font-size: 0.72rem; font-weight: 700; padding: 0.22rem 0.6rem; border-radius: 99px; background: var(--bg-subtle, #f1f5f9); color: var(--text-sub, #475569); border: 1px solid var(--border, #e2e8f0); white-space: nowrap; }
      .okh-toolbar { padding: 0.65rem 1rem; border-bottom: 1px solid var(--border, #e2e8f0); background: var(--bg-subtle, #f8fafc); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
      .okh-tabs { display: flex; gap: 0.35rem; }
      .okh-tab { border: 1px solid var(--border, #cbd5e1); background: var(--bg-surface, #fff); color: var(--text-sub, #475569); font-size: 0.72rem; font-weight: 700; padding: 0.32rem 0.7rem; border-radius: 99px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
      .okh-tab.active { background: var(--primary, #4f46e5); color: #fff; border-color: var(--primary, #4f46e5); }
      .okh-summary { font-size: 0.75rem; font-weight: 800; color: var(--text-main, #0f172a); }
      .okh-summary span { color: var(--primary, #4f46e5); }
      .okh-list { max-height: 460px; overflow-y: auto; }
      .okh-empty { padding: 2rem 1rem; text-align: center; color: var(--text-muted, #64748b); font-size: 0.8rem; }
      .okh-item { padding: 0.85rem 1rem; border-bottom: 1px solid var(--border, #e2e8f0); display: flex; flex-direction: column; gap: 0.4rem; transition: background 0.15s; }
      .okh-item:last-child { border-bottom: none; }
      .okh-item:hover { background: var(--bg-subtle, #f8fafc); }
      .okh-row-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.65rem; }
      .okh-note { font-size: 0.84rem; font-weight: 700; color: var(--text-main, #0f172a); line-height: 1.3; word-break: break-word; }
      .okh-amount-box { text-align: right; flex-shrink: 0; }
      .okh-amount { font-size: 0.9rem; font-weight: 800; white-space: nowrap; }
      .okh-amount.success { color: var(--success, #059669); }
      .okh-amount.danger { color: var(--danger, #dc2626); }
      .okh-admin-sub { font-size: 0.68rem; font-weight: 700; color: var(--success, #059669); white-space: nowrap; }
      .okh-row-meta { display: flex; align-items: center; justify-content: space-between; gap: 0.45rem; flex-wrap: wrap; font-size: 0.72rem; color: var(--text-muted, #64748b); }
      .okh-meta-left { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
      .okh-chip { display: inline-flex; align-items: center; gap: 0.2rem; font-size: 0.64rem; font-weight: 800; text-transform: uppercase; padding: 0.12rem 0.45rem; border-radius: 6px; background: var(--bg-subtle, #f1f5f9); border: 1px solid var(--border, #e2e8f0); color: var(--text-sub, #475569); }
      .okh-chip.utang { background: rgba(245,158,11,0.14); color: #b45309; border-color: rgba(245,158,11,0.3); }
      .okh-chip.bank { background: rgba(2,132,199,0.12); color: #0284c7; border-color: rgba(2,132,199,0.25); }
      .okh-actions { display: flex; justify-content: flex-end; gap: 0.4rem; padding-top: 0.25rem; }
      .okh-btn { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; font-weight: 700; padding: 0.34rem 0.7rem; border-radius: 8px; cursor: pointer; font-family: inherit; border: 1px solid transparent; transition: all 0.15s; }
      .okh-btn.edit { background: rgba(79,70,229,0.1); color: var(--primary, #4f46e5); border-color: rgba(79,70,229,0.22); }
      .okh-btn.edit:hover { background: var(--primary, #4f46e5); color: #fff; }
      .okh-btn.del { background: rgba(220,38,38,0.09); color: var(--danger, #dc2626); border-color: rgba(220,38,38,0.22); }
      .okh-btn.del:hover { background: var(--danger, #dc2626); color: #fff; }
      .okh-modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.65); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 1rem; z-index: 10060; opacity: 0; visibility: hidden; transition: all 0.2s ease; }
      .okh-modal-backdrop.open { opacity: 1; visibility: visible; }
      .okh-modal-card { background: var(--bg-surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 16px; width: 100%; max-width: 390px; padding: 1.35rem; box-shadow: 0 20px 40px rgba(15,23,42,0.25); color: var(--text-main, #0f172a); }
      .okh-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
      .okh-modal-title { font-size: 1rem; font-weight: 800; margin: 0; display: flex; align-items: center; gap: 0.45rem; }
      .okh-modal-close { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--border, #e2e8f0); background: var(--bg-subtle, #f1f5f9); color: var(--text-main, #0f172a); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
      .okh-field { margin-bottom: 0.85rem; }
      .okh-field label { display: block; font-size: 0.76rem; font-weight: 700; color: var(--text-sub, #475569); margin-bottom: 0.3rem; }
      .okh-input { width: 100%; height: 42px; padding: 0 0.8rem; border: 1.5px solid var(--border, #cbd5e1); border-radius: 10px; background: var(--bg-subtle, #f8fafc); color: var(--text-main, #0f172a); font-size: 0.9rem; font-weight: 700; font-family: inherit; outline: none; box-sizing: border-box; }
      .okh-input:focus { border-color: var(--primary, #4f46e5); background: var(--bg-surface, #fff); }
      .okh-modal-btns { display: flex; gap: 0.55rem; margin-top: 1.1rem; }
      .okh-mbtn { flex: 1; height: 42px; border-radius: 10px; font-size: 0.84rem; font-weight: 700; border: none; cursor: pointer; font-family: inherit; }
      .okh-mbtn.sec { background: var(--bg-subtle, #f1f5f9); color: var(--text-main, #0f172a); border: 1px solid var(--border, #cbd5e1); }
      .okh-mbtn.pri { background: var(--primary, #4f46e5); color: #fff; }
      .okh-mbtn.dan { background: var(--danger, #dc2626); color: #fff; }
    `;
    document.head.appendChild(style);
  }

  function ensureModals() {
    if (!document.getElementById('okhEditModal')) {
      const editWrap = document.createElement('div');
      editWrap.id = 'okhEditModal';
      editWrap.className = 'okh-modal-backdrop';
      editWrap.innerHTML = `
        <div class="okh-modal-card">
          <div class="okh-modal-head">
            <h3 class="okh-modal-title"><i class="fas fa-pen-to-square" style="color:var(--primary,#4f46e5);"></i> Koreksi Transaksi</h3>
            <button type="button" class="okh-modal-close" onclick="OwnerKasHistory.closeModals()"><i class="fas fa-times"></i></button>
          </div>
          <div class="okh-field">
            <label>Nominal (Rp)</label>
            <input type="number" id="okhEditNominal" class="okh-input" min="1" step="500" placeholder="0">
          </div>
          <div class="okh-field" id="okhEditAdminWrap" style="display:none;">
            <label>Biaya Admin / Laba (Rp)</label>
            <input type="number" id="okhEditAdmin" class="okh-input" min="0" step="500" placeholder="0">
          </div>
          <div class="okh-field">
            <label>Keterangan / Catatan</label>
            <input type="text" id="okhEditNote" class="okh-input" placeholder="Keterangan transaksi">
          </div>
          <div class="okh-modal-btns">
            <button type="button" class="okh-mbtn sec" onclick="OwnerKasHistory.closeModals()">Batal</button>
            <button type="button" class="okh-mbtn pri" onclick="OwnerKasHistory.saveEdit()">Simpan Koreksi</button>
          </div>
        </div>
      `;
      editWrap.addEventListener('click', (e) => { if (e.target === editWrap) closeModals(); });
      document.body.appendChild(editWrap);
    }

    if (!document.getElementById('okhDeleteModal')) {
      const delWrap = document.createElement('div');
      delWrap.id = 'okhDeleteModal';
      delWrap.className = 'okh-modal-backdrop';
      delWrap.innerHTML = `
        <div class="okh-modal-card" style="text-align:center;">
          <div style="width:54px;height:54px;border-radius:50%;background:rgba(220,38,38,0.12);color:#dc2626;display:inline-flex;align-items:center;justify-content:center;font-size:1.35rem;margin-bottom:0.75rem;">
            <i class="fas fa-trash-alt"></i>
          </div>
          <h3 style="font-size:1.05rem;font-weight:800;margin:0 0 0.4rem;">Batalkan & Hapus Transaksi?</h3>
          <p id="okhDeleteMsg" style="font-size:0.82rem;color:var(--text-muted,#64748b);line-height:1.45;margin:0 0 1.15rem;"></p>
          <div class="okh-modal-btns">
            <button type="button" class="okh-mbtn sec" onclick="OwnerKasHistory.closeModals()">Batal</button>
            <button type="button" class="okh-mbtn dan" onclick="OwnerKasHistory.confirmDelete()">Ya, Batalkan</button>
          </div>
        </div>
      `;
      delWrap.addEventListener('click', (e) => { if (e.target === delWrap) closeModals(); });
      document.body.appendChild(delWrap);
    }
  }

  function closeModals() {
    document.getElementById('okhEditModal')?.classList.remove('open');
    document.getElementById('okhDeleteModal')?.classList.remove('open');
    _editingItem = null;
    _deletingItem = null;
  }

  function ensureContainer() {
    let card = document.getElementById('ownerKasHistoryCard');
    if (card) return card;

    const host = document.querySelector('.kas-card, .topup-card, .tarik-card') || document.querySelector('.page-content') || document.body;
    card = document.createElement('div');
    card.id = 'ownerKasHistoryCard';
    card.className = 'okh-card';
    card.innerHTML = `
      <div class="okh-header">
        <div class="okh-title">
          <i class="fas fa-clock-rotate-left" style="color:var(--primary,#4f46e5);"></i>
          <span id="okhTitleText">Riwayat Transaksi</span>
          <span id="okhOwnerBadge" class="okh-owner-tag" style="display:none;">Kontrol Owner</span>
        </div>
        <span id="okhCountPill" class="okh-count-pill">0 data</span>
      </div>
      <div class="okh-toolbar">
        <div class="okh-tabs" id="okhPeriodTabs">
          <button type="button" class="okh-tab active" data-p="today">Hari Ini</button>
          <button type="button" class="okh-tab" data-p="yesterday">Kemarin</button>
          <button type="button" class="okh-tab" data-p="7days">7 Hari</button>
        </div>
        <div class="okh-summary" id="okhSummaryText">Total: <span>Rp 0</span></div>
      </div>
      <div class="okh-list" id="okhListBody">
        <div class="okh-empty"><i class="fas fa-spinner fa-spin"></i> Memuat riwayat...</div>
      </div>
    `;
    host.appendChild(card);

    card.querySelectorAll('#okhPeriodTabs .okh-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _period = btn.dataset.p || 'today';
        card.querySelectorAll('#okhPeriodTabs .okh-tab').forEach(b => b.classList.toggle('active', b === btn));
        refresh();
      });
    });

    return card;
  }

  function buildUpdatedMutation(tx, nominal, adminVal) {
    const kat = String(tx.kategori || tx.type || '').toLowerCase();
    const metode = String(tx.metode_pembayaran || tx.paymentMethod || 'tunai').toLowerCase();
    const nom = Math.max(0, Math.round(Number(nominal) || 0));
    const adm = Math.max(0, Math.round(Number(adminVal) || 0));

    let mut = { cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0, digital_in: 0, digital_out: 0, laba: 0 };

    if (kat === 'kas_masuk') {
      mut.cash_in = nom;
    } else if (kat === 'setor_bank') {
      mut.cash_out = nom;
      mut.bank_in = nom;
    } else if (kat === 'kas_keluar') {
      mut.cash_out = nom;
    } else if (kat === 'top_up' || kat === 'topup') {
      mut.digital_out = nom;
      mut.laba = adm;
      if (metode === 'tunai') mut.cash_in = nom + adm;
      else if (metode === 'qris' || metode === 'transfer') mut.bank_in = nom + adm;
    } else if (kat === 'tarik_tunai' || kat === 'tarik') {
      mut.digital_in = nom;
      mut.laba = adm;
      const keluar = Math.max(0, nom - adm);
      if (metode === 'tunai') mut.cash_out = keluar;
      else if (metode === 'transfer') mut.bank_out = keluar;
    }

    const totalVal = (kat === 'top_up' || kat === 'topup') ? (nom + adm) : nom;
    return Object.assign({}, mut, {
      nominal: nom,
      amount: nom,
      total: totalVal,
      admin: adm,
      adminFee: adm,
      profit: mut.laba
    });
  }

  async function refresh() {
    if (!_cfg) return;
    const dbInst = window.db || (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);
    if (!dbInst) return;

    await resolveRole();
    ensureContainer();

    const titleEl = document.getElementById('okhTitleText');
    const badgeEl = document.getElementById('okhOwnerBadge');
    const listEl = document.getElementById('okhListBody');
    const countEl = document.getElementById('okhCountPill');
    const sumEl = document.getElementById('okhSummaryText');

    if (titleEl) titleEl.textContent = _cfg.title || 'Riwayat Transaksi';
    if (badgeEl) badgeEl.style.display = isOwnerDev() ? 'inline-flex' : 'none';
    if (listEl) listEl.innerHTML = '<div class="okh-empty"><i class="fas fa-spinner fa-spin"></i> Memuat riwayat...</div>';

    try {
      const dateKeys = getDateKeysForPeriod(_period);
      const allowedCats = (_cfg.categories || []).map(c => String(c).toLowerCase());

      let snap;
      if (dateKeys.length === 1) {
        snap = await dbInst.collection('transactions').where('date_key', '==', dateKeys[0]).get();
      } else {
        snap = await dbInst.collection('transactions').where('date_key', 'in', dateKeys).get();
      }

      const docs = [];
      snap.forEach(doc => {
        const d = doc.data() || {};
        const kat = String(d.kategori || d.type || '').toLowerCase();
        if (!allowedCats.includes(kat)) return;
        if (!isPrivilegedViewer() && _user && d.userId && d.userId !== _user.uid) return;
        docs.push(Object.assign({ id: doc.id }, d));
      });

      docs.sort((a, b) => parseTxTime(b) - parseTxTime(a));
      _items = docs;

      const totalNom = docs.reduce((acc, it) => acc + (Number(it.nominal ?? it.amount ?? it.total) || 0), 0);
      const totalAdm = docs.reduce((acc, it) => acc + (Number(it.admin ?? it.adminFee ?? it.laba) || 0), 0);

      if (countEl) countEl.textContent = docs.length + ' data';
      if (sumEl) {
        sumEl.innerHTML = _cfg.hasAdmin
          ? 'Total: <span>' + Utils.formatRupiah(totalNom) + '</span> &bull; Laba: <span style="color:var(--success,#059669);">' + Utils.formatRupiah(totalAdm) + '</span>'
          : 'Total: <span>' + Utils.formatRupiah(totalNom) + '</span>';
      }

      if (!docs.length) {
        if (listEl) listEl.innerHTML = '<div class="okh-empty"><i class="fas fa-inbox" style="font-size:1.35rem;opacity:0.45;display:block;margin-bottom:0.35rem;"></i>Belum ada transaksi pada periode ini.</div>';
        return;
      }

      const canManage = isOwnerDev();
      const accent = _cfg.accent === 'danger' ? 'danger' : 'success';

      if (listEl) {
        listEl.innerHTML = docs.map(it => {
          const nom = Number(it.nominal ?? it.amount ?? it.total) || 0;
          const adm = Number(it.admin ?? it.adminFee ?? it.laba) || 0;
          const note = Utils.escapeHtml(it.catatan || it.note || it.description || _cfg.module || '-');
          const kasir = Utils.escapeHtml(it.userName || 'Kasir');
          const metode = String(it.metode_pembayaran || it.paymentMethod || 'tunai').toLowerCase();
          const kat = String(it.kategori || it.type || '').toLowerCase();
          let chipHtml = '';
          if (kat === 'setor_bank') chipHtml = '<span class="okh-chip bank">Setor Bank</span>';
          else if (metode === 'utang' || metode === 'hutang') chipHtml = '<span class="okh-chip utang">Hutang</span>';
          else if (it.sub_kategori && kat === 'kas_keluar') chipHtml = '<span class="okh-chip">' + Utils.escapeHtml(it.sub_kategori) + '</span>';
          else chipHtml = '<span class="okh-chip">' + Utils.escapeHtml(metode) + '</span>';

          const adminHtml = _cfg.hasAdmin ? '<div class="okh-admin-sub">Admin +' + Utils.formatRupiah(adm) + '</div>' : '';
          const actionsHtml = canManage ? `
            <div class="okh-actions">
              <button type="button" class="okh-btn edit" onclick="OwnerKasHistory.openEdit('${it.id}')"><i class="fas fa-pen"></i> Edit</button>
              <button type="button" class="okh-btn del" onclick="OwnerKasHistory.openDelete('${it.id}')"><i class="fas fa-trash-alt"></i> Batalkan</button>
            </div>` : '';

          return `
            <div class="okh-item">
              <div class="okh-row-top">
                <div class="okh-note">${note}</div>
                <div class="okh-amount-box">
                  <div class="okh-amount ${accent}">${Utils.formatRupiah(nom)}</div>
                  ${adminHtml}
                </div>
              </div>
              <div class="okh-row-meta">
                <div class="okh-meta-left">
                  <span><i class="fas fa-clock"></i> ${formatTxTimeLabel(it)}</span>
                  <span><i class="fas fa-user"></i> ${kasir}</span>
                </div>
                ${chipHtml}
              </div>
              ${actionsHtml}
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('OwnerKasHistory error:', err);
      if (listEl) listEl.innerHTML = '<div class="okh-empty" style="color:var(--danger,#dc2626);">Gagal memuat riwayat kas.</div>';
    }
  }

  function openEdit(id) {
    if (!isOwnerDev()) {
      Utils.showToast('Hanya Owner atau Developer yang dapat mengedit transaksi kas.', 'error');
      return;
    }
    const item = _items.find(x => x.id === id);
    if (!item) return;
    _editingItem = item;
    ensureModals();
    document.getElementById('okhEditNominal').value = Math.round(Number(item.nominal ?? item.amount ?? item.total) || 0);
    const admWrap = document.getElementById('okhEditAdminWrap');
    if (admWrap) admWrap.style.display = (_cfg && _cfg.hasAdmin) ? 'block' : 'none';
    document.getElementById('okhEditAdmin').value = Math.round(Number(item.admin ?? item.adminFee ?? item.laba) || 0);
    document.getElementById('okhEditNote').value = item.catatan || item.note || item.description || '';
    document.getElementById('okhEditModal').classList.add('open');
  }

  async function saveEdit() {
    if (!isOwnerDev() || !_editingItem) return;
    const item = _editingItem;
    const newNom = parseInt(document.getElementById('okhEditNominal').value, 10) || 0;
    const newAdm = (_cfg && _cfg.hasAdmin) ? (parseInt(document.getElementById('okhEditAdmin').value, 10) || 0) : 0;
    const newNote = (document.getElementById('okhEditNote').value || '').trim();

    if (newNom <= 0) {
      Utils.showToast('Nominal harus lebih besar dari Rp 0', 'warning');
      return;
    }
    if (!newNote) {
      Utils.showToast('Keterangan tidak boleh kosong', 'warning');
      return;
    }

    const dbInst = window.db || firebase.firestore();
    const oldNom = Math.round(Number(item.nominal ?? item.amount ?? item.total) || 0);
    const oldAdm = Math.round(Number(item.admin ?? item.adminFee ?? item.laba) || 0);
    const payload = Object.assign(buildUpdatedMutation(item, newNom, newAdm), {
      catatan: newNote,
      note: newNote,
      description: newNote,
      editedAt: Date.now(),
      editedBy: document.getElementById('userName')?.textContent || 'Owner'
    });

    closeModals();
    Utils.showLoading('Menyimpan koreksi kas...');
    try {
      await dbInst.collection('transactions').doc(item.id).update(payload);
      if (window.AuditLogger) {
        const modName = (_cfg && _cfg.module) || 'Kas';
        const admTxt = (_cfg && _cfg.hasAdmin) ? ` (Admin ${Utils.formatRupiah(oldAdm)} -> ${Utils.formatRupiah(newAdm)})` : '';
        await AuditLogger.log(
          'EDIT_KAS',
          `Koreksi ${modName} [${newNote}]: ${Utils.formatRupiah(oldNom)} -> ${Utils.formatRupiah(newNom)}${admTxt} (Kasir: ${item.userName || '-'})`,
          modName,
          item.id
        );
      }
      Utils.hideLoading();
      Utils.showToast('Transaksi kas berhasil dikoreksi!', 'success');
      await refresh();
      if (_cfg && typeof _cfg.onChanged === 'function') await _cfg.onChanged();
    } catch (err) {
      Utils.hideLoading();
      console.error('OwnerKasHistory saveEdit error:', err);
      Utils.showToast('Gagal mengoreksi kas: ' + (err.message || err), 'error');
    }
  }

  function openDelete(id) {
    if (!isOwnerDev()) {
      Utils.showToast('Hanya Owner atau Developer yang dapat membatalkan transaksi kas.', 'error');
      return;
    }
    const item = _items.find(x => x.id === id);
    if (!item) return;
    _deletingItem = item;
    ensureModals();
    const nom = Number(item.nominal ?? item.amount ?? item.total) || 0;
    const note = item.catatan || item.note || item.description || '-';
    document.getElementById('okhDeleteMsg').textContent =
      `Batalkan transaksi "${note}" sebesar ${Utils.formatRupiah(nom)} (petugas: ${item.userName || '-'})? Saldo kas laci akan otomatis kembali seperti semula.`;
    document.getElementById('okhDeleteModal').classList.add('open');
  }

  async function confirmDelete() {
    if (!isOwnerDev() || !_deletingItem) return;
    const item = _deletingItem;
    const dbInst = window.db || firebase.firestore();
    const nom = Math.round(Number(item.nominal ?? item.amount ?? item.total) || 0);
    const note = item.catatan || item.note || item.description || '-';

    closeModals();
    Utils.showLoading('Membatalkan transaksi kas...');
    try {
      await dbInst.collection('transactions').doc(item.id).delete();

      const metode = String(item.metode_pembayaran || item.paymentMethod || '').toLowerCase();
      if (metode === 'utang' || metode === 'hutang') {
        try {
          const dSnap = await dbInst.collection('debts').where('transactionId', '==', item.id).get();
          const delJobs = [];
          dSnap.forEach(d => delJobs.push(dbInst.collection('debts').doc(d.id).delete()));
          if (delJobs.length) await Promise.all(delJobs);
        } catch (e) {}
      }

      if (window.AuditLogger) {
        const modName = (_cfg && _cfg.module) || 'Kas';
        await AuditLogger.log(
          'HAPUS_KAS',
          `Batalkan ${modName} [${note}] sebesar ${Utils.formatRupiah(nom)} (Kasir: ${item.userName || '-'})`,
          modName,
          item.id
        );
      }

      Utils.hideLoading();
      Utils.showToast('Transaksi berhasil dibatalkan & kas disesuaikan!', 'success');
      await refresh();
      if (_cfg && typeof _cfg.onChanged === 'function') await _cfg.onChanged();
    } catch (err) {
      Utils.hideLoading();
      console.error('OwnerKasHistory confirmDelete error:', err);
      Utils.showToast('Gagal membatalkan transaksi: ' + (err.message || err), 'error');
    }
  }

  function mount(config) {
    _cfg = config || {};
    injectStyles();
    ensureModals();
    ensureContainer();
    return refresh();
  }

  return { mount, refresh, openEdit, saveEdit, openDelete, confirmDelete, closeModals };
})();
