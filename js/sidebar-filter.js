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
// 🎨 GLOBAL THEME ENGINE: BERLAKU DI SELURUH HALAMAN + RESET SETELAN AWAL
// ==============================================================
(function initGlobalThemeStyles() {
  const savedStyle = localStorage.getItem("webpos_theme_style") || "standard";
  const savedColor = localStorage.getItem("webpos_theme_color") || "indigo";
  document.documentElement.setAttribute("data-theme-style", savedStyle);
  document.documentElement.setAttribute("data-theme-color", savedColor);

  const css = `
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

    /* ===== CORAK MENYELURUH (SIDEBAR, BODY, DAN MAIN CONTENT) ===== */

    /* 1. POLKADOT */
    [data-theme-style="polka"],
    [data-theme-style="polka"] body,
    [data-theme-style="polka"] .main-content,
    [data-theme-style="polka"] .sidebar {
      background-color: var(--bg-base) !important;
      background-image: radial-gradient(circle, var(--primary) 2px, transparent 2px) !important;
      background-size: 18px 18px !important;
    }

    /* 2. CYBER GRID */
    [data-theme-style="grid"],
    [data-theme-style="grid"] body,
    [data-theme-style="grid"] .main-content,
    [data-theme-style="grid"] .sidebar {
      background-image: linear-gradient(to right, color-mix(in srgb, var(--primary) 15%, transparent) 1px, transparent 1px),
                        linear-gradient(to bottom, color-mix(in srgb, var(--primary) 15%, transparent) 1px, transparent 1px) !important;
      background-size: 22px 22px !important;
    }

    /* 3. AURA MESH */
    [data-theme-style="aura"],
    [data-theme-style="aura"] body,
    [data-theme-style="aura"] .main-content,
    [data-theme-style="aura"] .sidebar {
      background-image: radial-gradient(at 0% 0%, color-mix(in srgb, var(--primary) 18%, transparent) 0px, transparent 55%),
                        radial-gradient(at 100% 100%, rgba(236, 72, 153, 0.18) 0px, transparent 55%) !important;
      background-attachment: fixed !important;
    }

    /* 4. GLASS FROSTED */
    [data-theme-style="glass"] .sidebar,
    [data-theme-style="glass"] .main-header,
    [data-theme-style="glass"] .produk-card,
    [data-theme-style="glass"] .modal-summary-item {
      background: color-mix(in srgb, var(--bg-surface) 80%, transparent) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      border-color: rgba(255, 255, 255, 0.35) !important;
      box-shadow: 0 8px 30px rgba(0,0,0,0.06) !important;
    }

    /* 5. WARM CAFE */
    [data-theme-style="warm"] {
      --bg-base: #fbf8f3; --bg-surface: #ffffff; --bg-subtle: #f4eee2; --border: #e4d8c5;
    }
    [data-theme-style="warm"] body,
    [data-theme-style="warm"] .sidebar { background: #fbf8f3 !important; }

    /* 6. BOLD 3D POP */
    [data-theme-style="bold"] .sidebar,
    [data-theme-style="bold"] .produk-card,
    [data-theme-style="bold"] .modal-summary-item,
    [data-theme-style="bold"] .btn {
      border: 2px solid #0f172a !important;
      box-shadow: 3px 3px 0px #0f172a !important;
    }

    /* 7. CARBON SPORT */
    [data-theme-style="carbon"],
    [data-theme-style="carbon"] body,
    [data-theme-style="carbon"] .main-content,
    [data-theme-style="carbon"] .sidebar {
      background: radial-gradient(black 15%, transparent 16%) 0 0,
                  radial-gradient(black 15%, transparent 16%) 8px 8px,
                  radial-gradient(rgba(255,255,255,.1) 15%, transparent 20%) 0 1px,
                  radial-gradient(rgba(255,255,255,.1) 15%, transparent 20%) 8px 9px !important;
      background-color: #1e293b !important;
      background-size: 16px 16px !important;
    }

    /* 8. BATIK GEOMETRIC */
    [data-theme-style="batik"],
    [data-theme-style="batik"] body,
    [data-theme-style="batik"] .main-content,
    [data-theme-style="batik"] .sidebar {
      background-color: var(--bg-base) !important;
      background-image: linear-gradient(135deg, color-mix(in srgb, var(--primary) 12%, transparent) 25%, transparent 25%), 
                        linear-gradient(225deg, color-mix(in srgb, var(--primary) 12%, transparent) 25%, transparent 25%), 
                        linear-gradient(45deg, color-mix(in srgb, var(--primary) 12%, transparent) 25%, transparent 25%), 
                        linear-gradient(315deg, color-mix(in srgb, var(--primary) 12%, transparent) 25%, transparent 25%) !important;
      background-position: 12px 0, 12px 0, 0 0, 0 0 !important;
      background-size: 24px 24px !important;
    }

    /* 9. STARLIGHT */
    [data-theme-style="stars"],
    [data-theme-style="stars"] body,
    [data-theme-style="stars"] .main-content,
    [data-theme-style="stars"] .sidebar {
      background-color: #0b0f19 !important;
      background-image: radial-gradient(white 1px, transparent 1px), radial-gradient(rgba(255,255,255,0.7) 1.5px, transparent 1.5px) !important;
      background-size: 32px 32px, 48px 48px !important;
      background-position: 0 0, 16px 16px !important;
      color: #f8fafc !important;
    }

    /* 10. WOODEN CRAFT */
    [data-theme-style="wood"] body,
    [data-theme-style="wood"] .main-content,
    [data-theme-style="wood"] .sidebar {
      background-color: #f5ede1 !important;
      background-image: repeating-linear-gradient(45deg, rgba(180,83,9,0.06) 0px, rgba(180,83,9,0.06) 2px, transparent 2px, transparent 8px) !important;
    }

    /* 11. CHEVRON ZIGZAG */
    [data-theme-style="zigzag"],
    [data-theme-style="zigzag"] body,
    [data-theme-style="zigzag"] .main-content,
    [data-theme-style="zigzag"] .sidebar {
      background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, transparent) 25%, transparent 25%) -12px 0,
                  linear-gradient(225deg, color-mix(in srgb, var(--primary) 10%, transparent) 25%, transparent 25%) -12px 0,
                  linear-gradient(315deg, color-mix(in srgb, var(--primary) 10%, transparent) 25%, transparent 25%),
                  linear-gradient(45deg, color-mix(in srgb, var(--primary) 10%, transparent) 25%, transparent 25%) !important;
      background-size: 24px 24px !important;
    }

    /* 12. TECH CIRCUIT */
    [data-theme-style="circuit"],
    [data-theme-style="circuit"] body,
    [data-theme-style="circuit"] .main-content,
    [data-theme-style="circuit"] .sidebar {
      background-color: var(--bg-base) !important;
      background-image: radial-gradient(var(--primary) 15%, transparent 16%),
                        linear-gradient(45deg, transparent 48%, var(--primary) 50%, transparent 52%) !important;
      background-size: 26px 26px !important;
    }

    /* 13. COMIC POP ART */
    [data-theme-style="comic"],
    [data-theme-style="comic"] body,
    [data-theme-style="comic"] .main-content,
    [data-theme-style="comic"] .sidebar {
      background: radial-gradient(circle, #facc15 3px, transparent 3.5px) !important;
      background-size: 16px 16px !important;
      background-color: #fef08a !important;
    }

    /* 14. COMPACT FINTECH */
    [data-theme-style="compact"] {
      --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 8px;
    }
    [data-theme-style="compact"] .produk-card,
    [data-theme-style="compact"] .card { border-radius: 6px !important; box-shadow: none !important; }

    /* 15. SETELAN AWAL / NO FORMAT / STANDAR CLEAN */
    [data-theme-style="standard"],
    [data-theme-style="standard"] body,
    [data-theme-style="standard"] .main-content,
    [data-theme-style="standard"] .sidebar {
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

// Jalankan saat dokumen selesai dimuat
document.addEventListener("DOMContentLoaded", applyMenuVisibility);
