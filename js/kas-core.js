if (typeof window.KasCore === 'undefined') {
  window.KasCore = (function() {
    "use strict";

    // Akses Instans Firestore (Mendukung SDK v8 / v9 Compat)
    function getDb() {
      if (window.db && typeof window.db.collection === 'function') {
        return window.db;
      }
      if (window.firebase && window.firebase.firestore) {
        return window.firebase.firestore();
      }
      throw new Error('KasCore memerlukan firebase.firestore() yang sudah terinisialisasi.');
    }

    // Utility Normalisasi Angka
    function normalizeNumber(value) {
      if (typeof value === 'number' && !isNaN(value)) return value;
      if (typeof value === 'string') {
        const cleaned = value.replace(/[^\d.-]/g, '');
        const parsed = Number(cleaned);
        return isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    }

    // Utility Parsing Date & Timestamp
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
          console.error('KasCore: Gagal parse Firestore Timestamp', error);
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
      return (transaction && transaction.date_key) 
        || (transaction && transaction.date)
        || formatDateKey(transaction && (transaction.waktu || transaction.timestamp));
    }

    function getUserId(transaction) {
      return transaction
        ? (transaction.userId || transaction.cashierId || transaction.cashierID || null)
        : null;
    }

    function isValidTransaction(transaction) {
      const status = String((transaction && transaction.status) || '').toLowerCase();
      return status !== 'cancelled' && status !== 'voided';
    }

    function matchesTransactionFilters(transaction, filters) {
      if (!transaction) return false;
      if (filters.userId && getUserId(transaction) !== filters.userId) return false;
      if (filters.shiftId && transaction.shiftId !== filters.shiftId) return false;
      return true;
    }

    function buildDateRangeList(startDate, endDate) {
      const dates = [];
      const current = parseDateValue(startDate + 'T00:00:00');
      const last = parseDateValue(endDate + 'T00:00:00');
      if (!current || !last) return dates;
      while (current.getTime() <= last.getTime()) {
        dates.push(formatDateKey(current));
        current.setDate(current.getDate() + 1);
      }
      return dates;
    }

    /**
     * core: createSummary
     * Menerima array dokumen transaksi Firestore (Skema Baru 6-Field)
     * dan menghasilkan agregasi lengkap untuk Dashboard & Closing.
     */
    function createSummary(transactions) {
      const summary = {
        transactions: Array.isArray(transactions) ? transactions.slice() : [],
        validTransactions: [],
        
        // 1. Mutasi Baku Firestore Baru
        totalCashIn: 0,
        totalCashOut: 0,
        totalBankIn: 0,
        totalBankOut: 0,
        totalDigitalIn: 0,
        totalDigitalOut: 0,

        // 2. Akumulasi Laba Bersih & Counter
        totalProfit: 0,
        transactionCount: 0,

        // 3. Rincian Metode Pembayaran (UI Compatibility)
        paymentMethods: {
          tunai: 0,
          qris: 0,
          transfer: 0,
          utang: 0,
          lainnya: 0
        },

        // Backward compatibility (agar UI lama yang memanggil properti ini tidak error/undefined)
        salesProfit: 0,
        totalSales: 0,
        cashSales: 0,
        topup: 0,
        topupAdmin: 0,
        withdrawal: 0,
        withdrawalAdmin: 0,
        cashIn: 0,
        cashOut: 0
      };

      summary.transactions.forEach(function(tx) {
        if (!isValidTransaction(tx)) return;
        summary.validTransactions.push(tx);

        // Ambil nilai mutasi baku dari dokumen Firestore
        const cIn = normalizeNumber(tx.cash_in);
        const cOut = normalizeNumber(tx.cash_out);
        const bIn = normalizeNumber(tx.bank_in);
        const bOut = normalizeNumber(tx.bank_out);
        const dIn = normalizeNumber(tx.digital_in);
        const dOut = normalizeNumber(tx.digital_out);
        const labaTx = normalizeNumber(tx.laba);

        // Akumulasi Mutasi 6-Field
        summary.totalCashIn += cIn;
        summary.totalCashOut += cOut;
        summary.totalBankIn += bIn;
        summary.totalBankOut += bOut;
        summary.totalDigitalIn += dIn;
        summary.totalDigitalOut += dOut;

        // Akumulasi Laba Bersih
        summary.totalProfit += labaTx;
        summary.transactionCount += 1;

        // Akumulasi Metode Pembayaran
        const method = String(tx.metode_pembayaran || tx.paymentMethod || 'tunai').toLowerCase();
        if (method.includes('tunai') || method.includes('cash')) {
          summary.paymentMethods.tunai += (cIn > 0 ? cIn : (dOut > 0 ? dOut : 0));
        } else if (method.includes('qris')) {
          summary.paymentMethods.qris += bIn;
        } else if (method.includes('transfer') || method.includes('bank')) {
          summary.paymentMethods.transfer += bIn;
        } else if (method.includes('utang') || method.includes('hutang')) {
          summary.paymentMethods.utang += normalizeNumber(tx.nominal);
        } else {
          summary.paymentMethods.lainnya += (cIn + bIn);
        }

        // Mapping Backward Compatibility untuk UI Lama
        const kategori = tx.kategori || tx.type;
        if (kategori === 'top_up' || kategori === 'topup') {
          summary.topup += dOut;
          summary.topupAdmin += labaTx;
        } else if (kategori === 'tarik_tunai' || kategori === 'tarik') {
          summary.withdrawal += dIn;
          summary.withdrawalAdmin += labaTx;
        } else if (kategori === 'jual' || kategori === 'penjualan') {
          summary.totalSales += (cIn + bIn);
          summary.cashSales += cIn;
          summary.salesProfit += labaTx;
        }
      });

      // Saldo Hasil Hitungan (Net Balance)
      summary.saldoLaciSeharusnya = summary.totalCashIn - summary.totalCashOut;
      summary.saldoBankSeharusnya = summary.totalBankIn - summary.totalBankOut;
      summary.mutasiSaldoDigital = summary.totalDigitalIn - summary.totalDigitalOut;

      // Backward Compatibility Alias Properti
      summary.cashIn = summary.totalCashIn;
      summary.cashOut = summary.totalCashOut;
      summary.totalCashInDrawer = summary.totalCashIn;
      summary.totalCashOutDrawer = summary.totalCashOut;
      summary.netCashFlow = summary.saldoLaciSeharusnya;

      return summary;
    }

    /**
     * Hitung Posisi Kas Fisik Laci + Modal Awal Shift/Harian
     */
    function calculateKasFisikLaciFromSummary(modalAwal, summary) {
      const safeSummary = summary || createSummary([]);
      const normalizedModal = normalizeNumber(modalAwal);
      
      const totalKasFisikDiLaci = normalizedModal + safeSummary.saldoLaciSeharusnya;

      return {
        modalAwal: normalizedModal,
        cashIn: safeSummary.totalCashIn,
        cashOut: safeSummary.totalCashOut,
        saldoLaciSeharusnya: safeSummary.saldoLaciSeharusnya,
        totalKasFisikDiLaci: totalKasFisikDiLaci,
        // Backward compatibility
        topupKasFisik: safeSummary.topup,
        tarikKasFisik: safeSummary.withdrawal,
        total: totalKasFisikDiLaci
      };
    }

    // Load Transaksi Berdasarkan Rentang Tanggal dari Firestore
    async function loadTransactionsByRange(startDate, endDate) {
      const db = getDb();
      if (!startDate || !endDate) return [];

      try {
        let query = db.collection('transactions');
        if (startDate === endDate) {
          query = query.where('date_key', '==', startDate);
        } else {
          query = query.where('date_key', '>=', startDate).where('date_key', '<=', endDate);
        }

        const snapshot = await query.get();
        const transactions = [];
        snapshot.forEach(function(doc) {
          transactions.push(Object.assign({ id: doc.id }, doc.data()));
        });
        return transactions;
      } catch (error) {
        console.warn('KasCore: Query date_key gagal, mencoba fallback date', error);
        // Fallback jika ada dokumen lama yang menggunakan field 'date'
        try {
          let fallbackQuery = db.collection('transactions');
          if (startDate === endDate) {
            fallbackQuery = fallbackQuery.where('date', '==', startDate);
          } else {
            fallbackQuery = fallbackQuery.where('date', '>=', startDate).where('date', '<=', endDate);
          }
          const snapshot = await fallbackQuery.get();
          const transactions = [];
          snapshot.forEach(function(doc) {
            transactions.push(Object.assign({ id: doc.id }, doc.data()));
          });
          return transactions;
        } catch (err2) {
          console.error('KasCore: Fallback query gagal', err2);
          return [];
        }
      }
    }

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
          const timeA = parseDateValue(a.waktu || a.timestamp);
          const timeB = parseDateValue(b.waktu || b.timestamp);
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
        console.error('KasCore: Gagal membaca modal harian', error);
      }
      return null;
    }

    async function getModalSummary(options) {
      const date = options && options.date;
      const userId = options && options.userId;
      const db = getDb();

      if (!date) return { date: '', entries: [], total: 0 };

      if (userId) {
        const entry = await loadModalEntry(date, userId);
        const amount = normalizeNumber(entry && entry.amount);
        return { date: date, entries: entry ? [entry] : [], total: amount };
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
          total: entries.reduce((sum, e) => sum + normalizeNumber(e.amount), 0)
        };
      } catch (error) {
        console.error('KasCore: Gagal mengambil modal summary', error);
        return { date: date, entries: [], total: 0 };
      }
    }

    async function getDailySummary(options) {
      const date = options && options.date;
      return getPeriodSummary({
        startDate: date,
        endDate: date,
        userId: options && options.userId,
        shiftId: options && options.shiftId
      });
    }

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
        cashIn: summary.totalCashIn,
        cashOut: summary.totalCashOut,
        bankIn: summary.totalBankIn,
        bankOut: summary.totalBankOut,
        digitalIn: summary.totalDigitalIn,
        digitalOut: summary.totalDigitalOut,
        saldoLaciSeharusnya: summary.saldoLaciSeharusnya,
        saldoBankSeharusnya: summary.saldoBankSeharusnya,
        mutasiSaldoDigital: summary.mutasiSaldoDigital,
        totalKasFisikDiLaci: kasFisik.totalKasFisikDiLaci,
        totalLaba: summary.totalProfit,
        total: kasFisik.totalKasFisikDiLaci, // Alias untuk UI lama
        summary: summary
      };
    }

    async function getShiftSummary(options) {
      const date = options && options.date;
      const userId = options && options.userId;
      const shiftId = options && options.shiftId;
      
      const kas = await getKasFisikLaci({ date: date, userId: userId, shiftId: shiftId });
      
      return {
        date: date,
        userId: userId || null,
        shiftId: shiftId || null,
        modalAwal: kas.modalAwal,
        totalKasIn: kas.cashIn,
        totalKasOut: kas.cashOut,
        saldoLaciFisik: kas.totalKasFisikDiLaci,
        saldoBank: kas.saldoBankSeharusnya,
        mutasiDigital: kas.mutasiSaldoDigital,
        labaShift: kas.totalLaba,
        summary: kas.summary
      };
    }

    return {
      normalizeNumber: normalizeNumber,
      isValidTransaction: isValidTransaction,
      getTransactionDate: getTransactionDate,
      getUserId: getUserId,
      summarizeTransactions: createSummary,
      calculateKasFisikLaciFromSummary: calculateKasFisikLaciFromSummary,
      getTransactionsByDateRange: getTransactionsByDateRange,
      getModalSummary: getModalSummary,
      getDailySummary: getDailySummary,
      getPeriodSummary: getPeriodSummary,
      getKasFisikLaci: getKasFisikLaci,
      getShiftSummary: getShiftSummary
    };
  })();
}

var KasCore = window.KasCore;
