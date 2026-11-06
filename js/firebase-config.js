// Konfigurasi Firebase WebPOS (Firestore)
if (!window.firebaseConfigInitialized) {
  window.firebaseConfigInitialized = true;

 const firebaseConfig = {
  apiKey: "AIzaSyCKU4LAF4sEaIMvsvNDTf_kU-7JmprsdMM",
  authDomain: "managementhifzicell.firebaseapp.com",
  projectId: "managementhifzicell",
  storageBucket: "managementhifzicell.firebasestorage.app",
  messagingSenderId: "275855765943",
  appId: "1:275855765943:web:93ed6975a3417fb3c73832"
};



  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  window.auth = firebase.auth();
  window.db = firebase.firestore();

  // 1. AKTIFKAN OFFLINE PERSISTENCE (Bisa baca data saat tanpa sinyal)
  if (!window.firestorePersistenceEnabled) {
    window.firestorePersistenceEnabled = true;
    window.db.enablePersistence({ synchronizeTabs: true })
      .then(function() {
        console.log("Firestore Offline Persistence: AKTIF");
      })
      .catch(function(err) {
        console.warn("Firestore Persistence warning:", err.code);
      });
  }

  // 2. OTOMATIS UPLOAD SEMUA TRANSAKSI PENDING KE FIRESTORE SAAT ONLINE
  async function syncPendingTransactionsToFirestore() {
    if (!navigator.onLine || !window.db) return;
    try {
      if (typeof window.getPendingTransactions !== 'function') return;
      var pending = await window.getPendingTransactions();
      if (!pending || pending.length === 0) return;

      console.log("Ada " + pending.length + " transaksi offline. Memulai upload ke Firestore...");
      for (var i = 0; i < pending.length; i++) {
        var item = pending[i];
        var dataKirim = Object.assign({}, item.data);
        delete dataKirim.localId; // Hapus ID lokal sebelum ke cloud
        dataKirim.syncedAt = firebase.firestore.FieldValue.serverTimestamp();

        // Upload ke koleksi transaksi Firestore
        await window.db.collection('transaksi').add(dataKirim);

        // Hapus dari antrean lokal setelah sukses terupload
        if (typeof window.removeSyncedTransaction === 'function') {
          await window.removeSyncedTransaction(item.localId);
        }
      }
      console.log("Semua transaksi offline berhasil tersinkron ke Firestore!");
    } catch (e) {
      console.error("Gagal sinkronisasi transaksi offline:", e);
    }
  }

  // Deteksi otomatis saat sinyal internet kembali masuk
  window.addEventListener('online', syncPendingTransactionsToFirestore);
  // Cek juga saat aplikasi baru pertama kali dibuka
  setTimeout(syncPendingTransactionsToFirestore, 4000);

  try {
    window.storage = firebase.storage();
  } catch(e) {
    window.storage = null;
  }
}

// Gunakan window agar tidak terjadi error "already been declared"
var auth = window.auth;
var db = window.db;
var storage = window.storage;
