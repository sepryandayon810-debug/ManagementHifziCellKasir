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
