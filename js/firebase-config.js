// Konfigurasi Firebase WebPOS (Firestore)
if (!window.firebaseConfigInitialized) {
  window.firebaseConfigInitialized = true;

  const firebaseConfig = {
  apiKey: "AIzaSyCF2nBwzMTvSilTZBTlPfBb_-8P33SbXPU",
  authDomain: "managementhifzicellv2.firebaseapp.com",
  projectId: "managementhifzicellv2",
  storageBucket: "managementhifzicellv2.firebasestorage.app",
  messagingSenderId: "543101815187",
  appId: "1:543101815187:web:99f0dbc95766e4c2434066"
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
