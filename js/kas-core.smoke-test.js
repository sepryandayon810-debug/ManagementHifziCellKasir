const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createDoc(id, data) {
  return {
    id,
    exists: !!data,
    data: () => data
  };
}

function createQuery(docs, filters) {
  return {
    where(field, op, value) {
      return createQuery(docs, filters.concat([[field, op, value]]));
    },
    async get() {
      const filtered = docs.filter(({ data }) => {
        return filters.every(([field, op, value]) => {
          const current = data[field];
          if (op === '==') return current === value;
          if (op === '>=') return current >= value;
          if (op === '<=') return current <= value;
          throw new Error('Unsupported operator ' + op);
        });
      });
      return {
        forEach(callback) {
          filtered.forEach(item => callback(createDoc(item.id, item.data)));
        }
      };
    }
  };
}

function createFirestore(data) {
  return {
    collection(name) {
      const docs = Object.entries(data[name] || {}).map(([id, value]) => ({ id, data: value }));
      return {
        where(field, op, value) {
          return createQuery(docs, [[field, op, value]]);
        },
        doc(id) {
          return {
            async get() {
              const value = (data[name] || {})[id];
              return createDoc(id, value);
            }
          };
        },
        async get() {
          return {
            forEach(callback) {
              docs.forEach(item => callback(createDoc(item.id, item.data)));
            }
          };
        }
      };
    }
  };
}

async function main() {
  const fakeData = {
    transactions: {
      a: { date: '2026-09-24', type: 'penjualan', total: 100000, profit: 25000, userId: 'u1', status: 'completed', paymentMethod: 'cash' },
      b: { date: '2026-09-24', type: 'topup', amount: 50000, adminFee: 2000, userId: 'u1', status: 'completed', paymentMethod: 'cash' },
      c: { date: '2026-09-25', type: 'kas_masuk', amount: 30000, userId: 'u1', status: 'completed' },
      d: { date: '2026-09-25', type: 'penjualan', total: 200000, paymentAmount: 50000, profit: 40000, userId: 'u1', status: 'completed', paymentMethod: 'hutang' },
      e: { date: '2026-09-25', type: 'tarik', amount: 40000, adminFee: 5000, userId: 'u1', status: 'completed' },
      f: { date: '2026-09-25', type: 'penjualan', total: 999999, profit: 999999, userId: 'u1', status: 'voided', paymentMethod: 'cash' },
      g: { date: '2026-09-25', type: 'penjualan', total: 75000, profit: 10000, userId: 'u1', status: 'completed', paymentMethod: 'qris' },
      h: { date: '2026-09-25', type: 'penjualan', total: 25000, profit: 5000, userId: 'u1', status: 'completed', paymentMethod: 'cash_manual' }
    },
    modal: {
      '2026-09-25_u1': { date: '2026-09-25', userId: 'u1', amount: 150000 },
      '2026-09-25': { date: '2026-09-25', userId: 'u2', amount: 999999 }
    },
    shifts: {
      '2026-09-25_u1': { date: '2026-09-25', userId: 'u1', status: 'open', modalAwal: 150000 },
      '2026-09-24_u1': { date: '2026-09-24', userId: 'u1', status: 'closed', modalAwal: 100000, kasSistem: 152000, kasAkhir: 151000 }
    },
    users: {
      u1: { name: 'Kasir 1', role: 'kasir' }
    }
  };

  const firestore = createFirestore(fakeData);
  const sandbox = {
    window: {
      db: firestore,
      firebase: { firestore: () => firestore }
    }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, 'kas-core.js'), 'utf8');
  vm.runInContext(source, sandbox);
  const { KasCore } = sandbox.window;

  const period = await KasCore.getPeriodSummary({ startDate: '2026-09-24', endDate: '2026-09-25', userId: 'u1' });
  assert.strictEqual(period.totalPenjualan, 400000, 'range query should include four valid sales only');
  assert.strictEqual(period.totalLabaPenjualan, 80000, 'voided sale must be excluded from profit');
  assert.strictEqual(period.transactionCounts.penjualan, 4, 'voided sale must be excluded from counts');

  const kas = await KasCore.getKasFisikLaci({ date: '2026-09-25', userId: 'u1' });
  assert.strictEqual(kas.modalAwal, 150000, 'modal should come from user-specific modal doc');
  assert.strictEqual(kas.cashPenjualan, 75000, 'cash variants should count while qris stays out of drawer cash');
  assert.strictEqual(kas.kasFisik, 220000, 'cash formula should match modal + masuk + penjualan + topup - tarik');

  const kasFallback = await KasCore.getKasFisikLaci({ date: '2026-09-25', userId: 'u9' });
  assert.strictEqual(kasFallback.modalAwal, 0, 'shared modal fallback should not be attributed to the wrong user');

  const openShift = await KasCore.getShiftSummary({ date: '2026-09-25', userId: 'u1' });
  assert.strictEqual(openShift.status, 'open', 'open shift should preserve its status');
  assert.strictEqual(openShift.kasFisik, 220000, 'open shift should expose current computed system cash');
  assert.strictEqual(openShift.kasSistemStored, null, 'open shift should not invent stored closing totals');

  const closedShift = await KasCore.getShiftSummary({ date: '2026-09-24', userId: 'u1' });
  assert.strictEqual(closedShift.status, 'closed', 'closed shift should preserve its status');
  assert.strictEqual(closedShift.kasFisik, 152000, 'closed shift should expose the stored system total as kasFisik');
  assert.strictEqual(closedShift.kasSistemStored, 152000, 'closed shift should expose stored system total separately');
  assert.strictEqual(closedShift.closingKasFisik, 151000, 'closed shift should expose counted closing cash separately');

  console.log('KasCore smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
