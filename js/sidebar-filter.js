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
// 🎨 GLOBAL THEME STYLE ENGINE LENGKAP (POLKADOT, GRID, AURA, DLL)
// ==============================================================
(function initGlobalThemeStyles() {
  const savedStyle = localStorage.getItem("webpos_theme_style") || "standard";
  document.documentElement.setAttribute("data-theme-style", savedStyle);

  const css = `
    /* 1. TEMA POLKADOT (Bintik-bintik Estetik & Playful) */
    [data-theme-style="polka"] {
      --bg-base: #f1f5f9;
      background-color: var(--bg-base) !important;
      background-image: radial-gradient(circle, rgba(79, 70, 229, 0.22) 2px, transparent 2px) !important;
      background-size: 22px 22px !important;
      background-attachment: fixed !important;
    }
    [data-theme="dark"][data-theme-style="polka"] {
      --bg-base: #090d16;
      background-color: var(--bg-base) !important;
      background-image: radial-gradient(circle, rgba(165, 180, 252, 0.25) 2px, transparent 2px) !important;
      background-size: 22px 22px !important;
      background-attachment: fixed !important;
    }

    /* 2. TEMA CYBER GRID (Kotak-kotak Garis Matrix / Blueprint Modern) */
    [data-theme-style="grid"] {
      --bg-base: #f8fafc;
      background-color: var(--bg-base) !important;
      background-image: 
        linear-gradient(to right, rgba(15, 23, 42, 0.07) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(15, 23, 42, 0.07) 1px, transparent 1px) !important;
      background-size: 24px 24px !important;
      background-attachment: fixed !important;
    }
    [data-theme="dark"][data-theme-style="grid"] {
      --bg-base: #090d16;
      background-color: var(--bg-base) !important;
      background-image: 
        linear-gradient(to right, rgba(255, 255, 255, 0.06) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255, 255, 255, 0.06) 1px, transparent 1px) !important;
      background-size: 24px 24px !important;
      background-attachment: fixed !important;
    }

    /* 3. TEMA AURA MESH (Gradien Lembut Halus Berpendar) */
    [data-theme-style="aura"] {
      --bg-base: #faf5ff;
      background-color: var(--bg-base) !important;
      background-image: 
        radial-gradient(at 0% 0%, rgba(79, 70, 229, 0.15) 0px, transparent 55%),
        radial-gradient(at 100% 100%, rgba(236, 72, 153, 0.15) 0px, transparent 55%) !important;
      background-attachment: fixed !important;
    }
    [data-theme="dark"][data-theme-style="aura"] {
      --bg-base: #0a0814;
      background-color: var(--bg-base) !important;
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.22) 0px, transparent 55%),
        radial-gradient(at 100% 100%, rgba(217, 70, 239, 0.2) 0px, transparent 55%) !important;
      background-attachment: fixed !important;
    }

    /* 4. TEMA GLASS FROSTED (Efek Kaca Blur Transparan) */
    [data-theme-style="glass"] {
      --bg-base: #eef2f6;
      --bg-surface: rgba(255, 255, 255, 0.78);
      --border: rgba(255, 255, 255, 0.65);
      --shadow-sm: 0 4px 15px rgba(0,0,0,0.06);
    }
    [data-theme-style="glass"] .card, 
    [data-theme-style="glass"] .sidebar, 
    [data-theme-style="glass"] .main-header {
      backdrop-filter: blur(14px) !important;
      -webkit-backdrop-filter: blur(14px) !important;
    }
    [data-theme="dark"][data-theme-style="glass"] {
      --bg-base: #060911;
      --bg-surface: rgba(17, 24, 39, 0.78);
      --border: rgba(255, 255, 255, 0.12);
    }

    /* 5. TEMA WARM CAFE (Krem Hangat Estetik & Empuk) */
    [data-theme-style="warm"] {
      --bg-base: #fbf8f3;
      --bg-surface: #ffffff;
      --bg-subtle: #f3ece0;
      --border: #e6dcce;
      --radius-lg: 20px;
      --radius-xl: 24px;
    }
    [data-theme="dark"][data-theme-style="warm"] {
      --bg-base: #14110e;
      --bg-surface: #1e1915;
      --border: #383027;
    }

    /* 6. TEMA BOLD 3D POP (Tegas Timbul & Kontras Tinggi) */
    [data-theme-style="bold"] {
      --border: #0f172a;
      --radius-lg: 12px;
      --radius-xl: 14px;
      --shadow-sm: 2px 2px 0px #0f172a;
      --shadow-md: 4px 4px 0px #0f172a;
    }
    [data-theme-style="bold"] .card, [data-theme-style="bold"] .btn {
      border: 2px solid var(--border) !important;
      box-shadow: 3px 3px 0px var(--border) !important;
    }
    [data-theme="dark"][data-theme-style="bold"] {
      --border: #94a3b8;
      --shadow-sm: 2px 2px 0px #94a3b8;
      --shadow-md: 4px 4px 0px #94a3b8;
    }

    /* 7. TEMA COMPACT FINTECH (Sudut Tegas, Datar & Ramping) */
    [data-theme-style="compact"] {
      --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 10px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.03);
      --border: #cbd5e1;
    }
    [data-theme-style="compact"] .card {
      border-radius: 8px !important; box-shadow: none !important;
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
