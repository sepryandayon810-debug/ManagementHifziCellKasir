/**
 * =========================================================================
 * WEBPOS - GOOGLE SHEETS SYNC & LIVE VIEWER HELPER (js/sheets-sync.js)
 * =========================================================================
 */
(function () {
  'use strict';

  function createSafeShim() {
    try {
      var target = document.body || document.documentElement;
      if (target) {
        if (!document.getElementById('sheetIdInput')) {
          var d1 = document.createElement('input');
          d1.id = 'sheetIdInput';
          d1.type = 'hidden';
          d1.style.display = 'none';
          target.appendChild(d1);
        }
        if (!document.getElementById('dbUrlInput')) {
          var d2 = document.createElement('input');
          d2.id = 'dbUrlInput';
          d2.type = 'hidden';
          d2.style.display = 'none';
          target.appendChild(d2);
        }
      }
    } catch (e) {}
  }
  createSafeShim();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createSafeShim);
  }

  var collectionsCache = {
    transactions: [], products: [], debts: [], shifts: [],
    purchases: [], customers: [], payrolls: [], saldoHistory: []
  };
  var activeTabKey = 'transaksi';

  function formatRupiah(val) {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }

  // Hitung Nominal Transaksi (Termasuk fallback hitung dari items jika 0)
  function getTransactionNominal(t) {
    if (!t) return 0;
    var tot = Number(t.nominal != null ? t.nominal : (t.total != null ? t.total : (t.amount != null ? t.amount : (t.grandTotal != null ? t.grandTotal : (t.cash_in != null ? t.cash_in : (t.harga_jual != null ? t.harga_jual : (t.nilai != null ? t.nilai : 0)))))));
    if ((!tot || tot === 0) && t.items && Array.isArray(t.items) && t.items.length > 0) {
      tot = t.items.reduce(function (sum, it) {
        if (!it) return sum;
        var p = Number(it.price || it.harga || it.sellingPrice || 0);
        var q = Number(it.qty || it.quantity || it.jumlah || 1);
        var sub = Number(it.total || it.subtotal || (p * q));
        return sum + (sub > 0 ? sub : (p * q));
      }, 0);
    }
    return tot || 0;
  }

  // Hitung Laba Transaksi
  function getTransactionProfit(t) {
    if (!t) return 0;
    var prof = Number(t.laba != null ? t.laba : (t.profit != null ? t.profit : (t.admin != null ? t.admin : (t.fee != null ? t.fee : 0))));
    if ((!prof || prof === 0) && t.items && Array.isArray(t.items) && t.items.length > 0) {
      prof = t.items.reduce(function (sum, it) {
        if (!it) return sum;
        var p = Number(it.price || it.harga || it.sellingPrice || 0);
        var m = Number(it.buyPrice || it.modal || it.costPrice || it.hargaBeli || 0);
        var q = Number(it.qty || it.quantity || it.jumlah || 1);
        return sum + (m > 0 && p > m ? ((p - m) * q) : 0);
      }, 0);
    }
    return prof || 0;
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
    var sheetUrl = (document.getElementById('sheetUrlInput')?.value || localStorage.getItem('webpos_spreadsheet_url') || '').trim();
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

  window.openSetupGuideModal = function () {
    var m = document.getElementById('setupGuideModal');
    if (m) m.classList.add('active');
  };

  window.closeSetupGuideModal = function () {
    var m = document.getElementById('setupGuideModal');
    if (m) m.classList.remove('active');
  };

  // Query dan Normalisasi 8 Koleksi
  async function fetchAllDatabaseCollections() {
    updateSyncProgress(15, '<i class="fas fa-spinner fa-spin"></i> Membaca Transaksi &amp; Produk dari Firestore...');

    function sanitizeDoc(d) {
      var raw = d.data() || {};
      var clean = { id: d.id };
      for (var k in raw) {
        if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
        var val = raw[k];
        if (val && typeof val === 'object') {
          if (val.seconds !== undefined) {
            var dateObj = new Date(val.seconds * 1000);
            clean[k] = dateObj.toLocaleDateString('id-ID', {day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + dateObj.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
          } else if (val._seconds !== undefined) {
            var dateObj = new Date(val._seconds * 1000);
            clean[k] = dateObj.toLocaleDateString('id-ID', {day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + dateObj.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
          } else if (val instanceof Date) {
            clean[k] = val.toLocaleDateString('id-ID', {day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + val.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
          } else {
            clean[k] = val;
          }
        } else {
          clean[k] = val;
        }
      }
      return clean;
    }

    var getDocs = async function (colName) {
      try {
        if (typeof window.db === 'undefined') return [];
        var snap = await window.db.collection(colName).get();
        var list = [];
        snap.forEach(function (d) { list.push(sanitizeDoc(d)); });
        return list;
      } catch (err) {
        console.warn('Gagal membaca koleksi ' + colName + ':', err);
        return [];
      }
    };

    var rawTransactions = await getDocs('transactions');
    var rawProducts = await getDocs('products');

    // NORMALISASI TRANSAKSI AGAR TOTAL & TANGGAL TERISI SEMPURNA
    var transactions = rawTransactions.map(function (t) {
      var rawDate = t.waktu || t.timestamp || t.created_at || t.createdAt || t.date || t.date_key;
      var dateStr = "-";
      if (rawDate) {
        if (typeof rawDate === "number") {
          var ms = rawDate < 1e11 ? rawDate * 1000 : rawDate;
          var d = new Date(ms);
          if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleDateString('id-ID', {day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + d.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
          }
        } else if (typeof rawDate === "string") {
          if (/^\d{10,13}$/.test(rawDate)) {
            var num = Number(rawDate);
            var ms = num < 1e11 ? num * 1000 : num;
            var d = new Date(ms);
            if (!isNaN(d.getTime())) {
              dateStr = d.toLocaleDateString('id-ID', {day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + d.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
            } else {
              dateStr = rawDate;
            }
          } else {
            dateStr = rawDate;
          }
        } else {
          dateStr = String(rawDate);
        }
      }

      var tot = getTransactionNominal(t);
      var prof = getTransactionProfit(t);

      return Object.assign({}, t, {
        date: dateStr,
        date_key: dateStr,
        total: tot,
        nominal: tot,
        profit: prof,
        laba: prof,
        cashier: t.userName || t.kasir || t.cashier || t.userId || "-",
        customerName: t.customerName || t.pelanggan || t.customer || t.nama || "-",
        paymentMethod: (t.metode_pembayaran || t.paymentMethod || t.metode || "Tunai").toUpperCase()
      });
    });

    var products = rawProducts.map(function(p) {
      var beli = Number(p.buyPrice != null ? p.buyPrice : (p.harga_beli != null ? p.harga_beli : (p.costPrice != null ? p.costPrice : (p.modal != null ? p.modal : 0))));
      var jual = Number(p.sellingPrice != null ? p.sellingPrice : (p.harga_jual != null ? p.harga_jual : (p.price != null ? p.price : (p.harga != null ? p.harga : 0))));
      var stok = Number(p.stock != null ? p.stock : (p.stok != null ? p.stok : (p.qty != null ? p.qty : 0)));
      return Object.assign({}, p, {
        name: p.name || p.nama || p.productName || p.namaProduk || "-",
        barcode: p.barcode || p.sku || p.kode || "-",
        buyPrice: beli,
        sellingPrice: jual,
        stock: stok
      });
    });

    updateSyncProgress(40, '<i class="fas fa-spinner fa-spin"></i> Membaca Hutang, Kas &amp; Shift...');
    var debts = await getDocs('debts');
    var kas = await getDocs('kas');
    var shifts = await getDocs('shifts');
    var closing = await getDocs('closing');
    var combinedShifts = kas.concat(shifts, closing);

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

  // Kirim Semua Data ke Google Sheets
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

  // Download Excel (.xlsx) 8 Tab
  window.exportFullWorkbookXLSX = function () {
    if (typeof window.XLSX === 'undefined') {
      notifyToast('Library XLSX belum termuat', 'error');
      return;
    }
    notifyToast('Menyiapkan file Excel Multi-Tab...', 'info');

    var wb = window.XLSX.utils.book_new();
    var c = collectionsCache;

    var tRows = c.transactions.map(function (t) {
      var rincian = (t.items && t.items.length) ? t.items.map(function(i){ return (i.name||i.productName||'Item') + ' x' + (i.qty||i.quantity||1); }).join(', ') : (t.catatan || t.note || t.keterangan || '-');
      return {
        'ID Nota': t.id || t.invoiceNo || '-',
        'Tanggal': t.date || '-',
        'Kasir': t.cashier || t.userName || '-',
        'Pelanggan': t.customerName || '-',
        'Kategori': t.kategori || 'Penjualan',
        'Metode': t.paymentMethod || 'TUNAI',
        'Rincian': rincian,
        'Total (Rp)': t.total || 0,
        'Laba (Rp)': t.profit || 0,
        'Status': t.status || 'completed'
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(tRows), '1_Transaksi');

    var pRows = c.products.map(function (p) {
      return {
        'ID': p.id || '-', 'Barcode': p.barcode || '-', 'Nama': p.name || '-', 'Kategori': p.category || '-',
        'Harga Beli': p.buyPrice || 0, 'Harga Jual': p.sellingPrice || 0, 'Stok': p.stock || 0
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(pRows), '2_Produk');

    var dRows = c.debts.map(function (d) {
      return {
        'ID': d.id || '-', 'Nama': d.contactName || d.customerName || '-', 'Jenis': d.type === 'payable' ? 'Hutang Toko' : 'Piutang',
        'Nominal Awal': d.initialAmount || d.amount || 0, 'Sisa': d.remainingAmount !== undefined ? d.remainingAmount : (d.balance || 0),
        'Status': d.status === 'paid' ? 'Lunas' : 'Belum Lunas'
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(dRows), '3_Hutang_Piutang');

    var sRows = c.shifts.map(function (s) {
      return {
        'ID': s.id || '-', 'Tanggal': s.date || '-', 'Kasir': s.cashier || '-',
        'Modal Awal': s.startingCash || 0, 'Kas Akhir': s.systemCash || 0, 'Selisih': s.difference || 0
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(sRows), '4_Kas_Shift');

    var bRows = c.purchases.map(function (b) {
      return {
        'ID': b.id || b.invoiceNo || '-', 'Tanggal': b.date || '-', 'Supplier': b.supplierName || b.supplier || '-',
        'Total Biaya': b.totalCost || b.total || 0, 'Metode': b.paymentMethod || 'Tunai'
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(bRows), '5_Pembelian');

    var cuRows = c.customers.map(function (cu) {
      return {
        'ID': cu.id || '-', 'Nama': cu.name || '-', 'WhatsApp': cu.phone || cu.whatsapp || '-', 'Total Belanja': cu.totalSpent || 0
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(cuRows), '6_Pelanggan');

    var gRows = c.payrolls.map(function (g) {
      return {
        'ID': g.id || '-', 'Periode': g.period || '-', 'Nama Staf': g.staffName || g.employeeName || '-',
        'Gaji Pokok': g.basicSalary || 0, 'THP Bersih': g.netSalary || g.thp || 0, 'Status': g.status || 'Lunas'
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(gRows), '7_Penggajian');

    var slRows = c.saldoHistory.map(function (sl) {
      return {
        'Waktu': sl.datetime || sl.date || '-', 'Aplikasi': sl.provider || sl.appName || '-',
        'Pengisian': sl.amount || 0, 'Sisa Saldo': sl.remainingBalance || 0
      };
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(slRows), '8_Saldo_Tools');

    var fileName = 'WebPOS_Semua_Database_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    window.XLSX.writeFile(wb, fileName);
    notifyToast('File Excel 8 Tab berhasil didownload!', 'success');
  };

  // Live Table Viewer
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
            t.paymentMethod || 'TUNAI',
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
            p.barcode || '-', p.name || '-', p.category || '-',
            formatRupiah(p.buyPrice), formatRupiah(p.sellingPrice),
            `<span class="badge ${Number(p.stock || 0) <= 5 ? 'badge-danger' : 'badge-success'}">${p.stock || 0}</span>`
          ];
        });
    }

    thead.innerHTML = '<tr>' + cols.map(function (col) { return `<th>${col}</th>`; }).join('') + '</tr>';
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center;padding:2rem;color:var(--text-muted)">Tidak ada data</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      return '<tr>' + r.map(function (td) { return `<td>${td}</td>`; }).join('') + '</tr>';
    }).join('');
  };

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
