/* ============================================================
 * KAS CORE
 * ============================================================
 * SINGLE SOURCE OF TRUTH untuk:
 *
 * 1. KAS GLOBAL / UANG LACI
 * 2. TOTAL TRANSAKSI
 * 3. TOTAL PENJUALAN
 * 4. LABA
 * 5. HUTANG / PIUTANG
 * 6. SALDO BANK
 * 7. SALDO DIGITAL
 * 8. SHIFT / CLOSING
 *
 * ATURAN BERDASARKAN APPROVAL:
 *
 * MODAL AWAL
 *   - bukan transaksi
 *   - bukan penjualan
 *   - menambah kas global
 *   - bukan laba
 *
 * KAS MASUK
 *   - bukan transaksi
 *   - bukan penjualan
 *   - menambah kas global
 *   - bukan laba
 *
 * KAS KELUAR
 *   - bukan transaksi
 *   - bukan penjualan
 *   - mengurangi kas global
 *   - bukan laba
 *
 * JUAL
 *   - transaksi
 *   - penjualan
 *   - kas global tergantung metode
 *   - laba = harga jual - modal
 *   - hutang jika metode hutang
 *
 * TOP UP
 *   - transaksi
 *   - bukan penjualan
 *   - kas global sesuai pembayaran
 *   - laba = admin
 *   - hutang jika metode hutang
 *
 * TARIK TUNAI
 *   - transaksi
 *   - bukan penjualan
 *   - kas global berkurang
 *   - laba = admin
 *
 * PINJAMAN UANG
 *   - bukan transaksi
 *   - bukan penjualan
 *   - kas global berkurang
 *   - membuat hutang
 *
 * PENGEMBALIAN PINJAMAN
 *   - bukan transaksi
 *   - bukan penjualan
 *   - kas global bertambah jika dicentang
 *   - melunasi hutang
 *
 * BAYAR HUTANG
 *   - bukan transaksi baru
 *   - bukan penjualan baru
 *   - kas global hanya berubah jika dicentang
 *   - hutang berkurang
 *
 * PEMBELIAN BARANG
 *   - transaksi mengikuti kebutuhan page
 *   - bukan penjualan
 *   - kas global mengikuti checkbox
 *   - hutang mengikuti metode/aturan pembelian
 * ============================================================ */

if (typeof window.KasCore === 'undefined') {

  window.KasCore = (function () {

    "use strict";

    /* ==========================================================
     * 1. DATABASE
     * ========================================================== */

    function getDb() {

      if (
        window.db &&
        typeof window.db.collection === 'function'
      ) {
        return window.db;
      }

      if (
        window.firebase &&
        window.firebase.firestore
      ) {
        return window.firebase.firestore();
      }

      throw new Error(
        'KasCore memerlukan firebase.firestore() yang sudah diinisialisasi.'
      );
    }


    /* ==========================================================
     * 2. NORMALISASI ANGKA
     * ========================================================== */

    function normalizeNumber(value) {

      if (
        typeof value === 'number' &&
        !isNaN(value)
      ) {
        return value;
      }

      if (typeof value === 'string') {

        var cleaned = value
          .replace(/[^\d.-]/g, '');

        var parsed = Number(cleaned);

        return isNaN(parsed)
          ? 0
          : parsed;
      }

      return 0;
    }


    /* ==========================================================
     * 3. NORMALISASI BOOLEAN
     * ========================================================== */

    function normalizeBoolean(value, defaultValue) {

      if (typeof value === 'boolean') {
        return value;
      }

      if (typeof value === 'number') {
        return value !== 0;
      }

      if (typeof value === 'string') {

        var text = value
          .trim()
          .toLowerCase();

        if (
          text === 'true' ||
          text === '1' ||
          text === 'yes' ||
          text === 'ya' ||
          text === 'on'
        ) {
          return true;
        }

        if (
          text === 'false' ||
          text === '0' ||
          text === 'no' ||
          text === 'tidak' ||
          text === 'off'
        ) {
          return false;
        }
      }

      return defaultValue;
    }


    /* ==========================================================
     * 4. DATE / TIMESTAMP
     * ========================================================== */

    function parseDateValue(value) {

      if (!value) {
        return null;
      }

      if (value instanceof Date) {
        return isNaN(value.getTime())
          ? null
          : value;
      }

      if (typeof value === 'number') {

        var numberDate = new Date(value);

        return isNaN(numberDate.getTime())
          ? null
          : numberDate;
      }

      /*
       * Firestore Timestamp
       */
      if (
        value &&
        typeof value.toDate === 'function'
      ) {

        try {

          return value.toDate();

        } catch (error) {

          console.error(
            'KasCore: gagal parse Firestore Timestamp',
            error
          );

          return null;
        }
      }

      /*
       * Firestore Timestamp object lama
       */
      if (
        value &&
        typeof value.seconds === 'number'
      ) {

        return new Date(
          value.seconds * 1000
        );
      }

      var date = new Date(value);

      return isNaN(date.getTime())
        ? null
        : date;
    }


    function formatDateKey(dateValue) {

      var date = parseDateValue(dateValue);

      if (!date) {
        return '';
      }

      return [
        date.getFullYear(),
        String(
          date.getMonth() + 1
        ).padStart(2, '0'),
        String(
          date.getDate()
        ).padStart(2, '0')
      ].join('-');
    }


    function getTransactionDate(transaction) {

      return (
        transaction &&
        (
          transaction.date_key ||
          transaction.date ||
          formatDateKey(
            transaction.waktu ||
            transaction.timestamp ||
            transaction.createdAt
          )
        )
      ) || '';
    }


    /* ==========================================================
     * 5. USER / SHIFT
     * ========================================================== */

    function getUserId(transaction) {

      if (!transaction) {
        return null;
      }

      return (
        transaction.userId ||
        transaction.cashierId ||
        transaction.cashierID ||
        transaction.uid ||
        null
      );
    }


    function getShiftId(transaction) {

      return transaction
        ? (
            transaction.shiftId ||
            transaction.shift_id ||
            null
          )
        : null;
    }


    /* ==========================================================
     * 6. KATEGORI
     * ========================================================== */

    function getCategory(transaction) {

      if (!transaction) {
        return '';
      }

      var raw =
        transaction.kategori ||
        transaction.category ||
        transaction.type ||
        transaction.jenis ||
        '';

      var category = String(raw)
        .trim()
        .toLowerCase();

      /*
       * Alias lama
       */

      if (
        category === 'topup'
      ) {
        return 'top_up';
      }

      if (
        category === 'tarik'
      ) {
        return 'tarik_tunai';
      }

      if (
        category === 'penjualan'
      ) {
        return 'jual';
      }

      if (
        category === 'kas masuk'
      ) {
        return 'kas_masuk';
      }

      if (
        category === 'kas keluar'
      ) {
        return 'kas_keluar';
      }

      if (
        category === 'pinjam_uang'
      ) {
        return 'pinjaman_tunai';
      }

      if (
        category === 'pengembalian_pinjaman' ||
        category === 'kembali_pinjaman' ||
        category === 'pelunasan_pinjaman'
      ) {
        return 'pengembalian_pinjaman';
      }

      if (
        category === 'pembelian_barang'
      ) {
        return 'pembelian';
      }

      return category;
    }


    /* ==========================================================
     * 7. METODE PEMBAYARAN
     * ========================================================== */

    function getPaymentMethod(transaction) {

      if (!transaction) {
        return '';
      }

      var raw =
        transaction.metode_pembayaran ||
        transaction.paymentMethod ||
        transaction.metode ||
        '';

      var method = String(raw)
        .trim()
        .toLowerCase();

      if (
        method === 'cash'
      ) {
        return 'tunai';
      }

      if (
        method === 'qris'
      ) {
        return 'qris';
      }

      if (
        method === 'bank'
      ) {
        return 'transfer';
      }

      if (
        method === 'hutang'
      ) {
        return 'utang';
      }

      return method;
    }


    /* ==========================================================
     * 8. STATUS TRANSAKSI
     * ========================================================== */

    function isValidTransaction(transaction) {

      if (!transaction) {
        return false;
      }

      var status = String(
        transaction.status || ''
      )
        .trim()
        .toLowerCase();

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

      if (!transaction) {
        return false;
      }

      /*
       * Prioritas field yang digunakan page.
       */

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

      for (
        var i = 0;
        i < possibleFields.length;
        i++
      ) {

        var field =
          possibleFields[i];

        if (
          Object.prototype.hasOwnProperty.call(
            transaction,
            field
          )
        ) {

          return normalizeBoolean(
            transaction[field],
            false
          );
        }
      }

      /*
       * Default berdasarkan approval.
       */

      var category =
        getCategory(transaction);

      var method =
        getPaymentMethod(transaction);

      switch (category) {

        case 'modal_awal':
          return true;

        case 'kas_masuk':
          return true;

        case 'kas_keluar':
          return true;

        case 'jual':
          /*
           * Jual tunai masuk laci.
           * QRIS / transfer masuk bank.
           * Hutang belum ada uang.
           */
          return method === 'tunai';

        case 'top_up':
          return method === 'tunai';

        case 'tarik_tunai':
          return method === 'tunai';

        case 'pinjaman_tunai':
          return true;

        case 'pengembalian_pinjaman':
          return true;

        case 'bayar_hutang':
          /*
           * Approval:
           * uang hanya masuk kas jika dicentang.
           */
          return false;

        case 'pembelian':
          /*
           * Pembelian harus mengikuti checkbox.
           * Jika belum ada field checkbox,
           * jangan otomatis mengubah kas.
           */
          return false;

        default:
          return false;
      }
    }


    /* ==========================================================
     * 10. APAKAH MASUK TOTAL TRANSAKSI?
     * ========================================================== */

    function isIncludedInTransactions(transaction) {

      if (!transaction) {
        return false;
      }

      /*
       * Bila page secara eksplisit menentukan,
       * gunakan nilai tersebut.
       */

      var explicitFields = [
        'masuk_transaksi',
        'masukTransaksi',
        'is_transaction',
        'isTransaction',
        'affects_transaction',
        'affectsTransaction'
      ];

      for (
        var i = 0;
        i < explicitFields.length;
        i++
      ) {

        var field =
          explicitFields[i];

        if (
          Object.prototype.hasOwnProperty.call(
            transaction,
            field
          )
        ) {

          return normalizeBoolean(
            transaction[field],
            false
          );
        }
      }

      var category =
        getCategory(transaction);

      switch (category) {

        case 'jual':
          return true;

        case 'top_up':
          return true;

        case 'tarik_tunai':
          return true;

        /*
         * Pembelian:
         * mengikuti kebutuhan page.
         * Tanpa flag → tidak dihitung.
         */
        case 'pembelian':
          return false;

        /*
         * Semua berikut bukan transaksi bisnis.
         */
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

      return (
        getCategory(transaction) === 'jual'
      );
    }


    /* ==========================================================
     * 12. NILAI PENJUALAN
     * ========================================================== */

    function getNominal(transaction) {

      if (!transaction) {
        return 0;
      }

      return normalizeNumber(
        transaction.nominal ??
        transaction.total ??
        transaction.harga_jual ??
        transaction.hargaJual ??
        transaction.amount ??
        transaction.nilai ??
        0
      );
    }


    function getModalProduk(transaction) {

      if (!transaction) {
        return 0;
      }

      return normalizeNumber(
        transaction.modal_produk ??
        transaction.modalProduk ??
        transaction.modal ??
        transaction.harga_modal ??
        transaction.hargaModal ??
        0
      );
    }


    function getAdmin(transaction) {

      if (!transaction) {
        return 0;
      }

      return normalizeNumber(
        transaction.admin ??
        transaction.biaya_admin ??
        transaction.fee ??
        0
      );
    }


    function getSaleAmount(transaction) {

      return getNominal(transaction);
    }


    /* ==========================================================
     * 13. HITUNG LABA TRANSAKSI
     * ========================================================== */

    function calculateTransactionProfit(transaction) {

      if (!transaction) {
        return 0;
      }

      var category =
        getCategory(transaction);

      /*
       * Jika page sudah menyimpan laba final,
       * gunakan nilai tersebut.
       *
       * Ini penting untuk menjaga kompatibilitas
       * dengan data lama.
       */
      if (
        transaction.laba !== undefined &&
        transaction.laba !== null &&
        transaction.laba !== ''
      ) {

        return normalizeNumber(
          transaction.laba
        );
      }

      var nominal =
        getNominal(transaction);

      var modal =
        getModalProduk(transaction);

      var admin =
        getAdmin(transaction);

      switch (category) {

        /*
         * Penjualan:
         * Harga jual - modal.
         *
         * Termasuk penjualan hutang.
         * Karena pada approval Jual Hutang
         * tetap masuk laba.
         */
        case 'jual':
          return nominal - modal;

        /*
         * Top Up:
         * laba = admin.
         *
         * Untuk top_up hutang:
         * approval mengatakan laba mengikuti pelunasan.
         * Jadi transaksi awal tidak otomatis dianggap
         * menerima laba jika belum dilunasi.
         */
        case 'top_up':

          if (
            getPaymentMethod(transaction) === 'utang'
          ) {

            /*
             * Jika page pelunasan sudah memberikan
             * laba/admin pada dokumen pelunasan,
             * gunakan field tersebut.
             */
            if (
              transaction.laba_pelunasan !== undefined
            ) {

              return normalizeNumber(
                transaction.laba_pelunasan
              );
            }

            return 0;
          }

          return admin;

        /*
         * Tarik Tunai:
         * laba = admin.
         */
        case 'tarik_tunai':
          return admin;

        /*
         * Pembelian:
         * mengikuti aturan pembelian.
         *
         * Kita tidak mengarang rumus.
         * Jika page menyimpan laba, gunakan itu.
         * Jika tidak, default 0.
         */
        case 'pembelian':
          return 0;

        default:
          return 0;
      }
    }


    /* ==========================================================
     * 14. MAPPER MUTASI
     *
     * Fungsi ini digunakan ketika PAGE membuat transaksi.
     *
     * Input:
     *
     * {
     *   kategori,
     *   metode_pembayaran,
     *   nominal,
     *   admin,
     *   modal_produk,
     *   pengaruhi_kas_global,
     *   ...
     * }
     *
     * Output:
     *
     * {
     *   cash_in,
     *   cash_out,
     *   bank_in,
     *   bank_out,
     *   digital_in,
     *   digital_out,
     *   ...
     * }
     * ========================================================== */

    function mapTransactionMutation(payload) {

      payload = payload || {};

      var category =
        getCategory(payload);

      var method =
        getPaymentMethod(payload);

      var nominal =
        normalizeNumber(
          payload.nominal
        );

      var admin =
        normalizeNumber(
          payload.admin
        );

      var modalProduk =
        normalizeNumber(
          payload.modal_produk ??
          payload.modalProduk ??
          payload.modal ??
          0
        );

      var affectsCashGlobal =
        getAffectsCashGlobal(payload);

      var result = {

        kategori: category,

        metode_pembayaran:
          method,

        nominal:
          nominal,

        admin:
          admin,

        modal_produk:
          modalProduk,

        cash_in: 0,
        cash_out: 0,

        bank_in: 0,
        bank_out: 0,

        digital_in: 0,
        digital_out: 0,

        laba: 0,

        masuk_transaksi:
          isIncludedInTransactions(payload),

        masuk_penjualan:
          isSaleTransaction(payload),

        pengaruhi_kas_global:
          affectsCashGlobal
      };


      switch (category) {

        /* ======================================================
         * MODAL AWAL
         * ====================================================== */

        case 'modal_awal':

          /*
           * Modal awal idealnya disimpan di collection
           * "modal", bukan transactions.
           */
          result.cash_in =
            nominal;

          result.masuk_transaksi =
            false;

          result.masuk_penjualan =
            false;

          result.laba =
            0;

          break;


        /* ======================================================
         * KAS MASUK
         * ====================================================== */

        case 'kas_masuk':

          result.cash_in =
            nominal;

          result.masuk_transaksi =
            false;

          result.masuk_penjualan =
            false;

          result.laba =
            0;

          break;


        /* ======================================================
         * KAS KELUAR
         * ====================================================== */

        case 'kas_keluar':

          result.cash_out =
            nominal;

          result.masuk_transaksi =
            false;

          result.masuk_penjualan =
            false;

          result.laba =
            0;

          break;


        /* ======================================================
         * JUAL
         * ====================================================== */

        case 'jual':

          /*
           * Modal produk keluar dari saldo digital.
           */
          if (modalProduk > 0) {

            result.digital_out =
              modalProduk;
          }

          /*
           * Pembayaran tunai.
           */
          if (method === 'tunai') {

            result.cash_in =
              nominal;
          }

          /*
           * QRIS / transfer masuk bank.
           */
          else if (
            method === 'qris' ||
            method === 'transfer'
          ) {

            result.bank_in =
              nominal;
          }

          /*
           * Hutang:
           *
           * TIDAK ada cash_in.
           * TIDAK ada bank_in.
           *
           * Karena uang belum diterima.
           */
          else if (method === 'utang') {

            result.cash_in =
              0;

            result.bank_in =
              0;
          }

          result.masuk_transaksi =
            true;

          result.masuk_penjualan =
            true;

          result.laba =
            nominal - modalProduk;

          break;


        /* ======================================================
         * TOP UP
         * ====================================================== */

        case 'top_up':

          /*
           * Saldo agen/digital berkurang.
           */
          result.digital_out =
            nominal;

          /*
           * Tunai:
           * nominal + admin masuk kas global.
           */
          if (method === 'tunai') {

            result.cash_in =
              nominal + admin;
          }

          /*
           * QRIS / transfer:
           * nominal + admin masuk bank.
           */
          else if (
            method === 'qris' ||
            method === 'transfer'
          ) {

            result.bank_in =
              nominal + admin;
          }

          /*
           * Hutang:
           * belum ada uang diterima.
           */
          else if (method === 'utang') {

            result.cash_in =
              0;

            result.bank_in =
              0;
          }

          result.masuk_transaksi =
            true;

          result.masuk_penjualan =
            false;

          /*
           * Top Up hutang:
           * laba mengikuti pelunasan.
           */
          result.laba =
            method === 'utang'
              ? 0
              : admin;

          break;


        /* ======================================================
         * TARIK TUNAI
         * ====================================================== */

        case 'tarik_tunai':

          /*
           * Saldo digital bertambah.
           */
          result.digital_in =
            nominal;

          /*
           * Tunai:
           *
           * Kas berkurang sebesar:
           *
           * nominal - admin
           */
          if (method === 'tunai') {

            result.cash_out =
              Math.max(
                0,
                nominal - admin
              );
          }

          /*
           * Transfer:
           *
           * Bank berkurang sebesar:
           *
           * nominal - admin
           */
          else if (
            method === 'transfer'
          ) {

            result.bank_out =
              Math.max(
                0,
                nominal - admin
              );
          }

          result.masuk_transaksi =
            true;

          result.masuk_penjualan =
            false;

          result.laba =
            admin;

          break;


        /* ======================================================
         * BAYAR HUTANG
         * ====================================================== */

        case 'bayar_hutang':

          /*
           * Ini BUKAN penjualan baru.
           * Ini BUKAN transaksi baru.
           *
           * Uang hanya masuk jika checkbox
           * pengaruhi kas global dicentang.
           */

          if (affectsCashGlobal) {

            if (method === 'tunai') {

              result.cash_in =
                nominal;
            }

            else if (
              method === 'qris' ||
              method === 'transfer'
            ) {

              result.bank_in =
                nominal;
            }
          }

          result.masuk_transaksi =
            false;

          result.masuk_penjualan =
            false;

          result.laba =
            0;

          break;


        /* ======================================================
         * PINJAMAN UANG
         * ====================================================== */

        case 'pinjaman_tunai':

          /*
           * Uang keluar dari laci.
           */
          result.cash_out =
            nominal;

          result.masuk_transaksi =
            false;

          result.masuk_penjualan =
            false;

          result.laba =
            0;

          break;


        /* ======================================================
         * PENGEMBALIAN PINJAMAN
         * ====================================================== */

        case 'pengembalian_pinjaman':

          /*
           * Bukan penjualan.
           * Bukan transaksi.
           *
           * Uang bertambah jika memang dimasukkan
           * ke kas global.
           */

          if (affectsCashGlobal) {

            if (method === 'tunai' || !method) {

              result.cash_in =
                nominal;
            }

            else if (
              method === 'qris' ||
              method === 'transfer'
            ) {

              result.bank_in =
                nominal;
            }
          }

          result.masuk_transaksi =
            false;

          result.masuk_penjualan =
            false;

          result.laba =
            0;

          break;


        /* ======================================================
         * PEMBELIAN
         * ====================================================== */

        case 'pembelian':

          /*
           * Pembelian bukan penjualan.
           *
           * Pengaruh kas mengikuti checkbox.
           */

          if (affectsCashGlobal) {

            if (method === 'tunai') {

              result.cash_out =
                nominal;
            }

            else if (
              method === 'qris' ||
              method === 'transfer'
            ) {

              result.bank_out =
                nominal;
            }
          }

          result.masuk_penjualan =
            false;

          /*
           * Transaksi mengikuti field page.
           */
          result.masuk_transaksi =
            isIncludedInTransactions(payload);

          /*
           * Tidak mengarang laba.
           */
          result.laba =
            normalizeNumber(
              payload.laba || 0
            );

          break;


        /* ======================================================
         * DEFAULT
         * ====================================================== */

        default:

          /*
           * Untuk kategori baru,
           * jangan otomatis menganggap sebagai penjualan.
           */
          result.masuk_transaksi =
            false;

          result.masuk_penjualan =
            false;

          result.laba =
            normalizeNumber(
              payload.laba || 0
            );

          break;
      }


      return result;
    }


    /* ==========================================================
     * 15. CLASSIFICATION TRANSAKSI
     * ========================================================== */

    function classifyTransaction(transaction) {

      var category =
        getCategory(transaction);

      var method =
        getPaymentMethod(transaction);

      var classification = {

        category:
          category,

        paymentMethod:
          method,

        isTransaction:
          isIncludedInTransactions(
            transaction
          ),

        isSale:
          isSaleTransaction(
            transaction
          ),

        affectsCashGlobal:
          getAffectsCashGlobal(
            transaction
          ),

        affectsProfit:
          false,

        affectsDebt:
          false,

        isDebtSettlement:
          false,

        isCashFlow:
          false,

        isOperational:
          false,

        isFinancialDebt:
          false,

        isPurchase:
          false,

        isTopUp:
          category === 'top_up',

        isWithdrawal:
          category === 'tarik_tunai'
      };


      switch (category) {

        case 'modal_awal':

          classification.isCashFlow =
            true;

          break;


        case 'kas_masuk':

          classification.isCashFlow =
            true;

          break;


        case 'kas_keluar':

          classification.isCashFlow =
            true;

          classification.isOperational =
            true;

          break;


        case 'jual':

          classification.affectsProfit =
            true;

          classification.affectsDebt =
            method === 'utang';

          break;


        case 'top_up':

          classification.affectsProfit =
            method !== 'utang';

          classification.affectsDebt =
            method === 'utang';

          break;


        case 'tarik_tunai':

          classification.affectsProfit =
            true;

          break;


        case 'bayar_hutang':

          classification.affectsDebt =
            true;

          classification.isDebtSettlement =
            true;

          break;


        case 'pinjaman_tunai':

          classification.affectsDebt =
            true;

          classification.isFinancialDebt =
            true;

          break;


        case 'pengembalian_pinjaman':

          classification.affectsDebt =
            true;

          classification.isDebtSettlement =
            true;

          classification.isFinancialDebt =
            true;

          break;


        case 'pembelian':

          classification.isPurchase =
            true;

          break;
      }


      return classification;
    }


    /* ==========================================================
     * 16. MATCH FILTER
     * ========================================================== */

    function matchesTransactionFilters(
      transaction,
      filters
    ) {

      if (!transaction) {
        return false;
      }

      filters =
        filters || {};

      if (
        filters.userId &&
        getUserId(transaction) !==
        filters.userId
      ) {

        return false;
      }

      if (
        filters.shiftId &&
        getShiftId(transaction) !==
        filters.shiftId
      ) {

        return false;
      }

      if (
        filters.category &&
        getCategory(transaction) !==
        String(filters.category)
          .toLowerCase()
      ) {

        return false;
      }

      if (
        filters.paymentMethod &&
        getPaymentMethod(transaction) !==
        String(filters.paymentMethod)
          .toLowerCase()
      ) {

        return false;
      }

      return true;
    }


    /* ==========================================================
     * 17. CREATE SUMMARY
     * ========================================================== */

    function createSummary(transactions) {

      var list =
        Array.isArray(transactions)
          ? transactions.slice()
          : [];


      var summary = {

        transactions:
          list,

        validTransactions:
          [],

        /*
         * ======================================================
         * KAS GLOBAL
         * ======================================================
         */

        cashGlobalIn:
          0,

        cashGlobalOut:
          0,

        saldoKasGlobal:
          0,

        /*
         * ======================================================
         * BANK
         * ======================================================
         */

        totalBankIn:
          0,

        totalBankOut:
          0,

        saldoBank:
          0,

        /*
         * ======================================================
         * DIGITAL
         * ======================================================
         */

        totalDigitalIn:
          0,

        totalDigitalOut:
          0,

        saldoDigital:
          0,

        /*
         * ======================================================
         * TRANSAKSI
         * ======================================================
         */

        transactionCount:
          0,

        /*
         * ======================================================
         * PENJUALAN
         * ======================================================
         */

        salesCount:
          0,

        totalSales:
          0,

        salesCash:
          0,

        salesQris:
          0,

        salesTransfer:
          0,

        salesCredit:
          0,

        /*
         * ======================================================
         * LABA
         * ======================================================
         */

        totalProfit:
          0,

        salesProfit:
          0,

        topupProfit:
          0,

        withdrawalProfit:
          0,

        purchaseProfit:
          0,

        /*
         * ======================================================
         * PAYMENT METHODS
         * ======================================================
         */

        paymentMethods: {

          tunai:
            0,

          qris:
            0,

          transfer:
            0,

          utang:
            0,

          lainnya:
            0
        },

        /*
         * ======================================================
         * TOP UP
         * ======================================================
         */

        topup:
          0,

        topupAdmin:
          0,

        /*
         * ======================================================
         * TARIK
         * ======================================================
         */

        withdrawal:
          0,

        withdrawalAdmin:
          0,

        /*
         * ======================================================
         * HUTANG
         * ======================================================
         */

        debtCreated:
          0,

        debtSettled:
          0,

        /*
         * ======================================================
         * KAS FLOW
         * ======================================================
         */

        cashFlowIn:
          0,

        cashFlowOut:
          0,

        operationalCashOut:
          0,

        /*
         * ======================================================
         * BACKWARD COMPATIBILITY
         * ======================================================
         */

        cashIn:
          0,

        cashOut:
          0,

        totalCashIn:
          0,

        totalCashOut:
          0,

        totalCashInDrawer:
          0,

        totalCashOutDrawer:
          0,

        netCashFlow:
          0,

        salesProfit:
          0,

        cashSales:
          0,

        topup:
          0,

        topupAdmin:
          0,

        withdrawal:
          0,

        withdrawalAdmin:
          0
      };


      list.forEach(function (tx) {

        if (
          !isValidTransaction(tx)
        ) {

          return;
        }


        summary.validTransactions.push(
          tx
        );


        var classification =
          classifyTransaction(tx);


        var category =
          classification.category;

        var method =
          classification.paymentMethod;


        /*
         * ======================================================
         * MUTASI BAKU DARI DATABASE
         * ======================================================
         */

        var cashIn =
          normalizeNumber(
            tx.cash_in
          );

        var cashOut =
          normalizeNumber(
            tx.cash_out
          );

        var bankIn =
          normalizeNumber(
            tx.bank_in
          );

        var bankOut =
          normalizeNumber(
            tx.bank_out
          );

        var digitalIn =
          normalizeNumber(
            tx.digital_in
          );

        var digitalOut =
          normalizeNumber(
            tx.digital_out
          );


        /*
         * ======================================================
         * KAS GLOBAL
         *
         * PENTING:
         *
         * Kita memakai cash_in/cash_out yang memang sudah
         * dibentuk oleh mapper.
         *
         * Jadi Kas Masuk bisa menambah kas tanpa menjadi
         * transaksi atau penjualan.
         * ======================================================
         */

        summary.cashGlobalIn +=
          cashIn;

        summary.cashGlobalOut +=
          cashOut;


        /*
         * ======================================================
         * BANK
         * ======================================================
         */

        summary.totalBankIn +=
          bankIn;

        summary.totalBankOut +=
          bankOut;


        /*
         * ======================================================
         * DIGITAL
         * ======================================================
         */

        summary.totalDigitalIn +=
          digitalIn;

        summary.totalDigitalOut +=
          digitalOut;


        /*
         * ======================================================
         * TOTAL TRANSAKSI
         * ======================================================
         */

        if (
          classification.isTransaction
        ) {

          summary.transactionCount++;
        }


        /*
         * ======================================================
         * PENJUALAN
         * ======================================================
         */

        if (
          classification.isSale
        ) {

          var saleAmount =
            getSaleAmount(tx);


          summary.salesCount++;

          summary.totalSales +=
            saleAmount;


          if (
            method === 'tunai'
          ) {

            summary.salesCash +=
              saleAmount;
          }

          else if (
            method === 'qris'
          ) {

            summary.salesQris +=
              saleAmount;
          }

          else if (
            method === 'transfer'
          ) {

            summary.salesTransfer +=
              saleAmount;
          }

          else if (
            method === 'utang'
          ) {

            summary.salesCredit +=
              saleAmount;
          }


          /*
           * Laba penjualan
           */
          var salesProfit =
            calculateTransactionProfit(
              tx
            );


          summary.salesProfit +=
            salesProfit;

          summary.totalProfit +=
            salesProfit;
        }


        /*
         * ======================================================
         * TOP UP
         * ======================================================
         */

        if (
          category === 'top_up'
        ) {

          var topupNominal =
            getNominal(tx);

          var topupAdmin =
            getAdmin(tx);


          summary.topup +=
            topupNominal;


          /*
           * Admin hanya dianggap laba jika:
           *
           * - transaksi bukan hutang
           * - atau page pelunasan menyimpan laba
           */
          var topupProfit =
            calculateTransactionProfit(
              tx
            );


          summary.topupAdmin +=
            topupProfit;

          summary.topupProfit +=
            topupProfit;

          summary.totalProfit +=
            topupProfit;
        }


        /*
         * ======================================================
         * TARIK TUNAI
         * ======================================================
         */

        if (
          category === 'tarik_tunai'
        ) {

          var withdrawalNominal =
            getNominal(tx);

          var withdrawalAdmin =
            getAdmin(tx);


          summary.withdrawal +=
            withdrawalNominal;


          summary.withdrawalAdmin +=
            withdrawalAdmin;


          summary.withdrawalProfit +=
            withdrawalAdmin;


          summary.totalProfit +=
            withdrawalAdmin;
        }


        /*
         * ======================================================
         * HUTANG
         * ======================================================
         */

        if (
          classification.affectsDebt
        ) {

          /*
           * Pinjaman / hutang baru
           */
          if (
            category === 'pinjaman_tunai' ||
            (
              category === 'jual' &&
              method === 'utang'
            ) ||
            (
              category === 'top_up' &&
              method === 'utang'
            )
          ) {

            summary.debtCreated +=
              getNominal(tx);
          }


          /*
           * Pelunasan
           */
          if (
            classification.isDebtSettlement
          ) {

            summary.debtSettled +=
              getNominal(tx);
          }
        }


        /*
         * ======================================================
         * PAYMENT METHODS
         *
         * HANYA PENJUALAN / AKTIVITAS YANG RELEVAN
         * ======================================================
         */

        if (
          classification.isTransaction
        ) {

          if (
            method === 'tunai'
          ) {

            summary.paymentMethods.tunai +=
              getNominal(tx);
          }

          else if (
            method === 'qris'
          ) {

            summary.paymentMethods.qris +=
              getNominal(tx);
          }

          else if (
            method === 'transfer'
          ) {

            summary.paymentMethods.transfer +=
              getNominal(tx);
          }

          else if (
            method === 'utang'
          ) {

            summary.paymentMethods.utang +=
              getNominal(tx);
          }

          else {

            summary.paymentMethods.lainnya +=
              getNominal(tx);
          }
        }


        /*
         * ======================================================
         * CASH FLOW
         * ======================================================
         */

        if (
          category === 'kas_masuk' ||
          category === 'modal_awal' ||
          category === 'pengembalian_pinjaman'
        ) {

          summary.cashFlowIn +=
            cashIn;
        }


        if (
          category === 'kas_keluar' ||
          category === 'pinjaman_tunai'
        ) {

          summary.cashFlowOut +=
            cashOut;
        }


        if (
          category === 'kas_keluar'
        ) {

          summary.operationalCashOut +=
            cashOut;
        }


        /*
         * ======================================================
         * PEMBELIAN
         * ======================================================
         */

        if (
          category === 'pembelian'
        ) {

          var purchaseProfit =
            calculateTransactionProfit(
              tx
            );

          summary.purchaseProfit +=
            purchaseProfit;

          summary.totalProfit +=
            purchaseProfit;
        }

      });


      /*
       * ========================================================
       * HASIL AKHIR KAS GLOBAL
       * ========================================================
       */

      summary.saldoKasGlobal =
        summary.cashGlobalIn -
        summary.cashGlobalOut;


      /*
       * ========================================================
       * BANK
       * ========================================================
       */

      summary.saldoBank =
        summary.totalBankIn -
        summary.totalBankOut;


      /*
       * ========================================================
       * DIGITAL
       * ========================================================
       */

      summary.saldoDigital =
        summary.totalDigitalIn -
        summary.totalDigitalOut;


      /*
       * ========================================================
       * ALIAS BACKWARD COMPATIBILITY
       * ========================================================
       */

      summary.cashIn =
        summary.cashGlobalIn;

      summary.cashOut =
        summary.cashGlobalOut;

      summary.totalCashIn =
        summary.cashGlobalIn;

      summary.totalCashOut =
        summary.cashGlobalOut;

      summary.totalCashInDrawer =
        summary.cashGlobalIn;

      summary.totalCashOutDrawer =
        summary.cashGlobalOut;

      summary.netCashFlow =
        summary.saldoKasGlobal;

      summary.cashSales =
        summary.salesCash;


      /*
       * ========================================================
       * PROPERTI LAMA
       * ========================================================
       */

      summary.topup =
        summary.topup;

      summary.topupAdmin =
        summary.topupAdmin;

      summary.withdrawal =
        summary.withdrawal;

      summary.withdrawalAdmin =
        summary.withdrawalAdmin;


      /*
       * ========================================================
       * ALIAS YANG SERING DIPAKAI UI
       * ========================================================
       */

      summary.saldoLaciSeharusnya =
        summary.saldoKasGlobal;

      summary.saldoBankSeharusnya =
        summary.saldoBank;

      summary.mutasiSaldoDigital =
        summary.saldoDigital;


      return summary;
    }


    /* ==========================================================
     * 18. DATE RANGE
     * ========================================================== */

    function buildDateRangeList(
      startDate,
      endDate
    ) {

      var dates = [];

      var current =
        parseDateValue(
          startDate + 'T00:00:00'
        );

      var last =
        parseDateValue(
          endDate + 'T00:00:00'
        );


      if (
        !current ||
        !last
      ) {

        return dates;
      }


      while (
        current.getTime() <=
        last.getTime()
      ) {

        dates.push(
          formatDateKey(current)
        );

        current.setDate(
          current.getDate() + 1
        );
      }


      return dates;
    }


    /* ==========================================================
     * 19. LOAD TRANSACTIONS
     * ========================================================== */

    async function loadTransactionsByRange(
      startDate,
      endDate
    ) {

      var db =
        getDb();


      if (
        !startDate ||
        !endDate
      ) {

        return [];
      }


      /*
       * PRIMARY:
       *
       * date_key
       */

      try {

        var query =
          db.collection(
            'transactions'
          );


        if (
          startDate === endDate
        ) {

          query =
            query.where(
              'date_key',
              '==',
              startDate
            );

        } else {

          query =
            query
              .where(
                'date_key',
                '>=',
                startDate
              )
              .where(
                'date_key',
                '<=',
                endDate
              );
        }


        var snapshot =
          await query.get();


        var transactions =
          [];


        snapshot.forEach(
          function (doc) {

            transactions.push(
              Object.assign(
                {
                  id: doc.id
                },
                doc.data()
              )
            );
          }
        );


        return transactions;


      } catch (error) {

        console.warn(
          'KasCore: query date_key gagal, menggunakan fallback date.',
          error
        );


        /*
         * FALLBACK DATA LAMA
         */

        try {

          var fallbackQuery =
            db.collection(
              'transactions'
            );


          if (
            startDate === endDate
          ) {

            fallbackQuery =
              fallbackQuery.where(
                'date',
                '==',
                startDate
              );

          } else {

            fallbackQuery =
              fallbackQuery
                .where(
                  'date',
                  '>=',
                  startDate
                )
                .where(
                  'date',
                  '<=',
                  endDate
                );
          }


          var fallbackSnapshot =
            await fallbackQuery.get();


          var fallbackTransactions =
            [];


          fallbackSnapshot.forEach(
            function (doc) {

              fallbackTransactions.push(
                Object.assign(
                  {
                    id: doc.id
                  },
                  doc.data()
                )
              );
            }
          );


          return fallbackTransactions;


        } catch (fallbackError) {

          console.error(
            'KasCore: fallback query gagal.',
            fallbackError
          );

          return [];
        }
      }
    }


    /* ==========================================================
     * 20. GET TRANSACTIONS BY RANGE
     * ========================================================== */

    async function getTransactionsByDateRange(
      options
    ) {

      options =
        options || {};


      var startDate =
        options.startDate;

      var endDate =
        options.endDate;


      var transactions =
        await loadTransactionsByRange(
          startDate,
          endDate
        );


      return transactions

        .filter(
          function (transaction) {

            return matchesTransactionFilters(
              transaction,
              {
                userId:
                  options.userId,

                shiftId:
                  options.shiftId,

                category:
                  options.category,

                paymentMethod:
                  options.paymentMethod
              }
            );
          }
        )

        .sort(
          function (a, b) {

            var timeA =
              parseDateValue(
                a.waktu ||
                a.timestamp ||
                a.createdAt
              );

            var timeB =
              parseDateValue(
                b.waktu ||
                b.timestamp ||
                b.createdAt
              );


            return (
              timeB
                ? timeB.getTime()
                : 0
            ) -
            (
              timeA
                ? timeA.getTime()
                : 0
            );
          }
        );
    }


    /* ==========================================================
     * 21. MODAL
     * ========================================================== */

    async function loadModalEntry(
      date,
      userId
    ) {

      var db =
        getDb();


      if (!userId) {
        return null;
      }


      try {

        var directDoc =
          await db
            .collection('modal')
            .doc(
              date + '_' + userId
            )
            .get();


        if (
          directDoc.exists
        ) {

          return Object.assign(
            {
              id: directDoc.id
            },
            directDoc.data()
          );
        }


      } catch (error) {

        console.error(
          'KasCore: gagal membaca modal harian.',
          error
        );
      }


      return null;
    }


    async function getModalSummary(
      options
    ) {

      options =
        options || {};


      var date =
        options.date;

      var userId =
        options.userId;


      var db =
        getDb();


      if (!date) {

        return {
          date: '',
          entries: [],
          total: 0
        };
      }


      /*
       * USER SPESIFIK
       */

      if (userId) {

        var entry =
          await loadModalEntry(
            date,
            userId
          );


        var amount =
          normalizeNumber(
            entry &&
            entry.amount
          );


        return {

          date:
            date,

          entries:
            entry
              ? [entry]
              : [],

          total:
            amount
        };
      }


      /*
       * SEMUA USER
       */

      try {

        var snapshot =
          await db
            .collection('modal')
            .where(
              'date',
              '==',
              date
            )
            .get();


        var entries =
          [];


        snapshot.forEach(
          function (doc) {

            entries.push(
              Object.assign(
                {
                  id: doc.id
                },
                doc.data()
              )
            );
          }
        );


        return {

          date:
            date,

          entries:
            entries,

          total:
            entries.reduce(
              function (
                sum,
                entry
              ) {

                return (
                  sum +
                  normalizeNumber(
                    entry.amount
                  )
                );
              },
              0
            )
        };


      } catch (error) {

        console.error(
          'KasCore: gagal mengambil modal summary.',
          error
        );


        return {

          date:
            date,

          entries:
            [],

          total:
            0
        };
      }
    }


    /* ==========================================================
     * 22. DAILY SUMMARY
     * ========================================================== */

    async function getDailySummary(
      options
    ) {

      options =
        options || {};


      return getPeriodSummary({

        startDate:
          options.date,

        endDate:
          options.date,

        userId:
          options.userId,

        shiftId:
          options.shiftId
      });
    }


    /* ==========================================================
     * 23. PERIOD SUMMARY
     * ========================================================== */

    async function getPeriodSummary(
      options
    ) {

      options =
        options || {};


      var startDate =
        options.startDate;

      var endDate =
        options.endDate;


      var transactions =
        await getTransactionsByDateRange({

          startDate:
            startDate,

          endDate:
            endDate,

          userId:
            options.userId,

          shiftId:
            options.shiftId,

          category:
            options.category,

          paymentMethod:
            options.paymentMethod
        });


      var summary =
        createSummary(
          transactions
        );


      summary.startDate =
        startDate;

      summary.endDate =
        endDate;

      summary.userId =
        options.userId || null;

      summary.shiftId =
        options.shiftId || null;


      return summary;
    }


    /* ==========================================================
     * 24. KAS FISIK LACI
     * ========================================================== */

    function calculateKasFisikLaciFromSummary(
      modalAwal,
      summary
    ) {

      var safeSummary =
        summary ||
        createSummary([]);


      var normalizedModal =
        normalizeNumber(
          modalAwal
        );


      /*
       * Modal awal
       *
       * +
       *
       * seluruh mutasi kas global
       */

      var totalKasFisikDiLaci =
        normalizedModal +
        safeSummary.saldoKasGlobal;


      return {

        modalAwal:
          normalizedModal,

        cashIn:
          safeSummary.cashGlobalIn,

        cashOut:
          safeSummary.cashGlobalOut,

        saldoLaciSeharusnya:
          safeSummary.saldoKasGlobal,

        totalKasFisikDiLaci:
          totalKasFisikDiLaci,

        /*
         * Backward compatibility
         */

        topupKasFisik:
          safeSummary.topup,

        tarikKasFisik:
          safeSummary.withdrawal,

        total:
          totalKasFisikDiLaci
      };
    }


    /* ==========================================================
     * 25. GET KAS FISIK LACI
     * ========================================================== */

    async function getKasFisikLaci(
      options
    ) {

      options =
        options || {};


      var date =
        options.date;

      var userId =
        options.userId;

      var shiftId =
        options.shiftId;


      /*
       * Modal awal
       */

      var modalSummary =
        await getModalSummary({

          date:
            date,

          userId:
            userId
        });


      /*
       * Mutasi harian
       */

      var summary =
        await getDailySummary({

          date:
            date,

          userId:
            userId,

          shiftId:
            shiftId
        });


      /*
       * Kas fisik
       */

      var kasFisik =
        calculateKasFisikLaciFromSummary(
          modalSummary.total,
          summary
        );


      return {

        date:
          date,

        userId:
          userId || null,

        shiftId:
          shiftId || null,

        modalAwal:
          kasFisik.modalAwal,

        cashIn:
          summary.cashGlobalIn,

        cashOut:
          summary.cashGlobalOut,

        bankIn:
          summary.totalBankIn,

        bankOut:
          summary.totalBankOut,

        digitalIn:
          summary.totalDigitalIn,

        digitalOut:
          summary.totalDigitalOut,

        saldoKasGlobal:
          summary.saldoKasGlobal,

        saldoLaciSeharusnya:
          summary.saldoKasGlobal,

        saldoBank:
          summary.saldoBank,

        saldoBankSeharusnya:
          summary.saldoBank,

        mutasiSaldoDigital:
          summary.saldoDigital,

        totalKasFisikDiLaci:
          kasFisik.totalKasFisikDiLaci,

        totalLaba:
          summary.totalProfit,

        totalPenjualan:
          summary.totalSales,

        totalTransaksi:
          summary.transactionCount,

        /*
         * Alias lama
         */

        total:
          kasFisik.totalKasFisikDiLaci,

        summary:
          summary
      };
    }


    /* ==========================================================
     * 26. SHIFT SUMMARY
     * ========================================================== */

    async function getShiftSummary(
      options
    ) {

      options =
        options || {};


      var date =
        options.date;

      var userId =
        options.userId;

      var shiftId =
        options.shiftId;


      var kas =
        await getKasFisikLaci({

          date:
            date,

          userId:
            userId,

          shiftId:
            shiftId
        });


      return {

        date:
          date,

        userId:
          userId || null,

        shiftId:
          shiftId || null,

        modalAwal:
          kas.modalAwal,

        totalKasIn:
          kas.cashIn,

        totalKasOut:
          kas.cashOut,

        saldoKasGlobal:
          kas.saldoKasGlobal,

        saldoLaciFisik:
          kas.totalKasFisikDiLaci,

        saldoBank:
          kas.saldoBank,

        mutasiDigital:
          kas.mutasiSaldoDigital,

        totalPenjualan:
          kas.totalPenjualan,

        totalTransaksi:
          kas.totalTransaksi,

        labaShift:
          kas.totalLaba,

        summary:
          kas.summary
      };
    }


    /* ==========================================================
     * 27. SALES SUMMARY
     *
     * Fungsi khusus agar PAGE KASIR tidak menghitung sendiri.
     * ========================================================== */

    function getSalesSummary(
      transactions
    ) {

      var summary =
        createSummary(
          transactions
        );


      return {

        totalSales:
          summary.totalSales,

        salesCount:
          summary.salesCount,

        salesCash:
          summary.salesCash,

        salesQris:
          summary.salesQris,

        salesTransfer:
          summary.salesTransfer,

        salesCredit:
          summary.salesCredit,

        salesProfit:
          summary.salesProfit,

        paymentMethods:
          summary.paymentMethods
      };
    }


    /* ==========================================================
     * 28. PROFIT SUMMARY
     * ========================================================== */

    function getProfitSummary(
      transactions
    ) {

      var summary =
        createSummary(
          transactions
        );


      return {

        totalProfit:
          summary.totalProfit,

        salesProfit:
          summary.salesProfit,

        topupProfit:
          summary.topupProfit,

        withdrawalProfit:
          summary.withdrawalProfit,

        purchaseProfit:
          summary.purchaseProfit
      };
    }


    /* ==========================================================
     * 29. CASH GLOBAL SUMMARY
     * ========================================================== */

    function getCashGlobalSummary(
      transactions,
      modalAwal
    ) {

      var summary =
        createSummary(
          transactions
        );


      var modal =
        normalizeNumber(
          modalAwal
        );


      return {

        modalAwal:
          modal,

        cashIn:
          summary.cashGlobalIn,

        cashOut:
          summary.cashGlobalOut,

        mutasiKas:
          summary.saldoKasGlobal,

        saldoKasGlobal:
          modal +
          summary.saldoKasGlobal,

        cashGlobalIn:
          summary.cashGlobalIn,

        cashGlobalOut:
          summary.cashGlobalOut
      };
    }


    /* ==========================================================
     * 30. PUBLIC API
     * ========================================================== */

    return {

      /*
       * UTILITIES
       */

      normalizeNumber:
        normalizeNumber,

      normalizeBoolean:
        normalizeBoolean,

      parseDateValue:
        parseDateValue,

      formatDateKey:
        formatDateKey,

      getTransactionDate:
        getTransactionDate,

      getUserId:
        getUserId,

      getShiftId:
        getShiftId,

      getCategory:
        getCategory,

      getPaymentMethod:
        getPaymentMethod,

      getNominal:
        getNominal,

      getModalProduk:
        getModalProduk,

      getAdmin:
        getAdmin,


      /*
       * CLASSIFICATION
       */

      isValidTransaction:
        isValidTransaction,

      isSaleTransaction:
        isSaleTransaction,

      isIncludedInTransactions:
        isIncludedInTransactions,

      getAffectsCashGlobal:
        getAffectsCashGlobal,

      classifyTransaction:
        classifyTransaction,


      /*
       * MAPPER
       */

      mapTransactionMutation:
        mapTransactionMutation,

      calculateTransactionProfit:
        calculateTransactionProfit,


      /*
       * SUMMARY
       */

      summarizeTransactions:
        createSummary,

      createSummary:
        createSummary,

      getSalesSummary:
        getSalesSummary,

      getProfitSummary:
        getProfitSummary,

      getCashGlobalSummary:
        getCashGlobalSummary,


      /*
       * FIRESTORE
       */

      getTransactionsByDateRange:
        getTransactionsByDateRange,

      getModalSummary:
        getModalSummary,

      getDailySummary:
        getDailySummary,

      getPeriodSummary:
        getPeriodSummary,


      /*
       * KAS
       */

      calculateKasFisikLaciFromSummary:
        calculateKasFisikLaciFromSummary,

      getKasFisikLaci:
        getKasFisikLaci,

      getShiftSummary:
        getShiftSummary
    };

  })();
}


/*
 * Alias global
 *
 * Supaya page lama yang menggunakan:
 *
 * var KasCore = window.KasCore;
 *
 * tetap berjalan.
 */
var KasCore = window.KasCore;
