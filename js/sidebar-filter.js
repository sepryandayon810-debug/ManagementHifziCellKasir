// js/sidebar-filter.js - Role-Based Menu Filter
function applyMenuVisibility() {
  if (typeof auth === "undefined" || typeof db === "undefined") return;

  auth.onAuthStateChanged(user => {
    if (!user) return;

    db.collection("users").doc(user.uid).get().then(doc => {
      if (!doc.exists) return;
      const role = (doc.data().role || "kasir").toLowerCase();

      // Update text role di profile bawah jika ada elemennya
      const roleEl = document.getElementById("userRole");
      if (roleEl) roleEl.textContent = role.toUpperCase();

      // 1. DEVELOPER & OWNER: Buka semua akses menu
      if (role === "developer" || role === "owner") {
        return;
      }

      // 2. ADMIN: Sembunyikan menu pengaturan sistem tingkat tinggi & Log Aktivitas
      if (role === "admin") {
        hideMenuItem('[data-menu="penggajian"]');
        hideMenuItem('[data-menu="reset"]');
        hideMenuItem('[data-menu="pengguna"]');
        hideMenuItem('[data-menu="setting"]');
        hideMenuItem('[data-menu="log-aktivitas"]'); // ← Tambahkan ini untuk Admin
        return;
      }

      // 3. KASIR: Hanya fokus pada kasir dan pencatatan harian
      if (role === "kasir") {
        hideMenuItem('[data-menu="pembelian"]');
        hideMenuItem('[data-menu="laporan"]');
        hideMenuItem('[data-menu="laporan-stok"]');
        hideMenuItem('[data-menu="laporan-terlaris"]');
        hideMenuItem('[data-menu="telegram"]');
        hideMenuItem('[data-menu="penggajian"]');
        hideMenuItem('[data-menu="pengguna"]');
        hideMenuItem('[data-menu="backup"]');
        hideMenuItem('[data-menu="reset"]');
        hideMenuItem('[data-menu="log-aktivitas"]'); // ← Tambahkan ini untuk Kasir

        // Sembunyikan kartu laba & modal di dashboard kasir
        const labaEl = document.getElementById("totalLaba");
        if (labaEl) {
          const card = labaEl.closest(".stat-card");
          if (card) card.style.display = "none";
        }
        const modalEl = document.getElementById("modalAwal");
        if (modalEl) {
          const card = modalEl.closest(".stat-card");
          if (card) card.style.display = "none";
        }
      }
    }).catch(err => console.error("Role filter error:", err));
  });
}

function hideMenuItem(selector) {
  const el = document.querySelector(selector);
  if (el) {
    const parentNav = el.closest(".nav-item") || el;
    parentNav.style.display = "none";
  }
}

// ==============================================================
// 🎨 GLOBAL THEME ENGINE: 15 WARNA + 15 CORAK + 15 GAYA TULISAN
// ==============================================================
(function initGlobalThemeStyles() {
  const savedStyle = localStorage.getItem("webpos_theme_style") || "standard";
  const savedColor = localStorage.getItem("webpos_theme_color") || "indigo";
  const savedFont  = localStorage.getItem("webpos_theme_font") || "jakarta";
  
  document.documentElement.setAttribute("data-theme-style", savedStyle);
  document.documentElement.setAttribute("data-theme-color", savedColor);
  document.documentElement.setAttribute("data-theme-font", savedFont);

  // 1. Muat 15 Google Fonts Resmi ke Head jika belum ada
  if (!document.getElementById("webposGoogleFonts")) {
    const fontLink = document.createElement("link");
    fontLink.id = "webposGoogleFonts";
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=DM+Sans:wght@400;500;700&family=Inter:wght@400;500;600;700&family=Manrope:wght@500;700;800&family=Montserrat:wght@500;600;700&family=Nunito:wght@500;600;700;800&family=Outfit:wght@400;500;600;700&family=Patrick+Hand&family=Playfair+Display:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Poppins:wght@400;500;600;700&family=Quicksand:wght@500;600;700&family=Roboto:wght@400;500;700&family=Rubik:wght@500;600;700&family=Space+Grotesk:wght@500;700&display=swap";
    document.head.appendChild(fontLink);
  }

  const css = `
    /* ===== 15 PILIHAN GAYA TULISAN (FONT) GLOBAL ===== */
    :root { --font-family: 'Plus Jakarta Sans', sans-serif; }
    [data-theme-font="jakarta"]    { --font-family: 'Plus Jakarta Sans', sans-serif; }
    [data-theme-font="poppins"]    { --font-family: 'Poppins', sans-serif; }
    [data-theme-font="inter"]      { --font-family: 'Inter', sans-serif; }
    [data-theme-font="outfit"]     { --font-family: 'Outfit', sans-serif; }
    [data-theme-font="dmsans"]     { --font-family: 'DM Sans', sans-serif; }
    [data-theme-font="roboto"]     { --font-family: 'Roboto', sans-serif; }
    [data-theme-font="space"]      { --font-family: 'Space Grotesk', sans-serif; }
    [data-theme-font="mono"]       { --font-family: 'Courier Prime', monospace; }
    [data-theme-font="manrope"]    { --font-family: 'Manrope', sans-serif; }
    [data-theme-font="nunito"]     { --font-family: 'Nunito', sans-serif; }
    [data-theme-font="quicksand"]  { --font-family: 'Quicksand', sans-serif; }
    [data-theme-font="montserrat"] { --font-family: 'Montserrat', sans-serif; }
    [data-theme-font="rubik"]      { --font-family: 'Rubik', sans-serif; }
    [data-theme-font="playfair"]   { --font-family: 'Playfair Display', serif; }
    [data-theme-font="hand"]       { --font-family: 'Patrick Hand', cursive; }

    /* Terapkan font ke semua teks (tetap aman untuk ikon FontAwesome) */
    body, input, select, textarea, button, .logo-text, .nav-link span, .card, .btn, .stat-value, .produk-name, .table {
      font-family: var(--font-family) !important;
    }
    i, .fas, .fab, .far, .fa {
      font-family: "Font Awesome 6 Free", "Font Awesome 6 Brands", sans-serif !important;
    }

    /* ===== 15 WARNA BRAND POPULER ===== */
    [data-theme-color="dana"]       { --primary: #118eea; --primary-hover: #0b75c4; --primary-light: #e8f4fd; }
    [data-theme-color="gojek"]      { --primary: #00aa13; --primary-hover: #00880f; --primary-light: #e6f7e7; }
    [data-theme-color="shopee"]     { --primary: #ee4d2d; --primary-hover: #d23f21; --primary-light: #fdedea; }
    [data-theme-color="grab"]       { --primary: #00b14f; --primary-hover: #008f40; --primary-light: #e6f7ee; }
    [data-theme-color="bca"]        { --primary: #003893; --primary-hover: #002b70; --primary-light: #e6edf7; }
    [data-theme-color="mandiri"]    { --primary: #003d79; --primary-hover: #002d59; --primary-light: #e6ecf2; }
    [data-theme-color="telkomsel"]  { --primary: #ed0226; --primary-hover: #c4021f; --primary-light: #fde6e9; }
    [data-theme-color="ovo"]        { --primary: #4c3494; --primary-hover: #3d2977; --primary-light: #edeaf4; }
    [data-theme-color="tokopedia"]  { --primary: #03ac0e; --primary-hover: #028a0b; --primary-light: #e6f7e7; }
    [data-theme-color="linkaja"]    { --primary: #e31837; --primary-hover: #ba132c; --primary-light: #fce8eb; }
    [data-theme-color="jago"]       { --primary: #f37021; --primary-hover: #d25b12; --primary-light: #fef1e9; }
    [data-theme-color="maxim"]      { --primary: #eab308; --primary-hover: #ca8a04; --primary-light: #fefce8; }
    [data-theme-color="spotify"]    { --primary: #1db954; --primary-hover: #169c46; --primary-light: #e8f8ee; }
    [data-theme-color="tiktok"]     { --primary: #fe2c55; --primary-hover: #d91c42; --primary-light: #feeaf0; }
    [data-theme-color="indigo"]     { --primary: #4f46e5; --primary-hover: #4338ca; --primary-light: #eef2ff; }

    /* ===== 15 CORAK GAYA DESAIN ===== */
    [data-theme-style="polka"], [data-theme-style="polka"] body, [data-theme-style="polka"] .main-content, [data-theme-style="polka"] .sidebar {
      background-color: var(--bg-base) !important;
      background-image: radial-gradient(circle, var(--primary) 2px, transparent 2px) !important;
      background-size: 18px 18px !important;
    }
    [data-theme-style="grid"], [data-theme-style="grid"] body, [data-theme-style="grid"] .main-content, [data-theme-style="grid"] .sidebar {
      background-image: linear-gradient(to right, color-mix(in srgb, var(--primary) 15%, transparent) 1px, transparent 1px),
                        linear-gradient(to bottom, color-mix(in srgb, var(--primary) 15%, transparent) 1px, transparent 1px) !important;
      background-size: 22px 22px !important;
    }
    [data-theme-style="aura"], [data-theme-style="aura"] body, [data-theme-style="aura"] .main-content, [data-theme-style="aura"] .sidebar {
      background-image: radial-gradient(at 0% 0%, color-mix(in srgb, var(--primary) 18%, transparent) 0px, transparent 55%),
                        radial-gradient(at 100% 100%, rgba(236, 72, 153, 0.18) 0px, transparent 55%) !important;
      background-attachment: fixed !important;
    }
    [data-theme-style="glass"] .sidebar, [data-theme-style="glass"] .main-header, [data-theme-style="glass"] .card {
      background: color-mix(in srgb, var(--bg-surface) 80%, transparent) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      border-color: rgba(255, 255, 255, 0.35) !important;
      box-shadow: 0 8px 30px rgba(0,0,0,0.06) !important;
    }
    [data-theme-style="warm"] { --bg-base: #fbf8f3; --bg-surface: #ffffff; --bg-subtle: #f4eee2; --border: #e4d8c5; }
    [data-theme-style="warm"] body, [data-theme-style="warm"] .sidebar { background: #fbf8f3 !important; }
    [data-theme-style="bold"] .sidebar, [data-theme-style="bold"] .card, [data-theme-style="bold"] .btn {
      border: 2px solid #0f172a !important; box-shadow: 3px 3px 0px #0f172a !important;
    }
    [data-theme-style="carbon"], [data-theme-style="carbon"] body, [data-theme-style="carbon"] .main-content, [data-theme-style="carbon"] .sidebar {
      background: radial-gradient(black 15%, transparent 16%) 0 0, radial-gradient(black 15%, transparent 16%) 8px 8px,
                  radial-gradient(rgba(255,255,255,.1) 15%, transparent 20%) 0 1px, radial-gradient(rgba(255,255,255,.1) 15%, transparent 20%) 8px 9px !important;
      background-color: #1e293b !important; background-size: 16px 16px !important;
    }
   [data-theme-style="standard"], [data-theme-style="standard"] body, [data-theme-style="standard"] .main-content, [data-theme-style="standard"] .sidebar {
      background-image: none !important;
    }

    /* ===== ANIMASI TRANSISI SMOOTH: SIDEBAR & BOTTOM NAV MOBILE ===== */
    .sidebar .nav-link, .sidebar .nav-dropdown-toggle, .mobile-nav-item, .mobile-bar-item {
      transition: background-color 0.24s cubic-bezier(0.22, 1, 0.36, 1),
                  color 0.24s cubic-bezier(0.22, 1, 0.36, 1),
                  transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
                  box-shadow 0.24s cubic-bezier(0.22, 1, 0.36, 1) !important;
    }
    .mobile-nav-item, .mobile-bar-item {
      border-radius: 10px;
    }
    .sidebar .nav-link:not(.active):hover, .sidebar .nav-dropdown-toggle:hover {
      transform: translateX(4px);
    }
    [dir="rtl"] .sidebar .nav-link:not(.active):hover, [dir="rtl"] .sidebar .nav-dropdown-toggle:hover {
      transform: translateX(-4px);
    }
    .sidebar .nav-link:active, .sidebar .nav-dropdown-toggle:active, .mobile-nav-item:active, .mobile-bar-item:active {
      transform: scale(0.96);
    }
    .sidebar .nav-link i:not(.fa-chevron-down):not(.fa-angle-down),
    .sidebar .nav-dropdown-toggle i:not(.fa-chevron-down):not(.fa-angle-down),
    .mobile-nav-item i, .mobile-bar-item i {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
                  color 0.2s ease,
                  filter 0.2s ease !important;
      will-change: transform;
    }
    .sidebar .nav-link:hover i:not(.fa-chevron-down):not(.fa-angle-down),
    .sidebar .nav-dropdown-toggle:hover i:not(.fa-chevron-down):not(.fa-angle-down) {
      transform: scale(1.15) !important;
      filter: brightness(1.08);
    }
    .mobile-nav-item:hover i, .mobile-bar-item:hover i {
      transform: translateY(-2px) scale(1.15) !important;
      filter: brightness(1.08);
    }
    .sidebar .nav-link.active i:not(.fa-chevron-down):not(.fa-angle-down) {
      transform: scale(1.08);
    }
    .mobile-nav-item.active i, .mobile-bar-item.active i {
      transform: translateY(-1px) scale(1.1);
    }
    .sidebar .nav-dropdown-toggle .fa-chevron-down, .sidebar .nav-dropdown-toggle .fa-angle-down {
      transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1) !important;
    }
    .sidebar .nav-submenu {
      transition: opacity 0.24s ease, transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
    }

    /* State Aktif Elegan: Sidebar & Bottom Nav selaras dengan latar lembut */
    .sidebar .nav-link.active {
      background-color: var(--primary-light, #eef2ff) !important;
      color: var(--primary, #4f46e5) !important;
      font-weight: 600 !important;
      box-shadow: inset 3px 0 0 var(--primary, #4f46e5);
    }
    [dir="rtl"] .sidebar .nav-link.active {
      box-shadow: inset -3px 0 0 var(--primary, #4f46e5);
    }
    .mobile-nav-item.active, .mobile-bar-item.active {
      background-color: var(--primary-light, #eef2ff) !important;
      color: var(--primary, #4f46e5) !important;
      font-weight: 600 !important;
      box-shadow: inset 0 2.5px 0 var(--primary, #4f46e5);
    }

    /* ===== 23 WARNA KHAS IKON (SIDEBAR & BOTTOM NAV SELARAS) ===== */
    .sidebar [data-menu="dashboard"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-home, .sidebar .nav-link i.fa-chart-pie, .mobile-nav-item[href*="index"] i, .mobile-bar-item[href*="index"] i, .mobile-nav-item i.fa-home, .mobile-bar-item i.fa-home, .mobile-nav-item i.fa-chart-pie, .mobile-bar-item i.fa-chart-pie { color: #3b82f6 !important; }
    .sidebar [data-menu="kasir"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-cash-register, .mobile-nav-item[href*="kasir"] i, .mobile-bar-item[href*="kasir"] i, .mobile-nav-item i.fa-cash-register, .mobile-bar-item i.fa-cash-register { color: #6366f1 !important; }
    .sidebar [data-menu="produk"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-box, .mobile-nav-item[href*="produk"] i, .mobile-bar-item[href*="produk"] i, .mobile-nav-item i.fa-box, .mobile-bar-item i.fa-box { color: #10b981 !important; }
    .sidebar [data-menu="riwayat"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-history, .mobile-nav-item[href*="riwayat"] i, .mobile-bar-item[href*="riwayat"] i, .mobile-nav-item i.fa-history, .mobile-bar-item i.fa-history { color: #06b6d4 !important; }
    .sidebar [data-menu="kas"] i:not(.fa-chevron-down):not(.fa-angle-down), .sidebar .nav-dropdown-toggle i.fa-wallet, .mobile-nav-item i.fa-wallet, .mobile-bar-item i.fa-wallet { color: #16a34a !important; }
    .sidebar [data-menu="modal-harian"] i, .sidebar .nav-submenu i.fa-coins { color: #0d9488 !important; }
    .sidebar [data-menu="kas-masuk"] i, .sidebar .nav-submenu i.fa-arrow-down { color: #22c55e !important; }
    .sidebar [data-menu="kas-keluar"] i, .sidebar .nav-submenu i.fa-arrow-up { color: #ef4444 !important; }
    .sidebar [data-menu="closing-shift"] i, .sidebar .nav-submenu i.fa-door-closed { color: #f59e0b !important; }
    .sidebar [data-menu="pembelian"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-shopping-cart, .mobile-nav-item[href*="pembelian"] i, .mobile-bar-item[href*="pembelian"] i { color: #f97316 !important; }
    .sidebar [data-menu="hutang"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-hand-holding-usd, .mobile-nav-item[href*="hutang"] i, .mobile-bar-item[href*="hutang"] i { color: #f43f5e !important; }
    .sidebar [data-menu="laporan"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-chart-line, .mobile-nav-item[href*="laporan"] i, .mobile-bar-item[href*="laporan"] i { color: #8b5cf6 !important; }
    .sidebar [data-menu="laporan-stok"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-boxes { color: #d97706 !important; }
    .sidebar [data-menu="laporan-terlaris"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-crown { color: #eab308 !important; }
    .sidebar [data-menu="telegram"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-telegram, .sidebar .nav-link i.fa-paper-plane { color: #229ed9 !important; }
    .sidebar [data-menu="pelanggan"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-users, .mobile-nav-item[href*="pelanggan"] i, .mobile-bar-item[href*="pelanggan"] i { color: #ec4899 !important; }
    .sidebar [data-menu="penggajian"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-money-check-alt, .sidebar .nav-link i.fa-money-check-dollar { color: #059669 !important; }
    .sidebar [data-menu="pengguna"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-user-cog, .sidebar .nav-link i.fa-user-gear { color: #4f46e5 !important; }
    .sidebar [data-menu="setting"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-sliders-h, .sidebar .nav-link i.fa-sliders, .mobile-nav-item[href*="setting"] i, .mobile-bar-item[href*="setting"] i, .mobile-nav-item i.fa-sliders-h, .mobile-bar-item i.fa-sliders-h, .mobile-nav-item i.fa-cog, .mobile-bar-item i.fa-cog, .mobile-nav-item i.fa-gear, .mobile-bar-item i.fa-gear { color: #64748b !important; }
    .sidebar [data-menu="backup"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-cloud-upload-alt, .sidebar .nav-link i.fa-cloud-arrow-up { color: #0ea5e9 !important; }
    .sidebar [data-menu="log-aktivitas"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-clipboard-list { color: #0284c7 !important; }
    .sidebar [data-menu="printer"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-print { color: #7c3aed !important; }
    .sidebar [data-menu="reset"] i:not(.fa-chevron-down), .sidebar .nav-link i.fa-trash-alt, .sidebar .nav-link i.fa-trash-can { color: #ef4444 !important; }
  `;

  let styleEl = document.getElementById("webposGlobalThemeStyle");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "webposGlobalThemeStyle";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
})();

// ==============================================================
// 🌐 KAMUS MULTI-BAHASA LENGKAP (6 BAHASA)
// ==============================================================
const WEBPOS_DICTIONARY = {
  id: {
    dashboard: "Dashboard",
    kasir: "Kasir",
    produk: "Produk",
    riwayat: "Riwayat Transaksi",
    kas: "Kas Management",
    ringkasan_kas: "Ringkasan Kas",
    modal_harian: "Modal Harian",
    kas_masuk: "Kas Masuk",
    kas_keluar: "Kas Keluar",
    kas_shift: "Kas & Shift",
    closing: "Closing Shift",
    topup: "Top Up",
    tarik: "Tarik Tunai",
    pembelian: "Pembelian / Restock",
    hutang: "Hutang & Piutang",
    laporan: "Laporan Penjualan",
    laporan_stok: "Laporan Stok",
    terlaris: "Barang Terlaris",
    telegram: "Saldo Telegram",
    pelanggan: "Data Pelanggan",
    penggajian: "Data Penggajian",
    pengguna: "Pengguna",
    setting: "Pengaturan",
    backup: "Backup & Sync",
    log: "Log Aktivitas",
    printer: "Printer & Struk",
    reset: "Reset Data",
    logout: "Keluar",
    sec_utama: "Utama",
    sec_transaksi: "Transaksi",
    sec_laporan: "Laporan",
    sec_integrasi: "Integrasi",
    sec_penggajian: "Penggajian",
    sec_sistem: "Sistem",
    hdr_pembelian: "Pembelian / Restock",
    hdr_kasir: "Kasir",
    hdr_setting: "Pengaturan Sistem",
    cari: "Cari menu..."
  },
  en: {
    dashboard: "Dashboard",
    kasir: "Cashier",
    produk: "Products",
    riwayat: "Transaction History",
    kas: "Cash Management",
    ringkasan_kas: "Cash Summary",
    modal_harian: "Daily Capital",
    kas_masuk: "Cash In",
    kas_keluar: "Cash Out",
    kas_shift: "Cash & Shift",
    closing: "Shift Closing",
    topup: "Top Up",
    tarik: "Cash Withdrawal",
    pembelian: "Purchase / Restock",
    hutang: "Debt & Credit",
    laporan: "Sales Report",
    laporan_stok: "Stock Report",
    terlaris: "Best Sellers",
    telegram: "Telegram Balance",
    pelanggan: "Customer Data",
    penggajian: "Payroll Data",
    pengguna: "User Accounts",
    setting: "Settings",
    backup: "Backup & Sync",
    log: "Activity Log",
    printer: "Printer & Receipt",
    reset: "Reset Data",
    logout: "Log Out",
    sec_utama: "Main",
    sec_transaksi: "Transactions",
    sec_laporan: "Reports",
    sec_integrasi: "Integrations",
    sec_penggajian: "Payroll",
    sec_sistem: "System",
    hdr_pembelian: "Purchase / Restock",
    hdr_kasir: "Cashier POS",
    hdr_setting: "System Settings",
    cari: "Search menu..."
  },
  ms: {
    dashboard: "Papan Pemuka",
    kasir: "Juruwang (POS)",
    produk: "Produk",
    riwayat: "Sejarah Transaksi",
    kas: "Pengurusan Tunai",
    ringkasan_kas: "Ringkasan Tunai",
    modal_harian: "Modal Harian",
    kas_masuk: "Tunai Masuk",
    kas_keluar: "Tunai Keluar",
    kas_shift: "Tunai & Syif",
    closing: "Tutup Syif",
    topup: "Tambah Nilai",
    tarik: "Pengeluaran Tunai",
    pembelian: "Belian / Stok",
    hutang: "Hutang & Piutang",
    laporan: "Laporan Jualan",
    laporan_stok: "Laporan Stok",
    terlaris: "Barang Laris",
    telegram: "Baki Telegram",
    pelanggan: "Data Pelanggan",
    penggajian: "Data Gaji",
    pengguna: "Akaun Pengguna",
    setting: "Tetapan Sistem",
    backup: "Sandaran & Segerak",
    log: "Log Aktiviti",
    printer: "Pencetak & Resit",
    reset: "Set Semula Data",
    logout: "Log Keluar",
    sec_utama: "Utama",
    sec_transaksi: "Transaksi",
    sec_laporan: "Laporan",
    sec_integrasi: "Integrasi",
    sec_penggajian: "Penggajian",
    sec_sistem: "Sistem",
    hdr_pembelian: "Belian / Stok",
    hdr_kasir: "Juruwang",
    hdr_setting: "Tetapan Sistem",
    cari: "Cari menu..."
  },
  jv: {
    dashboard: "Kaca Ngarep",
    kasir: "Kasir (POS)",
    produk: "Dagangan",
    riwayat: "Catetan Transaksi",
    kas: "Atur Dhuwit Kas",
    ringkasan_kas: "Ringkesan Kas",
    modal_harian: "Modhal Saben Dina",
    kas_masuk: "Kas Mlebu",
    kas_keluar: "Kas Metu",
    kas_shift: "Kas & Giliran",
    closing: "Tutup Giliran",
    topup: "Nambah Saldo",
    tarik: "Tarik Dhuwit",
    pembelian: "Kulakan / Blanja",
    hutang: "Utang & Piutang",
    laporan: "Laporan Payu",
    laporan_stok: "Laporan Stok",
    terlaris: "Paling Payu",
    telegram: "Saldo Telegram",
    pelanggan: "Data Pelanggan",
    penggajian: "Data Bayaran",
    pengguna: "Akun Penganggo",
    setting: "Setelan Sistem",
    backup: "Cadangan Data",
    log: "Catetan Tumindak",
    printer: "Printer & Struk",
    reset: "Busek Kabeh Data",
    logout: "Metu Sistem",
    sec_utama: "Utama",
    sec_transaksi: "Transaksi",
    sec_laporan: "Laporan",
    sec_integrasi: "Sambungan",
    sec_penggajian: "Bayaran",
    sec_sistem: "Sistem",
    hdr_pembelian: "Kulakan / Blanja",
    hdr_kasir: "Kasir",
    hdr_setting: "Setelan Sistem",
    cari: "Golek menu..."
  },
  su: {
    dashboard: "Tepas Utama",
    kasir: "Kasir (POS)",
    produk: "Barang Dagangan",
    riwayat: "Runtuyan Transaksi",
    kas: "Ngatur Duit Kas",
    ringkasan_kas: "Ringkesan Kas",
    modal_harian: "Modal Sadidinten",
    kas_masuk: "Kas Lebet",
    kas_keluar: "Kas Kaluar",
    kas_shift: "Kas & Giliran",
    closing: "Tutup Giliran",
    topup: "Eusi Saldo",
    tarik: "Tarik Tunai",
    pembelian: "Balanja / Kulakan",
    hutang: "Hutang & Sambetan",
    laporan: "Laporan Pajalan",
    laporan_stok: "Laporan Stok",
    terlaris: "Pangpayuna",
    telegram: "Saldo Telegram",
    pelanggan: "Data Palanggan",
    penggajian: "Data Gajihan",
    pengguna: "Akun Panganggo",
    setting: "Setelan Sistem",
    backup: "Nyimpen Cadangan",
    log: "Catetan Kagiatan",
    printer: "Printer & Struk",
    reset: "Mupus Sadaya Data",
    logout: "Kaluar Akun",
    sec_utama: "Utama",
    sec_transaksi: "Transaksi",
    sec_laporan: "Laporan",
    sec_integrasi: "Integrasi",
    sec_penggajian: "Gajihan",
    sec_sistem: "Sistem",
    hdr_pembelian: "Balanja / Kulakan",
    hdr_kasir: "Kasir",
    hdr_setting: "Setelan Sistem",
    cari: "Milari menu..."
  },
  ar: {
    dashboard: "لوحة التحكم",
    kasir: "نقطة البيع (الكاشير)",
    produk: "المنتجات",
    riwayat: "سجل المعاملات",
    kas: "إدارة الصندوق",
    ringkasan_kas: "ملخص النقدية",
    modal_harian: "رأس المال اليومي",
    kas_masuk: "واردات الصندوق",
    kas_keluar: "مصروفات الصندوق",
    kas_shift: "الصندوق والمناوبة",
    closing: "إغلاق المناوبة",
    topup: "شحن رصيد",
    tarik: "سحب نقدي",
    pembelian: "المشتريات / التوريد",
    hutang: "الديون والمستحقات",
    laporan: "تقارير المبيعات",
    laporan_stok: "تقرير المخزون",
    terlaris: "الأكثر مبيعاً",
    telegram: "رصيد تيليجرام",
    pelanggan: "بيانات العملاء",
    penggajian: "سجل الرواتب",
    pengguna: "حسابات المستخدمين",
    setting: "إعدادات النظام",
    backup: "النسخ الاحتياطي",
    log: "سجل العمليات",
    printer: "الطابعة والإيصالات",
    reset: "إعادة ضبط",
    logout: "تسجيل خروج",
    sec_utama: "الرئيسية",
    sec_transaksi: "المعاملات",
    sec_laporan: "التقارير",
    sec_integrasi: "الربط",
    sec_penggajian: "الرواتب",
    sec_sistem: "النظام",
    hdr_pembelian: "المشتريات / التوريد",
    hdr_kasir: "نقطة البيع",
    hdr_setting: "إعدادات النظام",
    cari: "بحث في القائمة..."
  }
};

// =========================================================
// ENGINE TERJEMAHAN GLOBAL (PAKSA RUBAH SEMUA KOMPONEN)
// =========================================================
function applyGlobalTranslations() {
  const lang = localStorage.getItem("webpos_language") || "id";
  const dict = WEBPOS_DICTIONARY[lang] || WEBPOS_DICTIONARY["id"];
  if (!dict) return;

  // Atur atribut lang & direction (RTL untuk Bahasa Arab)
  document.documentElement.setAttribute("lang", lang);
  if (lang === "ar") {
    document.documentElement.setAttribute("dir", "rtl");
  } else {
    document.documentElement.removeAttribute("dir");
  }

  // Helper aman memperbarui teks tanpa merusak icon FontAwesome <i>
  function setSafeText(el, text) {
    if (!el || !text) return;
    const span = el.querySelector("span");
    if (span) {
      span.textContent = text;
      return;
    }
    for (let node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
        node.nodeValue = " " + text;
        return;
      }
    }
    el.appendChild(document.createTextNode(" " + text));
  }

  // 1. Terjemahkan Menu Sidebar Navigasi
  const menuMap = {
    "dashboard": dict.dashboard,
    "kasir": dict.kasir,
    "produk": dict.produk,
    "riwayat": dict.riwayat,
    "pembelian": dict.pembelian,
    "hutang": dict.hutang,
    "laporan": dict.laporan,
    "laporan-stok": dict.laporan_stok,
    "laporan-terlaris": dict.terlaris,
    "telegram": dict.telegram,
    "pelanggan": dict.pelanggan,
    "penggajian": dict.penggajian,
    "pengguna": dict.pengguna,
    "setting": dict.setting,
    "backup": dict.backup,
    "log-aktivitas": dict.log,
    "printer": dict.printer,
    "reset": dict.reset
  };

  Object.entries(menuMap).forEach(([menuKey, translatedText]) => {
    const el = document.querySelector(`.nav-link[data-menu="${menuKey}"] span`);
    if (el && translatedText) el.textContent = translatedText;
  });

  // 2. Terjemahkan Judul Section Sidebar
  const sectionTitles = document.querySelectorAll(".nav-section-title");
  if (sectionTitles.length >= 6) {
    if (dict.sec_utama) sectionTitles[0].textContent = dict.sec_utama;
    if (dict.sec_transaksi) sectionTitles[1].textContent = dict.sec_transaksi;
    if (dict.sec_laporan) sectionTitles[2].textContent = dict.sec_laporan;
    if (dict.sec_integrasi) sectionTitles[3].textContent = dict.sec_integrasi;
    if (dict.sec_penggajian) sectionTitles[4].textContent = dict.sec_penggajian;
    if (dict.sec_sistem) sectionTitles[5].textContent = dict.sec_sistem;
  }

  // 3. Terjemahkan Dropdown Kas Management & Submenunya
  const kasToggle = document.querySelector('.nav-dropdown-toggle[data-menu="kas"] span, .nav-dropdown-toggle[onclick*="dropdownKas"] span');
  if (kasToggle && dict.kas) kasToggle.textContent = dict.kas;

  const sublinks = document.querySelectorAll(".nav-submenu a.nav-link span");
  sublinks.forEach(span => {
    const text = span.textContent.trim().toLowerCase();
    if (text.includes("ringkasan") && dict.ringkasan_kas) span.textContent = dict.ringkasan_kas;
    else if (text.includes("modal") && dict.modal_harian) span.textContent = dict.modal_harian;
    else if (text.includes("masuk") && dict.kas_masuk) span.textContent = dict.kas_masuk;
    else if (text.includes("keluar") && dict.kas_keluar) span.textContent = dict.kas_keluar;
    else if (text.includes("shift") && !text.includes("closing") && dict.kas_shift) span.textContent = dict.kas_shift;
    else if (text.includes("closing") && dict.closing) span.textContent = dict.closing;
    else if (text.includes("top up") && dict.topup) span.textContent = dict.topup;
    else if (text.includes("tarik") && dict.tarik) span.textContent = dict.tarik;
  });

  // 4. Terjemahkan Header Judul Halaman Utama
  const headerTitle = document.querySelector(".header-title");
  if (headerTitle) {
    const curHdr = headerTitle.textContent.trim().toLowerCase();
    if (curHdr.includes("pembelian") || curHdr.includes("purchase") || curHdr.includes("kulakan") || curHdr.includes("balanja")) {
      headerTitle.textContent = dict.hdr_pembelian || dict.pembelian;
    } else if (curHdr.includes("kasir") || curHdr.includes("cashier") || curHdr.includes("juruwang")) {
      headerTitle.textContent = dict.hdr_kasir || dict.kasir;
    } else if (curHdr.includes("pengaturan") || curHdr.includes("setting") || curHdr.includes("tetapan") || curHdr.includes("setelan")) {
      headerTitle.textContent = dict.hdr_setting || dict.setting;
    } else if (curHdr.includes("dashboard") || curHdr.includes("pemuka") || curHdr.includes("ngarep")) {
      headerTitle.textContent = dict.dashboard;
    } else if (curHdr.includes("riwayat") || curHdr.includes("history") || curHdr.includes("sejarah") || curHdr.includes("catetan")) {
      headerTitle.textContent = dict.riwayat;
    }
  }

  // 5. Kamus Khusus untuk Komponen Halaman (Tab, Dashboard Card & Form)
  const compDict = {
    en: {
      toko: "Store", akun: "Account", printer: "Printer", tampilan: "Appearance", bahasa: "Language", lanjutan: "Advanced",
      kas_laci: "CASH IN DRAWER", penjualan_hari_ini: "TODAY'S SALES", tutup: "Closed", buka: "Open",
      ops_kasir: "Cashier Operations", buka_shift: "Open Work Shift", tutup_shift: "Close Work Shift",
      modal_toko: "TOTAL STORE CAPITAL", total_tx: "TOTAL TRANSACTIONS", kasir_tugas: "DUTY CASHIER", laba_bersih: "TOTAL NET PROFIT",
      hitung_kas: "Drawer Cash Physical Calculation", filter_hari_ini: "Today",
      modal_staf: "Total Staff Capital", uang_masuk: "Other Cash In", kas_keluar: "Store Cash Out",
      jual_produk: "Product Sales", topup_admin: "Top Up + Admin (Cash)", tarik_tunai: "Cash Withdrawal (Out)",
      jual_nontunai: "Non-Cash Sales", tarik_nontunai: "Non-Cash Withdrawal",
      toko_title: "Store & Receipt Identity", nama_toko: "Store / Business Name", alamat_toko: "Full Address",
      telp_toko: "WhatsApp / Phone No.", footer_struk: "Receipt Footer Note", btn_simpan_toko: "Save Store Information",
      profil_title: "Your Account Profile", nama_lengkap: "Full Name", btn_ubah_nama: "Update Name", btn_ganti_pass: "Change Password",
      btn_scan_bt: "Scan Bluetooth Printer", btn_bersihkan_semua: "Clear All", btn_test_print: "Test Print", btn_putuskan: "Disconnect",
      bahasa_title: "System Language (All Pages)", bahasa_desc: "Choose display language for menus, buttons, receipts, and system navigation.",
      zona_bahaya: "Danger Zone", btn_reset_halaman: "Go to Data Reset Page"
    },
    ms: {
      toko: "Kedai", akun: "Akaun", printer: "Pencetak", tampilan: "Rupa", bahasa: "Bahasa", lanjutan: "Lanjutan",
      kas_laci: "TUNAI DI LACI", penjualan_hari_ini: "JUALAN HARI INI", tutup: "Tutup", buka: "Buka",
      ops_kasir: "Operasi Juruwang", buka_shift: "Buka Syif Kerja", tutup_shift: "Tutup Syif Kerja",
      modal_toko: "JUMLAH MODAL KEDAI", total_tx: "JUMLAH TRANSAKSI", kasir_tugas: "JURUWANG BERTUGAS", laba_bersih: "JUMLAH UNTUNG BERSIH",
      hitung_kas: "Kiraan Tunai Fizikal Laci", filter_hari_ini: "Hari Ini",
      modal_staf: "Jumlah Modal Semua Staf", uang_masuk: "Wang Masuk Lain", kas_keluar: "Tunai Keluar Kedai",
      jual_produk: "Jualan Produk", topup_admin: "Tambah Nilai + Admin (Tunai)", tarik_tunai: "Pengeluaran Tunai (Keluar)",
      jual_nontunai: "Jualan Bukan Tunai", tarik_nontunai: "Pengeluaran Bukan Tunai",
      toko_title: "Identiti & Resit Kedai", nama_toko: "Nama Perniagaan / Kedai", alamat_toko: "Alamat Penuh",
      telp_toko: "No. WhatsApp / Telefon", footer_struk: "Nota Kaki Resit", btn_simpan_toko: "Simpan Maklumat Kedai",
      profil_title: "Profil Akaun Anda", nama_lengkap: "Nama Penuh", btn_ubah_nama: "Kemas Kini Nama", btn_ganti_pass: "Tukar Kata Laluan",
      btn_scan_bt: "Imbas Pencetak Bluetooth", btn_bersihkan_semua: "Bersihkan Semua", btn_test_print: "Uji Cetak", btn_putuskan: "Putuskan",
      bahasa_title: "Bahasa Sistem (Semua Halaman)", bahasa_desc: "Pilih bahasa paparan untuk menu, butang, resit, dan navigasi WebPOS.",
      zona_bahaya: "Zon Bahaya", btn_reset_halaman: "Pergi ke Halaman Set Semula Data"
    },
    jv: {
      toko: "Toko", akun: "Akun", printer: "Printer", tampilan: "Rupa", bahasa: "Basa", lanjutan: "Liyane",
      kas_laci: "DHUWIT NENG LACI", penjualan_hari_ini: "PAYU DINA IKI", tutup: "Tutup", buka: "Bukak",
      ops_kasir: "Operasional Kasir", buka_shift: "Bukak Giliran Kerja", tutup_shift: "Tutup Giliran Kerja",
      modal_toko: "GUNGGUNG MODHAL TOKO", total_tx: "GUNGGUNG TRANSAKSI", kasir_tugas: "KASIR BERTUGAS", laba_bersih: "BATHI BERSIH",
      hitung_kas: "Itungan Dhuwit Fisik Laci", filter_hari_ini: "Dina Iki",
      modal_staf: "Gunggung Modhal Staf", uang_masuk: "Dhuwit Mlebu Liyane", kas_keluar: "Dhuwit Kas Metu",
      jual_produk: "Payu Dagangan", topup_admin: "Isi Saldo + Admin", tarik_tunai: "Tarik Dhuwit Tunai",
      jual_nontunai: "Payu Non-Tunai", tarik_nontunai: "Tarik Non-Tunai",
      toko_title: "Identitas & Struk Toko", nama_toko: "Jeneng Usaha / Toko", alamat_toko: "Alamat Jangkep",
      telp_toko: "No. WhatsApp / Telpon", footer_struk: "Catetan Buntut Struk", btn_simpan_toko: "Simpen Info Toko",
      profil_title: "Profil Akun Sampeyan", nama_lengkap: "Jeneng Jangkep", btn_ubah_nama: "Anyari Jeneng", btn_ganti_pass: "Ganti Password",
      btn_scan_bt: "Pindai Printer Bluetooth", btn_bersihkan_semua: "Busek Kabeh", btn_test_print: "Tes Print", btn_putuskan: "Pedhotake",
      bahasa_title: "Basa Sistem (Kabeh Kaca)", bahasa_desc: "Pilih basa tampilan kanggo menu, tombol, struk, lan sakabehe navigasi WebPOS.",
      zona_bahaya: "Tlatah Mbebayani", btn_reset_halaman: "Mlebu Kaca Busek Data"
    },
    su: {
      toko: "Toko", akun: "Akun", printer: "Printer", tampilan: "Rupa", bahasa: "Basa", lanjutan: "Lanjutan",
      kas_laci: "DUIT DINA LACI", penjualan_hari_ini: "PAJALAN DINTEN IEU", tutup: "Tutup", buka: "Buka",
      ops_kasir: "Operasional Kasir", buka_shift: "Buka Giliran Gawé", tutup_shift: "Tutup Giliran Gawé",
      modal_toko: "JUMLAH MODAL TOKO", total_tx: "JUMLAH TRANSAKSI", kasir_tugas: "KASIR TUGAS", laba_bersih: "BATI BERSIH",
      hitung_kas: "Itungan Duit Fisik Laci", filter_hari_ini: "Dinten Ieu",
      modal_staf: "Jumlah Modal Sadaya Staf", uang_masuk: "Duit Lebet Sanesna", kas_keluar: "Duit Kas Kaluar",
      jual_produk: "Pajalan Dagangan", topup_admin: "Eusi Saldo + Admin", tarik_tunai: "Tarik Duit Tunai",
      jual_nontunai: "Pajalan Non-Tunai", tarik_nontunai: "Tarik Non-Tunai",
      toko_title: "Idéntitas & Struk Toko", nama_toko: "Nami Usaha / Toko", alamat_toko: "Alamat Lengkep",
      telp_toko: "No. WhatsApp / Telepon", footer_struk: "Catetan Handap Struk", btn_simpan_toko: "Simpen Inpormasi Toko",
      profil_title: "Profil Akun Anjeun", nama_lengkap: "Nami Lengkep", btn_ubah_nama: "Robi Nami", btn_ganti_pass: "Gentos Sandi",
      btn_scan_bt: "Parios Printer Bluetooth", btn_bersihkan_semua: "Beresihan Sadayana", btn_test_print: "Cobi Citak", btn_putuskan: "Pegatkeun",
      bahasa_title: "Basa Sistem (Sadaya Kaca)", bahasa_desc: "Pilih basa tampilan kanggo menu, tombol, struk, sareng sadaya navigasi WebPOS.",
      zona_bahaya: "Zona Bahaya", btn_reset_halaman: "Kaca Mupus Sadaya Data"
    },
    ar: {
      toko: "المتجر", akun: "الحساب", printer: "الطابعة", tampilan: "المظهر", bahasa: "اللغة", lanjutan: "متقدم",
      kas_laci: "نقدية الدرج", penjualan_hari_ini: "مبيعات اليوم", tutup: "مغلق", buka: "مفتوح",
      ops_kasir: "عمليات الكاشير", buka_shift: "فتح المناوبة", tutup_shift: "إغلاق المناوبة",
      modal_toko: "إجمالي رأس المال", total_tx: "إجمالي المعاملات", kasir_tugas: "الكاشير المناوب", laba_bersih: "صافي الأرباح",
      hitung_kas: "جرد نقدية الدرج الفعلية", filter_hari_ini: "اليوم",
      modal_staf: "رأس مال الموظفين", uang_masuk: "إيرادات أخرى", kas_keluar: "مصروفات المتجر",
      jual_produk: "مبيعات المنتجات", topup_admin: "شحن رصيد + عمولة", tarik_tunai: "سحب نقدي (خارج)",
      jual_nontunai: "مبيعات غير نقدية", tarik_nontunai: "سحب غير نقدي",
      toko_title: "بيانات المتجر والإيصال", nama_toko: "اسم المتجر / النشاط", alamat_toko: "العنوان بالكامل",
      telp_toko: "رقم الهاتف / واتساب", footer_struk: "ملاحظة تذييل الإيصال", btn_simpan_toko: "حفظ بيانات المتجر",
      profil_title: "الملف الشخصي", nama_lengkap: "الاسم الكامل", btn_ubah_nama: "تحديث الاسم", btn_ganti_pass: "تغيير كلمة المرور",
      btn_scan_bt: "البحث عن طابعة بلوتوث", btn_bersihkan_semua: "مسح الكل", btn_test_print: "طباعة تجريبية", btn_putuskan: "قطع الاتصال",
      bahasa_title: "لغة النظام (لكل الصفحات)", bahasa_desc: "اختر لغة العرض للقوائم والأزرار والإيصالات ونظام الملاحة.",
      zona_bahaya: "منطقة الخطر", btn_reset_halaman: "الانتقال إلى صفحة إعادة الضبط"
    },
    id: {
      toko: "Toko", akun: "Akun", printer: "Printer", tampilan: "Tampilan", bahasa: "Bahasa", lanjutan: "Lanjutan",
      kas_laci: "KAS DI LACI", penjualan_hari_ini: "PENJUALAN HARI INI", tutup: "Tutup", buka: "Buka",
      ops_kasir: "Operasional Kasir", buka_shift: "Buka Shift Kerja", tutup_shift: "Tutup Shift Kerja",
      modal_toko: "TOTAL MODAL TOKO", total_tx: "TOTAL TRANSAKSI", kasir_tugas: "KASIR BERTUGAS", laba_bersih: "TOTAL LABA BERSIH",
      hitung_kas: "Perhitungan Kas Fisik Laci", filter_hari_ini: "Hari Ini",
      modal_staf: "Total Modal Seluruh Staf", uang_masuk: "Uang Masuk Lain", kas_keluar: "Kas Keluar Toko",
      jual_produk: "Penjualan Produk", topup_admin: "Top Up + Admin (Fisik)", tarik_tunai: "Tarik Tunai (Fisik Keluar)",
      jual_nontunai: "Penjualan Non-Tunai", tarik_nontunai: "Tarik Non-Tunai",
      toko_title: "Identitas & Struk Toko", nama_toko: "Nama Usaha / Toko", alamat_toko: "Alamat Lengkap",
      telp_toko: "No. WhatsApp / Telepon", footer_struk: "Catatan Footer Struk", btn_simpan_toko: "Simpan Informasi Toko",
      profil_title: "Profil Akun Anda", nama_lengkap: "Nama Lengkap", btn_ubah_nama: "Perbarui Nama", btn_ganti_pass: "Ganti Password",
      btn_scan_bt: "Pindai (Scan) Printer Bluetooth", btn_bersihkan_semua: "Bersihkan Semua", btn_test_print: "Test Print", btn_putuskan: "Putuskan",
      bahasa_title: "Bahasa Sistem (Berlaku Semua Halaman)", bahasa_desc: "Pilih bahasa tampilan untuk menu, tombol, struk, dan seluruh navigasi sistem WebPOS.",
      zona_bahaya: "Zona Berbahaya", btn_reset_halaman: "Masuk ke Halaman Reset Data"
    }
  };

  const curT = compDict[lang] || compDict["id"];

  // A. Terjemahkan Tab Setting (Toko, Akun, Printer, Tampilan, Bahasa, Lanjutan)
  const tabToko = document.querySelector('.tab-btn[data-tab="tab-toko"]');
  if (tabToko) setSafeText(tabToko, curT.toko);
  const tabAkun = document.querySelector('.tab-btn[data-tab="tab-akun"]');
  if (tabAkun) setSafeText(tabAkun, curT.akun);
  const tabPrinter = document.querySelector('.tab-btn[data-tab="tab-printer"]');
  if (tabPrinter) setSafeText(tabPrinter, curT.printer);
  const tabTampilan = document.querySelector('.tab-btn[data-tab="tab-tampilan"]');
  if (tabTampilan) setSafeText(tabTampilan, curT.tampilan);
  const tabBahasa = document.querySelector('.tab-btn[data-tab="tab-bahasa"]');
  if (tabBahasa) setSafeText(tabBahasa, curT.bahasa);
  const tabLanjutan = document.querySelector('.tab-btn[data-tab="tab-lanjutan"]');
  if (tabLanjutan) setSafeText(tabLanjutan, curT.lanjutan);

  // B. Terjemahkan Card Title & Judul Modul di Halaman Setting & Dashboard
  document.querySelectorAll(".card-title").forEach(ct => {
    const txt = ct.textContent.trim().toLowerCase();
    if (txt.includes("identitas & struk") || txt.includes("store & receipt") || txt.includes("identiti & resit")) setSafeText(ct, curT.toko_title);
    else if (txt.includes("profil akun") || txt.includes("account profile") || txt.includes("profil akaun")) setSafeText(ct, curT.profil_title);
    else if (txt.includes("bahasa sistem") || txt.includes("system language")) setSafeText(ct, curT.bahasa_title);
    else if (txt.includes("zona berbahaya") || txt.includes("danger zone") || txt.includes("zon bahaya")) setSafeText(ct, curT.zona_bahaya);
  });

  // C. Terjemahkan Deskripsi di Tab Bahasa
  const descEl = document.querySelector('#tab-bahasa .card-body p');
  if (descEl) descEl.textContent = curT.bahasa_desc;

  // D. Terjemahkan Form Label di Pengaturan
  document.querySelectorAll(".form-label").forEach(lbl => {
    const t = lbl.textContent.trim().toLowerCase();
    if (t.includes("nama usaha") || t.includes("store / business name") || t.includes("nama perniagaan")) lbl.textContent = curT.nama_toko;
    else if (t.includes("alamat lengkap") || t.includes("full address") || t.includes("alamat penuh")) lbl.textContent = curT.alamat_toko;
    else if (t.includes("whatsapp") || t.includes("telepon") || t.includes("telefon") || t.includes("phone")) lbl.textContent = curT.telp_toko;
    else if (t.includes("footer") || t.includes("kaki resit")) lbl.textContent = curT.footer_struk;
    else if (t.includes("nama lengkap") || t.includes("full name") || t.includes("nama penuh")) lbl.textContent = curT.nama_lengkap;
  });

  // E. Terjemahkan Tombol-Tombol Aksi di Pengaturan
  const btnSaveStore = document.getElementById("btnSaveStore");
  if (btnSaveStore) setSafeText(btnSaveStore, curT.btn_simpan_toko);

  const btnSaveProfile = document.getElementById("btnSaveProfile");
  if (btnSaveProfile) setSafeText(btnSaveProfile, curT.btn_ubah_nama);

  const btnOpenPasswordModal = document.getElementById("btnOpenPasswordModal");
  if (btnOpenPasswordModal) setSafeText(btnOpenPasswordModal, curT.btn_ganti_pass);

  const btnScanBluetooth = document.getElementById("btnScanBluetooth");
  if (btnScanBluetooth) setSafeText(btnScanBluetooth, curT.btn_scan_bt);

  const btnTestPrint = document.getElementById("btnTestPrint");
  if (btnTestPrint) setSafeText(btnTestPrint, curT.btn_test_print);

  const btnDisconnectPrinter = document.getElementById("btnDisconnectPrinter");
  if (btnDisconnectPrinter) setSafeText(btnDisconnectPrinter, curT.btn_putuskan);

  // F. Terjemahkan Elemen di Dashboard (index.html)
  // 1. Header KAS DI LACI & PENJUALAN HARI INI
  document.querySelectorAll(".main-header div, .main-header span").forEach(el => {
    const t = el.textContent.trim().toUpperCase();
    if (t === "KAS DI LACI" || t === "CASH IN DRAWER" || t === "TUNAI DI LACI") el.textContent = curT.kas_laci;
    else if (t === "PENJUALAN HARI INI" || t === "TODAY'S SALES" || t === "JUALAN HARI INI") el.textContent = curT.penjualan_hari_ini;
  });

  // 2. Status Buka / Tutup di Header
  document.querySelectorAll(".main-header button, .main-header .badge, #shiftStatusBadge").forEach(el => {
    const t = el.textContent.trim().toLowerCase();
    if (t === "tutup" || t === "closed") setSafeText(el, curT.tutup);
    else if (t === "buka" || t === "open") setSafeText(el, curT.buka);
  });

  // 3. Card Operasional Kasir & Statistik Dashboard
  document.querySelectorAll(".main-content div, .main-content span, .main-content h2, .main-content h3").forEach(el => {
    if (el.children.length === 0) {
      const t = el.textContent.trim();
      if (t === "Operasional Kasir" || t === "Cashier Operations" || t === "Operasi Juruwang") el.textContent = curT.ops_kasir;
      else if (t === "Buka Shift Kerja" || t === "Open Work Shift" || t === "Buka Syif Kerja") el.textContent = curT.buka_shift;
      else if (t === "Tutup Shift Kerja" || t === "Close Work Shift" || t === "Tutup Syif Kerja") el.textContent = curT.tutup_shift;
      else if (t === "TOTAL MODAL TOKO" || t === "TOTAL STORE CAPITAL" || t === "JUMLAH MODAL KEDAI") el.textContent = curT.modal_toko;
      else if (t === "TOTAL TRANSAKSI" || t === "TOTAL TRANSACTIONS" || t === "JUMLAH TRANSAKSI") el.textContent = curT.total_tx;
      else if (t === "KASIR BERTUGAS" || t === "DUTY CASHIER" || t === "JURUWANG BERTUGAS") el.textContent = curT.kasir_tugas;
      else if (t === "TOTAL LABA BERSIH" || t === "TOTAL NET PROFIT" || t === "JUMLAH UNTUNG BERSIH") el.textContent = curT.laba_bersih;
      else if (t === "Perhitungan Kas Fisik Laci" || t === "Drawer Cash Physical Calculation" || t === "Kiraan Tunai Fizikal Laci") el.textContent = curT.hitung_kas;
      else if (t === "Total Modal Seluruh Staf" || t === "Total Staff Capital") el.textContent = curT.modal_staf;
      else if (t === "Uang Masuk Lain" || t === "Other Cash In") el.textContent = curT.uang_masuk;
      else if (t === "Kas Keluar Toko" || t === "Store Cash Out") el.textContent = curT.kas_keluar;
      else if (t === "Penjualan Produk" || t === "Product Sales") el.textContent = curT.jual_produk;
      else if (t === "Top Up + Admin (Fisik)" || t === "Top Up + Admin (Cash)") el.textContent = curT.topup_admin;
      else if (t === "Tarik Tunai (Fisik Keluar)" || t === "Cash Withdrawal (Out)") el.textContent = curT.tarik_tunai;
      else if (t === "Penjualan Non-Tunai" || t === "Non-Cash Sales") el.textContent = curT.jual_nontunai;
      else if (t === "Tarik Non-Tunai" || t === "Non-Cash Withdrawal") el.textContent = curT.tarik_nontunai;
    }
  });

  // 6. Terjemahkan Input Placeholder
  const searchInput = document.getElementById("menuSearch");
  if (searchInput && dict.cari) searchInput.placeholder = dict.cari;

  // 7. Terjemahkan Tombol Logout
  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout && dict.logout) btnLogout.setAttribute("title", dict.logout);

  // 8. Terjemahkan Bottom Nav Mobile
  document.querySelectorAll(".mobile-nav-item, .mobile-bar-item").forEach(item => {
    const span = item.querySelector("span");
    const href = item.getAttribute("href") || "";
    if (!span) return;
    if (href.includes("index") && dict.dashboard) span.textContent = dict.dashboard;
    else if (href.includes("kasir") && dict.kasir) span.textContent = dict.kasir;
    else if (href.includes("produk") && dict.produk) span.textContent = dict.produk;
    else if (href.includes("riwayat") && dict.riwayat) span.textContent = dict.riwayat;
    else if (href.includes("setting") && dict.setting) span.textContent = dict.setting;
  });
}

// Hubungkan ke window agar bisa dipanggil langsung dari setting
window.applyGlobalTranslations = applyGlobalTranslations;

// Jalankan otomatis saat halaman selesai dimuat (DOM ready)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    applyGlobalTranslations();
    applyMenuVisibility();
  });
} else {
  applyGlobalTranslations();
  applyMenuVisibility();
}

// Jalankan ulang saat tab kembali aktif atau saat ganti bahasa di tab lain
window.addEventListener("pageshow", applyGlobalTranslations);
window.addEventListener("storage", (e) => {
  if (e.key === "webpos_language") applyGlobalTranslations();
});
