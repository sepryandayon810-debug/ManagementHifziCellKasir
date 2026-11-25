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
  var sub = transaction.sub_kategori || transaction.kategori_keluar || transaction.subKategori || '';
  var subCategory = String(sub).trim().toLowerCase();

  // Setor Tunai ke Bank
  if (category === 'setor_bank' || category === 'setor_tunai' || subCategory === 'setor_bank' || subCategory === 'setor_tunai') {
    return 'setor_bank';
  }

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
      var raw =
  transaction.metode_pembayaran ||
  transaction.paymentMethod ||
  transaction.paymentType ||
  transaction.metode ||
  '';
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
        case 'setor_bank': return true;
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
        case 'setor_bank':
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

      if (transaction.isOwnerTake || (transaction.catatan && String(transaction.catatan).includes('AMBIL OWNER'))) {
        return 0;
      }

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

        /* SETOR TUNAI KE BANK (Pindah Saldo dari Kas Fisik Laci ke Saldo Bank) */
        case 'setor_bank':
          result.cash_out = nominal;
          result.bank_in = nominal;
          result.masuk_transaksi = false;
          result.masuk_penjualan = false;
          result.laba = 0;
          result.pengaruhi_kas_global = true;
          break;

        /* KAS KELUAR BIASA & FALLBACK SETOR KELUAR */
        case 'kas_keluar':
          var isSetorKeluar = payload.sub_kategori === 'setor_bank' || 
                              payload.kategori_keluar === 'setor_bank' || 
                              (payload.catatan && /setor.*bank/i.test(payload.catatan));
          if (isSetorKeluar) {
            result.kategori = 'setor_bank';
            result.cash_out = nominal;
            result.bank_in = nominal;
            result.masuk_transaksi = false;
            result.masuk_penjualan = false;
            result.laba = 0;
            result.pengaruhi_kas_global = true;
          } else {
            result.cash_out = nominal;
            result.masuk_transaksi = false;
            result.masuk_penjualan = false;
            result.laba = 0;
          }
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
          result.laba = (payload.isOwnerTake || (payload.catatan && payload.catatan.includes('AMBIL OWNER'))) ? 0 : (nominal - modalProduk);
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

        /* PINJAMAN UANG — kas hanya bergerak jika dicentang */
        case 'pinjaman_tunai':
          if (affectsCashGlobal) {
            result.cash_out = nominal;
          }
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
case 'setor_bank':
  classification.isCashFlow = true;
  classification.isOperational = false; // Setor bank bukan beban operasional
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
        if (category === 'kas_keluar' || category === 'pinjaman_tunai' || category === 'setor_bank') {
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
        transactions.push(Object.assign({}, doc.data(), { id: doc.id }));
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

    var _pastRangeMemCache = {};

    async function loadTransactionsByRange(startDate, endDate) {
      var todayKey = formatDateKey(new Date());
      var isPastOnly = Boolean(startDate && endDate && endDate < todayKey);
      var rangeCacheKey = 'webpos_tx_range_' + startDate + '_' + endDate;

      // HEMAT KUOTA: jika tarik laporan tanggal yang sudah lewat, pakai cache sesi (0 Read!)
      if (isPastOnly) {
        if (_pastRangeMemCache[rangeCacheKey]) {
          return _pastRangeMemCache[rangeCacheKey];
        }
        try {
          var cachedRaw = sessionStorage.getItem(rangeCacheKey);
          if (cachedRaw) {
            var cachedParsed = JSON.parse(cachedRaw);
            if (Array.isArray(cachedParsed)) {
              _pastRangeMemCache[rangeCacheKey] = cachedParsed;
              return cachedParsed;
            }
          }
        } catch (e) {}
      }

      var db = getDb();
      var resultById = {};

      async function collectByField(field) {
        try {
          var rows = await queryByField(db, field, startDate, endDate);
          rows.forEach(function (row) {
            if (!resultById[row.id]) {
              resultById[row.id] = row;
            }
          });
        } catch (error) {
          console.warn('KasCore: query field ' + field + ' gagal.', error);
        }
      }

      // Jalankan query data baru (date_key) & data lama (date) secara paralel (2x lebih cepat)
      await Promise.all([
        collectByField('date_key'),
        collectByField('date')
      ]);

      var mergedList = Object.values(resultById);

      // Simpan cache khusus untuk rentang tanggal masa lalu agar cek ulang 0 Read
      if (isPastOnly) {
        _pastRangeMemCache[rangeCacheKey] = mergedList;
        try {
          var serialized = JSON.stringify(mergedList);
          if (serialized.length < 400000) {
            sessionStorage.setItem(rangeCacheKey, serialized);
          }
        } catch (e) {}
      }

      return mergedList;
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

  // Format baru: YYYY-MM-DD_userId
  try {
    var userDoc = await db
      .collection('modal')
      .doc(date + '_' + userId)
      .get();

    if (userDoc.exists) {
      return Object.assign(
        { id: userDoc.id },
        userDoc.data()
      );
    }
  } catch (error) {
    console.warn('KasCore: gagal membaca modal user.', error);
  }

  // Format lama: YYYY-MM-DD
  try {
    var oldDoc = await db
      .collection('modal')
      .doc(date)
      .get();

    if (oldDoc.exists) {
      var oldData = oldDoc.data() || {};

      // Jika data lama memiliki userId,
      // pastikan userId-nya sesuai.
      if (
        oldData.userId &&
        oldData.userId !== userId
      ) {
        return null;
      }

      return Object.assign(
        { id: oldDoc.id },
        oldData
      );
    }
  } catch (error) {
    console.warn('KasCore: gagal membaca modal lama.', error);
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
        var cachedRole = (typeof localStorage !== 'undefined') ? localStorage.getItem('webpos_user_role') : null;
        if (cachedRole) role = String(cachedRole).toLowerCase();
      } catch (e) {}
      if (currentUserId) {
        try {
          var userDoc = await db.collection('users').doc(currentUserId).get();
          if (userDoc.exists) role = String(userDoc.data().role || role || 'kasir').toLowerCase();
        } catch (e) {}
      }

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
        debtsPromise = db.collection('debts').where('date', '==', date).get();
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
          if (!debt.date || debt.date !== date) return;
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

      // SHIFT GUARD (Opsi 1): blokir transaksi di Kasir, Kas Masuk/Keluar, Top Up, Tarik jika shift belum dibuka / sudah closing
      if (isGuardedShiftPage() && isGuardedShiftCategory(category)) {
        var guardRes = await ensureShiftOpenForGuard(userId);
        if (!guardRes.isOpen) {
          openShiftGuardModal({ status: guardRes.status });
          throw new Error(
            guardRes.status === 'closed'
              ? 'Shift hari ini sudah ditutup (Closing). Buka ulang shift terlebih dahulu untuk transaksi susulan.'
              : 'Shift belum dibuka. Buka shift terlebih dahulu sebelum melakukan transaksi.'
          );
        }
        if (!payload.shiftId && guardRes.shiftId) {
          payload.shiftId = guardRes.shiftId;
        }
      }

      var method = getPaymentMethod(payload);
      var nominal = getNominal(payload);
      var admin = getAdmin(payload);

      var waktuDate = parseDateValue(payload.waktu) || new Date();
      var waktuMs = waktuDate.getTime();
      var dateKey = payload.date_key || formatDateKey(waktuDate);

      var mutation = mapTransactionMutation(payload);

      var doc = {};
['kategori', 'metode_pembayaran', 'nominal', 'admin', 'modal_produk',
 'shiftId', 'customerName', 'catatan', 'status', 'pengaruhi_kas_global',
 'resellerMode', 'isReseller', 'priceMode', 'tipe_penjualan', 'nama_konter', 'resellerName',
 'items', 'userName', 'note', 'diskon', 'discount', 'subtotal'
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

async function savePayroll(options) {
  options = options || {};

  var db = getDb();

  var staffId = String(options.staffId || '').trim();
  var staffName = String(options.staffName || '').trim();

  if (!staffId || !staffName) {
    throw new Error('KasCore.savePayroll: staff wajib dipilih.');
  }

  var period = String(options.period || '').trim();
  var periodName = String(options.periodName || '').trim();

  var baseSalary = normalizeNumber(options.baseSalary);
  var prevUnpaidSalary = normalizeNumber(options.prevUnpaidSalary);
  var status = options.status || 'unpaid';

  var debtIds = Array.isArray(options.debtIds)
    ? options.debtIds
    : [];

  var selectedDebts = [];
  var totalDebtDeduction = 0;

  /*
   * Ambil ulang hutang dari KasCore.
   * Jangan percaya nominal yang dikirim dari page.
   */
  var activeDebts = await getActiveStaffDebts({
    staffId: staffId,
    staffName: staffName
  });

  debtIds.forEach(function(debtId) {
    var debt = activeDebts.find(function(d) {
      return d.id === debtId;
    });

    if (!debt) return;

    var amount = normalizeNumber(debt.remaining);

    if (amount <= 0) return;

    totalDebtDeduction += amount;

    selectedDebts.push({
      id: debt.id,
      name: debt.customerName || debt.name || staffName,
      amountDeducted: amount
    });
  });

  var netSalary =
    (baseSalary + prevUnpaidSalary) -
    totalDebtDeduction;

  var payrollRef = db.collection('payrolls').doc();

  var batch = db.batch();

  batch.set(payrollRef, {
    staffId: staffId,
    staffName: staffName,
    period: period,
    periodName: periodName,
    baseSalary: baseSalary,
    prevUnpaidSalary: prevUnpaidSalary,
    totalDebtDeduction: totalDebtDeduction,
    netSalary: netSalary,
    selectedDebts: selectedDebts,
    status: status,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  selectedDebts.forEach(function(debt) {
    var debtRef = db.collection('debts').doc(debt.id);

    batch.update(debtRef, {
      remaining: 0,
      status: 'paid',
      paidAt: firebase.firestore.FieldValue.serverTimestamp(),
      paidViaPayrollId: payrollRef.id
    });
  });

  await batch.commit();

  return {
    id: payrollRef.id,
    staffId: staffId,
    staffName: staffName,
    period: period,
    totalDebtDeduction: totalDebtDeduction,
    netSalary: netSalary,
    selectedDebts: selectedDebts
  };
}

    /* ==========================================================
     * 30d. SHIFT GUARD & BUKA ULANG SHIFT (OPSI 1)
     * Aktif otomatis di: Kasir, Kas Masuk, Kas Keluar, Top Up, Tarik Tunai.
     * Bayar Hutang (page-hutang.html) & halaman lain TIDAK dikunci.
     * ========================================================== */

    var GUARDED_SHIFT_PAGES = {
      'page-kasir.html': 'Kasir / Bayar',
      'page-kas-masuk.html': 'Kas Masuk',
      'page-kas-keluar.html': 'Kas Keluar',
      'page-kas-topup.html': 'Top Up',
      'page-kas-tarik.html': 'Tarik Tunai'
    };

    var GUARDED_SHIFT_BUTTON_IDS = {
      'btnBayar': true,
      'btnConfirmPayment': true,
      'btnConfirmPaymentDesktop': true,
      'btnSimpanKas': true,
      'btnSimpanKeluar': true,
      'btnSimpanTopup': true,
      'btnSimpanTarik': true
    };

    var GUARDED_SHIFT_CATEGORIES = {
      'jual': true,
      'kas_masuk': true,
      'kas_keluar': true,
      'setor_bank': true,
      'top_up': true,
      'tarik_tunai': true
    };

    var SHIFT_CACHE_KEY = 'webpos_shift_status_cache';
    var _shiftGuardState = {
      status: 'checking',
      isOpen: false,
      shiftId: null,
      uid: null,
      date: '',
      data: null,
      busy: false,
      onModalSuccess: null
    };

    function getCurrentPageName() {
      try {
        var path = String(window.location.pathname || '').split('?')[0].split('#')[0];
        var parts = path.split('/').filter(Boolean);
        return String(parts[parts.length - 1] || '').toLowerCase();
      } catch (e) {
        return '';
      }
    }

    function isGuardedShiftPage() {
      return Boolean(GUARDED_SHIFT_PAGES[getCurrentPageName()]);
    }

    function isGuardedShiftCategory(category) {
      return Boolean(GUARDED_SHIFT_CATEGORIES[String(category || '').trim().toLowerCase()]);
    }

    function getShiftTodayKey() {
      if (window.Utils && typeof window.Utils.getTodayString === 'function') {
        return window.Utils.getTodayString();
      }
      return formatDateKey(new Date());
    }

    function syncShiftCache(uid, dateKey, status, shiftId) {
      var safeDate = dateKey || getShiftTodayKey();
      try {
        if (status === 'open' && shiftId) {
          localStorage.setItem('active_shift_id', shiftId);
        } else {
          localStorage.removeItem('active_shift_id');
        }
        if (uid) {
          localStorage.setItem(SHIFT_CACHE_KEY, JSON.stringify({
            uid: uid,
            date: safeDate,
            status: status,
            shiftId: shiftId || null,
            ts: Date.now()
          }));
        }
      } catch (e) {}
     var curUser = getCurrentAuthUser();
      if (!uid || !curUser || curUser.uid === uid) {
        _shiftGuardState.uid = uid || _shiftGuardState.uid;
        _shiftGuardState.date = safeDate;
        _shiftGuardState.status = status;
        _shiftGuardState.isOpen = (status === 'open');
        _shiftGuardState.shiftId = (status === 'open') ? (shiftId || null) : null;
      }
      updateShiftGuardUI();
    }

    function readShiftCache(uid, dateKey) {
      try {
        var raw = localStorage.getItem(SHIFT_CACHE_KEY);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (!parsed || parsed.date !== dateKey) return null;
        if (uid && parsed.uid !== uid) return null;
        return parsed;
      } catch (e) {
        return null;
      }
    }

    function getCurrentAuthUser() {
      try {
        if (window.firebase && window.firebase.auth && window.firebase.auth().currentUser) {
          return window.firebase.auth().currentUser;
        }
      } catch (e) {}
      return null;
    }

    async function getTodayShiftStatus(userId) {
      var user = getCurrentAuthUser();
      var uid = userId || (user && user.uid) || _shiftGuardState.uid;
      var today = getShiftTodayKey();
      if (!uid) {
        return { status: 'checking', isOpen: false, shiftId: null, date: today, data: null };
      }

      var shiftDocId = today + '_' + uid;
      try {
        var db = getDb();
        var snap = await db.collection('shifts').doc(shiftDocId).get();
        if (snap.exists) {
          var data = snap.data() || {};
          var isOpen = String(data.status || '').toLowerCase() === 'open';
          var status = isOpen ? 'open' : 'closed';
          _shiftGuardState.data = data;
          syncShiftCache(uid, today, status, isOpen ? shiftDocId : null);
          return { status: status, isOpen: isOpen, shiftId: isOpen ? shiftDocId : null, date: today, data: data };
        } else {
          _shiftGuardState.data = null;
          syncShiftCache(uid, today, 'none', null);
          return { status: 'none', isOpen: false, shiftId: null, date: today, data: null };
        }
      } catch (err) {
        console.warn('KasCore: gagal cek status shift hari ini', err);
        var cached = readShiftCache(uid, today);
        if (cached && cached.status) {
          var cOpen = cached.status === 'open';
          _shiftGuardState.uid = uid;
          _shiftGuardState.date = today;
          _shiftGuardState.status = cached.status;
          _shiftGuardState.isOpen = cOpen;
          _shiftGuardState.shiftId = cOpen ? cached.shiftId : null;
          updateShiftGuardUI();
          return { status: cached.status, isOpen: cOpen, shiftId: cOpen ? cached.shiftId : null, date: today, data: null };
        }
        return { status: 'none', isOpen: false, shiftId: null, date: today, data: null };
      }
    }

    async function ensureShiftOpenForGuard(userId) {
      var today = getShiftTodayKey();
      var uid = userId || (getCurrentAuthUser() && getCurrentAuthUser().uid) || _shiftGuardState.uid;
      if (_shiftGuardState.isOpen && _shiftGuardState.date === today && (!uid || _shiftGuardState.uid === uid)) {
        return {
          status: 'open',
          isOpen: true,
          shiftId: _shiftGuardState.shiftId || (today + '_' + uid)
        };
      }
      return await getTodayShiftStatus(uid);
    }

    async function openOrReopenShift(options) {
      options = options || {};
      var db = getDb();
      var authUser = options.user || getCurrentAuthUser();
      var uid = options.userId || (authUser && authUser.uid);
      if (!uid) throw new Error('Akun kasir belum siap. Muat ulang halaman lalu coba lagi.');

      var today = getShiftTodayKey();
      var shiftDocId = today + '_' + uid;
     var userNameEl = (typeof document !== 'undefined') ? document.getElementById('userName') : null;
      var rawDomName = String((userNameEl && userNameEl.textContent) || '').trim();
      var isPlaceholderName = !rawDomName || /^(loading\.{0,3}|memuat\.{0,3}|-|user)$/i.test(rawDomName);
      var rawOptName = String(options.userName || '').trim();
      if (/^(loading\.{0,3}|memuat\.{0,3}|-|user)$/i.test(rawOptName)) rawOptName = '';
      var cachedUserName = (function() { try { return String(localStorage.getItem('webpos_user_name') || '').trim(); } catch (e) { return ''; } })();
      var userName = (
        rawOptName ||
        (!isPlaceholderName ? rawDomName : '') ||
        cachedUserName ||
        (authUser && (authUser.displayName || authUser.email)) ||
        'Kasir'
      ).trim();

      var modalAmount = 0;
      try {
        var modalEntry = await loadModalEntry(today, uid);
        if (modalEntry) modalAmount = normalizeNumber(modalEntry.amount);
      } catch (e) {}

      var docRef = db.collection('shifts').doc(shiftDocId);
      var existingSnap = await docRef.get();
      var wasClosed = false;
      var reopenCount = 0;

      if (!existingSnap.exists && modalAmount <= 0) {
        try {
          var curPage = getCurrentPageName();
          if (curPage && curPage !== 'page-modal-harian.html' && curPage !== 'index.html') {
            localStorage.setItem('wpos_return_after_modal', curPage + (window.location.search || ''));
          }
        } catch (e) {}
        return { shiftId: null, reopened: false, redirectToModal: true, modalAwal: 0 };
      }

      if (existingSnap.exists) {
        var prev = existingSnap.data() || {};
        if (String(prev.status || '').toLowerCase() === 'open') {
          syncShiftCache(uid, today, 'open', shiftDocId);
          return { shiftId: shiftDocId, reopened: false, alreadyOpen: true, modalAwal: normalizeNumber(prev.modalAwal) };
        }
        wasClosed = true;
        var prevClosings = Array.isArray(prev.previousClosings) ? prev.previousClosings.slice() : [];
        if (prev.closedAt || prev.kasAkhir !== undefined || prev.kasSistem !== undefined) {
          prevClosings.push({
            closedAt: prev.closedAt || Date.now(),
            kasAkhir: normalizeNumber(prev.kasAkhir),
            kasSistem: normalizeNumber(prev.kasSistem),
            selisih: normalizeNumber(prev.selisih),
            closingStatus: prev.closingStatus || ''
          });
        }
        reopenCount = normalizeNumber(prev.reopenCount) + 1;
        var finalModal = prev.modalAwal != null ? normalizeNumber(prev.modalAwal) : modalAmount;

        await docRef.set({
          id: shiftDocId,
          userId: uid,
          userName: userName || prev.userName || 'Kasir',
          date: today,
          status: 'open',
          modalAwal: finalModal,
          openedAt: prev.openedAt || firebase.firestore.FieldValue.serverTimestamp(),
          closedAt: null,
          closeTime: null,
          reopenedAt: Date.now(),
          reopenCount: reopenCount,
          previousClosings: prevClosings
        }, { merge: true });
      } else {
        await docRef.set({
          id: shiftDocId,
          userId: uid,
          userName: userName,
          date: today,
          status: 'open',
          modalAwal: modalAmount,
          openedAt: firebase.firestore.FieldValue.serverTimestamp(),
          reopenCount: 0
        });
      }

      syncShiftCache(uid, today, 'open', shiftDocId);

      try {
        if (window.Utils && typeof window.Utils.saveLog === 'function') {
          window.Utils.saveLog(
            wasClosed ? 'Buka Ulang Shift' : 'Buka Shift',
            wasClosed
              ? ('Membuka ulang shift setelah closing (ke-' + reopenCount + ') di ' + (getCurrentPageName() || 'WebPOS'))
              : ('Membuka shift kerja harian di ' + (getCurrentPageName() || 'WebPOS'))
          );
        }
      } catch (e) {}

      return { shiftId: shiftDocId, reopened: wasClosed, reopenCount: reopenCount, modalAwal: modalAmount };
    }

    function injectShiftGuardStyles() {
      if (typeof document === 'undefined' || document.getElementById('wposShiftGuardStyle')) return;
      var st = document.createElement('style');
      st.id = 'wposShiftGuardStyle';
      st.textContent =
        '#wposShiftGuardBanner{display:none;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;margin:10px 14px 4px;border-radius:12px;font-family:inherit;font-size:12.5px;line-height:1.4;border:1px solid transparent;box-shadow:0 4px 14px rgba(15,23,42,0.06);flex-wrap:wrap;}' +
        '#wposShiftGuardBanner.is-none{display:flex;background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#92400e;border-color:#fcd34d;}' +
        '#wposShiftGuardBanner.is-closed{display:flex;background:linear-gradient(135deg,#fff1f2,#ffe4e6);color:#9f1239;border-color:#fda4af;}' +
        '[data-theme="dark"] #wposShiftGuardBanner.is-none{background:rgba(245,158,11,0.14);color:#fde68a;border-color:rgba(245,158,11,0.35);}' +
        '[data-theme="dark"] #wposShiftGuardBanner.is-closed{background:rgba(244,63,94,0.16);color:#fecdd3;border-color:rgba(244,63,94,0.38);}' +
        '.wpos-sg-left{display:flex;align-items:center;gap:10px;min-width:0;flex:1;}' +
        '.wpos-sg-icon{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;color:#fff;}' +
        '#wposShiftGuardBanner.is-none .wpos-sg-icon{background:linear-gradient(135deg,#f59e0b,#d97706);}' +
        '#wposShiftGuardBanner.is-closed .wpos-sg-icon{background:linear-gradient(135deg,#f43f5e,#be123c);}' +
        '.wpos-sg-text{min-width:0;}' +
        '.wpos-sg-title{font-weight:800;font-size:13px;}' +
        '.wpos-sg-sub{font-size:11.5px;opacity:0.9;}' +
        '.wpos-sg-btn{border:none;border-radius:9px;padding:7px 13px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;gap:6px;box-shadow:0 3px 10px rgba(0,0,0,0.14);}' +
        '#wposShiftGuardBanner.is-none .wpos-sg-btn{background:linear-gradient(135deg,#10b981,#059669);}' +
        '#wposShiftGuardBanner.is-closed .wpos-sg-btn{background:linear-gradient(135deg,#f59e0b,#d97706);}' +
        '.wpos-shift-locked-btn{opacity:0.78 !important;filter:grayscale(0.28);}' +
        '#wposShiftGuardModal{position:fixed;inset:0;z-index:100001;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:16px;}' +
        '#wposShiftGuardModal.open{display:flex;}' +
        '.wpos-sg-card{width:min(390px,100%);background:var(--bg-card,var(--bg-surface,#ffffff));color:var(--text-main,#0f172a);border-radius:18px;padding:20px;box-shadow:0 22px 48px rgba(2,6,23,0.35);border:1px solid var(--border-color,var(--border,#e2e8f0));font-family:inherit;}' +
        '.wpos-sg-mhead{display:flex;align-items:center;gap:12px;margin-bottom:10px;}' +
        '.wpos-sg-micon{width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:19px;flex-shrink:0;}' +
        '.wpos-sg-micon.none{background:linear-gradient(135deg,#f59e0b,#d97706);}' +
        '.wpos-sg-micon.closed{background:linear-gradient(135deg,#f43f5e,#be123c);}' +
        '.wpos-sg-mtitle{font-size:16px;font-weight:800;line-height:1.25;}' +
        '.wpos-sg-mdesc{font-size:13px;line-height:1.5;color:var(--text-muted,#475569);margin:0 0 14px;}' +
        '.wpos-sg-mnote{font-size:11.5px;line-height:1.45;padding:9px 11px;border-radius:10px;margin-bottom:16px;background:rgba(99,102,241,0.08);color:var(--text-main,#334155);border:1px solid rgba(99,102,241,0.18);}' +
        '.wpos-sg-mactions{display:flex;align-items:center;gap:9px;}' +
        '.wpos-sg-mbtn{border:none;border-radius:11px;padding:10px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:6px;}' +
        '.wpos-sg-mbtn.cancel{background:var(--bg-subtle,#f1f5f9);color:var(--text-main,#334155);flex:0 0 auto;}' +
        '.wpos-sg-mbtn.primary{flex:1;color:#fff;box-shadow:0 6px 16px rgba(16,185,129,0.28);background:linear-gradient(135deg,#10b981,#059669);}' +
        '.wpos-sg-mbtn.reopen{flex:1;color:#fff;box-shadow:0 6px 16px rgba(245,158,11,0.3);background:linear-gradient(135deg,#f59e0b,#d97706);}' +
        '.wpos-sg-mbtn:disabled{opacity:0.65;cursor:not-allowed;}';
      document.head.appendChild(st);
    }

    function ensureShiftGuardBanner() {
      if (typeof document === 'undefined' || !isGuardedShiftPage()) return null;
      injectShiftGuardStyles();
      var banner = document.getElementById('wposShiftGuardBanner');
      if (banner) return banner;
      var mainEl = document.querySelector('main.main-content') || document.body;
      var headerEl = mainEl.querySelector('header.main-header');
      banner = document.createElement('div');
      banner.id = 'wposShiftGuardBanner';
      banner.innerHTML =
        '<div class="wpos-sg-left">' +
          '<div class="wpos-sg-icon" id="wposSgBannerIcon"><i class="fas fa-lock"></i></div>' +
          '<div class="wpos-sg-text">' +
            '<div class="wpos-sg-title" id="wposSgBannerTitle">Shift Belum Dibuka</div>' +
            '<div class="wpos-sg-sub" id="wposSgBannerSub">Buka shift kerja dulu agar transaksi dapat diproses.</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="wpos-sg-btn" id="wposSgBannerAction"><i class="fas fa-store"></i><span>Buka Shift</span></button>';
      if (headerEl && headerEl.parentNode) {
        headerEl.parentNode.insertBefore(banner, headerEl.nextSibling);
      } else {
        mainEl.insertBefore(banner, mainEl.firstChild);
      }
      var actBtn = document.getElementById('wposSgBannerAction');
      if (actBtn) {
        actBtn.addEventListener('click', function() {
          openShiftGuardModal({ status: _shiftGuardState.status });
        });
      }
      return banner;
    }

    function updateShiftGuardUI() {
      if (typeof document === 'undefined' || !isGuardedShiftPage()) return;
      var isLocked = (_shiftGuardState.status === 'none' || _shiftGuardState.status === 'closed');
      Object.keys(GUARDED_SHIFT_BUTTON_IDS).forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.classList.toggle('wpos-shift-locked-btn', isLocked);
      });

      var banner = ensureShiftGuardBanner();
      if (!banner) return;
      var iconEl = document.getElementById('wposSgBannerIcon');
      var titleEl = document.getElementById('wposSgBannerTitle');
      var subEl = document.getElementById('wposSgBannerSub');
      var actBtn = document.getElementById('wposSgBannerAction');

      if (_shiftGuardState.status === 'none') {
        banner.className = 'is-none';
        if (iconEl) iconEl.innerHTML = '<i class="fas fa-store-slash"></i>';
        if (titleEl) titleEl.textContent = 'Shift Belum Dibuka';
        if (subEl) subEl.textContent = 'Transaksi terkunci. Buka shift kerja dulu sebelum memproses transaksi.';
        if (actBtn) actBtn.innerHTML = '<i class="fas fa-store"></i><span>Buka Shift</span>';
      } else if (_shiftGuardState.status === 'closed') {
        banner.className = 'is-closed';
        if (iconEl) iconEl.innerHTML = '<i class="fas fa-lock"></i>';
        if (titleEl) titleEl.textContent = 'Shift Hari Ini Sudah Ditutup (Closing)';
        if (subEl) subEl.textContent = 'Transaksi terkunci. Jika ada transaksi susulan, buka ulang shift lalu closing ulang setelah selesai.';
        if (actBtn) actBtn.innerHTML = '<i class="fas fa-rotate-left"></i><span>Buka Ulang Shift</span>';
      } else {
        banner.className = '';
      }
    }

    function closeShiftGuardModal() {
      var modal = (typeof document !== 'undefined') ? document.getElementById('wposShiftGuardModal') : null;
      if (modal) modal.classList.remove('open');
    }

    function openShiftGuardModal(opts) {
      if (typeof document === 'undefined') return;
      opts = opts || {};
      injectShiftGuardStyles();
      var status = opts.status || _shiftGuardState.status;
      if (status !== 'closed') status = 'none';
      _shiftGuardState.onModalSuccess = (typeof opts.onSuccess === 'function') ? opts.onSuccess : null;

      var modal = document.getElementById('wposShiftGuardModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'wposShiftGuardModal';
        modal.innerHTML =
          '<div class="wpos-sg-card" role="dialog" aria-modal="true">' +
            '<div class="wpos-sg-mhead">' +
              '<div class="wpos-sg-micon" id="wposSgModalIcon"></div>' +
              '<div class="wpos-sg-mtitle" id="wposSgModalTitle"></div>' +
            '</div>' +
            '<p class="wpos-sg-mdesc" id="wposSgModalDesc"></p>' +
            '<div class="wpos-sg-mnote" id="wposSgModalNote"></div>' +
            '<div class="wpos-sg-mactions">' +
              '<button type="button" class="wpos-sg-mbtn cancel" id="wposSgModalCancel">Nanti</button>' +
              '<button type="button" class="wpos-sg-mbtn" id="wposSgModalConfirm"></button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', function(e) {
          if (e.target === modal && !_shiftGuardState.busy) closeShiftGuardModal();
        });
        document.getElementById('wposSgModalCancel').addEventListener('click', function() {
          if (!_shiftGuardState.busy) closeShiftGuardModal();
        });
        document.getElementById('wposSgModalConfirm').addEventListener('click', async function() {
          if (_shiftGuardState.busy) return;
          var btn = document.getElementById('wposSgModalConfirm');
          var isReopenMode = btn && btn.dataset.mode === 'closed';
          _shiftGuardState.busy = true;
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>' + (isReopenMode ? 'Membuka ulang...' : 'Membuka shift...') + '</span>';
          }
            try {
            var res = await openOrReopenShift();
            closeShiftGuardModal();
            if (res && res.redirectToModal) {
              var modalMsg = 'Silakan input Modal Harian terlebih dahulu untuk membuka shift.';
              if (window.Utils && typeof window.Utils.showToast === 'function') {
                window.Utils.showToast(modalMsg, 'warning');
              } else if (typeof window.showToast === 'function') {
                window.showToast(modalMsg, 'warning');
              }
              setTimeout(function() { window.location.href = 'page-modal-harian.html'; }, 700);
              return;
            }
            var okMsg = res.reopened
              ? 'Shift berhasil dibuka ulang! Jangan lupa closing ulang setelah selesai.'
              : 'Shift kerja berhasil dibuka! Transaksi sudah bisa dilakukan.';
            if (window.Utils && typeof window.Utils.showToast === 'function') {
              window.Utils.showToast(okMsg, 'success');
            } else if (typeof window.showToast === 'function') {
              window.showToast(okMsg, 'success');
            }
            if (typeof window.loadUangGlobal === 'function') {
              try { window.loadUangGlobal(); } catch (e) {}
            }
            if (typeof _shiftGuardState.onModalSuccess === 'function') {
              var cb = _shiftGuardState.onModalSuccess;
              _shiftGuardState.onModalSuccess = null;
              await cb(res);
            }
          } catch (err) {
            var errMsg = 'Gagal membuka shift: ' + (err && err.message ? err.message : 'Terjadi kesalahan');
            if (window.Utils && typeof window.Utils.showToast === 'function') {
              window.Utils.showToast(errMsg, 'error');
            } else if (typeof window.showToast === 'function') {
              window.showToast(errMsg, 'error');
            }
          } finally {
            _shiftGuardState.busy = false;
            if (btn) btn.disabled = false;
          }
        });
      }

      var iconEl = document.getElementById('wposSgModalIcon');
      var titleEl = document.getElementById('wposSgModalTitle');
      var descEl = document.getElementById('wposSgModalDesc');
      var noteEl = document.getElementById('wposSgModalNote');
      var confirmBtn = document.getElementById('wposSgModalConfirm');

      if (status === 'closed') {
        iconEl.className = 'wpos-sg-micon closed';
        iconEl.innerHTML = '<i class="fas fa-lock"></i>';
        titleEl.textContent = 'Shift Hari Ini Sudah Ditutup';
        descEl.textContent = 'Transaksi dikunci karena shift hari ini sudah di-closing. Jika tiba-tiba ada transaksi susulan, Anda dapat membuka ulang shift ini.';
        noteEl.style.display = 'block';
        noteEl.innerHTML = '<strong>Aman:</strong> Riwayat closing sebelumnya tetap tersimpan di arsip shift, dan Anda bisa <strong>Closing Ulang</strong> setelah transaksi susulan selesai.';
        confirmBtn.className = 'wpos-sg-mbtn reopen';
        confirmBtn.dataset.mode = 'closed';
        confirmBtn.innerHTML = '<i class="fas fa-rotate-left"></i><span>Buka Ulang Shift</span>';
      } else {
        iconEl.className = 'wpos-sg-micon none';
        iconEl.innerHTML = '<i class="fas fa-store-slash"></i>';
        titleEl.textContent = 'Shift Belum Dibuka';
        descEl.textContent = 'Anda harus membuka shift kerja terlebih dahulu sebelum dapat memproses transaksi di halaman ini.';
        noteEl.style.display = 'block';
        noteEl.innerHTML = 'Modal harian yang sudah diinput hari ini akan otomatis terhubung saat shift dibuka.';
        confirmBtn.className = 'wpos-sg-mbtn primary';
        confirmBtn.dataset.mode = 'none';
        confirmBtn.innerHTML = '<i class="fas fa-store"></i><span>Buka Shift Sekarang</span>';
      }

      modal.classList.add('open');
    }

    async function refreshShiftGuard() {
      var user = getCurrentAuthUser();
      if (!user) return _shiftGuardState;
      return await getTodayShiftStatus(user.uid);
    }

    function initAutoShiftGuard() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      if (!isGuardedShiftPage()) return;
      if (window.__webposShiftGuardInit) return;
      window.__webposShiftGuardInit = true;

      var today = getShiftTodayKey();
      var cached = readShiftCache(null, today);
      if (cached && cached.status) {
        _shiftGuardState.uid = cached.uid;
        _shiftGuardState.date = today;
        _shiftGuardState.status = cached.status;
        _shiftGuardState.isOpen = (cached.status === 'open');
        _shiftGuardState.shiftId = (cached.status === 'open') ? cached.shiftId : null;
      }

      function attachUI() {
        ensureShiftGuardBanner();
        updateShiftGuardUI();
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachUI);
      } else {
        attachUI();
      }

      document.addEventListener('click', function(e) {
        var target = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!target || !target.id || !GUARDED_SHIFT_BUTTON_IDS[target.id]) return;

        var nowDate = getShiftTodayKey();
        if (_shiftGuardState.isOpen && _shiftGuardState.date === nowDate) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

        if (_shiftGuardState.status === 'checking' || _shiftGuardState.date !== nowDate) {
          refreshShiftGuard().then(function(res) {
            if (res && res.isOpen) {
              target.click();
            } else {
              openShiftGuardModal({ status: (res && res.status) || 'none' });
            }
          });
        } else {
          openShiftGuardModal({ status: _shiftGuardState.status });
        }
      }, true);

      function bindAuthCheck() {
        if (window.firebase && window.firebase.auth) {
          window.firebase.auth().onAuthStateChanged(function(user) {
            if (user && user.uid) {
              getTodayShiftStatus(user.uid);
            }
          });
        }
      }
      bindAuthCheck();

      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') refreshShiftGuard();
      });
      window.addEventListener('pageshow', function() {
        refreshShiftGuard();
      });
    }

    initAutoShiftGuard();

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
      savePayroll: savePayroll,

      // SHIFT GUARD & BUKA ULANG SHIFT (OPSI 1)
      getTodayShiftStatus: getTodayShiftStatus,
      openOrReopenShift: openOrReopenShift,
      syncShiftCache: syncShiftCache,
      openShiftGuardModal: openShiftGuardModal,
      refreshShiftGuard: refreshShiftGuard
};
  })();
}

/* Alias global untuk page lama: var KasCore = window.KasCore; */
var KasCore = window.KasCore;
