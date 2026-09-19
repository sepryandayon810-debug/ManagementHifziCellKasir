// Konfigurasi Firebase WebPOS (Firestore)
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
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
