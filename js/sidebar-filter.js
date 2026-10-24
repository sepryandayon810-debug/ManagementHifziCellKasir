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
// 🌐 GLOBAL MULTI-LANGUAGE ENGINE (BERLAKU DI SEMUA HALAMAN)
// ==============================================================
const WEBPOS_DICTIONARY = {
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
    simpan: "Save",
    batal: "Cancel",
    tambah: "Add",
    hapus: "Delete",
    cari: "Search menu..."
  },
  ms: {
    dashboard: "Papan Pemuka",
    kasir: "Juruwang",
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
    tarik: "Tarik Tunai",
    pembelian: "Belian / Stok",
    hutang: "Hutang & Piutang",
    laporan: "Laporan Jualan",
    laporan_stok: "Laporan Stok",
    terlaris: "Barang Terlaris",
    telegram: "Baki Telegram",
    pelanggan: "Data Pelanggan",
    penggajian: "Gaji Pekerja",
    pengguna: "Akaun Pengguna",
    setting: "Tetapan",
    backup: "Sandaran & Segerak",
    log: "Log Aktiviti",
    printer: "Pencetak & Resit",
    reset: "Set Semula Data",
    logout: "Keluar",
    simpan: "Simpan",
    batal: "Batal",
    tambah: "Tambah",
    hapus: "Padam",
    cari: "Cari menu..."
  },
  jv: {
    dashboard: "Kaca Ngarep",
    kasir: "Kasir",
    produk: "Dagangan",
    riwayat: "Catatan Dagang",
    kas: "Ngatur Dhuwit Kas",
    ringkasan_kas: "Ringkesan Kas",
    modal_harian: "Modal Saben Dina",
    kas_masuk: "Dhuwit Mlebu",
    kas_keluar: "Dhuwit Metu",
    kas_shift: "Kas & Giliran",
    closing: "Tutup Giliran",
    topup: "Isi Saldo",
    tarik: "Jupuk Dhuwit",
    pembelian: "Kulakan Barang",
    hutang: "Utang & Piutang",
    laporan: "Laporan Payu",
    laporan_stok: "Laporan Simpenan",
    terlaris: "Paling Laris",
    telegram: "Saldo Telegram",
    pelanggan: "Data Langganan",
    penggajian: "Bayaran Karyawan",
    pengguna: "Panganggo",
    setting: "Setelan",
    backup: "Nyimpen & Sengkuyung",
    log: "Catatan Polah",
    printer: "Mesin Cetak",
    reset: "Busek Kabeh",
    logout: "Metu",
    simpan: "Simpen",
    batal: "Wurung",
    tambah: "Wuwuh",
    hapus: "Busek",
    cari: "Goleki menu..."
  },
  su: {
    dashboard: "Kaca Utama",
    kasir: "Kasir",
    produk: "Barang Dagangan",
    riwayat: "Riywayat Transaksi",
    kas: "Ngalarapkeun Kas",
    ringkasan_kas: "Ringkesan Kas",
    modal_harian: "Modal Sapopoe",
    kas_masuk: "Duit Asup",
    kas_keluar: "Duit Kaluar",
    kas_shift: "Kas & Shift",
    closing: "Tutup Shift",
    topup: "Eusi Saldo",
    tarik: "Tarik Duit",
    pembelian: "Balanja Stok",
    hutang: "Hutang & Sambetan",
    laporan: "Laporan Pajalan",
    laporan_stok: "Laporan Stok",
    terlaris: "Pangpayuna",
    telegram: "Saldo Telegram",
    pelanggan: "Data Langganan",
    penggajian: "Gajih Pagawé",
    pengguna: "Pamaké",
    setting: "Setélan",
    backup: "Cadangan & Singkron",
    log: "Catatan Gawé",
    printer: "Mesin Citak",
    reset: "Hapus Sadayana",
    logout: "Kaluar",
    simpan: "Simpen",
    batal: "Bongkar",
    tambah: "Tambihan",
    hapus: "Hapus",
    cari: "Milari menu..."
  },
  ar: {
    dashboard: "لوحة التحكم",
    kasir: "نقطة البيع",
    produk: "المنتجات",
    riwayat: "سجل المعاملات",
    kas: "إدارة الصندوق",
    ringkasan_kas: "ملخص النقد",
    modal_harian: "رأس المال اليومي",
    kas_masuk: "واردات الصندوق",
    kas_keluar: "مصروفات الصندوق",
    kas_shift: "الوردية والنقد",
    closing: "إغلاق الوردية",
    topup: "شحن رصيد",
    tarik: "سحب نقدي",
    pembelian: "المشتريات / المخزون",
    hutang: "الديون والمستحقات",
    laporan: "تقرير المبيعات",
    laporan_stok: "تقرير المخزون",
    terlaris: "الأكثر مبيعاً",
    telegram: "رصيد تيليجرام",
    pelanggan: "بيانات العملاء",
    penggajian: "كشف الرواتب",
    pengguna: "المستخدمين",
    setting: "الإعدادات",
    backup: "النسخ الاحتياطي",
    log: "سجل النشاط",
    printer: "الطابعة والإيصالات",
    reset: "إعادة ضبط",
    logout: "تسجيل خروج",
    simpan: "حفظ",
    batal: "إلغاء",
    tambah: "إضافة",
    hapus: "حذف",
    cari: "بحث في القائمة..."
  }
};

function applyGlobalTranslations() {
  const lang = localStorage.getItem("webpos_language") || "id";
  if (lang === "id") {
    // Kembalikan ke teks asli Indonesia jika berpindah dari bahasa lain
    location.reload(); 
    return;
  }
  // 1. Terjemahkan Menu Sidebar
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

  // 2. Terjemahkan Dropdown Kas Management
  const kasToggle = document.querySelector('.nav-dropdown-toggle[data-menu="kas"] span, .nav-dropdown-toggle[onclick*="dropdownKas"] span');
  if (kasToggle && dict.kas) kasToggle.textContent = dict.kas;

  // Submenu Kas
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

  // 3. Terjemahkan Input Cari Menu
  const searchInput = document.getElementById("menuSearch");
  if (searchInput && dict.cari) searchInput.placeholder = dict.cari;

  // 4. Terjemahkan Tombol Logout Tooltip
  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout && dict.logout) btnLogout.setAttribute("title", dict.logout);

  // 5. Terjemahkan Mobile Bottom Nav
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

// Jalankan otomatis saat halaman selesai dimuat di SEMUA halaman
document.addEventListener("DOMContentLoaded", applyGlobalTranslations);

// Jalankan saat dokumen selesai dimuat
document.addEventListener("DOMContentLoaded", applyMenuVisibility);
