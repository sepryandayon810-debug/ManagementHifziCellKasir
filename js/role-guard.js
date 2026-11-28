// js/role-guard.js - Pengatur Hak Akses Lengkap (Menu, Submenu, Mobile Bar, Widget & Semua Tab Halaman)
(function() {
  "use strict";

  var MENU_HREF_MAP = {
    "dashboard": "index.html",
    "kasir": "page-kasir.html",
    "produk": "page-produk.html",
    "riwayat": "page-riwayat.html",
    "pembelian": "page-pembelian.html",
    "hutang": "page-hutang.html",
    "kas_ringkasan": "page-kas.html",
    "kas_modal": "page-modal-harian.html",
    "kas_masuk": "page-kas-masuk.html",
    "kas_keluar": "page-kas-keluar.html",
    "kas_shift": "page-kas-shift.html",
    "kas_closing": "page-closing.html",
    "kas_topup": "page-kas-topup.html",
    "kas_tarik": "page-kas-tarik.html",
    "laporan": "page-laporan.html",
    "laporan-stok": "page-laporan-stok.html",
    "laporan-terlaris": "page-laporan-terlaris.html",
    "telegram": "page-saldo-telegram.html",
    "pelanggan": "page-data-pelanggan.html",
    "data-pelanggan": "page-data-pelanggan.html",
    "penggajian": "page-penggajian.html",
    "pengguna": "page-pengguna.html",
    "setting": "page-setting.html",
    "backup": "page-backup.html",
    "log-aktivitas": "page-log-aktivitas.html",
    "printer": "page-printer.html",
    "reset": "page-reset.html"
  };

  var PAGE_TO_PERM_KEY = {
    "page-kasir.html": "kasir",
    "page-produk.html": "produk",
    "page-riwayat.html": "riwayat",
    "page-pembelian.html": "pembelian",
    "page-hutang.html": "hutang",
    "page-kas.html": "kas_ringkasan",
    "page-modal-harian.html": "kas_modal",
    "page-kas-masuk.html": "kas_masuk",
    "page-kas-keluar.html": "kas_keluar",
    "page-kas-shift.html": "kas_shift",
    "page-closing.html": "kas_closing",
    "page-kas-topup.html": "kas_topup",
    "page-kas-tarik.html": "kas_tarik",
    "page-laporan.html": "laporan",
    "page-laporan-stok.html": "laporan-stok",
    "page-laporan-terlaris.html": "laporan-terlaris",
    "page-saldo-telegram.html": "telegram",
    "page-data-pelanggan.html": "pelanggan",
    "page-penggajian.html": "penggajian",
    "page-pengguna.html": "pengguna",
    "page-setting.html": "setting",
    "page-backup.html": "backup",
    "page-log-aktivitas.html": "log-aktivitas",
    "page-printer.html": "printer",
    "page-reset.html": "reset"
  };

  var ADMIN_DEFAULT_DENIED = {
    "penggajian": true,
    "reset": true,
    "log-aktivitas": true,
    "backup": true,
    "setting": true
  };

  var KASIR_DEFAULT_DENIED = {
    "pembelian": true,
    "laporan": true,
    "laporan-stok": true,
    "laporan-terlaris": true,
    "telegram": true,
    "pelanggan": true,
    "data-pelanggan": true,
    "setting": true,
    "penggajian": true,
    "backup": true,
    "reset": true,
    "log-aktivitas": true,
    "transfer_shift": true,
    "total_laba": true,
    "modal_awal": true
  };

  var PAGE_TABS_MAP = {
    "page-kasir.html": [
      { key: "tab_kasir_normal", selector: "#btnNormalMode" },
      { key: "tab_kasir_reseller", selector: "#btnResellerMode" }
    ],
    "page-produk.html": [
      { key: "tab_produk_kategori", selector: '.tab-btn[data-tab="kategori"]' },
      { key: "tab_produk_daftar", selector: '.tab-btn[data-tab="produk"]' },
      { key: "tab_produk_excel", selector: '.tab-btn[data-tab="excel"]' }
    ],
    "page-riwayat.html": [
      { key: "tab_riwayat_buku", selector: '.category-tab[data-category="buku_kasir"]' },
      { key: "tab_riwayat_umum", selector: '.category-tab[data-category="penjualan"]' },
      { key: "tab_riwayat_reseller", selector: '.category-tab[data-category="reseller"]' },
      { key: "tab_riwayat_topup", selector: '.category-tab[data-category="topup_tarik"]' },
      { key: "tab_riwayat_operasional", selector: '.category-tab[data-category="operasional"]' },
      { key: "tab_riwayat_semua", selector: '.category-tab[data-category="all"]' }
    ],
    "page-kas-shift.html": [
      { key: "tab_shift_aktif", selector: '.report-tab[data-tab="shift"]' },
      { key: "tab_shift_arsip", selector: '.report-tab[data-tab="arsip"], #tabBtnArsip' }
    ],
    "page-modal-harian.html": [
      { key: "tab_modal_manual", selector: "#tabModeManual" },
      { key: "tab_modal_pecahan", selector: "#tabModePecahan" }
    ],
    "page-pembelian.html": [
      { key: "tab_beli_ada", selector: "#btnModeSelect" },
      { key: "tab_beli_baru", selector: "#btnModeManual" }
    ],
    "page-hutang.html": [
      { key: "tab_hutang_semua", selector: '.filter-tab[data-filter="all"]' },
      { key: "tab_hutang_hutang", selector: '.filter-tab[data-filter="hutang"]' },
      { key: "tab_hutang_piutang", selector: '.filter-tab[data-filter="piutang"]' }
    ],
    "page-laporan.html": [
      { key: "tab_laporan_penjualan", selector: '.report-tab[data-report="penjualan"]' },
      { key: "tab_laporan_kas", selector: '.report-tab[data-report="kas"]' },
      { key: "tab_laporan_audit", selector: '.report-tab[data-report="audit"], #tabAudit' }
    ],
    "page-saldo-telegram.html": [
      { key: "tab_tele_topup", selector: '.tab-btn[data-tab="topup"]' },
      { key: "tab_tele_sisa", selector: '.tab-btn[data-tab="sisa"]' }
    ],
    "page-pengguna.html": [
      { key: "tab_pengguna_aktif", selector: '.tab-item[data-tab="active"]' },
      { key: "tab_pengguna_pending", selector: '.tab-item[data-tab="pending"]' }
    ],
    "page-setting.html": [
      { key: "tab_setting_toko", selector: '.tab-btn[data-tab="tab-toko"]' },
      { key: "tab_setting_akun", selector: '.tab-btn[data-tab="tab-akun"]' },
      { key: "tab_setting_printer", selector: '.tab-btn[data-tab="tab-printer"]' },
      { key: "tab_setting_tampilan", selector: '.tab-btn[data-tab="tab-tampilan"]' },
      { key: "tab_setting_bahasa", selector: '.tab-btn[data-tab="tab-bahasa"]' },
      { key: "tab_setting_lanjutan", selector: '.tab-btn[data-tab="tab-lanjutan"]' }
    ],
    "page-printer.html": [
      { key: "tab_printer_pln", selector: '.receipt-type-tab[data-type="token_pln"]' },
      { key: "tab_printer_transfer", selector: '.receipt-type-tab[data-type="transfer"]' },
      { key: "tab_printer_ewallet", selector: '.receipt-type-tab[data-type="top_up"]' }
    ],
    "page-backup.html": [
      { key: "tab_backup_transaksi", selector: '.viewer-tab-btn[data-tab="transaksi"]' },
      { key: "tab_backup_produk", selector: '.viewer-tab-btn[data-tab="produk"]' },
      { key: "tab_backup_hutang", selector: '.viewer-tab-btn[data-tab="hutang"]' },
      { key: "tab_backup_kas", selector: '.viewer-tab-btn[data-tab="kas"]' },
      { key: "tab_backup_pembelian", selector: '.viewer-tab-btn[data-tab="pembelian"]' },
      { key: "tab_backup_pelanggan", selector: '.viewer-tab-btn[data-tab="pelanggan"]' },
      { key: "tab_backup_gaji", selector: '.viewer-tab-btn[data-tab="gaji"]' },
      { key: "tab_backup_saldo", selector: '.viewer-tab-btn[data-tab="saldo"]' }
    ]
  };

  function getCurrentPageName() {
    var p = (window.location.pathname || "").split("/").pop() || "index.html";
    return p.toLowerCase();
  }

  function setMenuVisibilityByKey(menuKey, visible) {
    var disp = visible ? "" : "none";
    var selectors = [
      '[data-menu="' + menuKey + '"]',
      '[data-menu="data-' + menuKey + '"]'
    ];
    if (menuKey === "pelanggan") selectors.push('[data-menu="data-pelanggan"]');
    if (menuKey === "data-pelanggan") selectors.push('[data-menu="pelanggan"]');

    document.querySelectorAll(selectors.join(", ")).forEach(function(el) {
      var item = el.closest(".nav-item") || el.closest("li") || el;
      item.style.display = disp;
    });

    var hrefFile = MENU_HREF_MAP[menuKey];
    if (hrefFile) {
      document.querySelectorAll('.sidebar .nav-submenu a[href*="' + hrefFile + '"]').forEach(function(a) {
        var li = a.closest("li") || a;
        li.style.display = disp;
      });
      document.querySelectorAll('.mobile-bar a[href*="' + hrefFile + '"], .mobile-nav-item[href*="' + hrefFile + '"]').forEach(function(m) {
        m.style.display = disp;
      });
    }

    if (menuKey === "total_laba") {
      var laba = document.getElementById("totalLaba");
      if (laba && laba.closest(".stat-card")) laba.closest(".stat-card").style.display = disp;
      var headerLaba = document.getElementById("headerLaba");
      if (headerLaba && headerLaba.closest(".stat-item")) headerLaba.closest(".stat-item").style.display = disp;
    }
    if (menuKey === "modal_awal") {
      var modal = document.getElementById("modalAwal");
      if (modal && modal.closest(".stat-card")) modal.closest(".stat-card").style.display = disp;
    }
    if (menuKey === "transfer_shift") {
      var btnT = document.getElementById("btnTransferShift");
      if (btnT) btnT.style.display = disp;
    }

    // Sinkronkan tombol cepat di halaman Kasir
    if (menuKey === "kas_masuk") document.querySelectorAll(".kas-masuk").forEach(function(b) { b.style.display = disp; });
    if (menuKey === "kas_keluar") document.querySelectorAll(".kas-keluar").forEach(function(b) { b.style.display = disp; });
    if (menuKey === "hutang") document.querySelectorAll(".kas-hutang").forEach(function(b) { b.style.display = disp; });
    if (menuKey === "pembelian") document.querySelectorAll(".kas-beli").forEach(function(b) { b.style.display = disp; });
    if (menuKey === "kasir_rekap") document.querySelectorAll(".kas-rekap").forEach(function(b) { b.style.display = disp; });
  }

  function syncDropdownAndSections() {
    document.querySelectorAll(".sidebar .nav-dropdown").forEach(function(dd) {
      var subs = dd.querySelectorAll(".nav-submenu li");
      if (!subs.length) return;
      var anyVisible = false;
      subs.forEach(function(li) {
        if (li.style.display !== "none") anyVisible = true;
      });
      dd.style.display = anyVisible ? "" : "none";
    });

    document.querySelectorAll(".sidebar .nav-section").forEach(function(sec) {
      var items = sec.querySelectorAll(".nav-menu > .nav-item");
      if (!items.length) return;
      var anyVisible = false;
      items.forEach(function(li) {
        if (li.style.display !== "none") anyVisible = true;
      });
      sec.style.display = anyVisible ? "" : "none";
    });
  }

  function applyPageTabsPermissions(perms) {
    if (!perms || typeof perms !== "object") return;
    var pageName = getCurrentPageName();
    var tabDefs = PAGE_TABS_MAP[pageName];
    if (!tabDefs || !tabDefs.length) return;

    var hiddenActive = false;
    var firstVisibleBtn = null;

    tabDefs.forEach(function(def) {
      var val = perms[def.key];
      var nodes = document.querySelectorAll(def.selector);
      if (!nodes.length) return;
      nodes.forEach(function(btn) {
        if (val === false) {
          if (btn.classList.contains("active")) hiddenActive = true;
          btn.style.display = "none";
        } else if (val === true) {
          btn.style.display = "";
          if (!firstVisibleBtn) firstVisibleBtn = btn;
        } else {
          if (btn.style.display !== "none" && !firstVisibleBtn) firstVisibleBtn = btn;
        }
      });
    });

    if (hiddenActive && firstVisibleBtn) {
      setTimeout(function() {
        try { firstVisibleBtn.click(); } catch (e) {}
      }, 60);
    }
  }

  function applyExplicitPermissions(perms) {
    if (!perms || typeof perms !== "object") return;
    Object.keys(perms).forEach(function(menuKey) {
      if (menuKey.indexOf("tab_") === 0) return;
      if (perms[menuKey] === true) {
        setMenuVisibilityByKey(menuKey, true);
      } else if (perms[menuKey] === false) {
        setMenuVisibilityByKey(menuKey, false);
      }
    });
    syncDropdownAndSections();
    applyPageTabsPermissions(perms);
  }

  function isPageAllowedForUser(pageName, role, perms) {
    if (role === "owner" || role === "developer") return true;
    var permKey = PAGE_TO_PERM_KEY[pageName];
    if (!permKey) return true;

    var explicit = perms[permKey];
    if (permKey === "pelanggan" && explicit === undefined && perms["data-pelanggan"] !== undefined) {
      explicit = perms["data-pelanggan"];
    }
    if (explicit === true) return true;
    if (explicit === false) return false;

    var defaultDenied = role === "admin" ? ADMIN_DEFAULT_DENIED : KASIR_DEFAULT_DENIED;
    return !defaultDenied[permKey];
  }

  window.RoleGuard = {
    hideMenu: function(selector) {
      document.querySelectorAll(selector).forEach(function(el) {
        var item = el.closest(".nav-item") || el.closest("li") || el;
        item.style.display = "none";
      });
      if (selector.indexOf("setting") !== -1) {
        document.querySelectorAll('.mobile-bar a[href*="page-setting.html"], .mobile-nav-item[href*="setting"]').forEach(function(m) {
          m.style.display = "none";
        });
      }
    },

    applyDefaults: function(userRole) {
      var role = (userRole || "kasir").toLowerCase();
      if (role === "developer" || role === "owner") return;
      var deniedMap = role === "admin" ? ADMIN_DEFAULT_DENIED : KASIR_DEFAULT_DENIED;
      Object.keys(deniedMap).forEach(function(k) {
        setMenuVisibilityByKey(k, false);
      });
      syncDropdownAndSections();
    },

    apply: function(userRole) {
      var role = (userRole || "kasir").toLowerCase();
      if (role === "owner" || role === "developer") return;

      this.applyDefaults(role);

      try {
        var isSimNow = (typeof window.isDevRoleSimActive === "function" && window.isDevRoleSimActive());
        if (!isSimNow) {
          var cached = JSON.parse(localStorage.getItem("webpos_user_permissions") || "{}");
          window.__webposLastPerms = cached;
          applyExplicitPermissions(cached);
        }
      } catch (e) {}

      if (typeof firebase !== "undefined" && firebase.auth && firebase.firestore) {
        if (!window.__webposRouteGuardBound) {
          window.__webposRouteGuardBound = true;
          firebase.auth().onAuthStateChanged(function(user) {
            if (!user) return;
            var pageName = getCurrentPageName();

            firebase.firestore().collection("users").doc(user.uid).get().then(function(doc) {
              if (!doc.exists || !doc.data()) return;
              var uData = doc.data();
              var liveStatus = (uData.status || "active").toLowerCase();
              if (liveStatus === "inactive" || liveStatus === "rejected" || liveStatus === "pending") {
                firebase.auth().signOut().finally(function() {
                  window.location.replace("login.html");
                });
                return;
              }

              var realRole = (uData.role || "kasir").toLowerCase();
              var isSim = (realRole === "developer" && typeof window.isDevRoleSimActive === "function" && window.isDevRoleSimActive());
              var liveRole = (typeof window.getEffectiveUserRole === "function") ? window.getEffectiveUserRole(realRole) : realRole;
              var livePerms = isSim ? {} : ((uData.permissions && typeof uData.permissions === "object") ? uData.permissions : {});
              window.currentUserPerms = livePerms;
              window.__webposLastPerms = livePerms;

              if (!isSim) {
                try { localStorage.setItem("webpos_user_permissions", JSON.stringify(livePerms)); } catch (e) {}
              }

              if (liveRole === "owner" || liveRole === "developer") return;

              window.RoleGuard.applyDefaults(liveRole);
              applyExplicitPermissions(livePerms);

              if (!isPageAllowedForUser(pageName, liveRole, livePerms)) {
                window.location.replace("index.html");
              }
            }).catch(function(err) {
              console.warn("Gagal sync izin:", err);
              try {
                var cachedRole = String(localStorage.getItem("webpos_user_role") || "kasir").toLowerCase();
                if (cachedRole === "owner" || cachedRole === "developer") return;
                var cachedPerms = JSON.parse(localStorage.getItem("webpos_user_permissions") || "{}");
                applyExplicitPermissions(cachedPerms);
                if (!isPageAllowedForUser(pageName, cachedRole, cachedPerms)) {
                  window.location.replace("index.html");
                }
              } catch (e) {}
            });
          });
        }
      }
    }
  };

  document.addEventListener("DOMContentLoaded", function() {
    if (window.__webposLastPerms) {
      applyExplicitPermissions(window.__webposLastPerms);
    }
  });
})();
var RoleGuard = window.RoleGuard;
