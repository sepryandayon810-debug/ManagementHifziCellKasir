/* WebPOS shared printer service.
 * Uses the Cordova bluetoothSerial plugin when running in the Android APK.
 * Browser preview remains available, but raw Bluetooth printing is intentionally
 * rejected because normal browsers cannot access classic Bluetooth ESC/POS.
 */
(function (global) {
  "use strict";

  const KEYS = {
    name: "webpos_printer_name",
    mac: "webpos_printer_mac"
  };

  function plugin() {
    return global.bluetoothSerial || null;
  }

  function config() {
    return {
      name: localStorage.getItem(KEYS.name) || "",
      mac: localStorage.getItem(KEYS.mac) || ""
    };
  }

  function save(device) {
    if (!device || !device.mac) throw new Error("MAC printer tidak valid");
    localStorage.setItem(KEYS.mac, String(device.mac));
    if (device.name) localStorage.setItem(KEYS.name, String(device.name));
    return config();
  }

  function clear() {
    localStorage.removeItem(KEYS.name);
    localStorage.removeItem(KEYS.mac);
  }

  function available() {
    return !!plugin();
  }

  function requirePlugin() {
    if (!available()) {
      throw new Error("Bluetooth printer hanya tersedia di APK Android WebPOS");
    }
    if (!config().mac) {
      throw new Error("Printer belum dipilih. Atur printer melalui menu Pengaturan");
    }
    return plugin();
  }

  function call(method, args) {
    return new Promise((resolve, reject) => {
      const api = requirePlugin();
      if (typeof api[method] !== "function") {
        reject(new Error("Fungsi bluetoothSerial." + method + " tidak tersedia"));
        return;
      }
      const values = Array.isArray(args) ? args.slice() : [];
      values.push(resolve, reject);
      try { api[method].apply(api, values); } catch (error) { reject(error); }
    });
  }

  function escPosText(text) {
    // The plugin accepts an ArrayBuffer/Uint8Array in most Cordova builds.
    // Keep ASCII-safe receipt content compatible with thermal printers.
    const value = String(text || "").replace(/[^\x00-\xFF]/g, "?");
    const bytes = new Uint8Array(value.length + 8);
    bytes.set([0x1b, 0x40], 0); // initialize
    for (let i = 0; i < value.length; i++) bytes[i + 2] = value.charCodeAt(i) & 0xff;
    bytes.set([0x0a, 0x0a, 0x1d, 0x56, 0x00, 0x00], value.length + 2);
    return bytes;
  }

  function connect() {
    const printer = requirePlugin();
    return call("connect", [config().mac]).then(() => printer);
  }

  async function print(text) {
    const printer = await connect();
    const data = text instanceof Uint8Array ? text : escPosText(text);
    try {
      await call("write", [data]);
    } finally {
      if (printer && typeof printer.disconnect === "function") {
        await new Promise(resolve => {
          try { printer.disconnect(resolve, resolve); } catch (_) { resolve(); }
        });
      }
    }
    return true;
  }

  function receiptText(tx) {
    tx = tx || {};
    const money = n => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
    const lines = [];
    lines.push(localStorage.getItem("webpos_store_name") || "HIFZI CELL");
    lines.push("================================");
    lines.push("No: " + (tx.id || "-"));
    lines.push("Kasir: " + (tx.cashierName || tx.userName || "-"));
    lines.push("--------------------------------");
    (Array.isArray(tx.items) ? tx.items : []).forEach(item => {
      const qty = item.quantity || item.qty || 1;
      lines.push(String(item.name || "Produk"));
      lines.push(qty + " x " + money(item.price) + " = " + money(item.total || qty * item.price));
    });
    lines.push("--------------------------------");
    lines.push("TOTAL: " + money(tx.total || tx.amount));
    lines.push("Bayar: " + money(tx.paymentAmount || tx.total || tx.amount));
    lines.push("Kembali: " + money(tx.change));
    lines.push("Metode: " + String(tx.paymentMethod || "Tunai").toUpperCase());
    lines.push("================================");
    lines.push("Terima kasih");
    return lines.join("\n");
  }

  async function test() {
    return print(receiptText({ id: "TEST", items: [{ name: "Test Printer", quantity: 1, price: 1000, total: 1000 }], total: 1000, paymentAmount: 1000 }));
  }

  global.WebPOSPrinter = Object.freeze({
    keys: KEYS, available, config, save, clear, connect, print, test,
    receiptText, escPosText
  });
})(window);
