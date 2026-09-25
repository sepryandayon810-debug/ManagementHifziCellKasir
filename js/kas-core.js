if (typeof window.KasCore === 'undefined') {
  window.KasCore = (function() {
    "use strict";

    const EXCLUDED_KAS_MASUK_CATEGORIES = [
      'penjualan_hutang',
      'penerimaan_piutang_penjualan'
    ];

    function getDb() {
      if (window.db && typeof window.db.collection === 'function') {
        return window.db;
      }
      if (window.firebase && window.firebase.firestore) {
        return window.firebase.firestore();
      }
      throw new Error('KasCore membutuhkan firebase.firestore() yang sudah diinisialisasi');
    }

    function normalizeNumber(value) {
      if (typeof value === 'number' && !isNaN(value)) return value;
      if (typeof value === 'string') {
        const cleaned = value.replace(/[^\d.-]/g, '');
        const parsed = Number(cleaned);
        return isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    }

    function parseDateValue(value) {
      if (!value) return null;
      if (typeof value === 'number') {
        const numberDate = new Date(value);
        return isNaN(numberDate.getTime()) ? null : numberDate;
      }
      if (value && typeof value.toDate === 'function') {
        try {
          return value.toDate();
        } catch (error) {
          console.error('kas-core: gagal parse Firestore Timestamp', error);
          return null;
        }
      }
      if (value && typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000);
      }
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }

    function formatDateKey(dateValue) {
      const date = parseDateValue(dateValue);
      if (!date) return '';
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
      ].join('-');
    }

    function getTransactionDate(transaction) {
      return transaction && transaction.date
        ? transaction.date
        : formatDateKey(transaction && transaction.timestamp);
    }

    function getUserId(transaction) {
      return transaction
        ? (transaction.userId || transaction.cashierId || transaction.cashierID || null)
        : null;
    }

    function getPaymentMethod(transaction) {
      return String(
        (transaction && (transaction.paymentMethod || transaction.paymentType)) || 'cash'
      ).toLowerCase();
    }

    function getAdminFee(transaction) {
      return normalizeNumber(transaction && transaction.adminFee);
    }

    function getAmount(transaction) {
      if (!transaction) return 0;
      if (transaction.type === 'penjualan') {
        return normalizeNumber(transaction.total != null ? transaction.total : transaction.amount);
      }
      if (transaction.amount != null) return normalizeNumber(transaction.amount);
      if (transaction.total != null) return normalizeNumber(transaction.total);
      return 0;
    }

    function getPaymentAmount(transaction) {
      if (!transaction) return 0;
      if (transaction.paymentAmount != null) return normalizeNumber(transaction.paymentAmount);
      return getAmount(transaction);
    }

    function isValidTransaction(transaction) {
      const status = String((transaction && transaction.status) || '').toLowerCase();
      return status !== 'cancelled' && status !== 'voided';
    }

    function getCashSaleAmount(transaction) {
      const method = getPaymentMethod(transaction);
      if (method === 'cash' || method === 'tunai') {
        return getPaymentAmount(transaction);
      }
      if (method === 'hutang') {
        return getPaymentAmount(transaction);
      }
      return 0;
    }

    function classifyPaymentMethod(transaction) {
      const method = getPaymentMethod(transaction);
      if (method.indexOf('cash') >= 0 || method.indexOf('tunai') >= 0) return 'tunai';
      if (method.indexOf('qris') >= 0) return 'qris';
      if (
        method.indexOf('transfer') >= 0 ||
        method.indexOf('bca') >= 0 ||
        method.indexOf('bri') >= 0 ||
        method.indexOf('mandiri') >= 0 ||
        method.indexOf('bank') >= 0
      ) {
        return 'transfer';
      }
      if (method.indexOf('hutang') >= 0) return 'hutang';
      return 'lainnya';
    }

    function matchesTransactionFilters(transaction, filters) {
      if (!transaction) return false;
      if (filters.userId && getUserId(transaction) !== filters.userId) return false;
      if (filters.shiftId && transaction.shiftId !== filters.shiftId) return false;
      return true;
    }

    function createSummary(transactions) {
      const summary = {
        transactions: Array.isArray(transactions) ? transactions.slice() : [],
        validTransactions: [],
        totalSales: 0,
        cashSales: 0,
        salesProfit: 0,
        totalProfit: 0,
        transactionCount: 0,
        salesTransactionCount: 0,
        cashMutationCount: 0,
        cashMutationIncomeCount: 0,
        cashMutationExpenseCount: 0,
        cashIn: 0,
        cashOut: 0,
        topup: 0,
        topupAdmin: 0,
        withdrawal: 0,
        withdrawalAdmin: 0,
        paymentMethods: {
          tunai: 0,
          qris: 0,
          transfer: 0,
          hutang: 0,
          lainnya: 0
        }
      };

      summary.transactions.forEach(function(transaction) {
        if (!isValidTransaction(transaction)) return;
        summary.validTransactions.push(transaction);

        const amount = getAmount(transaction);
        const adminFee = getAdminFee(transaction);

        switch (transaction.type) {
          case 'penjualan': {
            const paymentGroup = classifyPaymentMethod(transaction);
            summary.totalSales += amount;
            summary.cashSales += getCashSaleAmount(transaction);
            summary.salesProfit += normalizeNumber(transaction.profit);
            summary.paymentMethods[paymentGroup] =
              (summary.paymentMethods[paymentGroup] || 0) + amount;
            if (transaction.source !== 'hutang_page') {
              summary.salesTransactionCount += 1;
              summary.transactionCount += 1;
            }
            break;
          }
          case 'topup':
            if (getPaymentMethod(transaction) !== 'hutang') {
              summary.topup += amount;
              summary.topupAdmin += adminFee;
            }
            summary.transactionCount += 1;
            summary.cashMutationCount += 1;
            summary.cashMutationIncomeCount += 1;
            break;
          case 'tarik':
            summary.withdrawal += amount;
            summary.withdrawalAdmin += adminFee;
            summary.transactionCount += 1;
            summary.cashMutationCount += 1;
            summary.cashMutationExpenseCount += 1;
            break;
          case 'kas_masuk':
            if (EXCLUDED_KAS_MASUK_CATEGORIES.indexOf(transaction.category) === -1) {
              summary.cashIn += amount;
            }
            summary.cashMutationCount += 1;
            summary.cashMutationIncomeCount += 1;
            break;
          case 'kas_keluar':
            summary.cashOut += amount;
            summary.cashMutationCount += 1;
            summary.cashMutationExpenseCount += 1;
            break;
        }
      });

      summary.totalProfit = summary.salesProfit + summary.topupAdmin + summary.withdrawalAdmin;
      summary.totalCashInDrawer =
        summary.cashSales + summary.cashIn + summary.topup + summary.topupAdmin;
      summary.totalCashOutDrawer =
        summary.cashOut + Math.max(0, summary.withdrawal - summary.withdrawalAdmin);
      summary.netCashFlow = summary.totalCashInDrawer - summary.totalCashOutDrawer;
      summary.totalCashMutation =
        summary.cashIn +
        summary.cashOut +
        summary.topup +
        summary.withdrawal;

      return summary;
    }

    async function loadTransactionsByRange(startDate, endDate) {
      const db = getDb();
      if (!startDate || !endDate) return [];

      try {
        let query = db.collection('transactions');
        if (startDate === endDate) {
          query = query.where('date', '==', startDate);
        } else {
          query = query.where('date', '>=', startDate).where('date', '<=', endDate);
        }

        const snapshot = await query.get();
        const transactions = [];
        snapshot.forEach(function(doc) {
          transactions.push(Object.assign({ id: doc.id }, doc.data()));
        });
        return transactions;
      } catch (error) {
        console.error('kas-core: query range transactions gagal, pakai fallback lokal', {
          startDate: startDate,
          endDate: endDate,
          error: error
        });
        const snapshot = await db.collection('transactions').get();
        const transactions = [];
        snapshot.forEach(function(doc) {
          const data = Object.assign({ id: doc.id }, doc.data());
          const dateKey = getTransactionDate(data);
          if (dateKey && dateKey >= startDate && dateKey <= endDate) {
            transactions.push(data);
          }
        });
        return transactions;
      }
    }

    /**
     * Ambil transaksi mentah dalam rentang tanggal dengan fallback field yang aman.
     * @param {{startDate:string, endDate:string, userId?:string, shiftId?:string}} options
     * @returns {Promise<Array<object>>}
     */
    async function getTransactionsByDateRange(options) {
      const startDate = options && options.startDate;
      const endDate = options && options.endDate;
      const userId = options && options.userId;
      const shiftId = options && options.shiftId;
      const transactions = await loadTransactionsByRange(startDate, endDate);

      return transactions
        .filter(function(transaction) {
          return matchesTransactionFilters(transaction, { userId: userId, shiftId: shiftId });
        })
        .sort(function(a, b) {
          const timeA = parseDateValue(a.timestamp);
          const timeB = parseDateValue(b.timestamp);
          return (timeB ? timeB.getTime() : 0) - (timeA ? timeA.getTime() : 0);
        });
    }

    async function loadModalEntry(date, userId) {
      const db = getDb();

      if (!userId) return null;

      try {
        const directDoc = await db.collection('modal').doc(date + '_' + userId).get();
        if (directDoc.exists) {
          return Object.assign({ id: directDoc.id }, directDoc.data());
        }
      } catch (error) {
        console.error('kas-core: gagal membaca modal harian by user doc', { date: date, userId: userId, error: error });
      }

      try {
        const snapshot = await db.collection('modal').where('date', '==', date).get();
        let matched = null;
        snapshot.forEach(function(doc) {
          const data = Object.assign({ id: doc.id }, doc.data());
          if (!matched && data.userId === userId) {
            matched = data;
          }
        });
        if (matched) return matched;
      } catch (error) {
        console.error('kas-core: gagal fallback query modal by date', { date: date, userId: userId, error: error });
      }

      try {
        const legacyDoc = await db.collection('modal').doc(date).get();
        if (legacyDoc.exists) {
          return Object.assign({ id: legacyDoc.id }, legacyDoc.data());
        }
      } catch (error) {
        console.error('kas-core: gagal membaca modal legacy doc', { date: date, userId: userId, error: error });
      }

      return null;
    }

    /**
     * Ambil ringkasan modal harian untuk satu tanggal.
     * @param {{date:string, userId?:string}} options
     * @returns {Promise<{date:string, entries:Array<object>, total:number}>}
     */
    async function getModalSummary(options) {
      const date = options && options.date;
      const userId = options && options.userId;
      const db = getDb();

      if (!date) {
        return { date: '', entries: [], total: 0 };
      }

      if (userId) {
        const entry = await loadModalEntry(date, userId);
        const amount = normalizeNumber(entry && entry.amount);
        return {
          date: date,
          entries: entry ? [entry] : [],
          total: amount
        };
      }

      try {
        const snapshot = await db.collection('modal').where('date', '==', date).get();
        const entries = [];
        snapshot.forEach(function(doc) {
          entries.push(Object.assign({ id: doc.id }, doc.data()));
        });
        return {
          date: date,
          entries: entries,
          total: entries.reduce(function(sum, entry) {
            return sum + normalizeNumber(entry.amount);
          }, 0)
        };
      } catch (error) {
        console.error('kas-core: gagal mengambil ringkasan modal', { date: date, error: error });
        return { date: date, entries: [], total: 0 };
      }
    }

    /**
     * Ringkasan transaksi untuk satu hari.
     * @param {{date:string, userId?:string, shiftId?:string}} options
     * @returns {Promise<object>}
     */
    async function getDailySummary(options) {
      const date = options && options.date;
      return getPeriodSummary({
        startDate: date,
        endDate: date,
        userId: options && options.userId,
        shiftId: options && options.shiftId
      });
    }

    /**
     * Ringkasan transaksi untuk rentang tanggal.
     * @param {{startDate:string, endDate:string, userId?:string, shiftId?:string}} options
     * @returns {Promise<object>}
     */
    async function getPeriodSummary(options) {
      const startDate = options && options.startDate;
      const endDate = options && options.endDate;
      const userId = options && options.userId;
      const shiftId = options && options.shiftId;
      const transactions = await getTransactionsByDateRange({
        startDate: startDate,
        endDate: endDate,
        userId: userId,
        shiftId: shiftId
      });
      const summary = createSummary(transactions);
      summary.startDate = startDate;
      summary.endDate = endDate;
      summary.userId = userId || null;
      summary.shiftId = shiftId || null;
      return summary;
    }

    /**
     * Hitung kas fisik laci dari modal awal dan hasil ringkasan transaksi.
     * @param {number} modalAwal
     * @param {object} summary
     * @returns {{modalAwal:number, topupKasFisik:number, tarikKasFisik:number, total:number}}
     */
    function calculateKasFisikLaciFromSummary(modalAwal, summary) {
      const safeSummary = summary || createSummary([]);
      const normalizedModal = normalizeNumber(modalAwal);
      const topupKasFisik = safeSummary.topup + safeSummary.topupAdmin;
      const tarikKasFisik = Math.max(0, safeSummary.withdrawal - safeSummary.withdrawalAdmin);
      const total =
        normalizedModal +
        safeSummary.cashIn -
        safeSummary.cashOut +
        safeSummary.cashSales +
        topupKasFisik -
        tarikKasFisik;

      return {
        modalAwal: normalizedModal,
        topupKasFisik: topupKasFisik,
        tarikKasFisik: tarikKasFisik,
        total: total
      };
    }

    /**
     * Hitung kas fisik laci dengan rumus modal + masuk - keluar + penjualan tunai + topup - tarik.
     * @param {{date:string, userId?:string, shiftId?:string}} options
     * @returns {Promise<object>}
     */
    async function getKasFisikLaci(options) {
      const date = options && options.date;
      const userId = options && options.userId;
      const shiftId = options && options.shiftId;
      const modalSummary = await getModalSummary({ date: date, userId: userId });
      const summary = await getDailySummary({ date: date, userId: userId, shiftId: shiftId });
      const kasFisik = calculateKasFisikLaciFromSummary(modalSummary.total, summary);

      return {
        date: date,
        userId: userId || null,
        shiftId: shiftId || null,
        modalAwal: kasFisik.modalAwal,
        uangMasukLain: summary.cashIn,
        kasKeluarToko: summary.cashOut,
        penjualanProduk: summary.cashSales,
        topup: summary.topup,
        topupAdmin: summary.topupAdmin,
        tarikTunai: summary.withdrawal,
        tarikAdmin: summary.withdrawalAdmin,
        topupKasFisik: kasFisik.topupKasFisik,
        tarikKasFisik: kasFisik.tarikKasFisik,
        total: kasFisik.total,
        summary: summary
      };
    }

    /**
     * Ringkasan shift dan closing berdasarkan tanggal / user / shift.
     * @param {{date:string, shiftId?:string, userId?:string}} options
     * @returns {Promise<object>}
     */
    async function getShiftSummary(options) {
      const date = options && options.date;
      const userId = options && options.userId;
      const shiftId = options && options.shiftId;
      const db = getDb();
      const kas = await getKasFisikLaci({ date: date, userId: userId, shiftId: shiftId });
      let shift = null;

      try {
        if (userId) {
          const doc = await db.collection('shifts').doc(date + '_' + userId).get();
          if (doc.exists) {
            shift = Object.assign({ id: doc.id }, doc.data());
          }
        }

        if (!shift) {
          const snapshot = await db.collection('shifts').where('date', '==', date).get();
          snapshot.forEach(function(doc) {
            if (shift) return;
            const data = Object.assign({ id: doc.id }, doc.data());
            if (shiftId && data.id !== shiftId && doc.id !== shiftId) return;
            if (userId && data.userId !== userId) return;
            shift = data;
          });
        }
      } catch (error) {
        console.error('kas-core: gagal mengambil data shift', { date: date, userId: userId, shiftId: shiftId, error: error });
      }

      return {
        date: date,
        userId: userId || null,
        shiftId: shiftId || (shift && shift.id) || null,
        shift: shift,
        modalAwal: kas.modalAwal,
        kasMasuk: kas.summary.cashIn,
        kasKeluar: kas.summary.cashOut,
        penjualan: kas.summary.cashSales,
        topup: kas.summary.topup,
        topupAdmin: kas.summary.topupAdmin,
        tarik: kas.summary.withdrawal,
        tarikAdmin: kas.summary.withdrawalAdmin,
        topupKasFisik: kas.topupKasFisik,
        tarikKasFisik: kas.tarikKasFisik,
        uangGlobal: kas.total,
        summary: kas.summary
      };
    }

    /**
     * Kinerja staf per hari untuk tabel dashboard.
     * @param {{date:string}} options
     * @returns {Promise<{date:string, staff:Array<object>}>}
     */
    async function getStaffPerformanceToday(options) {
      const date = options && options.date;
      const db = getDb();
      const modalSummary = await getModalSummary({ date: date });
      const transactions = await getTransactionsByDateRange({ startDate: date, endDate: date });
      const usersMap = {};
      const staffMap = {};

      try {
        const usersSnapshot = await db.collection('users').get();
        usersSnapshot.forEach(function(doc) {
          usersMap[doc.id] = Object.assign({ id: doc.id }, doc.data());
        });
      } catch (error) {
        console.error('kas-core: gagal mengambil users untuk staff performance', { date: date, error: error });
      }

      modalSummary.entries.forEach(function(entry) {
        const userId = entry.userId || null;
        if (!userId) return;
        const userData = usersMap[userId] || {};
        if (!staffMap[userId]) {
          staffMap[userId] = {
            userId: userId,
            name: entry.userName || userData.name || userData.username || 'Staf',
            role: String((userData.role || 'kasir')).toLowerCase(),
            modal: 0,
            penjualan: 0,
            count: 0
          };
        }
        staffMap[userId].modal += normalizeNumber(entry.amount);
      });

      transactions.forEach(function(transaction) {
        if (!isValidTransaction(transaction) || transaction.type !== 'penjualan') return;
        const transactionUserId = getUserId(transaction);
        if (!transactionUserId) return;
        const userData = usersMap[transactionUserId] || {};
        if (!staffMap[transactionUserId]) {
          staffMap[transactionUserId] = {
            userId: transactionUserId,
            name:
              userData.name ||
              userData.username ||
              transaction.userName ||
              transaction.cashierName ||
              'Staf',
            role: String((userData.role || 'kasir')).toLowerCase(),
            modal: 0,
            penjualan: 0,
            count: 0
          };
        }
        staffMap[transactionUserId].penjualan += getAmount(transaction);
        if (transaction.source !== 'hutang_page') {
          staffMap[transactionUserId].count += 1;
        }
      });

      return {
        date: date,
        staff: Object.keys(staffMap).map(function(userId) {
          return staffMap[userId];
        })
      };
    }

    return {
      normalizeNumber: normalizeNumber,
      getAmount: getAmount,
      getPaymentAmount: getPaymentAmount,
      getPaymentMethod: getPaymentMethod,
      getUserId: getUserId,
      getTransactionDate: getTransactionDate,
      isValidTransaction: isValidTransaction,
      summarizeTransactions: createSummary,
      calculateKasFisikLaciFromSummary: calculateKasFisikLaciFromSummary,
      getTransactionsByDateRange: getTransactionsByDateRange,
      getModalSummary: getModalSummary,
      getDailySummary: getDailySummary,
      getPeriodSummary: getPeriodSummary,
      getKasFisikLaci: getKasFisikLaci,
      getShiftSummary: getShiftSummary,
      getStaffPerformanceToday: getStaffPerformanceToday
    };
  })();
}

var KasCore = window.KasCore;
