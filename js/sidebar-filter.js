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
// 🎨 GLOBAL THEME STYLE ENGINE (OTOMATIS AKTIF DI SEMUA HALAMAN)
// ==============================================================
(function initGlobalThemeStyles() {
  // 1. Terapkan gaya tema yang tersimpan di localStorage
  const savedStyle = localStorage.getItem("webpos_theme_style") || "standard";
  document.documentElement.setAttribute("data-theme-style", savedStyle);

  // 2. Tanamkan CSS Gaya Desain langsung ke <head> tanpa perlu ubah HTML
  const css = `
    /* TEMA 1: GLASSMORPHISM (Efek Kaca & Blur Mewah) */
    [data-theme-style="glass"] {
      --bg-base: #f0f4f8;
      --bg-surface: rgba(255, 255, 255, 0.78);
      --border: rgba(255, 255, 255, 0.6);
      --shadow-sm: 0 4px 15px rgba(0,0,0,0.05);
      --shadow-md: 0 8px 30px rgba(0,0,0,0.08);
      --radius-lg: 18px; --radius-xl: 22px;
    }
    [data-theme-style="glass"] .card, 
    [data-theme-style="glass"] .sidebar, 
    [data-theme-style="glass"] .main-header {
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
    }
    [data-theme="dark"][data-theme-style="glass"] {
      --bg-base: #060911;
      --bg-surface: rgba(17, 24, 39, 0.78);
      --border: rgba(255, 255, 255, 0.1);
    }

    /* TEMA 2: COMPACT FINTECH (Ramping, Sudut Tegas & Cepat) */
    [data-theme-style="compact"] {
      --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 10px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.03);
      --shadow-md: 0 2px 4px rgba(0,0,0,0.05);
      --border: #cbd5e1;
    }
    [data-theme-style="compact"] .card {
      border-radius: 8px !important; box-shadow: none !important;
    }

    /* TEMA 3: WARM CAFE (Krem Hangat & Sudut Halus Nyaman) */
    [data-theme-style="warm"] {
      --bg-base: #fbf9f5; --bg-surface: #ffffff; --bg-subtle: #f4efe6; --border: #e8dfd1;
      --radius-lg: 20px; --radius-xl: 26px;
      --shadow-sm: 0 2px 6px rgba(180, 150, 120, 0.08);
    }
    [data-theme="dark"][data-theme-style="warm"] {
      --bg-base: #14110e; --bg-surface: #1e1915; --bg-subtle: #29221d; --border: #3d342c;
    }

    /* TEMA 4: BOLD POP (Tegas 3D, Kontras Tinggi & Anti-Bosan) */
    [data-theme-style="bold"] {
      --radius-lg: 12px; --radius-xl: 14px; --border: #0f172a;
      --shadow-sm: 2px 2px 0px #0f172a; --shadow-md: 4px 4px 0px #0f172a;
    }
    [data-theme-style="bold"] .card, [data-theme-style="bold"] .btn {
      border: 2px solid var(--border) !important;
      box-shadow: 3px 3px 0px var(--border) !important;
    }
    [data-theme="dark"][data-theme-style="bold"] {
      --border: #94a3b8; --shadow-sm: 2px 2px 0px #94a3b8; --shadow-md: 4px 4px 0px #94a3b8;
    }
  `;

  // Suntikkan style otomatis ke <head>
  const styleEl = document.createElement("style");
  styleEl.id = "webposGlobalThemeStyle";
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
})();

// Jalankan saat dokumen selesai dimuat
document.addEventListener("DOMContentLoaded", applyMenuVisibility);
