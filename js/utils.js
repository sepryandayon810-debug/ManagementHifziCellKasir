// Utilitas Global & Manajemen UI WebPOS
const Utils = {
  formatRupiah: function(num) {
    return "Rp " + (num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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

  confirm: function(msg, callback) {
    if (window.confirm(msg)) {
      callback();
    }
  }
};
