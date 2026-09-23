// js/sidebar-filter.js - Navigasi global dan filter menu berbasis role
(function () {
  "use strict";

  const menuSections = [
    {
      title: "Utama",
      items: [
        ["index.html", "dashboard", "fas fa-home", "Dashboard"],
        ["page-kasir.html", "kasir", "fas fa-calculator", "Kasir"],
        ["page-produk.html", "produk", "fas fa-box", "Produk"]
      ]
    },
    {
      title: "Transaksi",
      items: [
        ["page-riwayat.html", "riwayat", "fas fa-history", "Riwayat Transaksi"]
      ],
      dropdown: {
        key: "kas",
        icon: "fas fa-wallet",
        label: "Manajemen Kas",
        items: [
          ["page-kas.html", "Ringkasan Kas"],
          ["page-modal-harian.html", "Modal Harian"],
          ["page-kas-masuk.html", "Kas Masuk"],
          ["page-kas-keluar.html", "Kas Keluar"],
          ["page-kas-shift.html", "Kas & Shift"],
          ["page-closing.html", "Closing Shift"],
          ["page-kas-topup.html", "Top Up"],
          ["page-kas-tarik.html", "Tarik Tunai"]
        ]
      },
      after: [
        ["page-pembelian.html", "pembelian", "fas fa-shopping-cart", "Pembelian / Restock"],
        ["page-hutang.html", "hutang", "fas fa-hand-holding-usd", "Hutang & Piutang"]
      ]
    },
    {
      title: "Laporan",
      items: [
        ["page-laporan.html", "laporan", "fas fa-chart-bar", "Laporan Penjualan"],
        ["page-laporan-stok.html", "laporan-stok", "fas fa-boxes", "Laporan Stok"],
        ["page-laporan-terlaris.html", "laporan-terlaris", "fas fa-crown", "Barang Terlaris"]
      ]
    },
    {
      title: "Integrasi",
      items: [
        ["page-saldo-telegram.html", "telegram", "fab fa-telegram", "Saldo Telegram"],
        ["page-data-pelanggan.html", "pelanggan", "fas fa-users", "Data Pelanggan"]
      ]
    },
    {
      title: "Penggajian",
      items: [["page-penggajian.html", "penggajian", "fas fa-money-check-alt", "Penggajian"]]
    },
    {
      title: "Sistem",
      items: [
        ["page-pengguna.html", "pengguna", "fas fa-user-cog", "Pengguna"],
        ["page-setting.html", "setting", "fas fa-cog", "Pengaturan"],
        ["page-printer.html", "printer", "fas fa-print", "Printer & Struk"],
        ["page-backup.html", "backup", "fas fa-cloud-upload-alt", "Backup & Sync"],
        ["page-log-aktivitas.html", "log-aktivitas", "fas fa-clipboard-list", "Log Aktivitas"],
        ["page-reset.html", "reset", "fas fa-trash-alt", "Reset Data"]
      ]
    }
  ];

  function link(item, activeFile, submenu) {
    const [href, key, icon, label] = item;
    const active = href === activeFile ? " active" : "";
    return `<li class="nav-item"><a href="${href}" class="nav-link${active}" data-menu="${key}"><i class="${icon}"></i><span>${label}</span></a></li>`;
  }

  function renderNavigation() {
    const nav = document.querySelector(".sidebar-nav");
    if (!nav) return;

    const activeFile = (window.location.pathname.split("/").pop() || "index.html").split("?")[0];
    let html = "";

    menuSections.forEach(section => {
      html += `<div class="nav-section"><div class="nav-section-title">${section.title}</div><ul class="nav-menu">`;
      (section.items || []).forEach(item => { html += link(item, activeFile); });

      if (section.dropdown) {
        const drop = section.dropdown;
        const isOpen = drop.items.some(item => item[0] === activeFile) ? " open" : "";
        html += `<li class="nav-item nav-dropdown${isOpen}" data-menu-group="${drop.key}">
          <div class="nav-link nav-dropdown-toggle" role="button" tabindex="0" data-menu="${drop.key}">
            <span style="display:flex;align-items:center;gap:.85rem"><i class="${drop.icon}"></i><span>${drop.label}</span></span>
            <i class="fas fa-chevron-down dropdown-arrow"></i>
          </div>
          <ul class="nav-submenu">`;
        drop.items.forEach(item => {
          const active = item[0] === activeFile ? " active" : "";
          html += `<li><a href="${item[0]}" class="nav-link${active}"><span>${item[1]}</span></a></li>`;
        });
        html += `</ul></li>`;
      }

      (section.after || []).forEach(item => { html += link(item, activeFile); });
      html += "</ul></div>";
    });
    nav.innerHTML = html;

    document.querySelectorAll(".nav-dropdown-toggle").forEach(toggle => {
      const activate = () => toggle.closest(".nav-dropdown").classList.toggle("open");
      toggle.addEventListener("click", event => { event.preventDefault(); activate(); });
      toggle.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
      });
    });

    const mobile = document.querySelector(".mobile-bar, .mobile-nav");
    if (mobile) {
      mobile.className = "mobile-bar";
      mobile.innerHTML = [
        ["index.html", "fas fa-home", "Dashboard"],
        ["page-kasir.html", "fas fa-calculator", "Kasir"],
        ["page-produk.html", "fas fa-box", "Produk"],
        ["page-riwayat.html", "fas fa-history", "Riwayat"],
        ["page-setting.html", "fas fa-cog", "Pengaturan"]
      ].map(([href, icon, label]) => `<a href="${href}" class="mobile-bar-item${href === activeFile ? " active" : ""}"><i class="${icon}"></i><span>${label}</span></a>`).join("");
    }
  }

  function hideMenuItem(selector) {
    const el = document.querySelector(selector);
    const parent = el && (el.closest(".nav-item") || el);
    if (parent) parent.style.display = "none";
  }

  function applyRoleVisibility(role) {
    role = (role || "kasir").toLowerCase();
    if (role === "developer" || role === "owner") return;

    if (role === "admin") {
      ["penggajian", "reset", "pengguna"].forEach(key => hideMenuItem(`[data-menu="${key}"]`));
      return;
    }

    if (role === "kasir") {
      ["pembelian", "laporan", "laporan-stok", "laporan-terlaris", "telegram", "penggajian", "pengguna", "setting", "printer", "backup", "log-aktivitas", "reset"]
        .forEach(key => hideMenuItem(`[data-menu="${key}"]`));
      ["totalLaba", "modalAwal"].forEach(id => {
        const el = document.getElementById(id);
        const card = el && el.closest(".stat-card");
        if (card) card.style.display = "none";
      });
    }
  }

  function applyMenuVisibility() {
    renderNavigation();
    if (typeof auth === "undefined" || typeof db === "undefined") return;

    auth.onAuthStateChanged(user => {
      if (!user) return;
      db.collection("users").doc(user.uid).get().then(doc => {
        const role = doc.exists ? (doc.data().role || "kasir") : "kasir";
        const roleEl = document.getElementById("userRole");
        if (roleEl) roleEl.textContent = role.toUpperCase();
        applyRoleVisibility(role);
      }).catch(err => console.error("Role filter error:", err));
    });
  }

  document.addEventListener("DOMContentLoaded", applyMenuVisibility);
})();
