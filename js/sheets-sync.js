/**
 * =========================================================================
 * WEBPOS - GOOGLE SHEETS SYNC & LIVE VIEWER HELPER (js/sheets-sync.js)
 * =========================================================================
 * File ini menangani seluruh fungsi:
 * 1. Menghubungkan input Web App URL & URL Spreadsheet ke localStorage.
 * 2. Mengambil 8 koleksi database dari Firestore:
 *    - transactions (Penjualan / Transaksi)
 *    - products (Master Produk & Stok)
 *    - debts (Hutang & Piutang)
 *    - shifts & closing (Kas & Shift)
 *    - purchases (Pembelian / Restock)
 *    - customers / customer_directory_v2 (Pelanggan)
 *    - payrolls (Penggajian)
 *    - saldo_topup_history & saldo_sisa_history (Saldo Tools & Kasir)
 * 3. Mengirimkan payload ke Google Apps Script (GAS) dengan progress bar (0% - 100%).
 * 4. Menampilkan Live Table Viewer 8 Tab interaktif lengkap dengan filter cari.
 * 5. Download Excel Multi-Tab (.xlsx) offline dengan SheetJS.
 * 6. Modal panduan setup & penyalin kode Google Apps Script.
 */

(function () {
  'use strict';

  // Defensive shim: Mencegah error jika script lama masih memanggil sheetIdInput / dbUrlInput
  function createSafeShim() {
    if (!document.getElementById('sheetIdInput')) {
      var d1 = document.createElement('input');
      d1.id = 'sheetIdInput';
      d1.type = 'hidden';
      d1.style.display = 'none';
      (document.body || document.documentElement).appendChild(d1);
    }
    if (!document.getElementById('dbUrlInput')) {
      var d2 = document.createElement('input');
      d2.id = 'dbUrlInput';
      d2.type = 'hidden';
      d2.style.display = 'none';
      (document.body || document.documentElement).appendChild(d2);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createSafeShim);
  } else {
    createSafeShim();
  }

  // Kode Google Apps Script yang tertanam langsung (siap disalin dari modal panduan)
  var GAS_SOURCE_CODE = `/**
 * GOOGLE APPS SCRIPT (GAS) - WEBPOS SYNC TO GOOGLE SHEETS
 * Otomatis menyusun 8 Tab di Spreadsheet:
 * 1_Penjualan_Transaksi, 2_Master_Produk_Stok, 3_Hutang_Piutang, 4_Kas_dan_Shift,
 * 5_Pembelian_Restock, 6_Data_Pelanggan, 7_Data_Penggajian, 8_Rekap_Saldo_Tools
 */

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    message: "Google Apps Script Web App WebPOS Aktif dan Siap!",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Server sibuk" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error("Payload kosong!");
    var payload = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var syncTime = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd/MM/yyyy HH:mm:ss");

    // 1. Tab Transaksi
    if (payload.transactions && Array.isArray(payload.transactions)) {
      writeTab(ss, "1_Penjualan_Transaksi", [
        "ID Nota", "Tanggal & Waktu", "Kasir", "Pelanggan", "Kategori", "Metode Bayar", "Rincian Barang", "Total (Rp)", "Laba (Rp)", "Status"
      ], payload.transactions.map(function(t) {
        return [
          t.id || t.invoiceNo || "-", t.date || "-", t.cashier || t.userName || "-", t.customerName || "-",
          t.category || "Penjualan", t.paymentMethod || "Tunai", formatItems(t.items),
          Number(t.total || 0), Number(t.profit || 0), t.status || "completed"
        ];
      }), "#0f9d58");
    }

    // 2. Tab Produk
    if (payload.products && Array.isArray(payload.products)) {
      writeTab(ss, "2_Master_Produk_Stok", [
        "ID Produk", "Barcode / SKU", "Nama Produk", "Kategori", "Harga Modal (Rp)", "Harga Jual (Rp)", "Harga Reseller (Rp)", "Stok", "Satuan", "Status"
      ], payload.products.map(function(p) {
        return [
          p.id || "-", p.barcode || p.sku || "-", p.name || "-", p.category || "-",
          Number(p.buyPrice || 0), Number(p.sellingPrice || 0), Number(p.resellerPrice || 0),
          Number(p.stock || 0), p.unit || "Pcs", p.status || "active"
        ];
      }), "#2563eb");
    }

    // 3. Tab Hutang
    if (payload.debts && Array.isArray(payload.debts)) {
      writeTab(ss, "3_Hutang_Piutang", [
        "ID Hutang", "Nama Pelanggan", "Jenis", "Tanggal", "Jatuh Tempo", "Nominal Awal (Rp)", "Sisa Tagihan (Rp)", "Status", "Catatan"
      ], payload.debts.map(function(d) {
        return [
          d.id || "-", d.contactName || d.customerName || "-",
          d.type === "payable" ? "Hutang Toko" : "Piutang Pelanggan",
          d.date || "-", d.dueDate || "-", Number(d.initialAmount || d.amount || 0),
          Number(d.remainingAmount !== undefined ? d.remainingAmount : (d.balance || 0)),
          d.status === "paid" ? "Lunas" : "Belum Lunas", d.notes || "-"
        ];
      }), "#dc2626");
    }

    // 4. Tab Kas & Shift
    if (payload.shifts && Array.isArray(payload.shifts)) {
      writeTab(ss, "4_Kas_dan_Shift", [
        "ID Shift", "Tanggal", "Kasir", "Modal Awal (Rp)", "Jam Buka", "Penjualan Tunai (Rp)", "Kas Masuk (Rp)", "Kas Keluar (Rp)", "Kas Akhir (Rp)", "Fisik Uang Riil (Rp)", "Selisih (Rp)", "Jam Tutup", "Status"
      ], payload.shifts.map(s => [
        s.id || "-", s.date || "-", s.cashier || "-", Number(s.startingCash || 0),
        s.openTime || "-", Number(s.cashSales || 0), Number(s.cashIn || 0), Number(s.cashOut || 0),
        Number(s.systemCash || 0), Number(s.actualCash || 0), Number(s.difference || 0),
        s.closeTime || "-", s.status || "closed"
      ]), "#7c3aed");
    }

    // 5. Tab Pembelian
    if (payload.purchases && Array.isArray(payload.purchases)) {
      writeTab(ss, "5_Pembelian_Restock", [
        "ID Faktur", "Tanggal", "Supplier", "Rincian Barang", "Total Biaya (Rp)", "Metode Bayar", "Status Bayar", "Status Stok"
      ], payload.purchases.map(function(b) {
        return [
          b.id || b.invoiceNo || "-", b.date || "-", b.supplierName || b.supplier || "-",
          formatItems(b.items), Number(b.totalCost || b.total || 0),
          b.paymentMethod || "Tunai", b.paymentStatus || "Lunas", b.stockStatus || "Diterima"
        ];
      }), "#d97706");
    }

    // 6. Tab Pelanggan
    if (payload.customers && Array.isArray(payload.customers)) {
      writeTab(ss, "6_Data_Pelanggan", [
        "ID Pelanggan", "Nama Pelanggan", "WhatsApp / HP", "ID / Meter PLN", "Total Belanja (Rp)", "Total Kunjungan", "Membership", "Tanggal Daftar"
      ], payload.customers.map(function(c) {
        return [
          c.id || "-", c.name || "-", c.phone || c.whatsapp || "-", c.plnId || "-",
          Number(c.totalSpent || 0), Number(c.visitCount || 0), c.membership || "Regular", c.createdAt || "-"
        ];
      }), "#0284c7");
    }

    // 7. Tab Penggajian
    if (payload.payrolls && Array.isArray(payload.payrolls)) {
      writeTab(ss, "7_Data_Penggajian", [
        "ID Payroll", "Periode", "Nama Staf", "Gaji Pokok (Rp)", "Bonus (Rp)", "Potongan Hutang (Rp)", "Sisa Bulan Lalu (Rp)", "THP Bersih (Rp)", "Status", "Tanggal Bayar"
      ], payload.payrolls.map(function(g) {
        return [
          g.id || "-", g.period || "-", g.staffName || g.employeeName || "-",
          Number(g.basicSalary || 0), Number(g.bonus || 0), Number(g.deductions || 0),
          Number(g.carriedOver || 0), Number(g.netSalary || g.thp || 0), g.status || "Lunas", g.paidAt || "-"
        ];
      }), "#4338ca");
    }

    // 8. Tab Saldo Tools
    if (payload.saldoHistory && Array.isArray(payload.saldoHistory)) {
      writeTab(ss, "8_Rekap_Saldo_Tools", [
        "ID Riwayat", "Waktu", "Aplikasi (DANA dll)", "Pengisian (Rp)", "Sisa Saldo (Rp)", "Uang Kasir (Rp)", "Uang Tas (Rp)", "Admin"
      ], payload.saldoHistory.map(function(s) {
        return [
          s.id || "-", s.datetime || s.date || "-", s.provider || s.appName || "-",
          Number(s.amount || 0), Number(s.remainingBalance || 0), Number(s.cashierCash || 0),
          Number(s.bagCash || 0), s.recordedBy || "-"
        ];
      }), "#059669");
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success", message: "8 Tab Database Sukses Disimpan ke Google Sheets!", timestamp: syncTime
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function writeTab(ss, name, headers, rows, color) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (color) sheet.setTabColor(color);
  sheet.clear();
  if (rows.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setBackground("#1e293b").setFontColor("#fff").setFontWeight("bold");
    sheet.getRange(2, 1).setValue("(Belum ada data)");
    return 0;
  }
  var grid = [headers].concat(rows);
  sheet.getRange(1, 1, grid.length, headers.length).setValues(grid);
  sheet.getRange(1, 1, 1, headers.length).setBackground("#1e293b").setFontColor("#fff").setFontWeight("bold");
  sheet.setFrozenRows(1);
  for (var i = 1; i <= headers.length; i++) sheet.autoResizeColumn(i);
  return rows.length;
}

function formatItems(items) {
  if (!items || !Array.isArray(items) || items.length === 0) return "-";
  return items.map(function(i) {
    return (i.name || "Barang") + " (" + (i.qty || 1) + "x @" + Number(i.price || 0).toLocaleString("id-ID") + ")";
  }).join(";\\n");
}`;

  // Cache data seluruh koleksi lokal
  var collectionsCache = {
    transactions: [],
    products: [],
    debts: [],
    shifts: [],
    purchases: [],
    customers: [],
    payrolls: [],
    saldoHistory: []
  };

  var activeTabKey = 'transaksi';

  function formatRupiah(val) {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }

  function notifyToast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type || 'success');
      return;
    }
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'success');
    toast.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'check-circle'}"></i><span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3500);
  }

  function updateSyncProgress(pct, labelText) {
    var wrapper = document.getElementById('syncProgressWrapper');
    var fill = document.getElementById('syncProgressFill');
    var pctEl = document.getElementById('syncProgressPct');
    var lblEl = document.getElementById('syncProgressLabel');
    if (!wrapper || !fill || !pctEl || !lblEl) return;

    wrapper.style.display = 'block';
    fill.style.width = pct + '%';
    pctEl.textContent = pct + '%';
    if (labelText) lblEl.innerHTML = labelText;

    if (pct >= 100) {
      setTimeout(function () { wrapper.style.display = 'none'; }, 2500);
    }
  }

  // 1. Inisialisasi form & simpan URL
  function initForm() {
    var savedScriptUrl = localStorage.getItem('webpos_gas_webhook_url') || '';
    var savedSheetUrl = localStorage.getItem('webpos_spreadsheet_url') || '';

    var scriptInput = document.getElementById('scriptUrlInput');
    var sheetInput = document.getElementById('sheetUrlInput');
    var btnOpen = document.getElementById('btnOpenSheetTab');

    if (scriptInput && savedScriptUrl) scriptInput.value = savedScriptUrl;
    if (sheetInput && savedSheetUrl) {
      sheetInput.value = savedSheetUrl;
      if (btnOpen) btnOpen.style.display = 'inline-flex';
    }

    var box = document.getElementById('gasCodeDisplay');
    if (box) box.textContent = GAS_SOURCE_CODE;
  }

  window.saveSheetSettings = function () {
    var scriptUrl = (document.getElementById('scriptUrlInput')?.value || '').trim();
    var sheetUrl = (document.getElementById('sheetUrlInput')?.value || '').trim();
    var btnOpen = document.getElementById('btnOpenSheetTab');

    if (scriptUrl) localStorage.setItem('webpos_gas_webhook_url', scriptUrl);
    if (sheetUrl) {
      localStorage.setItem('webpos_spreadsheet_url', sheetUrl);
      if (btnOpen) btnOpen.style.display = 'inline-flex';
    }
    notifyToast('Pengaturan URL Google Sheets berhasil disimpan!', 'success');
  };

  window.openGoogleSheetDirect = function () {
    var sheetUrl = (document.getElementById('sheetUrlInput')?.value ||
      localStorage.getItem('webpos_spreadsheet_url') || '').trim();
    if (!sheetUrl) {
      notifyToast('Masukkan tautan Google Spreadsheet terlebih dahulu', 'warning');
      return;
    }
    window.open(sheetUrl, '_blank');
  };

  window.toggleVisibility = function (inputId, eyeId) {
    var input = document.getElementById(inputId);
    var eye = document.getElementById(eyeId);
    if (!input || !eye) return;
    if (input.type === 'password') {
      input.type = 'text';
      eye.className = 'fas fa-eye-slash';
    } else {
      input.type = 'password';
      eye.className = 'fas fa-eye';
    }
  };

  // 2. Modal Panduan Apps Script
  window.openSetupGuideModal = function () {
    var m = document.getElementById('setupGuideModal');
    if (m) m.classList.add('active');
    var box = document.getElementById('gasCodeDisplay');
    if (box) box.textContent = GAS_SOURCE_CODE;
  };

  window.closeSetupGuideModal = function () {
    var m = document.getElementById('setupGuideModal');
    if (m) m.classList.remove('active');
  };

  window.copyGasCodeToClipboard = function () {
    navigator.clipboard.writeText(GAS_SOURCE_CODE).then(function () {
      notifyToast('Kode Google Apps Script berhasil disalin ke clipboard!', 'success');
    }).catch(function () {
      notifyToast('Silakan blok dan salin kode script secara manual', 'warning');
    });
  };

  // 3. Query 8 Koleksi Database dari Firestore
  async function fetchAllDatabaseCollections() {
    updateSyncProgress(15, '<i class="fas fa-spinner fa-spin"></i> Membaca Transaksi &amp; Produk dari Firestore...');

    var getDocs = async function (colName) {
      try {
        if (typeof window.db === 'undefined') return [];
        var snap = await window.db.collection(colName).get();
        var list = [];
        snap.forEach(function (d) { list.push(Object.assign({ id: d.id }, d.data())); });
        return list;
      } catch (err) {
        console.warn('Gagal membaca koleksi ' + colName + ':', err);
        return [];
      }
    };

    var transactions = await getDocs('transactions');
    var products = await getDocs('products');

    updateSyncProgress(40, '<i class="fas fa-spinner fa-spin"></i> Membaca Hutang, Kas &amp; Shift...');
    var debts = await getDocs('debts');
    var shifts = await getDocs('shifts');
    var closing = await getDocs('closing');
    var combinedShifts = shifts.length > 0 ? shifts : closing;

    updateSyncProgress(65, '<i class="fas fa-spinner fa-spin"></i> Membaca Pembelian &amp; Pelanggan...');
    var purchases = await getDocs('purchases');
    var customers = await getDocs('customers');
    if (customers.length === 0) customers = await getDocs('customer_directory_v2');

    updateSyncProgress(85, '<i class="fas fa-spinner fa-spin"></i> Membaca Penggajian &amp; Saldo Tools...');
    var payrolls = await getDocs('payrolls');
    var topup = await getDocs('saldo_topup_history');
    var sisa = await getDocs('saldo_sisa_history');
    var saldoHistory = topup.concat(sisa);

    collectionsCache = {
      transactions: transactions,
      products: products,
      debts: debts,
      shifts: combinedShifts,
      purchases: purchases,
      customers: customers,
      payrolls: payrolls,
      saldoHistory: saldoHistory
    };

    var setC = function (id, count) {
      var el = document.getElementById(id);
      if (el) el.textContent = (count || 0).toLocaleString('id-ID');
    };
    setC('countVTransactions', transactions.length);
    setC('countVProducts', products.length);
    setC('countVDebts', debts.length);
    setC('countVKas', combinedShifts.length);
    setC('countVPurchases', purchases.length);
    setC('countVCustomers', customers.length);
    setC('countVPayrolls', payrolls.length);
    setC('countVSaldo', saldoHistory.length);

    return collectionsCache;
  }

  // 4. Sinkronisasi Semua Data ke Google Sheets
  window.syncAllToGoogleSheets = async function () {
    var scriptUrl = (document.getElementById('scriptUrlInput')?.value || '').trim();
    if (!scriptUrl) {
      notifyToast('Masukkan Google Apps Script Web App URL terlebih dahulu!', 'warning');
      document.getElementById('scriptUrlInput')?.focus();
      return;
    }

    var btn = document.getElementById('btnSyncToSheets');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sedang Mengirim...';
    }

    try {
      var payload = await fetchAllDatabaseCollections();
      updateSyncProgress(90, '<i class="fas fa-paper-plane fa-spin"></i> Mengirim paket 8 tab ke Google Sheets...');

      await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      updateSyncProgress(100, '<i class="fas fa-check-circle" style="color:var(--success)"></i> Sinkronisasi 8 Tab Berhasil!');

      var nowTs = Date.now();
      localStorage.setItem('last_backup', nowTs.toString());

      try {
        if (typeof window.db !== 'undefined') {
          await window.db.collection('backup').doc('lastLog').set({
            timestamp: nowTs,
            type: 'auto',
            status: 'success',
            note: 'Sinkronisasi 8 Tab Google Sheets Berhasil',
            summary: {
              transaksi: payload.transactions.length,
              produk: payload.products.length,
              hutang: payload.debts.length,
              kas: payload.shifts.length,
              pembelian: payload.purchases.length,
              pelanggan: payload.customers.length,
              penggajian: payload.payrolls.length,
              saldo: payload.saldoHistory.length
            }
          });
        }
      } catch (e) {}

      notifyToast('Semua database (8 Tab) sukses disinkronkan ke Google Sheets!', 'success');
      if (typeof window.loadStats === 'function') window.loadStats();
      window.filterViewerTable();

    } catch (err) {
      console.error(err);
      notifyToast('Gagal sinkronisasi: ' + err.message, 'error');
      updateSyncProgress(0, '<i class="fas fa-exclamation-circle" style="color:var(--danger)"></i> Gagal mengirim data');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Kirim Semua Data ke Google Sheets';
      }
    }
  };

  // 5. Download Excel Multi-Tab (.xlsx)
  window.exportFullWorkbookXLSX = function () {
    if (typeof window.XLSX === 'undefined') {
      notifyToast('Library XLSX belum termuat', 'error');
      return;
    }
    notifyToast('Menyiapkan file Excel Multi-Tab...', 'info');

    var wb = window.XLSX.utils.book_new();
    var c = collectionsCache;

    // Sheet 1: Transaksi
    var tRows = c.transactions.map(function (t) {
      return {
        'ID Nota': t.id || t.invoiceNo || '-',
        'Tanggal': t.date || '-',
        'Kasir': t.cashier || t.userName || '-',
        'Pelanggan': t.customerName || '-',
        'Kategori': t.category || 'Penjualan',
        'Metode': t.paymentMethod || 'Tunai',
        'Total': t.total || 0,
        'Laba': t.profit || 0,
        'Status': t.status || 'completed'
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(tRows), '1_Transaksi');

    // Sheet 2: Produk
    var pRows = c.products.map(function (p) {
      return {
        'ID': p.id || '-',
        'Barcode': p.barcode || p.sku || '-',
        'Nama': p.name || '-',
        'Kategori': p.category || '-',
        'Harga Beli': p.buyPrice || 0,
        'Harga Jual': p.sellingPrice || 0,
        'Stok': p.stock || 0
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(pRows), '2_Produk');

    // Sheet 3: Hutang
    var dRows = c.debts.map(function (d) {
      return {
        'ID': d.id || '-',
        'Nama': d.contactName || d.customerName || '-',
        'Jenis': d.type === 'payable' ? 'Hutang Toko' : 'Piutang Pelanggan',
        'Nominal Awal': d.initialAmount || d.amount || 0,
        'Sisa Tagihan': d.remainingAmount !== undefined ? d.remainingAmount : (d.balance || 0),
        'Status': d.status === 'paid' ? 'Lunas' : 'Belum Lunas'
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(dRows), '3_Hutang_Piutang');

    // Sheet 4: Kas & Shift
    var sRows = c.shifts.map(function (s) {
      return {
        'ID': s.id || '-',
        'Tanggal': s.date || '-',
        'Kasir': s.cashier || '-',
        'Modal Awal': s.startingCash || 0,
        'Kas Akhir': s.systemCash || 0,
        'Selisih': s.difference || 0
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(sRows), '4_Kas_Shift');

    // Sheet 5: Pembelian
    var bRows = c.purchases.map(function (b) {
      return {
        'ID': b.id || b.invoiceNo || '-',
        'Tanggal': b.date || '-',
        'Supplier': b.supplierName || b.supplier || '-',
        'Total Biaya': b.totalCost || b.total || 0,
        'Metode': b.paymentMethod || 'Tunai'
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(bRows), '5_Pembelian');

    // Sheet 6: Pelanggan
    var cuRows = c.customers.map(function (cu) {
      return {
        'ID': cu.id || '-',
        'Nama': cu.name || '-',
        'WhatsApp/HP': cu.phone || cu.whatsapp || '-',
        'Total Belanja': cu.totalSpent || 0
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(cuRows), '6_Pelanggan');

    // Sheet 7: Penggajian
    var gRows = c.payrolls.map(function (g) {
      return {
        'ID': g.id || '-',
        'Periode': g.period || '-',
        'Nama Staf': g.staffName || g.employeeName || '-',
        'Gaji Pokok': g.basicSalary || 0,
        'THP Bersih': g.netSalary || g.thp || 0,
        'Status': g.status || 'Lunas'
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(gRows), '7_Penggajian');

    // Sheet 8: Saldo Tools
    var slRows = c.saldoHistory.map(function (sl) {
      return {
        'Waktu': sl.datetime || sl.date || '-',
        'Aplikasi': sl.provider || sl.appName || '-',
        'Pengisian': sl.amount || 0,
        'Sisa Saldo': sl.remainingBalance || 0
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(slRows), '8_Saldo_Tools');

    var fileName = 'WebPOS_Semua_Database_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    window.XLSX.writeFile(wb, fileName);
    notifyToast('File Excel 8 Tab berhasil didownload: ' + fileName, 'success');
  };

  // 6. Penampil Tabel Online (Live Database Viewer)
  window.switchViewerTab = function (tabKey) {
    activeTabKey = tabKey;
    document.querySelectorAll('.viewer-tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabKey);
    });
    window.filterViewerTable();
  };

  window.filterViewerTable = function () {
    var q = (document.getElementById('tableSearchInput')?.value || '').toLowerCase();
    var thead = document.getElementById('viewerTableHead');
    var tbody = document.getElementById('viewerTableBody');
    if (!thead || !tbody) return;

    var c = collectionsCache;
    var cols = [];
    var rows = [];

    if (activeTabKey === 'transaksi') {
      cols = ['ID Nota', 'Tanggal', 'Kasir', 'Pelanggan', 'Metode', 'Total', 'Status'];
      rows = (c.transactions || [])
        .filter(function (t) { return !q || JSON.stringify(t).toLowerCase().includes(q); })
        .map(function (t) {
          return [
            t.id || t.invoiceNo || '-',
            t.date || '-',
            t.cashier || t.userName || '-',
            t.customerName || '-',
            t.paymentMethod || 'Tunai',
            formatRupiah(t.total),
            `<span class="badge ${t.status === 'failed' ? 'badge-danger' : 'badge-success'}">${t.status || 'completed'}</span>`
          ];
        });
    } else if (activeTabKey === 'produk') {
      cols = ['Barcode', 'Nama Produk', 'Kategori', 'Harga Modal', 'Harga Jual', 'Stok'];
      rows = (c.products || [])
        .filter(function (p) { return !q || JSON.stringify(p).toLowerCase().includes(q); })
        .map(function (p) {
          return [
            p.barcode || p.sku || '-',
            p.name || '-',
            p.category || '-',
            formatRupiah(p.buyPrice),
            formatRupiah(p.sellingPrice),
            `<span class="badge ${Number(p.stock || 0) <= 5 ? 'badge-danger' : 'badge-success'}">${p.stock || 0}</span>`
          ];
        });
    } else if (activeTabKey === 'hutang') {
      cols = ['Nama', 'Jenis', 'Jatuh Tempo', 'Nominal Awal', 'Sisa Tagihan', 'Status'];
      rows = (c.debts || [])
        .filter(function (d) { return !q || JSON.stringify(d).toLowerCase().includes(q); })
        .map(function (d) {
          return [
            d.contactName || d.customerName || '-',
            d.type === 'payable' ? 'Hutang Toko' : 'Piutang',
            d.dueDate || '-',
            formatRupiah(d.initialAmount || d.amount),
            formatRupiah(d.remainingAmount !== undefined ? d.remainingAmount : d.balance),
            `<span class="badge ${d.status === 'paid' ? 'badge-success' : 'badge-warning'}">${d.status === 'paid' ? 'Lunas' : 'Aktif'}</span>`
          ];
        });
    } else if (activeTabKey === 'kas') {
      cols = ['Tanggal', 'Kasir', 'Modal Awal', 'Kas Akhir', 'Selisih Kas'];
      rows = (c.shifts || [])
        .filter(function (s) { return !q || JSON.stringify(s).toLowerCase().includes(q); })
        .map(function (s) {
          return [
            s.date || '-',
            s.cashier || '-',
            formatRupiah(s.startingCash),
            formatRupiah(s.systemCash),
            formatRupiah(s.difference)
          ];
        });
    } else if (activeTabKey === 'pembelian') {
      cols = ['Faktur', 'Tanggal', 'Supplier', 'Total Biaya', 'Status Bayar'];
      rows = (c.purchases || [])
        .filter(function (b) { return !q || JSON.stringify(b).toLowerCase().includes(q); })
        .map(function (b) {
          return [
            b.id || b.invoiceNo || '-',
            b.date || '-',
            b.supplierName || b.supplier || '-',
            formatRupiah(b.totalCost || b.total),
            `<span class="badge badge-success">${b.paymentStatus || 'Lunas'}</span>`
          ];
        });
    } else if (activeTabKey === 'pelanggan') {
      cols = ['Nama Pelanggan', 'WhatsApp/HP', 'Total Belanja', 'Kunjungan'];
      rows = (c.customers || [])
        .filter(function (cu) { return !q || JSON.stringify(cu).toLowerCase().includes(q); })
        .map(function (cu) {
          return [
            cu.name || '-',
            cu.phone || cu.whatsapp || '-',
            formatRupiah(cu.totalSpent),
            cu.visitCount || 0
          ];
        });
    } else if (activeTabKey === 'gaji') {
      cols = ['Periode', 'Nama Staf', 'Gaji Pokok', 'THP Bersih', 'Status'];
      rows = (c.payrolls || [])
        .filter(function (g) { return !q || JSON.stringify(g).toLowerCase().includes(g); })
        .map(function (g) {
          return [
            g.period || '-',
            g.staffName || g.employeeName || '-',
            formatRupiah(g.basicSalary),
            formatRupiah(g.netSalary || g.thp),
            `<span class="badge badge-success">${g.status || 'Lunas'}</span>`
          ];
        });
    } else if (activeTabKey === 'saldo') {
      cols = ['Waktu', 'Aplikasi', 'Pengisian', 'Sisa Saldo'];
      rows = (c.saldoHistory || [])
        .filter(function (sl) { return !q || JSON.stringify(sl).toLowerCase().includes(q); })
        .map(function (sl) {
          return [
            sl.datetime || sl.date || '-',
            sl.provider || sl.appName || '-',
            formatRupiah(sl.amount),
            formatRupiah(sl.remainingBalance)
          ];
        });
    }

    thead.innerHTML = '<tr>' + cols.map(function (col) { return `<th>${col}</th>`; }).join('') + '</tr>';
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center;padding:2rem;color:var(--text-muted)">Tidak ada data yang ditemukan</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(function (r) {
      return '<tr>' + r.map(function (td) { return `<td>${td}</td>`; }).join('') + '</tr>';
    }).join('');
  };

  window.exportCurrentViewerTabCSV = function () {
    var tabKey = activeTabKey;
    var dataList = collectionsCache[tabKey === 'transaksi' ? 'transactions' : (tabKey === 'produk' ? 'products' : tabKey)] || [];
    if (dataList.length === 0) {
      notifyToast('Data pada tab ini kosong', 'warning');
      return;
    }
    var keys = Object.keys(dataList[0]);
    var rows = [keys];
    dataList.forEach(function (item) { rows.push(keys.map(function (k) { return item[k]; })); });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c || '').replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'WebPOS_' + tabKey + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    notifyToast('Download CSV ' + tabKey + ' berhasil!', 'success');
  };

  // Jalankan saat halaman siap
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initForm();
      fetchAllDatabaseCollections().then(function () { window.filterViewerTable(); });
    });
  } else {
    initForm();
    fetchAllDatabaseCollections().then(function () { window.filterViewerTable(); });
  }

})();
