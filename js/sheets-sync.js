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

  // Fungsi pembersih angka (aman dari string "Rp", titik ribuan, spasi, dsb)
  function cleanNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (typeof val === 'string') {
      var s = val.replace(/[^0-9.,-]/g, '').trim();
      if (!s) return 0;
      if (s.includes('.') && s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else if (s.includes('.') && !s.includes(',')) {
        var parts = s.split('.');
        if (parts.length > 1 && parts[parts.length - 1].length === 3) {
          s = s.replace(/\./g, '');
        }
      } else if (s.includes(',')) {
        s = s.replace(',', '.');
      }
      var num = parseFloat(s);
      return isNaN(num) ? 0 : num;
    }
    return 0;
  }

  // Hitung Nominal Transaksi
  function getTransactionNominal(t) {
    if (!t) return 0;
    var tot = cleanNumber(t.total != null ? t.total : (t.nominal != null ? t.nominal : (t.amount != null ? t.amount : (t.grandTotal != null ? t.grandTotal : (t.totalAmount != null ? t.totalAmount : (t.subtotal != null ? t.subtotal : (t.cash_in != null ? t.cash_in : (t.harga_jual != null ? t.harga_jual : 0))))))));
    if ((!tot || tot === 0) && t.items && Array.isArray(t.items) && t.items.length > 0) {
      tot = t.items.reduce(function (sum, it) {
        if (!it) return sum;
        var p = cleanNumber(it.price || it.harga || it.sellingPrice || it.hargaJual || 0);
        var q = cleanNumber(it.qty || it.quantity || it.jumlah || 1);
        var sub = cleanNumber(it.total || it.subtotal || (p * q));
        return sum + (sub > 0 ? sub : (p * q));
      }, 0);
    }
    return tot || 0;
  }

  // Hitung Laba Transaksi
  function getTransactionProfit(t) {
    if (!t) return 0;
    var prof = cleanNumber(
  t.laba != null ? t.laba : (
    t.profit != null ? t.profit : (
      t.margin != null ? t.margin : (
        t.admin != null ? t.admin : (
          t.adminFee != null ? t.adminFee : (
            t.biayaAdmin != null ? t.biayaAdmin : (
              t.fee != null ? t.fee : 0
            )
          )
        )
      )
    )
  )
);
    if ((!prof || prof === 0) && t.items && Array.isArray(t.items) && t.items.length > 0) {
      prof = t.items.reduce(function (sum, it) {
        if (!it) return sum;
        var p = cleanNumber(it.price || it.harga || it.sellingPrice || it.hargaJual || 0);
        var m = cleanNumber(it.cost != null ? it.cost : (it.buyPrice != null ? it.buyPrice : (it.costPrice != null ? it.costPrice : (it.modal != null ? it.modal : (it.hargaBeli != null ? it.hargaBeli : (it.harga_beli != null ? it.harga_beli : 0))))));
        var q = cleanNumber(it.qty || it.quantity || it.jumlah || 1);
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
    var iconClass = type === 'error' ? 'exclamation-circle' : 'check-circle';
toast.innerHTML = '<i class="fas fa-' + iconClass + '"></i><span>' + msg + '</span>';
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
  var scriptInput = document.getElementById('scriptUrlInput');
  var sheetInput = document.getElementById('sheetUrlInput');
  var scriptUrl = scriptInput && scriptInput.value ? scriptInput.value.trim() : '';
  var sheetUrl = sheetInput && sheetInput.value ? sheetInput.value.trim() : '';
  var btnOpen = document.getElementById('btnOpenSheetTab');
  if (scriptUrl) localStorage.setItem('webpos_gas_webhook_url', scriptUrl);
  if (sheetUrl) {
    localStorage.setItem('webpos_spreadsheet_url', sheetUrl);
    if (btnOpen) btnOpen.style.display = 'inline-flex';
  }
  notifyToast('Pengaturan URL Google Sheets berhasil disimpan!', 'success');
};
  
  window.openGoogleSheetDirect = function () {
    var sheetInput = document.getElementById('sheetUrlInput');
var sheetUrl = (sheetInput && sheetInput.value ? sheetInput.value : localStorage.getItem('webpos_spreadsheet_url') || '').trim();
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

  function parseDateToReadable(rawDate) {
  if (!rawDate) return "-";
  if (typeof rawDate === "number") {
    var ms = rawDate < 1e11 ? rawDate * 1000 : rawDate;
    var d = new Date(ms);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  } else if (typeof rawDate === "string") {
    if (/^\d{10,13}$/.test(rawDate)) {
      var num = Number(rawDate);
      var ms = num < 1e11 ? num * 1000 : num;
      var d = new Date(ms);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    }
    return rawDate;
  } else if (typeof rawDate === "object") {
    if (rawDate.seconds !== undefined) {
      var d = new Date(rawDate.seconds * 1000);
      return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (rawDate instanceof Date) {
      return rawDate.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + rawDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }
  return String(rawDate);
}

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

    // 2. Normalisasi Produk (Harga Beli, Jual, Stok selalu berupa Angka)
    var products = rawProducts.map(function(p) {
      var beli = cleanNumber(p.buyPrice != null ? p.buyPrice : (p.harga_beli != null ? p.harga_beli : (p.hargaBeli != null ? p.hargaBeli : (p.costPrice != null ? p.costPrice : (p.modal != null ? p.modal : 0)))));
      var jual = cleanNumber(p.sellingPrice != null ? p.sellingPrice : (p.harga_jual != null ? p.harga_jual : (p.hargaJual != null ? p.hargaJual : (p.price != null ? p.price : (p.harga != null ? p.harga : 0)))));
      var stok = cleanNumber(p.stock != null ? p.stock : (p.stok != null ? p.stok : (p.qty != null ? p.qty : (p.stokAkhir != null ? p.stokAkhir : 0))));
      return Object.assign({}, p, {
        name: p.name || p.nama || p.productName || p.namaProduk || "-",
        nama: p.name || p.nama || p.productName || p.namaProduk || "-",
        barcode: p.barcode || p.sku || p.kode || "-",
        category: p.category || p.kategori || "-",
        kategori: p.category || p.kategori || "-",
        buyPrice: beli,
        hargaBeli: beli,
        harga_beli: beli,
        sellingPrice: jual,
        hargaJual: jual,
        harga_jual: jual,
        stock: stok,
        stok: stok
      });
    });

    updateSyncProgress(40, '<i class="fas fa-spinner fa-spin"></i> Membaca Hutang, Kas &amp; Shift...');
    // 3. Normalisasi Hutang/Piutang
    var rawDebts = await getDocs('debts');
    var debts = rawDebts.map(function(d) {
      var awal = cleanNumber(d.initialAmount != null ? d.initialAmount : (d.amount != null ? d.amount : (d.nominal != null ? d.nominal : (d.total != null ? d.total : 0))));
      var isPaid = d.status === 'paid' || d.status === 'lunas';
var sisa = isPaid ? 0 : cleanNumber(d.remaining != null ? d.remaining : (d.remainingAmount != null ? d.remainingAmount : (d.balance != null ? d.balance : (d.sisa != null ? d.sisa : awal))));
      return Object.assign({}, d, {
        contactName: d.contactName || d.customerName || d.nama || "-",
        initialAmount: awal,
        nominalAwal: awal,
        amount: awal,
        remainingAmount: sisa,
        sisa: sisa,
        balance: sisa
      });
    });

    // 4. Normalisasi Kas & Shift
    var kas = await getDocs('kas');
    var shifts = await getDocs('shifts');
    var closing = await getDocs('closing');
    var combinedShifts = kas.concat(shifts, closing).map(function(s) {
      var modal = cleanNumber(s.startingCash != null ? s.startingCash : (s.modalAwal != null ? s.modalAwal : (s.modal != null ? s.modal : 0)));
      var akhir = cleanNumber(s.systemCash != null ? s.systemCash : (s.kasAkhir != null ? s.kasAkhir : (s.actualCash != null ? s.actualCash : (s.totalKas != null ? s.totalKas : 0))));
      var selisih = cleanNumber(s.difference != null ? s.difference : (s.selisih != null ? s.selisih : 0));
      return Object.assign({}, s, {
        startingCash: modal,
        modalAwal: modal,
        systemCash: akhir,
        kasAkhir: akhir,
        difference: selisih,
        selisih: selisih
      });
    });

    updateSyncProgress(65, '<i class="fas fa-spinner fa-spin"></i> Membaca Pembelian &amp; Pelanggan...');
    // 5. Normalisasi Pembelian
    var rawPurchases = await getDocs('purchases');
    var purchases = rawPurchases.map(function(b) {
     var tot = cleanNumber(
  b.grandTotal != null ? b.grandTotal : (
    b.totalCost != null ? b.totalCost : (
      b.total != null ? b.total : (
        b.biaya != null ? b.biaya : (
          b.nominal != null ? b.nominal : 0
        )
      )
    )
  )
);
      return Object.assign({}, b, {
  totalCost: tot,
  grandTotal: tot,
  total: tot,
  biaya: tot
});
    });

    // 6. Tab Data Pelanggan (MENGGABUNGKAN SEMUA KOLEKSI & AUTO-CALCULATE BELANJA + PIUTANG)
var custDir = await getDocs('customer_directory_v2');
var custApp = await getDocs('customers');
var custPel = await getDocs('pelanggan');
var custData = await getDocs('data_pelanggan');

var allCustomersRaw = custDir.concat(custApp, custPel, custData);

// Kalkulasi akumulasi belanja dari transaksi penjualan
var customerSpentMap = {};
transactions.forEach(function (t) {
  var cName = (t.customerName || t.pelanggan || "").trim().toLowerCase();
  if (cName && cName !== "-" && cName !== "pelanggan umum" && cName !== "user") {
    customerSpentMap[cName] = (customerSpentMap[cName] || 0) + (t.total || 0);
  }
});

// Kalkulasi akumulasi piutang aktif dari data debts
var customerDebtMap = {};
debts.forEach(function (d) {
  if (d.status === 'active' || d.status === 'Belum Lunas') {
    var cName = (d.contactName || d.name || "").trim().toLowerCase();
    if (cName && cName !== "-") {
      customerDebtMap[cName] = (customerDebtMap[cName] || 0) + (d.remainingAmount || 0);
    }
  }
});

var customerMergedMap = {};

allCustomersRaw.forEach(function (cu) {
  var rawName = cu.name || cu.nama || cu.namaPelanggan || cu.nama_pelanggan || cu.customerName || "";
  var cleanName = rawName.trim();
  if (!cleanName || cleanName === "-") return;
  var nameKey = cleanName.toLowerCase();

  var hp = cu.phone || cu.no_hp || cu.noHp || cu.whatsapp || cu.wa || cu.telepon || cu.no_telp || cu.noTelp || cu.telp || cu.kontak || "";
  var pln = cu.id_pln || cu.idPln || cu.plnId || cu.pln || cu.no_meter || cu.noMeter || cu.nomorMeter || cu.nomor_meter || cu.customerNumber || cu.meteran || cu.idPelanggan || cu.noPelanggan || "";
  var alamat = cu.alamat || cu.address || "-";

  if (hp && !pln) {
    var lowerName = cleanName.toLowerCase();
    if (lowerName.includes('token') || lowerName.includes('pln') || lowerName.includes('meter')) {
      pln = hp;
      hp = "-";
    }
  }

  if (!customerMergedMap[nameKey]) {
    customerMergedMap[nameKey] = {
      id: cu.id || ('CUS_' + Date.now()),
      name: cleanName,
      nama: cleanName,
      phone: hp || "-",
      whatsapp: hp || "-",
      noHp: hp || "-",
      idPln: pln || "-",
      plnId: pln || "-",
      noMeter: pln || "-",
      alamat: alamat || "-",
      totalSpent: cleanNumber(cu.totalSpent || cu.totalBelanja || cu.belanja || 0),
      totalPiutang: cleanNumber(cu.totalPiutang || cu.piutang || cu.sisaHutang || 0),
      membership: cu.membership || cu.tipe || "Regular"
    };
  } else {
    var existing = customerMergedMap[nameKey];
    if ((!existing.phone || existing.phone === "-") && hp) existing.phone = hp;
    if ((!existing.idPln || existing.idPln === "-") && pln) existing.idPln = pln;
    if ((!existing.alamat || existing.alamat === "-") && alamat && alamat !== "-") existing.alamat = alamat;
  }
});

// Masukkan juga pelanggan dari transaksi jika belum terdaftar di kontak
for (var spentNameKey in customerSpentMap) {
  if (!customerMergedMap[spentNameKey]) {
    customerMergedMap[spentNameKey] = {
      id: 'CUS_' + Math.abs(spentNameKey.split('').reduce(function(a,b){ a=((a<<5)-a)+b.charCodeAt(0); return a&a; }, 0)),
      name: spentNameKey.toUpperCase(),
      nama: spentNameKey.toUpperCase(),
      phone: "-",
      idPln: "-",
      alamat: "-",
      totalSpent: 0,
      totalPiutang: 0,
      membership: "Regular"
    };
  }
}

var customers = Object.values(customerMergedMap).map(function (c) {
  var nKey = c.name.trim().toLowerCase();
  var autoSpent = customerSpentMap[nKey] || 0;
  var autoDebt = customerDebtMap[nKey] || 0;

  var finalSpent = Math.max(c.totalSpent || 0, autoSpent);
  var finalDebt = Math.max(c.totalPiutang || 0, autoDebt);

  return Object.assign({}, c, {
    totalSpent: finalSpent,
    totalBelanja: finalSpent,
    totalPiutang: finalDebt,
    piutang: finalDebt
  });
});
    
    updateSyncProgress(85, '<i class="fas fa-spinner fa-spin"></i> Membaca Penggajian &amp; Saldo Tools...');
    // 7. Normalisasi Penggajian
var rawPayrolls = await getDocs('payrolls');
var payrolls = rawPayrolls.map(function(g) {
  var gapok = cleanNumber(g.basicSalary != null ? g.basicSalary : (g.gajiPokok != null ? g.gajiPokok : (g.gapok != null ? g.gapok : 0)));
  var potongan = cleanNumber(g.totalDebtDeduction != null ? g.totalDebtDeduction : (g.deductions != null ? g.deductions : (g.potongan != null ? g.potongan : 0)));
  var bonus = cleanNumber(g.prevUnpaidSalary != null ? g.prevUnpaidSalary : (g.bonus != null ? g.bonus : 0));
  var thp = cleanNumber(g.netSalary != null ? g.netSalary : (g.thp != null ? g.thp : (g.thpBersih != null ? g.thpBersih : Math.max(0, gapok + bonus - potongan))));
  var staf = g.staffName || g.employeeName || g.nama || "-";
  var per = g.periodName || g.period || g.periode || "-";

  return Object.assign({}, g, {
  period: per,
  periode: per,
  staffName: staf,
  employeeName: staf,
  basicSalary: gapok,
  gajiPokok: gapok,
  deductions: potongan,
  potongan: potongan,
  totalDebtDeduction: potongan,
  bonus: bonus,
  prevUnpaidSalary: bonus,
  netSalary: thp,
  thp: thp,
  status: (g.status === 'unpaid' || g.status === 'Belum Lunas') ? 'Belum Lunas' : 'Lunas'
});
});

    // 8. Tab Rekap Saldo Tools (Memisahkan Pengisian vs Sisa Saldo)
var rawTopup = await getDocs('saldo_topup_history');
var rawSisa = await getDocs('saldo_sisa_history');
var rawSaldo = await getDocs('saldo');
var rawTele = await getDocs('saldo_telegram');

var saldoHistory = [];

// Dari koleksi topup: nominal adalah Pengisian
rawTopup.forEach(function (sl) {
  var isi = cleanNumber(sl.nominal != null ? sl.nominal : (sl.amount != null ? sl.amount : (sl.pengisian != null ? sl.pengisian : 0)));
  var prov = sl.toolName || sl.provider || sl.appName || sl.aplikasi || sl.nama || "Tools";
  var tgl = parseDateToReadable(sl.date || sl.datetime || sl.timestamp || sl.createdAt);
  saldoHistory.push({
    id: sl.id,
    datetime: tgl,
    date: tgl,
    provider: prov,
    appName: prov,
    aplikasi: prov,
    amount: isi,
    nominal: isi,
    pengisian: isi,
    remainingBalance: 0,
    sisaSaldo: 0,
    recordedBy: sl.recordedBy || sl.admin || sl.userName || "Admin"
  });
});

// Dari koleksi sisa saldo: nominal adalah Sisa Saldo
rawSisa.forEach(function (sl) {
  var sisa = cleanNumber(sl.nominal != null ? sl.nominal : (sl.remainingBalance != null ? sl.remainingBalance : (sl.sisaSaldo != null ? sl.sisaSaldo : (sl.saldo != null ? sl.saldo : 0))));
  var prov = sl.toolName || sl.provider || sl.appName || sl.aplikasi || sl.nama || "Tools";
  var tgl = parseDateToReadable(sl.date || sl.datetime || sl.timestamp || sl.createdAt);
  saldoHistory.push({
    id: sl.id,
    datetime: tgl,
    date: tgl,
    provider: prov,
    appName: prov,
    aplikasi: prov,
    amount: 0,
    nominal: 0,
    pengisian: 0,
    remainingBalance: sisa,
    sisaSaldo: sisa,
    recordedBy: sl.recordedBy || sl.admin || sl.userName || "Admin"
  });
});

// Dari saldo umum / telegram
rawSaldo.concat(rawTele).forEach(function (sl) {
  var isi = cleanNumber(sl.pengisian != null ? sl.pengisian : (sl.topup != null ? sl.topup : (sl.amount != null ? sl.amount : 0)));
  var sisa = cleanNumber(sl.sisaSaldo != null ? sl.sisaSaldo : (sl.remainingBalance != null ? sl.remainingBalance : (sl.saldo != null ? sl.saldo : (sl.nominal != null ? sl.nominal : 0))));
  var prov = sl.provider || sl.appName || sl.aplikasi || sl.nama || "Tools";
  var tgl = parseDateToReadable(sl.datetime || sl.date || sl.waktu || sl.timestamp || sl.createdAt);
  saldoHistory.push({
    id: sl.id,
    datetime: tgl,
    date: tgl,
    provider: prov,
    appName: prov,
    aplikasi: prov,
    amount: isi,
    nominal: isi,
    pengisian: isi,
    remainingBalance: sisa,
    sisaSaldo: sisa,
    recordedBy: sl.recordedBy || sl.admin || sl.userName || "Admin"
  });
});
    
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
  var scriptInput = document.getElementById('scriptUrlInput');
  var scriptUrl = scriptInput && scriptInput.value ? scriptInput.value.trim() : '';
  if (!scriptUrl) {
    notifyToast('Masukkan Google Apps Script Web App URL terlebih dahulu!', 'warning');
    if (scriptInput) scriptInput.focus();
    return;
  }
    
    var btn = document.getElementById('btnSyncToSheets');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sedang Mengirim...';
    }

    try {
      var payload = await fetchAllDatabaseCollections();
      // Simpan di cache sesi browser agar Live View langsung lancar tanpa read Firestore lagi
      try {
        sessionStorage.setItem('webpos_backup_cache', JSON.stringify(payload));
      } catch(e) {}
      
      updateSyncProgress(90, '<i class="fas fa-paper-plane fa-spin"></i> Mengirim paket 8 tab ke Google Sheets...');

      await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      updateSyncProgress(100, '<i class="fas fa-check-circle" style="color:var(--success)"></i> Sinkronisasi 8 Tab Berhasil!');

      var nowTs = Date.now();
      localStorage.setItem('last_backup', nowTs.toString());

      // WAJIB: Simpan ke Firestore agar kartu "Backup Terakhir" dan riwayat berubah ke waktu sekarang!
      if (typeof window.db !== 'undefined') {
        var syncLogData = {
          timestamp: nowTs,
          type: 'auto',
          status: 'success',
          productCount: (collectionsCache.products || []).length,
          transactionCount: (collectionsCache.transactions || []).length,
          note: 'Sinkronisasi 8 Tab Google Sheets Berhasil'
        };
        await window.db.collection('backup').doc('lastLog').set(syncLogData, { merge: true }).catch(function(e){ console.warn(e); });
        await window.db.collection('backup_logs').add(syncLogData).catch(function(e){ console.warn(e); });
      }

      notifyToast('Semua database (8 Tab) sukses disinkronkan ke Google Sheets!', 'success');
      if (typeof window.loadStats === 'function') await window.loadStats();
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
        'Nominal Awal': d.initialAmount || d.amount || 0, 'Sisa Tagihan': d.remainingAmount !== undefined ? d.remainingAmount : (d.remaining !== undefined ? d.remaining : (d.balance || 0)),
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
        'Total Biaya': b.totalCost || b.grandTotal || b.total || 0, 'Metode': b.paymentMethod || 'Tunai'
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
  var searchInput = document.getElementById('tableSearchInput');
  var q = (searchInput && searchInput.value ? searchInput.value : '').toLowerCase();
    var thead = document.getElementById('viewerTableHead');
    var tbody = document.getElementById('viewerTableBody');
    if (!thead || !tbody) return;

    var c = collectionsCache;
    var cols = [];
    var rows = [];

    if (activeTabKey === 'transaksi') {
  cols = ['ID Nota', 'Tanggal', 'Kasir', 'Pelanggan', 'Metode', 'Total', 'Laba', 'Status'];
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
          '<span style="color:#10b981;font-weight:600">' + formatRupiah(t.profit || t.laba || 0) + '</span>',
          '<span class="badge ' + (t.status === 'failed' ? 'badge-danger' : 'badge-success') + '">' + (t.status || 'completed') + '</span>'
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
    } else if (activeTabKey === 'hutang') {
      cols = ['ID Hutang', 'Nama Kontak', 'Jenis', 'Nominal Awal', 'Sisa Tagihan', 'Status'];
      rows = (c.debts || [])
        .filter(function (d) { return !q || JSON.stringify(d).toLowerCase().includes(q); })
        .map(function (d) {
          return [
            d.id || '-',
            d.contactName || d.customerName || d.nama || '-',
            (d.type === 'payable' || d.type === 'hutang') ? 'Hutang Toko' : 'Piutang Pelanggan',
            formatRupiah(d.initialAmount || d.amount || d.nominal || 0),
            formatRupiah(d.remainingAmount !== undefined ? d.remainingAmount : (d.balance || d.sisa || 0)),
            `<span class="badge ${d.status === 'paid' ? 'badge-success' : 'badge-danger'}">${d.status === 'paid' ? 'Lunas' : 'Belum Lunas'}</span>`
          ];
        });
    } else if (activeTabKey === 'kas') {
      cols = ['ID Shift', 'Tanggal', 'Kasir', 'Modal Awal', 'Kas Akhir', 'Selisih', 'Status'];
      rows = (c.shifts || [])
        .filter(function (s) { return !q || JSON.stringify(s).toLowerCase().includes(q); })
        .map(function (s) {
          return [
            s.id || '-',
            s.date || s.tanggal || '-',
            s.cashier || s.userName || s.kasir || '-',
            formatRupiah(s.startingCash || s.modalAwal || 0),
            formatRupiah(s.systemCash || s.kasAkhir || s.actualCash || 0),
            formatRupiah(s.difference || s.selisih || 0),
            '<span class="badge ' + (s.status === 'closed' ? 'badge-success' : 'badge-warning') + '">' + (s.status || 'closed') + '</span>'
          ];
        });
    } else if (activeTabKey === 'pembelian') {
      cols = ['ID Faktur', 'Tanggal', 'Supplier', 'Total Biaya', 'Metode', 'Status'];
      rows = (c.purchases || [])
        .filter(function (b) { return !q || JSON.stringify(b).toLowerCase().includes(q); })
        .map(function (b) {
          return [
            b.id || b.invoiceNo || '-',
            b.date || b.tanggal || '-',
            b.supplierName || b.supplier || '-',
            formatRupiah(b.totalCost || b.total || b.biaya || 0),
            b.paymentMethod || 'Tunai',
            '<span class="badge ' + (b.paymentStatus === 'Lunas' || b.status === 'completed' ? 'badge-success' : 'badge-warning') + '">' + (b.paymentStatus || b.status || 'Lunas') + '</span>'
          ];
        });
    } else if (activeTabKey === 'pelanggan') {
      cols = ['ID Pelanggan', 'Nama Pelanggan', 'No HP / WA', 'ID PLN / No Meter'];
rows = (c.customers || [])
  .filter(function (cu) { return !q || JSON.stringify(cu).toLowerCase().includes(q); })
  .map(function (cu) {
    var nama = cu.nama || cu.name || cu.namaPelanggan || cu.customerName || '-';
    var hp = cu.noHp || cu.phone || cu.no_hp || cu.whatsapp || cu.telepon || '-';
    var pln = cu.idPln || cu.id_pln || cu.plnId || cu.noMeter || cu.no_meter || cu.meteran || cu.customerNumber || '-';
    return [
      cu.id || '-',
      nama,
      hp,
      pln
    ];
  });
      
    } else if (activeTabKey === 'gaji') {
      cols = ['ID Payroll', 'Periode', 'Nama Staf', 'Gaji Pokok', 'THP Bersih', 'Status'];
      rows = (c.payrolls || [])
        .filter(function (g) { return !q || JSON.stringify(g).toLowerCase().includes(q); })
        .map(function (g) {
          return [
            g.id || '-',
            g.period || g.periode || '-',
            g.staffName || g.employeeName || g.nama || '-',
            formatRupiah(g.basicSalary || g.gajiPokok || 0),
            formatRupiah(g.netSalary || g.thp || 0),
            '<span class="badge ' + (g.status === 'Lunas' || g.status === 'paid' ? 'badge-success' : 'badge-warning') + '">' + (g.status || 'Lunas') + '</span>'
          ];
        });
    } else if (activeTabKey === 'saldo') {
      cols = ['ID Riwayat', 'Waktu', 'Aplikasi', 'Pengisian', 'Sisa Saldo', 'Role'];
      rows = (c.saldoHistory || [])
        .filter(function (sl) { return !q || JSON.stringify(sl).toLowerCase().includes(q); })
        .map(function (sl) {
          return [
            sl.id || '-',
            sl.datetime || sl.date || sl.waktu || '-',
            sl.provider || sl.appName || sl.aplikasi || '-',
            formatRupiah(sl.nominal || sl.amount || sl.pengisian || 0),
            formatRupiah(sl.remainingBalance || sl.sisaSaldo || sl.saldo || 0),
            sl.role || sl.userRole || sl.petugas || sl.recordedBy || '-'
          ];
        });
    }

   thead.innerHTML = '<tr>' + cols.map(function (col) { return '<th>' + col + '</th>'; }).join('') + '</tr>';
if (rows.length === 0) {
  tbody.innerHTML = '<tr><td colspan="' + cols.length + '" style="text-align:center;padding:2rem;color:var(--text-muted)">Tidak ada data</td></tr>';
  return;
}
tbody.innerHTML = rows.map(function (r) {
  return '<tr>' + r.map(function (td) { return '<td>' + td + '</td>'; }).join('') + '</tr>';
}).join('');
  };

  // Fungsi Download CSV untuk tab yang sedang aktif di Live View
  window.exportCurrentViewerTabCSV = function () {
    var thead = document.getElementById('viewerTableHead');
    var tbody = document.getElementById('viewerTableBody');
    if (!thead || !tbody) return;
    var headers = Array.from(thead.querySelectorAll('th')).map(function(th){ return th.textContent.trim(); });
    var trs = Array.from(tbody.querySelectorAll('tr'));
    if (trs.length === 0 || tbody.textContent.includes('Tidak ada data')) {
      notifyToast('Tidak ada data untuk diexport', 'warning');
      return;
    }
    var rows = [headers];
    trs.forEach(function (tr) {
      var cells = Array.from(tr.querySelectorAll('td')).map(function(td){ return td.textContent.trim(); });
      if (cells.length === headers.length) rows.push(cells);
    });
    if (typeof window.downloadCSV === 'function') {
      window.downloadCSV('LiveView_' + activeTabKey, rows);
    }
  };
  
  // Hanya inisialisasi form saat halaman dibuka (HEMAT KUOTA FIRESTORE 100%)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initForm();
      // Muat dari cache browser jika ada, tidak membebani Firestore
      var cached = sessionStorage.getItem('webpos_backup_cache');
      if (cached) {
        try {
          collectionsCache = JSON.parse(cached);
          window.filterViewerTable();
        } catch(e) {}
      }
    });
  } else {
    initForm();
    var cached = sessionStorage.getItem('webpos_backup_cache');
    if (cached) {
      try {
        collectionsCache = JSON.parse(cached);
        window.filterViewerTable();
      } catch(e) {}
    }
  }

})();
