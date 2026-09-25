const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const kasCoreSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'kas-core.js'), 'utf8');

function makeSnapshot(items) {
  return {
    forEach(callback) {
      items.forEach(item => callback({
        id: item.id,
        data: () => item.data
      }));
    }
  };
}

function createDbMock(options = {}) {
  const transactions = options.transactions || [];
  const modalDocs = options.modalDocs || {};
  const failTransactionRangeQuery = !!options.failTransactionRangeQuery;
  const failModalDateQuery = !!options.failModalDateQuery;

  function buildQuery(collectionName, filters = []) {
    return {
      where(field, op, value) {
        return buildQuery(collectionName, filters.concat([{ field, op, value }]));
      },
      async get() {
        if (collectionName === 'transactions') {
          const hasRange = filters.some(filter => filter.op === '>=' || filter.op === '<=');
          if (failTransactionRangeQuery && hasRange) {
            throw new Error('range query failed');
          }
          const items = transactions.filter(item => {
            return filters.every(filter => {
              const fieldValue = item.data[filter.field];
              if (filter.op === '==') return fieldValue === filter.value;
              if (filter.op === '>=') return fieldValue >= filter.value;
              if (filter.op === '<=') return fieldValue <= filter.value;
              return true;
            });
          });
          return makeSnapshot(items);
        }

        if (collectionName === 'modal') {
          if (failModalDateQuery && filters.some(filter => filter.field === 'date')) {
            throw new Error('modal date query failed');
          }
          const items = Object.keys(modalDocs)
            .map(id => ({ id, data: modalDocs[id] }))
            .filter(item => {
              return filters.every(filter => {
                if (filter.op !== '==') return true;
                return item.data[filter.field] === filter.value;
              });
            });
          return makeSnapshot(items);
        }

        return makeSnapshot([]);
      }
    };
  }

  return {
    collection(name) {
      return {
        where(field, op, value) {
          return buildQuery(name, [{ field, op, value }]);
        },
        doc(id) {
          return {
            async get() {
              const data = modalDocs[id];
              return {
                id,
                exists: !!data,
                data: () => data
              };
            }
          };
        },
        async get() {
          if (name === 'transactions') return makeSnapshot(transactions);
          if (name === 'modal') {
            return makeSnapshot(Object.keys(modalDocs).map(id => ({ id, data: modalDocs[id] })));
          }
          return makeSnapshot([]);
        }
      };
    }
  };
}

function loadKasCore(dbMock) {
  const sandbox = {
    window: { db: dbMock },
    console,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(kasCoreSource, sandbox, { filename: 'kas-core.js' });
  return sandbox.window.KasCore;
}

(async () => {
  {
    const KasCore = loadKasCore(createDbMock());
    const summary = KasCore.summarizeTransactions([
      { type: 'penjualan', total: 10000, profit: 2000, paymentMethod: 'cash', status: 'completed' },
      { type: 'penjualan', total: 6000, profit: 1200, paymentMethod: 'cash', status: 'completed', source: 'hutang_page' },
      { type: 'penjualan', total: 5000, profit: 500, paymentMethod: 'cash', status: 'cancelled' },
      { type: 'penjualan', total: 7000, profit: 700, paymentMethod: 'cash', status: 'voided' },
      { type: 'topup', amount: 20000, adminFee: 1000, paymentMethod: 'cash', status: 'completed' },
      { type: 'topup', amount: 15000, adminFee: 500, paymentMethod: 'hutang', status: 'completed' },
      { type: 'tarik', amount: 10000, adminFee: 1000, status: 'completed' },
      { type: 'kas_masuk', amount: 3000, category: 'penerimaan_piutang_penjualan', status: 'completed' },
      { type: 'kas_masuk', amount: 4000, category: 'operasional', status: 'completed' },
      { type: 'kas_keluar', total: 2500, status: 'completed' }
    ]);

    assert.strictEqual(summary.totalSales, 16000);
    assert.strictEqual(summary.totalProfit, 5200);
    assert.strictEqual(summary.topup, 20000);
    assert.strictEqual(summary.cashIn, 4000);
    assert.strictEqual(summary.cashOut, 2500);
    assert.strictEqual(summary.transactionCount, 5);
    assert.strictEqual(summary.salesServiceTransactionCount, 3);
    assert.strictEqual(summary.cashMutationCount, 4);

    const kasFisik = KasCore.calculateKasFisikLaciFromSummary(50000, summary);
    assert.strictEqual(kasFisik.topupKasFisik, 21000);
    assert.strictEqual(kasFisik.tarikKasFisik, 9000);
    assert.strictEqual(kasFisik.total, 79500);
  }

  {
    const KasCore = loadKasCore(createDbMock({
      transactions: [
        { id: 'a', data: { date: '2026-09-24', type: 'penjualan', total: 1000, userId: 'u1', status: 'completed' } },
        { id: 'b', data: { date: '2026-09-25', type: 'penjualan', total: 2000, cashierId: 'u1', status: 'completed' } },
        { id: 'c', data: { date: '2026-09-25', type: 'kas_keluar', amount: 3000, userId: 'u2', status: 'completed' } }
      ]
    }));
    const rows = await KasCore.getTransactionsByDateRange({
      startDate: '2026-09-24',
      endDate: '2026-09-25',
      userId: 'u1'
    });
    assert.strictEqual(Array.from(rows, row => row.id).sort().join(','), 'a,b');
  }

  {
    const KasCore = loadKasCore(createDbMock({
      failTransactionRangeQuery: true,
      transactions: [
        { id: 'd1', data: { date: '2026-09-24', type: 'penjualan', total: 1000, status: 'completed' } },
        { id: 'd2', data: { date: '2026-09-25', type: 'penjualan', total: 2000, status: 'completed' } },
        { id: 'd3', data: { date: '2026-09-26', type: 'penjualan', total: 3000, status: 'completed' } }
      ]
    }));
    const rows = await KasCore.getTransactionsByDateRange({
      startDate: '2026-09-24',
      endDate: '2026-09-25'
    });
    assert.strictEqual(Array.from(rows, row => row.id).sort().join(','), 'd1,d2');
  }

  {
    const KasCore = loadKasCore(createDbMock({
      failModalDateQuery: true,
      modalDocs: {
        '2026-09-25_u1': { date: '2026-09-25', userId: 'u1', amount: 100000 },
        '2026-09-25_u2': { date: '2026-09-25', userId: 'u2', amount: 50000 }
      }
    }));
    const modalSummary = await KasCore.getModalSummary({ date: '2026-09-25' });
    assert.strictEqual(modalSummary.total, 150000);
    assert.strictEqual(modalSummary.entries.length, 2);
  }

  console.log('kas-core tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
