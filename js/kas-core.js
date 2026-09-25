(function(window) {
  'use strict';

  function getDb() {
    if (window.db) return window.db;
    if (window.firebase && window.firebase.firestore) return window.firebase.firestore();
    throw new Error('Firestore belum siap.');
  }

  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const normalized = value.replace(/[^\d.-]/g, '');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function toDateString(input) {
    if (!input) {
      const today = new Date();
      return today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    }
    if (typeof input === 'string') return input;
    if (input instanceof Date && !Number.isNaN(input.getTime())) {
      return input.getFullYear() + '-' +
        String(input.getMonth() + 1).padStart(2, '0') + '-' +
        String(input.getDate()).padStart(2, '0');
    }
    return String(input);
  }

  function normalizeTimestamp(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value.seconds === 'number') {
      return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
    }
    return 0;
  }

  function getTransactionUserId(transaction) {
    return transaction && (transaction.userId || transaction.cashierId || transaction.cashierID || null);
  }

  function getTransactionAmount(transaction) {
    return toNumber(
      transaction && transaction.total != null ? transaction.total :
      transaction && transaction.amount != null ? transaction.amount :
      transaction && transaction.grandTotal != null ? transaction.grandTotal : 0
    );
  }

  function getPaymentMethod(transaction) {
    return String(
      transaction && (transaction.paymentMethod || transaction.paymentType || '')
    ).toLowerCase();
  }

  function getPaymentBucket(method) {
    const value = String(method || '').toLowerCase();
    if (value.indexOf('cash') !== -1 || value.indexOf('tunai') !== -1) return 'tunai';
    if (value.indexOf('qris') !== -1) return 'qris';
    if (value.indexOf('transfer') !== -1 || value.indexOf('bank') !== -1 || value.indexOf('bca') !== -1 || value.indexOf('bri') !== -1) {
      return 'transfer';
    }
    return 'lainnya';
  }

  function isCashMethod(method) {
    const value = String(method || '').toLowerCase();
    return value.indexOf('cash') !== -1 || value.indexOf('tunai') !== -1;
  }

  function isHutangMethod(method) {
    return String(method || '').toLowerCase().indexOf('hutang') !== -1;
  }

  function shouldIncludeKasMasuk(transaction) {
    const category = String(transaction && transaction.category || '').toLowerCase();
    return category !== 'penjualan_hutang' && category !== 'penerimaan_piutang_penjualan';
  }

  function matchesUserFilter(transaction, userFilter) {
    if (!userFilter || !userFilter.size) return true;
    return userFilter.has(getTransactionUserId(transaction));
  }

  function buildUserFilter(options) {
    const ids = [];
    if (options && Array.isArray(options.userIds)) ids.push.apply(ids, options.userIds);
    if (options && options.userId) ids.push(options.userId);
    const clean = ids.filter(Boolean);
    return clean.length ? new Set(clean) : null;
  }

  function sortTransactionsDesc(items) {
    return items.slice().sort(function(a, b) {
      const timeB = normalizeTimestamp(b.timestamp) || normalizeTimestamp(b.createdAt) || Date.parse((b.date || '') + 'T00:00:00') || 0;
      const timeA = normalizeTimestamp(a.timestamp) || normalizeTimestamp(a.createdAt) || Date.parse((a.date || '') + 'T00:00:00') || 0;
      if (timeB !== timeA) return timeB - timeA;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }

  function enumerateDates(startDate, endDate) {
    const dates = [];
    const cursor = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    while (cursor <= end) {
      dates.push(
        cursor.getFullYear() + '-' +
        String(cursor.getMonth() + 1).padStart(2, '0') + '-' +
        String(cursor.getDate()).padStart(2, '0')
      );
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  function aggregateTransactions(transactions) {
    const summary = {
      totalPenjualan: 0,
      totalLaba: 0,
      totalLabaPenjualan: 0,
      totalLabaLayanan: 0,
      totalTransaksi: 0,
      kasMasuk: 0,
      kasKeluar: 0,
      topup: 0,
      tarik: 0,
      topupAdmin: 0,
      tarikAdmin: 0,
      cashPenjualan: 0,
      paymentMethods: { tunai: 0, qris: 0, transfer: 0, lainnya: 0 },
      transactionCounts: {
        penjualan: 0,
        topup: 0,
        tarik: 0,
        kas_masuk: 0,
        kas_keluar: 0
      }
    };

    transactions.forEach(function(transaction) {
      if (!KasCore.isValidTransaction(transaction)) return;

      const type = String(transaction.type || '').toLowerCase();
      const amount = getTransactionAmount(transaction);

      switch (type) {
        case 'penjualan':
          summary.totalPenjualan += amount;
          summary.totalLabaPenjualan += toNumber(transaction.profit);
          summary.totalLaba += toNumber(transaction.profit);
          summary.transactionCounts.penjualan += 1;
          if (transaction.source !== 'hutang_page') {
            summary.totalTransaksi += 1;
          }
          summary.paymentMethods[getPaymentBucket(getPaymentMethod(transaction))] += amount;
          const paymentMethod = getPaymentMethod(transaction);
          if (isHutangMethod(paymentMethod)) {
            summary.cashPenjualan += toNumber(transaction.paymentAmount);
          } else if (isCashMethod(paymentMethod)) {
            summary.cashPenjualan += typeof transaction.paymentAmount === 'number'
              ? toNumber(transaction.paymentAmount)
              : amount;
          }
          break;
        case 'topup':
          if (!isHutangMethod(getPaymentMethod(transaction))) {
            summary.topup += toNumber(transaction.amount);
            summary.topupAdmin += toNumber(transaction.adminFee);
            summary.totalLabaLayanan += toNumber(transaction.adminFee || transaction.profit);
            summary.totalLaba += toNumber(transaction.adminFee || transaction.profit);
            summary.totalTransaksi += 1;
            summary.transactionCounts.topup += 1;
          }
          break;
        case 'tarik':
          summary.tarik += toNumber(transaction.amount);
          summary.tarikAdmin += toNumber(transaction.adminFee);
          summary.totalLabaLayanan += toNumber(transaction.adminFee || transaction.profit);
          summary.totalLaba += toNumber(transaction.adminFee || transaction.profit);
          summary.totalTransaksi += 1;
          summary.transactionCounts.tarik += 1;
          break;
        case 'kas_masuk':
          if (shouldIncludeKasMasuk(transaction)) {
            summary.kasMasuk += toNumber(transaction.amount || transaction.total);
          }
          summary.transactionCounts.kas_masuk += 1;
          break;
        case 'kas_keluar':
          summary.kasKeluar += toNumber(transaction.amount || transaction.total);
          summary.transactionCounts.kas_keluar += 1;
          break;
      }
    });

    return summary;
  }

  async function fetchTransactions(options) {
    const startDate = toDateString(options && (options.startDate || options.date));
    const endDate = toDateString(options && (options.endDate || options.date || startDate));
    const userFilter = buildUserFilter(options || {});
    const typeFilter = options && Array.isArray(options.types) && options.types.length
      ? new Set(options.types.map(function(item) { return String(item).toLowerCase(); }))
      : null;
    const includeInvalid = !!(options && options.includeInvalid);

    const transactions = [];
    function collect(snapshot) {
      snapshot.forEach(function(doc) {
        const data = Object.assign({ id: doc.id }, doc.data() || {});
        if (userFilter && !matchesUserFilter(data, userFilter)) return;
        if (typeFilter && !typeFilter.has(String(data.type || '').toLowerCase())) return;
        if (!includeInvalid && !KasCore.isValidTransaction(data)) return;
        transactions.push(data);
      });
    }

    if (startDate === endDate) {
      const snapshot = await getDb().collection('transactions').where('date', '==', startDate).get();
      collect(snapshot);
    } else {
      try {
        const snapshot = await getDb().collection('transactions')
          .where('date', '>=', startDate)
          .where('date', '<=', endDate)
          .get();
        collect(snapshot);
      } catch (error) {
        if (!(error && (error.code === 'failed-precondition' || String(error.message || '').toLowerCase().indexOf('index') !== -1))) {
          throw error;
        }
        const dates = enumerateDates(startDate, endDate);
        for (let i = 0; i < dates.length; i += 1) {
          const snapshot = await getDb().collection('transactions').where('date', '==', dates[i]).get();
          collect(snapshot);
        }
      }
    }

    return sortTransactionsDesc(transactions);
  }

  async function fetchModalEntries(options) {
    const date = toDateString(options && options.date);
    const userFilter = buildUserFilter(options || {});
    const items = [];

    if (options && options.userId && !(options && Array.isArray(options.userIds) && options.userIds.length)) {
      const specificId = options.userId;
      let docSnap = await getDb().collection('modal').doc(date + '_' + specificId).get();
      if (!docSnap.exists) {
        docSnap = await getDb().collection('modal').doc(date).get();
      }
      if (docSnap.exists) {
        const data = Object.assign({ id: docSnap.id }, docSnap.data() || {});
        if (docSnap.id === date && data.userId !== specificId) return items;
        items.push(data);
      }
    } else {
      const snapshot = await getDb().collection('modal').where('date', '==', date).get();
      snapshot.forEach(function(doc) {
        const data = Object.assign({ id: doc.id }, doc.data() || {});
        if (userFilter) {
          if (!data.userId || !userFilter.has(data.userId)) return;
        }
        items.push(data);
      });
    }

    return items;
  }

  const KasCore = {
    /**
     * Memastikan transaksi valid untuk perhitungan kas dan laporan.
     * @param {Object} transaction
     * @returns {boolean}
     */
    isValidTransaction: function(transaction) {
      const status = String(transaction && transaction.status || '').toLowerCase();
      return status !== 'cancelled' && status !== 'voided';
    },

    /**
     * Mengambil daftar transaksi mentah untuk rentang tanggal tertentu.
     * @param {Object} options
     * @returns {Promise<Array<Object>>}
     */
    getTransactions: async function(options) {
      return fetchTransactions(options || {});
    },

    /**
     * Mengambil ringkasan transaksi harian dengan angka numerik mentah.
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    getDailySummary: async function(options) {
      const date = toDateString(options && options.date);
      const transactions = await fetchTransactions(Object.assign({}, options || {}, {
        date: date,
        startDate: date,
        endDate: date
      }));
      return Object.assign({ date: date, transactions: transactions }, aggregateTransactions(transactions));
    },

    /**
     * Mengambil ringkasan transaksi untuk rentang tanggal; memakai query range lalu fallback aman bila index belum tersedia.
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    getPeriodSummary: async function(options) {
      const startDate = toDateString(options && options.startDate);
      const endDate = toDateString(options && (options.endDate || options.startDate));
      const transactions = await fetchTransactions(Object.assign({}, options || {}, {
        startDate: startDate,
        endDate: endDate
      }));
      return Object.assign({ startDate: startDate, endDate: endDate, transactions: transactions }, aggregateTransactions(transactions));
    },

    /**
     * Mengambil total modal harian yang dipakai untuk perhitungan kas fisik.
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    getModalSummary: async function(options) {
      const date = toDateString(options && options.date);
      const items = await fetchModalEntries(Object.assign({}, options || {}, { date: date }));
      return {
        date: date,
        totalModal: items.reduce(function(sum, item) {
          return sum + toNumber(item.amount);
        }, 0),
        items: items
      };
    },

    /**
     * Menghitung saldo kas fisik laci sesuai formula dashboard.
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    getKasFisikLaci: async function(options) {
      const date = toDateString(options && options.date);
      const summary = await KasCore.getDailySummary(Object.assign({}, options || {}, { date: date }));
      const modalSummary = await KasCore.getModalSummary(Object.assign({}, options || {}, { date: date }));
      const topupKasFisik = summary.topup + summary.topupAdmin;
      const tarikKasFisik = Math.max(0, summary.tarik - summary.tarikAdmin);
      const kasFisik = modalSummary.totalModal +
        summary.kasMasuk -
        summary.kasKeluar +
        summary.cashPenjualan +
        topupKasFisik -
        tarikKasFisik;

      return {
        date: date,
        modalAwal: modalSummary.totalModal,
        cashPenjualan: summary.cashPenjualan,
        totalPenjualan: summary.totalPenjualan,
        totalLaba: summary.totalLaba,
        totalTransaksi: summary.totalTransaksi,
        kasMasuk: summary.kasMasuk,
        kasKeluar: summary.kasKeluar,
        topup: summary.topup,
        topupAdmin: summary.topupAdmin,
        topupKasFisik: topupKasFisik,
        tarik: summary.tarik,
        tarikAdmin: summary.tarikAdmin,
        tarikKasFisik: tarikKasFisik,
        kasFisik: kasFisik,
        paymentMethods: summary.paymentMethods,
        transactionCounts: summary.transactionCounts,
        transactions: summary.transactions,
        modalItems: modalSummary.items
      };
    },

    /**
     * Mengambil ringkasan shift berdasarkan id shift atau kombinasi tanggal dan user.
     * @param {Object} options
     * @returns {Promise<Object|null>}
     */
    getShiftSummary: async function(options) {
      const settings = options || {};
      const date = toDateString(settings.date);
      const shiftId = settings.shiftId || (date && settings.userId ? date + '_' + settings.userId : null);
      if (!shiftId) return null;

      const doc = await getDb().collection('shifts').doc(shiftId).get();
      const shiftData = doc.exists ? Object.assign({ id: doc.id }, doc.data() || {}) : null;
      if (!shiftData) return null;

      const cashSummary = await KasCore.getKasFisikLaci({
        date: shiftData.date || date,
        userId: shiftData.userId || settings.userId
      });

      return Object.assign({}, cashSummary, shiftData, {
        shiftId: doc.id,
        modalAwal: shiftData.modalAwal != null ? toNumber(shiftData.modalAwal) : cashSummary.modalAwal,
        kasSistemStored: shiftData.kasSistem != null ? toNumber(shiftData.kasSistem) : null,
        closingKasFisik: shiftData.kasAkhir != null ? toNumber(shiftData.kasAkhir) : null,
        kasFisik: String(shiftData.status || '').toLowerCase() === 'closed' && shiftData.kasSistem != null
          ? toNumber(shiftData.kasSistem)
          : cashSummary.kasFisik
      });
    },

    /**
     * Mengambil performa staf harian untuk tabel dashboard.
     * @param {Object} options
     * @returns {Promise<Array<Object>>}
     */
    getStaffPerformanceToday: async function(options) {
      const date = toDateString(options && options.date);
      const includeRoles = options && Array.isArray(options.includeRoles) && options.includeRoles.length
        ? new Set(options.includeRoles.map(function(role) { return String(role).toLowerCase(); }))
        : null;
      const userFilter = buildUserFilter(options || {});

      const usersSnapshot = await getDb().collection('users').get();
      const usersMap = {};
      usersSnapshot.forEach(function(doc) {
        usersMap[doc.id] = Object.assign({ id: doc.id }, doc.data() || {});
      });

      const modalSummary = await KasCore.getModalSummary(Object.assign({}, options || {}, { date: date }));
      const transactions = await fetchTransactions({
        date: date,
        startDate: date,
        endDate: date,
        userId: options && options.userId,
        userIds: options && options.userIds
      });

      const rows = {};
      function ensureRow(userId, fallbackName) {
        const user = usersMap[userId] || {};
        const role = String(user.role || 'kasir').toLowerCase();
        if (includeRoles && !includeRoles.has(role)) return null;
        if (userFilter && !userFilter.has(userId)) return null;
        if (!rows[userId]) {
          rows[userId] = {
            userId: userId,
            name: fallbackName || user.name || user.username || 'Staf',
            role: role,
            modalAwal: 0,
            totalPenjualan: 0,
            totalTransaksi: 0
          };
        }
        return rows[userId];
      }

      modalSummary.items.forEach(function(item) {
        if (!item.userId) return;
        const row = ensureRow(item.userId, item.userName);
        if (!row) return;
        row.modalAwal += toNumber(item.amount);
      });

      transactions.forEach(function(transaction) {
        const userId = getTransactionUserId(transaction);
        if (!userId || String(transaction.type || '').toLowerCase() !== 'penjualan') return;
        const row = ensureRow(userId, transaction.userName || transaction.cashierName);
        if (!row) return;
        row.totalPenjualan += getTransactionAmount(transaction);
        if (transaction.source !== 'hutang_page') {
          row.totalTransaksi += 1;
        }
      });

      return Object.keys(rows).map(function(key) {
        return rows[key];
      }).sort(function(a, b) {
        return b.totalPenjualan - a.totalPenjualan;
      });
    },

    normalizeTimestamp: normalizeTimestamp,
    getTransactionAmount: getTransactionAmount,
    getTransactionUserId: getTransactionUserId
  };

  window.KasCore = KasCore;
})(window);
