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

  // Layanan Firebase Global
  window.auth = firebase.auth();
  window.db = firebase.firestore();
  
  // Storage pengaman jika diperlukan
  try {
    window.storage = firebase.storage();
  } catch(e) {
    window.storage = null;
  }
}

const auth = window.auth;
const db = window.db;
const storage = window.storage;
