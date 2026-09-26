// js/kas-core.js - Sumber tunggal perhitungan kas WebPOS.
// Semua angka yang dikembalikan adalah number mentah; format Rupiah tetap di halaman UI.
if (typeof window.KasCore === 'undefined') {
  window.KasCore = (function () {
    'use strict';

    function getDb() {
      if (!window.db && !(window.firebase && firebase.firestore)) {
        throw new Error('Firestore belum siap. Muat js/firebase-config.js sebelum js/kas-core.js.');
      }
      return window.db || firebase.firestore();
    }

    /** Mengubah nilai Firestore/form menjadi number aman. */
    function toNumber(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        var parsed = Number(value.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    }

    /** Tanggal lokal dalam format YYYY-MM-DD, tanpa masalah UTC dari toISOString(). */
    function getTodayString(date) {
      var d = date instanceof Date ? date : new Date();
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }

    /** Mengembalikan true hanya untuk transaksi yang masuk perhitungan. */
    function isValidTransaction(transaction) {
      var status = String((transaction && transaction.status) || '').toLowerCase();
      return status !== 'cancelled' && status !== 'voided';
    }

    /** Fallback nilai transaksi untuk data lama: total, amount, lalu paymentAmount. */
    function getAmount(transaction) {
      transaction = transaction || {};
      if (transaction.total !== undefined && transaction.total !== null) return toNumber(transaction.total);
      if (transaction.amount !== undefined && transaction.amount !== null) return toNumber(transaction.amount);
      return toNumber(transaction.paymentAmount);
    }

    function getAdminFee(transaction) {
      transaction = transaction || {};
      return toNumber(transaction.adminFee !== undefined ? transaction.adminFee : transaction.fee);
    }

    function getType(transaction) {
      return String((transaction && transaction.type) || '').trim().toLowerCase();
    }

    function getPaymentMethod(transaction) {
      transaction = transaction || {};
      return String(transaction.paymentMethod || transaction.paymentType || transaction.method || 'cash').trim().toLowerCase();
    }

    function isCashPayment(transaction) {
      var method = getPaymentMethod(transaction);
      return ['cash', 'tunai', 'cashier', 'uang_tunai'].indexOf(method) !== -1;
    }

    function isDebtPayment(transaction) {
      var method = getPaymentMethod(transaction);
      return ['hutang', 'piutang', 'bon', 'credit'].indexOf(method) !== -1;
    }

    /** Penjualan yang benar-benar menambah uang fisik laci. */
    function getPhysicalSaleAmount(transaction) {
      if (isCashPayment(transaction)) {
        return transaction && transaction.paymentAmount !== undefined
          ? toNumber(transaction.paymentAmount)
          : getAmount(transaction);
      }
      if (isDebtPayment(transaction)) return toNumber(transaction && transaction.paymentAmount);
      return 0;
    }

    function shouldCountCashIn(transaction) {
      var category = String((transaction && transaction.category) || '').toLowerCase();
      return category !== 'penjualan_hutang' && category !== 'penerimaan_piutang_penjualan';
    }

    function isCashPurchase(transaction) {
      transaction = transaction || {};
      return transaction.kurangiSaldo === true || transaction.reduceCash === true ||
        transaction.cashImpact === 'out' || transaction.isCashExpense === true;
    }

    function normalizeTransaction(id, data) {
      var transaction = Object.assign({ id: id }, data || {});
      transaction.amountValue = getAmount(transaction);
      transaction.adminFeeValue = getAdminFee(transaction);
      transaction.typeNormalized = getType(transaction);
      return transaction;
    }

    async function getTransactionsByDateRange(options) {
      options = options || {};
      var startDate = options.startDate || options.date || getTodayString();
      var endDate = options.endDate || options.date || startDate;
      var userId = options.userId || null;
      var shiftId = options.shiftId || null;
      var firestore = getDb();
      var snapshot;

      try {
        snapshot = await firestore.collection('transactions')
          .where('date', '>=', startDate)
          .where('date', '<=', endDate)
          .get();
      } catch (error) {
        console.warn('kas-core: query range date gagal, memakai fallback filter client.', error);
        snapshot = await firestore.collection('transactions').get();
      }

      var result = [];
      snapshot.forEach(function (doc) {
        var tx = normalizeTransaction(doc.id, doc.data());
        var txDate = tx.date || '';
        if (txDate < startDate || txDate > endDate) return;
        if (userId && tx.userId !== userId) return;
        if (shiftId && tx.shiftId !== shiftId) return;
        result.push(tx);
      });
      return result;
    }

    function summarizeTransactions(transactions) {
      var summary = {
        totalPenjualan: 0,
        totalLaba: 0,
        totalTransaksi: 0,
        penjualanTunai: 0,
        kasMasuk: 0,
        kasKeluar: 0,
        topup: 0,
        topupAdmin: 0,
        tarik: 0,
        tarikAdmin: 0,
        pembelianKasKeluar: 0,
        totalKasMasukFisik: 0,
        totalKasKeluarFisik: 0,
        transaksi: []
      };

      (transactions || []).forEach(function (tx) {
        if (!isValidTransaction(tx)) return;
        var type = getType(tx);
        var amount = getAmount(tx);
        var admin = getAdminFee(tx);
        summary.transaksi.push(tx);

        if (type === 'penjualan') {
          summary.totalPenjualan += amount;
          summary.totalLaba += toNumber(tx.profit);
          summary.totalTransaksi += 1;
          summary.penjualanTunai += getPhysicalSaleAmount(tx);
        } else if (type === 'kas_masuk') {
          if (shouldCountCashIn(tx)) summary.kasMasuk += amount;
        } else if (type === 'kas_keluar') {
          summary.kasKeluar += amount;
        } else if (type === 'topup') {
          if (!isDebtPayment(tx)) {
            summary.topup += amount;
            summary.topupAdmin += admin;
          }
        } else if (type === 'tarik') {
          summary.tarik += amount;
          summary.tarikAdmin += admin;
        } else if (['pembelian', 'purchase', 'restock'].indexOf(type) !== -1 && isCashPurchase(tx)) {
          summary.pembelianKasKeluar += amount;
        }
      });

      summary.topupFisik = summary.topup + summary.topupAdmin;
      summary.tarikFisik = Math.max(0, summary.tarik - summary.tarikAdmin);
      summary.totalKasMasukFisik = summary.kasMasuk + summary.penjualanTunai + summary.topupFisik;
      summary.totalKasKeluarFisik = summary.kasKeluar + summary.pembelianKasKeluar + summary.tarikFisik;
      return summary;
    }

    async function getPeriodSummary(options) {
      options = options || {};
      var transactions = await getTransactionsByDateRange(options);
      var summary = summarizeTransactions(transactions);
      summary.startDate = options.startDate || options.date || getTodayString();
      summary.endDate = options.endDate || options.date || summary.startDate;
      return summary;
    }

    async function getDailySummary(options) {
      options = options || {};
      var date = options.date || getTodayString();
      return getPeriodSummary(Object.assign({}, options, { startDate: date, endDate: date }));
    }

    async function getModalAmount(options) {
      options = options || {};
      var date = options.date || getTodayString();
      var userId = options.userId || null;
      var firestore = getDb();

      if (userId) {
        var specific = await firestore.collection('modal').doc(date + '_' + userId).get();
        if (specific.exists) return toNumber(specific.data().amount);
      }

      var legacy = await firestore.collection('modal').doc(date).get();
      if (legacy.exists) return toNumber(legacy.data().amount);
      return 0;
    }

    async function getModalSummary(options) {
      options = options || {};
      var date = options.date || getTodayString();
      var firestore = getDb();
      var snapshot = await firestore.collection('modal').where('date', '==', date).get();
      var items = [];
      snapshot.forEach(function (doc) {
        items.push(Object.assign({ id: doc.id, amount: 0 }, doc.data(), {
          amount: toNumber(doc.data().amount)
        }));
      });
      return {
        date: date,
        items: items,
        total: items.reduce(function (total, item) { return total + item.amount; }, 0)
      };
    }

    async function getKasFisikLaci(options) {
      options = options || {};
      var date = options.date || getTodayString();
      var summary = await getDailySummary(Object.assign({}, options, { date: date }));
      var modalAwal = options.modalAwal !== undefined
        ? toNumber(options.modalAwal)
        : await getModalAmount({ date: date, userId: options.userId });
      var kasFisik = modalAwal + summary.totalKasMasukFisik - summary.totalKasKeluarFisik;

      return Object.assign({}, summary, {
        date: date,
        modalAwal: modalAwal,
        uangGlobal: kasFisik,
        kasFisik: kasFisik
      });
    }

    async function getShiftSummary(options) {
      options = options || {};
      var date = options.date || getTodayString();
      var summary = await getKasFisikLaci({
        date: date,
        userId: options.userId,
        shiftId: options.shiftId,
        modalAwal: options.modalAwal
      });
      summary.shiftId = options.shiftId || null;
      return summary;
    }

    async function getStaffPerformanceToday(options) {
      options = options || {};
      var date = options.date || getTodayString();
      var firestore = getDb();
      var transactions = await getTransactionsByDateRange({ startDate: date, endDate: date });
      var usersSnapshot = await firestore.collection('users').get();
      var users = {};
      usersSnapshot.forEach(function (doc) {
        users[doc.id] = Object.assign({ id: doc.id }, doc.data());
      });

      var grouped = {};
      Object.keys(users).forEach(function (id) {
        grouped[id] = {
          userId: id,
          name: users[id].name || users[id].username || '-',
          role: String(users[id].role || 'kasir').toLowerCase(),
          modalAwal: 0,
          penjualan: 0,
          laba: 0,
          totalTransaksi: 0
        };
      });

      transactions.forEach(function (tx) {
        if (!isValidTransaction(tx) || !tx.userId) return;
        if (!grouped[tx.userId]) {
          grouped[tx.userId] = { userId: tx.userId, name: tx.userName || '-', role: 'kasir', modalAwal: 0, penjualan: 0, laba: 0, totalTransaksi: 0 };
        }
        if (getType(tx) === 'penjualan') {
          grouped[tx.userId].penjualan += getAmount(tx);
          grouped[tx.userId].laba += toNumber(tx.profit);
          grouped[tx.userId].totalTransaksi += 1;
        }
      });

      var modalSummary = await getModalSummary({ date: date });
      modalSummary.items.forEach(function (item) {
        if (!item.userId) return;
        if (!grouped[item.userId]) {
          grouped[item.userId] = { userId: item.userId, name: item.userName || '-', role: 'kasir', modalAwal: 0, penjualan: 0, laba: 0, totalTransaksi: 0 };
        }
        grouped[item.userId].modalAwal += item.amount;
      });

      return Object.keys(grouped).map(function (id) { return grouped[id]; });
    }

    return {
      toNumber: toNumber,
      getTodayString: getTodayString,
      isValidTransaction: isValidTransaction,
      getAmount: getAmount,
      getAdminFee: getAdminFee,
      getType: getType,
      getPaymentMethod: getPaymentMethod,
      getPhysicalSaleAmount: getPhysicalSaleAmount,
      getTransactionsByDateRange: getTransactionsByDateRange,
      summarizeTransactions: summarizeTransactions,
      getDailySummary: getDailySummary,
      getPeriodSummary: getPeriodSummary,
      getModalAmount: getModalAmount,
      getModalSummary: getModalSummary,
      getKasFisikLaci: getKasFisikLaci,
      getShiftSummary: getShiftSummary,
      getStaffPerformanceToday: getStaffPerformanceToday
    };
  })();
}

var KasCore = window.KasCore;
