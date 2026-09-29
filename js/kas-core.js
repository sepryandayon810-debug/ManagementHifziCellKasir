/* ============================================================
 * KAS CORE — SINGLE SOURCE OF TRUTH (versi perbaikan)
 * ============================================================
 * 1. KAS GLOBAL / UANG LACI      5. HUTANG / PIUTANG
 * 2. TOTAL TRANSAKSI              6. SALDO BANK
 * 3. TOTAL PENJUALAN              7. SALDO DIGITAL
 * 4. LABA                         8. SHIFT / CLOSING
 *
 * ATURAN APPROVAL (sesuai tabel logika):
 * MODAL AWAL   : bukan transaksi, bukan penjualan, +kas, bukan laba
 * KAS MASUK    : bukan transaksi, bukan penjualan, +kas, bukan laba
 * KAS KELUAR   : bukan transaksi, bukan penjualan, -kas, bukan laba
 * JUAL TUNAI   : transaksi, penjualan, +kas laci, laba = jual-modal
 * JUAL QRIS/TR : transaksi, penjualan, +bank (bukan laci), laba = jual-modal
 * JUAL HUTANG  : transaksi, penjualan, kas tidak bergerak, laba dihitung, membuat hutang
 * BAYAR HUTANG : bukan transaksi, kas hanya jika dicentang, melunasi hutang
 * TOP UP TUNAI : transaksi, bukan penjualan, +kas (nominal+admin), laba = admin
 * TOP UP HUTANG: transaksi, bukan penjualan, kas tidak bergerak, laba = admin, hutang = nominal+admin
 * TARIK TUNAI  : transaksi, bukan penjualan, -kas (nominal-admin), laba = admin
 * PINJAMAN     : bukan transaksi, -kas, membuat hutang
 * PENGEMBALIAN : bukan transaksi, +kas jika dicentang, melunasi hutang
 * PEMBELIAN    : sesuai flag page, bukan penjualan, kas ikut checkbox
 * ============================================================ */

if (typeof window.KasCore === 'undefined') {

  window.KasCore = (function () {

    "use strict";

    /* ==========================================================
     * 0. SEMUA SAKLAR KEUANGAN — ubah aturan cukup DI SINI SAJA
     * ========================================================== */
    var KAS_CONFIG = {
      // Piutang pelanggan dihitung ke total laci?
      hitungPiutangKeTotalLaci: false,

      // Pembelian ikut mengurangi laci (mengikuti checkbox per transaksi)?
      pembelianKurangiLaci: true,

      // Pelunasan hutang yang dicentang masuk laci?
      pelunasanMasukLaci: true,

      // Admin top up ikut masuk laci? (true = pakai cash_in = nominal+admin)
      adminTopupMasukLaci: true,

      // Piutang dihitung mengikuti scope role (owner/admin lihat tim)?
      piutangIkutScopeRole: true
    };

    /* ==========================================================
     * 1. DATABASE
     * ========================================================== */

    function getDb() {
      if (window.db && typeof window.db.collection === 'function') {
        return window.db;
      }
      if (window.firebase && window.firebase.firestore) {
        return window.firebase.firestore();
      }
      throw new Error('KasCore memerlukan firebase.firestore() yang sudah diinisialisasi.');
    }

    /* ==========================================================
     * 2. NORMALISASI ANGKA
     * ========================================================== */

    function normalizeNumber(value) {
      if (typeof value === 'number' && !isNaN(value)) {
        return value;
      }
      if (typeof value === 'string') {
        var cleaned = value.replace(/[^\d.-]/g, '');
        var parsed = Number(cleaned);
        return isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    }

    /* ==========================================================
     * 3. NORMALISASI BOOLEAN
     * ========================================================== */

    function normalizeBoolean(value, defaultValue) {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') {
        var text = value.trim().toLowerCase();
        if (text === 'true' || text === '1' || text === 'yes' || text === 'ya' || text === 'on') return true;
        if (text === 'false' || text === '0' || text === 'no' || text === 'tidak' || text === 'off') return false;
      }
      return defaultValue;
    }

    /* ==========================================================
     * 4. DATE / TIMESTAMP
     * ========================================================== */

    function parseDateValue(value) {
      if (!value) return null;
      if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
      if (typeof value === 'number') {
        var numberDate = new Date(value);
        return isNaN(numberDate.getTime()) ? null : numberDate;
      }
      // Firestore Timestamp
      if (value && typeof value.toDate === 'function') {
        try { return value.toDate(); } catch (error) {
          console.error('KasCore: gagal parse Firestore Timestamp', error);
          return null;
        }
      }
      // Firestore Timestamp object lama
      if (value && typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000);
      }
      var date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }

    function formatDateKey(dateValue) {
      var date = parseDateValue(dateValue);
      if (!date) return '';
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
      ].join('-');
    }

    function getTransactionDate(transaction) {
      return (transaction && (
        transaction.date_key ||
        transaction.date ||
        formatDateKey(transaction.waktu || transaction.timestamp || transaction.createdAt)
      )) || '';
    }

    /* ==========================================================
     * 5. USER / SHIFT
     * ========================================================== */

    function getUserId(transaction) {
      if (!transaction) return null;
      return transaction.userId || transaction.cashierId || transaction.cashierID || transaction.uid || null;
    }

    function getShiftId(transaction) {
      return transaction ? (transaction.shiftId || transaction.shift_id || null) : null;
    }

    // Modal harian disimpan dengan id dokumen "YYYY-MM-DD_uid".
    // Fallback: ambil uid dari id dokumen jika field userId tidak ada.
    function getModalEntryUserId(entry) {
      if (!entry) return null;
      if (entry.userId) return entry.userId;
      var parts = String(entry.id || '').split('_');
      // "2026-09-28_abc123" -> date berisi 2 tanda "-", uid = bagian setelah tanda ke-3
      return parts.length >= 4 ? parts.slice(3).join('_') : (parts[1] || null);
    }

    /* ==========================================================
     * 6. KATEGORI
     * ========================================================== */

    function getCategory(transaction) {
      if (!transaction) return '';
      var raw = transaction.kategori || transaction.category || transaction.type || transaction.jenis || '';
      var category = String(raw).trim().toLowerCase();

      // Alias lama
      if (category === 'topup') return 'top_up';
      if (category === 'tarik') return 'tarik_tunai';
      if (category === 'penjualan') return 'jual';
      if (category === 'kas masuk') return 'kas_masuk';
      if (category === 'kas keluar') return 'kas_keluar';
      if (category === 'pinjam_uang') return 'pinjaman_tunai';
      if (category === 'pengembalian_pinjaman' || category === 'kembali_pinjaman' || category === 'pelunasan_pinjaman') return 'pengembalian_pinjaman';
      if (category === 'pembelian_barang') return 'pembelian';

      return category;
    }

    /* ==========================================================
     * 7. METODE PEMBAYARAN
     * ========================================================== */

    function getPaymentMethod(transaction) {
      if (!transaction) return '';
      var raw = transaction.metode_pembayaran || transaction.paymentMethod || transaction.metode || '';
      var method = String(raw).trim().toLowerCase();

      if (method === 'cash') return 'tunai';
      if (method === 'qris') return 'qris';
      if (method === 'bank') return 'transfer';
      if (method === 'hutang') return 'utang';

      return method;
    }

    /* ==========================================================
     * 8. STATUS TRANSAKSI
     * ========================================================== */

    function isValidTransaction(transaction) {
      if (!transaction) return false;
      var status = String(transaction.status || '').trim().toLowerCase();
      return (
        status !== 'cancelled' &&
        status !== 'canceled' &&
        status !== 'voided' &&
        status !== 'batal' &&
        status !== 'dibatalkan'
      );
    }

    /* ==========================================================
     * 9. CHECKBOX PENGARUHI KAS GLOBAL
     * ========================================================== */

    function getAffectsCashGlobal(transaction) {
      if (!transaction) return false;

      var possibleFields = [
        'pengaruhi_kas_global',
        'pengaruhiKasGlobal',
        'affects_cash_global',
        'affectsCashGlobal',
        'pengaruhi_uang_global',
        'pengaruhiUangGlobal',
        'kas_global',
        'masukKasGlobal'
      ];

      for (var i = 0; i < possibleFields.length; i++) {
        var field = possibleFields[i];
        if (Object.prototype.hasOwnProperty.call(transaction, field)) {
          return normalizeBoolean(transaction[field], false);
        }
      }

      // Default berdasarkan approval
      var category = getCategory(transaction);
      var method = getPaymentMethod(transaction);

      switch (category) {
        case 'modal_awal': return true;
        case 'kas_masuk': return true;
        case 'kas_keluar': return true;
        case 'jual': return method === 'tunai';      // tunai masuk laci, QRIS/transfer ke bank, hutang belum ada uang
        case 'top_up': return method === 'tunai';
        case 'tarik_tunai': return method === 'tunai';
        case 'pinjaman_tunai': return true;
        case 'pengembalian_pinjaman': return true;
        case 'bayar_hutang': return false;           // uang hanya masuk kas jika dicentang
        case 'pembelian': return false;              // mengikuti checkbox, jangan otomatis
        default: return false;
      }
    }

    /* ==========================================================
     * 10. APAKAH MASUK TOTAL TRANSAKSI?
     * ========================================================== */

    function isIncludedInTransactions(transaction) {
      if (!transaction) return false;

      var explicitFields = [
        'masuk_transaksi',
        'masukTransaksi',
        'is_transaction',
        'isTransaction',
        'affects_transaction',
        'affectsTransaction'
      ];

      for (var i = 0; i < explicitFields.length; i++) {
        var field = explicitFields[i];
        if (Object.prototype.hasOwnProperty.call(transaction, field)) {
          return normalizeBoolean(transaction[field], false);
        }
      }

      var category = getCategory(transaction);

      switch (category) {
        case 'jual': return true;
        case 'top_up': return true;
        case 'tarik_tunai': return true;
        case 'pembelian': return false;  // mengikuti flag page; tanpa flag tidak dihitung
        // Semua berikut bukan transaksi bisnis
        case 'modal_awal':
        case 'kas_masuk':
        case 'kas_keluar':
        case 'bayar_hutang':
        case 'pinjaman_tunai':
        case 'pengembalian_pinjaman':
          return false;
        default:
          return false;
      }
    }

    /* ==========================================================
     * 11. APAKAH MASUK PENJUALAN?
     * ========================================================== */

    function isSaleTransaction(transaction) {
      return getCategory(transaction) === 'jual';
    }

    /* ==========================================================
     * 12. NILAI TRANSAKSI
     * ========================================================== */

    function getNominal(transaction) {
      if (!transaction) return 0;
      return normalizeNumber(
        transaction.nominal ??
        transaction.total ??
        transaction.harga_jual ??
        transaction.hargaJual ??
        transaction.amount ??
        transaction.nilai ?? 0
      );
    }

    function getModalProduk(transaction) {
      if (!transaction) return 0;
      return normalizeNumber(
        transaction.modal_produk ??
        transaction.modalProduk ??
        transaction.modal ??
        transaction.harga_modal ??
        transaction.hargaModal ?? 0
      );
    }

    // FIX: field yang ditulis mapper bernama "admin" — sebelumnya tidak terbaca,
    // sehingga laba top up/tarik dan hutang top up selalu 0.
    function getAdmin(transaction) {
      if (!transaction) return 0;
      return normalizeNumber(
        transaction.admin ??
        transaction.adminFee ??
        transaction.biaya_admin ??
        transaction.fee ?? 0
      );
    }

    function getSaleAmount(transaction) {
      return getNominal(transaction);
    }

    /* ==========================================================
     * 13. HITUNG LABA TRANSAKSI
     * ========================================================== */

    function calculateTransactionProfit(transaction) {
      if (!transaction) return 0;

      var category = getCategory(transaction);

      // Jika page sudah menyimpan laba final, gunakan itu (kompatibilitas data lama)
      if (transaction.laba !== undefined && transaction.laba !== null && transaction.laba !== '') {
        return normalizeNumber(transaction.laba);
      }

      var nominal = getNominal(transaction);
      var modal = getModalProduk(transaction);
      var admin = getAdmin(transaction);

      switch (category) {
        case 'jual': return nominal - modal;  // termasuk penjualan hutang (sesuai tabel: laba tetap dihitung)
        case 'top_up': return admin;          // sesuai tabel: laba admin, dihitung saat transaksi
        case 'tarik_tunai': return admin;
        case 'pembelian': return 0;
        default: return 0;
      }
    }

    /* ==========================================================
     * 14. MAPPER MUTASI
     * ========================================================== */

    function mapTransactionMutation(payload) {
      payload = payload || {};

      var category = getCategory(payload);
      var method = getPaymentMethod(payload);
      // FIX: pakai getter yang sama dengan sisi pembaca agar field total/harga_jual dll. ikut dikenali
      var nominal = getNominal(payload);
      var admin = getAdmin(payload);
      var modalProduk = getModalProduk(payload);
      var affectsCashGlobal = getAffectsCashGlobal(payload);

      var result = {
        kategori: category,
        metode_pembayaran: method,
        nominal: nominal,
        admin: admin,
        modal_produk: modalProduk,
        cash_in: 0,
        cash_out: 0,
        bank_in: 0,
        bank_out: 0,
        digital_in: 0,
        digital_out: 0,
        laba: 0,
        masuk_transaksi: isIncludedInTransactions(payload),
        masuk_penjualan: isSaleTransaction(payload),
        pengaruhi_kas_global: affectsCashGlobal
      };

      switch (category) {

        /* MODAL AWAL — idealnya disimpan lewat saveModalAwal / collection "modal" */
        case 'modal_awal':
          result.cash_in = nominal;
          result.masuk_transaksi = false;
          result.masuk_penjualan = false;
          result.laba = 0;
          break;

        /* KAS MASUK */
        case 'kas_masuk':
          result.cash_in = nominal;
          result.masuk_transaksi = false;
          result.masuk_penjualan = false;
          result.laba = 0;
          break;

        /* KAS KELUAR */
        case 'kas_keluar':
          result.cash_out = nominal;
          result.masuk_transaksi = false;
          result.masuk_penjualan = false;
          result.laba = 0;
          break;

        /* JUAL — tunai ke laci, QRIS/transfer ke bank, hutang belum ada uang */
        case 'jual':
          if (modalProduk > 0) {
            result.digital_out = modalProduk;  // modal produk keluar dari saldo digital
          }
          if (method === 'tunai') {
            result.cash_in = nominal;
          } else if (method === 'qris' || method === 'transfer') {
            result.bank_in = nominal;
          } else if (method === 'utang') {
            result.cash_in = 0;
            result.bank_in = 0;
            var dibayar = normalizeNumber(payload.bayar_sekarang || 0);
            if (dibayar > 0) {
              if (payload.metode_bayar_sekarang === 'qris' || payload.metode_bayar_sekarang === 'transfer') {
                result.bank_in = dibayar;
              } else {
                result.cash_in = dibayar;
              }
            }
          }
          result.masuk_transaksi = true;
          result.masuk_penjualan = true;
          result.laba = nominal - modalProduk;
          break;

        /* TOP UP — tunai masuk laci nominal+admin, hutang belum ada uang */
        case 'top_up':
          result.digital_out = nominal;  // saldo agen/digital berkurang
          if (method === 'tunai') {
            result.cash_in = nominal + admin;
          } else if (method === 'qris' || method === 'transfer') {
            result.bank_in = nominal + admin;
          } else if (method === 'utang') {
            result.cash_in = 0;
            result.bank_in = 0;
          }
          result.masuk_transaksi = true;
          result.masuk_penjualan = false;
          result.laba = admin;
          break;

        /* TARIK TUNAI — kas berkurang nominal - admin */
        case 'tarik_tunai':
          result.digital_in = nominal;
          if (method === 'tunai') {
            result.cash_out = Math.max(0, nominal - admin);
          } else if (method === 'transfer') {
            result.bank_out = Math.max(0, nominal - admin);
          }
          result.masuk_transaksi = true;
          result.masuk_penjualan = false;
          result.laba = admin;
          break;

        /* BAYAR HUTANG — kas hanya jika dicentang */
        case 'bayar_hutang':
          if (affectsCashGlobal) {
            if (method === 'tunai') {
              result.cash_in = nominal;
            } else if (method === 'qris' || method === 'transfer') {
              result.bank_in = nominal;
            }
          }
          result.masuk_transaksi = false;
          result.masuk_penjualan = false;
          result.laba = 0;
          break;

        /* PINJAMAN UANG */
        case 'pinjaman_tunai':
          result.cash_out = nominal;
          result.masuk_transaksi = false;
          result.masuk_penjualan = false;
          result.laba = 0;
          break;

        /* PENGEMBALIAN PINJAMAN — kas masuk jika dicentang (aturan approval) */
        case 'pengembalian_pinjaman':
          if (affectsCashGlobal) {
            if (method === 'tunai' || !method) {
              result.cash_in = nominal;
            } else if (method === 'qris' || method === 'transfer') {
              result.bank_in = nominal;
            }
          }
          result.masuk_transaksi = false;
          result.masuk_penjualan = false;
          result.laba = 0;
          break;

        /* PEMBELIAN */
        case 'pembelian':
          if (affectsCashGlobal) {
            if (method === 'tunai') {
              result.cash_out = nominal;
            } else if (method === 'qris' || method === 'transfer') {
              result.bank_out = nominal;
            }
          }
          result.masuk_penjualan = false;
          result.masuk_transaksi = isIncludedInTransactions(payload);
          result.laba = normalizeNumber(payload.laba || 0);
          break;

        /* DEFAULT */
        default:
          result.masuk_transaksi = false;
          result.masuk_penjualan = false;
          result.laba = normalizeNumber(payload.laba || 0);
          break;
      }

      return result;
    }

    /* ==========================================================
     * 15. CLASSIFICATION TRANSAKSI
     * ========================================================== */

    function classifyTransaction(transaction) {
      var category = getCategory(transaction);
      var method = getPaymentMethod(transaction);

      var classification = {
        category: category,
        paymentMethod: method,
        isTransaction: isIncludedInTransactions(transaction),
        isSale: isSaleTransaction(transaction),
        affectsCashGlobal: getAffectsCashGlobal(transaction),
        affectsProfit: false,
        affectsDebt: false,
        isDebtSettlement: false,
        isCashFlow: false,
        isOperational: false,
        isFinancialDebt: false,
        isPurchase: false,
        isTopUp: category === 'top_up',
        isWithdrawal: category === 'tarik_tunai'
      };

      switch (category) {
        case 'modal_awal': classification.isCashFlow = true; break;
        case 'kas_masuk': classification.isCashFlow = true; break;
        case 'kas_keluar':
          classification.isCashFlow = true;
          classification.isOperational = true;
          break;
        case 'jual':
          classification.affectsProfit = true;
          classification.affectsDebt = method === 'utang';
          break;
        case 'top_up':
          classification.affectsProfit = true;
          classification.affectsDebt = method === 'utang';
          break;
        case 'tarik_tunai': classification.affectsProfit = true; break;
        case 'bayar_hutang':
          classification.affectsDebt = true;
          classification.isDebtSettlement = true;
          break;
        case 'pinjaman_tunai':
          classification.affectsDebt = true;
          classification.isFinancialDebt = true;
          break;
        case 'pengembalian_pinjaman':
          classification.affectsDebt = true;
          classification.isDebtSettlement = true;
          classification.isFinancialDebt = true;
          break;
        case 'pembelian': classification.isPurchase = true; break;
      }

      return classification;
    }

    /* ==========================================================
     * 16. MATCH FILTER
     * ========================================================== */

    function matchesTransactionFilters(transaction, filters) {
      if (!transaction) return false;
      filters = filters || {};

      if (filters.userId && getUserId(transaction) !== filters.userId) return false;
      if (filters.shiftId && getShiftId(transaction) !== filters.shiftId) return false;
      if (filters.category && getCategory(transaction) !== String(filters.category).toLowerCase()) return false;
      if (filters.paymentMethod && getPaymentMethod(transaction) !== String(filters.paymentMethod).toLowerCase()) return false;

      return true;
    }

    /* ==========================================================
     * 16b. DATA LAMA TANPA FIELD MUTASI
     * Transaksi lama yang belum punya field mutasi kas/bank/digital
     * dihitung ulang lewat mapper (aturan tabel tetap berlaku).
     * ========================================================== */

    var MUTATION_FIELDS = ['cash_in', 'cash_out', 'bank_in', 'bank_out', 'digital_in', 'digital_out'];

    function hasStoredMutations(transaction) {
      if (!transaction) return false;
      for (var i = 0; i < MUTATION_FIELDS.length; i++) {
        if (Object.prototype.hasOwnProperty.call(transaction, MUTATION_FIELDS[i])) return true;
      }
      return false;
    }

    /* ==========================================================
     * 17. CREATE SUMMARY
     * ========================================================== */

    function createSummary(transactions) {
      var list = Array.isArray(transactions) ? transactions.slice() : [];

      var summary = {
        transactions: list,
        validTransactions: [],

        // KAS GLOBAL
        cashGlobalIn: 0,
        cashGlobalOut: 0,
        saldoKasGlobal: 0,

        // BANK
        totalBankIn: 0,
        totalBankOut: 0,
        saldoBank: 0,

        // DIGITAL
        totalDigitalIn: 0,
        totalDigitalOut: 0,
        saldoDigital: 0,

        // TRANSAKSI
        transactionCount: 0,

        // PENJUALAN
        salesCount: 0,
        totalSales: 0,
        salesCash: 0,
        salesQris: 0,
        salesTransfer: 0,
        salesCredit: 0,

        // LABA
        totalProfit: 0,
        salesProfit: 0,
        topupProfit: 0,
        withdrawalProfit: 0,
        purchaseProfit: 0,

        // PAYMENT METHODS
        paymentMethods: { tunai: 0, qris: 0, transfer: 0, utang: 0, lainnya: 0 },

        // TOP UP
        topup: 0,
        topupAdmin: 0,

        // TARIK
        withdrawal: 0,
        withdrawalAdmin: 0,

        // HUTANG
        debtCreated: 0,
        debtSettled: 0,

        // KAS FLOW (kas masuk/keluar non-penjualan non-topup/tarik)
        cashFlowIn: 0,
        cashFlowOut: 0,
        operationalCashOut: 0,

        // BACKWARD COMPATIBILITY
        cashIn: 0,
        cashOut: 0,
        totalCashIn: 0,
        totalCashOut: 0,
        totalCashInDrawer: 0,
        totalCashOutDrawer: 0,
        netCashFlow: 0,
        cashSales: 0
      };

      list.forEach(function (tx) {
        if (!isValidTransaction(tx)) return;

        summary.validTransactions.push(tx);

        var classification = classifyTransaction(tx);
        var category = classification.category;
        var method = classification.paymentMethod;

        // MUTASI BAKU — dari database, atau dihitung mapper untuk data lama
        var mut = hasStoredMutations(tx) ? tx : mapTransactionMutation(tx);
        var cashIn = normalizeNumber(mut.cash_in);
        var cashOut = normalizeNumber(mut.cash_out);
        var bankIn = normalizeNumber(mut.bank_in);
        var bankOut = normalizeNumber(mut.bank_out);
        var digitalIn = normalizeNumber(mut.digital_in);
        var digitalOut = normalizeNumber(mut.digital_out);

        // KAS GLOBAL
        summary.cashGlobalIn += cashIn;
        summary.cashGlobalOut += cashOut;

        // BANK
        summary.totalBankIn += bankIn;
        summary.totalBankOut += bankOut;

        // DIGITAL
        summary.totalDigitalIn += digitalIn;
        summary.totalDigitalOut += digitalOut;

        // TOTAL TRANSAKSI
        if (classification.isTransaction) {
          summary.transactionCount++;
        }

        // PENJUALAN
        if (classification.isSale) {
          var saleAmount = getSaleAmount(tx);
          summary.salesCount++;
          summary.totalSales += saleAmount;

          if (method === 'tunai') summary.salesCash += saleAmount;
          else if (method === 'qris') summary.salesQris += saleAmount;
          else if (method === 'transfer') summary.salesTransfer += saleAmount;
          else if (method === 'utang') summary.salesCredit += saleAmount;

          var salesProfit = calculateTransactionProfit(tx);
          summary.salesProfit += salesProfit;
          summary.totalProfit += salesProfit;
        }

        // TOP UP
        if (category === 'top_up') {
          var topupNominal = getNominal(tx);
          summary.topup += topupNominal;
          var topupProfit = calculateTransactionProfit(tx);
          summary.topupAdmin += topupProfit;
          summary.topupProfit += topupProfit;
          summary.totalProfit += topupProfit;
        }

        // TARIK TUNAI
        if (category === 'tarik_tunai') {
          var withdrawalNominal = getNominal(tx);
          var withdrawalAdmin = getAdmin(tx);
          summary.withdrawal += withdrawalNominal;
          summary.withdrawalAdmin += withdrawalAdmin;
          summary.withdrawalProfit += withdrawalAdmin;
          summary.totalProfit += withdrawalAdmin;
        }

        // HUTANG
        if (classification.affectsDebt) {
          // hutang baru
          if (
            category === 'pinjaman_tunai' ||
            (category === 'jual' && method === 'utang') ||
            (category === 'top_up' && method === 'utang')
          ) {
            summary.debtCreated += getNominal(tx) + (category === 'top_up' ? getAdmin(tx) : 0);
          }
          // pelunasan
          if (classification.isDebtSettlement) {
            summary.debtSettled += getNominal(tx);
          }
        }

        // PAYMENT METHODS — hanya transaksi
        if (classification.isTransaction) {
          if (method === 'tunai') summary.paymentMethods.tunai += getNominal(tx);
          else if (method === 'qris') summary.paymentMethods.qris += getNominal(tx);
          else if (method === 'transfer') summary.paymentMethods.transfer += getNominal(tx);
          else if (method === 'utang') summary.paymentMethods.utang += getNominal(tx);
          else summary.paymentMethods.lainnya += getNominal(tx);
        }

        // CASH FLOW (uang masuk/keluar LAIN — non penjualan/topup/tarik)
        if (category === 'kas_masuk' || category === 'modal_awal' || category === 'pengembalian_pinjaman') {
          summary.cashFlowIn += cashIn;
        }
        if (category === 'kas_keluar' || category === 'pinjaman_tunai') {
          summary.cashFlowOut += cashOut;
        }
        if (category === 'kas_keluar') {
          summary.operationalCashOut += cashOut;
        }

        // PEMBELIAN
        if (category === 'pembelian') {
          var purchaseProfit = calculateTransactionProfit(tx);
          summary.purchaseProfit += purchaseProfit;
          summary.totalProfit += purchaseProfit;
        }
      });

      // HASIL AKHIR
      summary.saldoKasGlobal = summary.cashGlobalIn - summary.cashGlobalOut;
      summary.saldoBank = summary.totalBankIn - summary.totalBankOut;
      summary.saldoDigital = summary.totalDigitalIn - summary.totalDigitalOut;

      // ALIAS BACKWARD COMPATIBILITY
      summary.cashIn = summary.cashGlobalIn;
      summary.cashOut = summary.cashGlobalOut;
      summary.totalCashIn = summary.cashGlobalIn;
      summary.totalCashOut = summary.cashGlobalOut;
      summary.totalCashInDrawer = summary.cashGlobalIn;
      summary.totalCashOutDrawer = summary.cashGlobalOut;
      summary.netCashFlow = summary.saldoKasGlobal;
      summary.cashSales = summary.salesCash;

      // ALIAS UI
      summary.saldoLaciSeharusnya = summary.saldoKasGlobal;
      summary.saldoBankSeharusnya = summary.saldoBank;
      summary.mutasiSaldoDigital = summary.saldoDigital;

      return summary;
    }

    /* ==========================================================
     * 18. DATE RANGE
     * ========================================================== */

    function buildDateRangeList(startDate, endDate) {
      var dates = [];
      var current = parseDateValue(startDate + 'T00:00:00');
      var last = parseDateValue(endDate + 'T00:00:00');

      if (!current || !last) return dates;

      while (current.getTime() <= last.getTime()) {
        dates.push(formatDateKey(current));
        current.setDate(current.getDate() + 1);
      }

      return dates;
    }

    /* ==========================================================
     * 19. LOAD TRANSACTIONS
     * FIX: fallback ke field "date" juga saat query date_key
     *      SUKSES tapi hasilnya kosong (data lama tanpa date_key).
     * ========================================================== */

    function snapshotToArray(snapshot) {
      var transactions = [];
      snapshot.forEach(function (doc) {
        transactions.push(Object.assign({ id: doc.id }, doc.data()));
      });
      return transactions;
    }

    async function queryByField(db, field, startDate, endDate) {
      var query = db.collection('transactions');

      if (startDate === endDate) {
        query = query.where(field, '==', startDate);
      } else {
        query = query
          .where(field, '>=', startDate)
          .where(field, '<=', endDate);
      }

      var snapshot = await query.get();
      return snapshotToArray(snapshot);
    }

    async function loadTransactionsByRange(startDate, endDate) {
      var db = getDb();

      if (!startDate || !endDate) return [];

      // PRIMARY: date_key
      try {
        var transactions = await queryByField(db, 'date_key', startDate, endDate);
        if (transactions.length > 0) return transactions;
      } catch (error) {
        console.warn('KasCore: query date_key gagal, mencoba field date.', error);
      }

      // FALLBACK DATA LAMA: field date
      try {
        return await queryByField(db, 'date', startDate, endDate);
      } catch (fallbackError) {
        console.error('KasCore: fallback query gagal.', fallbackError);
        return [];
      }
    }

    /* ==========================================================
     * 20. GET TRANSACTIONS BY RANGE
     * ========================================================== */

    async function getTransactionsByDateRange(options) {
      options = options || {};

      var startDate = options.startDate;
      var endDate = options.endDate;

      var transactions = await loadTransactionsByRange(startDate, endDate);

      return transactions
        .filter(function (transaction) {
          return matchesTransactionFilters(transaction, {
            userId: options.userId,
            shiftId: options.shiftId,
            category: options.category,
            paymentMethod: options.paymentMethod
          });
        })
        .sort(function (a, b) {
          var timeA = parseDateValue(a.waktu || a.timestamp || a.createdAt);
          var timeB = parseDateValue(b.waktu || b.timestamp || b.createdAt);
          return (timeB ? timeB.getTime() : 0) - (timeA ? timeA.getTime() : 0);
        });
    }

    /* ==========================================================
     * 21. MODAL
     * ========================================================== */

    async function loadModalEntry(date, userId) {
      var db = getDb();

      if (!userId) return null;

      try {
        var directDoc = await db.collection('modal').doc(date + '_' + userId).get();
        if (directDoc.exists) {
          return Object.assign({ id: directDoc.id }, directDoc.data());
        }
      } catch (error) {
        console.error('KasCore: gagal membaca modal harian.', error);
      }

      return null;
    }

    async function getModalSummary(options) {
      options = options || {};

      var date = options.date;
      var userId = options.userId;
      var db = getDb();

      if (!date) {
        return { date: '', entries: [], total: 0 };
      }

      // USER SPESIFIK
      if (userId) {
        var entry = await loadModalEntry(date, userId);
        var amount = normalizeNumber(entry && entry.amount);
        return {
          date: date,
          entries: entry ? [entry] : [],
          total: amount
        };
      }

      // SEMUA USER
      try {
        var snapshot = await db.collection('modal').where('date', '==', date).get();
        var entries = snapshotToArray(snapshot);
        return {
          date: date,
          entries: entries,
          total: entries.reduce(function (sum, entry) {
            return sum + normalizeNumber(entry.amount);
          }, 0)
        };
      } catch (error) {
        console.error('KasCore: gagal mengambil modal summary.', error);
        return { date: date, entries: [], total: 0 };
      }
    }

    // Simpan modal awal lewat satu pintu (collection "modal").
    async function saveModalAwal(options) {
      options = options || {};
      var db = getDb();

      var date = options.date || formatDateKey(new Date());
      var userId = options.userId;
      var amount = normalizeNumber(options.amount);

      if (!userId) throw new Error('KasCore.saveModalAwal: userId wajib diisi.');

      var docId = date + '_' + userId;
      await db.collection('modal').doc(docId).set({
        date: date,
        userId: userId,
        amount: amount,
        shiftId: options.shiftId || null,
        updated_at: Date.now()
      }, { merge: true });

      return { id: docId, date: date, userId: userId, amount: amount };
    }

    /* ==========================================================
     * 22. DAILY SUMMARY
     * ========================================================== */

    async function getDailySummary(options) {
      options = options || {};
      return getPeriodSummary({
        startDate: options.date,
        endDate: options.date,
        userId: options.userId,
        shiftId: options.shiftId
      });
    }

    /* ==========================================================
     * 23. PERIOD SUMMARY
     * ========================================================== */

    async function getPeriodSummary(options) {
      options = options || {};

      var startDate = options.startDate;
      var endDate = options.endDate;

      var transactions = await getTransactionsByDateRange({
        startDate: startDate,
        endDate: endDate,
        userId: options.userId,
        shiftId: options.shiftId,
        category: options.category,
        paymentMethod: options.paymentMethod
      });

      var summary = createSummary(transactions);
      summary.startDate = startDate;
      summary.endDate = endDate;
      summary.userId = options.userId || null;
      summary.shiftId = options.shiftId || null;

      return summary;
    }

    /* ==========================================================
     * 23b. ANTI DOBEL MODAL
     * Sumber modal adalah collection "modal". Jika modal harian sudah
     * tercatat di sana, transaksi kategori modal_awal TIDAK dihitung
     * lagi di laci. Jika belum ada (data lama), modal diambil dari
     * transaksi modal_awal supaya tidak hilang.
     * ========================================================== */

    function applyModalAntiDouble(transactions, modalFromCollection) {
      var modalAwal = normalizeNumber(modalFromCollection);
      var list = transactions.slice();

      if (modalAwal > 0) {
        // Modal sudah tercatat di collection "modal" — buang duplikat dari transaksi
        list = list.filter(function (tx) {
          return getCategory(tx) !== 'modal_awal';
        });
      } else {
        // Data lama: modal hanya ada sebagai transaksi modal_awal
        modalAwal = list
          .filter(function (tx) { return getCategory(tx) === 'modal_awal'; })
          .reduce(function (sum, tx) {
            return sum + normalizeNumber(tx.cash_in != null ? tx.cash_in : getNominal(tx));
          }, 0);
      }

      return { transactions: list, modalAwal: modalAwal };
    }

    /* ==========================================================
     * 24. KAS FISIK LACI
     * ========================================================== */

    function calculateKasFisikLaciFromSummary(modalAwal, summary) {
      var safeSummary = summary || createSummary([]);
      var normalizedModal = normalizeNumber(modalAwal);

      // Modal awal + seluruh mutasi kas global
      var totalKasFisikDiLaci = normalizedModal + safeSummary.saldoKasGlobal;

      return {
        modalAwal: normalizedModal,
        cashIn: safeSummary.cashGlobalIn,
        cashOut: safeSummary.cashGlobalOut,
        saldoLaciSeharusnya: safeSummary.saldoKasGlobal,
        totalKasFisikDiLaci: totalKasFisikDiLaci,

        // Backward compatibility
        topupKasFisik: safeSummary.topup,
        tarikKasFisik: safeSummary.withdrawal,
        total: totalKasFisikDiLaci
      };
    }

    /* ==========================================================
     * 25. GET KAS FISIK LACI
     * ========================================================== */

    async function getKasFisikLaci(options) {
      options = options || {};

      var date = options.date;
      var userId = options.userId;
      var shiftId = options.shiftId;

      var modalSummary = await getModalSummary({ date: date, userId: userId });
      var transactions = await getTransactionsByDateRange({
        startDate: date,
        endDate: date,
        userId: userId,
        shiftId: shiftId
      });

      // FIX: cegah modal terhitung dua kali (collection "modal" + transaksi modal_awal)
      var guarded = applyModalAntiDouble(transactions, modalSummary.total);
      var summary = createSummary(guarded.transactions);
      var kasFisik = calculateKasFisikLaciFromSummary(guarded.modalAwal, summary);

      return {
        date: date,
        userId: userId || null,
        shiftId: shiftId || null,
        modalAwal: kasFisik.modalAwal,
        cashIn: summary.cashGlobalIn,
        cashOut: summary.cashGlobalOut,
        bankIn: summary.totalBankIn,
        bankOut: summary.totalBankOut,
        digitalIn: summary.totalDigitalIn,
        digitalOut: summary.totalDigitalOut,
        saldoKasGlobal: summary.saldoKasGlobal,
        saldoLaciSeharusnya: summary.saldoKasGlobal,
        saldoBank: summary.saldoBank,
        saldoBankSeharusnya: summary.saldoBank,
        mutasiSaldoDigital: summary.saldoDigital,
        totalKasFisikDiLaci: kasFisik.totalKasFisikDiLaci,
        totalLaba: summary.totalProfit,
        totalPenjualan: summary.totalSales,
        totalTransaksi: summary.transactionCount,
        total: kasFisik.totalKasFisikDiLaci,
        summary: summary
      };
    }

    /* ==========================================================
     * 26. SHIFT SUMMARY
     * ========================================================== */

    async function getShiftSummary(options) {
      options = options || {};

      var kas = await getKasFisikLaci({
        date: options.date,
        userId: options.userId,
        shiftId: options.shiftId
      });

      return {
        date: options.date,
        userId: options.userId || null,
        shiftId: options.shiftId || null,
        modalAwal: kas.modalAwal,
        totalKasIn: kas.cashIn,
        totalKasOut: kas.cashOut,
        saldoKasGlobal: kas.saldoKasGlobal,
        saldoLaciFisik: kas.totalKasFisikDiLaci,
        saldoBank: kas.saldoBank,
        mutasiDigital: kas.mutasiSaldoDigital,
        totalPenjualan: kas.totalPenjualan,
        totalTransaksi: kas.totalTransaksi,
        labaShift: kas.totalLaba,
        summary: kas.summary
      };
    }

    /* ==========================================================
     * 27. SALES SUMMARY — page kasir tidak menghitung sendiri
     * ========================================================== */

    function getSalesSummary(transactions) {
      var summary = createSummary(transactions);
      return {
        totalSales: summary.totalSales,
        salesCount: summary.salesCount,
        salesCash: summary.salesCash,
        salesQris: summary.salesQris,
        salesTransfer: summary.salesTransfer,
        salesCredit: summary.salesCredit,
        salesProfit: summary.salesProfit,
        paymentMethods: summary.paymentMethods
      };
    }

    /* ==========================================================
     * 28. PROFIT SUMMARY
     * ========================================================== */

    function getProfitSummary(transactions) {
      var summary = createSummary(transactions);
      return {
        totalProfit: summary.totalProfit,
        salesProfit: summary.salesProfit,
        topupProfit: summary.topupProfit,
        withdrawalProfit: summary.withdrawalProfit,
        purchaseProfit: summary.purchaseProfit
      };
    }

    /* ==========================================================
     * 29. CASH GLOBAL SUMMARY
     * ========================================================== */

    function getCashGlobalSummary(transactions, modalAwal) {
      var summary = createSummary(transactions);
      var modal = normalizeNumber(modalAwal);
      return {
        modalAwal: modal,
        cashIn: summary.cashGlobalIn,
        cashOut: summary.cashGlobalOut,
        mutasiKas: summary.saldoKasGlobal,
        saldoKasGlobal: modal + summary.saldoKasGlobal,
        cashGlobalIn: summary.cashGlobalIn,
        cashGlobalOut: summary.cashGlobalOut
      };
    }

    /* ==========================================================
     * 30. KAS LACI DISPLAY
     *
     * SATU PINTU UNTUK SEMUA PAGE (baca).
     * Page TIDAK BOLEH menghitung apa pun lagi —
     * cukup panggil fungsi ini dan tempel angkanya.
     *
     * options:
     *   date   : 'YYYY-MM-DD' (wajib)
     *   userId : uid user yang login (wajib)
     *   scope  : 'own'  = laci milik sendiri (default)
     *            'role' = ikut scope role seperti Dashboard
     * ========================================================== */

    async function getKasLaciDisplay(options) {
      options = options || {};
      var date = options.date;
      var currentUserId = options.userId;
      var scope = options.scope || 'own';
      var db = getDb();

      // ---------- ROLE USER LOGIN ----------
      var role = 'kasir';
      try {
        var userDoc = await db.collection('users').doc(currentUserId).get();
        if (userDoc.exists) role = String(userDoc.data().role || 'kasir').toLowerCase();
      } catch (e) {}

      var isBoss = role === 'owner' || role === 'developer';
      var isAdmin = role === 'admin';
      var useTeamScope = scope === 'role' && (isBoss || isAdmin);

      var usersMap = {};
      if (useTeamScope) {
        try {
          var usersSnap = await db.collection('users').get();
          usersSnap.forEach(function (d) { usersMap[d.id] = d.data(); });
        } catch (e) {}
      }

      function roleOf(uid) {
        return String((usersMap[uid] && usersMap[uid].role) || 'kasir').toLowerCase();
      }

      function inScope(uid) {
        if (!useTeamScope) return uid === currentUserId;
        if (isBoss) return true;
        return roleOf(uid) === 'kasir' || uid === currentUserId;
      }

      var userIdFilter = useTeamScope ? null : currentUserId;

      // ---------- AMBIL SEMUA DATA SEKALI ----------
      var debtsPromise;
      try {
        debtsPromise = db.collection('debts').get();
      } catch (e) {
        debtsPromise = Promise.resolve({ forEach: function () {} });
      }

      var results = await Promise.all([
        getModalSummary({ date: date, userId: userIdFilter }),
        getTransactionsByDateRange({ startDate: date, endDate: date, userId: userIdFilter }),
        debtsPromise
      ]);

      var modalEntries = (results[0] && results[0].entries) || [];
      var transactions = results[1];
      var debtsSnapshot = results[2];

      // ---------- FILTER SCOPE ----------
      // FIX: userId modal diambil juga dari id dokumen "date_uid"
      modalEntries = modalEntries.filter(function (e) { return inScope(getModalEntryUserId(e)); });
      transactions = transactions.filter(function (tx) { return inScope(getUserId(tx)); });

      // ---------- ANTI DOBEL MODAL ----------
      var modalFromCollection = modalEntries.reduce(function (s, e) {
        return s + normalizeNumber(e.amount);
      }, 0);
      var guarded = applyModalAntiDouble(transactions, modalFromCollection);
      transactions = guarded.transactions;

      // ---------- SUMMARY BAKU ----------
      var summary = createSummary(transactions);
      var modalAwal = guarded.modalAwal;
      var kasFisik = calculateKasFisikLaciFromSummary(modalAwal, summary);

      // ---------- RINCIAN KATEGORI (mutasi baku, bukan hitungan page) ----------
      var rincian = {
        topupFisik: 0, tarikFisik: 0,
        topupNonTunai: 0, tarikNonTunai: 0,
        pembelianTunai: 0, pembelianNonTunai: 0,
        pelunasanMasuk: 0,
        topupAdminTunai: 0
      };

      transactions.forEach(function (tx) {
        if (!isValidTransaction(tx)) return;
        var cat = getCategory(tx);
        var met = getPaymentMethod(tx);

        if (cat === 'top_up') {
          if (met === 'tunai') {
            rincian.topupFisik += KAS_CONFIG.adminTopupMasukLaci
              ? normalizeNumber(tx.cash_in)
              : normalizeNumber(tx.nominal);
            rincian.topupAdminTunai += getAdmin(tx);
          } else if (met === 'qris' || met === 'transfer') {
            rincian.topupNonTunai += normalizeNumber(tx.bank_in);
          }
        } else if (cat === 'tarik_tunai') {
          if (met === 'tunai') rincian.tarikFisik += normalizeNumber(tx.cash_out);
          else if (met === 'transfer') rincian.tarikNonTunai += normalizeNumber(tx.bank_out);
        } else if (cat === 'pembelian') {
          if (met === 'tunai') rincian.pembelianTunai += normalizeNumber(tx.cash_out);
          else if (met === 'qris' || met === 'transfer') rincian.pembelianNonTunai += normalizeNumber(tx.bank_out);
        } else if (cat === 'bayar_hutang' || cat === 'pengembalian_pinjaman') {
          rincian.pelunasanMasuk += normalizeNumber(tx.cash_in);
        }
      });

      // ---------- PIUTANG ----------
      var piutang = 0;
      try {
        debtsSnapshot.forEach(function (doc) {
          var debt = doc.data();
          if (String(debt.type || 'piutang') !== 'piutang') return;
          if (String(debt.status || '') !== 'active') return;
          if (debt.kasRecorded === false) return;
          if (debt.date && debt.date !== date) return;
          if (KAS_CONFIG.piutangIkutScopeRole) {
            if (!inScope(debt.userId)) return;
          } else if (debt.userId !== currentUserId) {
            return;
          }
          piutang += normalizeNumber(debt.remaining != null ? debt.remaining : debt.amount);
        });
      } catch (e) {}

      // ---------- TOTAL — SEMUA SAKLAR KAS_CONFIG BERLAKU DI SINI ----------
      var totalLaci = kasFisik.totalKasFisikDiLaci;
      if (!KAS_CONFIG.adminTopupMasukLaci) totalLaci -= rincian.topupAdminTunai;
      if (!KAS_CONFIG.pembelianKurangiLaci) totalLaci += rincian.pembelianTunai;
      if (!KAS_CONFIG.pelunasanMasukLaci) totalLaci -= rincian.pelunasanMasuk;
      if (KAS_CONFIG.hitungPiutangKeTotalLaci) {
        totalLaci += piutang;
      }

      return {
        role: role,
        useTeamScope: useTeamScope,
        modalAwal: modalAwal,
        penjualanTunai: summary.salesCash,
        penjualanQris: summary.salesQris,
        penjualanTransfer: summary.salesTransfer,
        penjualanUtang: summary.salesCredit,
        penjualanNonTunai: (summary.salesQris || 0) + (summary.salesTransfer || 0),
        uangMasukLain: summary.cashFlowIn,
        kasKeluarToko: summary.cashFlowOut,
        topupFisik: rincian.topupFisik,
        tarikFisik: rincian.tarikFisik,
        topupNonTunai: rincian.topupNonTunai,
        tarikNonTunai: rincian.tarikNonTunai,
        pembelianTunai: rincian.pembelianTunai,
        pembelianNonTunai: rincian.pembelianNonTunai,
        pelunasanMasuk: rincian.pelunasanMasuk,
        piutang: piutang,
        totalLaci: totalLaci,
        totalBank: summary.saldoBank,
        totalPenjualan: summary.totalSales,
        totalTransaksi: summary.transactionCount,
        totalLaba: summary.totalProfit,
        summary: summary
      };
    }

    /* ==========================================================
     * 30b. SETTLE DEBT — internal, dipakai saveTransaction
     * ========================================================== */

    async function settleDebt(db, opts) {
      var amount = normalizeNumber(opts.amount);
      if (amount <= 0) return null;

      var debtDoc = null;

      if (opts.debtId) {
        var snap = await db.collection('debts').doc(opts.debtId).get();
        if (snap.exists) debtDoc = snap;
      } else {
        try {
          var query = db.collection('debts')
            .where('status', '==', 'active')
            .where('type', '==', opts.type)
            .where('userId', '==', opts.userId)
            .orderBy('created_at', 'asc')
            .limit(1);
          var qSnap = await query.get();
          if (!qSnap.empty) debtDoc = qSnap.docs[0];
        } catch (e) {
          // index belum ada — fallback tanpa orderBy
          var fallback = await db.collection('debts')
            .where('status', '==', 'active')
            .where('type', '==', opts.type)
            .where('userId', '==', opts.userId)
            .get();
          if (!fallback.empty) debtDoc = fallback.docs[0];
        }
      }

      if (!debtDoc || !debtDoc.exists) return null;

      var debt = debtDoc.data();
      var remaining = normalizeNumber(debt.remaining != null ? debt.remaining : debt.amount);
      var newRemaining = Math.max(0, remaining - amount);

      var update = { remaining: newRemaining };
      if (newRemaining <= 0) {
        update.status = 'paid';
        update.paid_at = opts.waktuMs;
      }
      if (opts.toKas) update.kasRecorded = true;

      await db.collection('debts').doc(debtDoc.id).update(update);
      return debtDoc.id;
    }

    /* ==========================================================
     * 30c. SAVE TRANSACTION — SATU PINTU UNTUK MENULIS
     *
     * Semua menu cukup memanggil ini. KasCore yang mengurus:
     *   - normalisasi kategori/metode/nominal/admin
     *   - mutasi baku (cash/bank/digital) sesuai tabel logika
     *   - date_key, userId, shiftId, waktu
     *   - pembuatan hutang (jual/top up bon, pinjaman)
     *   - pelunasan hutang (bayar hutang, pengembalian pinjaman)
     *
     * payload:
     *   kategori         : wajib (jual/top_up/tarik_tunai/kas_masuk/...)
     *   metode_pembayaran: tunai/qris/transfer/utang
     *   nominal, admin, modal_produk
     *   userId           : wajib
     *   shiftId, customerName, catatan, status : opsional
     *   pengaruhi_kas_global : checkbox (bayar hutang/pembelian/pengembalian)
     *   debtId           : opsional, lunasi hutang tertentu
     *   waktu            : opsional (Date / ms / string), default now
     * ========================================================== */

    async function saveTransaction(payload) {
      payload = payload || {};
      var db = getDb();

      var category = getCategory(payload);
      if (!category) throw new Error('KasCore.saveTransaction: kategori wajib diisi.');

      var userId = getUserId(payload) || payload.userId;
      if (!userId) throw new Error('KasCore.saveTransaction: userId wajib diisi.');

      var method = getPaymentMethod(payload);
      var nominal = getNominal(payload);
      var admin = getAdmin(payload);

      var waktuDate = parseDateValue(payload.waktu) || new Date();
      var waktuMs = waktuDate.getTime();
      var dateKey = payload.date_key || formatDateKey(waktuDate);

      var mutation = mapTransactionMutation(payload);

      var doc = {};
      ['kategori', 'metode_pembayaran', 'nominal', 'admin', 'modal_produk',
       'shiftId', 'customerName', 'catatan', 'status', 'pengaruhi_kas_global'
      ].forEach(function (field) {
        if (payload[field] !== undefined) doc[field] = payload[field];
      });
      Object.assign(doc, mutation);
      doc.userId = userId;
      doc.date_key = dateKey;
      doc.waktu = waktuMs;
      doc.created_at = waktuMs;

      var ref = await db.collection('transactions').add(doc);
      var transactionId = ref.id;

      // ---------- HUTANG ----------
      var debtId = null;

      // Jual / Top Up bon -> hutang baru
      if ((category === 'jual' || category === 'top_up') && method === 'utang') {
        var debtAmount = nominal + (category === 'top_up' ? admin : 0);
        var dibayarSekarang = Math.min(normalizeNumber(payload.bayar_sekarang || 0), debtAmount);
        var debtRemaining = Math.max(0, debtAmount - dibayarSekarang);
        var debtRef = await db.collection('debts').add({
          type: 'piutang',
          status: debtRemaining <= 0 ? 'paid' : 'active',
          amount: debtAmount,
          remaining: debtRemaining,
          dibayar_sekarang: dibayarSekarang,
          kasRecorded: mutation.cash_in > 0 || mutation.bank_in > 0,
          date: dateKey,
          userId: userId,
          customerName: payload.customerName || '',
          kategori: category,
          transactionId: transactionId,
          created_at: waktuMs
        });
        debtId = debtRef.id;
      }

      // Pinjam uang -> hutang internal
      else if (category === 'pinjaman_tunai') {
        var loanRef = await db.collection('debts').add({
          type: 'pinjaman',
          status: 'active',
          amount: nominal,
          remaining: nominal,
          kasRecorded: mutation.cash_out > 0,
          date: dateKey,
          userId: userId,
          customerName: payload.customerName || '',
          kategori: category,
          transactionId: transactionId,
          created_at: waktuMs
        });
        debtId = loanRef.id;
      }

      // Bayar hutang / pengembalian pinjaman -> melunasi
      else if (category === 'bayar_hutang' || category === 'pengembalian_pinjaman') {
        debtId = await settleDebt(db, {
          debtId: payload.debtId || null,
          userId: userId,
          amount: nominal,
          type: category === 'bayar_hutang' ? 'piutang' : 'pinjaman',
          toKas: mutation.cash_in > 0 || mutation.bank_in > 0,
          waktuMs: waktuMs
        });
      }

      return {
        id: transactionId,
        debtId: debtId,
        date_key: dateKey,
        mutation: mutation
      };
    }

/* ==========================================================
 * PAYROLL / STAFF DEBT
 * ========================================================== */

async function getActiveStaffDebts(options) {
  options = options || {};

  var db = getDb();
  var staffId = String(options.staffId || '').trim();
  var staffName = String(options.staffName || '').trim().toLowerCase();

  var snapshot = await db.collection('debts')
    .where('status', '==', 'active')
    .get();

  var debts = [];

  snapshot.forEach(function(doc) {
    var d = doc.data() || {};

    var debtUserId = String(d.userId || '').trim();
    var debtCustomerName = String(
      d.customerName || d.name || ''
    ).trim().toLowerCase();

    var sameStaff =
      (staffId && debtUserId === staffId) ||
      (staffName && debtCustomerName === staffName);

    if (!sameStaff) return;

    var remaining = normalizeNumber(
      d.remaining != null ? d.remaining : d.amount
    );

    if (remaining <= 0) return;

    debts.push({
      id: doc.id,
      type: d.type || 'hutang',
      status: d.status || 'active',
      amount: normalizeNumber(d.amount),
      remaining: remaining,
      customerName: d.customerName || d.name || '',
      note: d.note || d.catatan || '',
      kategori: d.kategori || '',
      userId: d.userId || '',
      date: d.date || '',
      transactionId: d.transactionId || null
    });
  });

  return debts;
}

    /* ==========================================================
     * 31. PUBLIC API
     * ========================================================== */

    return {

      // UTILITIES
      normalizeNumber: normalizeNumber,
      normalizeBoolean: normalizeBoolean,
      parseDateValue: parseDateValue,
      formatDateKey: formatDateKey,
      getTransactionDate: getTransactionDate,
      getUserId: getUserId,
      getShiftId: getShiftId,
      getCategory: getCategory,
      getPaymentMethod: getPaymentMethod,
      getNominal: getNominal,
      getModalProduk: getModalProduk,
      getAdmin: getAdmin,

      // CONFIG (saklar global — bisa dibaca/ubah dari console juga)
      config: KAS_CONFIG,

      // CLASSIFICATION
      isValidTransaction: isValidTransaction,
      isSaleTransaction: isSaleTransaction,
      isIncludedInTransactions: isIncludedInTransactions,
      getAffectsCashGlobal: getAffectsCashGlobal,
      classifyTransaction: classifyTransaction,

      // MAPPER
      mapTransactionMutation: mapTransactionMutation,
      calculateTransactionProfit: calculateTransactionProfit,

      // SUMMARY
      summarizeTransactions: createSummary,
      createSummary: createSummary,
      getSalesSummary: getSalesSummary,
      getProfitSummary: getProfitSummary,
      getCashGlobalSummary: getCashGlobalSummary,

      // FIRESTORE
      getTransactionsByDateRange: getTransactionsByDateRange,
      getModalSummary: getModalSummary,
      getDailySummary: getDailySummary,
      getPeriodSummary: getPeriodSummary,

      // KAS
      calculateKasFisikLaciFromSummary: calculateKasFisikLaciFromSummary,
      getKasFisikLaci: getKasFisikLaci,
      getShiftSummary: getShiftSummary,

      // SATU PINTU
      getKasLaciDisplay: getKasLaciDisplay,   // baca
      saveTransaction: saveTransaction,       // tulis
      saveModalAwal: saveModalAwal,            // tulis modal

      // PAYROLL / HUTANG STAFF
      getActiveStaffDebts: getActiveStaffDebts,
      savePayroll: savePayroll
};
  })();
}

/* Alias global untuk page lama: var KasCore = window.KasCore; */
var KasCore = window.KasCore;
